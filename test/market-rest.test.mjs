import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMoomooMarketRequest as build, projectMoomooMarketResponse as project, marketRestRoutes } from 'agentic-gateway/connectors/moomoo-market-rest';
import catalog from 'agentic-gateway/connectors/moomoo-catalog.json' with { type: 'json' };
import { buildMoomooWatchlistRequest as buildWatchlist, projectMoomooWatchlistResponse as readWatchlist,
  watchlistRestRoutes } from 'agentic-gateway/connectors/moomoo-market-rest';

const quote = 'quote_stock_quote', depth = 'quote_order_book', tape = 'quote_rt_ticker', candles = 'quote_cur_kline';
const symbol = 'HK.00700';
const groups = 'quote_user_security_group', members = 'quote_user_security';
const wire = data => JSON.stringify({ ret_code: 0, data });
const quoteRow = { code: symbol, name: 'Example', data_date: '2026-11-23', data_time: 1795421270000, last_price: '344.00', suspension: false };
const level = { price: '344.1000', volume: '9007199254740993', order_count: 0 };
const book = { exchange: 'SEHK', exchange_data_time_ms: 1795421270000, order_volume_precision: 3,
  bid_flag: 1, ask_flag: 0, bid_list: [level], ask_list: [] };
const tapeRow = { sequence: '7647056964060558023', price: '465.800', volume: '35.75', time: 1780469195226, turnover: '111.000',
  ticker_direction: 'NEUTRAL', period_type: 'AFTER', tick_type: 'AUTO_MATCH', pred_side: 'NO', price_ex: '0.22' };
const candle = { code: symbol, date: 20240229, time_key: 1780243200000, open_price: 12, close_price: 10, low_price: 8,
  high_price: 13, volume: 0, turnover: 0, change_rate: '-1.230' };

test('watchlist selectors use the private read catalog and preserve exact Unicode group identities', () => {
  for (const [tool, route] of Object.entries(watchlistRestRoutes)) {
    assert.equal(catalog.tools.find(t => t.name === tool).http, route);
    assert.throws(() => build(tool, {}), /UNSUPPORTED/);
  }
  const name = '〇 & = /% #🪴';
  assert.deepEqual(buildWatchlist(groups, {}), { method: 'GET', path: '/api/v1.0/quote/user-security-group?group_type=ALL' });
  const request = buildWatchlist(members, { group_name: name });
  assert.equal(request.method, 'GET');
  const url = new URL(request.path, 'https://example.invalid');
  assert.equal(url.pathname, '/api/v1.0/quote/user-security');
  assert.deepEqual([...url.searchParams], [['group_name', name]]);
  assert.doesNotThrow(() => buildWatchlist(members, { group_name: '🪴'.repeat(100) }));
  for (const value of ['', '🪴'.repeat(101), '\uD800', null, 0])
    assert.throws(() => buildWatchlist(members, { group_name: value }), /INVALID_PARAMETER/);
  assert.throws(() => buildWatchlist(groups, { group_type: null }), /INVALID_PARAMETER/);
  assert.throws(() => buildWatchlist(groups, { group_type: 'custom' }), /INVALID_PARAMETER/);
  assert.throws(() => buildWatchlist(members, { group_name: name, codes: [symbol] }), /INVALID_PARAMETER/);
  assert.throws(() => buildWatchlist('quote_modify_user_security', { group_name: name }), /UNSUPPORTED/);
});

test('watchlist groups preserve user names and refuse a different group type or a partial response', () => {
  const custom = { group_name: ' Local ', group_type: 'CUSTOM' }, system = { group_name: 'All', group_type: 'SYSTEM' };
  const response = wire({ group_list: [system, custom] });
  assert.deepEqual(readWatchlist(groups, {}, response), { rows: [system, custom], requested: { group_type: 'ALL' } });
  assert.deepEqual(readWatchlist(groups, { group_type: 'CUSTOM' }, wire({ group_list: [custom] })).rows, [custom]);
  assert.throws(() => readWatchlist(groups, { group_type: 'CUSTOM' }, response), /GROUP_TYPE_MISMATCH/);
  assert.throws(() => readWatchlist(groups, {}, '{"ret_code":-9}'), /PERMISSION_DENIED/);
  assert.throws(() => readWatchlist(groups, {}, wire({})), /INVALID_PAGE/);
  const page = JSON.stringify({ ret_code: 0, data: { group_list: [] }, pagination: { has_more: true } });
  assert.throws(() => readWatchlist(groups, {}, page), /INCOMPLETE_PAGE/);
});

