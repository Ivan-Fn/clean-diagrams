/**
 * measure-node.mjs — build the checks model from the SVG source alone, no browser.
 *
 * Text extents come from the measured width table (see svgdom.mjs), which is never
 * narrower than the macOS system font, Arial, Helvetica or Helvetica Neue at the same size.
 * Anything this reader cannot evaluate (a broken file, a selector or colour it does not
 * understand) is a failure, so a pass here never rests on a guess.
 */
import { parse, computeStyles, elements, classes, hasClass, closest, textOf, inDefs, color, num, weight, rectBox, textBox, minFontSize, shapeBox, pathPoints, polyLength, pointAt, viewBox, isMonospace } from './svgdom.mjs';
import { sampleSteps } from './checks.mjs';

export function measure(src, theme) {
  const doc = parse(src);
  const problems = [];
  const add = (level, check, where, msg) => problems.push({ level, check, where, msg });
  for (const e of doc.errors) add('fail', 'xml', 'file', `${e}; browsers and GitHub refuse to show a file like this`);
  if (!doc.svg) return { error: 'not-svg', problems: [...problems, { level: 'fail', check: 'not-svg', where: '', msg: 'file is not an SVG document' }] };
  const vb = viewBox(doc.svg);
  if (!vb) return { error: 'viewbox', problems: [...problems, { level: 'fail', check: 'viewbox', where: 'svg', msg: 'no viewBox; set viewBox="0 0 W H"' }] };
  const { unsupported, unknownProps, valueProblems } = computeStyles(doc, theme);
  for (const s of unsupported) add('fail', 'css-selector', 'style', s.startsWith('@')
    ? `"${s}" cannot be evaluated without a browser; move its rules out of it, or use only prefers-color-scheme media queries`
    : `selector "${s}" cannot be checked without a browser; write it with tags, classes, ids, descendant or child (>) combinators`);
  for (const v of valueProblems) add('fail', 'css-value', 'style', v);
  for (const p of unknownProps) add('warn', 'css-property', 'style', `property "${p}" is not evaluated by the checker`);
  const FAMILIES = /^(ui-sans-serif|-apple-system|BlinkMacSystemFont|system-ui|Segoe UI|Roboto|Helvetica Neue|Helvetica|Arial|Liberation Sans|DejaVu Sans|Noto Sans|sans-serif)$/i;

  const all = elements(doc.svg).filter((e) => !inDefs(e));
  const label = (el) => textOf(el).trim().replace(/\s+/g, ' ').slice(0, 40);
  const isShapeGroup = (e) => e.tag === 'g' && (hasClass(e, 'node') || hasClass(e, 'group'));
  const isLifeline = (e) => e.tag === 'g' && hasClass(e, 'lifeline');
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
  for (const el of all) if (['foreignObject', 'image', 'use', 'textPath', 'switch'].includes(el.tag)) add('warn', 'unsupported-element', where(el), `<${el.tag}> is outside the clean-diagrams markup; it is not checked`);

  const shapes = [];
  for (const g of all.filter(isShapeGroup)) {
    if (g.hidden) continue;
    const kind = hasClass(g, 'node') ? 'node' : 'group';
    const rect = g.children.find((c) => c.tag === 'rect');
    if (!g.attrs.id) { add('fail', 'missing-id', `"${label(g)}"`, `${kind} has no id`); continue; }
    if (!rect) { add('fail', 'no-rect', `#${g.attrs.id}`, 'needs one <rect> as its direct child'); continue; }
    shapes.push({ id: g.attrs.id, kind, r: rectBox(rect) });
  }

  for (const g of all.filter(isLifeline)) {
    if (g.hidden) continue;
    const line = g.children.find((c) => c.tag === 'path' || c.tag === 'line');
    if (!g.attrs.id) { add('fail', 'missing-id', 'lifeline', 'lifeline has no id'); continue; }
    let pts = null;
    try { pts = line?.tag === 'line' ? [{ x: num(line.attrs.x1), y: num(line.attrs.y1) }, { x: num(line.attrs.x2), y: num(line.attrs.y2) }] : line ? pathPoints(line.attrs.d || '') : null; } catch { pts = null; }
    if (!pts || pts.length < 2 || pts.some((p) => Math.abs(p.x - pts[0].x) > 0.5)) { add('fail', 'lifeline', `#${g.attrs.id}`, 'a lifeline needs one vertical <path d="Mx y1 Vy2"> as its child'); continue; }
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y)), x = pts[0].x;
    shapes.push({ id: g.attrs.id, kind: 'lifeline', r: { x, y: y0, w: 0, h: y1 - y0, r: x, b: y1 } });
  }

  /* painted shapes for the contrast background, in document order (later is on top) */
  const painted = [];
  for (const el of all) {
    if (el.hidden || (el.tag === 'path' && hasClass(el, 'edge'))) continue;
    const box = shapeBox(el);
    if (!box) continue;
    const fill = color(el.cs.fill);
    if (fill === undefined) { add('fail', 'colour-value', where(el), `fill "${el.cs.fill}" is not a colour the checker can read`); continue; }
    if (!fill || fill.a === 0) continue;
    painted.push({ box, fill: { ...fill, a: fill.a * num(el.cs['fill-opacity'], 1) * el.op } });
  }
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const within = (p, r) => p.x > r.x && p.x < r.r && p.y > r.y && p.y < r.b;

  const texts = [];
  for (const t of all.filter((e) => e.tag === 'text' && label(e) && !e.hidden)) {
    const fam = String(t.cs['font-family']).split(',')[0].trim().replace(/["']/g, '');
    if (!FAMILIES.test(fam) && !isMonospace(t.cs['font-family'])) add('warn', 'font-family', where(t), `"${label(t)}" uses "${fam}", which the width table does not measure; widths are estimated from the sans-serif table`);
    const r = textBox(t);
    const owner = closest(t, isShapeGroup);
    const stroke = t.cs.stroke;
    const fgRaw = color(t.cs.fill);
    if (fgRaw === undefined) add('fail', 'colour-value', where(t), `fill "${t.cs.fill}" is not a colour the checker can read`);
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const p of painted) if (within(c, p.box)) bg = blend(p.fill, bg);
    texts.push({
      label: label(t), where: where(t), owner: owner?.attrs.id ?? null, r,
      size: minFontSize(t), weight: weight(t.cs['font-weight']),
      outlined: !!stroke && stroke !== 'none' && num(t.cs['stroke-width'], 1) > 0, stroke,
      fg: fgRaw ? { ...fgRaw, a: fgRaw.a * num(t.cs['fill-opacity'], 1) * t.op } : null, bg,
    });
  }

  const edges = [];
  for (const e of all.filter((x) => x.tag === 'path' && hasClass(x, 'edge') && !x.hidden)) {
    let pts;
    try { pts = pathPoints(e.attrs.d || ''); } catch (err) { add('fail', 'edge-path', e.attrs.id ? `#${e.attrs.id}` : 'edge', err.message); continue; }
    if (pts.length < 2) { add('fail', 'edge-path', e.attrs.id ? `#${e.attrs.id}` : 'edge', 'path has fewer than two points'); continue; }
    const len = polyLength(pts);
    if (len > 4 * (vb.w + vb.h)) { add('fail', 'edge-path', e.attrs.id ? `#${e.attrs.id}` : 'edge', `arrow is ${Math.round(len)} long, far outside the ${vb.w}x${vb.h} canvas; check its coordinates`); continue; }
    edges.push({
      id: e.attrs.id || '', from: e.attrs['data-from'] || '', to: e.attrs['data-to'] || '',
      head: !!(e.attrs['marker-end'] || (e.cs['marker-end'] && e.cs['marker-end'] !== 'none')), plain: classes(e).includes('plain'), len,
      P0: pts[0], P1: pts[pts.length - 1], samples: sampleSteps(len).map((d) => pointAt(pts, d)),
    });
  }
  return { W: vb.w, H: vb.h, problems, shapes, texts, edges };
}
