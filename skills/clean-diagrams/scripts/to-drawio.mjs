#!/usr/bin/env node
/**
 * to-drawio.mjs — convert a checked clean-diagrams SVG into an editable draw.io file.
 *
 *   node to-drawio.mjs <diagram.svg> [out.drawio] [--export] [--plain-labels]
 *
 * Writes uncompressed .drawio XML: one vertex per box and container, one edge per arrow
 * (connected to its boxes, routed through the same corners), arrow labels attached to the
 * nearest arrow, and every colour as a light-dark() pair so the file follows draw.io's
 * dark mode. Nothing here needs draw.io installed.
 *
 *   --export        also run the draw.io desktop app, if installed, to write
 *                   <name>.drawio.svg (a picture that GitHub shows and draw.io reopens)
 *                   and <name>.drawio.png (same, as PNG at 2x)
 *   --plain-labels  write plain-text labels (html=0). draw.io then exports real SVG text
 *                   instead of HTML inside the SVG, which some non-browser tools need, but
 *                   a box's name and note share one font size.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, requireFile } from './lib/args.mjs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { parse, computeStyles, elements, hasClass, closest, textOf, inDefs, color, hex, num, weight, rectBox, textBox, pathPoints, polyLength, pointAt, viewBox } from './lib/svgdom.mjs';

const USAGE = 'node to-drawio.mjs <diagram.svg> [out.drawio] [--export] [--plain-labels]';
const args = parseArgs(process.argv.slice(2), { flags: ['--export', '--plain-labels'], usage: USAGE, maxPositional: 2 });
requireFile(args.positional[0], USAGE);
const SVG = resolve(args.positional[0]);
const OUT = resolve(args.positional[1] || join(dirname(SVG), `${basename(SVG, '.svg')}.drawio`));
const PLAIN = args.flags.has('--plain-labels');
const SRC = readFileSync(SVG, 'utf8');
{
  const d = parse(SRC);
  if (!d.svg || !viewBox(d.svg)) { console.error(`to-drawio: ${SVG} is not an SVG with a viewBox; run check.mjs first`); process.exit(1); }
  if (d.errors.length) { console.error(`to-drawio: ${SVG} is not well-formed XML (${d.errors[0]}); run check.mjs first`); process.exit(1); }
}
mkdirSync(dirname(OUT), { recursive: true });

/* Read the diagram for one theme without a browser: geometry from the attributes, colours
   from the file's own stylesheet, text extents from the measured width table. */
