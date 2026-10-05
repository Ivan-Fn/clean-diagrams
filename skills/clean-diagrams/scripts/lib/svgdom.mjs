/**
 * svgdom.mjs — read a clean-diagrams SVG without a browser.
 *
 * Parses the XML strictly (a file a browser would refuse is reported, never repaired),
 * applies the file's own <style> sheet for a given theme, and gives each element its
 * resolved style and geometry.
 *
 * Text width comes from widths.json: for every character in Latin, Greek, Cyrillic,
 * common punctuation and arrows, at each text size from 11 to 24 and in regular and
 * semibold/bold, the widest of the macOS system font, Arial, Helvetica and Helvetica Neue,
 * measured in Chromium as SVG text at that size. CJK uses 1.05 em and emoji the widest
 * measured emoji width. A label measured here is at least as wide as in any of those fonts.
 *
 * Supported: rect, text with tspan lines, path (M L H V Z, absolute and relative), circle,
 * ellipse, g, defs, marker; selectors made of tags, classes, ids and :root with descendant
 * and child combinators; !important; @media for prefers-color-scheme, all, not all, screen
 * and print; var() with fallbacks; inherit; px and em font sizes; hex, rgb(), hsl() and
 * named colours. Selectors and values outside that are returned as problems by the caller.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'widths.json'), 'utf8'));
const CHAR_INDEX = new Map([...W.chars].map((c, i) => [c, i]));
/* Ascent and descent as a share of the font size: the larger of the system font and Arial. */
const ASCENT = 0.95, DESCENT = 0.24;

/* ------------------------------------------------------------------ XML */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeStrict = (s, errors, where) => s.replace(/&([^;\s<&]*);?/g, (m, e) => {
  if (!m.endsWith(';')) { errors.push(`a raw "&" ${where} must be written "&amp;"`); return m; }
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    if (!Number.isFinite(n)) { errors.push(`bad character reference "${m}" ${where}`); return m; }
    return String.fromCodePoint(n);
  }
  if (!(e in ENT)) { errors.push(`unknown entity "${m}" ${where}; XML knows only &amp; &lt; &gt; &quot; &apos;`); return m; }
  return ENT[e];
});
export const decode = (s) => decodeStrict(s, [], '');

export function parse(src) {
  const errors = [];
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root, last = 0;
  const line = (i) => src.slice(0, i).split('\n').length;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/gi;
  for (const m of src.matchAll(re)) {
    if (m.index !== last) { errors.push(`line ${line(last)}: "${src.slice(last, last + 20).replace(/\s+/g, ' ')}…" is not well-formed XML (a raw "<", or a broken tag)`); }
    last = m.index + m[0].length;
    if (m[2]) errors.push(`line ${line(m.index)}: a DOCTYPE with declarations is not supported`);
    if (m[1] !== undefined) { cur.children.push({ tag: '#text', text: m[1], parent: cur }); continue; }
    if (m[7] !== undefined) {
      if (m[7].includes('>') && /]]>/.test(m[7])) errors.push(`line ${line(m.index)}: "]]>" outside CDATA`);
      cur.children.push({ tag: '#text', text: decodeStrict(m[7], errors, `on line ${line(m.index)}`), parent: cur });
      continue;
    }
    if (!m[4]) continue;                                   /* comment, PI, doctype */
    const tag = m[4].replace(/^svg:/, '');
    if (m[3] === '/') {
      if (cur.tag !== tag) { errors.push(`line ${line(m.index)}: closing </${tag}> does not match the open <${cur.tag}>`); }
      else cur = cur.parent;
      continue;
    }
    const attrs = {};
    for (const a of m[5].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (a[1] in attrs) errors.push(`line ${line(m.index)}: attribute "${a[1]}" appears twice on <${tag}>`);
      attrs[a[1]] = decodeStrict(a[2] ?? a[3], errors, `in the ${a[1]} attribute on line ${line(m.index)}`);
    }
    const el = { tag, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!m[6]) cur = el;
  }
  if (last !== src.length) errors.push(`line ${line(last)}: the file ends inside a tag`);
  if (cur !== root) errors.push(`<${cur.tag}> is never closed`);
  const tops = root.children.filter((c) => c.tag[0] !== '#');
  if (tops.length !== 1) errors.push(`an XML file has one root element; found ${tops.length}`);
  const svg = tops.find((c) => c.tag === 'svg');
  return { root, svg, errors: [...new Set(errors)] };
}

