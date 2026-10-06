#!/usr/bin/env node
/**
 * icons.mjs — put the icons a diagram uses into the diagram, or find an icon.
 *
 *   node icons.mjs <diagram.svg>        add a <symbol> for every icon the file uses, remove unused ones
 *   node icons.mjs --search <words…>    list icons whose name or tags match all the words
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
const USAGE = 'node icons.mjs <diagram.svg>   |   node icons.mjs --search <words…>';
/* Architecture words Lucide's own tags do not cover; the same map as the table in style.md. */
const CONCEPTS = {
  'on premises': 'building', 'on-premises': 'building', 'data centre': 'building', 'data center': 'building', datacenter: 'building', office: 'building',
  cloud: 'cloud', account: 'cloud', project: 'cloud', subscription: 'cloud', aws: 'cloud', gcp: 'cloud', azure: 'cloud',
  kubernetes: 'ship-wheel', k8s: 'ship-wheel', cluster: 'ship-wheel', region: 'map-pin', zone: 'map-pin', internet: 'globe', external: 'globe', saas: 'globe',
  network: 'network', vpc: 'network', vnet: 'network', server: 'server', vm: 'server', 'virtual machine': 'server', host: 'server',
  container: 'container', pod: 'container', docker: 'container', function: 'square-function', serverless: 'square-function', lambda: 'square-function',
  service: 'box', microservice: 'box', api: 'braces', 'web app': 'app-window', frontend: 'app-window', website: 'app-window', mobile: 'smartphone',
  user: 'user', person: 'user', customer: 'user', analyst: 'user', analysts: 'users', team: 'users', group: 'users',
  database: 'database', db: 'database', sql: 'database', postgres: 'database', oracle: 'database', mysql: 'database', dynamodb: 'database', table: 'database',
  cache: 'database-zap', redis: 'database-zap', warehouse: 'warehouse', bigquery: 'warehouse', snowflake: 'warehouse', redshift: 'warehouse', lake: 'warehouse',
  'object storage': 'archive', bucket: 'archive', s3: 'archive', storage: 'archive', files: 'archive', disk: 'hard-drive', volume: 'hard-drive',
  queue: 'inbox', sqs: 'inbox', 'message queue': 'inbox', stream: 'radio-tower', kafka: 'radio-tower', 'pub/sub': 'radio-tower', pubsub: 'radio-tower', events: 'radio-tower', 'event bus': 'radio-tower',
  gateway: 'shield', firewall: 'shield', policy: 'shield', security: 'shield', fraud: 'shield', 'load balancer': 'split', balancer: 'split', proxy: 'split',
  identity: 'key-round', idp: 'key-round', auth: 'key-round', sso: 'key-round', secrets: 'lock-keyhole', vault: 'lock-keyhole',
  scheduler: 'clock', cron: 'clock', batch: 'cog', job: 'cog', worker: 'cog', agent: 'bot', 'ai agent': 'bot', model: 'brain', llm: 'brain', ml: 'brain',
  pipeline: 'workflow', 'ci/cd': 'workflow', ci: 'workflow', repository: 'git-branch', repo: 'git-branch', git: 'git-branch',
  dashboard: 'layout-dashboard', looker: 'layout-dashboard', grafana: 'layout-dashboard', metrics: 'activity', monitoring: 'activity', logs: 'scroll-text', alerts: 'bell',
  email: 'mail', chat: 'message-square', document: 'file-text', payments: 'credit-card', bank: 'landmark', 'core banking': 'landmark', integration: 'plug', plugin: 'plug',
};

const argv = process.argv.slice(2);
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
