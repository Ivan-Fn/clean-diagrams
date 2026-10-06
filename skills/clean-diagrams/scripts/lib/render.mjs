/**
 * render.mjs — turn a flattened SVG into PNG or PDF without a browser, using a renderer
 * found on PATH. Set CLEAN_DIAGRAMS_RENDERER to resvg, rsvg-convert or inkscape to choose.
 *
 *   resvg          PNG only. Closest to Chromium. Nix: nixpkgs#resvg; Homebrew: resvg
 *   rsvg-convert   PNG and PDF (vector). Nix: nixpkgs#librsvg; Homebrew: librsvg. When usvg
 *                  (shipped with resvg) is present, text is first outlined from the bundled
 *                  font, so output matches everywhere; PDF text is then not selectable.
 *                  Without usvg, rsvg-convert finds fonts through fontconfig on Linux (bundled
 *                  folder only) and through the system on macOS, where the folder is ignored
 *   inkscape       PNG and PDF. Uses the machine's fonts
 *
 * Fonts. resvg and rsvg-convert draw with the bundled Liberation Sans (fonts/, SIL Open Font
 * License), which has Arial's widths, so every label the checker passed fits in the export
 * on any machine, whatever fonts it has. Only when the text needs a character Liberation
 * Sans lacks (CJK, emoji) do they fall back to the machine's fonts. CLEAN_DIAGRAMS_FONT_DIR
 * replaces the bundled folder. A render that leaves any character without a font fails,
 * and a failed render never leaves a file at the output path.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_FONT = 'Liberation Sans';
const FONT_DIR = process.env.CLEAN_DIAGRAMS_FONT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
export const FONT_HINT = 'Install a font (nix profile install nixpkgs#liberation_ttf nixpkgs#noto-fonts, or apt install fonts-liberation fonts-noto) or point CLEAN_DIAGRAMS_FONT_DIR at a folder of .ttf files';
export const INSTALL_HINT = 'install resvg (PNG) or librsvg (PNG and PDF): nix profile install nixpkgs#resvg nixpkgs#librsvg, or brew install resvg librsvg';

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

/* Characters Liberation Sans covers: Latin, Greek, Cyrillic, general punctuation, arrows. */
const COVERED = /^[\u0000-ɏͰ-ϿЀ-ӿ -⁯₠-₿℀-⅏←-⇿∀-⋿■-◿\s]*$/u;
const needsSystemFonts = (svgFile) => {
  const text = [...readFileSync(svgFile, 'utf8').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join('');
  return !COVERED.test(text);
};
const MISSING = /No match for|No fonts? with an? .* character|No fonts? (were )?(found|loaded)|failed to load font|cannot find font/i;

function attempt(r, args, env) {
  const p = spawnSync(r.name, args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  return { ok: p.status === 0, err: (p.stderr || '').trim(), out: (p.stdout || '').trim() };
}

function run(r, kind, input, output, scale) {
  if (!existsSync(FONT_DIR)) throw new Error(`font folder ${FONT_DIR} does not exist. ${FONT_HINT}`);
  const tmp = mkdtempSync(join(tmpdir(), 'clean-diagrams-render-'));
  const tmpOut = join(tmp, `out.${kind}`);
  const allowSystem = needsSystemFonts(input) && process.env.CLEAN_DIAGRAMS_SYSTEM_FONTS !== '0';
  try {
    let res;
    if (r.name === 'resvg') {
      const fontArgs = ['--use-fonts-dir', FONT_DIR, '--sans-serif-family', BUNDLED_FONT, ...(allowSystem ? [] : ['--skip-system-fonts'])];
      res = attempt(r, [...fontArgs, ...r[kind](input, tmpOut, scale)]);
    } else if (r.name === 'rsvg-convert' && works('usvg')) {
      /* rsvg-convert picks fonts through the platform (CoreText on macOS), which ignores the
         bundled folder. usvg converts the text to outlines from the bundled font first, so
         the PDF looks the same everywhere. The text is then shapes, not selectable text. */
      const outlined = join(tmp, 'outlined.svg');
      const fontArgs = ['--use-fonts-dir', FONT_DIR, '--sans-serif-family', BUNDLED_FONT, ...(allowSystem ? [] : ['--skip-system-fonts'])];
      const u = attempt({ name: 'usvg' }, [...fontArgs, input, outlined]);
      if (!u.ok) throw new Error(`usvg failed: ${(u.err || u.out).split('\n').slice(-3).join(' | ')}`);
      if (MISSING.test(u.err)) throw new Error(`usvg could not find a font for some of the text, so it would be missing from the PDF: ${u.err.split('\n')[0]}. ${FONT_HINT}`);
      res = attempt(r, r[kind](outlined, tmpOut, scale));
    } else if (r.name === 'rsvg-convert') {
      /* fontconfig reads only the bundled folder unless the text needs other scripts */
      const env = {};
      if (!allowSystem) {
        const conf = join(tmp, 'fonts.conf');
        const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${x(FONT_DIR)}</dir><cachedir>${x(join(tmp, 'cache'))}</cachedir>`
          + `<alias><family>sans-serif</family><prefer><family>${BUNDLED_FONT}</family></prefer></alias></fontconfig>`);
        env.FONTCONFIG_FILE = conf;
      }
      res = attempt(r, r[kind](input, tmpOut, scale), env);
    } else {
      res = attempt(r, r[kind](input, tmpOut, scale));
    }
    if (!res.ok) throw new Error(`${r.name} failed: ${(res.err || res.out).split('\n').slice(-3).join(' | ')}`);
    if (MISSING.test(res.err)) throw new Error(`${r.name} could not find a font for some of the text, so it would be missing from the picture: ${res.err.split('\n')[0]}. ${FONT_HINT}`);
    if (!existsSync(tmpOut)) throw new Error(`${r.name} wrote no file`);
    copyFileSync(tmpOut, output);              /* only now does anything reach the output path */
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
export const renderPng = (r, input, output, scale = 2) => run(r, 'png', input, output, scale);
export const renderPdf = (r, input, output) => run(r, 'pdf', input, output, 1);
