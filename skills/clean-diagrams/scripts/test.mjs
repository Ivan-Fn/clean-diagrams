#!/usr/bin/env node
/**
 * test.mjs — proves the templates pass, that each check fails on the defect it is named
 * for, and that the exports and the draw.io round trip produce what they claim.
 *
 *   node test.mjs [--keep]       (or: npm test)
 *
 * Every defect case breaks one template on purpose and requires the named check in the
 * output. A case whose edit did not apply fails, so a stale case cannot pass silently.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(HERE, '..', 'templates');
const WORK = mkdtempSync(join(tmpdir(), 'clean-diagrams-test-'));
const KEEP = process.argv.includes('--keep');      /* keep the work folder for inspection */
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
  ['text-under-box', 'groups.svg', '<rect class="box tint" x="40" y="100"', '<rect class="box tint" x="40" y="70"'],
  ['loose-text-in-box', 'flow.svg', '</svg>', '<text class="label" x="140" y="118">v2</text>\n</svg>'],
  ['edge-ends', 'flow.svg', 'data-from="browser" data-to="gateway" ', ''],
  ['text-fill', 'flow.svg', '.label { font-size: 11.5px; fill: var(--quiet); }', '.label { font-size: 11.5px; fill: none; }'],
  ['edge-end', 'sequence.svg', 'd="M100 140H287"', 'd="M100 140H280"'],
  ['edge-path', 'flow.svg', 'd="M164 94H214"', 'd="M164 94H1e8"'],
  ['icon-missing', 'boundaries.svg', '<symbol id="icon-shield"', '<symbol id="icon-shield-gone"'],
  ['icon-outside-box', 'boundaries.svg', 'href="#icon-shield" x="54"', 'href="#icon-shield" x="34"'],
  ['icon-over-text', 'boundaries.svg', 'href="#icon-inbox" x="302"', 'href="#icon-inbox" x="322"'],
  ['icon-contrast', 'boundaries.svg', 'use.icon { color: var(--quiet); }', 'use.icon { color: #eeeeee; }'],
  ['icon-on-border', 'boundaries.svg', 'href="#icon-cloud" x="288" y="70"', 'href="#icon-cloud" x="296" y="96"'],
];
/* is a browser available? then every case also runs with the browser pass alone */
const probe = run('check.mjs', [join(TPL, 'flow.svg')]);
const HAVE_BROWSER = / \+ (chromium|chrome|msedge|Chrome at)/.test(probe.out);
const BROWSER_SEES = new Set(['text-outside-box', 'text-overlap', 'label-crowding', 'text-on-border', 'edge-end', 'edge-start', 'edge-through-box',
  'edge-ref', 'edge-over-text', 'contrast', 'font-size', 'text-outline', 'out-of-frame', 'text-out-of-frame', 'boxes-too-close', 'straddles-group',
  'xml', 'text-under-box', 'loose-text-in-box', 'edge-ends', 'text-fill', 'icon-missing', 'icon-outside-box', 'icon-over-text', 'icon-contrast', 'icon-on-border']);
