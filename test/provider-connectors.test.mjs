import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { discoverProviderProfiles } from '../provider-profiles.mjs';
import { validateManifest } from '../resolver.mjs';
import assert from 'node:assert/strict';
import { bindMoomooSnapshot, replayMoomooSnapshot } from '../connectors/moomoo.mjs';
import { importHyperframesHtml } from '../connectors/hyperframes.mjs';

const symbol = 'HK.00700';
const security = { market: 1, code: '00700' };
const row = { security, curPrice: 302.25, updateTimestamp: 1700000000.125, isSuspend: false };
const response = basic => ({ retType: 0, s2c: { snapshotList: [{ basic }] } });
const grant = () => ({ symbol, entitled: true, costUsd: 0, maxCalls: 1, expiresAt: Date.now() + 30000 });

test('one SDK read binds the leading-zero ID and consumes concurrent admission', async () => {
  let calls = 0;
  const read = bindMoomooSnapshot({ async GetSecuritySnapshot(request) {
    calls++; assert.deepEqual(request, { c2s: { securityList: [security] } });
    return response(row);
  } }, grant());
  const [ok, denied] = await Promise.allSettled([read(),read()]);
  assert.equal(calls,1); assert.match(denied.reason.message,/EXHAUSTED/);
  assert.deepEqual(ok.value, { provider:'moomoo', symbol, evidence:'sdk-response', price:'302.25', bid:null, ask:null,
    pricePrecision:'provider-double', currency:null, delayClass:'unknown', suspended:false, marketTimeUtc:'2023-11-14T22:13:20.125Z' });
});

test('snapshot errors and unavailable metadata stay explicit', async () => {
  assert.throws(() => replayMoomooSnapshot(symbol, { retType: -1 }), /PROVIDER_REFUSED/);
  assert.throws(() => replayMoomooSnapshot('US.AAPL', response(row)), /SECURITY_MISMATCH/);
  assert.throws(() => replayMoomooSnapshot(symbol, response({ ...row,curPrice: NaN })), /INVALID_SNAPSHOT/);
  const inherited = Object.assign(Object.create({updateTimestamp:0}), row);
  delete inherited.updateTimestamp;
  assert.equal(replayMoomooSnapshot(symbol, response(inherited)).marketTimeUtc,null);
  const client = {GetSecuritySnapshot(){ throw Error('unexpected dispatch'); }};
  assert.throws(() => bindMoomooSnapshot(client, {...grant(), costUsd: null}), /ZERO_COST/);
  await assert.rejects(bindMoomooSnapshot(client,{...grant(),expiresAt:0})(), /EXHAUSTED/);
});

test('video byte limit is enforced before allocating a DOM', () => {
  assert.throws(() => importHyperframesHtml('界'.repeat(43000)), /too large/);
});

test('each optional quote side preserves only a positive provider price', () => {
  const project = fields => replayMoomooSnapshot(symbol, response(Object.assign(Object.create({bidPrice:123}),row,fields)));
  assert.deepEqual([project({askPrice:302.4}).bid, project({askPrice:302.4}).ask], [null,'302.4']);
  assert.deepEqual([project({bidPrice:302,askPrice:0}).bid, project({bidPrice:302,askPrice:0}).ask], ['302',null]);
  for (const bidPrice of [-1,Infinity,'302']) assert.throws(() => project({bidPrice}), /INVALID_SNAPSHOT/);
});

test('offline discovery checks pinned contract bytes and lists unmet route requirements without dispatch', () => {
  const records = discoverProviderProfiles(['browser-dom','hyperframes-importer','snapshot-replay','opend-reader']);
  assert.equal(records.length,2);
  for (const {manifest} of records) {
    const {schemaDigest,revision,...schema} = manifest;
    assert.equal(createHash('sha256').update(JSON.stringify(schema)).digest('hex'),schemaDigest);
    const name = manifest.id === 'media/hyperframes-import' ? 'hyperframes' : 'moomoo';
    const source = readFileSync(new URL('../connectors/'+name+'.mjs',import.meta.url));
    assert.equal(createHash('sha1').update('blob '+source.length+'\0').update(source).digest('hex'),revision);
    assert.ok(Object.isFrozen(manifest.requirements[manifest.routes[0]]));
    assert.throws(() => validateManifest({...manifest,requirements:{}}));
  }
  assert.equal(records[0].routes[0].available,true);
  assert.equal(records[1].routes[0].available,true);
  assert.deepEqual(records[1].routes[1].missing,['qualified-sdk','signed-in-loopback','symbol-entitled-at-zero-cost']);
  assert.ok(discoverProviderProfiles().every(record => record.routes.every(route => !route.available)));
});
