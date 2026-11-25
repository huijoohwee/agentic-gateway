// Public market REST wire profiles. Hosts own credentials, admission, transport and retention.
import { WireNumber, check, only, root, string, integer, readWire, decimal, measure, marketDate, completePage } from './moomoo-rest-wire.mjs';
import { capitalFlowRoutes, flowNumbers, flowRequest, flowPage } from './moomoo-capital-flow.mjs';
export { watchlistRestRoutes, buildMoomooWatchlistRequest, projectMoomooWatchlistResponse } from './moomoo-watchlist.mjs';

export const marketRestRoutes = Object.freeze({
  ...capitalFlowRoutes,
  quote_stock_quote: 'POST ' + root + 'stock-quote',
  quote_order_book: 'POST ' + root + 'order-book',
  quote_rt_ticker: 'GET ' + root + '{symbol}/rt-ticker',
  quote_cur_kline: 'GET ' + root + '{symbol}/cur-kline',
  quote_market_state: 'POST ' + root + 'market-state',
  quote_trading_days: 'GET ' + root + 'trading-days',
  quote_history_kline: 'GET ' + root + '{symbol}/history-kline',
});
const sessions = ['NORMAL', 'BEFORE', 'AFTER', 'OVERNIGHT'];
const intervals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 26, 29];
const historyIntervals = [...intervals, 101, 105, 110, 115, 130, 145];
const calendarIntervals = new Set([2, 3, 4, 5, 11]);
const historyToken = /^[0-9a-f]{48}$/;
function symbol(value, limit = 32) {
  check(typeof value === 'string' && value.length <= limit && /^[A-Z0-9_]+\.[A-Za-z0-9_.-]+$/.test(value));
  return value;
}
function array(value, limit) {
  check(Array.isArray(value) && value.length <= limit, 'INVALID_PAGE'); return value;
}
function distinct(values, code = 'INVALID_PARAMETER') {
  check(new Set(values).size === values.length, code);
}
function historyRequest(path, inputs) {
  only(inputs, ['symbol', 'start', 'end', 'next_time', 'page_token', 'count', 'ktype', 'autype', 'extended_time', 'pred_side']);
  const code = symbol(inputs.symbol, 128), query = new URLSearchParams();
  for (const key of ['start', 'end']) {
    if (!Object.hasOwn(inputs, key) || inputs[key] === '') continue;
    check(typeof inputs[key] === 'string');
    marketDate(inputs[key], 'INVALID_PARAMETER');
    query.set(key, inputs[key]);
  }
  if (Object.hasOwn(inputs, 'next_time')) query.set('next_time', integer(inputs.next_time, -8640000000000000, 8640000000000000));
  if (Object.hasOwn(inputs, 'page_token') && inputs.page_token !== '') {
    check(typeof inputs.page_token === 'string' && historyToken.test(inputs.page_token));
    query.set('page_token', inputs.page_token);
  }
  check(query.has('end') || inputs.next_time || query.has('page_token'));
  if (!inputs.next_time && !inputs.page_token && inputs.start && inputs.end) check(inputs.start <= inputs.end);
  for (const [key, choices] of Object.entries({ ktype: historyIntervals, autype: [0, 1, 2], extended_time: [0, 1, 2], pred_side: [0, 1, 2] })) {
    if (Object.hasOwn(inputs, key)) { check(choices.includes(inputs[key])); query.set(key, inputs[key]); }
  }
  if (inputs.extended_time) check(code.startsWith('US.') && !calendarIntervals.has(inputs.ktype ?? 2));
  if (Object.hasOwn(inputs, 'count')) query.set('num', integer(inputs.count, 1, 370));
  return { method: 'GET', path: path.replace('{symbol}', encodeURIComponent(code)) + '?' + query };
}

const stateFlags = ['is_contain_ba', 'is_contain_overnight', 'is_need_crypto_multi_broker'];
const calendarMarkets = new Set(['HK', 'US', 'SH', 'SZ', 'BJ', 'SG', 'JP', 'KR', 'CA', 'AU', 'JP_FUTURE', 'SG_FUTURE', 'BMD', 'FX']);