const read = (theme) => {
  const doc = parse(SRC);
  computeStyles(doc, theme);
  const vb = viewBox(doc.svg);
  const all = elements(doc.svg).filter((e) => !inDefs(e));
  const isShape = (e) => e.tag === 'g' && (hasClass(e, 'node') || hasClass(e, 'group'));
  const toHex = (v) => { const c = color(v); return c && c.a > 0 ? hex(c) : 'none'; };
  const bb = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
  const paint = (el) => ({ fill: toHex(el.cs.fill), stroke: toHex(el.cs.stroke), sw: num(el.cs['stroke-width'], 1),
    dash: el.cs['stroke-dasharray'] && el.cs['stroke-dasharray'] !== 'none' ? el.cs['stroke-dasharray'].replace(/px/g, '').replace(/,\s*/g, ' ').trim() : '' });
  const txt = (t) => ({ s: textOf(t).trim().replace(/\s+/g, ' '), size: num(t.cs['font-size'], 16), weight: weight(t.cs['font-weight']),
    color: toHex(t.cs.fill), anchor: t.cs['text-anchor'], box: bb(textBox(t)), x: num(t.attrs.x), y: num(t.attrs.y), cls: t.attrs.class || '' });
  for (const g of all.filter(isShape)) if (!g.attrs.id || !g.children.some((c) => c.tag === 'rect')) console.error(`to-drawio: skipped a ${hasClass(g, 'node') ? 'box' : 'container'} ${g.attrs.id ? `#${g.attrs.id}` : 'without an id'}: it needs an id and a <rect>. Run check.mjs first.`);
  let shapes = all.filter(isShape).filter((g) => g.attrs.id && g.children.some((c) => c.tag === 'rect')).map((g) => {
    const rect = g.children.find((c) => c.tag === 'rect');
    return { id: g.attrs.id, kind: hasClass(g, 'node') ? 'node' : 'group', rect: bb(rectBox(rect)), rx: num(rect.attrs.rx),
      paint: paint(rect), texts: elements(g).filter((e) => e.tag === 'text' && textOf(e).trim()).map(txt) };
  });
  /* lifelines: a vertical dashed line under a party's box */
  const lifelines = [];
  for (const g of all.filter((e) => e.tag === 'g' && hasClass(e, 'lifeline') && e.attrs.id)) {
    const line = g.children.find((c) => c.tag === 'path' || c.tag === 'line');
    if (!line) continue;
    const pts = line.tag === 'line' ? [{ x: num(line.attrs.x1), y: num(line.attrs.y1) }, { x: num(line.attrs.x2), y: num(line.attrs.y2) }] : pathPoints(line.attrs.d || '');
    const ys = pts.map((q) => q.y);
    lifelines.push({ id: g.attrs.id, x: pts[0].x, y0: Math.min(...ys), y1: Math.max(...ys), paint: paint(line) });
  }
  const edges = all.filter((e) => e.tag === 'path' && hasClass(e, 'edge')).map((p, i) => {
    let pts;
    try { pts = pathPoints(p.attrs.d || ''); } catch (err) { throw new Error(`arrow ${p.attrs.id || i + 1}: ${err.message}. Run check.mjs first.`); }
    const len = polyLength(pts), n = Math.min(4000, Math.max(2, Math.ceil(len / 4)));
    return { id: p.attrs.id || `edge-${i + 1}`, from: p.attrs['data-from'], to: p.attrs['data-to'], d: p.attrs.d, paint: paint(p), mid: pointAt(pts, len / 2),
      head: !!(p.attrs['marker-end'] || (p.cs['marker-end'] && p.cs['marker-end'] !== 'none')), samples: Array.from({ length: n }, (_, i) => pointAt(pts, (len * i) / (n - 1))) };
  });
  const free = all.filter((t) => t.tag === 'text' && textOf(t).trim() && !closest(t, isShape)).map(txt);
  const loose = all.filter((r) => r.tag === 'rect' && !closest(r, isShape) && !hasClass(r, 'bg')).map((r) => ({ rect: bb(rectBox(r)), rx: num(r.attrs.rx), paint: paint(r) }));
  const title = all.find((e) => e.tag === 'text' && hasClass(e, 'title'));
  /* icons: the symbol's drawing plus the colour the <use> resolves to in this theme */
  const symbolOf = new Map(elements(doc.svg).filter((e) => e.tag === 'symbol' && e.attrs.id).map((e) => [e.attrs.id, e]));
  const ser = (el) => `<${el.tag}${Object.entries(el.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')}${el.children.filter((c) => c.tag[0] !== '#').length ? `>${el.children.filter((c) => c.tag[0] !== '#').map(ser).join('')}</${el.tag}>` : '/>'}`;
  const icons = all.filter((e) => e.tag === 'use' && hasClass(e, 'icon')).map((u) => {
    const href = (u.attrs.href || u.attrs['xlink:href'] || '').replace(/^#/, '');
    const sym = symbolOf.get(href);
    const owner = closest(u, isShape);
    return sym ? { href, body: sym.children.filter((c) => c.tag[0] !== '#').map(ser).join(''), viewBox: sym.attrs.viewBox || '0 0 24 24',
      color: toHex(u.cs.color), owner: owner?.attrs.id ?? null, box: { x: num(u.attrs.x), y: num(u.attrs.y), w: num(u.attrs.width), h: num(u.attrs.height) } } : null;
  }).filter(Boolean);
  return { W: vb.w, H: vb.h, shapes, edges, free, loose, lifelines, icons, title: title ? textOf(title).trim() : '' };
};
let model;
try { model = { light: read('light'), dark: read('dark') }; } catch (e) { console.error(`to-drawio: ${e.message}`); process.exit(1); }
const L = model.light, D = model.dark;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pair = (a, b) => (a === 'none' && b === 'none' ? 'none' : a === b ? a : `light-dark(${a},${b})`);
const n = (v) => Math.round(v * 100) / 100;
const style = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(';') + ';';
const cells = [];
let auto = 0;
const uid = (base) => `${base || 'cell'}-${++auto}`;

/* boxes and containers; containers first so they sit underneath */
const shapeIds = new Set(L.shapes.map((s) => s.id));
const ordered = [...L.shapes].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'group' ? -1 : 1));
/* A box drawn inside a container becomes its child in draw.io, so moving the container
   moves its boxes. The smallest enclosing container wins. */
