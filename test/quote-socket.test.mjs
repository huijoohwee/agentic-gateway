import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMoomooQuoteCapture, MOOMOO_QUOTE_SOCKET } from '../connectors/moomoo-quote-socket.mjs';

const symbol = 'HK.00700';
const grant = (overrides = {}) => ({ right: 'quote:read', symbol, type: 'quote', entitled: true,
  providerHardCapUsd: 0, reservedSessions: 1, reservedKeys: 1, reservedControlCalls: 3,
  expiresAt: Date.now() + 60_000, controlTimeoutMs: 2_000, captureMs: 1_000, frameLimit: 1, ...overrides });
const quote = (code = symbol) => ({ type: 'QUOTE', symbol: code, data: { last_price: 302.5 } });
const tick = (sequence, price = '3.25') => '{"time_ms":1700000000000,"direction":"BUY","volume":1,"turnover":3.25,"type":"NORMAL","price":' + price + ',"sequence":' + sequence + '}';
const tape = (...rows) => '{"type":"TICKER","symbol":"HK.00700","data":{"ticker_list":[' + rows.join(',') + ']}}';

class Peer extends EventTarget {
  constructor() { super(); this.url = MOOMOO_QUOTE_SOCKET; this.readyState = 0; this.sent = []; this.closed = 0; }
  connect() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  send(value) { this.sent.push(JSON.parse(value)); }
  incoming(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
  ack(extra = {}) { this.incoming({ id: this.sent.at(-1).id, code: 0, message: '', ...extra }); }
  close() { this.closed++; this.readyState = 3; }
}

function setup(overrides = {}, host = {}) {
  const peer = new Peer(), credentials = [], dials = [];
  const read = bindMoomooQuoteCapture({ grant: grant(overrides),
    openSocket: url => { dials.push(url); return peer; },
    accessToken: () => { credentials.push('read'); return 'local-fixture'; }, ...host });
  return { peer, read, credentials, dials };
}
function subscribe(peer) {
  peer.connect();
  peer.incoming({ id: peer.sent[0].id, session_id: 'private-session', server_time: 1782357937000000 });
  peer.ack();
}

test('pins the quote origin, waits for login and subscription acknowledgements and releases the precise key', async () => {
  const { read, peer, credentials, dials } = setup();
  const promise = read();
  assert.deepEqual(dials, [MOOMOO_QUOTE_SOCKET]);
  assert.deepEqual(credentials, []);
  peer.connect();
  assert.deepEqual(peer.sent[0].data, { auth_type: 'oauth2', authorization: 'Bearer local-fixture' });
  peer.incoming({ id: peer.sent[0].id, session_id: 'private-session', server_time: 1782357937000000 });
  assert.deepEqual(peer.sent.map(x => x.action), ['auth', 'subscribe']);
  assert.deepEqual(peer.sent[1].quote, [symbol]);
  peer.ack(); peer.incoming(quote());
  assert.equal(peer.sent[2].action, 'unsubscribe');
  assert.deepEqual(peer.sent[2].quote, peer.sent[1].quote);
  peer.incoming(quote()); peer.ack();
  const result = await promise;
  assert.equal(result.frames.length, 1); assert.equal(result.frames[0].last, '302.5');
  assert.equal(result.frames[0].evidence, 'socket-frame'); assert.equal(result.receivedMessages, 5);
  assert.doesNotMatch(JSON.stringify(result), /local-fixture|private-session/);
  assert.equal(peer.closed, 1); assert.equal(new Set(peer.sent.map(x => x.id)).size, 3);
  await assert.rejects(read(), /STREAM_GRANT_SPENT/); assert.equal(dials.length, 1);
});

test('refuses before dialing on cost, scope, key, dimensions, expiry or insufficient reservations', async () => {
  for (const bad of [{ right: 'trade:read' }, { entitled: false }, { providerHardCapUsd: null },
    { reservedSessions: 2 }, { reservedControlCalls: 2 }, { reservedKeys: 0 }, { captureMs: 60001 },
    { frameLimit: 0 }, { type: 'broker_queue' }, { type: 'kline', period: '2m', adjust: 'none' },
    { type: 'kline', period: '1D' }, { adjust: 'forward' }, { symbol: 'invalid' }]) {
    assert.throws(() => setup(bad), /REQUIRED|INVALID/);
  }
  const { read, dials } = setup({ expiresAt: Date.now() - 1 });
  await assert.rejects(read(), /STREAM_EXPIRED/); assert.deepEqual(dials, []);
  const other = setup(); await assert.rejects(other.read({ signal: AbortSignal.abort() }), /CAPTURE_ABORTED/);
  assert.deepEqual(other.dials, []);
});

test('refuses wrong origin before obtaining the token and hides credential/provider error text', async () => {
  const wrong = setup(), bad = wrong.read();
  wrong.peer.url = 'wss://example.invalid/ws'; wrong.peer.connect();
  await assert.rejects(bad, /QUOTE_ORIGIN_MISMATCH/);
  assert.deepEqual(wrong.credentials, []); assert.deepEqual(wrong.peer.sent, []);
  const host = setup({}, { accessToken() { throw Error('secret'); } }), missing = host.read();
  host.peer.connect(); await assert.rejects(missing, { message: 'QUOTE_CREDENTIAL_UNAVAILABLE' });
  const refused = setup(), fail = refused.read();
  refused.peer.connect(); refused.peer.incoming({ code: 4002, msg: 'secret' });
  await assert.rejects(fail, { message: 'QUOTE_PROVIDER_REFUSED_4002' });
  assert.equal(refused.peer.sent.length, 1);
});

test('requires matching acknowledgements and refuses early delivery, quota and disconnection', async () => {
  for (const [when, event, error] of [
    ['auth', { id: 'stale', session_id: 'other', server_time: 1 }, /QUOTE_ACK_MISMATCH/],
    ['auth', 'ack', /INVALID_QUOTE_AUTH_ACK/],
    ['subscribe', quote(), /UNACKNOWLEDGED_QUOTE_FRAME/],
    ['subscribe', { code: 4, message: 'account details' }, /QUOTE_PROVIDER_REFUSED_4/],
    ['active', quote('US.AAPL'), /SECURITY_MISMATCH/],
    ['active', 'close', /QUOTE_DISCONNECTED/],
    ['unsubscribe', { id: 'stale', code: 0 }, /QUOTE_ACK_MISMATCH/],
  ]) {
    const { read, peer } = setup(), promise = read(); peer.connect();
    if (when !== 'auth') peer.ack({ session_id: 'fixture', server_time: 1782357937000000 });
    if (['active', 'unsubscribe'].includes(when)) peer.ack();
    if (when === 'unsubscribe') peer.incoming(quote());
    if (event === 'ack') peer.ack();
    else if (event === 'close') peer.dispatchEvent(new Event('close'));
    else peer.incoming(event);
    await assert.rejects(promise, error); assert.equal(peer.closed, 1);
  }
});

test('binds period and adjustment and filters derived messages outside the reserved topic', async () => {
  const { read, peer } = setup({ type: 'kline', period: '1D', adjust: 'none' });
  const promise = read(); subscribe(peer);
  assert.deepEqual(peer.sent[1].kline, [{ symbol, period: '1D', adjust: 'none' }]);
  peer.incoming({ type: 'MARKET_STATE', data: { market: 'HK' } });
  peer.incoming({ type: 'KLINE', symbol, data: { period: '1D', adjust: 'forward', kl_list: [] } });
  await assert.rejects(promise, /KLINE_DIMENSION_MISMATCH/);
  const book = setup({ type: 'order_book' }), result = book.read(); subscribe(book.peer);
  book.peer.incoming({ type: 'BROKER_QUEUE', symbol, data: {} });
  book.peer.incoming({ type: 'ORDER_BOOK', symbol, data: { bid_list: [], ask_list: [] } });
  book.peer.ack(); assert.equal((await result).frames.length, 1);
});

test('preserves adjacent 64-bit ticker IDs and drops redelivery only for matching ticks', async () => {
  const first = '7647056964060558023', next = '7647056964060558024';
  const { read, peer } = setup({ type: 'ticker', frameLimit: 2 }), promise = read(); subscribe(peer);
  peer.incoming(tape(tick(first))); peer.incoming(tape(tick(first)));
  peer.incoming(tape(tick(first), tick(next))); peer.ack();
  const result = await promise;
  assert.deepEqual(result.frames.flatMap(f => f.ticks.map(t => t.sequence)), [first, next]);
  const conflict = setup({ type: 'ticker', frameLimit: 2 }), fail = conflict.read(); subscribe(conflict.peer);
  conflict.peer.incoming(tape(tick(first, '3.25000000000000001')));
  conflict.peer.incoming(tape(tick(first, '3.25000000000000002')));
  await assert.rejects(fail, /CONFLICTING_TRADE/);
});

test('quiet markets unsubscribe on time, and expiry, abort, oversized or excessive frames close the socket', async () => {
  const quiet = setup({ captureMs: 10 }), promise = quiet.read(); subscribe(quiet.peer);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(quiet.peer.sent.at(-1).action, 'unsubscribe');
  quiet.peer.ack(); assert.deepEqual((await promise).frames, []);
  const expired = setup({ expiresAt: Date.now() + 45 }), end = expired.read(); subscribe(expired.peer);
  await assert.rejects(end, /STREAM_EXPIRED/); assert.equal(expired.peer.closed, 1);
  const timeout = setup({ controlTimeoutMs: 10 }); await assert.rejects(timeout.read(), /QUOTE_CONTROL_TIMEOUT/);
  for (const mode of ['bytes', 'messages', 'abort']) {
    const controller = new AbortController(), h = setup(), stopped = h.read({ signal: controller.signal }); subscribe(h.peer);
    if (mode === 'bytes') h.peer.incoming('市'.repeat(161000));
    if (mode === 'messages') for (let i = 0; i < 128; i++) h.peer.incoming({ type: 'MARKET_STATE', data: {} });
    if (mode === 'abort') controller.abort();
    await assert.rejects(stopped, /QUOTE_WIRE_LIMIT|CAPTURE_ABORTED/);
    h.peer.incoming(quote()); assert.equal(h.peer.closed, 1);
  }
});
