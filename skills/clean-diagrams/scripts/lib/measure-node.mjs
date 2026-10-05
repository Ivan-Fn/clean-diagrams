/**
 * measure-node.mjs — build the checks model from the SVG source alone, no browser.
 * Text extents come from the measured width table, so they are a little wider than any
 * one font renders: a label that passes here fits in Chromium, Safari, Firefox and on
 * machines that fall back to Arial.
 */
import { parse, computeStyles, elements, classes, hasClass, closest, textOf, inDefs, color, num, weight, rectBox, textBox, shapeBox, pathPoints, polyLength, pointAt, viewBox } from './svgdom.mjs';
import { sampleSteps } from './checks.mjs';

export function measure(src, theme) {
  const doc = parse(src);
  const problems = [];
  const add = (level, check, where, msg) => problems.push({ level, check, where, msg });
  if (!doc.svg) return { error: 'not-svg', problems: [{ level: 'fail', check: 'not-svg', where: '', msg: 'file is not an SVG document' }] };
  const vb = viewBox(doc.svg);
  if (!vb) return { error: 'viewbox', problems: [{ level: 'fail', check: 'viewbox', where: 'svg', msg: 'no viewBox; set viewBox="0 0 W H"' }] };
  const { unsupported } = computeStyles(doc, theme);
  for (const s of unsupported) add('warn', 'css-selector', 'style', `selector "${s}" is not understood without a browser and was ignored`);

  const all = elements(doc.svg).filter((e) => !inDefs(e));
  const label = (el) => textOf(el).trim().replace(/\s+/g, ' ').slice(0, 40);
  const isShapeGroup = (e) => e.tag === 'g' && (hasClass(e, 'node') || hasClass(e, 'group'));
  const where = (el) => {
    const g = closest(el, isShapeGroup);
    return g && g.attrs.id ? `#${g.attrs.id}` : el.attrs.id ? `#${el.attrs.id}` : `"${label(el)}"`;
  };

  const seen = new Set();
  for (const el of elements(doc.svg)) {
    const id = el.attrs.id;
    if (id == null) continue;
    if (seen.has(id)) add('fail', 'duplicate-id', `#${id}`, 'id is used twice');
    seen.add(id);
  }
  for (const el of all) if (el.attrs.transform) add('warn', 'transform', where(el), 'transform found; the checks measure untransformed geometry, so results may be wrong');
  for (const el of all) if (['foreignObject', 'image', 'use'].includes(el.tag)) add('warn', 'unsupported-element', where(el), `<${el.tag}> is outside the clean-diagrams markup; it is not checked`);

  const shapes = [];
  for (const g of all.filter(isShapeGroup)) {
    const kind = hasClass(g, 'node') ? 'node' : 'group';
    const rect = g.children.find((c) => c.tag === 'rect');
    if (!g.attrs.id) { add('fail', 'missing-id', `"${label(g)}"`, `${kind} has no id`); continue; }
    if (!rect) { add('fail', 'no-rect', `#${g.attrs.id}`, 'needs one <rect> as its direct child'); continue; }
    shapes.push({ id: g.attrs.id, kind, r: rectBox(rect) });
  }

  /* painted shapes for the contrast background, in document order (later is on top) */
  const painted = [];
  for (const el of all) {
    if (el.tag === 'path' && hasClass(el, 'edge')) continue;
    const box = shapeBox(el);
    if (!box) continue;
    const fill = color(el.cs.fill);
    if (!fill || fill.a === 0) continue;
    painted.push({ box, fill: { ...fill, a: fill.a * num(el.cs['fill-opacity'], 1) * num(el.cs.opacity, 1) }, el });
  }
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const within = (p, r) => p.x > r.x && p.x < r.r && p.y > r.y && p.y < r.b;

  const texts = [];
  for (const t of all.filter((e) => e.tag === 'text' && label(e))) {
    const r = textBox(t);
    const owner = closest(t, isShapeGroup);
    const stroke = t.cs.stroke;
    const fgRaw = color(t.cs.fill);
    if (fgRaw === undefined) add('warn', 'colour-value', where(t), `fill "${t.cs.fill}" is not a colour the checker can read`);
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const p of painted) if (within(c, p.box)) bg = blend(p.fill, bg);
    texts.push({
      label: label(t), where: where(t), owner: owner?.attrs.id ?? null, r,
      size: num(t.cs['font-size'], 16), weight: weight(t.cs['font-weight']),
      outlined: !!stroke && stroke !== 'none' && num(t.cs['stroke-width'], 1) > 0, stroke,
      fg: fgRaw ? { ...fgRaw, a: fgRaw.a * num(t.cs['fill-opacity'], 1) } : null, bg,
    });
  }

  const edges = [];
  for (const e of all.filter((x) => x.tag === 'path' && hasClass(x, 'edge'))) {
    let pts;
    try { pts = pathPoints(e.attrs.d || ''); } catch (err) { add('fail', 'edge-path', e.attrs.id ? `#${e.attrs.id}` : 'edge', err.message); continue; }
    if (pts.length < 2) { add('fail', 'edge-path', e.attrs.id ? `#${e.attrs.id}` : 'edge', 'path has fewer than two points'); continue; }
    const len = polyLength(pts);
    edges.push({
      id: e.attrs.id || '', from: e.attrs['data-from'] || '', to: e.attrs['data-to'] || '',
      head: !!e.attrs['marker-end'], plain: classes(e).includes('plain'), len,
      P0: pts[0], P1: pts[pts.length - 1], samples: sampleSteps(len).map((d) => pointAt(pts, d)),
    });
  }
  return { W: vb.w, H: vb.h, problems, shapes, texts, edges };
}