const holds = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
const parentOf = new Map();
for (const s of L.shapes.filter((x) => x.kind === 'node')) {
  const g = L.shapes.filter((x) => x.kind === 'group' && holds(x.rect, s.rect)).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
  if (g) parentOf.set(s.id, g);
}
for (const s of ordered) {
  const d = D.shapes.find((x) => x.id === s.id);
  const p = s.paint, q = d.paint;
  const st = {
    rounded: s.rx ? 1 : 0, absoluteArcSize: 1, arcSize: n(s.rx * 2),
    fillColor: pair(p.fill, q.fill), strokeColor: pair(p.stroke, q.stroke), strokeWidth: n(p.sw),
    dashed: p.dash ? 1 : undefined, dashPattern: p.dash || undefined,
    html: PLAIN ? 0 : 1, whiteSpace: PLAIN ? undefined : 'wrap',
    container: s.kind === 'group' ? 1 : undefined, collapsible: s.kind === 'group' ? 0 : undefined,
  };
  let value = '';
  const tl = s.texts, td = d.texts;
  if (tl.length) {
    const first = tl[0], firstD = td[0];
    /* text written left-aligned (beside an icon) stays left-aligned at the same inset */
    if (s.kind !== 'group' && first.anchor === 'start') { st.align = 'left'; st.spacingLeft = n(first.x - s.rect.x - 2); }
    st.fontColor = pair(first.color, firstD.color);
    st.fontSize = n(first.size);
    st.fontStyle = first.weight >= 600 ? 1 : 0;
    st.fontFamily = 'Helvetica';
    if (s.kind === 'group') {
      st.verticalAlign = 'top';
      st.align = first.anchor === 'middle' ? 'center' : first.anchor === 'end' ? 'right' : 'left';
      st.spacingTop = n(first.box.y - s.rect.y - 4);
      if (st.align === 'left') st.spacingLeft = n(first.box.x - s.rect.x - 2);
      value = PLAIN ? tl.map((t) => t.s).join('\n') : [html(first.s), ...tl.slice(1).map((t) => `<span style="font-weight:normal;opacity:0.75">${html(t.s)}</span>`)].join('<br>');
    } else if (PLAIN) {
      value = tl.map((t) => t.s).join('\n');
    } else {
      /* name in its own size and weight; the quieter lines at the cell's colour, faded,
         so they follow draw.io's dark mode without a second colour */
      const rest = tl.slice(1);
      if (rest.length) {
        st.fontSize = n(rest[0].size);
        st.fontStyle = 0;
        value = `<span style="font-size:${n(first.size)}px;${first.weight >= 600 ? 'font-weight:bold;' : ''}">${html(first.s)}</span>`
          + rest.map((t) => `<br><span style="opacity:0.75">${html(t.s)}</span>`).join('');
      } else {
        value = html(first.s);
      }
    }
  }
  const host = parentOf.get(s.id);
  const gx = host ? host.rect.x : 0, gy = host ? host.rect.y : 0;
  cells.push(`<mxCell id="${esc(s.id)}" value="${esc(value)}" style="${esc(style(st))}" vertex="1" parent="${host ? esc(host.id) : '1'}"><mxGeometry x="${n(s.rect.x - gx)}" y="${n(s.rect.y - gy)}" width="${n(s.rect.w)}" height="${n(s.rect.h)}" as="geometry"/></mxCell>`);
}

