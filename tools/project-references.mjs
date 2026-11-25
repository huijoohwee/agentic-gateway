// Build from immutable Git objects. A source-free checkout can still check the packaged projection.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { load } from 'js-yaml';
import { openReferenceIndex } from '../references.mjs';

const {values: {check, owners}} = parseArgs({options: {check: {type: 'boolean'}, owners: {type: 'string'}}});
if (!check && !owners) throw Error('Building requires --owners <local directory of Git repositories>');
const directory = new URL('../references/', import.meta.url);
const read = name => readFileSync(new URL(name, directory), 'utf8');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const seed = read('owners.json');
const pins = JSON.parse(seed);
const files = ['README.md', 'owners.json', 'index.json', 'pin.json'];
for (const file of readdirSync(directory, {withFileTypes: true})) {
  if (!file.isFile() || !files.includes(file.name)) throw Error('Unexpected reference package content: ' + file.name);
}
const entries = [];
const dictionary = new Map();
for (const [owner, pin] of Object.entries(pins)) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(owner) || !/^[a-f0-9]{40}$/.test(pin.revision)
    || Object.keys(pin).sort().join() !== 'entries,revision') throw Error('Invalid owner pin');
  const git = (...args) => execFileSync('git', ['-C', resolve(owners, owner), ...args], {maxBuffer: 500000});
  if (owners) {
    const head = git('rev-parse', 'HEAD').toString().trim();
    if (head !== pin.revision) console.warn(owner + ' HEAD differs from pin: ' + head + ' (pin ' + pin.revision + ')');
  }
  for (const {id, path, aliases = [], tokens = [], ...extra} of pin.entries) {
    if (Object.keys(extra).length || !path.split('/').every(part => /^[\w-][\w.-]*$/.test(part))) throw Error('Invalid source: ' + id);
    const [kind] = id.split('/');
    const base = {id, kind, owner, path, revisionKind: 'git-commit', revision: pin.revision, aliases};
    const entry = {base, tokens};
    if (owners) {
      const bytes = git('cat-file', 'blob', pin.revision + ':' + path);
      const source = bytes.toString('utf8');
      const metadata = path.endsWith('.md') ? load(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1]) : JSON.parse(source);
      if (!metadata) throw Error('Missing owner metadata: ' + id);
      entry.digest = digest(bytes);
      entry.version = metadata.version ?? metadata.schemaVersion ?? metadata.schema ?? null;
      if (kind === 'route-dictionary') {
        if (metadata.status !== 'metadata-only') throw Error('Unknown dictionary status: ' + id);
        for (const token of metadata.dictionary_entries) dictionary.set(token, metadata.status);
      }
      if (kind === 'command-catalog') {
        entry.routes = metadata.entries.map(({token}) => ({token, status: 'runtime-declared'}));
      }
    }
    entries.push(entry);
  }
}

let rows;
if (owners) {
  rows = entries.map(({base, tokens, digest, version, routes}) => ({
    ...base, digest, version, routes: routes ?? tokens.map(token => {
      if (!dictionary.has(token)) throw Error('Unknown dictionary token: ' + token);
      return {token, status: dictionary.get(token)};
    }),
  }));
} else {
  const index = await openReferenceIndex(read('index.json'), JSON.parse(read('pin.json')));
  rows = index.list();

}

const index = JSON.stringify({schema: 'gateway/reference-index/v1', entries: rows}) + '\n';
const pin = {indexDigest: digest(index), ownersDigest: digest(seed)};
await openReferenceIndex(index, pin);
const guide = ['# Gateway references', '',
  'Import `openReferenceIndex` from `agentic-gateway/references`. Pass the exact index text and trusted pin from the same Gateway revision. Use `list()` for metadata, then `select(idOrAlias, readBody)` for verified bytes. The host reader receives the pinned entry. Each route describes its owner’s declaration. Execution requires native admission.', '',
  'Run `npm run references:build -- --owners <workspace>` to rebuild from local owner Git objects. Use `npm run references:check -- --owners <workspace>` to compare the package with those objects and report checkout drift. Both commands run offline.', ''];
for (const {id, owner, revision, path, version, digest} of rows) {
  guide.push('### ' + id, '', '[' + owner + '/' + path + '](https://github.com/huijoohwee/' + owner + '/blob/' + revision + '/' + path + ')', '',
    (version ? 'Version `' + version + '` · ' : '') + 'SHA-256 `' + digest + '`', '');
}
for (const [name, bytes] of [['index.json', index], ['pin.json', JSON.stringify(pin) + '\n'], ['README.md', guide.join('\n')]]) {
  if (!check) writeFileSync(new URL(name, directory), bytes);
  else if (read(name) !== bytes) throw Error('Stale reference projection: ' + name);
}
console.log(rows.length + (owners ? ' references verified against pinned Git objects' : ' packaged references verified'));
