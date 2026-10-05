/**
 * svgdom.mjs — read a clean-diagrams SVG without a browser.
 *
 * Parses the XML, applies the file's own <style> sheet for a given theme (custom
 * properties, the prefers-color-scheme block, class selectors, inheritance), and gives
 * each element its resolved style and geometry. Text width comes from a measured
 * per-character table (widths.json: the widest of the macOS system font, Arial and
 * Helvetica), so a label that fits here fits on any reader's machine.
 *
 * Scope: the subset of SVG and CSS the templates use. Rect, text, path (M L H V Z),
 * circle, ellipse, line, polygon, g, defs, marker; selectors built from a tag, classes
 * and an id, optionally with descendant combinators; @media for prefers-color-scheme,
 * "all" and "not all". Anything else is reported by the caller, never guessed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTHS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'widths.json'), 'utf8'));
/* Ascent and descent as a share of the font size: the larger of the system font and Arial. */
const ASCENT = 0.95, DESCENT = 0.24;

/* ------------------------------------------------------------------ XML */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);

export function parse(src) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gi;
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) { cur.children.push({ tag: '#text', text: m[1], parent: cur }); continue; }
    if (m[6] !== undefined) { cur.children.push({ tag: '#text', text: decode(m[6]), parent: cur }); continue; }
    if (!m[3]) continue;                                   /* comment, PI, doctype */
    const tag = m[3].replace(/^svg:/, '');
    if (m[2] === '/') { if (cur.parent) cur = cur.parent; continue; }
    const attrs = {};
    for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
    const el = { tag, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!m[5]) cur = el;
  }
  const svg = root.children.find((c) => c.tag === 'svg');
  return { root, svg };
}

export const elements = (node, out = []) => {
  for (const c of node.children) if (c.tag[0] !== '#') { out.push(c); elements(c, out); }
  return out;
};
export const classes = (el) => (el.attrs.class || '').split(/\s+/).filter(Boolean);
export const hasClass = (el, c) => classes(el).includes(c);
export const closest = (el, pred) => { for (let p = el; p && p.tag !== '#root'; p = p.parent) if (pred(p)) return p; return null; };
export const textOf = (el) => el.children.map((c) => (c.tag === '#text' ? c.text : textOf(c))).join('');
export const inDefs = (el) => !!closest(el, (p) => p.tag === 'defs' || p.tag === 'marker' || p.tag === 'clipPath' || p.tag === 'mask' || p.tag === 'pattern');

