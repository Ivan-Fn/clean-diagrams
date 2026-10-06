#!/usr/bin/env node
/**
 * icons.mjs — put the icons a diagram uses into the diagram, or find an icon.
 *
 *   node icons.mjs <diagram.svg>        add a <symbol> for every icon the file uses, remove unused ones
 *   node icons.mjs --search <words…>    list icons whose name or tags match all the words
 *   node icons.mjs --concepts           print the word-to-icon map the search uses, as JSON
 *
 * In the diagram, an icon is
 *   <use class="icon" href="#icon-database" x="38" y="80" width="18" height="18"/>
 * and this script writes the matching
 *   <symbol id="icon-database" viewBox="0 0 24 24" …>…</symbol>
 * into <defs>, so the file stays self-contained (GitHub shows SVG as an image, which
 * cannot load an icon font or another file). Run it after adding, renaming or removing an
 * icon, then run check.mjs.
 *
 * Icons are Lucide (https://lucide.dev, ISC licence; see icons/LICENSE-Lucide.txt): 24-unit
 * outline drawings with 2-unit strokes, which match the diagrams' thin borders.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireFile } from './lib/args.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = JSON.parse(readFileSync(join(HERE, 'icons', 'lucide.json'), 'utf8'));
const TAGS = JSON.parse(readFileSync(join(HERE, 'icons', 'lucide-tags.json'), 'utf8'));
const USAGE = 'node icons.mjs <diagram.svg>   |   node icons.mjs --search <words…>   |   node icons.mjs --concepts';
/* Architecture words Lucide's own tags do not cover. The table under "Icons" in
   references/style.md is the source: it is read here at run time, so the docs and the search
   cannot disagree. EXTRA adds only words the table does not list (product names, short
   forms); where a word is in both, the table wins, and test.mjs fails if they differ. */
