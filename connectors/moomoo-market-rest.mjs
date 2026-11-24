// Public market REST wire profiles. Hosts own credentials, admission, transport and retention.
const root = '/api/v1.0/quote/';
export const marketRestRoutes = Object.freeze({
  quote_stock_quote: 'POST ' + root + 'stock-quote',
  quote_order_book: 'POST ' + root + 'order-book',
  quote_rt_ticker: 'GET ' + root + '{symbol}/rt-ticker',
  quote_cur_kline: 'GET ' + root + '{symbol}/cur-kline',
});
const sessions = ['NORMAL', 'BEFORE', 'AFTER', 'OVERNIGHT'];
const intervals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 26, 29];
const decimalKeys = new Set(['price', 'price_ex', 'volume', 'turnover', 'sequence', 'open_price', 'close_price', 'last_price',
  'high_price', 'low_price', 'prev_close_price', 'last_close_price', 'change_rate', 'turnover_rate']);
const amountPattern = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

function check(condition, code = 'INVALID_PARAMETER') {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function only(input, keys) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => keys.includes(key)));
}
function symbol(value, limit = 32) {
  check(typeof value === 'string' && value.length <= limit && /^[A-Z0-9_]+\.[A-Za-z0-9_.-]+$/.test(value));
  return value;
}
function integer(value, min, max, code = 'INVALID_PARAMETER') {
  check(Number.isSafeInteger(value) && value >= min && value <= max, code); return value;
}
function array(value, limit) {
  check(Array.isArray(value) && value.length <= limit, 'INVALID_PAGE'); return value;
}
function distinct(values, code = 'INVALID_PARAMETER') {
  check(new Set(values).size === values.length, code);
}
function string(value) { check(typeof value === 'string', 'INVALID_PAGE'); return value; }

export function buildMoomooMarketRequest(tool, inputs) {
  check(typeof tool === 'string' && Object.hasOwn(marketRestRoutes, tool), 'UNSUPPORTED');
  const [method, path] = marketRestRoutes[tool].split(' ');
  if (tool === 'quote_stock_quote') {
    only(inputs, ['symbol', 'symbols']);
    check(Object.hasOwn(inputs, 'symbol') !== Object.hasOwn(inputs, 'symbols'));
    const codes = Object.hasOwn(inputs, 'symbol') ? [inputs.symbol] : inputs.symbols;
    check(Array.isArray(codes) && codes.length > 0 && codes.length <= 400);
    const code_list = Array.from(codes, code => symbol(code)); distinct(code_list);
    return { method, path, body: { code_list } };
  }
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

// Preserve the actual JSON number token. A quoted decimal and a JSON number have distinct origins.
class WireNumber { constructor(source) { this.source = source; } }
function readWire(wire) {
  check(typeof wire === 'string' && wire.length <= 480000 && new TextEncoder().encode(wire).length <= 480000, 'INVALID_WIRE');
  try {
    return JSON.parse(wire, (key, value, context) => {
      if (typeof value !== 'number' || !decimalKeys.has(key)) return value;
      check(typeof context?.source === 'string', 'PRECISION_UNKNOWN');
      return new WireNumber(context.source);
    });
  } catch (error) { if (error.code) throw error; check(false, 'INVALID_WIRE'); }
}
function decimal(value) {
  const text = value instanceof WireNumber ? value.source : value;
  check(typeof text === 'string' && text.length <= 96 && amountPattern.test(text) && Number.isFinite(Number(text)), 'PRECISION_UNKNOWN');
  return text;
}
function count64(value) {
  const text = decimal(value);
  check(/^\d{1,19}$/.test(text) && BigInt(text) <= 9223372036854775807n, 'PRECISION_UNKNOWN');
  return text;
}
function measure(row, key) { return row[key] == null ? null : decimal(row[key]); }
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
function marketDate(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3') : value;
  check(typeof text === 'string' && /^\d{4}-\d\d-\d\d$/.test(text), 'INVALID_PAGE');
  const millis = Date.parse(text + 'T00:00:00Z');
  check(Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === text, 'INVALID_PAGE');
  return text;
}
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
export function projectMoomooMarketResponse(tool, inputs, wire) {
  const request = buildMoomooMarketRequest(tool, inputs), response = readWire(wire);
  check(Number.isSafeInteger(response?.ret_code), 'INVALID_PAGE');
  if (response.ret_code !== 0) {
    const codes = { [-3]: 'INVALID_PARAMETER', [-7]: 'INVALID_SYMBOL', ...(tool === 'quote_cur_kline' && { [-4]: 'INVALID_SYMBOL' }) };
    check(false, Object.hasOwn(codes, response.ret_code) ? codes[response.ret_code] : 'PROVIDER_ERROR');
  }
  const data = response.data;
  if (tool === 'quote_stock_quote') return { rows: quotes(data, request) };
  if (tool === 'quote_order_book') return { rows: books(data, inputs) };
  if (tool === 'quote_rt_ticker') return { rows: ticks(data, inputs) };
  return { rows: candles(data, inputs), requested: { ktype: inputs.ktype ?? 2, autype: inputs.autype ?? 1,
    extended_time: inputs.extended_time ?? 0, pred_side: inputs.pred_side ?? 0 } };
}
