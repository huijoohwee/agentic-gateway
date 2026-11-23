import test from 'node:test';
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
  assert.deepEqual(ok.value, { provider:'moomoo', symbol, evidence:'sdk-response', price:'302.25',
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
