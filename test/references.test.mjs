import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openReferenceIndex } from '../references.mjs';

const read = name => readFileSync(new URL('../references/' + name, import.meta.url), 'utf8');
const index = read('index.json'), pin = JSON.parse(read('pin.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const open = async entries => {
  const text = JSON.stringify({schema: 'gateway/reference-index/v1', entries});
  return openReferenceIndex(text, {indexDigest: hash(text)});
};

test('packaged references cover all five kinds, with immutable owner pins and owner route status', async () => {
  const catalog = await openReferenceIndex(index, pin);
  const rows = catalog.list();
  assert.deepEqual(new Set(rows.map(r => r.kind)), new Set(['schema', 'skill', 'command-catalog', 'route-dictionary', 'guideline']));
  assert.deepEqual(rows.find(r => r.id === 'guideline/prd-tad-adr-mvp-gtm').routes,
    [{token: '/prd-tad.create', status: 'metadata-only'}]);
  const commands = rows.find(r => r.kind === 'command-catalog').routes;
  assert.equal(commands.some(r => ['/artifact.create', '/prd-tad.create'].includes(r.token)), false);
  assert.ok(commands.some(r => r.token === '/doctor' && r.status === 'runtime-declared'));
  assert.ok(rows.filter(r => r.routes.some(route => route.token === '/artifact.create')).every(r =>
    r.routes.find(route => route.token === '/artifact.create').status === 'metadata-only'));
  assert.equal(rows.find(r => r.kind === 'schema').owner, 'huijoohwee.github.io');
});

test('list isolates metadata and select hashes the exact returned bytes once', async () => {
  const bytes = Uint8Array.of(0xff, 0x0d, 0x0a);
  const row = {...JSON.parse(index).entries[0], digest: hash(bytes)};
  const catalog = await open([row]);
  let calls = 0;
  catalog.list()[0].path = 'untrusted';
  const readBody = ref => {
    calls++;
    assert.deepEqual(ref, row);
    ref.revision = '';
    return bytes;
  };
  assert.equal(calls, 0);
  for (const key of [row.id, row.aliases[0]]) {
    const result = await catalog.select(key, readBody);
    assert.deepEqual(result.metadata, row);
    assert.deepEqual(result.bytes, bytes);
  }
  assert.equal(calls, 2);
  await assert.rejects(catalog.select('absent', readBody), {code: 'unknown_reference'});
  assert.equal(calls, 2);
  await assert.rejects(catalog.select(row.id, () => 'changed'), {code: 'body_digest_mismatch'});
  await assert.rejects(catalog.select(row.id, () => { throw Error('owner offline'); }), {code: 'owner_unavailable'});
});

test('rejects stale pins, duplicate IDs, alias collisions, body content and invalid metadata', async () => {
  const row = JSON.parse(index).entries[0];
  await assert.rejects(openReferenceIndex(index, {}), {code: 'missing_pin'});
  await assert.rejects(openReferenceIndex(index + ' ', pin), {code: 'stale_pin'});
  await assert.rejects(open([row, row]), {code: 'ambiguous_reference'});
  await assert.rejects(open([row, {...row, id: 'guideline/other'}]), {code: 'ambiguous_reference'});
  for (const patch of [{body: 'owner content'}, {revision: 'main'}, {path: '../outside'}, {routes: [{token: '/x', status: 'invocable'}]}]) {
    await assert.rejects(open([{...row, ...patch}]), {code: 'invalid_reference'});
  }
});
