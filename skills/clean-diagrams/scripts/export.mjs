#!/usr/bin/env node
/**
 * export.mjs — turn a checked clean-diagrams SVG into the files each destination needs.
 *
 *   node export.mjs <diagram.svg> [--split] [--flat] [--png] [--pdf] [--scale N] [--out <dir>]
 *
 * With no format flag it writes every format it can. Files land next to the SVG unless
 * --out is given.
 *
 *   --split  <name>.light.svg and <name>.dark.svg with the theme fixed, for a Markdown
 *            <picture> element. Needs only Node.
 *   --flat   <name>.flat.svg and <name>.flat.dark.svg: every style written into the elements,
 *            no stylesheet. For tools that draw the source file black (PowerPoint, Keynote,
 *            Inkscape, LaTeX svg packages, rsvg). Needs only Node.
 *   --png    <name>.png and <name>.dark.png at --scale (default 2)
 *   --pdf    <name>.pdf, light theme, vector, fonts embedded, sized to the diagram
 *
 * PNG and PDF come from a browser when one is available (lib/browser.mjs), otherwise from
 * resvg or rsvg-convert on PATH (lib/render.mjs). Without either, they are skipped with a
 * note, and the other formats are still written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { flatten } from './lib/flatten.mjs';
import { viewBox, parse } from './lib/svgdom.mjs';
import { openBrowser } from './lib/browser.mjs';
import { findRenderer, renderPng, renderPdf, INSTALL_HINT } from './lib/render.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const flagArgs = new Set(['--scale', '--out']);
const file = argv.find((a, i) => !a.startsWith('--') && !flagArgs.has(argv[i - 1]));
if (!file || !existsSync(file)) {
  console.error('usage: node export.mjs <diagram.svg> [--split] [--flat] [--png] [--pdf] [--scale N] [--out <dir>]');
  process.exit(2);
}
const SVG = resolve(file);
const name = basename(SVG, '.svg');
const outDir = resolve(opt('--out', dirname(SVG)));
mkdirSync(outDir, { recursive: true });
const scale = Number(opt('--scale', 2));
const any = ['--png', '--pdf', '--split', '--flat'].some((f) => argv.includes(f));
const want = (f) => !any || argv.includes(f);

const source = readFileSync(SVG, 'utf8');
const vb = viewBox(parse(source).svg || { attrs: {} });
if (!vb) { console.error('the SVG has no viewBox'); process.exit(1); }
const [W, H] = [Math.ceil(vb.w), Math.ceil(vb.h)];
const DARK_QUERY = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/;
if (!DARK_QUERY.test(source)) console.warn('note: no prefers-color-scheme block found; the dark outputs will match the light ones');
const written = [], skipped = [];

if (want('--split')) {
  /* The dark block follows the base rule, so enabling it unconditionally gives the dark
     theme and disabling it gives the light one. Nothing else in the file changes. */
  const light = join(outDir, `${name}.light.svg`), dark = join(outDir, `${name}.dark.svg`);
  writeFileSync(light, source.replace(DARK_QUERY, '@media not all'));
  writeFileSync(dark, source.replace(DARK_QUERY, '@media all'));
  written.push(light, dark);
}
if (want('--flat')) {
  const light = join(outDir, `${name}.flat.svg`), dark = join(outDir, `${name}.flat.dark.svg`);
  writeFileSync(light, flatten(source, 'light'));
  writeFileSync(dark, flatten(source, 'dark'));
  written.push(light, dark);
}

if (want('--png') || want('--pdf')) {
  const opened = await openBrowser();
  if (opened) {
    const { browser } = opened;
    try {
      if (want('--png')) {
        for (const theme of ['light', 'dark']) {
          const ctx = await browser.newContext({ colorScheme: theme, deviceScaleFactor: scale });
          const page = await ctx.newPage();
          await page.goto(pathToFileURL(SVG).href);
          await page.setViewportSize({ width: W, height: H });
          const out = join(outDir, theme === 'light' ? `${name}.png` : `${name}.dark.png`);
          await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
          written.push(out);
          await ctx.close();
        }
      }
      if (want('--pdf')) {
        const ctx = await browser.newContext({ colorScheme: 'light' });
        const page = await ctx.newPage();
        const html = `<!doctype html><html><head><style>@page{size:${W}px ${H}px;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${source.replace(DARK_QUERY, '@media not all')}</body></html>`;
        await page.setContent(html);
        const out = join(outDir, `${name}.pdf`);
        await page.pdf({ path: out, width: `${W}px`, height: `${H}px`, printBackground: true, pageRanges: '1' });
        written.push(out);
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  } else {
    /* No browser: flatten, then hand the file to resvg / rsvg-convert. */
    const tmp = mkdtempSync(join(tmpdir(), 'clean-diagrams-'));
    const flat = { light: join(tmp, `${name}.light.svg`), dark: join(tmp, `${name}.dark.svg`) };
    writeFileSync(flat.light, flatten(source, 'light'));
    writeFileSync(flat.dark, flatten(source, 'dark'));
    if (want('--png')) {
      const r = findRenderer('png');
      if (!r) skipped.push(`PNG: no browser and no renderer; ${INSTALL_HINT}`);
      else for (const theme of ['light', 'dark']) {
        const out = join(outDir, theme === 'light' ? `${name}.png` : `${name}.dark.png`);
        renderPng(r, flat[theme], out, scale);
        written.push(out);
      }
    }
    if (want('--pdf')) {
      const r = findRenderer('pdf');
      if (!r) skipped.push(`PDF: no browser and no PDF renderer; install librsvg (rsvg-convert): nix profile install nixpkgs#librsvg, or brew install librsvg`);
      else { const out = join(outDir, `${name}.pdf`); renderPdf(r, flat.light, out); written.push(out); }
    }
  }
}

for (const f of written) console.log(f);
for (const s of skipped) console.error(`skipped ${s}`);
