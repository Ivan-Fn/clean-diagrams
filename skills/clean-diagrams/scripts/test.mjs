#!/usr/bin/env node
/**
 * test.mjs — proves the templates pass, that each check fails on the defect it is named
 * for, and that the exports and the draw.io round trip produce what they claim.
 *
 *   node test.mjs        (or: npm test)
 *
 * Every defect case breaks one template on purpose and requires the named check in the
 * output. A case whose edit did not apply fails, so a stale case cannot pass silently.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(HERE, '..', 'templates');
const WORK = mkdtempSync(join(tmpdir(), 'clean-diagrams-test-'));
const run = (script, args, env = {}) => {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
let failed = 0, n = 0;
const result = (ok, name, note = '') => {
  n++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

/* 1. every template passes */
const templates = readdirSync(TPL).filter((f) => f.endsWith('.svg'));
for (const t of templates) {
  const r = run('check.mjs', [join(TPL, t), '--quiet']);
  result(r.code === 0, `template ${t} passes`, r.code === 0 ? '' : r.out.trim().split('\n')[0]);
}

/* 2. each check catches its defect */
let k = 0;
const broken = (tpl, find, replace) => {
  const src = readFileSync(join(TPL, tpl), 'utf8');
  if (!src.includes(find)) throw new Error(`edit anchor not found in ${tpl}: ${find}`);
  const p = join(WORK, `case-${++k}.svg`);
  writeFileSync(p, src.replace(find, replace));
  return p;
};
const cases = [
  ['text-outside-box', 'flow.svg', '<text class="note" x="474" y="108">3 replicas</text>', '<text class="note" x="474" y="108">3 replicas behind a regional load balancer</text>'],
  ['text-overlap', 'flow.svg', '<text class="label" x="569" y="86" text-anchor="middle">read</text>', '<text class="label" x="569" y="86" text-anchor="middle">read</text><text class="label" x="569" y="88" text-anchor="middle">read</text>'],
  ['label-crowding', 'flow.svg', 'x="189" y="86" text-anchor="middle">HTTPS', 'x="189" y="86" text-anchor="middle">HTTPS/2'],
  ['text-on-border', 'flow.svg', 'x="672" y="156">on miss', 'x="700" y="190">on miss'],
  ['edge-end', 'flow.svg', 'd="M664 122V182"', 'd="M664 122V160"'],
  ['edge-start', 'flow.svg', 'd="M164 94H214"', 'd="M150 70H214"'],
  ['edge-through-box', 'hub.svg', 'd="M224 96H252V150H280"', 'd="M224 96H560V150H480"'],
  ['edge-ref', 'flow.svg', 'data-to="database"', 'data-to="databse"'],
  ['edge-over-text', 'before-after.svg', 'd="M380 154V226"', 'd="M380 154V180H340V226H380"'],
  ['contrast', 'flow.svg', '.note { font-size: 13px; fill: var(--quiet);', '.note { font-size: 13px; fill: #cfcfcf;'],
  ['font-size', 'flow.svg', '.label { font-size: 11.5px;', '.label { font-size: 9px;'],
  ['text-outline', 'groups.svg', 'rect.group { fill: none;', '.group { fill: none;'],
  ['out-of-frame', 'flow.svg', '<rect class="box" x="594" y="182"', '<rect class="box" x="640" y="182"'],
  ['text-out-of-frame', 'flow.svg', 'class="title" x="24" y="34">Reads go to the cache first', 'class="title" x="24" y="34">Reads always go to the cache first, and only a miss ever reaches the database'],
  ['boxes-too-close', 'hub.svg', '<rect class="box" x="24" y="148"', '<rect class="box" x="24" y="128"'],
  ['straddles-group', 'groups.svg', '<rect class="box tint" x="40" y="100"', '<rect class="box tint" x="10" y="100"'],
  ['duplicate-id', 'flow.svg', '<g class="node" id="gateway">', '<g class="node" id="browser">'],
  ['viewbox', 'flow.svg', 'viewBox="0 0 760 262" ', ''],
  ['xml', 'flow.svg', '>auth, rate limits<', '>auth & rate limits<'],
  ['text-outside-box', 'flow.svg', '<text class="note" x="94" y="108">single-page app</text>', '<text class="note" x="94" y="108"><tspan x="94" y="108">single-page app</tspan><tspan x="94" dy="16">served from a CDN</tspan></text>'],
  ['contrast', 'flow.svg', '<g class="node" id="orders">', '<g class="node" id="orders" opacity="0.35">'],
  ['css-selector', 'flow.svg', '.note { font-size: 13px;', '.note:first-child { font-size: 13px; } .note { font-size: 13px;'],
];
for (const [check, tpl, find, replace] of cases) {
  let p;
  try { p = broken(tpl, find, replace); } catch (e) { result(false, `check ${check}`, e.message); continue; }
  /* once as configured, and once with the browser switched off: the no-browser checker
     must catch every defect on its own */
  for (const [mode, env] of [['', {}], [' without a browser', { CLEAN_DIAGRAMS_BROWSER: 'none' }]]) {
    const r = run('check.mjs', [p], env);
    const fired = r.out.split('\n').some((l) => l.startsWith('FAIL') && l.split(/\s+/)[1] === check);
    result(r.code === 1 && fired, `check ${check} catches its defect${mode}`, fired ? '' : `exit ${r.code}; output: ${r.out.trim().split('\n').slice(0, 3).join(' | ')}`);
  }
}

