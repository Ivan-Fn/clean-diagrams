/**
 * checks.mjs — the layout, arrow and contrast rules, run on a measured model of the diagram.
 *
 * The model comes from either measure-node.mjs (no browser) or the browser measurement in
 * check.mjs; both produce the same shape, so both modes apply exactly these rules:
 *
 *   { W, H, error?, problems: [pre-found problems],
 *     shapes:  [{ id, kind: 'node'|'group', r }],
 *     texts:   [{ label, where, owner, r, size, weight, outlined, stroke, fg, bg }],
 *     edges:   [{ id, from, to, head, plain, len, P0, P1, samples }] }
 *
 * r = { x, y, w, h, r (right), b (bottom) }. fg and bg are { r, g, b, a } after opacity.
 */
const inside = (p, r, inset = 0) => p.x > r.x + inset && p.x < r.r - inset && p.y > r.y + inset && p.y < r.b - inset;
const overlap = (a, b, pad = 0) => a.x < b.r - pad && b.x < a.r - pad && a.y < b.b - pad && b.y < a.b - pad;
const contains = (o, i, dx = 0, dy = 0) => i.x >= o.x + dx && i.r <= o.r - dx && i.y >= o.y + dy && i.b <= o.b - dy;
const distToBorder = (p, r) => {
  const dx = Math.max(r.x - p.x, 0, p.x - r.r), dy = Math.max(r.y - p.y, 0, p.y - r.b);
  if (dx || dy) return Math.hypot(dx, dy);
  return Math.min(p.x - r.x, r.r - p.x, p.y - r.y, r.b - p.y);
};
const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
export const contrastRatio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* geometry: theme-independent. colour: run once per theme. */
export function geometryProblems(m) {
  const problems = [];
  const add = (level, check, where, msg) => problems.push({ level, check, where, msg });
  const byId = new Map(m.shapes.map((s) => [s.id, s]));
  const nodes = m.shapes.filter((s) => s.kind === 'node');
  const { W, H } = m;

  for (const s of m.shapes) {
    if (s.r.x < 0 || s.r.y < 0 || s.r.r > W || s.r.b > H) add('fail', 'out-of-frame', `#${s.id}`, `box ${Math.round(s.r.x)},${Math.round(s.r.y)} ${Math.round(s.r.w)}x${Math.round(s.r.h)} is outside the ${W}x${H} viewBox`);
  }
  for (const t of m.texts) {
    if (t.outlined) add('fail', 'text-outline', t.where, `"${t.label}" is drawn with an outline (stroke ${t.stroke}); a shape style is probably leaking onto text — scope it to rect, e.g. rect.group`);
    if (t.size < 11) add('fail', 'font-size', t.where, `"${t.label}" is ${t.size}px; the minimum is 11`);
    if (t.r.x < 8 || t.r.r > W - 8 || t.r.y < 4 || t.r.b > H - 4) add('fail', 'text-out-of-frame', t.where, `"${t.label}" reaches ${Math.round(t.r.r)} of ${W} wide / ${Math.round(t.r.b)} of ${H} high; keep 8 clear`);
    const s = t.owner && byId.get(t.owner);
    if (s) {
      const dx = s.kind === 'node' ? 8 : 4, dy = 3;
      if (!contains(s.r, t.r, dx, dy)) {
        const wide = t.r.x < s.r.x + dx || t.r.r > s.r.r - dx;
        const fix = wide ? `widen the box to at least ${Math.ceil(t.r.w + 2 * dx)}, break the line, or move it`
          : `make the box taller or move the line: its text spans ${Math.round(t.r.y)} to ${Math.round(t.r.b)}, the box ${Math.round(s.r.y)} to ${Math.round(s.r.b)}`;
        add('fail', 'text-outside-box', `#${s.id}`, `"${t.label}" (${Math.ceil(t.r.w)}x${Math.ceil(t.r.h)}) does not fit inside its box (${Math.round(s.r.w)}x${Math.round(s.r.h)}); ${fix}`);
      }
      /* the box's or container's own text must not sit under another box drawn over it */
      for (const n of m.shapes) {
        if (n.id === s.id || n.kind !== 'node') continue;
        if (overlap(t.r, n.r, 1)) add('fail', 'text-under-box', t.where, `"${t.label}" is covered by #${n.id}; move the text or the box`);
      }
    } else {
      for (const n of m.shapes) {
        if (overlap(t.r, n.r) && !contains(n.r, t.r)) add('fail', 'text-on-border', t.where, `"${t.label}" crosses the border of #${n.id}`);
        else if (n.kind === 'node' && contains(n.r, t.r)) add('fail', 'loose-text-in-box', t.where, `"${t.label}" sits inside #${n.id} but is not in its <g class="node">`);
        else if (n.kind === 'node' && overlap({ x: t.r.x - 4, y: t.r.y - 4, r: t.r.r + 4, b: t.r.b + 4 }, n.r)) add('fail', 'label-crowding', t.where, `"${t.label}" is less than 4 from #${n.id}; move it into a wider gap or above the row`);
      }
    }
  }
  for (let i = 0; i < m.texts.length; i++) for (let j = i + 1; j < m.texts.length; j++) {
    if (overlap(m.texts[i].r, m.texts[j].r, 1)) add('fail', 'text-overlap', m.texts[i].where, `"${m.texts[i].label}" overlaps "${m.texts[j].label}"`);
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (overlap(nodes[i].r, nodes[j].r, -8)) add('fail', 'boxes-too-close', `#${nodes[i].id}`, `#${nodes[i].id} and #${nodes[j].id} are less than 8 apart`);
  }
  for (const grp of m.shapes.filter((s) => s.kind === 'group')) for (const n of nodes) {
    if (overlap(grp.r, n.r) && !contains(grp.r, n.r)) add('fail', 'straddles-group', `#${n.id}`, `#${n.id} crosses the border of #${grp.id}`);
  }
  const seenPaths = new Map();
  for (const e of m.edges) {
    const sig = [e.P0, e.P1, ...e.samples.filter((_, i) => i % 5 === 0)].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
    if (seenPaths.has(sig)) add('warn', 'edge-duplicate', e.id ? `#${e.id}` : 'edge', `draws exactly over ${seenPaths.get(sig)}; one of the two arrows is hidden`);
    else seenPaths.set(sig, e.id ? `#${e.id}` : 'another arrow');
  }
  for (const e of m.edges) {
    const id = e.id ? `#${e.id}` : `edge ${e.from}->${e.to}`;
    if (!e.from || !e.to) { add('fail', 'edge-ends', id, 'needs data-from and data-to'); continue; }
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from) add('fail', 'edge-ref', id, `data-from="${e.from}" names no node or group`);
    if (!to) add('fail', 'edge-ref', id, `data-to="${e.to}" names no node or group`);
    if (!from || !to) continue;
    if (!e.head && !e.plain) add('warn', 'no-arrowhead', id, 'no marker-end; add class "plain" if a bare line is intended');
    const tol = 3;
    const okEnd = (p, s) => (s.kind === 'group' ? (inside(p, s.r) || distToBorder(p, s.r) <= tol) : distToBorder(p, s.r) <= tol);
    if (!okEnd(e.P0, from)) add('fail', 'edge-start', id, `starts at ${Math.round(e.P0.x)},${Math.round(e.P0.y)}, ${Math.round(distToBorder(e.P0, from.r))} away from the edge of #${from.id}`);
    if (!okEnd(e.P1, to)) add('fail', 'edge-end', id, `ends at ${Math.round(e.P1.x)},${Math.round(e.P1.y)}, ${Math.round(distToBorder(e.P1, to.r))} away from the edge of #${to.id}`);
    const hitsBox = new Set(), hitsText = new Set();
    for (const p of e.samples) {
      for (const n of nodes) if (inside(p, n.r, 2)) hitsBox.add(n.id);
      for (const t of m.texts) if (inside(p, { x: t.r.x - 1, y: t.r.y - 1, r: t.r.r + 1, b: t.r.b + 1 })) hitsText.add(t.label);
    }
    for (const n of hitsBox) add('fail', 'edge-through-box', id, `runs through #${n}; route it around with an elbow`);
    for (const t of hitsText) add('fail', 'edge-over-text', id, `runs over "${t}"`);
  }
  return problems;
}

export function colourProblems(m, theme) {
  const problems = [];
  for (const t of m.texts) {
    if (!t.fg) { problems.push({ level: 'fail', check: 'text-fill', where: t.where, msg: `"${t.label}" has no fill colour` }); continue; }
    const need = t.size >= 24 || (t.weight >= 600 && t.size >= 18.66) ? 3 : 4.5;
    const got = contrastRatio(blend(t.fg, t.bg), t.bg);
    if (got < need) problems.push({ level: 'fail', check: 'contrast', where: t.where, msg: `"${t.label}" contrast ${got.toFixed(2)}:1 in the ${theme} theme; needs ${need}:1` });
  }
  return problems;
}

/* d = 4, 6, 8 … len-4: the same sampling the browser uses via getPointAtLength */
/* d = 4, 6, 8 … up to 1 before the end, so an arrowhead lying over a label is caught; the
   same sampling the browser pass uses via getPointAtLength */
export const sampleSteps = (len) => { const out = []; for (let d = 4; d < len - 1; d += 2) out.push(d); return out; };
