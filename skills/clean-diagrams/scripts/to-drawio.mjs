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
import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
if (!pos[0] || !existsSync(pos[0])) {
  console.error('usage: node to-drawio.mjs <diagram.svg> [out.drawio] [--export] [--plain-labels]');
  process.exit(2);
}
const SVG = resolve(pos[0]);
const OUT = resolve(pos[1] || join(dirname(SVG), `${basename(SVG, '.svg')}.drawio`));
const PLAIN = argv.includes('--plain-labels');

/* Runs in the page, once per theme. Colours come back resolved for that theme. */
const READ = () => {
  const svg = document.documentElement;
  const vb = svg.viewBox.baseVal;
  const hex = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 'none';
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (a === 0) return 'none';
    return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  };
  const bb = (el) => { const b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const paint = (el) => {
    const cs = getComputedStyle(el);
    return { fill: hex(cs.fill), stroke: cs.stroke === 'none' ? 'none' : hex(cs.stroke), sw: parseFloat(cs.strokeWidth) || 0,
      dash: cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray.replace(/px/g, '').replace(/,\s*/g, ' ') : '' };
  };
  const txt = (t) => {
    const cs = getComputedStyle(t);
    return { s: t.textContent.trim().replace(/\s+/g, ' '), size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10),
      color: hex(cs.fill), anchor: cs.textAnchor, box: bb(t), x: t.x.baseVal[0]?.value ?? 0, y: t.y.baseVal[0]?.value ?? 0,
      cls: t.getAttribute('class') || '' };
  };
  const shapes = [...svg.querySelectorAll('g.node, g.group')].map((g) => {
    const rect = g.querySelector(':scope > rect');
    return { id: g.id, kind: g.classList.contains('node') ? 'node' : 'group', rect: bb(rect), rx: Number(rect.getAttribute('rx') || 0),
      paint: paint(rect), texts: [...g.querySelectorAll('text')].map(txt) };
  });
  const owned = new Set([...svg.querySelectorAll('g.node text, g.group text')]);
  const edges = [...svg.querySelectorAll('path.edge')].map((p) => {
    const len = p.getTotalLength(), mid = p.getPointAtLength(len / 2);
    return { id: p.id, from: p.dataset.from, to: p.dataset.to, d: p.getAttribute('d'), paint: paint(p), mid: { x: mid.x, y: mid.y },
      head: !!p.getAttribute('marker-end'), samples: Array.from({ length: Math.max(2, Math.ceil(len / 4)) }, (_, i) => { const q = p.getPointAtLength((len * i) / Math.max(1, Math.ceil(len / 4) - 1)); return { x: q.x, y: q.y }; }) };
  });
  const free = [...svg.querySelectorAll('text')].filter((t) => !owned.has(t) && !t.closest('defs, marker') && t.textContent.trim()).map(txt);
  const loose = [...svg.querySelectorAll('rect')].filter((r) => !r.closest('g.node, g.group, defs, marker') && !r.classList.contains('bg'))
    .map((r) => ({ rect: bb(r), rx: Number(r.getAttribute('rx') || 0), paint: paint(r) }));
  const title = svg.querySelector('text.title');
  return { W: vb.width, H: vb.height, shapes, edges, free, loose, title: title ? title.textContent.trim() : '' };
};

const browser = await chromium.launch();
const model = {};
try {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: theme });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(SVG).href);
    model[theme] = await page.evaluate(READ);
    await ctx.close();
  }
} finally {
  await browser.close();
}
const L = model.light, D = model.dark;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    st.fontColor = pair(first.color, firstD.color);
    st.fontSize = n(first.size);
    st.fontStyle = first.weight >= 600 ? 1 : 0;
    st.fontFamily = 'Helvetica';
    if (s.kind === 'group') {
      st.verticalAlign = 'top';
      st.align = first.anchor === 'middle' ? 'center' : first.anchor === 'end' ? 'right' : 'left';
      st.spacingTop = n(first.box.y - s.rect.y - 2);
      if (st.align === 'left') st.spacingLeft = n(first.box.x - s.rect.x - 2);
      value = first.s;
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

/* edges */
const pathPoints = (d) => {
  const toks = d.match(/[MLHVmlhv]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const pts = [];
  let cmd = null, x = 0, y = 0;
  for (let i = 0; i < toks.length;) {
    if (/[MLHVmlhv]/.test(toks[i])) cmd = toks[i++];
    const num = () => Number(toks[i++]);
    switch (cmd) {
      case 'M': case 'L': x = num(); y = num(); break;
      case 'm': case 'l': x += num(); y += num(); break;
      case 'H': x = num(); break;
      case 'h': x += num(); break;
      case 'V': y = num(); break;
      case 'v': y += num(); break;
      default: throw new Error(`unsupported path command "${cmd}" in "${d}" — use M, L, H and V only`);
    }
    pts.push({ x, y });
  }
  return pts;
};
const rectOf = (id) => L.shapes.find((s) => s.id === id)?.rect;
for (const e of L.edges) {
  const ed = D.edges.find((x) => x.id === e.id) || e;
  const pts = pathPoints(e.d);
  const a = pts[0], b = pts[pts.length - 1];
  const rs = rectOf(e.from), rt = rectOf(e.to);
  const rel = (pt, r) => ({ x: n(Math.min(1, Math.max(0, (pt.x - r.x) / r.w))), y: n(Math.min(1, Math.max(0, (pt.y - r.y) / r.h))) });
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
    st.align = first.anchor === 'end' ? 'right' : first.anchor === 'start' ? 'left' : 'center';
    value = PLAIN ? labels.map(({ t }) => t.s).join('\n')
      : labels.map(({ t }) => (t.weight >= 600 ? `<b>${html(t.s)}</b>` : html(t.s))).join('<br>');
    if (PLAIN && first.weight >= 600) st.fontStyle = 1;
    offset = `<mxPoint x="${n((u.x + u.r) / 2 - e.mid.x)}" y="${n((u.y + u.b) / 2 - e.mid.y)}" as="offset"/>`;
  }
  const way = pts.slice(1, -1).map((pt) => `<mxPoint x="${n(pt.x)}" y="${n(pt.y)}"/>`).join('');
  const src = shapeIds.has(e.from) ? ` source="${esc(e.from)}"` : '';
  const tgt = shapeIds.has(e.to) ? ` target="${esc(e.to)}"` : '';
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

if (argv.includes('--export')) {
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