function codeList(inputs, flags, limit) {
  only(inputs, ['symbol', 'symbols', ...flags]);
  check(Object.hasOwn(inputs, 'symbol') !== Object.hasOwn(inputs, 'symbols'));
  const values = Object.hasOwn(inputs, 'symbol') ? [inputs.symbol] : inputs.symbols;
  check(Array.isArray(values) && values.length > 0 && values.length <= 400);
  const codes = Array.from(values, value => symbol(value, limit));
  distinct(codes);
  return codes;
}

export function buildMoomooSessionArguments(tool, inputs) {
  if (tool === 'quote_market_state') {
    const args = { code_list: codeList(inputs, stateFlags, 128) };
    for (const flag of stateFlags) {
      if (!Object.hasOwn(inputs, flag)) continue;
      check(typeof inputs[flag] === 'boolean'); args[flag] = inputs[flag];
    }
    return args;
  }
  check(tool === 'quote_trading_days', 'UNSUPPORTED');
  only(inputs, ['market', 'start', 'end']);
  check(calendarMarkets.has(inputs.market));
  for (const date of [inputs.start, inputs.end]) {
    check(typeof date === 'string'); marketDate(date, 'INVALID_PARAMETER');
  }
  check(inputs.start <= inputs.end);
  return { market: inputs.market, start: inputs.start, end: inputs.end };
}

export function buildMoomooMarketRequest(tool, inputs) {
  check(typeof tool === 'string' && Object.hasOwn(marketRestRoutes, tool), 'UNSUPPORTED');
  const [method, path] = marketRestRoutes[tool].split(' ');
  if (Object.hasOwn(capitalFlowRoutes, tool)) return flowRequest(tool, inputs, path, symbol);
  if (tool === 'quote_history_kline') return historyRequest(path, inputs);
  if (tool === 'quote_market_state') return { method, path, body: buildMoomooSessionArguments(tool, inputs) };
  if (tool === 'quote_trading_days') return { method, path: path + '?' + new URLSearchParams(buildMoomooSessionArguments(tool, inputs)) };
  if (tool === 'quote_stock_quote') return { method, path, body: { code_list: codeList(inputs, [], 32) } };
  const book = tool === 'quote_order_book', tape = tool === 'quote_rt_ticker';
  only(inputs, ['symbol', 'count', ...(book ? [] : tape ? ['period'] : ['ktype', 'autype', 'extended_time', 'pred_side'])]);
  const code = symbol(inputs.symbol, tape ? 128 : 32);
  const count = Object.hasOwn(inputs, 'count') ? integer(inputs.count, 1, book ? 60 : tape ? 750 : 370) : undefined;
  if (book) return { method, path, body: { code, ...(count !== undefined && { num: count }) } };
  const query = new URLSearchParams();
  if (count !== undefined) query.append('num', count);
  if (tape && Object.hasOwn(inputs, 'period')) {
    check(Array.isArray(inputs.period) && inputs.period.length > 0 && inputs.period.length <= sessions.length);
    distinct(inputs.period);
    for (const period of inputs.period) { check(sessions.includes(period)); query.append('period', period); }
  }
  if (!tape) {
    check(count !== undefined);
    for (const [key, choices] of Object.entries({ ktype: intervals, autype: [0, 1, 2, 3, 4], extended_time: [0, 1, 2], pred_side: [0, 1, 2] })) {
      if (Object.hasOwn(inputs, key)) { check(choices.includes(inputs[key])); query.append(key, inputs[key]); }
    }
    if (inputs.extended_time) check(code.startsWith('US.') && inputs.ktype === 1);
  }
  return { method, path: path.replace('{symbol}', encodeURIComponent(code)) + (query.size ? '?' + query : '') };
}

