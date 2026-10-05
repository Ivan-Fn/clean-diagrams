#!/usr/bin/env node
/**
 * check.mjs — render a clean-diagrams SVG in Chromium and report layout defects.
 *
 *   node check.mjs <diagram.svg> [--out <dir>] [--quiet]
 *
 * Renders the file in light and dark, measures every element, and prints one line per
 * problem. Exit 0 = no failures (warnings allowed), 1 = at least one failure, 2 = usage.
 * With --out, also writes <name>.check-light.png and <name>.check-dark.png at 2x so you can
 * look at the render before shipping it. (Named apart from export.mjs's PNGs on purpose.)
 *
 * Markup it relies on (see references/style.md):
 *   <g class="node" id="…"> holding one <rect> and its <text> lines   → a box
 *   <g class="group" id="…"> holding one <rect> and its name <text>   → a container
 *   <path class="edge" data-from="…" data-to="…">                      → an arrow
 * Everything else is free-form.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
const outDir = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : null;
const QUIET = argv.includes('--quiet');
if (!file || !existsSync(file)) {
  console.error('usage: node check.mjs <diagram.svg> [--out <dir>] [--quiet]');
  process.exit(2);
}
const SVG = resolve(file);

/* Runs inside the page. Returns { problems: [{level, check, where, msg}] }. */
const INSPECT = ([theme, fallbackFont]) => {
  const problems = [];
  const add = (level, check, where, msg) => problems.push({ level, check, where, msg, theme });
  const svg = document.documentElement;
  if (fallbackFont) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    s.textContent = `svg, svg text { font-family: ${fallbackFont} !important; }`;
    svg.appendChild(s);
  }
  if (svg.tagName.toLowerCase() !== 'svg') return { problems: [{ level: 'fail', check: 'not-svg', where: '', msg: 'file is not an SVG document' }] };

  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width) { add('fail', 'viewbox', 'svg', 'no viewBox; set viewBox="0 0 W H"'); return { problems }; }
  const W = vb.width, H = vb.height;

  const label = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const where = (el) => {
    const g = el.closest('g.node, g.group');
    return g && g.id ? `#${g.id}` : el.id ? `#${el.id}` : `"${label(el)}"`;
  };
  const box = (b) => ({ x: b.x, y: b.y, w: b.width, h: b.height, r: b.x + b.width, b: b.y + b.height });
  const inside = (p, r, inset = 0) => p.x > r.x + inset && p.x < r.r - inset && p.y > r.y + inset && p.y < r.b - inset;
  const overlap = (a, b, pad = 0) => a.x < b.r - pad && b.x < a.r - pad && a.y < b.b - pad && b.y < a.b - pad;
  const contains = (o, i, dx = 0, dy = 0) => i.x >= o.x + dx && i.r <= o.r - dx && i.y >= o.y + dy && i.b <= o.b - dy;

  /* ids */
  const seen = new Map();
  for (const el of svg.querySelectorAll('[id]')) {
    if (seen.has(el.id)) add('fail', 'duplicate-id', `#${el.id}`, 'id is used twice');
    seen.set(el.id, el);
  }
  for (const el of svg.querySelectorAll('[transform]')) {
    if (el.closest('defs, marker')) continue;
    add('warn', 'transform', where(el), 'transform found; the checks measure untransformed geometry, so results may be wrong');
  }

  /* boxes and containers */
  const shapes = [];
  for (const g of svg.querySelectorAll('g.node, g.group')) {
    const rect = g.querySelector(':scope > rect');
    if (!g.id) { add('fail', 'missing-id', `"${label(g)}"`, `${g.classList.contains('node') ? 'node' : 'group'} has no id`); continue; }
    if (!rect) { add('fail', 'no-rect', `#${g.id}`, 'needs one <rect> as its direct child'); continue; }
    shapes.push({ id: g.id, kind: g.classList.contains('node') ? 'node' : 'group', g, rect, r: box(rect.getBBox()) });
  }
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const nodes = shapes.filter((s) => s.kind === 'node');

  /* frame */
  for (const s of shapes) {
    if (s.r.x < 0 || s.r.y < 0 || s.r.r > W || s.r.b > H) add('fail', 'out-of-frame', `#${s.id}`, `box ${Math.round(s.r.x)},${Math.round(s.r.y)} ${Math.round(s.r.w)}x${Math.round(s.r.h)} is outside the ${W}x${H} viewBox`);
  }

  /* texts */
  const texts = [...svg.querySelectorAll('text')].filter((t) => !t.closest('defs, marker') && label(t));
  const T = texts.map((t) => ({ el: t, r: box(t.getBBox()), cs: getComputedStyle(t) }));
  for (const t of T) {
    const size = parseFloat(t.cs.fontSize);
    if (t.cs.stroke && t.cs.stroke !== 'none' && parseFloat(t.cs.strokeWidth) > 0) add('fail', 'text-outline', where(t.el), `"${label(t.el)}" is drawn with an outline (stroke ${t.cs.stroke}); a shape style is probably leaking onto text — scope it to rect, e.g. rect.group`);
    if (size < 11) add('fail', 'font-size', where(t.el), `"${label(t.el)}" is ${size}px; the minimum is 11`);
    if (t.r.x < 8 || t.r.r > W - 8 || t.r.y < 4 || t.r.b > H - 4) add('fail', 'text-out-of-frame', where(t.el), `"${label(t.el)}" reaches ${Math.round(t.r.r)} of ${W} wide / ${Math.round(t.r.b)} of ${H} high; keep 8 clear`);
    const own = t.el.closest('g.node, g.group');
    const s = own && byId.get(own.id);
    if (s) {
      const fits = contains(s.r, t.r, s.kind === 'node' ? 8 : 4, 3);
      if (!fits) {
        const need = Math.ceil(t.r.w + 16);
        add('fail', 'text-outside-box', `#${s.id}`, `"${label(t.el)}" is ${Math.ceil(t.r.w)} wide and does not fit inside its box (${Math.round(s.r.w)}x${Math.round(s.r.h)}); widen the box to at least ${need}, break the line, or move it`);
      }
    } else {
      for (const n of shapes) {
        if (overlap(t.r, n.r) && !contains(n.r, t.r)) add('fail', 'text-on-border', where(t.el), `"${label(t.el)}" crosses the border of #${n.id}`);
        else if (n.kind === 'node' && contains(n.r, t.r)) add('fail', 'loose-text-in-box', where(t.el), `"${label(t.el)}" sits inside #${n.id} but is not in its <g class="node">`);
        else if (n.kind === 'node' && overlap({ x: t.r.x - 4, y: t.r.y - 2, r: t.r.r + 4, b: t.r.b + 2 }, n.r)) add('fail', 'label-crowding', where(t.el), `"${label(t.el)}" is less than 4 from #${n.id}; move it into a wider gap or above the row`);
      }
    }
  }
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    if (overlap(T[i].r, T[j].r, 1)) add('fail', 'text-overlap', where(T[i].el), `"${label(T[i].el)}" overlaps "${label(T[j].el)}"`);
  }

  /* overlapping boxes (containers may hold boxes; boxes may not touch) */
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (overlap(nodes[i].r, nodes[j].r, -8)) add('fail', 'boxes-too-close', `#${nodes[i].id}`, `#${nodes[i].id} and #${nodes[j].id} are less than 8 apart`);
  }
  for (const grp of shapes.filter((s) => s.kind === 'group')) for (const n of nodes) {
    if (overlap(grp.r, n.r) && !contains(grp.r, n.r)) add('fail', 'straddles-group', `#${n.id}`, `#${n.id} crosses the border of #${grp.id}`);
  }

  /* edges */
  const distToBorder = (p, r) => {
    const dx = Math.max(r.x - p.x, 0, p.x - r.r), dy = Math.max(r.y - p.y, 0, p.y - r.b);
    if (dx || dy) return Math.hypot(dx, dy);
    return Math.min(p.x - r.x, r.r - p.x, p.y - r.y, r.b - p.y);
  };
  for (const e of svg.querySelectorAll('path.edge')) {
    const id = e.id ? `#${e.id}` : `edge ${e.dataset.from}->${e.dataset.to}`;
    const from = byId.get(e.dataset.from), to = byId.get(e.dataset.to);
    if (!e.dataset.from || !e.dataset.to) { add('fail', 'edge-ends', id, 'needs data-from and data-to'); continue; }
    if (!from) add('fail', 'edge-ref', id, `data-from="${e.dataset.from}" names no node or group`);
    if (!to) add('fail', 'edge-ref', id, `data-to="${e.dataset.to}" names no node or group`);
    if (!from || !to) continue;
    if (!e.getAttribute('marker-end') && !e.classList.contains('plain')) add('warn', 'no-arrowhead', id, 'no marker-end; add class "plain" if a bare line is intended');
    const len = e.getTotalLength();
    const P0 = e.getPointAtLength(0), P1 = e.getPointAtLength(len);
    const tol = 3;
    const okEnd = (p, s) => (s.kind === 'group' ? (inside(p, s.r) || distToBorder(p, s.r) <= tol) : distToBorder(p, s.r) <= tol);
    if (!okEnd(P0, from)) add('fail', 'edge-start', id, `starts at ${Math.round(P0.x)},${Math.round(P0.y)}, ${Math.round(distToBorder(P0, from.r))} away from the edge of #${from.id}`);
    if (!okEnd(P1, to)) add('fail', 'edge-end', id, `ends at ${Math.round(P1.x)},${Math.round(P1.y)}, ${Math.round(distToBorder(P1, to.r))} away from the edge of #${to.id}`);
    const hitsBox = new Set(), hitsText = new Set();
    for (let d = 4; d < len - 4; d += 2) {
      const p = e.getPointAtLength(d);
      for (const n of nodes) if (inside(p, n.r, 2)) hitsBox.add(n.id);
      for (const t of T) if (inside(p, { x: t.r.x - 1, y: t.r.y - 1, r: t.r.r + 1, b: t.r.b + 1 })) hitsText.add(label(t.el));
    }
    for (const n of hitsBox) add('fail', 'edge-through-box', id, `runs through #${n}; route it around with an elbow`);
    for (const t of hitsText) add('fail', 'edge-over-text', id, `runs over "${t}"`);
  }

  /* contrast: text colour against the topmost painted shape under its centre */
  const rgba = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const painted = [...svg.querySelectorAll('rect, circle, ellipse, polygon, path')].filter((el) => !el.closest('defs, marker') && !el.classList.contains('edge'));
  for (const t of T) {
    const fg = rgba(t.cs.fill);
    if (!fg) { add('fail', 'text-fill', where(t.el), `"${label(t.el)}" has no fill colour`); continue; }
    const c = { x: t.r.x + t.r.w / 2, y: t.r.y + t.r.h / 2 };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const el of painted) {
      const cs = getComputedStyle(el);
      const fill = rgba(cs.fill);
      if (!fill || fill.a === 0) continue;
      const bb = box(el.getBBox());
      if (!inside(c, bb)) continue;
      if (el.tagName !== 'rect' && !(el.isPointInFill && el.isPointInFill(Object.assign(svg.createSVGPoint(), c)))) continue;
      bg = blend({ ...fill, a: fill.a * parseFloat(cs.fillOpacity) * parseFloat(cs.opacity) }, bg);
    }
    const size = parseFloat(t.cs.fontSize), bold = parseInt(t.cs.fontWeight, 10) >= 600;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const got = ratio(blend({ ...fg, a: fg.a * parseFloat(t.cs.fillOpacity) }, bg), bg);
    if (got < need) add('fail', 'contrast', where(t.el), `"${label(t.el)}" contrast ${got.toFixed(2)}:1 in the ${theme} theme; needs ${need}:1`);
  }

  return { problems, W, H };
};

