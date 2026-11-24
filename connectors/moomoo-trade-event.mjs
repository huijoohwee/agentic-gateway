import { decodeCryptoReport } from './moomoo-crypto-report.mjs';

export const securitiesTradeTopics = Object.freeze([
  'EVENT_NEW', 'EVENT_REPLACED', 'EVENT_CANCELED', 'EVENT_EXPIRED', 'EVENT_FILL',
  'EVENT_NEW_REJECTED', 'EVENT_REPLACE_REJECTED', 'EVENT_CANCEL_REJECTED', 'EVENT_FILL_CORRECT',
  'EVENT_FILL_CANCEL', 'EVENT_WAIT_OPEN', 'EVENT_PRICE_PROTECT', 'EVENT_TRIGGER_WAITING', 'EVENT_TRIGGER',
]);
export const cryptoReportTopics = Object.freeze([1, 3, 4, 5]);
const fillTopics = new Set(['EVENT_FILL', 'EVENT_FILL_CORRECT', 'EVENT_FILL_CANCEL']);
const integerFields = new Set(['acc_id', 'uid', 'event_time_us', 'create_time', 'updated_time', 'expire_time', 'start_time', 'end_time']);
const decimalPattern = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function check(condition, code = 'INVALID_TRADE_EVENT') {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function text(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value));
  return value;
}
function amount(value) {
  check(typeof value === 'string' && value.length <= 96 && decimalPattern.test(value), 'PRECISION_UNKNOWN');
  return value;
}
const optionalAmount = value => value == null || value === '' ? null : amount(value);
function unsigned(value, max = 9223372036854775807n) {
  check(typeof value === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= max, 'PRECISION_UNKNOWN');
  return value;
}
function chronological(start, end) {
  check(BigInt(start) <= BigInt(end));
}
function parseSecurities(wire) {
  check(typeof wire === 'string' && wire.length > 0 && wire.length <= 480_000 &&
    new TextEncoder().encode(wire).byteLength <= 480_000, 'INVALID_WIRE');
  try {
    return JSON.parse(wire, (key, value, context) => {
      if (!integerFields.has(key) || typeof value !== 'number') return value;
      check(typeof context?.source === 'string', 'PRECISION_UNKNOWN');
      return context.source;
    });
  } catch (error) { if (error.code) throw error; check(false, 'INVALID_WIRE'); }
}
function selectFields(source, keys, reader, out = {}) {
  for (const key of keys) if (source[key] != null && source[key] !== '') out[key] = reader(source[key]);
  return out;
}
function algorithm(info) {
  if (info == null) return null;
  check(object(info));
  const result = selectFields(info, ['start_time', 'end_time'], value => unsigned(value));
  selectFields(info, ['pricing_strategy', 'layering'], text, result);
  for (const kind of ['twap', 'vwap', 'pov', 'slicer', 'peg', 'iceberg']) {
    if (info[kind] == null) continue;
    check(object(info[kind]));
    const part = selectFields(info[kind], ['participation_rate', 'peg_offset'], amount);
    selectFields(info[kind], ['slice_interval', 'display_qty', 'display_qty_var'], value => {
      check(Number.isSafeInteger(value) && value >= 0, 'PRECISION_UNKNOWN'); return value;
    }, part);
    result[kind] = part;
  }
  return result;
}
function legs(info) {
  if (info == null) return null;
  check(object(info) && Array.isArray(info.leg_infos));
  return { underlying_symbol: text(info.underlying_symbol), underlying_stock_name: info.underlying_stock_name ? text(info.underlying_stock_name) : null,
    legs: info.leg_infos.map(leg => {
      check(object(leg));
      return { code: text(leg.code), side: text(leg.side), security_type: text(leg.security_type),
        stock_name: leg.stock_name ? text(leg.stock_name) : null, ratio_qty: amount(leg.ratio_qty), hp_multiplier: optionalAmount(leg.hp_multiplier), avg_fill_price: optionalAmount(leg.avg_fill_price) };
    }) };
}
function securitiesOrder(row) {
  check(object(row));
  const order = { order_id: text(row.order_id), symbol: text(row.code), side: text(row.side), type: text(row.order_type),
    status: text(row.order_status), quantity: amount(row.qty), price: optionalAmount(row.price), currency: text(row.currency),
    filled_quantity: amount(row.dealt_qty), average_fill_price: optionalAmount(row.dealt_avg_price),
    created_us: unsigned(row.create_time), updated_us: unsigned(row.updated_time), expires_us: row.expire_time == null ? null : unsigned(row.expire_time),
    has_remark: typeof row.remark === 'string' && row.remark.length > 0, has_error: typeof row.last_err_msg === 'string' && row.last_err_msg.length > 0,
    multi_leg: legs(row.multi_leg_info), algo: algorithm(row.algo_info) };
  chronological(order.created_us, order.updated_us);
  selectFields(row, ['stock_name', 'security_type', 'session', 'exchange', 'time_in_force', 'trail_type',
    'position_open_type', 'margin_trading_type', 'margin_period_type'], text, order);
  return selectFields(row, ['aux_price', 'trail_value', 'trail_spread'], amount, order);
}

