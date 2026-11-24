import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { discoverProviderProfiles } from '../provider-profiles.mjs';
import { validateManifest } from '../resolver.mjs';
import assert from 'node:assert/strict';
import { replayMoomooQuote, bindMoomooSnapshot, replayMoomooSnapshot, replayMoomooOrderBook, replayMoomooTicker, replayMoomooKline } from '../connectors/moomoo.mjs';
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

const book = { type: 'ORDER_BOOK', symbol, data: { data_time_ms: 1700000000000,
  bid_list: [{ price: 343.8, volume: 800, order_count: 2 }],
  ask_list: [{ price: 344, volume: 1000, order_count: 3 }] } };

test('order-book replay projects documented bid/ask levels as decimal text', () => {
  const projected = replayMoomooOrderBook(symbol, book);
  assert.deepEqual(projected.bids, [{ price: '343.8', volume: 800, orderCount: 2 }]);
  assert.deepEqual(projected.asks, [{ price: '344', volume: 1000, orderCount: 3 }]);
  assert.equal(projected.marketTimeUtc, '2023-11-14T22:13:20.000Z');
  assert.equal(projected.pricePrecision, 'provider-double');
  assert.equal(projected.currency, null);
  assert.throws(() => replayMoomooOrderBook('US.AAPL', book), /SECURITY_MISMATCH/);
  assert.throws(() => replayMoomooOrderBook(symbol, { ...book, type: 'TICKER' }), /SECURITY_MISMATCH/);
  assert.throws(() => replayMoomooOrderBook(symbol, { ...book, data: { ...book.data, data_time_ms: -1 } }), /INVALID_MARKET_TIME/);
  const badLevel = { ...book, data: { ...book.data, bid_list: [{ price: NaN, volume: 1, order_count: 1 }] } };
  assert.throws(() => replayMoomooOrderBook(symbol, badLevel), /INVALID_SNAPSHOT/);
});

test('ticker replay keeps direction and price but leaves sequence opaque', () => {
  const tape = { type: 'TICKER', symbol, data: { ticker_list: [
    { time_ms: 1700000000123, sequence: 9007199254740993, direction: 'BUY', price: 344, volume: 100, turnover: 34400, type: 'NORMAL' }] } };
  const [tick] = replayMoomooTicker(symbol, tape).ticks;
  assert.deepEqual(tick, { marketTimeUtc: '2023-11-14T22:13:20.123Z', direction: 'BUY', price: '344', volume: 100, turnover: '34400' });
  assert.ok(!Object.hasOwn(tick, 'sequence'));
  const badDirection = { ...tape, data: { ticker_list: [{ ...tape.data.ticker_list[0], direction: 'SIDEWAYS' }] } };
  assert.throws(() => replayMoomooTicker(symbol, badDirection), /INVALID_SNAPSHOT/);
  assert.throws(() => replayMoomooTicker(symbol, { ...tape, data: {} }), /INVALID_SNAPSHOT/);
});

test('kline replay projects OHLC decimal text and declares period/adjust', () => {
  const candles = { type: 'KLINE', symbol, data: { period: '1D', adjust: 'none', kl_list: [
    { time_ms: 1700000000000, open_price: 386.6, high_price: 388, low_price: 333, close_price: 344, volume: 35289665, turnover: 11960782218 }] } };
  const projected = replayMoomooKline(symbol, candles);
  assert.equal(projected.period, '1D');
  assert.equal(projected.adjust, 'none');
  assert.deepEqual(projected.bars, [{ marketTimeUtc: '2023-11-14T22:13:20.000Z',
    open: '386.6', high: '388', low: '333', close: '344', volume: 35289665, turnover: '11960782218' }]);
  assert.throws(() => replayMoomooKline(symbol, { ...candles, data: { ...candles.data, period: undefined } }), /INVALID_SNAPSHOT/);
  const badClose = { ...candles, data: { ...candles.data, kl_list: [{ ...candles.data.kl_list[0], close_price: 0 }] } };
  assert.throws(() => replayMoomooKline(symbol, badClose), /INVALID_SNAPSHOT/);
  assert.throws(() => replayMoomooKline('SH.600000', candles), /UNSUPPORTED_SECURITY/);
});