/* loose painted rectangles (legend swatches and the like) */
L.loose.forEach((r, i) => {
  const q = D.loose[i].paint, p = r.paint;
  cells.push(`<mxCell id="${uid('shape')}" value="" style="${esc(style({ rounded: r.rx ? 1 : 0, absoluteArcSize: 1, arcSize: n(r.rx * 2), fillColor: pair(p.fill, q.fill), strokeColor: pair(p.stroke, q.stroke), strokeWidth: n(p.sw) }))}" vertex="1" parent="1"><mxGeometry x="${n(r.rect.x)}" y="${n(r.rect.y)}" width="${n(r.rect.w)}" height="${n(r.rect.h)}" as="geometry"/></mxCell>`);
});

/* Free text: attach to the nearest arrow when it sits beside one, so it moves with it. */
/* distance from the label's bounding box (not its centre: a right-aligned label's centre
   sits far from the line it labels) to the nearest point on the arrow */
const dist = (b, samples) => Math.min(...samples.map((s) => Math.hypot(Math.max(b.x - s.x, 0, s.x - (b.x + b.w)), Math.max(b.y - s.y, 0, s.y - (b.y + b.h)))));
const attached = new Map();
const standalone = [];
L.free.forEach((t, i) => {
  const td = D.free[i];
  let best = null;
  if (!t.cls.includes('title')) {
    for (const e of L.edges) {
      const dd = dist(t.box, e.samples);
      if (dd <= 16 && (!best || dd < best.dd)) best = { e, dd };
    }
  }
  if (best) {
    if (!attached.has(best.e.id)) attached.set(best.e.id, []);
    attached.get(best.e.id).push({ t, td });
  } else standalone.push({ t, td });
});
/* A second line of a label (directly above or below an attached line, overlapping it
   horizontally) belongs to the same arrow, even when it sits further from the line. */
for (let changed = true; changed;) {
  changed = false;
  for (let i = standalone.length - 1; i >= 0; i--) {
    const { t } = standalone[i];
    if (t.cls.includes('title')) continue;
    for (const [eid, list] of attached) {
      const near = list.some(({ t: a }) => Math.abs((a.box.y + a.box.h / 2) - (t.box.y + t.box.h / 2)) <= Math.max(a.box.h, t.box.h) * 1.4
        && Math.min(a.box.x + a.box.w, t.box.x + t.box.w) - Math.max(a.box.x, t.box.x) >= 0.4 * Math.min(a.box.w, t.box.w));
      if (near) { list.push(standalone[i]); standalone.splice(i, 1); changed = true; break; }
    }
  }
}

