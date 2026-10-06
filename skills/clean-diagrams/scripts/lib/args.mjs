/**
 * args.mjs — strict command-line parsing shared by the scripts.
 *
 *   const a = parseArgs(process.argv.slice(2), { flags: ['--quiet'], values: ['--out'], usage: '…' });
 *   a.positional, a.flags.has('--quiet'), a.values.get('--out')
 *
 * Accepts "--out dir" and "--out=dir". An unknown flag, a value flag with no value, or a
 * flag given twice prints the usage line and exits 2, so nothing is ever silently ignored.
 */
import { existsSync, statSync } from 'node:fs';

export function parseArgs(argv, { flags = [], values = [], usage, minPositional = 1, maxPositional = 1 }) {
  const fail = (msg) => { console.error(`${msg}\nusage: ${usage}`); process.exit(2); };
  const out = { positional: [], flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out.positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (flags.includes(name)) {
      if (eq > 0) fail(`${name} takes no value`);
      if (out.flags.has(name)) fail(`${name} is given twice`);
      out.flags.add(name);
    } else if (values.includes(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v == null || v === '' || (eq < 0 && v.startsWith('--'))) fail(`${name} needs a value`);
      if (out.values.has(name)) fail(`${name} is given twice`);
      out.values.set(name, v);
    } else fail(`unknown option ${name}`);
  }
  if (out.positional.length < minPositional) fail('missing input file');
  if (out.positional.length > maxPositional) fail(`unexpected argument "${out.positional[maxPositional]}"`);
  return out;
}

/* The input must be an existing file (not a folder). Exits 2 with a message otherwise. */
export function requireFile(path, usage) {
  if (!path || !existsSync(path)) { console.error(`no such file: ${path}\nusage: ${usage}`); process.exit(2); }
  const st = statSync(path);
  if (!st.isFile()) { console.error(`${path} is ${st.isDirectory() ? 'a folder' : 'not a regular file'}\nusage: ${usage}`); process.exit(2); }
}
