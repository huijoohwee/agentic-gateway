// Qot_GetSecuritySnapshot. The host owns the signed-in SDK session and entitlement.
const markets = { HK: 1, US: 11 };
const symbolPattern = /^(HK|US)\.([A-Z0-9][A-Z0-9.-]{0,19})$/;

function securityFor(symbol) {
  const match = typeof symbol === 'string' && symbolPattern.exec(symbol);
  if (!match) throw Error('UNSUPPORTED_SECURITY');
  return { market: markets[match[1]], code: match[2] };
}

function sidePrice(row, key) {
  if (!Object.hasOwn(row, key) || row[key] == null || row[key] === 0) return null;
  if (!Number.isFinite(row[key]) || row[key] < 0) throw Error('INVALID_SNAPSHOT');
  return String(row[key]);
}

function projectSnapshot(symbol, response, evidence) {
  const security = securityFor(symbol);
  if (response?.retType !== 0 || (response.errCode != null && response.errCode !== 0)) {
    throw Error('PROVIDER_REFUSED');
  }
  const list = response.s2c?.snapshotList;
  const row = Array.isArray(list) && list.length === 1 && list[0]?.basic;
  if (row?.security?.market !== security.market || row.security.code !== security.code) throw Error('SECURITY_MISMATCH');
  if (!Number.isFinite(row.curPrice) || row.curPrice <= 0 || typeof row.isSuspend !== 'boolean') throw Error('INVALID_SNAPSHOT');
  let marketTimeUtc = null;
  if (Object.hasOwn(row, 'updateTimestamp') && row.updateTimestamp != null) {
    const milliseconds = row.updateTimestamp * 1000;
    if (typeof row.updateTimestamp !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0 ||
        milliseconds > 8.64e15) throw Error('INVALID_MARKET_TIME');
    marketTimeUtc = new Date(Math.round(milliseconds)).toISOString();
  }
  return {
    provider: 'moomoo', evidence, symbol, price: String(row.curPrice),
    bid: sidePrice(row, 'bidPrice'), ask: sidePrice(row, 'askPrice'),
    pricePrecision: 'provider-double', currency: null, marketTimeUtc,
    delayClass: 'unknown', suspended: row.isSuspend,
  };
}

export function replayMoomooSnapshot(symbol, response) {
  return projectSnapshot(symbol, response, 'replay');
}

// A host can bind one already authenticated, entitled read. Consume before dispatch so
// concurrent calls and failed requests cannot exceed the granted one-call budget.
export function bindMoomooSnapshot(client, grant) {
  const security = securityFor(grant?.symbol);
  if (typeof client?.GetSecuritySnapshot !== 'function' || grant.costUsd !== 0 ||
      grant.entitled !== true || grant.maxCalls !== 1) throw Error('ENTITLED_ZERO_COST_READ_REQUIRED');
  const symbol = grant.symbol;
  const expiresAt = grant.expiresAt;
  let used = false;
  return async () => {
    if (used || !Number.isSafeInteger(expiresAt) || Date.now() >= expiresAt) throw Error('READ_GRANT_EXHAUSTED');
    used = true;
    const response = await client.GetSecuritySnapshot({ c2s: { securityList: [security] } });
    return projectSnapshot(symbol, response, 'sdk-response');
  };
}

// Documented moomoo quote push messages (open.moomoo.com ORDER_BOOK / TICKER / KLINE).
// Provider doubles become decimal text; trade sequence stays opaque because JSON numbers
// cannot preserve values beyond 2^53. The snapshot manifest describes only the snapshot
// call, which carries no depth, tape or kline, so these are separate replay projections.
const directions = new Set(['BUY', 'SELL', 'NEUTRAL']);

// Push messages carry textual market codes independently of OpenD's numeric market IDs.
const pushSymbol = /^([A-Z][A-Z0-9]{0,11})\.[A-Z0-9][A-Z0-9.-]{0,31}$/;