function count64(value) {
  const text = decimal(value);
  check(/^\d{1,19}$/.test(text) && BigInt(text) <= 9223372036854775807n, 'PRECISION_UNKNOWN');
  return text;
}
function size(raw, precision) {
  check(!raw.startsWith('-'), 'INVALID_PAGE');
  if (precision === null) return null;
  if (precision === 0) return raw;
  const [mantissa, exponent = '0'] = raw.toLowerCase().split('e'), [whole, fraction = ''] = mantissa.split('.');
  const digits = whole + fraction, point = whole.length + Number(exponent) - precision;
  check(Number.isSafeInteger(point) && Math.abs(point) <= 192, 'PRECISION_UNKNOWN');
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0, point) + '.' + digits.slice(point);
}
function scale(value) { return value == null ? null : integer(value, 0, 64, 'PRECISION_UNKNOWN'); }
function time(value) { return integer(value, 0, 8640000000000000, 'INVALID_PAGE'); }
function quotes(data, request) {
  const codes = request.body.code_list;
  const rows = array(data?.quote_list, codes.length).map(row => {
    check(codes.includes(row?.code), 'SECURITY_MISMATCH');
    check(row.suspension == null || typeof row.suspension === 'boolean', 'INVALID_PAGE');
    return { symbol: row.code, name: string(row.name), market_date: marketDate(row.data_date), time_ms: time(row.data_time),
      last: decimal(row.last_price), price_source: row.last_price instanceof WireNumber ? 'json-number' : 'decimal-string',
      open: measure(row, 'open_price'), high: measure(row, 'high_price'), low: measure(row, 'low_price'), prev_close: measure(row, 'prev_close_price'),
      volume: row.volume == null ? null : count64(row.volume), turnover: measure(row, 'turnover'), suspended: row.suspension ?? null };
  });
  distinct(rows.map(row => row.symbol), 'INVALID_PAGE');
  return rows;
}
function levels(values, flag, limit, precision) {
  check(flag === 0 || flag === 1, 'INVALID_PAGE');
  const list = array(values ?? (flag === 0 ? [] : undefined), limit);
  check(flag === 1 || list.length === 0, 'INVALID_PAGE');
  return list.map(row => {
    const raw = count64(row?.volume);
    return { price: decimal(row.price), raw_volume: raw, volume: size(raw, precision),
      order_count: integer(row.order_count, 0, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE') };
  });
}
function books(data, inputs) {
  check(Array.isArray(data) && data.length === 1 && data[0]?.code === inputs.symbol, 'SECURITY_MISMATCH');
  const rows = array(data[0].books, 600).map(book => {
    check(book && typeof book === 'object', 'INVALID_PAGE');
    const precision = scale(book.order_volume_precision), limit = inputs.count ?? 60;
    return { symbol: inputs.symbol, name: string(data[0].name), exchange: string(book.exchange), time_ms: time(book.exchange_data_time_ms),
      volume_precision: precision, bid_flag: book.bid_flag, ask_flag: book.ask_flag,
      bids: levels(book.bid_list, book.bid_flag, limit, precision), asks: levels(book.ask_list, book.ask_flag, limit, precision) };
  });
  distinct(rows.map(row => row.exchange), 'INVALID_PAGE'); return rows;
}
function ticks(data, inputs) {
  check(data?.code === inputs.symbol, 'SECURITY_MISMATCH');
  const precision = scale(data.volume_precision);
  const rows = array(data.ticker_list, inputs.count ?? 500).map(row => {
    check(row && ['BUY', 'SELL', 'NEUTRAL'].includes(row.ticker_direction), 'INVALID_PAGE');
    check(sessions.includes(row.period_type) && (!inputs.period || inputs.period.includes(row.period_type)), 'SESSION_MISMATCH');
    check(row.pred_side == null || ['NONE', 'YES', 'NO'].includes(row.pred_side), 'INVALID_PAGE');
    const raw = decimal(row.volume);
    return { symbol: inputs.symbol, time_ms: time(row.time), sequence: count64(row.sequence), price: decimal(row.price),
      price_ex: measure(row, 'price_ex'), raw_volume: raw, volume_precision: precision, volume: size(raw, precision),
      turnover: decimal(row.turnover), direction: row.ticker_direction, tick_type: string(row.tick_type), period: row.period_type,
      pred_side: row.pred_side ?? null, trade_type: row.trade_type == null ? null : string(row.trade_type) };
  });
  distinct(rows.map(row => row.sequence), 'INVALID_PAGE'); return rows;
}
function candles(data, inputs) {
  return array(data?.kline_list, inputs.count).map(row => {
    check(row?.code === inputs.symbol, 'SECURITY_MISMATCH');
    return { symbol: row.code, time_ms: time(row.time_key), market_date: marketDate(row.date),
      open: decimal(row.open_price), high: decimal(row.high_price), low: decimal(row.low_price), close: decimal(row.close_price),
      prev_close: measure(row, 'last_close_price'), volume: count64(row.volume), turnover: decimal(row.turnover),
      turnover_rate_pct: measure(row, 'turnover_rate'), change_pct: measure(row, 'change_rate') };
  });
}
function historyPage(response, inputs, requested) {
  const { data, pagination } = response;
  check(typeof pagination?.has_more === 'boolean', 'INVALID_PAGE');
  const precision = scale(data?.volume_precision);
  const rows = array(data?.kline_list, inputs.count ?? 370).map(bar => {
    check(bar && typeof bar === 'object', 'INVALID_PAGE');
    if (bar.code != null) check(bar.code === inputs.symbol, 'SECURITY_MISMATCH');
    const time_ms = integer(bar.time_key, -8640000000000000, 8640000000000000, 'INVALID_PAGE'), raw = count64(bar.volume);
    if (inputs.next_time) check(time_ms < inputs.next_time, 'CURSOR_MISMATCH');
    const market_date = bar.date == null ? null : marketDate(bar.date);
    const offset = bar.time_zone == null ? null : integer(bar.time_zone, -1440, 1440, 'INVALID_PAGE');
    // Intraday trading dates can differ from the local calendar date of the timestamp.
    const calendarBar = calendarIntervals.has(requested.ktype);
    let localDate = calendarBar ? market_date : null;
    if (!localDate && offset !== null) {
      const local = new Date(time_ms + offset * 60000);
      check(Number.isFinite(local.getTime()), 'INVALID_PAGE');
      localDate = local.toISOString().slice(0, 10);
    }
    if (localDate && inputs.start) check(localDate >= inputs.start, 'DATE_RANGE_MISMATCH');
    if (localDate && inputs.end && !inputs.next_time && !inputs.page_token)
      check(calendarBar ? localDate <= inputs.end : localDate < inputs.end, 'DATE_RANGE_MISMATCH');
    if (!localDate) {
      // Even without an exchange offset, no local calendar day extends beyond UTC ±24 hours.
      if (inputs.start) check(time_ms >= Date.parse(inputs.start) - 86400000, 'DATE_RANGE_MISMATCH');
      if (inputs.end && !inputs.next_time && !inputs.page_token)
        check(time_ms < Date.parse(inputs.end) + (calendarBar ? 2 : 1) * 86400000, 'DATE_RANGE_MISMATCH');
    }
    return { symbol: inputs.symbol, time_ms, market_date, utc_offset_minutes: offset,
      open: decimal(bar.open), high: decimal(bar.high), low: decimal(bar.low), close: decimal(bar.close),
      prev_close: measure(bar, 'last_close'), raw_volume: raw, volume_precision: precision, volume: size(raw, precision),
      turnover: decimal(bar.turnover), turnover_rate_pct: measure(bar, 'turnover_rate'), change_pct: measure(bar, 'change_rate'),
      pe_ratio: measure(bar, 'pe_ratio'), open_interest: bar.open_interest == null ? null : count64(bar.open_interest),
      reported_settle_price: measure(bar, 'settle_price'), implied_volatility_pct: measure(bar, 'implied_volatility'),
      name: bar.name == null ? null : string(bar.name), sc_name: bar.sc_name == null ? null : string(bar.sc_name),
      tc_name: bar.tc_name == null ? null : string(bar.tc_name) };
  });
  distinct(rows.map(row => row.time_ms), 'INVALID_PAGE');
  const token = pagination.next_page_token ?? '', cursor = data.next_time ?? 0;
  check(typeof token === 'string' && (!token || historyToken.test(token)), 'INVALID_PAGE');
  integer(cursor, -8640000000000000, 8640000000000000, 'INVALID_PAGE');
  if (pagination.has_more) {
    check(rows.length > 0 && (token || cursor), 'INVALID_PAGE');
    if (token) check(token !== inputs.page_token, 'CURSOR_MISMATCH');
    if (cursor) check(cursor <= Math.min(...rows.map(row => row.time_ms)), 'CURSOR_MISMATCH');
  } else check(!token && !cursor, 'INVALID_PAGE');
  return { rows, requested, pagination: { has_more: pagination.has_more, next_page_token: token || null, next_time: cursor || null } };
}
function marketStates(data, body) {
  const requested = new Set(body.code_list), seen = new Map();
  check(Array.isArray(data?.market_state_list), 'INVALID_PAGE');
  const rows = data.market_state_list.map(item => {
    const code = item?.code;
    check(requested.has(code), 'SECURITY_MISMATCH');
    const broker = item.broker_id == null ? null : integer(item.broker_id, 0, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE');
    const brokers = seen.get(code) ?? new Set();
    if (brokers.size) check(code.startsWith('CC.') && body.is_need_crypto_multi_broker === true &&
      broker !== null && !brokers.has(null) && !brokers.has(broker), 'INVALID_PAGE');
    brokers.add(broker); seen.set(code, brokers);
    const row = { symbol: code, market_state: string(item.market_state), broker_id: broker,
      time_date: item.time_date == null ? null : integer(item.time_date, 0, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE') };
    check(row.market_state.length > 0, 'INVALID_PAGE');
    for (const key of ['stock_name', 'sc_name', 'tc_name', 'traded_seconds', 'total_seconds', 'trade_section', 'broker_ids'])
      row[key] = item[key] == null ? null : string(item[key]);
    return row;
  });
  check(seen.size === requested.size, 'INCOMPLETE_PAGE');
  return rows;
}

function tradingDays(data, inputs) {
  const rows = array(data?.trading_days, 1 + (Date.parse(inputs.end) - Date.parse(inputs.start)) / 86400000).map(day => {
    check(typeof day?.time === 'string', 'INVALID_PAGE');
    const date = marketDate(day.time);
    check(date >= inputs.start && date <= inputs.end, 'DATE_RANGE_MISMATCH');
    check(['WHOLE', 'MORNING', 'AFTERNOON'].includes(day.trade_date_type), 'INVALID_PAGE');
    return { market: inputs.market, market_date: date, trade_date_type: day.trade_date_type,
      trade_second: integer(day.trade_second, 0, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE') };
  });
  distinct(rows.map(day => day.market_date), 'INVALID_PAGE');
  return rows;
}

export function projectMoomooMarketResponse(tool, inputs, wire) {
  const request = buildMoomooMarketRequest(tool, inputs);
  const capital = Object.hasOwn(capitalFlowRoutes, tool);
  const response = readWire(wire, capital ? flowNumbers : undefined);
  check(Number.isSafeInteger(response?.ret_code), 'INVALID_PAGE');
  if (response.ret_code !== 0) {
    if (capital && response.ret_code === -10) check(false, 'NO_DATA');
    if (capital && response.ret_code === -8) check(false, 'UNSUPPORTED');
    if (tool === 'quote_history_kline') {
      if (response.ret_code === -3 && response.error?.code === 'invalid_page_token') check(false, 'INVALID_PAGE_TOKEN');
      const errors = { [-8]: 'UNSUPPORTED', [-11]: 'RATE_LIMITED', [-12]: 'HISTORY_QUOTA_EXCEEDED', [-13]: 'QUOTA_UNAVAILABLE' };
      if (Object.hasOwn(errors, response.ret_code)) check(false, errors[response.ret_code]);
    }
    const codes = { [-3]: 'INVALID_PARAMETER', [-7]: 'INVALID_SYMBOL', ...(tool === 'quote_cur_kline' && { [-4]: 'INVALID_SYMBOL' }) };
    check(false, Object.hasOwn(codes, response.ret_code) ? codes[response.ret_code] : 'PROVIDER_ERROR');
  }
  if (capital) return flowPage(tool, inputs, response);
  const data = response.data;
  if (tool === 'quote_market_state' || tool === 'quote_trading_days') {
    completePage(response.pagination);
    return { rows: tool === 'quote_market_state' ? marketStates(data, request.body) : tradingDays(data, inputs) };
  }
  if (tool === 'quote_stock_quote') return { rows: quotes(data, request) };
  if (tool === 'quote_order_book') return { rows: books(data, inputs) };
  if (tool === 'quote_rt_ticker') return { rows: ticks(data, inputs) };
  const requested = { ktype: inputs.ktype ?? 2, autype: inputs.autype ?? 1,
    extended_time: inputs.extended_time ?? 0, pred_side: inputs.pred_side ?? 0 };
  if (tool === 'quote_history_kline') return historyPage(response, inputs, requested);
  return { rows: candles(data, inputs), requested };
}
