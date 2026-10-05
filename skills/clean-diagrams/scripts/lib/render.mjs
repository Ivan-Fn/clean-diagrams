/**
 * render.mjs — turn a flattened SVG into PNG or PDF without a browser, using a renderer
 * found on PATH. Set CLEAN_DIAGRAMS_RENDERER to resvg, rsvg-convert or inkscape to choose.
 *
 *   resvg          PNG only. Closest to Chromium. Nix: nixpkgs#resvg; Homebrew: resvg
 *   rsvg-convert   PNG and PDF (vector, fonts embedded). Nix: nixpkgs#librsvg; Homebrew: librsvg
 *   inkscape       PNG and PDF. Heavier, often already installed
 */
import { spawnSync } from 'node:child_process';

const RENDERERS = {
  resvg: { png: (i, o, s) => ['-z', String(s), i, o] },
  'rsvg-convert': { png: (i, o, s) => ['-z', String(s), '-o', o, i], pdf: (i, o) => ['-f', 'pdf', '-o', o, i] },
  inkscape: { png: (i, o, s) => [i, '--export-type=png', `--export-dpi=${96 * s}`, `--export-filename=${o}`], pdf: (i, o) => [i, '--export-type=pdf', '--export-text-to-path=false', `--export-filename=${o}`] },
};
const works = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 }).status === 0;

export function findRenderer(need = 'png') {
  const forced = process.env.CLEAN_DIAGRAMS_RENDERER;
  const order = forced ? [forced] : need === 'pdf' ? ['rsvg-convert', 'inkscape'] : ['resvg', 'rsvg-convert', 'inkscape'];
  for (const name of order) if (RENDERERS[name]?.[need] && works(name)) return { name, ...RENDERERS[name] };
  return null;
}
const run = (r, args) => {
  const fontDir = process.env.CLEAN_DIAGRAMS_FONT_DIR;
  if (fontDir && r.name === 'resvg') args = ['--use-fonts-dir', fontDir, ...args];
  const p = spawnSync(r.name, args, { encoding: 'utf8', timeout: 120000 });
  const err = (p.stderr || '').trim();
  if (p.status !== 0) throw new Error(`${r.name} failed: ${(err || p.stdout || '').split('\n').slice(-3).join(' | ')}`);
  /* resvg exits 0 and draws no text when it finds no font; never let that pass as an export */
  if (/No match for|No fonts? (were )?(found|loaded)|failed to load font/i.test(err)) {
    throw new Error(`${r.name} found no usable font, so the text would be missing: ${err.split('\n')[0]}. ${FONT_HINT}`);
  }
};
export const FONT_HINT = 'Install a font (nix profile install nixpkgs#liberation_ttf, or apt install fonts-liberation) or point CLEAN_DIAGRAMS_FONT_DIR at a folder of .ttf files';
export const renderPng = (r, input, output, scale = 2) => run(r, r.png(input, output, scale));
export const renderPdf = (r, input, output) => run(r, r.pdf(input, output));
export const INSTALL_HINT = 'install resvg (PNG) or librsvg (PNG and PDF): nix profile install nixpkgs#resvg nixpkgs#librsvg, or brew install resvg librsvg';
