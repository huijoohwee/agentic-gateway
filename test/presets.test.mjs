import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { openPresetCatalog, sha256Text } from '../presets.mjs';

const text = await readFile(new URL('../catalog/index.json',import.meta.url),'utf8');
const pin = JSON.parse(await readFile(new URL('../catalog/pin.json',import.meta.url),'utf8'));

test('list needs metadata only, and selecting by ID or alias reads the same verified body', async () => {
  const catalog = await openPresetCatalog(text,pin);
  let reads=0;
  async function body(hash) {
    reads++;
    return readFile(new URL('../catalog/bodies/'+hash+'.txt',import.meta.url),'utf8');
  }
  const items = catalog.list();
  assert.ok(items.length > 0);
  assert.ok(items.every(x => !Object.hasOwn(x,'prompt')));
  assert.equal(reads,0);
  const selected = await catalog.select('video-agent',body);
  assert.equal(reads,1);
  assert.deepEqual(await catalog.select('/video-prompt-preset',body),selected);
  assert.equal(selected.metadata.runtime_command,'/video-agent');
  assert.equal(await sha256Text(selected.prompt),selected.metadata.bodyDigest);
});

test('missing pins, stale content and ambiguous aliases fail before body selection', async () => {
  await assert.rejects(openPresetCatalog(text,{}),{code:'missing_pin'});
  await assert.rejects(openPresetCatalog(text+' ',pin),{code:'stale_pin'});
  const duplicate = JSON.parse(text);
  duplicate.presets[1].slash_command=duplicate.presets[0].slash_command;
  const bytes=JSON.stringify(duplicate);
  await assert.rejects(openPresetCatalog(bytes,{...pin,indexDigest:await sha256Text(bytes)}),{code:'ambiguous_preset'});
  const catalog=await openPresetCatalog(text,pin);
  await assert.rejects(catalog.select('video-agent',async ()=>'changed'),{code:'body_digest_mismatch'});
});

test('authoring starters select locally and carry editable native flow source', async () => {
  const catalog = await openPresetCatalog(text, pin);
  const starters = catalog.list().filter(entry => entry.authoring_starter);
  assert.equal(starters.length, 4);
  for (const entry of starters) {
    const selected = await catalog.select(entry.id, hash =>
      readFile(new URL('../catalog/bodies/' + hash + '.txt', import.meta.url), 'utf8'));
    assert.equal(entry.runtime_command, '/canvas.project');
    assert.ok(selected.prompt.startsWith(entry.runtime_command + ' '));
    assert.match(selected.prompt, /\n---\n[\s\S]+\nflow:\n {2}nodes:\n[\s\S]+\n {2}edges:\n/);
  }
});