for (const [check, tpl, find, replace] of cases) {
  let p;
  try { p = broken(tpl, find, replace); } catch (e) { result(false, `check ${check}`, e.message); continue; }
  /* once as configured, and once with the browser switched off: the no-browser checker
     must catch every defect on its own */
  const modes = [['', {}, []], [' without a browser', { CLEAN_DIAGRAMS_BROWSER: 'none' }, []]];
  if (HAVE_BROWSER && BROWSER_SEES.has(check)) modes.push([' by the browser pass alone', {}, ['--browser-only']]);
  for (const [mode, env, extra] of modes) {
    const r = run('check.mjs', [p, ...extra], env);
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
  result(!readFileSync(outs[0]).equals(readFileSync(outs[1])), 'the dark PNG differs from the light one');
}
/* a second dark block must be switched off too */
{
  const two = join(WORK, 'twodark.svg');
  writeFileSync(two, readFileSync(join(TPL, 'flow.svg'), 'utf8').replace('</style>', '@media (prefers-color-scheme: dark) { .label { fill: #ffffff; } }\n  </style>'));
  run('export.mjs', [two, '--split', '--out', join(WORK, 'two')]);
  const c = run('check.mjs', [join(WORK, 'two', 'twodark.light.svg'), '--quiet'], { CLEAN_DIAGRAMS_BROWSER: 'none' });
  result(c.code === 0, 'split export switches off every dark-mode block', c.out.trim().split('\n')[0]);
}
/* flattening keeps namespace declarations, so a file saved by Inkscape stays well-formed */
{
  const ns = join(WORK, 'ns.svg');
  writeFileSync(ns, readFileSync(join(TPL, 'flow.svg'), 'utf8').replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"').replace('</svg>', '<sodipodi:namedview id="nv"/>\n</svg>'));
  run('export.mjs', [ns, '--flat', '--out', join(WORK, 'ns')]);
  const c = run('check.mjs', [join(WORK, 'ns', 'ns.flat.svg'), '--quiet'], { CLEAN_DIAGRAMS_BROWSER: 'none' });
  result(!/FAIL\s+xml/.test(c.out), 'flattened SVG of a namespaced file is well-formed', c.out.trim().split('\n')[0]);
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
  if (png) result(!readFileSync(join(nb, 'before-after.png')).equals(readFileSync(join(nb, 'before-after.dark.png'))), 'renderer dark PNG differs from the light one');
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
  /* in a sequence diagram messages are free arrows and each lifeline is one more line */
  const lifelines = (tplSrc.match(/<g class="lifeline"/g) || []).length;
  const wantConnected = lifelines ? 0 : wantEdges;
  result(gotEdges === wantEdges + lifelines && connected === wantConnected && allIds, `to-drawio ${t}: ${wantNodes} shapes, ${wantEdges} arrows${lifelines ? `, ${lifelines} lifelines` : ' connected to their boxes'}`, `edges ${gotEdges}, connected ${connected}, all ids ${allIds}`);
  const x = run('extract.mjs', [out]);
  const listed = ids.every((id) => x.out.includes(`  ${id}  `));
  result(x.code === 0 && listed, `extract reads back every box of ${t}`, x.code ? x.out : '');
}

/* 5. draw.io output details */
{
  const p = join(WORK, 'before-after.svg');
  const xml = readFileSync(p.replace(/\.svg$/, '.drawio'), 'utf8');
  const labelled = [...xml.matchAll(/<mxCell id="(e-[^"]+)" value="([^"]*)"[^>]*edge="1"/g)].filter((m) => m[2]).map((m) => m[1]);
  result(['e-job-account', 'e-account-analytics', 'e-account-admin'].every((id) => labelled.includes(id)), 'to-drawio attaches each arrow label to its arrow', labelled.join(', '));
  result(/fillColor=light-dark\(#f8e7e7,#3a2020\)/.test(xml), 'to-drawio keeps the dark colour of each box');
  run('to-drawio.mjs', [p, join(WORK, 'plain.drawio'), '--plain-labels']);
  result(/value="Report job&#10;nightly batch"/.test(readFileSync(join(WORK, 'plain.drawio'), 'utf8')), '--plain-labels keeps line breaks');
  const seq = readFileSync(join(WORK, 'sequence.drawio'), 'utf8');
  result(!seq.includes('NaN') && (seq.match(/edge="1"/g) || []).length === 11, 'sequence diagram converts with 4 lifelines and 7 messages, no NaN');
}

/* 5b. icons: the script, the flattened file, draw.io */
{
  const tplB = readFileSync(join(TPL, 'boundaries.svg'), 'utf8');
  const f = join(WORK, 'icons.svg');
  /* strip the symbols, let icons.mjs put them back: the result must equal the template */
  writeFileSync(f, tplB.replace(/\n?[ \t]*<symbol id="icon-[\s\S]*?<\/symbol>/g, ''));
  const r1 = run('icons.mjs', [f]);
  result(r1.code === 0 && readFileSync(f, 'utf8') === tplB, 'icons.mjs restores every symbol the diagram uses', r1.out.trim());
  const r2 = run('icons.mjs', [f]);
  result(readFileSync(f, 'utf8') === tplB && /8 icons in use$/.test(r2.out.trim()), 'icons.mjs run twice changes nothing');
  writeFileSync(f, tplB.replace('<use class="icon" href="#icon-building" x="40" y="70" width="16" height="16"/>', ''));
  run('icons.mjs', [f]);
  result(!readFileSync(f, 'utf8').includes('id="icon-building"'), 'icons.mjs removes a symbol no icon uses');
  writeFileSync(f, tplB.replace('#icon-shield"', '#icon-sheild"'));
  const r3 = run('icons.mjs', [f]);
  result(r3.code === 1 && /unknown icon "sheild"; similar: .*shield/.test(r3.out), 'icons.mjs rejects an unknown icon and suggests a name', r3.out.trim().split('\n')[0]);
  const s = run('icons.mjs', ['--search', 'database']);
  result(s.code === 0 && /^database\s/m.test(s.out), 'icons.mjs --search finds an icon by name');
  const fb = join(WORK, 'boundaries.svg');
  run('export.mjs', [fb, '--flat', '--out', join(WORK, 'flatb')]);
  const flat = readFileSync(join(WORK, 'flatb', 'boundaries.flat.svg'), 'utf8');
  result((flat.match(/<symbol /g) || []).length === 8 && /<use[^>]*class="icon accent"[^>]*color="#266dcc"/.test(flat), 'flattened SVG keeps the icons and gives each its colour');
  const xml = readFileSync(join(WORK, 'boundaries.drawio'), 'utf8');
  result((xml.match(/shape=image/g) || []).length === 9 && /id="gateway"[^>]*align=left;spacingLeft=/.test(xml), 'to-drawio places all 9 icons and keeps text beside them left-aligned');
}

/* 6. extract.mjs on every input format */
{
  const { deflateRawSync, deflateSync } = await import('node:zlib');
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<UserObject label="Web app" id="a"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell></UserObject>'
    + '<mxCell id="b" value="Queue" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="300" y="0" width="120" height="60" as="geometry"/></mxCell>'
    + '<mxCell id="e1" style="endArrow=block;dashed=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>'
    + '<mxCell id="e1l" value="enqueue" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1"><mxGeometry relative="1" as="geometry"/></mxCell>'
    + '</root></mxGraphModel>';
  const plain = `<mxfile><diagram name="One" id="p1">${model}</diagram><diagram name="Two" id="p2">${model.replace('Queue', 'Topic')}</diagram></mxfile>`;
  const packed = `<mxfile><diagram name="Packed" id="c">${deflateRawSync(Buffer.from(encodeURIComponent(model), 'latin1')).toString('base64')}</diagram></mxfile>`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const asSvg = `<svg xmlns="http://www.w3.org/2000/svg" content="${esc(plain)}"><rect width="1" height="1"/></svg>`;
  const crc = (buf) => { let c, crcv = 0xffffffff; for (const b of buf) { c = (crcv ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('zTXt', Buffer.concat([Buffer.from('mxfile\0\0', 'latin1'), deflateSync(Buffer.from(encodeURIComponent(plain), 'latin1'))])),
    chunk('IDAT', deflateSync(Buffer.from([0, 0]))), chunk('IEND', Buffer.alloc(0))]);
  const exc = JSON.stringify({ type: 'excalidraw', elements: [
    { id: 'f', type: 'frame', name: 'Backend', x: -20, y: -20, width: 500, height: 120 },
    { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, frameId: 'f', boundElements: [{ id: 't1', type: 'text' }] },
    { id: 't1', type: 'text', containerId: 'r1', text: 'Web app', originalText: 'Web app' },
    { id: 'r2', type: 'rectangle', x: 300, y: 0, width: 120, height: 60, frameId: 'f', boundElements: [{ id: 't2', type: 'text' }] },
    { id: 't2', type: 'text', containerId: 'r2', text: 'Queue', originalText: 'Queue' },
    { id: 'a1', type: 'arrow', x: 120, y: 30, startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' }, endArrowhead: 'arrow', strokeStyle: 'dashed', boundElements: [{ id: 't3', type: 'text' }] },
    { id: 't3', type: 'text', containerId: 'a1', text: 'enqueue', originalText: 'enqueue' },
    { id: 't4', type: 'text', x: 0, y: -60, text: 'Order intake', originalText: 'Order intake' }] });
  const files = { 'x.drawio': plain, 'x-packed.drawio': packed, 'x.drawio.svg': asSvg, 'x.drawio.png': png, 'x.excalidraw': exc };
  for (const [name, body] of Object.entries(files)) {
    const f = join(WORK, name);
    writeFileSync(f, body);
    const r = run('extract.mjs', [f]);
    const ok = r.code === 0 && /boxes: 2\b/.test(r.out) && /"Web app"/.test(r.out) && /"(Queue|Topic)"/.test(r.out) && /-> \S+\s+"enqueue"\s+dashed/.test(r.out);
    result(ok, `extract reads ${name}: 2 boxes, the dashed labelled arrow`, ok ? '' : r.out.trim().split('\n').slice(0, 6).join(' | '));
  }
  const pg = run('extract.mjs', [join(WORK, 'x.drawio'), '--page', '2']);
  result(pg.code === 0 && /"Topic"/.test(pg.out) && /pages: 1\. One \| 2\. Two/.test(pg.out), 'extract --page picks the second page');
}

console.log(`\n${n - failed}/${n} passed${failed ? `, ${failed} FAILED` : ''}${KEEP ? ` · work dir ${WORK}` : ''}`);
if (!KEEP) rmSync(WORK, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
