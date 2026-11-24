export const root = '/api/v1.0/quote/';
const decimalKeys = new Set(['price', 'price_ex', 'volume', 'turnover', 'sequence', 'open_price', 'close_price', 'last_price',
  'high_price', 'low_price', 'prev_close_price', 'last_close_price', 'change_rate', 'turnover_rate',
  'open', 'high', 'low', 'close', 'last_close', 'pe_ratio', 'open_interest', 'settle_price', 'implied_volatility',
  'stock_id', 'strike_price']);
const amountPattern = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

export function check(condition, code = 'INVALID_PARAMETER') {
  if (!condition) throw Object.assign(new Error(code), { code });
}
export function only(input, keys) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => keys.includes(key)));
}
export function integer(value, min, max, code = 'INVALID_PARAMETER') {
  check(Number.isSafeInteger(value) && value >= min && value <= max, code); return value;
}
export function string(value) { check(typeof value === 'string', 'INVALID_PAGE'); return value; }

// Preserve the actual JSON number token. A quoted decimal and a JSON number have distinct origins.
export class WireNumber { constructor(source) { this.source = source; } }
export function readWire(wire) {
  check(typeof wire === 'string' && wire.length <= 480000 && new TextEncoder().encode(wire).length <= 480000, 'INVALID_WIRE');
  try {
    return JSON.parse(wire, (key, value, context) => {
      if (typeof value !== 'number' || !decimalKeys.has(key)) return value;
      check(typeof context?.source === 'string', 'PRECISION_UNKNOWN');
      return new WireNumber(context.source);
    });
  } catch (error) { if (error.code) throw error; check(false, 'INVALID_WIRE'); }
}
export function decimal(value) {
  const text = value instanceof WireNumber ? value.source : value;
  check(typeof text === 'string' && text.length <= 96 && amountPattern.test(text) && Number.isFinite(Number(text)), 'PRECISION_UNKNOWN');
  return text;
}
export function measure(row, key) { return row[key] == null ? null : decimal(row[key]); }
export function marketDate(value, error = 'INVALID_PAGE') {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3') : value;
  check(typeof text === 'string' && /^\d{4}-\d\d-\d\d$/.test(text), error);
  const millis = Date.parse(text + 'T00:00:00Z');
  check(Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === text, error);
  return text;
}
export function completePage(pagination) {
  check(pagination == null || (typeof pagination === 'object' && !Array.isArray(pagination) &&
    [undefined, false].includes(pagination.has_more) && !pagination.next_page_token), 'INCOMPLETE_PAGE');
}