const EXTRA = {
  aws: 'cloud', gcp: 'cloud', azure: 'cloud', account: 'cloud', project: 'cloud', 'on-premises': 'building', datacenter: 'building', 'data center': 'building',
  kubernetes: 'ship-wheel', k8s: 'ship-wheel', cluster: 'ship-wheel', vnet: 'network', vm: 'server', host: 'server', docker: 'container', lambda: 'square-function',
  microservice: 'box', frontend: 'app-window', website: 'app-window', mobile: 'smartphone', customer: 'user', analyst: 'user', analysts: 'users',
  db: 'database', sql: 'database', postgres: 'database', oracle: 'database', mysql: 'database', dynamodb: 'database', table: 'database',
  redis: 'database-zap', bigquery: 'warehouse', snowflake: 'warehouse', redshift: 'warehouse', lake: 'warehouse', bucket: 'archive', s3: 'archive', storage: 'archive',
  sqs: 'inbox', stream: 'radio-tower', kafka: 'radio-tower', pubsub: 'radio-tower', events: 'radio-tower', 'event bus': 'radio-tower',
  security: 'shield', fraud: 'shield', balancer: 'split', proxy: 'split', idp: 'key-round', auth: 'key-round', sso: 'key-round', identity: 'key-round',
  batch: 'cog', job: 'cog', agent: 'bot', llm: 'brain', ml: 'brain', ci: 'workflow', repo: 'git-branch', git: 'git-branch',
  looker: 'layout-dashboard', grafana: 'layout-dashboard', monitoring: 'activity', bank: 'landmark', plugin: 'plug', certs: 'badge', pki: 'shield-check', trust: 'shield-check', tls: 'badge', mtls: 'badge',
};
export function conceptTable() {
  const out = new Map();
  let md = '';
  try { md = readFileSync(join(HERE, '..', 'references', 'style.md'), 'utf8'); } catch { return out; }
  const section = md.split(/^## /m).find((s) => s.startsWith('Icons')) || '';
  for (const m of section.matchAll(/^\|\s*([^|`]+?)\s*\|\s*`([a-z0-9-]+)`\s*\|\s*$/gm)) {
    for (const k of m[1].split(',').map((x) => x.replace(/\(.*?\)/g, '').trim().toLowerCase()).filter(Boolean)) out.set(k, m[2]);
  }
  return out;
}
const TABLE = conceptTable();
const CONCEPTS = { ...EXTRA, ...Object.fromEntries(TABLE) };

const argv = process.argv.slice(2);
if (argv[0] === '--concepts') {
  const rows = Object.keys(CONCEPTS).sort().map((k) => ({ word: k, icon: CONCEPTS[k], from: TABLE.has(k) ? 'style.md' : 'icons.mjs', known: !!ICONS[CONCEPTS[k]],
    conflict: TABLE.has(k) && EXTRA[k] && EXTRA[k] !== TABLE.get(k) ? EXTRA[k] : undefined }));
  console.log(JSON.stringify(rows));
  process.exit(0);
}
if (argv[0] === '--search') {
  const words = argv.slice(1).map((w) => w.toLowerCase());
  if (!words.length) { console.error(`usage: ${USAGE}`); process.exit(2); }
  const phrase = words.join(' ');
  const concept = CONCEPTS[phrase] || words.map((w) => CONCEPTS[w]).find(Boolean);
  if (concept) console.log(`${concept.padEnd(28)} suggested for "${phrase}"`);
  const hits = Object.keys(ICONS).map((name) => {
    const hay = [name, ...(TAGS[name] || [])].map((s) => s.toLowerCase());
    if (!words.every((w) => hay.some((h) => h.includes(w)))) return null;
    const score = words.reduce((s, w) => s + (name === w ? 10 : name.split('-').includes(w) ? 5 : name.includes(w) ? 3 : 1), 0);
    return { name, score, tags: (TAGS[name] || []).slice(0, 6) };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, 25);
  if (!hits.length) { if (!concept) console.log(`no icon matches "${words.join(' ')}"; try a broader word, or the table in references/style.md`); process.exit(0); }
  for (const h of hits.filter((x) => x.name !== concept)) console.log(`${h.name.padEnd(28)} ${h.tags.join(', ')}`);
  process.exit(0);
}

const args = parseArgs(argv, { usage: USAGE });
requireFile(args.positional[0], USAGE);
const FILE = resolve(args.positional[0]);
let src = readFileSync(FILE, 'utf8');

const used = [...new Set([...src.matchAll(/<use\b[^>]*\bhref="#icon-([a-z0-9-]+)"/g)].map((m) => m[1]))];
const unknown = used.filter((n) => !ICONS[n]);
if (unknown.length) {
  /* nearest names by edit distance, so a typo ("sheild") still finds the icon */
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  };
  for (const u of unknown) {
    const near = Object.keys(ICONS).map((k) => ({ k, d: dist(u, k) - (k.includes(u.split('-')[0]) ? 1 : 0) })).sort((a, b) => a.d - b.d).slice(0, 6).map((x) => x.k);
    console.error(`unknown icon "${u}"${near.length ? `; similar: ${near.join(', ')}` : ''}. Search with: node icons.mjs --search <word>`);
  }
  process.exit(1);
}

const attrs = (o) => Object.entries(o).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ');
const symbol = (name) => `    <symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`
  + ICONS[name].map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('') + '</symbol>';

/* remove every icon symbol, then write back the ones in use, in the order they are used */
const before = [...src.matchAll(/<symbol id="icon-([a-z0-9-]+)"/g)].map((m) => m[1]);
src = src.replace(/\n?[ \t]*<symbol id="icon-[a-z0-9-]+"[\s\S]*?<\/symbol>/g, '');
if (used.length) {
  const block = used.map(symbol).join('\n');
  if (/<\/defs>/.test(src)) src = src.replace(/<\/defs>/, `${block}\n  </defs>`);
  else src = src.replace(/(<svg\b[^>]*>)/, `$1\n  <defs>\n${block}\n  </defs>`);
}
writeFileSync(FILE, src);
const added = used.filter((n) => !before.includes(n)), removed = before.filter((n) => !used.includes(n));
console.log(`${FILE}: ${used.length} icon${used.length === 1 ? '' : 's'} in use${added.length ? `; added ${added.join(', ')}` : ''}${removed.length ? `; removed ${removed.join(', ')}` : ''}`);
