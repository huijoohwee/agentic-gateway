import { WireNumber, check, cursorPagination, decimal, integer, only, opaqueCursor, root, string } from './moomoo-rest-wire.mjs';

const markets = ['HK', 'US', 'SH', 'SZ', 'SG', 'JP', 'AU', 'CA', 'MY'];
const directions = ['DESCENDING', 'ASCENDING'];
const priceFilters = ['ALL', 'LESS_THAN_1', 'BETWEEN_1_AND_10', 'BETWEEN_10_AND_100', 'GREATER_THAN_100', 'NEAR_52_WEEK_HIGH', 'NEAR_52_WEEK_LOW'];
const moverOptions = { sort_dir: directions, price_filter: priceFilters };
const capBounds = ['market_cap_min', 'market_cap_max'];
const moverBounds = [...capBounds, 'pe_min', 'pe_max'];
const periods = ['5min', '5d', '10d', '20d', '60d', '120d', '250d'];
function session(prefix) {
  return { fixedMarket: 'US', options: moverOptions, bounds: moverBounds,
    text: [...['price', 'change_ratio', 'change_amount', 'turnover', 'volume'].map(key => prefix + '_' + key), 'close_price', 'change_ratio', 'change_amount'] };
}
// Each profile describes one public REST route. Providers use different types for similarly named columns.
const profiles = {
  rest_rank_us_pre_market: session('pre_market'),
  rest_rank_us_after_hours: session('after_hours'),
  rest_rank_us_overnight: session('overnight'),
  rest_rank_top_movers: { required: ['market'], options: { market: markets, ...moverOptions }, bounds: moverBounds,
    text: ['cur_price', 'change_ratio', 'change_amount', 'turnover', 'volume', 'turnover_ratio'], number: ['pe_ttm', 'amplitude'] },
  rest_rank_period_change: { required: ['market'], options: { market: markets, ...moverOptions,
    period_type: ['5MIN', '1DAY', '5DAY', '20DAY', '60DAY', '120DAY', '250DAY', 'YTD'] }, bounds: moverBounds,
    text: ['cur_price', 'change_ratio', 'turnover', 'volume', 'turnover_ratio', 'volume_ratio'],
    number: ['market_cap', ...[...periods, 'ytd'].map(period => 'change_rate_' + period), 'pe_ttm', 'pb', 'amplitude'] },
  rest_rank_dividend: { required: ['market', 'rank_type'], options: { market: markets, rank_type: ['HIGH_YIELD', 'DIVIDEND_GROWTH'], sort_dir: directions,
    sort_field: ['NONE', 'DIVIDEND_YIELD_TTM', 'AVG_DIVIDEND_YIELD_5Y', 'DISTRIBUTION_FREQUENCY', 'DIVIDEND_GROW_YEAR', 'DIVIDENDS_TTM', 'PAYOUT_RATIO_LFY', 'PRICE', 'MARKET_CAP', 'CHANGE_RATE', 'CHANGE_AMOUNT'] }, bounds: capBounds,
    text: ['industry', 'cur_price', 'change_amount', 'distribution_frequency'], integer: ['dividend_grow_year'],
    number: ['change_rate', 'market_cap', 'dividend_yield_ttm', 'avg_dividend_yield_5y', 'dividends_ttm', 'payout_ratio_lfy'] },
  rest_rank_high_dividend_soe: { fixedMarket: 'HK', maxSize: 300, options: { sort_dir: directions,
    sort_field: ['DIVIDEND_YIELD_TTM', 'PB', 'PE_TTM', 'PRICE', 'CHANGE_RATIO', 'MARKET_CAP'] },
    text: ['industry', 'cur_price', 'change_ratio'], number: ['market_cap', 'pe_ttm', 'pb', 'dividend_yield_ttm', ...periods.slice(1).map(period => 'change_rate_' + period)] },
  rest_rank_earnings_beat: { required: ['market', 'beat_type'], defaultSize: 30, maxSize: 300,
    options: { market: ['HK', 'US', 'SG', 'JP'], beat_type: ['EPS', 'REVENUE', 'EBIT'], term: ['LATEST', 'LATEST_QUARTER', 'LATEST_HALF', 'LATEST_ANNUAL', 'ALL'],
      sort_field: ['BEAT_RATIO', 'EARNING_DAY_CHG', 'RELEASED_DATE', 'ACTUAL', 'ESTIMATE', 'YOY', 'YOY_GROWTH', 'PE_TTM', 'DIVIDENDS_TTM', 'PRICE', 'CHANGE_RATE', 'MARKET_CAP'] },
    text: ['industry', 'cur_price', 'last_close_price', 'released_date', 'beat_ratio', 'term'],
    number: ['change_rate', 'market_cap', 'pe_ttm', 'dividends_ttm', 'actual', 'estimate', 'yoy', 'yoy_growth', 'earning_day_chg'] },
  rest_rank_short_selling: { required: ['market'], maxSize: 35, plates: true, options: { market: ['HK', 'US'], sort_dir: directions,
    sort_field: ['SHORT_NUMBER_CHANGE', 'SHORT_RATIO_CHANGE', 'SHORT_NUMBER', 'SHORT_RATIO', 'VOLUME', 'POSITION_VOLUME', 'POSITION_RATIO', 'DAYS_TO_COVER', 'WEEK_AVG_VOLUME', 'WEEK_AVG_SHORT_NUMBER', 'WEEK_AVG_SHORT_RATIO', 'MONTH_AVG_VOLUME', 'MONTH_AVG_SHORT_NUMBER', 'MONTH_AVG_SHORT_RATIO'] },
    text: ['close_price', 'change_ratio', 'volume', 'short_ratio', 'short_ratio_change', 'short_position_volume', 'short_position_ratio', 'week_avg_short_ratio', 'month_avg_short_ratio'],
    number: ['change_ratio_5d', 'change_ratio_10d', 'days_to_cover'], integer: ['short_number', 'short_number_change', 'week_avg_short_number', 'month_avg_short_number'] },
};
export const rankRoutes = Object.freeze(Object.fromEntries(Object.keys(profiles).map(id =>
  [id, 'GET ' + root + 'rank/' + id.slice('rest_rank_'.length).replaceAll('_', '-')])));