function messageData(symbol, response, type) {
  if (typeof symbol !== 'string' || !pushSymbol.test(symbol)) throw Error('UNSUPPORTED_SECURITY');
  if (response?.type !== type || response.symbol !== symbol) throw Error('SECURITY_MISMATCH');
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('INVALID_SNAPSHOT');
  return data;
}

function utcFromMs(value) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8.64e15) {
    throw Error('INVALID_MARKET_TIME');
  }
  return new Date(Math.round(value)).toISOString();
}

function decimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw Error('INVALID_SNAPSHOT');
  return String(value);
}

function amount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('INVALID_SNAPSHOT');
  return String(value);
}

function quantity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('INVALID_SNAPSHOT');
  return value;
}

function levels(list) {
  if (!Array.isArray(list)) throw Error('INVALID_SNAPSHOT');
  return list.map(level => ({
    price: decimal(level?.price), volume: quantity(level?.volume), orderCount: quantity(level?.order_count),
  }));
}

export function replayMoomooOrderBook(symbol, response) {
  const data = messageData(symbol, response, 'ORDER_BOOK');
  return {
    provider: 'moomoo', evidence: 'replay', symbol,
    bids: levels(data.bid_list), asks: levels(data.ask_list),
    pricePrecision: 'provider-double', currency: null, delayClass: 'unknown',
    marketTimeUtc: utcFromMs(data.data_time_ms),
  };
}

export function replayMoomooTicker(symbol, response) {
  const data = messageData(symbol, response, 'TICKER');
  if (!Array.isArray(data.ticker_list)) throw Error('INVALID_SNAPSHOT');
  const ticks = data.ticker_list.map(tick => {
    if (!directions.has(tick?.direction)) throw Error('INVALID_SNAPSHOT');
    return {
      marketTimeUtc: utcFromMs(tick.time_ms), direction: tick.direction,
      price: decimal(tick.price), volume: quantity(tick.volume), turnover: amount(tick.turnover),
    };
  });
  return {
    provider: 'moomoo', evidence: 'replay', symbol, ticks,
    pricePrecision: 'provider-double', currency: null, delayClass: 'unknown',
  };
}

export function replayMoomooKline(symbol, response) {
  const data = messageData(symbol, response, 'KLINE');
  if (typeof data.period !== 'string' || typeof data.adjust !== 'string' || !Array.isArray(data.kl_list)) {
    throw Error('INVALID_SNAPSHOT');
  }
  const bars = data.kl_list.map(bar => ({
    marketTimeUtc: utcFromMs(bar.time_ms),
    open: decimal(bar.open_price), high: decimal(bar.high_price),
    low: decimal(bar.low_price), close: decimal(bar.close_price),
    volume: quantity(bar.volume), turnover: amount(bar.turnover),
  }));
  return {
    provider: 'moomoo', evidence: 'replay', symbol, period: data.period, adjust: data.adjust, bars,
    pricePrecision: 'provider-double', currency: null, delayClass: 'unknown',
  };
}

// QUOTE is a push frame. Its event time is milliseconds, independently of
// OpenD's updateTimestamp in seconds. Venue extensions stay outside this profile.
export function replayMoomooQuote(symbol, response) {
  const data = messageData(symbol, response, 'QUOTE');
  if (data.suspension != null && typeof data.suspension !== 'boolean' ||
      data.sec_status != null && typeof data.sec_status !== 'string') throw Error('INVALID_SNAPSHOT');
  const price = value => value == null ? null : amount(value);
  return {
    provider: 'moomoo', evidence: 'replay', symbol, marketTimeUtc: utcFromMs(data.data_time_ms),
    last: decimal(data.last_price), open: price(data.open_price), high: price(data.high_price),
    low: price(data.low_price), previousClose: price(data.prev_close_price),
    volume: data.volume == null ? null : quantity(data.volume), turnover: price(data.turnover),
    suspended: data.suspension ?? null, status: data.sec_status ?? null,
    pricePrecision: 'provider-double', currency: null, delayClass: 'unknown',
  };
}

