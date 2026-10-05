#!/usr/bin/env node
/**
 * export.mjs — turn a checked clean-diagrams SVG into the files each destination needs.
 *
 *   node export.mjs <diagram.svg> [--png] [--pdf] [--split] [--scale N] [--out <dir>]
 *
 * With no format flag it writes all three. Files land next to the SVG unless --out is given.
 *
 *   --png    <name>.png (light) and <name>.dark.png at --scale (default 2), for slides and chat
 *   --pdf    <name>.pdf, light theme, vector text with fonts embedded, sized to the viewBox,
 *            for LaTeX papers and print
 *   --split  <name>.light.svg and <name>.dark.svg with the theme fixed, for a Markdown
 *            <picture> element (see references/publish.md)
 *
 * The source SVG already follows the reader's theme by itself; the split files exist for
 * hosts that theme the page with a class instead of the colour-scheme the SVG can see.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const flagArgs = new Set(['--scale', '--out']);
const file = argv.find((a, i) => !a.startsWith('--') && !flagArgs.has(argv[i - 1]));
if (!file || !existsSync(file)) {
  console.error('usage: node export.mjs <diagram.svg> [--png] [--pdf] [--split] [--scale N] [--out <dir>]');
  process.exit(2);
}
const SVG = resolve(file);
const name = basename(SVG, '.svg');
const outDir = resolve(opt('--out', dirname(SVG)));
mkdirSync(outDir, { recursive: true });
const scale = Number(opt('--scale', 2));
const any = ['--png', '--pdf', '--split'].some((f) => argv.includes(f));
const want = (f) => !any || argv.includes(f);

const source = readFileSync(SVG, 'utf8');
const DARK_QUERY = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/;
if (!DARK_QUERY.test(source)) console.warn('note: no prefers-color-scheme block found; the dark outputs will match the light ones');
const written = [];

if (want('--split')) {
  /* The dark block follows the base rule, so enabling it unconditionally gives the dark
     theme and disabling it gives the light one. Nothing else in the file changes. */
  const light = join(outDir, `${name}.light.svg`), dark = join(outDir, `${name}.dark.svg`);
  writeFileSync(light, source.replace(DARK_QUERY, '@media not all'));
  writeFileSync(dark, source.replace(DARK_QUERY, '@media all'));
  written.push(light, dark);
}

if (want('--png') || want('--pdf')) {
  const browser = await chromium.launch();
  try {
    const size = async (page) => page.evaluate(() => {
      const vb = document.documentElement.viewBox.baseVal;
      return { w: Math.ceil(vb.width), h: Math.ceil(vb.height) };
    });
    if (want('--png')) {
      for (const theme of ['light', 'dark']) {
        const ctx = await browser.newContext({ colorScheme: theme, deviceScaleFactor: scale });
        const page = await ctx.newPage();
        await page.goto(pathToFileURL(SVG).href);
        const { w, h } = await size(page);
        await page.setViewportSize({ width: w, height: h });
        const out = join(outDir, theme === 'light' ? `${name}.png` : `${name}.dark.png`);
        await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
        written.push(out);
        await ctx.close();
      }
    }
    if (want('--pdf')) {
      const ctx = await browser.newContext({ colorScheme: 'light' });
      const page = await ctx.newPage();
      const vb = source.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
      if (!vb) throw new Error('the SVG has no viewBox');
      const [w, h] = [Math.ceil(Number(vb[1])), Math.ceil(Number(vb[2]))];
      /* Print the SVG inside a page exactly its size so the PDF has no margins. */
      const html = `<!doctype html><html><head><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${source}</body></html>`;
      await page.setContent(html.replace(DARK_QUERY, '@media not all'));
      const out = join(outDir, `${name}.pdf`);
      await page.pdf({ path: out, width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: '1' });
      written.push(out);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

for (const f of written) console.log(f);