export const rankNumberKeys = tool => new Set([...(profiles[tool].number ?? []), ...(profiles[tool].integer ?? [])]);

function bound(value) {
  check(typeof value === 'string' || (typeof value === 'number' && (!Number.isInteger(value) || Number.isSafeInteger(value))));
  const text = String(value);
  const parts = /^(-?\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  check(text.length <= 96 && parts && Number.isFinite(Number(text)) && Math.abs(Number(parts[3] ?? 0)) <= 400);
  return { text, units: BigInt(parts[1] + (parts[2] ?? '')), scale: (parts[2]?.length ?? 0) - Number(parts[3] ?? 0) };
}
export function rankRequest(tool, input, path) {
  const profile = profiles[tool], options = Object.entries(profile.options), bounds = profile.bounds ?? [];
  only(input, [...Object.keys(profile.options), ...bounds, 'page_flag', 'page_size', ...(profile.plates ? ['plate_code'] : [])]);
  for (const key of profile.required ?? []) check(Object.hasOwn(input, key));
  const query = new URLSearchParams();
  for (const [key, allowed] of options) if (Object.hasOwn(input, key)) {
    check(allowed.includes(input[key])); query.set(key, input[key]);
  }
  const limits = new Map();
  for (const key of bounds) if (Object.hasOwn(input, key)) {
    const parsed = bound(input[key]);
    check(!capBounds.includes(key) || parsed.units >= 0n);
    limits.set(key, parsed); query.set(key, parsed.text);
  }
  for (const unit of ['market_cap', 'pe']) {
    const lower = limits.get(unit + '_min'), upper = limits.get(unit + '_max');
    if (lower && upper) {
      const scale = Math.max(lower.scale, upper.scale);
      check(lower.units * 10n ** BigInt(scale - lower.scale) <= upper.units * 10n ** BigInt(scale - upper.scale));
    }
  }
  if (Object.hasOwn(input, 'plate_code')) {
    check(Array.isArray(input.plate_code) && input.plate_code.length <= 20);
    for (const code of input.plate_code) {
      check(typeof code === 'string' && code.length > 0 && !/[\u0000-\u001f\u007f]/u.test(code));
      query.append('plate_code', code);
    }
  }
  if (Object.hasOwn(input, 'page_flag')) { check(opaqueCursor(input.page_flag, 64)); query.set('page_flag', input.page_flag); }
  if (Object.hasOwn(input, 'page_size')) query.set('page_size', integer(input.page_size, 1, profile.maxSize ?? 200));
  return { method: 'GET', path: query.size ? path + '?' + query : path };
}
export function rankPage(tool, input, response) {
  const profile = profiles[tool], items = response.data?.items;
  check(Array.isArray(items) && items.length <= (input.page_size ?? profile.defaultSize ?? 10), 'INVALID_PAGE');
  const pagination = cursorPagination(response.pagination, input.page_flag, 64);
  const market = profile.fixedMarket ?? input.market;
  const rows = items.map(item => {
    check(item && typeof item === 'object' && !Array.isArray(item), 'INVALID_PAGE');
    const code = string(item.code), prefix = code.split('.')[0];
    const combined = tool === 'rest_rank_period_change' && ['SH', 'SZ'].includes(market);
    check(/^[A-Z]+\.[A-Za-z0-9_.-]+$/.test(code) && (prefix === market || (combined && ['SH', 'SZ'].includes(prefix))), 'SECURITY_MISMATCH');
    const row = { code, name: string(item.name) };
    for (const key of profile.text) row[key] = string(item[key]);
    for (const key of [...(profile.number ?? []), ...(profile.integer ?? [])]) {
      check(item[key] instanceof WireNumber, 'INVALID_PAGE');
      const value = decimal(item[key]);
      if (profile.integer?.includes(key)) check(/^-?\d+$/.test(value), 'INVALID_PAGE');
      row[key] = value;
    }
    return row;
  });
  return { rows, pagination };
}
