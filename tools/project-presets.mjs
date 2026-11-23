// Build-time adapter for the authored OS YAML. The published runtime reads JSON and selected text.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Text, openPresetCatalog } from '../presets.mjs';

const checkout = process.argv[2];
if (!checkout) throw new Error('Supply the Graph checkout with its installed OS and YAML parser');
const require = createRequire(resolve(checkout, 'package.json'));
const revision = 'b2966d88f57abfec7f4f1c0211c9740526a98c67';
const sourceDigest = 'f591419b291c489e70cb2b7d61bdc90993f9598a982c892da7bb866a1b903adf';
const path = 'runtime/agents/docs/PROMPT-PRESETS.md';
const text = await readFile(resolve(checkout, 'node_modules/agentic-os', path), 'utf8');
if (await sha256Text(text) !== sourceDigest) throw new Error('OS preset source differs from the accepted pin');
const match = /^---\r?\n([\s\S]+?)\r?\n---\r?\n/.exec(text);
if (!match) throw new Error('Missing OS frontmatter');
const catalog = require('js-yaml').load(match[1]);
if (catalog.schema !== 'agentic-os-prompt-preset-catalog/v1') throw new Error('Unsupported OS catalog');
const output = fileURLToPath(new URL('../catalog/',import.meta.url));
const bodies = new Map(), presets = [];
for (const {prompt,...metadata} of catalog.prompt_presets) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Missing body for ' + metadata.id);
  const body = prompt.trim(), bodyDigest = await sha256Text(body);
  bodies.set(bodyDigest,body); presets.push({...metadata,bodyDigest});
}
const index = JSON.stringify({schema:'gateway/preset-index/v1',source:{owner:'agentic-os',path,revision,digest:sourceDigest},presets})+'\n';
const pin = {revision,sourceDigest,indexDigest:await sha256Text(index)};
await openPresetCatalog(index,pin);
await mkdir(join(output,'bodies'),{recursive:true});
for (const [hash,body] of bodies) await writeFile(join(output,'bodies',hash+'.txt'),body);
await writeFile(join(output,'index.json'),index);
await writeFile(join(output,'pin.json'),JSON.stringify(pin)+'\n');
await writeFile(join(output,'LICENSE.agentic-os'),await readFile(resolve(checkout,'node_modules/agentic-os/LICENSE')));
console.log(JSON.stringify({presets:presets.length,bodies:bodies.size,indexBytes:Buffer.byteLength(index),...pin}));
