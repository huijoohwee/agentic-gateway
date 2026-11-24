// Public quote_stock_screen contract. The fixed market filter never selects an account list.
export const STOCK_SCREEN_PATH = '/api/v1.0/quote/stock-screen';
export const STOCK_SCREEN_TOOL = 'quote_stock_screen';

const markets = {
  HK: [1, ['HK']], US: [2, ['US']], CN: [3, ['SH', 'SZ', 'CN']], SG: [4, ['SG']],
  CA: [5, ['CA']], AU: [6, ['AU']], JP: [7, ['JP', 'JA']], MY: [8, ['MY']],
};
// Provider property number and decimal places in its raw integer.
const factors = {
  last_price: [2201, 3], market_cap: [2301, 3], annual_pe: [2302, 5], pe_ttm: [2303, 5],
  price_to_book: [2304, 5], dividend_yield_pct: [2305, 3], listing_epoch_seconds: [2306, 0],
};
const sorts = { ascending: 1, descending: 2, absolute_ascending: 3, absolute_descending: 4 };

function check(condition, code = 'INVALID_PARAMETER') {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function object(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function only(value, keys) { check(object(value) && Object.keys(value).every(k => keys.includes(k))); }
function factor(name) {
  check(typeof name === 'string' && Object.hasOwn(factors, name));
  return factors[name];
}
function cursor(value) { return typeof value === 'string' && value.length <= 1000 && /^(-?[0-9]+)?$/.test(value); }

function scaledBound(bound, places) {
  only(bound, ['value', 'includes']);
  check(typeof bound.includes === 'boolean' && typeof bound.value === 'string' &&
    /^-?\d{1,20}(?:\.\d{1,20})?$/.test(bound.value));
  const negative = bound.value.startsWith('-');
  const [whole, fraction = ''] = bound.value.replace(/^-/, '').split('.');
  check(!/[1-9]/.test(fraction.slice(places)));
  const raw = BigInt(whole + fraction.slice(0, places).padEnd(places, '0')) * (negative ? -1n : 1n);
  const value = Number(raw);
  check(Number.isSafeInteger(value));
  return { value, includes: bound.includes };
}

export function buildMoomooStockScreen(inputs) {
  only(inputs, ['market', 'filters', 'factors', 'sorts', 'limit', 'next_key']);
  check(typeof inputs.market === 'string' && Object.hasOwn(markets, inputs.market));
  const { filters = [], factors: requested = [], sorts: ordering = [] } = inputs;
  check(Array.isArray(filters) && filters.length < 10000 && Array.isArray(requested) && requested.length <= 7 &&
    new Set(requested).size === requested.length && Array.isArray(ordering) && ordering.length <= 7);
  const screen_queries = [{ simple_field_query: { simple_field: 1, screen_value_list: [markets[inputs.market][0]] } }];
  for (const item of filters) {
    only(item, ['factor', 'lower', 'upper']);
    const [name, places] = factor(item.factor);
    check(Object.hasOwn(item, 'lower') || Object.hasOwn(item, 'upper'));
    const query = { property: { name } };
    for (const side of ['lower', 'upper']) if (Object.hasOwn(item, side)) query[side] = scaledBound(item[side], places);
    if (query.lower && query.upper) check(query.lower.value < query.upper.value ||
      (query.lower.value === query.upper.value && query.lower.includes && query.upper.includes));
    screen_queries.push({ simple_property_query: query });
  }
  const body = { screen_queries };
  if (requested.length) body.retrieve_queries = requested.map(key => ({ simple_property: { name: factor(key)[0] } }));
  if (ordering.length) {
    const seen = new Set();
    body.sorts = ordering.map(item => {
      only(item, ['factor', 'direction']);
      const [name] = factor(item.factor);
      check(!seen.has(name) && typeof item.direction === 'string' && Object.hasOwn(sorts, item.direction));
      seen.add(name);
      return { direction: sorts[item.direction], simple_property: { name } };
    });
  }
  if (Object.hasOwn(inputs, 'limit')) {
    check(Number.isSafeInteger(inputs.limit) && inputs.limit >= 1 && inputs.limit <= 300);
    body.limit = inputs.limit;
  }
  if (Object.hasOwn(inputs, 'next_key')) {
    check(cursor(inputs.next_key) && inputs.next_key !== '-1');
    body.next_key = inputs.next_key;
  }
  check(new TextEncoder().encode(JSON.stringify(body)).length <= 480_000, 'INPUT_TOO_LARGE');
  return body;
}

function resultValue(entry, key) {
  const [name, places] = factor(key);
  const result = entry?.simple_property_result ?? entry;
  check(object(result) && (!Object.hasOwn(result, 'property') || result.property?.name === name), 'INVALID_PAGE');
  const res = result.res;
  check(object(res) && (res.result_type ?? result.result_type) === 2 &&
    (result.result_type == null || result.result_type === 2), 'INVALID_PAGE');
  const raw = res.ival;
  check(Number.isSafeInteger(raw) || (typeof raw === 'string' && /^-?\d{1,19}$/.test(raw)), 'PRECISION_UNKNOWN');
  const integer = BigInt(raw);
  check(integer >= -(1n << 63n) && integer < (1n << 63n), 'PRECISION_UNKNOWN');
  const digits = (integer < 0n ? -integer : integer).toString().padStart(places + 1, '0');
  const value = places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits;
  return { factor: key, raw: String(raw), value: (integer < 0n ? '-' : '') + value };
}

export function projectMoomooStockScreen(inputs, response) {
  const request = buildMoomooStockScreen(inputs);
  check(Number.isSafeInteger(response?.ret_code), 'INVALID_RESPONSE');
  if (response.ret_code === -10) return { rows: [], pagination: { total: 0, completed: true, next_cursor: null } };
  const errorCodes = { '-3': 'INVALID_PARAMETER', '-8': 'UNSUPPORTED', '-9': 'SCOPE_DENIED' };
  check(response.ret_code === 0, errorCodes[response.ret_code] ?? 'PROVIDER_ERROR');
  const items = response.data?.items, page = response.pagination;
  check(Array.isArray(items) && items.length <= (request.limit ?? 200) && object(page) &&
    typeof page.has_more === 'boolean' && Number.isSafeInteger(page.total) && page.total >= items.length &&
    cursor(page.next_key) && (!page.has_more || page.next_key !== '' && page.next_key !== '-1' && page.next_key !== inputs.next_key), 'INVALID_PAGE');
  const requested = inputs.factors ?? [], seen = new Set();
  const rows = items.map(item => {
    check(typeof item?.code === 'string' && /^[A-Z]+\.[A-Za-z0-9_.-]{1,32}$/.test(item.code) &&
      markets[inputs.market][1].includes(item.code.split('.')[0]) && !seen.has(item.code) &&
      typeof item.name === 'string' && Array.isArray(item.results) && item.results.length === requested.length, 'INVALID_PAGE');
    seen.add(item.code);
    return { symbol: item.code, name: item.name, factors: item.results.map((entry, i) => resultValue(entry, requested[i])) };
  });
  return { rows, pagination: { total: page.total, completed: !page.has_more, next_cursor: page.has_more ? page.next_key : null } };
}