export const elements = (node, out = []) => {
  for (const c of node.children) if (c.tag[0] !== '#') { out.push(c); elements(c, out); }
  return out;
};
export const classes = (el) => (el.attrs.class || '').split(/\s+/).filter(Boolean);
export const hasClass = (el, c) => classes(el).includes(c);
export const closest = (el, pred) => { for (let p = el; p && p.tag !== '#root'; p = p.parent) if (pred(p)) return p; return null; };
export const textOf = (el) => el.children.map((c) => (c.tag === '#text' ? c.text : textOf(c))).join('');
export const inDefs = (el) => !!closest(el, (p) => ['defs', 'marker', 'clipPath', 'mask', 'pattern', 'symbol'].includes(p.tag));

/* ------------------------------------------------------------------ CSS */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const splitDecls = (body) => {
  const out = [];
  let cur = '', q = null, depth = 0;
  for (const ch of body) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((d) => d.trim()).filter(Boolean).map((d) => {
    const k = d.indexOf(':');
    const v = d.slice(k + 1).trim();
    const important = /!\s*important\s*$/i.test(v);
    return [d.slice(0, k).trim().toLowerCase(), v.replace(/\s*!\s*important\s*$/i, ''), important];
  }).filter(([k]) => k);
};
function parseBlocks(css) {
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
      if (head.startsWith('@media')) walk(body, [media, head.slice(6).trim()].filter(Boolean).join(' and '));
      else if (head.startsWith('@')) out.push({ media, selector: head, decls: [], at: true });
      else {
        const decls = splitDecls(body);
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
  return media.toLowerCase().split(/\s*,\s*/).some((q) => {
    q = q.replace(/\s+/g, ' ').trim();
    const neg = q.startsWith('not ');
    if (neg) q = q.slice(4);
    let ok = true;
    for (const part of q.split(/\s+and\s+/)) {
      const p = part.replace(/^only\s+/, '').trim();
      if (p === 'all' || p === 'screen') continue;
      if (p === 'print' || p === 'speech') { ok = false; continue; }
      const s = p.match(/^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/);
      if (s) { if (s[1] !== theme) ok = false; continue; }
      ok = false;                                     /* unknown feature: assume it does not match */
    }
    return neg ? !ok : ok;
  });
};
const compound = (s) => {
  if (s === ':root') return { root: true, classes: [] };
  const m = s.match(/^([a-z*][\w-]*)?((?:[.#][\w-]+)*)$/i);
  if (!m || (!m[1] && !m[2])) return null;
  const parts = m[2].match(/[.#][\w-]+/g) || [];
  return { tag: m[1] && m[1] !== '*' ? m[1] : null, classes: parts.filter((p) => p[0] === '.').map((p) => p.slice(1)), id: parts.find((p) => p[0] === '#')?.slice(1) };
};
const matchCompound = (c, el) => (c.root ? el.parent?.tag === '#root' : (!c.tag || c.tag === el.tag) && (!c.id || el.attrs.id === c.id) && c.classes.every((k) => hasClass(el, k)));
function compileSelector(sel) {
  const toks = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const steps = [];
  let comb = ' ';
  for (const t of toks) {
    if (t === '>') { comb = '>'; continue; }
    const c = compound(t);
    if (!c) return null;
    steps.push({ c, comb });
    comb = ' ';
  }
  if (!steps.length) return null;
  const spec = steps.reduce((a, { c }) => [a[0] + (c.id ? 1 : 0), a[1] + c.classes.length + (c.root ? 1 : 0), a[2] + (c.tag ? 1 : 0)], [0, 0, 0]);
  const test = (el) => {
    const match = (i, node) => {
      if (!matchCompound(steps[i].c, node)) return false;
      if (i === 0) return true;
      if (steps[i].comb === '>') return node.parent && node.parent.tag !== '#root' && match(i - 1, node.parent);
      for (let p = node.parent; p && p.tag !== '#root'; p = p.parent) if (match(i - 1, p)) return true;
      return false;
    };
    return match(steps.length - 1, el);
  };
  return { test, spec: spec[0] * 10000 + spec[1] * 100 + spec[2] };
}

const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'color', 'visibility', 'letter-spacing', 'dominant-baseline',
  'marker-start', 'marker-mid', 'marker-end']);
const PRESENTATION = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'color', 'display', 'visibility', 'letter-spacing', 'dominant-baseline',
  'alignment-baseline', 'marker-start', 'marker-mid', 'marker-end'];
const INITIAL = { fill: '#000000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1', opacity: '1', 'font-size': '16',
  'font-weight': '400', 'text-anchor': 'start', 'font-family': 'sans-serif', 'stroke-dasharray': 'none', display: 'inline', visibility: 'visible',
  'letter-spacing': 'normal' };
const SUPPORTED_PROPS = new Set([...PRESENTATION, 'font', 'stroke-dashoffset', 'animation', 'paint-order', 'shape-rendering', 'text-rendering', 'font-variant', 'white-space']);

/* Resolve every element's style for one theme. Sets el.cs = { prop: value } (custom
   properties included) and el.op = the element's opacity times its ancestors'. */
export function computeStyles(doc, theme) {
  const css = elements(doc.root).filter((e) => e.tag === 'style').map(textOf).join('\n');
  const parsed = parseBlocks(css);
  const rules = parsed.filter((r) => !r.at && mediaApplies(r.media, theme)).map((r, order) => ({ ...r, order, sel: compileSelector(r.selector) }));
  const unsupported = [...new Set(rules.filter((r) => !r.sel).map((r) => r.selector))];
  const unknownProps = [...new Set(rules.flatMap((r) => r.decls.map(([k]) => k)).filter((k) => !k.startsWith('--') && !SUPPORTED_PROPS.has(k)))];
  const visit = (el, parentCs, parentOp) => {
    if (el.tag[0] === '#') return;
    const cs = {};
    for (const [k, v] of Object.entries(parentCs)) if (k.startsWith('--') || INHERITED.has(k)) cs[k] = v;
    for (const p of PRESENTATION) if (el.attrs[p] != null) cs[p] = el.attrs[p];
    const matched = rules.filter((r) => r.sel && r.sel.test(el)).sort((a, b) => a.sel.spec - b.sel.spec || a.order - b.order);
    const inline = el.attrs.style ? splitDecls(el.attrs.style) : [];
    for (const r of matched) for (const [k, v, imp] of r.decls) if (!imp) cs[k] = v;
    for (const [k, v, imp] of inline) if (!imp) cs[k] = v;
    for (const r of matched) for (const [k, v, imp] of r.decls) if (imp) cs[k] = v;
    for (const [k, v, imp] of inline) if (imp) cs[k] = v;
    const resolveVar = (v, depth = 0) => (typeof v === 'string' && v.includes('var(') && depth < 8
      ? resolveVar(v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fb) => cs[name] ?? fb ?? ''), depth + 1) : v);
    for (const k of Object.keys(cs)) {
      cs[k] = resolveVar(cs[k]);
      if (cs[k] === 'inherit') cs[k] = parentCs[k] ?? INITIAL[k];
    }
    /* em sizes are relative to the parent's font size */
    const pfs = num(parentCs['font-size'], 16);
    if (typeof cs['font-size'] === 'string') {
      const fs = cs['font-size'].trim();
      if (/em$/.test(fs) && !/rem$/.test(fs)) cs['font-size'] = String(parseFloat(fs) * pfs);
      else if (/rem$/.test(fs)) cs['font-size'] = String(parseFloat(fs) * 16);
      else if (/%$/.test(fs)) cs['font-size'] = String((parseFloat(fs) / 100) * pfs);
      else if (/pt$/.test(fs)) cs['font-size'] = String(parseFloat(fs) * (4 / 3));
    }
    if (/^currentcolor$/i.test(cs.fill || '')) cs.fill = cs.color || '#000000';
    if (/^currentcolor$/i.test(cs.stroke || '')) cs.stroke = cs.color || '#000000';
    for (const [k, v] of Object.entries(INITIAL)) if (cs[k] == null) cs[k] = v;
    el.cs = cs;
    el.op = parentOp * num(cs.opacity, 1);
    el.hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || !!el.parent?.hidden;
    for (const c of el.children) visit(c, cs, el.op);
  };
  if (doc.svg) visit(doc.svg, {}, 1);
  return { unsupported, unknownProps };
}

/* ------------------------------------------------------------------ values */
const NAMED_HEX = 'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';
const NAMED = new Map(NAMED_HEX.split(',').map((p) => p.split(':')));
const hsl2rgb = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};
/* Returns {r,g,b,a}, null for none/transparent, undefined for a value it cannot read. */
export function color(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (NAMED.has(s)) return color(`#${NAMED.get(s)}`);
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const parts = (x) => x.split(/[\s,/]+/).filter(Boolean);
  const alpha = (x) => (x == null ? 1 : x.endsWith('%') ? parseFloat(x) / 100 : Number(x));
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a] = parts(m[1]);
    const c = (x) => (x.endsWith('%') ? (parseFloat(x) / 100) * 255 : Number(x));
    return { r: c(r), g: c(g), b: c(b), a: alpha(a) };
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const [h, sat, l, a] = parts(m[1]);
    const [r, g, b] = hsl2rgb(parseFloat(h), parseFloat(sat), parseFloat(l));
    return { r, g, b, a: alpha(a) };
  }
  return undefined;
}
export const hex = (c) => (c ? `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : 'none');
export const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
export const weight = (v) => (v === 'bold' || v === 'bolder' ? 700 : v === 'normal' || v === 'lighter' ? 400 : num(v, 400));

/* ------------------------------------------------------------------ text */
const isCJK = (cp) => (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3134f);
const isEmoji = (cp) => (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff);
const isZeroWidth = (cp) => (cp >= 0x300 && cp <= 0x36f) || cp === 0x200b || cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f);
/* the next measured size at or above `size`, so a size between two columns is never under-measured */
const sizeColumn = (size) => W.sizes.find((s) => s >= size - 1e-9) ?? W.sizes[W.sizes.length - 1];
export function textWidth(str, size, wt, letterSpacing = 0) {
  const col = (wt >= 600 ? W.bold : W.regular)[sizeColumn(size)];
  let em = 0, n = 0, prevEmoji = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (isZeroWidth(cp)) { if (cp === 0x200d) prevEmoji = 'joined'; continue; }
    const i = CHAR_INDEX.get(ch);
    if (isEmoji(cp)) { if (prevEmoji !== 'joined') { em += W.emoji / 1000; n++; } prevEmoji = true; continue; }
    prevEmoji = false;
    em += i != null ? col[i] / 1000 : isCJK(cp) ? W.cjk / 1000 : 1.0;   /* unknown script: a full em, never narrower */
    n++;
  }
  return em * size + n * letterSpacing;
}
const lsOf = (cs, size) => {
  const v = cs['letter-spacing'];
  if (!v || v === 'normal') return 0;
  return /em$/.test(v) ? parseFloat(v) * size : num(v, 0);
};
/* Lines of a <text>: one per tspan that sets x, y or dy, plus loose text. */
export function textLines(el) {
  const lines = [];
  let x = num(el.attrs.x), y = num(el.attrs.y), cur = null;
  const push = (node, s) => {
    if (!s) return;
    const cs = node.cs || el.cs;
    const size = num(cs['font-size'], 16), wt = weight(cs['font-weight']);
    if (!cur) { cur = { x, y, anchor: el.cs['text-anchor'], runs: [] }; lines.push(cur); }
    cur.runs.push({ s, size, wt, ls: lsOf(cs, size), hidden: !!node.hidden });
  };
  for (const c of el.children) {
    if (c.tag === '#text') { push(el, c.text.replace(/\s+/g, ' ')); continue; }
    if (c.tag !== 'tspan') continue;
    const a = c.attrs, size = num(c.cs?.['font-size'], 16);
    const em = (v) => (/em$/.test(v) ? parseFloat(v) * size : num(v));
    if (a.x != null || a.y != null || a.dy != null) {
      if (a.x != null) x = num(a.x);
      if (a.y != null) y = num(a.y);
      if (a.dy != null) y += em(a.dy);
      cur = null;
    }
    if (a.dx != null) x += em(a.dx);
    push(c, textOf(c).replace(/\s+/g, ' '));
  }
  for (const l of lines) {
    const first = l.runs.findIndex((r) => r.s.trim());
    if (first < 0) { l.runs = []; continue; }
    l.runs[first].s = l.runs[first].s.replace(/^\s+/, '');
    const last = l.runs.length - 1 - [...l.runs].reverse().findIndex((r) => r.s.trim());
    l.runs[last].s = l.runs[last].s.replace(/\s+$/, '');
  }
  return lines.filter((l) => l.runs.length);
}
export function textBox(el) {
  const boxes = textLines(el).map((l) => {
    const w = l.runs.reduce((s, r) => s + textWidth(r.s, r.size, r.wt, r.ls), 0);
    const size = Math.max(...l.runs.map((r) => r.size));
    const left = l.anchor === 'middle' ? l.x - w / 2 : l.anchor === 'end' ? l.x - w : l.x;
    const h = (ASCENT + DESCENT) * size;
    /* where y sits on the text: the alphabetic baseline unless dominant-baseline moves it */
    const db = el.cs['dominant-baseline'] || el.cs['alignment-baseline'] || 'auto';
    const top = /^(middle|central|mathematical)$/.test(db) ? l.y - h / 2
      : /^(hanging|text-before-edge|text-top)$/.test(db) ? l.y
        : /^(text-after-edge|text-bottom|ideographic)$/.test(db) ? l.y - h
          : l.y - ASCENT * size;
    return { x: left, y: top, w, h };
  });
  if (!boxes.length) return { x: num(el.attrs.x), y: num(el.attrs.y), w: 0, h: 0, r: num(el.attrs.x), b: num(el.attrs.y) };
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w)), b = Math.max(...boxes.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y, r, b };
}
/* the smallest font size used anywhere in a <text>, tspans included */
export const minFontSize = (el) => Math.min(...textLines(el).flatMap((l) => l.runs.map((r) => r.size)), num(el.cs['font-size'], 16));

/* ------------------------------------------------------------------ geometry */
export const rectBox = (el) => {
  const x = num(el.attrs.x), y = num(el.attrs.y), w = num(el.attrs.width), h = num(el.attrs.height);
  return { x, y, w, h, r: x + w, b: y + h };
};
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
      default: throw new Error(`path command "${cmd}" is not supported; draw arrows with M, L, H, V and Z`);
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
  const v = (svg?.attrs.viewBox || svg?.attrs.viewbox || '').split(/[\s,]+/).map(Number);
  return v.length === 4 && v.every(Number.isFinite) && v[2] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null;
};
