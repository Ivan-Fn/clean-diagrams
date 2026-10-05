#!/usr/bin/env node
/**
 * extract.mjs — print the structure of an existing diagram as a short outline, so it can
 * be redrawn in the clean-diagrams style.
 *
 *   node extract.mjs <file> [--page N]
 *
 * Reads .drawio / .drawio.xml / .xml (compressed or not), .drawio.svg and .drawio.png
 * (the diagram embedded by draw.io), and .excalidraw / .excalidraw.json. Mermaid needs no
 * extraction: read the source directly.
 *
 * Output: boxes with their labels and positions, containers and what they hold, arrows
 * with their labels and line style, and free text. Positions are the source's own, kept
 * so the redraw can respect the author's arrangement; they are not the new coordinates.
 * Uses only Node built-ins.
 */
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--page');
const pageArg = argv.includes('--page') ? Number(argv[argv.indexOf('--page') + 1]) : null;
if (!file || !existsSync(file)) {
  console.error('usage: node extract.mjs <file.drawio|.drawio.svg|.drawio.png|.excalidraw> [--page N]');
  process.exit(2);
}

const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const stripHtml = (s) => decodeEntities(String(s || '').replace(/<br\s*\/?>/gi, ' / ').replace(/<\/(div|p)>/gi, ' / ').replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ').replace(/^( \/ )+|( \/ )+$/g, '').replace(/(\s\/\s)+/g, ' / ').trim();
const r0 = (v) => Math.round(Number(v) || 0);
const attrs = (tag) => {
  const o = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = decodeEntities(m[2]);
  return o;
};
const styleOf = (s) => Object.fromEntries(String(s || '').split(';').filter(Boolean).map((kv) => {
  const i = kv.indexOf('=');
  return i < 0 ? [kv, true] : [kv.slice(0, i), kv.slice(i + 1)];
}));
const lines = [];
const out = (s = '') => lines.push(s);

/* ---------------- draw.io ---------------- */
const mxfileFromPng = (buf) => {
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const nul = data.indexOf(0), key = data.toString('latin1', 0, nul);
      let val;
      if (type === 'tEXt') val = data.toString('latin1', nul + 1);
      else if (type === 'zTXt') val = inflateSync(data.subarray(nul + 2)).toString('latin1');
      else {
        const flag = data[nul + 1];
        let p = nul + 3;
        p = data.indexOf(0, p) + 1; p = data.indexOf(0, p) + 1;
        val = flag ? inflateSync(data.subarray(p)).toString('utf8') : data.toString('utf8', p);
      }
      if (/mxfile|mxGraphModel/i.test(key) || /<mxfile|%3Cmxfile/i.test(val)) {
        try { val = decodeURIComponent(val); } catch { /* already plain */ }
        return val;
      }
    }
    i += 12 + len;
  }
  return null;
};
const diagramsFrom = (xml) => {
  const pages = [];
  for (const m of xml.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)) {
    const a = attrs(m[1]);
    let body = m[2].trim();
    if (!body.startsWith('<')) {
      /* compressed: base64 -> raw deflate -> URI-encoded XML */
      body = decodeURIComponent(inflateRawSync(Buffer.from(body, 'base64')).toString('latin1'));
    }
    pages.push({ name: a.name || `page ${pages.length + 1}`, xml: body });
  }
  if (!pages.length && /<mxGraphModel/.test(xml)) pages.push({ name: 'page 1', xml });
  return pages;
};
const drawio = (xml) => {
  const pages = diagramsFrom(xml);
  if (!pages.length) throw new Error('no draw.io diagram found in the file');
  if (pages.length > 1) out(`pages: ${pages.map((p, i) => `${i + 1}. ${p.name}`).join(' | ')}`);
  const pick = pageArg ? pages[pageArg - 1] : pages[0];
  if (!pick) throw new Error(`no page ${pageArg}`);
  out(`page: ${pick.name}${pages.length > 1 && !pageArg ? ' (use --page N for another)' : ''}`);

  const cells = [];
  for (const m of pick.xml.matchAll(/<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const a = attrs(m[1]);
    const geo = (m[3] || '').match(/<mxGeometry\b([^>]*)/);
    const g = geo ? attrs(geo[1]) : {};
    cells.push({ ...a, st: styleOf(a.style), geo: { x: r0(g.x), y: r0(g.y), w: r0(g.width), h: r0(g.height), rel: g.relative === '1' }, inner: m[3] || '' });
  }
  /* UserObject / object wrappers carry the label in their own attributes */
  for (const m of pick.xml.matchAll(/<(UserObject|object)\b([^>]*)>\s*<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const o = attrs(m[2]), a = attrs(m[3]);
    const c = cells.find((x) => x.parent === a.parent && x.style === a.style && !x.id);
    if (c) { c.id = o.id; c.value = o.label ?? c.value; }
  }
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = (c) => {
    let { x, y } = c.geo;
    for (let p = byId.get(c.parent); p && p.vertex === '1'; p = byId.get(p.parent)) { x += p.geo.x; y += p.geo.y; }
    return { x, y, w: c.geo.w, h: c.geo.h };
  };
  const vertices = cells.filter((c) => c.vertex === '1');
  const edges = cells.filter((c) => c.edge === '1');
  const isText = (c) => c.st.text === true || c.st.shape === 'text' || (c.st.strokeColor === 'none' && c.st.fillColor === 'none' && c.value);
  const isContainer = (c) => c.st.container === '1' || c.st.swimlane === true || c.st.shape === 'swimlane' || vertices.some((v) => v.parent === c.id)
    || c.st.group === true;
  const shapeName = (c) => c.st.shape || Object.keys(c.st).find((k) => c.st[k] === true && !['html', 'rounded', 'whiteSpace', 'text', 'container', 'group'].includes(k)) || (c.st.rounded === '1' ? 'rounded rect' : 'rect');
  const colours = (c) => [c.st.fillColor && c.st.fillColor !== 'none' ? `fill ${c.st.fillColor}` : '', c.st.strokeColor && c.st.strokeColor !== 'none' ? `stroke ${c.st.strokeColor}` : '', c.st.dashed === '1' ? 'dashed' : ''].filter(Boolean).join(', ');
  const name = (c) => stripHtml(c.value) || '(no label)';
  const groups = vertices.filter((c) => isContainer(c) && !isText(c));
  const boxes = vertices.filter((c) => !isContainer(c) && !isText(c));
  const texts = vertices.filter(isText);
  const inside = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;

  out(`boxes: ${boxes.length} · containers: ${groups.length} · arrows: ${edges.length} · free text: ${texts.length}`);
  if (groups.length) out('\ncontainers:');
  for (const gc of groups) {
    const ga = abs(gc);
    const members = boxes.filter((b) => b.parent === gc.id || inside(ga, abs(b))).map((b) => b.id);
    out(`  ${gc.id}  "${name(gc)}"  at ${ga.x},${ga.y} ${ga.w}x${ga.h}${colours(gc) ? `  (${colours(gc)})` : ''}${members.length ? `  holds: ${members.join(', ')}` : ''}`);
  }
  out('\nboxes:');
  for (const b of [...boxes].sort((p, q) => abs(p).y - abs(q).y || abs(p).x - abs(q).x)) {
    const a = abs(b);
    out(`  ${b.id}  "${name(b)}"  at ${a.x},${a.y} ${a.w}x${a.h}  ${shapeName(b)}${colours(b) ? `, ${colours(b)}` : ''}`);
  }
  if (edges.length) out('\narrows:');
  const edgeLabels = new Map();
  for (const t of vertices.filter((v) => byId.get(v.parent)?.edge === '1')) {
    edgeLabels.set(t.parent, [edgeLabels.get(t.parent), name(t)].filter(Boolean).join(' / '));
  }
  for (const e of edges) {
    const label = [stripHtml(e.value), edgeLabels.get(e.id)].filter(Boolean).join(' / ');
    const heads = `${e.st.startArrow && e.st.startArrow !== 'none' ? '<' : ''}-${e.st.endArrow === 'none' ? '-' : '>'}`;
    out(`  ${e.source || '(loose)'} ${heads} ${e.target || '(loose)'}${label ? `  "${label}"` : ''}${e.st.dashed === '1' ? '  dashed' : ''}${e.st.strokeColor && e.st.strokeColor !== 'none' ? `  ${e.st.strokeColor}` : ''}`);
  }
  const loose = texts.filter((t) => byId.get(t.parent)?.edge !== '1');
  if (loose.length) out('\nfree text:');
  for (const t of loose) { const a = abs(t); out(`  "${name(t)}"  at ${a.x},${a.y}`); }
};

/* ---------------- Excalidraw ---------------- */
const excalidraw = (json) => {
  const doc = JSON.parse(json);
  const els = (doc.elements || []).filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  const textOf = (e) => (e.boundElements || []).map((b) => byId.get(b.id)).filter((t) => t && t.type === 'text').map((t) => (t.originalText || t.text || '').replace(/\s*\n\s*/g, ' / ')).join(' / ');
  const shapes = els.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type));
  const frames = els.filter((e) => e.type === 'frame' || e.type === 'magicframe');
  const arrows = els.filter((e) => e.type === 'arrow' || (e.type === 'line' && (e.startBinding || e.endBinding)));
  const texts = els.filter((e) => e.type === 'text' && !e.containerId);
  const box = (e) => `at ${r0(e.x)},${r0(e.y)} ${r0(e.width)}x${r0(e.height)}`;
  const inside = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.width <= o.x + o.width && i.y + i.height <= o.y + o.height;
  /* a big shape holding other shapes is a container */
  const containers = shapes.filter((s) => shapes.some((o) => o !== s && inside(s, o)));
  const plain = shapes.filter((s) => !containers.includes(s));
  out(`boxes: ${plain.length} · containers: ${containers.length + frames.length} · arrows: ${arrows.length} · free text: ${texts.length}`);
  if (frames.length || containers.length) out('\ncontainers:');
  for (const f of [...frames, ...containers]) {
    const members = plain.filter((s) => s.frameId === f.id || inside(f, s)).map((s) => s.id);
    out(`  ${f.id}  "${f.name || textOf(f) || '(no label)'}"  ${box(f)}${members.length ? `  holds: ${members.join(', ')}` : ''}`);
  }
  out('\nboxes:');
  for (const s of [...plain].sort((p, q) => p.y - q.y || p.x - q.x)) {
    const style = [s.type, s.backgroundColor && s.backgroundColor !== 'transparent' ? `fill ${s.backgroundColor}` : '', s.strokeColor ? `stroke ${s.strokeColor}` : '', s.strokeStyle && s.strokeStyle !== 'solid' ? s.strokeStyle : ''].filter(Boolean).join(', ');
    out(`  ${s.id}  "${textOf(s) || '(no label)'}"  ${box(s)}  ${style}`);
  }
  /* a text near an unlabelled shape is probably its label; say so rather than guess silently */
  if (arrows.length) out('\narrows:');
  for (const a of arrows) {
    const from = a.startBinding?.elementId || '(loose)', to = a.endBinding?.elementId || '(loose)';
    const heads = `${a.startArrowhead ? '<' : ''}-${a.endArrowhead === null ? '-' : '>'}`;
    out(`  ${from} ${heads} ${to}${textOf(a) ? `  "${textOf(a)}"` : ''}${a.strokeStyle && a.strokeStyle !== 'solid' ? `  ${a.strokeStyle}` : ''}${a.strokeColor && a.strokeColor !== '#1e1e1e' ? `  ${a.strokeColor}` : ''}`);
  }
  if (texts.length) out('\nfree text (may be a label for a nearby shape or arrow):');
  for (const t of texts) out(`  "${(t.originalText || t.text || '').replace(/\s*\n\s*/g, ' / ')}"  at ${r0(t.x)},${r0(t.y)}`);
};

/* ---------------- dispatch ---------------- */
const name = basename(file).toLowerCase();
const buf = readFileSync(file);
out(`source: ${basename(file)}`);
try {
  if (name.endsWith('.png')) {
    const xml = mxfileFromPng(buf);
    if (!xml) throw new Error('this PNG carries no draw.io diagram (it was exported without "include a copy of my diagram")');
    drawio(xml);
  } else if (name.endsWith('.svg')) {
    const text = buf.toString('utf8');
    const m = text.match(/\scontent="([^"]*)"/);
    if (!m) throw new Error('this SVG carries no draw.io diagram (no content attribute)');
    let xml = decodeEntities(m[1]);
    if (!xml.trim().startsWith('<')) { try { xml = decodeURIComponent(xml); } catch { /* keep */ } }
    drawio(xml);
  } else if (name.endsWith('.excalidraw') || name.endsWith('.excalidraw.json') || buf.toString('utf8', 0, 200).includes('"excalidraw"')) {
    excalidraw(buf.toString('utf8'));
  } else {
    drawio(buf.toString('utf8'));
  }
} catch (e) {
  console.error(`extract: ${e.message}`);
  process.exit(1);
}
console.log(lines.join('\n'));
