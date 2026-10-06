#!/usr/bin/env node
/**
 * check.mjs — report layout, arrow and contrast defects in a clean-diagrams SVG.
 *
 *   node check.mjs <diagram.svg> [--out <dir>] [--quiet] [--browser-only]
 *
 * Needs only Node. It reads the SVG, applies its stylesheet for the light and the dark
 * theme, measures text with a table of character widths taken from the widest common
 * fonts, and runs every check. When a browser is available (see lib/browser.mjs) it also
 * renders the file in light, dark and Arial and runs the same checks on what it drew;
 * the problems of both passes are reported together.
 *
 * Exit 0 = no failures (warnings allowed), 1 = at least one failure, 2 = usage.
 *
 * --out <dir>  writes <name>.check-light.png and <name>.check-dark.png to look at: from the
 *              browser when there is one, otherwise from resvg or rsvg-convert. With neither,
 *              it writes the flattened SVGs and says what to install.
 *
 * Markup it relies on (see references/style.md):
 *   <g class="node" id="…"> holding one <rect> and its <text> lines   → a box
 *   <g class="group" id="…"> holding one <rect> and its name <text>   → a container
 *   <path class="edge" data-from="…" data-to="…">                      → an arrow
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measure } from './lib/measure-node.mjs';
import { geometryProblems, colourProblems } from './lib/checks.mjs';
import { openBrowser } from './lib/browser.mjs';
import { flatten } from './lib/flatten.mjs';
import { parseArgs, requireFile } from './lib/args.mjs';
import { findRenderer, renderPng, BUNDLED_FONT } from './lib/render.mjs';

const USAGE = 'node check.mjs <diagram.svg> [--out <dir>] [--quiet] [--browser-only]';
const args = parseArgs(process.argv.slice(2), { flags: ['--quiet', '--browser-only'], values: ['--out'], usage: USAGE });
requireFile(args.positional[0], USAGE);
const outDir = args.values.has('--out') ? resolve(args.values.get('--out')) : null;
const QUIET = args.flags.has('--quiet');
const SVG = resolve(args.positional[0]);
const SRC = readFileSync(SVG, 'utf8');
const NAME = basename(SVG, '.svg');

/* Runs inside the page: the same model measure-node.mjs builds, measured by the browser. */
const MEASURE_IN_PAGE = (fallbackFont) => {
  /* same sampling as sampleSteps() in lib/checks.mjs: every 2 units, 4 in from each end */
  const steps = (len) => { const step = Math.max(2, len / 4000); const out = []; for (let d = 4; d < len - 1; d += step) out.push(d); return out; };
  const svg = document.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') return { error: 'not-svg' };
  if (fallbackFont) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    s.textContent = `svg, svg text { font-family: ${fallbackFont} !important; }`;
    svg.appendChild(s);
  }
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width) return { error: 'viewbox' };
  const label = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const where = (el) => { const g = el.closest('g.node, g.group'); return g && g.id ? `#${g.id}` : el.id ? `#${el.id}` : `"${label(el)}"`; };
  const box = (b) => ({ x: b.x, y: b.y, w: b.width, h: b.height, r: b.x + b.width, b: b.y + b.height });
  const rgba = (c) => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const shapes = [];
  for (const g of svg.querySelectorAll('g.node, g.group')) {
    const rect = g.querySelector(':scope > rect');
    if (g.id && rect) shapes.push({ id: g.id, kind: g.classList.contains('node') ? 'node' : 'group', r: box(rect.getBBox()) });
  }
  for (const g of svg.querySelectorAll('g.lifeline')) {
    const line = g.querySelector(':scope > path, :scope > line');
    if (g.id && line) { const b = line.getBBox(); shapes.push({ id: g.id, kind: 'lifeline', r: { x: b.x + b.width / 2, y: b.y, w: 0, h: b.height, r: b.x + b.width / 2, b: b.y + b.height } }); }
  }
  const painted = [...svg.querySelectorAll('rect, circle, ellipse, polygon, path')].filter((el) => !el.closest('defs, marker') && !el.classList.contains('edge'));
  /* opacity multiplies down the tree; getComputedStyle reports only the element's own */
  const op = (el) => { let o = 1; for (let p = el; p && p !== svg.parentNode; p = p.parentNode) if (p.nodeType === 1) o *= parseFloat(getComputedStyle(p).opacity); return o; };
  const visible = (el) => !el.checkVisibility || el.checkVisibility({ visibilityProperty: true });
  const texts = [...svg.querySelectorAll('text')].filter((t) => !t.closest('defs, marker') && label(t) && visible(t)).map((t) => {
    const cs = getComputedStyle(t), r = box(t.getBBox());
    const size = Math.min(parseFloat(cs.fontSize), ...[...t.querySelectorAll('tspan')].map((s) => parseFloat(getComputedStyle(s).fontSize)));
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const el of painted) {
      const ps = getComputedStyle(el), fill = rgba(ps.fill);
      if (!fill || fill.a === 0) continue;
      const bb = box(el.getBBox());
      if (!(c.x > bb.x && c.x < bb.r && c.y > bb.y && c.y < bb.b)) continue;
      if (el.tagName !== 'rect' && !(el.isPointInFill && el.isPointInFill(Object.assign(svg.createSVGPoint(), c)))) continue;
      bg = blend({ ...fill, a: fill.a * parseFloat(ps.fillOpacity) * op(el) }, bg);
    }
    const fg = rgba(cs.fill);
    const own = t.closest('g.node, g.group');
    return { label: label(t), where: where(t), owner: own && own.id ? own.id : null, r, size, weight: parseInt(cs.fontWeight, 10),
      outlined: !!cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0, stroke: cs.stroke,
      fg: fg ? { ...fg, a: fg.a * parseFloat(cs.fillOpacity) * op(t) } : null, bg };
  });
  const edges = [...svg.querySelectorAll('path.edge')].map((e) => {
    const len = e.getTotalLength();
    const pt = (d) => { const p = e.getPointAtLength(d); return { x: p.x, y: p.y }; };
    const me = getComputedStyle(e).markerEnd;
    return { id: e.id, from: e.dataset.from || '', to: e.dataset.to || '', head: !!e.getAttribute('marker-end') || (!!me && me !== 'none'), plain: e.classList.contains('plain'),
      len, P0: pt(0), P1: pt(len), samples: steps(len).map(pt) };
  });
  const icons = [...svg.querySelectorAll('use.icon')].filter((u) => !u.closest('defs, symbol') && visible(u)).map((u) => {
    const href = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace(/^#/, '');
    const x = u.x.baseVal.value, y = u.y.baseVal.value, w = u.width.baseVal.value, h = u.height.baseVal.value;
    const r = { x, y, w, h, r: x + w, b: y + h };
    const c = { x: x + w / 2, y: y + h / 2 };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const el of painted) {
      const ps = getComputedStyle(el), fill = rgba(ps.fill);
      if (!fill || fill.a === 0) continue;
      const bb = box(el.getBBox());
      if (!(c.x > bb.x && c.x < bb.r && c.y > bb.y && c.y < bb.b)) continue;
      if (el.tagName !== 'rect' && !(el.isPointInFill && el.isPointInFill(Object.assign(svg.createSVGPoint(), c)))) continue;
      bg = blend({ ...fill, a: fill.a * parseFloat(ps.fillOpacity) * op(el) }, bg);
    }
    const fg = rgba(getComputedStyle(u).color);
    const own = u.closest('g.node, g.group');
    return { href, ok: !!(href && svg.querySelector(`symbol[id="${href}"]`)), sized: w > 0 && h > 0, label: href.replace(/^icon-/, ''),
      where: own && own.id ? `#${own.id}` : `icon ${href}`, owner: own && own.id ? own.id : null, r, fg: fg ? { ...fg, a: fg.a * op(u) } : null, bg };
  });
  return { W: vb.width, H: vb.height, shapes, texts, edges, icons };
};