/* edges */
const rectOf = (id) => L.shapes.find((s) => s.id === id)?.rect;
/* Icons become image cells inside their box, so they move with it. draw.io cannot switch an
   image's colour with its dark mode, so each icon keeps its light-theme colour when that
   already has 3:1 contrast on a dark page, and otherwise moves toward its dark-theme colour
   just far enough. Grey icons come out #6c6b66, the darkest grey that does. */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lumi = (h) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgb(h); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lumi(a), lumi(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b) => {
  if (a === 'none' || b === 'none') return a === 'none' ? b : a;
  const [x, y] = [rgb(a), rgb(b)];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
    if (ratio(c, '#121212') >= 3 && ratio(c, '#ffffff') >= 3) return c;
  }
  return b;
};
L.icons.forEach((ic, k) => {
  const dc = D.icons[k] ? D.icons[k].color : ic.color;
  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ic.viewBox}" fill="none" stroke="${mix(ic.color, dc)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.body}</svg>`;
  const host = ic.owner && L.shapes.find((s) => s.id === ic.owner);
  const hx = host ? host.rect.x : 0, hy = host ? host.rect.y : 0;
  const st = `shape=image;html=1;imageAspect=0;aspect=fixed;image=data:image/svg+xml,${Buffer.from(svgIcon).toString('base64')};`;
  cells.push(`<mxCell id="${uid(ic.href)}" value="" style="${esc(st)}" vertex="1" parent="${host ? esc(host.id) : '1'}"><mxGeometry x="${n(ic.box.x - hx)}" y="${n(ic.box.y - hy)}" width="${n(ic.box.w)}" height="${n(ic.box.h)}" as="geometry"/></mxCell>`);
});

/* A lifeline is drawn in draw.io as a dashed line that starts on the bottom of the box above
   it (so it moves with that box) and ends at a free point. Messages between lifelines are
   free arrows at their exact positions: draw.io would re-route arrows attached to a line. */
const lifelineIds = new Set(L.lifelines.map((l) => l.id));
for (const l of L.lifelines) {
  const ld = D.lifelines.find((x) => x.id === l.id) || l;
  const owner = L.shapes.find((s) => s.kind === 'node' && l.x > s.rect.x && l.x < s.rect.x + s.rect.w && Math.abs(s.rect.y + s.rect.h - l.y0) <= 3);
  const st = { edgeStyle: 'none', html: 1, endArrow: 'none', startArrow: 'none', strokeColor: pair(l.paint.stroke, ld.paint.stroke), strokeWidth: n(l.paint.sw),
    dashed: l.paint.dash ? 1 : undefined, dashPattern: l.paint.dash || undefined,
    exitX: owner ? n((l.x - owner.rect.x) / owner.rect.w) : undefined, exitY: owner ? 1 : undefined, exitDx: 0, exitDy: 0, exitPerimeter: 0 };
  cells.push(`<mxCell id="${esc(l.id)}" value="" style="${esc(style(st))}" edge="1" parent="1"${owner ? ` source="${esc(owner.id)}"` : ''}><mxGeometry relative="1" as="geometry"><mxPoint x="${n(l.x)}" y="${n(l.y0)}" as="sourcePoint"/><mxPoint x="${n(l.x)}" y="${n(l.y1)}" as="targetPoint"/></mxGeometry></mxCell>`);
}
for (const e of L.edges) {
  const ed = D.edges.find((x) => x.id === e.id) || e;
  if (lifelineIds.has(e.from) || lifelineIds.has(e.to)) { e.free = true; }
  const pts = pathPoints(e.d);
  const a = pts[0], b = pts[pts.length - 1];
  const rs = rectOf(e.from), rt = rectOf(e.to);
  const rel = (pt, r) => ({ x: r.w ? n(Math.min(1, Math.max(0, (pt.x - r.x) / r.w))) : 0.5, y: r.h ? n(Math.min(1, Math.max(0, (pt.y - r.y) / r.h))) : 0.5 });
  const ex = rs ? rel(a, rs) : null, en = rt ? rel(b, rt) : null;
  const p = e.paint, q = ed.paint;
  const st = {
    edgeStyle: 'orthogonalEdgeStyle', rounded: 0, orthogonalLoop: 1, jettySize: 'auto', html: PLAIN ? 0 : 1,
    strokeColor: pair(p.stroke, q.stroke), strokeWidth: n(p.sw), dashed: p.dash ? 1 : undefined, dashPattern: p.dash || undefined,
    endArrow: e.head ? 'block' : 'none', endFill: 1, endSize: 6, startArrow: 'none',
    exitX: ex?.x, exitY: ex?.y, exitDx: 0, exitDy: 0, exitPerimeter: 0,
    entryX: en?.x, entryY: en?.y, entryDx: 0, entryDy: 0, entryPerimeter: 0,
  };
  let value = '';
  let offset = '';
  const labels = attached.get(e.id);
  if (labels) {
    labels.sort((u, v) => u.t.box.y - v.t.box.y);
    const first = labels[0].t;
    const u = labels.reduce((acc, { t }) => ({ x: Math.min(acc.x, t.box.x), y: Math.min(acc.y, t.box.y), r: Math.max(acc.r, t.box.x + t.box.w), b: Math.max(acc.b, t.box.y + t.box.h) }), { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity });
    st.fontColor = pair(first.color, labels[0].td.color);
    st.fontSize = n(first.size);
    st.fontFamily = 'Helvetica';
    st.labelBackgroundColor = 'none';
    st.align = 'center';                    /* the offset below already places the label's centre */
    value = PLAIN ? labels.map(({ t }) => t.s).join('\n')
      : labels.map(({ t }) => (t.weight >= 600 ? `<b>${html(t.s)}</b>` : html(t.s))).join('<br>');
    if (PLAIN && first.weight >= 600) st.fontStyle = 1;
    offset = `<mxPoint x="${n((u.x + u.r) / 2 - e.mid.x)}" y="${n((u.y + u.b) / 2 - e.mid.y)}" as="offset"/>`;
  }
  const way = pts.slice(1, -1).map((pt) => `<mxPoint x="${n(pt.x)}" y="${n(pt.y)}"/>`).join('');
  if (e.free) { delete st.exitX; delete st.exitY; delete st.entryX; delete st.entryY; st.edgeStyle = 'none'; }
  const src = !e.free && shapeIds.has(e.from) ? ` source="${esc(e.from)}"` : '';
  const tgt = !e.free && shapeIds.has(e.to) ? ` target="${esc(e.to)}"` : '';
  cells.push(`<mxCell id="${esc(e.id || uid('edge'))}" value="${esc(value)}" style="${esc(style(st))}" edge="1" parent="1"${src}${tgt}><mxGeometry relative="1" as="geometry"><mxPoint x="${n(a.x)}" y="${n(a.y)}" as="sourcePoint"/><mxPoint x="${n(b.x)}" y="${n(b.y)}" as="targetPoint"/>${way ? `<Array as="points">${way}</Array>` : ''}${offset}</mxGeometry></mxCell>`);
}

/* remaining free text: title, legend entries, notes */
for (const { t, td } of standalone) {
  const st = { text: undefined, html: PLAIN ? 0 : 1, align: t.anchor === 'end' ? 'right' : t.anchor === 'middle' ? 'center' : 'left',
    verticalAlign: 'middle', fontSize: n(t.size), fontStyle: t.weight >= 600 ? 1 : 0, fontColor: pair(t.color, td.color),
    fontFamily: 'Helvetica', strokeColor: 'none', fillColor: 'none', spacing: 0 };
  cells.push(`<mxCell id="${uid('text')}" value="${esc(PLAIN ? t.s : html(t.s))}" style="text;${esc(style(st))}" vertex="1" parent="1"><mxGeometry x="${n(t.box.x - 2)}" y="${n(t.box.y)}" width="${n(t.box.w + 4)}" height="${n(t.box.h)}" as="geometry"/></mxCell>`);
}

const name = esc(L.title || basename(SVG, '.svg'));
const xml = `<mxfile host="clean-diagrams" type="device">
  <diagram id="${esc(basename(SVG, '.svg'))}" name="${name}">
    <mxGraphModel grid="1" gridSize="8" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${L.W}" pageHeight="${L.H}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
writeFileSync(OUT, xml);
console.log(OUT);

if (args.flags.has('--export')) {
  const candidates = [process.env.DRAWIO_BIN, '/Applications/draw.io.app/Contents/MacOS/draw.io', 'drawio', 'draw.io'].filter(Boolean);
  const bin = candidates.find((c) => spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 30000 }).status === 0);
  if (!bin) {
    console.error('draw.io desktop not found; the .drawio file is written, but no .drawio.svg/.drawio.png. Install draw.io or set DRAWIO_BIN.');
    process.exit(3);
  }
  const base = OUT.replace(/\.drawio$/, '');
  for (const [fmt, extra] of [['svg', []], ['png', ['-s', '2']]]) {
    const out = `${base}.drawio.${fmt}`;
    const r = spawnSync(bin, ['-x', '-f', fmt, '-e', '-b', '16', ...extra, '-o', out, OUT], { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) { console.error(`draw.io export to ${fmt} failed:\n${r.stderr || r.stdout}`); process.exit(1); }
    console.log(out);
  }
}
