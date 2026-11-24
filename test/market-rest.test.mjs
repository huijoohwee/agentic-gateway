import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMoomooMarketRequest as build, projectMoomooMarketResponse as project, marketRestRoutes } from 'agentic-gateway/connectors/moomoo-market-rest';
import catalog from 'agentic-gateway/connectors/moomoo-catalog.json' with { type: 'json' };

const quote = 'quote_stock_quote', depth = 'quote_order_book', tape = 'quote_rt_ticker', candles = 'quote_cur_kline';
const symbol = 'HK.00700';
const wire = data => JSON.stringify({ ret_code: 0, data });
const quoteRow = { code: symbol, name: 'Example', data_date: '2026-11-23', data_time: 1795421270000, last_price: '344.00', suspension: false };
const level = { price: '344.1000', volume: '9007199254740993', order_count: 0 };
const book = { exchange: 'SEHK', exchange_data_time_ms: 1795421270000, order_volume_precision: 3,
  bid_flag: 1, ask_flag: 0, bid_list: [level], ask_list: [] };
const tapeRow = { sequence: '7647056964060558023', price: '465.800', volume: '35.75', time: 1780469195226, turnover: '111.000',
  ticker_direction: 'NEUTRAL', period_type: 'AFTER', tick_type: 'AUTO_MATCH', pred_side: 'NO', price_ex: '0.22' };
const candle = { code: symbol, date: 20240229, time_key: 1780243200000, open_price: 12, close_price: 10, low_price: 8,
  high_price: 13, volume: 0, turnover: 0, change_rate: '-1.230' };

test('the four native routes agree with Gateway’s pinned catalog and produce only their documented requests', () => {
  for (const [name, route] of Object.entries(marketRestRoutes)) assert.equal(catalog.tools.find(t => t.name === name).http, route);
  assert.deepEqual(build(quote, { symbols: [symbol, 'US.AAPL'] }), { method: 'POST', path: '/api/v1.0/quote/stock-quote', body: { code_list: [symbol, 'US.AAPL'] } });
  assert.deepEqual(build(depth, { symbol, count: 60 }), { method: 'POST', path: '/api/v1.0/quote/order-book', body: { code: symbol, num: 60 } });
  assert.deepEqual(build(tape, { symbol, count: 750, period: ['BEFORE', 'AFTER'] }), { method: 'GET', path: '/api/v1.0/quote/HK.00700/rt-ticker?num=750&period=BEFORE&period=AFTER' });
  assert.equal(build(candles, { symbol: 'US.AAPL', count: 370, ktype: 1, autype: 4, extended_time: 2, pred_side: 1 }).path,
    '/api/v1.0/quote/US.AAPL/cur-kline?num=370&ktype=1&autype=4&extended_time=2&pred_side=1');
  for (const [tool, inputs] of [[quote, { symbol, symbols: [symbol] }], [quote, { symbols: Array(401).fill(symbol) }],
    [quote, { symbols: [symbol, symbol] }], [depth, { symbol, count: 61 }], [tape, { symbol, count: 751 }],
    [tape, { symbol, period: ['NORMAL', 'NORMAL'] }], [tape, { symbol, period: ['CLOSED'] }], [candles, { symbol }],
    [candles, { symbol, count: 1, ktype: 12 }], [candles, { symbol, count: 1, extended_time: 2 }],
    [candles, { symbol, count: 1, path: '/unknown' }], [depth, { symbol: '../HK.00700' }]]) {
    assert.throws(() => build(tool, inputs), /INVALID_PARAMETER/);
  }
  assert.throws(() => build('trading_order_place', { symbol }), /UNSUPPORTED/);
});

test('stock quotes bind every returned symbol and distinguish JSON number tokens from quoted decimal prices', () => {
  const json = wire({ quote_list: [quoteRow] });
  assert.equal(project(quote, { symbol }, json).rows[0].price_source, 'decimal-string');
  const number = project(quote, { symbol }, json.replace('"344.00"', '3.4400e2')).rows[0];
  assert.equal(number.last, '3.4400e2'); assert.equal(number.price_source, 'json-number');
  assert.equal(number.open, null); assert.equal(number.suspended, false);
  assert.deepEqual(project(quote, { symbol }, wire({ quote_list: [] })).rows, []);
  assert.throws(() => project(quote, { symbol }, wire({ quote_list: [{ ...quoteRow, code: 'US.AAPL' }] })), /SECURITY_MISMATCH/);
  assert.throws(() => project(quote, { symbols: [symbol, 'US.AAPL'] }, wire({ quote_list: [quoteRow, quoteRow] })), /INVALID_PAGE/);
});