test('watchlist members retain derivative fields, large security IDs, exact prices and empty groups', () => {
  const input = { group_name: 'Synthetic option group' };
  const item = { code: 'US.TEST260619C12000', name: 'Test', sc_name: '例', tc_name: '例', lot_size: 100,
    stock_type: 'DRVT', stock_child_type: 8002, stock_owner: 'US.TEST', option_type: 'CALL', strike_time: '2026-06-19',
    strike_price: 'priceToken', listing_date: '', stock_id: 'idToken', main_contract: false, last_trade_time: '' };
  const response = wire({ security_list: [item] }).replace('"priceToken"', '12.000000000000000001').replace('"idToken"', '9007199254740993');
  const { rows: [row], requested } = readWatchlist(members, input, response);
  assert.deepEqual(requested, input);
  assert.deepEqual(row, { symbol: item.code, name: item.name, sc_name: item.sc_name, tc_name: item.tc_name, stock_type: 'DRVT',
    stock_owner: 'US.TEST', option_type: 'CALL', lot_size: 100, stock_child_type: 8002, strike_time: '2026-06-19',
    strike_price: '12.000000000000000001', listing_date: null, stock_id: '9007199254740993', main_contract: false, last_trade_time: null });
  assert.deepEqual(readWatchlist(members, input, wire({ security_list: [] })), { rows: [], requested: input });
  assert.throws(() => readWatchlist(members, input, wire({ security_list: [{ code: symbol, name: 'x', stock_id: -1 }] })), /INVALID_PAGE/);
  assert.throws(() => readWatchlist(members, input, wire({ security_list: [{ code: symbol, name: 'x', listing_date: '2025-02-29' }] })), /INVALID_PAGE/);
  assert.throws(() => readWatchlist(members, input, '{"ret_code":-3}'), /INVALID_PARAMETER/);
});