/* 3. exports */
const src = join(WORK, 'before-after.svg');
writeFileSync(src, readFileSync(join(TPL, 'before-after.svg')));
const ex = run('export.mjs', [src]);
const outs = ['before-after.png', 'before-after.dark.png', 'before-after.pdf', 'before-after.light.svg', 'before-after.dark.svg'].map((f) => join(WORK, f));
result(ex.code === 0 && outs.every(existsSync), 'export writes PNG, dark PNG, PDF and split SVGs', ex.code === 0 ? '' : ex.out);
if (outs.every(existsSync)) {
  const png = readFileSync(outs[0]);
  result(png.readUInt32BE(16) === 1520, 'PNG is 2x the viewBox width', `width ${png.readUInt32BE(16)}`);
  result(readFileSync(outs[2]).toString('latin1', 0, 5) === '%PDF-', 'PDF is a PDF');
  const lightSvg = readFileSync(outs[3], 'utf8'), darkSvg = readFileSync(outs[4], 'utf8');
  result(lightSvg.includes('@media not all') && darkSvg.includes('@media all'), 'split SVGs fix the theme');
  const chk = run('check.mjs', [outs[4], '--quiet']);
  result(chk.code === 0, 'the fixed dark SVG still passes the checks', chk.code ? chk.out.trim() : '');
}