const browser = await chromium.launch();
const all = [];
let dims = null;
try {
  /* Pass 1 and 2: the file as written, light then dark. Pass 3: geometry again with Arial,
     the widest font a reader is likely to get when the system font is missing (Linux and
     Windows viewers on GitHub), so a label that only just fits on a Mac is caught. */
  const passes = [['light', null], ['dark', null], ['light', 'Arial, "Liberation Sans", sans-serif']];
  const key = (p) => `${p.check}|${p.where}|${p.msg}`;
  const seenKeys = new Set();
  for (const [theme, font] of passes) {
    const ctx = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(SVG).href);
    const res = await page.evaluate(INSPECT, [theme, font]);
    dims = dims || { W: res.W, H: res.H };
    const colourOnly = (p) => p.check === 'contrast' || p.check === 'text-fill';
    for (const p of res.problems) {
      if (theme === 'dark' && !colourOnly(p)) continue;       /* geometry is theme-independent */
      if (font && colourOnly(p)) continue;
      if (font) p.msg += ' (with the fallback font Arial)';
      const k = key({ ...p, msg: p.msg.replace(' (with the fallback font Arial)', '') });
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      all.push(p);
    }
    if (outDir && res.W && !font) {
      mkdirSync(outDir, { recursive: true });
      await page.setViewportSize({ width: Math.ceil(res.W), height: Math.ceil(res.H) });
      await page.screenshot({ path: join(outDir, `${basename(SVG, '.svg')}.check-${theme}.png`), clip: { x: 0, y: 0, width: res.W, height: res.H } });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const fails = all.filter((p) => p.level === 'fail');
const warns = all.filter((p) => p.level === 'warn');
for (const p of [...fails, ...warns]) console.log(`${p.level.toUpperCase().padEnd(4)}  ${p.check.padEnd(18)} ${p.where.padEnd(16)} ${p.msg}`);
if (!QUIET || fails.length) console.log(`\n${basename(SVG)}: ${fails.length} fail, ${warns.length} warn${dims ? ` · ${dims.W}x${dims.H}` : ''}${outDir ? ` · renders in ${outDir}` : ''}`);
process.exit(fails.length ? 1 : 0);