test('the native routes agree with Gateway’s pinned catalog and produce only their documented requests', () => {
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

const history = 'quote_history_kline';
const historical = { symbol: 'US.QQQ', start: '2026-11-09', end: '2026-11-10', ktype: 1 };
const instant = Date.parse('2026-11-09T15:30:00Z');
const historyBar = { time_key: instant, date: 20261109, time_zone: -300, open: '20.00', high: '25.50',
  low: '18.25', close: '24.50', last_close: '19.0', volume: '9007199254740993', turnover: 20, settle_price: '24.50' };
const pageToken = '12345678'.repeat(6);
function historyWire(bars, pagination = { has_more: false }, metadata = {}) {
  return JSON.stringify({ ret_code: 0, data: { kline_list: bars, ...metadata }, pagination });
}

test('historical requests preserve market-local bounds and both documented continuation modes', () => {
  const path = '/api/v1.0/quote/US.QQQ/history-kline?';
  assert.equal(build(history, historical).path, path + 'start=2026-11-09&end=2026-11-10&ktype=1');
  assert.equal(build(history, { symbol: 'US.QQQ', page_token: pageToken, ktype: 115, count: 1 }).path,
    path + 'page_token=' + pageToken + '&ktype=115&num=1');
  assert.equal(build(history, { symbol: 'US.QQQ', next_time: instant }).path, path + 'next_time=' + instant);
  for (const patch of [{ start: '2026-02-29' }, { end: '' }, { extended_time: 1, symbol: 'HK.00700' },
    { autype: 4 }, { ktype: 100 }, { count: 371 }, { next_time: 2.5 }, { page_token: 'short' }])
    assert.throws(() => build(history, { ...historical, ...patch }), /INVALID_PARAMETER/);
});

test('historical bars retain wire precision, optional metadata and independently bounded backward pages', () => {
  const metadata = { volume_precision: 3, next_time: instant };
  const more = { has_more: true, next_page_token: pageToken };
  const wire = historyWire([historyBar], more, metadata).replace('"24.50"', '24.500000000000000001');
  const result = project(history, historical, wire);
  assert.equal(result.rows[0].close, '24.500000000000000001');
  assert.equal(result.rows[0].volume, '9007199254740.993');
  assert.equal(result.rows[0].market_date, '2026-11-09');
  assert.equal(result.rows[0].utc_offset_minutes, -300);
  assert.deepEqual(result.pagination, { has_more: true, next_page_token: pageToken, next_time: instant });
  const missing = project(history, historical, historyWire([{ ...historyBar, date: null, time_zone: null }])).rows[0];
  assert.deepEqual([missing.market_date, missing.utc_offset_minutes, missing.volume], [null, null, null]);
  assert.equal(missing.raw_volume, '9007199254740993');
  assert.equal(project(history, historical, historyWire([historyBar], { has_more: true }, metadata)).pagination.next_time, instant);
  assert.deepEqual(project(history, historical, historyWire([])).rows, []);
  for (const [params, response, reason] of [
    [historical, historyWire([historyBar, historyBar]), /INVALID_PAGE/],
    [historical, historyWire([], more), /INVALID_PAGE/],
    [historical, historyWire([historyBar], { has_more: true }), /INVALID_PAGE/],
    [historical, historyWire([historyBar], { has_more: false }, metadata), /INVALID_PAGE/],
    [historical, historyWire([historyBar], more, { next_time: instant + 1 }), /CURSOR_MISMATCH/],
    [{ ...historical, next_time: instant }, wire, /CURSOR_MISMATCH/],
    [{ ...historical, page_token: pageToken }, wire, /CURSOR_MISMATCH/],
    [{ ...historical, end: '2026-11-09' }, wire, /DATE_RANGE_MISMATCH/],
    [historical, historyWire([{ ...historyBar, code: 'US.OTHER' }]), /SECURITY_MISMATCH/],
  ]) assert.throws(() => project(history, params, response), reason);
  assert.equal(project(history, { ...historical, end: '2026-11-09', ktype: 2 }, wire).rows.length, 1);
  for (const [code, reason] of [[-8, 'UNSUPPORTED'], [-11, 'RATE_LIMITED'], [-12, 'HISTORY_QUOTA_EXCEEDED'], [-13, 'QUOTA_UNAVAILABLE']])
    assert.throws(() => project(history, historical, JSON.stringify({ ret_code: code })), new RegExp(reason));
  assert.throws(() => project(history, historical, '{"ret_code":-3,"error":{"code":"invalid_page_token"}}'), /INVALID_PAGE_TOKEN/);
});

test('market state binds the entire symbol batch and distinguishes expanded crypto broker rows', () => {
  const tool = 'quote_market_state', stock = 'US.AAPL', crypto = 'CC.BTCUSD';
  const inputs = { symbols: [stock, crypto], is_contain_ba: true, is_contain_overnight: false, is_need_crypto_multi_broker: true };
  assert.deepEqual(build(tool, inputs), { method: 'POST', path: '/api/v1.0/quote/market-state',
    body: { code_list: [stock, crypto], is_contain_ba: true, is_contain_overnight: false, is_need_crypto_multi_broker: true } });
  const equity = { code: stock, market_state: 'AFTER_HOURS_END', stock_name: 'Apple', total_seconds: '014400' };
  const first = { code: crypto, market_state: 'FUTURE_STATE', broker_id: 0, broker_ids: '0,7', time_date: 20261124 };
  const second = { ...first, broker_id: 7, market_state: 'NONE' };
  const page = (items, args = inputs) => project(tool, args, wire({ market_state_list: items })).rows;
  const rows = page([second, equity, first]);
  assert.deepEqual(rows.map(r => [r.symbol, r.market_state, r.broker_id]), [[crypto, 'NONE', 7], [stock, 'AFTER_HOURS_END', null], [crypto, 'FUTURE_STATE', 0]]);
  assert.equal(rows[1].total_seconds, '014400'); assert.equal(rows[1].trade_section, null);
  assert.equal(rows[2].broker_ids, '0,7'); assert.equal(rows[2].time_date, 20261124);
  assert.throws(() => page([equity]), /INCOMPLETE_PAGE/);
  assert.throws(() => page([equity, first, first]), /INVALID_PAGE/);
  assert.throws(() => page([equity, first, second], { ...inputs, is_need_crypto_multi_broker: false }), /INVALID_PAGE/);
  assert.throws(() => page([equity, { ...first, broker_id: undefined }, second]), /INVALID_PAGE/);
  assert.throws(() => page([second, { ...equity, code: 'HK.00700' }]), /SECURITY_MISMATCH/);
  for (const args of [{ symbols: [] }, { symbols: [stock, stock] }, { symbol: stock, is_contain_ba: 'true' }, { symbol: stock, api: 'elsewhere' }])
    assert.throws(() => build(tool, args), /INVALID_PARAMETER/);
});

test('trading days bind inclusive market-local dates and preserve the provider’s session type and seconds independently', () => {
  const tool = 'quote_trading_days', inputs = { market: 'HK', start: '2025-12-22', end: '2025-12-24' };
  assert.deepEqual(build(tool, inputs), { method: 'GET', path: '/api/v1.0/quote/trading-days?market=HK&start=2025-12-22&end=2025-12-24' });
  const whole = { time: inputs.start, trade_date_type: 'WHOLE', trade_second: 14400 };
  const half = { time: inputs.end, trade_date_type: 'MORNING', trade_second: 14400 };
  const result = days => project(tool, inputs, wire({ trading_days: days })).rows;
  assert.deepEqual(result([half, whole]).map(r => [r.market, r.market_date, r.trade_date_type, r.trade_second]),
    [['HK', inputs.end, 'MORNING', 14400], ['HK', inputs.start, 'WHOLE', 14400]]);
  assert.deepEqual(result([]), []);
  for (const delta of [{ start: '2026-02-29' }, { end: '2025-12-21' }, { market: 'UNKNOWN' }, { market: undefined }, { start: 20251222 }])
    assert.throws(() => build(tool, { ...inputs, ...delta }), /INVALID_PARAMETER/);
  assert.throws(() => result([whole, whole]), /INVALID_PAGE/);
  assert.throws(() => result([{ ...whole, time: '2025-12-25' }]), /DATE_RANGE_MISMATCH/);
  assert.throws(() => result([{ ...whole, trade_second: -1 }]), /INVALID_PAGE/);
  assert.throws(() => result([{ ...whole, trade_date_type: 'UNKNOWN' }]), /INVALID_PAGE/);
  assert.throws(() => project(tool, inputs, JSON.stringify({ ret_code: 0, data: { trading_days: [] }, pagination: { has_more: true } })), /INCOMPLETE_PAGE/);
});