// Published market_state enum in /api/quote/naming-dictionary. Index equals the wire code.
const marketStates = [
  'NONE', 'AUCTION', 'WAITING_OPEN', 'MORNING',
  'REST', 'AFTERNOON', 'CLOSED', 'MAAUCTION',
  'PRE_MARKET_BEGIN', 'PRE_MARKET_END', 'AFTER_HOURS_BEGIN', 'AFTER_HOURS_END',
  'FUTU_SWITCH_DATE', 'NIGHT_OPEN', 'NIGHT_END', 'FUTURE_DAY_OPEN',
  'FUTURE_DAY_BREAK', 'FUTURE_DAY_CLOSE', 'FUTURE_DAY_WAIT_OPEN', 'HK_CAS',
  'FUTURE_NIGHT_WAIT', 'FUTURE_AFTERNOON', 'FUTURE_SWITCH_DATE', 'FUTURE_OPEN',
  'FUTURE_BREAK', 'FUTURE_BREAK_OVER', 'FUTURE_CLOSE', 'STIB_AFTER_HOURS_WAIT',
  'STIB_AFTER_HOURS_BEGIN', 'STIB_AFTER_HOURS_END', 'CLOSE_AUCTION', 'AFTERNOON_END',
  'NIGHT', 'OVERNIGHT_BEGIN', 'OVERNIGHT_END', 'TRADE_AT_LAST',
  'TRADE_AUCTION', 'OVERNIGHT',
];

function brokerRows(rows) {
  if (rows == null) return null;
  if (!Array.isArray(rows)) throw Error('INVALID_BROKER_QUEUE');
  return rows.map(row => {
    if (!Number.isSafeInteger(row?.rank) || row.rank < 0 ||
        typeof row.broker_id !== 'string' || !row.broker_id ||
        (row.broker_name != null && typeof row.broker_name !== 'string')) throw Error('INVALID_BROKER_QUEUE');
    return { rank: row.rank, brokerId: row.broker_id, brokerName: row.broker_name || null };
  });
}

export function replayMoomooBrokerQueue(symbol, frame) {
  const data = messageData(symbol, frame, 'BROKER_QUEUE');
  const time = data.data_time_ms;
  if (time != null && !Number.isSafeInteger(time)) throw Error('INVALID_MARKET_TIME');
  return {
    provider: 'moomoo', evidence: 'replay', symbol,
    marketTimeUtc: time === 0 ? null : utcFromMs(time),
    bids: brokerRows(data.bid_brokers), asks: brokerRows(data.ask_brokers),
  };
}

function tradeDate(value) {
  if (value == null || value === 0) return null;
  if (!Number.isInteger(value) || value < 10000101 || value > 99991231) throw Error('INVALID_TRADE_DATE');
  const digits = String(value);
  const iso = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
  const time = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) throw Error('INVALID_TRADE_DATE');
  return iso;
}

export function replayMoomooMarketState(market, frame) {
  const data = frame?.data;
  if (typeof market !== 'string' || !/^[A-Z][A-Z0-9]{0,11}$/.test(market) ||
      frame?.type !== 'MARKET_STATE' || data?.market !== market ||
      (frame.symbol != null && (typeof frame.symbol !== 'string' || pushSymbol.exec(frame.symbol)?.[1] !== market))) {
    throw Error('MARKET_MISMATCH');
  }
  const statusCode = data.status;
  if (!Number.isSafeInteger(statusCode) || statusCode < 0) throw Error('INVALID_MARKET_STATUS');
  return { provider: 'moomoo', evidence: 'replay', market, statusCode,
    statusName: marketStates[statusCode] ?? null, tradeDate: tradeDate(data.trade_date) };
}

const pushProjections = new Map([
  ['QUOTE', replayMoomooQuote], ['ORDER_BOOK', replayMoomooOrderBook], ['TICKER', replayMoomooTicker],
  ['KLINE', replayMoomooKline], ['BROKER_QUEUE', replayMoomooBrokerQueue], ['MARKET_STATE', replayMoomooMarketState],
]);

// A consumer may skip an unknown frame. Malformed frames of a supported type fail explicitly.
export function replayMoomooPush(target, frame) {
  const project = pushProjections.get(frame?.type);
  return project ? project(target, frame) : null;
}