/* ------------------------------------------------------------------ CSS */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
function parseBlocks(css) {
  /* returns [{media: string|null, selector, decls: [[prop, value]]}] in source order */
  const out = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.slice(6).trim());
      else if (!head.startsWith('@')) {
        const decls = body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
          const k = d.indexOf(':');
          return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim().replace(/\s*!important$/, '')];
        }).filter(([k]) => k);
        for (const sel of head.split(',').map((s) => s.trim()).filter(Boolean)) out.push({ media, selector: sel, decls });
      }
      i = j;
    }
  };
  walk(stripComments(css), null);
  return out;
}
const mediaApplies = (media, theme) => {
  if (media == null) return true;
  const m = media.toLowerCase().replace(/\s+/g, ' ').trim();
  if (m === 'all' || m === 'screen') return true;
  if (m === 'not all' || m === 'print') return false;
  const scheme = m.match(/prefers-color-scheme\s*:\s*(dark|light)/);
  if (scheme) return (m.startsWith('not') ? scheme[1] !== theme : scheme[1] === theme);
  return false;
};
const compound = (s) => {
  const m = s.match(/^([a-z*][\w-]*)?((?:[.#][\w-]+)*)$/i);
  if (!m) return null;
  const parts = m[2].match(/[.#][\w-]+/g) || [];
  return { tag: m[1] && m[1] !== '*' ? m[1] : null, classes: parts.filter((p) => p[0] === '.').map((p) => p.slice(1)), id: parts.find((p) => p[0] === '#')?.slice(1) };
};
const matchCompound = (c, el) => (!c.tag || c.tag === el.tag) && (!c.id || el.attrs.id === c.id) && c.classes.every((k) => hasClass(el, k));
function compileSelector(sel) {
  const steps = sel.split(/\s+/).map(compound);
  if (steps.some((s) => !s)) return null;
  const last = steps[steps.length - 1];
  const spec = steps.reduce((a, s) => [a[0] + (s.id ? 1 : 0), a[1] + s.classes.length, a[2] + (s.tag ? 1 : 0)], [0, 0, 0]);
  const test = (el) => {
    if (!matchCompound(last, el)) return false;
    let p = el.parent;
    for (let i = steps.length - 2; i >= 0; i--) {
      while (p && p.tag !== '#root' && !matchCompound(steps[i], p)) p = p.parent;
      if (!p || p.tag === '#root') return false;
      p = p.parent;
    }
    return true;
  };
  return { test, spec: spec[0] * 10000 + spec[1] * 100 + spec[2] };
}

const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'color', 'visibility', 'letter-spacing']);
const PRESENTATION = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'color', 'display', 'visibility', 'letter-spacing'];
const INITIAL = { fill: '#000000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1', opacity: '1', 'font-size': '16',
  'font-weight': '400', 'text-anchor': 'start', 'font-family': 'sans-serif', 'stroke-dasharray': 'none', display: 'inline', visibility: 'visible' };

/* Resolve every element's style for one theme. Sets el.cs = { prop: value } (custom properties included). */
export function computeStyles(doc, theme) {
  const css = elements(doc.root).filter((e) => e.tag === 'style').map(textOf).join('\n');
  const rules = parseBlocks(css).filter((r) => mediaApplies(r.media, theme)).map((r, order) => ({ ...r, order, sel: compileSelector(r.selector) }));
  const unsupported = [...new Set(rules.filter((r) => !r.sel).map((r) => r.selector))];
  const visit = (el, parentCs) => {
    if (el.tag[0] === '#') return;
    const cs = {};
    for (const [k, v] of Object.entries(parentCs)) if (k.startsWith('--') || INHERITED.has(k)) cs[k] = v;
    for (const p of PRESENTATION) if (el.attrs[p] != null) cs[p] = el.attrs[p];
    const matched = rules.filter((r) => r.sel && r.sel.test(el)).sort((a, b) => a.sel.spec - b.sel.spec || a.order - b.order);
    for (const r of matched) for (const [k, v] of r.decls) cs[k] = v;
    if (el.attrs.style) for (const d of el.attrs.style.split(';')) { const i = d.indexOf(':'); if (i > 0) cs[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }
    const resolveVar = (v, depth = 0) => (typeof v === 'string' && v.includes('var(') && depth < 8
      ? resolveVar(v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fb) => cs[name] ?? fb ?? ''), depth + 1) : v);
    for (const k of Object.keys(cs)) cs[k] = resolveVar(cs[k]);
    if (cs.fill === 'currentColor' || cs.fill === 'currentcolor') cs.fill = cs.color || '#000000';
    if (cs.stroke === 'currentColor' || cs.stroke === 'currentcolor') cs.stroke = cs.color || '#000000';
    for (const [k, v] of Object.entries(INITIAL)) if (cs[k] == null) cs[k] = v;
    el.cs = cs;
    for (const c of el.children) visit(c, cs);
  };
  visit(doc.svg, {});
  return { unsupported };
}

/* ------------------------------------------------------------------ values */
const NAMED = { none: null, transparent: null, black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128] };
export function color(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s in NAMED) return NAMED[s] ? { r: NAMED[s][0], g: NAMED[s][1], b: NAMED[s][2], a: 1 } : null;
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : Number(x)));
    return { r, g, b, a };
  }
  return undefined;                                         /* unknown: caller decides */
}
export const hex = (c) => (c ? `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : 'none');
export const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
export const weight = (v) => (v === 'bold' || v === 'bolder' ? 700 : v === 'normal' || v === 'lighter' ? 400 : num(v, 400));

/* ------------------------------------------------------------------ geometry */
export const rectBox = (el) => {
  const x = num(el.attrs.x), y = num(el.attrs.y), w = num(el.attrs.width), h = num(el.attrs.height);
  return { x, y, w, h, r: x + w, b: y + h };
};
export function textWidth(str, size, wt) {
  const table = wt >= 600 ? WIDTHS.bold : WIDTHS.regular;
  let w = 0;
  for (const ch of str) w += table[ch] ?? (ch.codePointAt(0) > 0x2e80 ? 1.0 : 0.62);
  return w * size;
}
export function textBox(el) {
  const cs = el.cs, size = num(cs['font-size'], 16), wt = weight(cs['font-weight']);
  const s = textOf(el).replace(/\s+/g, ' ').trim();
  const x = num(el.attrs.x), y = num(el.attrs.y), w = textWidth(s, size, wt);
  const anchor = cs['text-anchor'];
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const top = y - ASCENT * size, h = (ASCENT + DESCENT) * size;
  return { x: left, y: top, w, h, r: left + w, b: top + h };
}
/* Absolute and relative M L H V Z only; anything else throws with the command named. */
export function pathPoints(d) {
  const toks = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let cmd = null, x = 0, y = 0, sx = 0, sy = 0;
  for (let i = 0; i < toks.length;) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const n = () => Number(toks[i++]);
    switch (cmd) {
      case 'M': x = n(); y = n(); sx = x; sy = y; cmd = 'L'; break;
      case 'm': x += n(); y += n(); sx = x; sy = y; cmd = 'l'; break;
      case 'L': x = n(); y = n(); break;
      case 'l': x += n(); y += n(); break;
      case 'H': x = n(); break;
      case 'h': x += n(); break;
      case 'V': y = n(); break;
      case 'v': y += n(); break;
      case 'Z': case 'z': x = sx; y = sy; pts.push({ x, y }); continue;
      default: throw new Error(`path command "${cmd}" is not supported; use M, L, H, V and Z`);
    }
    pts.push({ x, y });
  }
  return pts;
}
export const polyLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
export function pointAt(pts, d) {
  let left = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, left / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  return pts[0] || { x: 0, y: 0 };
}
export function shapeBox(el) {
  const a = el.attrs;
  if (el.tag === 'rect') return rectBox(el);
  if (el.tag === 'circle') { const r = num(a.r); return { x: num(a.cx) - r, y: num(a.cy) - r, w: 2 * r, h: 2 * r, r: num(a.cx) + r, b: num(a.cy) + r }; }
  if (el.tag === 'ellipse') { const rx = num(a.rx), ry = num(a.ry); return { x: num(a.cx) - rx, y: num(a.cy) - ry, w: 2 * rx, h: 2 * ry, r: num(a.cx) + rx, b: num(a.cy) + ry }; }
  return null;
}
export const viewBox = (svg) => {
  const v = (svg.attrs.viewBox || svg.attrs.viewbox || '').split(/[\s,]+/).map(Number);
  return v.length === 4 && v.every(Number.isFinite) && v[2] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null;
};
