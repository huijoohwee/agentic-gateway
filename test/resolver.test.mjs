import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createResolver, validateManifest } from '../resolver.mjs';

const fixture = name => JSON.parse(readFileSync(new URL('../fixtures/' + name + '.json', import.meta.url)));
const manifests = ['video','quote','workbook'].map(fixture);

test('the three owner manifests use one validator', () => {
  for (const m of manifests) assert.equal(validateManifest(m).id, m.id);
  assert.throws(() => validateManifest({...manifests[0], major: 2}));
});

test('accepted loss travels with the native result, and invalid requests never reach the adapter', async () => {
  const [m] = manifests;
  let calls = 0;
  const native = {status:'completed',receipt:'fixture-only'};
  const resolver = createResolver([{manifest:m,bindings:{browser:{
    revision:m.revision,schemaDigest:m.schemaDigest,offline:true,costUsd:0,
    invoke(input,grant) {calls++; assert.equal(input,'fixture'); assert.equal(grant,'local-grant'); return native;},
  }}}]);
  const plan={...m,route:'browser',required:['seek'],acceptedLosses:['editability']};
  assert.deepEqual(resolver.discover()[0].configuredRoutes,['browser']);
  for (const [patch, reason] of [
    [{route:'mcp'},'not_configured'], [{acceptedLosses:[]},'unapproved_loss'],
    [{revision:'0'.repeat(40)},'stale_pin'], [{required:['unknown']},'missing_feature'],
  ]) assert.deepEqual(await resolver.invoke({...plan,...patch}),{ok:false,reason});
  assert.equal(calls,0);
  const result=await resolver.invoke(plan,'fixture','local-grant');
  assert.equal(result.native,native);
  assert.deepEqual(result.losses,['editability']);
  assert.equal(calls,1);
});
