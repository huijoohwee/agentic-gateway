// Build the optional runtime projection from the gateway's authored Markdown.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import { openPresetCatalog, sha256Text } from '../presets.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--check')) {
  throw new Error('Usage: node tools/project-presets.mjs [--check]');
}
const check = args.includes('--check');
const root = new URL('../catalog/', import.meta.url);
const sourcePath = 'catalog/PROMPT-PRESETS.md';
const bytes = await readFile(new URL('PROMPT-PRESETS.md', root));
const frontmatter = /^---\r?\n([\s\S]+?)\r?\n---\r?\n/.exec(bytes.toString('utf8'));
if (!frontmatter) throw new Error('Missing preset catalog frontmatter');
const catalog = load(frontmatter[1]);
if (catalog?.schema !== 'agentic-os-prompt-preset-catalog/v1' || !Array.isArray(catalog.prompt_presets) || !catalog.prompt_presets.length) {
  throw new Error('Expected a nonempty v1 prompt preset catalog');
}

const revision = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const sourceDigest = createHash('sha256').update(bytes).digest('hex');
const source = {owner: 'agentic-gateway', path: sourcePath, revisionKind: 'git-blob', revision, digest: sourceDigest};
const outputs = new Map();
const presets = [];
for (const {prompt, ...metadata} of catalog.prompt_presets) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Missing body for ' + metadata.id);
  const body = prompt.trim();
  const bodyDigest = await sha256Text(body);
  outputs.set('bodies/' + bodyDigest + '.txt', body);
  presets.push({...metadata, bodyDigest});
}

const index = JSON.stringify({schema: 'gateway/preset-index/v1', source, presets}) + '\n';
const pin = {revision, sourceDigest, indexDigest: await sha256Text(index)};
await openPresetCatalog(index, pin);
outputs.set('index.json', index);
outputs.set('pin.json', JSON.stringify(pin) + '\n');

const directory = new URL('bodies/', root);
if (!check) await mkdir(directory, {recursive: true});
for (const [path, expected] of outputs) {
  const url = new URL(path, root);
  if (check) {
    if (await readFile(url, 'utf8') !== expected) throw new Error('Stale projection: ' + path);
  } else {
    await writeFile(url, expected);
  }
}
for (const name of await readdir(directory)) {
  if (outputs.has('bodies/' + name)) continue;
  if (check || !/^[a-f0-9]{64}\.txt$/.test(name)) throw new Error('Unexpected body file: ' + name);
  await unlink(new URL(name, directory));
}
console.log(presets.length + ' presets verified against ' + sourceDigest);