test('the documented QUOTE frame preserves event time, zero volume, and missing session fields', () => {
  const frame = { type: 'QUOTE', symbol, data: { data_time_ms: 1710000000000, last_price: 180.12,
    open_price: 178.5, prev_close_price: 179.66, volume: 0, suspension: false, sec_status: 'NORMAL' } };
  const quote = replayMoomooQuote(symbol, frame);
  assert.equal(quote.last, '180.12');
  assert.equal(quote.marketTimeUtc, '2024-03-09T16:00:00.000Z');
  assert.equal(quote.volume, 0);
  assert.equal(quote.high, null);
  assert.equal(quote.suspended, false);
  assert.equal(quote.currency, null);
  assert.throws(() => replayMoomooQuote('US.AAPL', frame), /SECURITY_MISMATCH/);
  assert.throws(() => replayMoomooQuote(symbol, { ...frame, data: { last_price: -1 } }), /INVALID_SNAPSHOT/);
});

test('the published catalog resolves offline and keeps documented HTTP schemas separate from host descriptors', async () => {
  const { default: catalog } = await import('agentic-gateway/connectors/moomoo-catalog.json', { with: { type: 'json' } });
  assert.equal(catalog.authority, false);
  assert.equal(catalog.sources.length, 305);
  assert.equal(catalog.sources.filter(row => row.imported === false).length, 109);
  assert.equal(new Set(catalog.tools.map(row => row.name)).size, 107);
  assert.equal(catalog.tools.length, 107);
  assert.match(catalog.directory_sha256, /^[a-f0-9]{64}$/);
  assert.ok(catalog.tools.every(row => /^[a-f0-9]{64}$/.test(row.http_schema_sha256)));
  assert.equal(catalog.tools.find(row => row.name === 'trading_order_place').http, 'POST /api/v1.0/accounts/{acc_id}/orders');
  const quotePush = catalog.sources.find(row => row.path === '/api/quote/push/data-format');
  assert.equal(quotePush.routes.filter(route => route.startsWith('PUSH ')).length, 6);
  assert.ok(catalog.sources.find(row => row.path === '/api/quote/calendar/earnings-calendar').routes
    .includes('GET /api/v1.0/quote/earnings-calendar'));
});

test('public HTTP field data reconciles every tool with the pinned catalog and preserves nested constraints', async () => {
  const { default: spec } = await import('agentic-gateway/connectors/moomoo-fields.json', { with: { type: 'json' } });
  const { default: catalog } = await import('agentic-gateway/connectors/moomoo-catalog.json', { with: { type: 'json' } });
  assert.equal(spec.authority, false);
  assert.equal(spec.directory_sha256, catalog.directory_sha256);
  assert.deepEqual(spec.tools.map(row => row.name), catalog.tools.map(row => row.name));
  const quote = spec.tools.find(row => row.name === 'quote_stock_quote');
  assert.deepEqual(quote.body[0], { name: 'code_list', type: 'string_array', required: true, minItems: 1, maxItems: 400 });
  assert(quote.response.length > 1);
  const news = spec.tools.find(row => row.name === 'news_search');
  assert.equal(news.params.find(field => field.name === 'keyword').maxLength, 200);
  assert.equal(news.wrap, 'items');
  assert(news.response.includes('publish_time'));
  const order = spec.tools.find(row => row.name === 'trading_order_place');
  assert.deepEqual(order.path, ['acc_id']);
  assert(order.body.find(field => field.name === 'multi_leg_info').fields.some(field => field.name === 'option_strategy'));
});

test('field projection refuses directory or tool drift and malformed request fields', async () => {
  const { projectFields } = await import('../tools/project-moomoo-catalog.mjs');
  const { createHash } = await import('node:crypto');
  const sha = value => createHash('sha256').update(value).digest('hex');
  function fixture(params) {
    const httpSchema = JSON.stringify({ apiId: 'quote_fixture', method: 'GET', path: '/api/v1.0/quote/x',
      request: { params, body: [] }, response: { fields: { price: {} } } });
    const raw = JSON.stringify({ ok: true, data: { tools: [{ httpSchema }] } });
    return { raw, catalog: { schema: 'moomoo-documentation-catalog/v1', authority: false, directory_sha256: sha(raw),
      tools: [{ name: 'quote_fixture', http: 'GET /api/v1.0/quote/x', http_schema_sha256: sha(httpSchema) }] } };
  }
  const { raw, catalog } = fixture([{ name: 'code', type: 'string' }]);
  assert.deepEqual(projectFields(catalog, raw).tools[0].params, [{ name: 'code', type: 'string' }]);
  assert.throws(() => projectFields(catalog, raw + ' '), /PUBLIC_DIRECTORY_DRIFT/);
  assert.throws(() => projectFields({ ...catalog, tools: [] }, raw), /PUBLIC_TOOL_DRIFT/);
  const invalid = fixture([{ name: 'x', type: 'object', sub_fields: [{ name: 'a', type: 'string', required: 1 }] }]);
  assert.throws(() => projectFields(invalid.catalog, invalid.raw), /INVALID_PUBLIC_FIELDS/);
});