const all = [];
const seen = new Set();
const keyOf = (p) => `${p.check}|${p.where}|${(p.msg.match(/"[^"]*"/) || [p.msg])[0]}`;
const report = (problems, note = '') => {
  for (const p of problems) {
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    all.push(note ? { ...p, msg: `${p.msg} ${note}` } : p);
  }
};

/* 1. no browser: always, unless --browser-only (used to compare the two passes) */
const BROWSER_ONLY = args.flags.has('--browser-only');
const light = measure(SRC, 'light');
let dims = light.W ? { W: light.W, H: light.H } : null;
if (!BROWSER_ONLY) report(light.problems);
if (!light.error && !BROWSER_ONLY) {
  report(geometryProblems(light));
  report(colourProblems(light, 'light'));
  report(colourProblems(measure(SRC, 'dark'), 'dark'));
}

/* 2. a browser, when there is one */
const opened = light.error && !BROWSER_ONLY ? null : await openBrowser();
if (BROWSER_ONLY && !opened) { console.error('--browser-only: no browser available'); process.exit(2); }
let previews = 'none';
if (opened) {
  const { browser } = opened;
  try {
    for (const [theme, font] of [['light', null], ['dark', null], ['light', 'Arial, "Liberation Sans", sans-serif']]) {
      const ctx = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(SVG).href);
      const m = await page.evaluate(MEASURE_IN_PAGE, font);
      if (m.error === 'not-svg') report([{ level: 'fail', check: 'xml', where: 'file', msg: 'the browser could not read the file as SVG (it shows a parse error page)' }], '(browser)');
      if (!m.error) {
        if (!font && theme === 'light') report(geometryProblems(m), '(browser)');
        if (font) report(geometryProblems(m), '(browser, fallback font Arial)');
        if (!font) report(colourProblems(m, theme), '(browser)');
      }
      if (outDir && !font) {
        mkdirSync(outDir, { recursive: true });
        const size = dims || (m.W ? { W: m.W, H: m.H } : null);
        if (size) {
          await page.setViewportSize({ width: Math.ceil(size.W), height: Math.ceil(size.H) });
          await page.screenshot({ path: join(outDir, `${NAME}.check-${theme}.png`), clip: { x: 0, y: 0, width: size.W, height: size.H } });
        }
        previews = opened.kind;
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

/* 3. previews without a browser */
if (outDir && previews === 'none' && dims && !BROWSER_ONLY) {
  mkdirSync(outDir, { recursive: true });
  const renderer = findRenderer();
  for (const theme of ['light', 'dark']) {
    const flat = join(outDir, `${NAME}.check-${theme}.svg`);
    writeFileSync(flat, flatten(SRC, theme, { font: BUNDLED_FONT }));
    if (renderer) {
      try { renderPng(renderer, flat, join(outDir, `${NAME}.check-${theme}.png`), 2); } catch (e) { previews = `none: ${e.message}`; }
    }
  }
  if (previews === 'none') previews = renderer ? renderer.name : 'flattened SVG only (install resvg or librsvg for PNG previews)';
}

const fails = all.filter((p) => p.level === 'fail');
const warns = all.filter((p) => p.level === 'warn');
for (const p of [...fails, ...warns]) console.log(`${p.level.toUpperCase().padEnd(4)}  ${p.check.padEnd(18)} ${p.where.padEnd(16)} ${p.msg}`);
const how = opened ? `node + ${opened.kind}` : 'node';
if (!QUIET || fails.length) console.log(`\n${basename(SVG)}: ${fails.length} fail, ${warns.length} warn${dims ? ` · ${dims.W}x${dims.H}` : ''} · checked with ${how}${outDir ? ` · previews: ${previews} in ${outDir}` : ''}`);
process.exit(fails.length ? 1 : 0);
