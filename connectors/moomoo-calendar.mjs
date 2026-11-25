import { check, cursorPagination, integer, marketDate, opaqueCursor, only, root, string } from './moomoo-rest-wire.mjs';

// Local REST mapping identifiers. These endpoints have no tool in the public MCP directory.
export const calendarRoutes = Object.freeze({
  rest_dividend_calendar: 'GET ' + root + 'dividend-calendar',
  rest_economic_calendar_list: 'GET ' + root + 'economic-calendar/list',
});
const markets = ['HK', 'US', 'SG', 'JP', 'MY', 'CN', 'CA', 'AU'];
const tabs = ['ECONOMIC_DATA', 'ECONOMIC_EVENT', 'HOLIDAY', 'SELECTION'];
const economic = tool => tool === 'rest_economic_calendar_list';

export function calendarRequest(tool, inputs, path) {
  const events = economic(tool);
  const selectors = events ? ['begin_date', 'end_date', 'tab_type', 'market', 'star', 'only_focus'] : ['market', 'date'];
  only(inputs, [...selectors, 'page_size', 'page_flag']);
  if (events) {
    check(typeof inputs.begin_date === 'string');
    marketDate(inputs.begin_date, 'INVALID_PARAMETER');
    if (inputs.end_date !== undefined && inputs.end_date !== '') {
      check(typeof inputs.end_date === 'string' && marketDate(inputs.end_date, 'INVALID_PARAMETER') >= inputs.begin_date);
    }
    if (Object.hasOwn(inputs, 'tab_type')) check(tabs.includes(inputs.tab_type));
    if (Object.hasOwn(inputs, 'market')) check([...markets, 'ALL', 'KR'].includes(inputs.market));
    if (Object.hasOwn(inputs, 'star')) integer(inputs.star, 0, 5);
    if (Object.hasOwn(inputs, 'only_focus')) check(typeof inputs.only_focus === 'boolean');
  } else {
    check(markets.includes(inputs.market) && typeof inputs.date === 'string');
    marketDate(inputs.date, 'INVALID_PARAMETER');
  }
  if (Object.hasOwn(inputs, 'page_size')) integer(inputs.page_size, 1, events ? 100 : 200);
  if (Object.hasOwn(inputs, 'page_flag')) check(opaqueCursor(inputs.page_flag, events ? 128 : 64));
  const query = new URLSearchParams();
  for (const key of [...selectors, 'page_size', 'page_flag']) if (Object.hasOwn(inputs, key)) query.set(key, inputs[key]);
  return { method: 'GET', path: path + '?' + query };
}

function dividend(row, inputs) {
  const code = string(row.code);
  const market = code.split('.')[0];
  check(/^[A-Z]+\.[A-Za-z0-9_.-]+$/.test(code) && (market === inputs.market || (inputs.market === 'CN' && ['SH', 'SZ', 'BJ'].includes(market))), 'SECURITY_MISMATCH');
  check(row.ex_date === inputs.date, 'DATE_RANGE_MISMATCH');
  const date = value => value === '' || value == null ? value ?? null : marketDate(string(value));
  return { code, name: string(row.name), statement: string(row.statement), record_date: date(row.record_date),
    ex_date: row.ex_date, dividend_payable_date: date(row.dividend_payable_date) };
}
function event(row, inputs) {
  const timestamp = integer(row.timestamp, 0, Math.floor((8.64e15 - 28_800_000) / 1000), 'INVALID_PAGE');
  const day = new Date(timestamp * 1000 + 28_800_000).toISOString().slice(0, 10);
  check(day >= inputs.begin_date && day <= (inputs.end_date || inputs.begin_date), 'DATE_RANGE_MISMATCH');
  const star = integer(row.star, 0, 5, 'INVALID_PAGE');
  check(!inputs.star || inputs.star === star, 'INVALID_PAGE');
  // Published examples use integer type codes. Keep the wire value without guessing the enum.
  const kind = typeof row.item_type === 'string' ? string(row.item_type) : integer(row.item_type, 0, 2147483647, 'INVALID_PAGE');
  const result = { article_id: string(row.article_id), item_type: kind, title: string(row.title), timestamp, country: string(row.country), star };
  for (const key of ['previous', 'consensus', 'actual', 'detail_url']) if (Object.hasOwn(row, key)) result[key] = string(row[key]);
  if (Object.hasOwn(row, 'is_focus')) { check(typeof row.is_focus === 'boolean', 'INVALID_PAGE'); result.is_focus = row.is_focus; }
  check(!inputs.only_focus || result.is_focus === true, 'INVALID_PAGE');
  return result;
}
export function calendarPage(tool, inputs, response) {
  const events = economic(tool), items = response.data?.items, page = response.pagination;
  check(Array.isArray(items) && items.length <= (inputs.page_size ?? 50), 'INVALID_PAGE');
  const pagination = cursorPagination(page, inputs.page_flag, events ? 128 : 64);
  const rows = items.map(row => {
    check(row !== null && typeof row === 'object' && !Array.isArray(row), 'INVALID_PAGE');
    return events ? event(row, inputs) : dividend(row, inputs);
  });
  return { rows, pagination };
}
