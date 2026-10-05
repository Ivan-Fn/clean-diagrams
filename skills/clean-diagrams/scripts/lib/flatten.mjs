/**
 * flatten.mjs — write a clean-diagrams SVG for one theme with every style resolved into
 * presentation attributes and no <style> element.
 *
 * Renderers outside a browser (rsvg-convert, resvg, Inkscape, LaTeX SVG packages,
 * PowerPoint and Keynote import) do not support CSS custom properties or media queries,
 * so they draw the source file black. The flattened file draws the same in all of them.
 */
import { parse, computeStyles, elements } from './svgdom.mjs';

const KEEP_ATTRS = new Set(['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'role', 'aria-label', 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'marker-start', 'marker-mid', 'marker-end', 'href', 'xlink:href', 'viewbox',
  'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits', 'preserveAspectRatio', 'data-from', 'data-to', 'class',
  'dx', 'dy', 'transform']);
const SHAPE = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity'];
const DRAWN = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const TEXT = ['font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Browser-only font keywords mean nothing to other renderers; drop them so the list falls
   through to a family the machine has. */
const portableFonts = (f) => {
  const list = f.split(',').map((s) => s.trim()).filter((s) => !/^(ui-sans-serif|-apple-system|BlinkMacSystemFont|system-ui)$/i.test(s.replace(/["']/g, '')));
  return list.length ? list.join(', ') : 'Helvetica, Arial, sans-serif';
};

export function flatten(src, theme) {
  const doc = parse(src);
  if (!doc.svg) throw new Error('not an SVG document');
  computeStyles(doc, theme);
  const write = (el) => {
    if (el.tag === '#text') return esc(el.text);
    if (el.tag === 'style') return '';
    const out = [];
    for (const [k, v] of Object.entries(el.attrs)) if (KEEP_ATTRS.has(k) || k.startsWith('data-') || k.startsWith('aria-')) out.push(`${k}="${esc(v)}"`);
    const cs = el.cs || {};
    const props = el.tag === 'text' || el.tag === 'tspan' ? [...SHAPE, ...TEXT] : DRAWN.has(el.tag) ? SHAPE : [];
    for (const p of props) {
      let v = cs[p];
      if (v == null || v === '') continue;
      if (p === 'font-family') v = portableFonts(v);
      if (p === 'font-size' && /^\d+(\.\d+)?$/.test(v)) v = `${v}px`;
      /* Renderers outside a browser often have no 600 face and fall back to regular;
         bold keeps names visibly heavier than notes everywhere. */
      if (p === 'font-weight' && parseFloat(v) >= 600) v = 'bold';
      if (p === 'stroke-dasharray' && v === 'none') continue;
      if ((p === 'opacity' || p === 'fill-opacity' || p === 'stroke-opacity') && Number(v) === 1) continue;
      out.push(`${p}="${esc(v)}"`);
    }
    const inner = el.children.map(write).join('');
    return `<${el.tag}${out.length ? ` ${out.join(' ')}` : ''}${inner ? `>${inner}</${el.tag}>` : '/>'}`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${write(doc.svg)}\n`;
}

export const hasStyleSheet = (src) => elements(parse(src).root).some((e) => e.tag === 'style');