// A trusted caller supplies the selected REST account ID as exact decimal text. Never derive it
// from the file. Only the private reconciliation result contains event, order and fill identifiers.
export function replayMoomooSecuritiesEvent(expectedAccountId, wire) {
  const maxId = 18446744073709551615n;
  const account = unsigned(expectedAccountId, maxId);
  check(account !== '0', 'ACCOUNT_BINDING');
  const frame = parseSecurities(wire);
  check(object(frame) && object(frame.user_info) && unsigned(frame.user_info.acc_id, maxId) === account, 'ACCOUNT_BINDING');
  const topic = text(frame.event_type);
  if (!securitiesTradeTopics.includes(topic)) return { family: 'securities', topic, status: 'unsupported' };
  const order = securitiesOrder(frame.order_info), rawFills = frame.fill_infos;
  check(Array.isArray(rawFills) && (rawFills.length > 0) === fillTopics.has(topic));
  const seen = new Set();
  const fills = rawFills.map(row => {
    check(object(row) && row.order_id === order.order_id, 'ORDER_BINDING');
    check(row.code === order.symbol || order.multi_leg?.legs.some(leg => leg.code === row.code), 'INSTRUMENT_BINDING');
    const id = text(row.deal_id);
    check(!seen.has(id)); seen.add(id);
    const status = text(row.status);
    if (topic === 'EVENT_FILL_CORRECT') check(status === 'CHANGED');
    if (topic === 'EVENT_FILL_CANCEL') check(status === 'CANCELLED');
    const created = unsigned(row.create_time), updated = unsigned(row.updated_time);
    chronological(created, updated);
    return { fill_id: id, symbol: text(row.code), side: text(row.side), quantity: amount(row.qty), price: amount(row.price),
      status, created_us: created, updated_us: updated };
  });
  return { family: 'securities', topic, status: 'decoded', account_binding: 'matched-frame', event_id: text(frame.event_id),
    event_time_us: unsigned(frame.event_time_us), order, fills };
}

const subreports = Object.freeze({ 1: 'new_rpt', 3: 'cancel_rpt', 4: 'fill_rpt', 5: 'expire_rpt' });
// ReportMsg has no account ID or event timestamp. A consumer needs independent capture
// provenance to attach these private bytes to an account or a point on an event timeline.
export function replayMoomooCryptoReport(bytes) {
  const frame = decodeCryptoReport(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes), topic = frame.report_type;
  check(Number.isInteger(topic));
  if (!cryptoReportTopics.includes(topic)) return { family: 'crypto', topic, status: 'unsupported' };
  const raw = frame.order, sub = frame[subreports[topic]];
  check(object(raw) && object(sub) && Object.values(subreports).filter(key => Object.hasOwn(frame, key)).length === 1);
  check(text(raw.order_id) === text(sub.order_id), 'ORDER_BINDING');
  check([1, 2].includes(raw.side) && [1, 2, 3, 4, 5, 6].includes(raw.ord_type) && typeof raw.is_close === 'boolean');
  const order = { order_id: raw.order_id, side: raw.side === 1 ? 'BUY' : 'SELL', type: raw.ord_type, coin: text(raw.coin),
    currency: text(raw.currency), price: optionalAmount(raw.price), quantity: amount(raw.order_qty), created_us: unsigned(raw.create_time),
    closed: raw.is_close, filled_quantity: amount(raw.cum_qty), average_fill_price: optionalAmount(raw.avg_px), time_in_force: raw.time_in_force ?? null };
  let outcome, fill = null, result = null;
  if (topic === 1 || topic === 3) {
    check(Number.isInteger(sub.result));
    result = sub.result;
    if (topic === 1) { check(order.closed === (result !== 0)); outcome = result === 0 ? 'placed' : 'placement-rejected'; }
    else { if (result === 0) check(order.closed); outcome = result === 0 ? 'cancelled' : 'cancellation-rejected'; }
  } else if (topic === 4) {
    check([1, 2].includes(sub.fill_status) && order.closed === (sub.fill_status === 2));
    outcome = order.closed ? 'filled' : 'partial-fill';
    fill = { fill_id: text(sub.fill_id), price: amount(sub.last_px), quantity: amount(sub.last_qty),
      remaining_quantity: amount(sub.leave_qty), amount: optionalAmount(sub.last_amount),
      flow_id: sub.biz_flow_id ? text(sub.biz_flow_id) : null };
  } else { check(order.closed); outcome = 'expired'; }
  return { family: 'crypto', topic, status: 'decoded', account_binding: 'absent-from-frame', event_id: text(frame.report_id),
    event_time_us: null, order, outcome, result, has_error: typeof sub.err_msg === 'string' && sub.err_msg.length > 0, fill };
}