/* 3b. export without a browser: renderer output when one is on PATH, a clear skip otherwise */
{
  const nb = join(WORK, 'nobrowser');
  const r = run('export.mjs', [src, '--out', nb], { CLEAN_DIAGRAMS_BROWSER: 'none' });
  const flatOk = ['before-after.flat.svg', 'before-after.flat.dark.svg', 'before-after.light.svg'].every((f) => existsSync(join(nb, f)));
  const flat = flatOk ? readFileSync(join(nb, 'before-after.flat.svg'), 'utf8') : '';
  result(r.code === 0 && flatOk && !flat.includes('var(') && !flat.includes('<style'), 'export without a browser writes flattened SVGs with no CSS left', r.code ? r.out : '');
  const png = existsSync(join(nb, 'before-after.png')), pdf = existsSync(join(nb, 'before-after.pdf'));
  const skippedPng = /skipped PNG/.test(r.out), skippedPdf = /skipped PDF/.test(r.out);
  result((png || skippedPng) && (pdf || skippedPdf), `export without a browser: PNG ${png ? 'written' : 'skipped with a note'}, PDF ${pdf ? 'written' : 'skipped with a note'}`, r.out.trim().split('\n').slice(-2).join(' | '));
  if (png) result(readFileSync(join(nb, 'before-after.png')).readUInt32BE(16) === 1520, 'renderer PNG is 2x the viewBox width');
  if (pdf) {
    /* page objects may sit in compressed object streams: search the inflated streams too */
    const raw = readFileSync(join(nb, 'before-after.pdf'));
    const parts = [raw.toString('latin1')];
    for (const m of raw.toString('latin1').matchAll(/stream\r?\n/g)) {
      const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
      try { parts.push(inflateSync(raw.subarray(start, end)).toString('latin1')); } catch { /* not deflated */ }
    }
    const bytes = parts.join('\n');
    const box = bytes.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
    result(!!box && Math.round(Number(box[1])) === 570 && Math.round(Number(box[2])) === 270, 'renderer PDF is the diagram\'s size (760x360 px = 570x270 pt)', box ? `${box[1]}x${box[2]}` : 'no MediaBox');
    /* fonts in the PDF, if any, must be the bundled one: never a substitute */
    const fonts = [...bytes.matchAll(/\/BaseFont\s*\/([\w+-]+)/g)].map((m) => m[1]);
    result(fonts.every((f) => /LiberationSans/.test(f)), 'renderer PDF uses only the bundled font', fonts.join(', ') || 'text outlined, no font objects');
  }
  if (png || pdf) {
    /* with no font anywhere, the export must fail and leave nothing at the output path */
    const empty = join(WORK, 'empty-fonts'), out = join(WORK, 'nofont');
    mkdirSync(empty, { recursive: true });
    const f = run('export.mjs', [src, '--png', '--pdf', '--out', out], { CLEAN_DIAGRAMS_BROWSER: 'none', CLEAN_DIAGRAMS_FONT_DIR: empty, CLEAN_DIAGRAMS_SYSTEM_FONTS: '0' });
    const left = ['before-after.png', 'before-after.dark.png', 'before-after.pdf'].filter((x) => existsSync(join(out, x)));
    result(f.code === 1 && /font/i.test(f.out) && left.length === 0 || (f.code === 1 && /font/i.test(f.out) && !png && left.length === 0),
      'export with no usable font fails and writes no picture', `exit ${f.code}; left: ${left.join(', ') || 'none'}; ${f.out.trim().split('\n').pop()}`);
  }
}

/* 4. draw.io conversion and the round trip through extract */
for (const t of templates) {
  const p = join(WORK, t);
  writeFileSync(p, readFileSync(join(TPL, t)));
  const c = run('to-drawio.mjs', [p]);
  const out = p.replace(/\.svg$/, '.drawio');
  if (c.code !== 0 || !existsSync(out)) { result(false, `to-drawio ${t}`, c.out); continue; }
  const xml = readFileSync(out, 'utf8');
  const tplSrc = readFileSync(join(TPL, t), 'utf8');
  const wantNodes = (tplSrc.match(/<g class="(node|group)"/g) || []).length;
  const wantEdges = (tplSrc.match(/<path class="edge/g) || []).length;
  const gotEdges = (xml.match(/edge="1"/g) || []).length;
  const connected = (xml.match(/edge="1" parent="1" source="[^"]+" target="[^"]+"/g) || []).length;
  const ids = [...tplSrc.matchAll(/<g class="(?:node|group)" id="([^"]+)"/g)].map((m) => m[1]);
  const allIds = ids.every((id) => xml.includes(`<mxCell id="${id}"`));
  result(gotEdges === wantEdges && connected === wantEdges && allIds, `to-drawio ${t}: ${wantNodes} shapes, ${wantEdges} connected arrows`, `edges ${gotEdges}, connected ${connected}, all ids ${allIds}`);
  const x = run('extract.mjs', [out]);
  const listed = ids.every((id) => x.out.includes(`  ${id}  `));
  result(x.code === 0 && listed, `extract reads back every box of ${t}`, x.code ? x.out : '');
}

console.log(`\n${n - failed}/${n} passed${failed ? `, ${failed} FAILED` : ''} · work dir ${WORK}`);
process.exit(failed ? 1 : 0);