test('book levels retain each exchange, precision and side availability', () => {
  const inputs = { symbol, count: 1 };
  const page = books => wire([{ code: symbol, name: 'Example', books }]);
  const { rows } = project(depth, inputs, page([book, { ...book, exchange: '', order_volume_precision: null }]));
  assert.equal(rows[0].bids[0].volume, '9007199254740.993'); assert.equal(rows[0].bids[0].order_count, 0);
  assert.equal(rows[0].bids[0].price, '344.1000'); assert.deepEqual(rows[0].asks, []);
  assert.equal(rows[1].bids[0].raw_volume, '9007199254740993'); assert.equal(rows[1].bids[0].volume, null);
  assert.throws(() => project(depth, inputs, page([book, book])), /INVALID_PAGE/);
  assert.throws(() => project(depth, inputs, page([{ ...book, bid_list: [level, level] }])), /INVALID_PAGE/);
  assert.throws(() => project(depth, inputs, page([{ ...book, bid_flag: 0 }])), /INVALID_PAGE/);
});

test('tape preserves adjacent wire int64 IDs, session, outcome side and exact scaled quantities', () => {
  const inputs = { symbol, count: 2, period: ['AFTER'] };
  const page = rows => wire({ code: symbol, volume_precision: 3, ticker_list: rows });
  const result = project(tape, inputs, page([tapeRow, { ...tapeRow, sequence: '7647056964060558022', volume: '1.2E4' }])
    .replace(/"(764705696406055802[23])"/g, '$1')).rows;
  assert.deepEqual(result.map(x => x.sequence), ['7647056964060558023', '7647056964060558022']);
  assert.deepEqual(result.map(x => x.volume), ['0.03575', '12']);
  assert.equal(result[0].pred_side, 'NO'); assert.equal(result[0].direction, 'NEUTRAL'); assert.equal(result[0].price_ex, '0.22');
  assert.throws(() => project(tape, inputs, page([{ ...tapeRow, period_type: 'BEFORE' }])), /SESSION_MISMATCH/);
  assert.throws(() => project(tape, inputs, page([tapeRow, tapeRow])), /INVALID_PAGE/);
  assert.throws(() => project(tape, inputs, page([{ ...tapeRow, sequence: '9223372036854775808' }])), /PRECISION_UNKNOWN/);
});

test('candles retain local dates, original OHLC and requested adjustment and interval', () => {
  const inputs = { symbol, count: 1 }, page = row => wire({ kline_list: [row] });
  const result = project(candles, inputs, page(candle));
  assert.deepEqual(result.requested, { ktype: 2, autype: 1, extended_time: 0, pred_side: 0 });
  assert.equal(result.rows[0].market_date, '2024-02-29'); assert.equal(result.rows[0].volume, '0');
  assert.equal(result.rows[0].turnover_rate_pct, null); assert.equal(result.rows[0].change_pct, '-1.230');
  assert.throws(() => project(candles, inputs, page({ ...candle, date: 20260229 })), /INVALID_PAGE/);
  assert.throws(() => project(candles, inputs, page({ ...candle, code: 'US.AAPL' })), /SECURITY_MISMATCH/);
  assert.throws(() => project(candles, inputs, wire({ kline_list: [candle, candle] })), /INVALID_PAGE/);
});

test('malformed, oversize and refused wire results fail before returning rows', () => {
  for (const [input, code] of [['{}', 'INVALID_PAGE'], ['{', 'INVALID_WIRE'], [' '.repeat(480001), 'INVALID_WIRE'],
    ['{"ret_code":-3}', 'INVALID_PARAMETER'], ['{"ret_code":-7}', 'INVALID_SYMBOL'], ['{"ret_code":200}', 'PROVIDER_ERROR']]) {
    assert.throws(() => project(tape, { symbol }, input), new RegExp(code));
  }
});
