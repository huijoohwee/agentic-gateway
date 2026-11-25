import { WireNumber, check, decimal, integer, marketDate, only, readWire, root, string } from './moomoo-rest-wire.mjs';

const symbolPattern = /^[A-Z0-9_]+\.[A-Za-z0-9_.-]+$/;
const maxRows = 5000;
const pageFlag = Object.freeze({ string: Object.freeze([0, 20]) });
const pageSize = maximum => Object.freeze({ integer: Object.freeze([1, maximum]) });
const textParam = (maximum, allowEmpty = false) => Object.freeze({ string: Object.freeze([allowEmpty ? 0 : 1, maximum]) });
const choice = (...values) => Object.freeze({ enum: Object.freeze(values) });
const fieldPaths = names => Object.freeze(Object.fromEntries(names.map(name => [name, Object.freeze({ path: Object.freeze([name]) })])));

function spec({ route, params = {}, fields, text = [], integers = [], decimalText = [], dates = [],
  symbolPath = false, metadata = [], summary = [], pageInput = null, defaultPageSize = null,
  seriesLimit = maxRows, pagination = false, groups = null, single = false, signedIntegers = [], optionalFields = [] }) {
  const rowFields = { ...(symbolPath && { symbol: Object.freeze({ source: 'input', path: Object.freeze(['symbol']) }) }), ...fieldPaths(fields) };
  if (groups) rowFields.direction = Object.freeze({ source: 'derived', path: Object.freeze(['direction']) });
  return Object.freeze({ route, params: Object.freeze(params), fields: Object.freeze(rowFields),
    fieldNames: Object.freeze(fields), text: Object.freeze([...new Set([...(symbolPath ? ['symbol'] : []), ...text, ...(groups ? ['direction'] : [])])]),
    integers: Object.freeze(integers), signedIntegers: Object.freeze(signedIntegers), decimalText: Object.freeze(decimalText), dates: Object.freeze(dates),
    optionalFields: Object.freeze(optionalFields),
    metadata: Object.freeze(metadata), summary: Object.freeze(summary), symbolPath, pageInput, defaultPageSize,
    seriesLimit, pagination, groups: groups && Object.freeze(groups.map(group => Object.freeze(group))), single });
}

const specs = Object.freeze({
  rest_ark_active_transaction: spec({ route: 'GET ' + root + 'ark-active-transaction',
    params: { holding_type: choice('ALL', 'INCREASE', 'DECREASE', 'NEW', 'SOLD_OUT'), cycle_type: choice('ONE_DAY', 'FIVE_DAY', 'TEN_DAY', 'THIRTY_DAY', 'SIXTY_DAY'),
      sort_field: choice('CHANGE_AMOUNT', 'SHARES_CHANGE', 'DATE', 'MARKET_VALUE', 'WEIGHT', 'SHARES'),
      sort_dir: choice('DESCENDING', 'ASCENDING'), page_size: pageSize(200), page_flag: pageFlag,
      code: textParam(32, true), fund: textParam(32, true) },
    fields: ['code', 'name', 'holding_type', 'change_amount', 'change_shares'], text: ['code', 'name', 'holding_type'],
    decimalText: ['change_amount', 'change_shares', 'max_abs_value_change'], metadata: ['update_time', 'update_date', 'max_abs_value_change'],
    integers: ['update_time'], dates: ['update_date'],
    pageInput: 'page_size', defaultPageSize: 50, pagination: true }),
  rest_ark_active_transaction_query: spec({ route: 'GET ' + root + 'ark-active-transaction-query',
    params: { holding_type: choice('ALL', 'INCREASE', 'DECREASE', 'NEW', 'SOLD_OUT'),
      sort_field: choice('DATE', 'SHARES_CHANGE', 'MARKET_VALUE', 'WEIGHT', 'SHARES', 'CHANGE_AMOUNT'),
      sort_dir: choice('DESCENDING', 'ASCENDING'), page_size: pageSize(200), page_flag: pageFlag,
      code: textParam(32, true), fund: textParam(32, true), kline_based: Object.freeze({ boolean: true }) },
    fields: ['code', 'name', 'holding_type', 'date', 'change_amount', 'change_shares', 'price_close'],
    text: ['code', 'name', 'holding_type'], decimalText: ['change_amount', 'change_shares', 'price_close'],
    metadata: ['update_time', 'update_date'], integers: ['update_time'], dates: ['date', 'update_date'],
    pageInput: 'page_size', defaultPageSize: 50, pagination: true }),
  rest_ark_fund_holding: spec({ route: 'GET ' + root + 'ark-fund-holding',
    params: { holding_type: choice('POSITION', 'INCREASE', 'DECREASE', 'NEW', 'SOLD_OUT'),
      cycle_type: choice('ONE_DAY', 'FIVE_DAY', 'TEN_DAY', 'THIRTY_DAY', 'SIXTY_DAY'),
      sort_field: choice('SHARES', 'WEIGHT_CHANGE', 'SHARES_CHANGE', 'MARKET_VALUE', 'WEIGHT'),
      sort_dir: choice('DESCENDING', 'ASCENDING'), page_size: pageSize(200), page_flag: pageFlag, fund: textParam(32, true) },
    fields: ['code', 'name', 'shares', 'shares_change', 'market_value', 'weight', 'weight_change'],
    text: ['code', 'name'], decimalText: ['shares', 'shares_change', 'market_value', 'weight', 'weight_change'],
    pageInput: 'page_size', defaultPageSize: 20, pagination: true }),
  rest_ark_fund_holding_industry: spec({ route: 'GET ' + root + 'ark-fund-holding-industry',
    params: { fund: textParam(32, true) }, fields: ['industry_id', 'name', 'weight'],
    text: ['name'], decimalText: ['weight'], metadata: ['update_time', 'update_date'],
    integers: ['industry_id', 'update_time'], dates: ['update_date'] }),
  rest_ark_fund_return_rate: spec({ route: 'GET ' + root + 'ark-fund-return-rate',
    params: { compare_code: textParam(32, true) }, fields: ['date', 'return_rate', 'compare_increase'],
    text: [],
    summary: ['total_return_rate', 'market_value', 'stock_count', 'market_value_change', 'stock_count_change', 'update_time', 'update_date'],
    integers: ['stock_count', 'stock_count_change', 'update_time'], dates: ['date', 'update_date'], signedIntegers: ['stock_count_change'],
    decimalText: ['return_rate', 'compare_increase', 'total_return_rate', 'market_value', 'market_value_change'], seriesLimit: maxRows }),
  rest_ark_net_turnover_rank: spec({ route: 'GET ' + root + 'ark-net-turnover-rank',
    params: { cycle_type: choice('ONE_DAY', 'FIVE_DAY', 'TEN_DAY', 'THIRTY_DAY', 'SIXTY_DAY'),
      transaction_property: choice('ALL', 'ACTIVE'), fund: textParam(32, true) },
    fields: ['code', 'name', 'net_turnover'], text: ['code', 'name'], decimalText: ['net_turnover'],
    metadata: ['update_time', 'update_date'], integers: ['update_time'], dates: ['update_date'],
    groups: [{ path: ['increased'], direction: 'INCREASED' }, { path: ['decreased'], direction: 'DECREASED' }] }),
  rest_ark_stock_detail_daily: spec({ route: 'GET ' + root + '{code}/ark-stock-detail-daily', symbolPath: true,
    params: { fund: textParam(32, true), page_size: pageSize(60), page_flag: pageFlag },
    fields: ['date', 'shares', 'weight', 'shares_change', 'value_change', 'price_close', 'market_value'],
    decimalText: ['shares', 'weight', 'shares_change', 'value_change', 'price_close', 'market_value'],
    metadata: ['update_time', 'update_date'], integers: ['update_time'], dates: ['date', 'update_date'],
    optionalFields: ['shares', 'weight', 'shares_change', 'value_change', 'market_value'],
    pageInput: 'page_size', defaultPageSize: 20, pagination: true }),
  rest_ark_stock_detail_table: spec({ route: 'GET ' + root + '{code}/ark-stock-detail-table', symbolPath: true,
    params: { fund: textParam(32, true), sort_field: choice('DATE', 'SHARES_CHANGE', 'MARKET_VALUE', 'WEIGHT', 'SHARES'),
      sort_dir: choice('DESCENDING', 'ASCENDING'), page_size: pageSize(60), page_flag: pageFlag },
    fields: ['date', 'shares', 'weight', 'shares_change', 'value_change', 'price_close', 'market_value'],
    decimalText: ['shares', 'weight', 'shares_change', 'value_change', 'price_close', 'market_value'],
    metadata: ['update_time', 'update_date'], integers: ['update_time'], dates: ['date', 'update_date'],
    optionalFields: ['shares', 'weight', 'shares_change', 'value_change', 'market_value'],
    pageInput: 'page_size', defaultPageSize: 20, pagination: true }),
  rest_ark_stock_dynamic: spec({ route: 'GET ' + root + '{code}/ark-stock-dynamic', symbolPath: true,
    params: {}, fields: ['dynamic_type', 'transaction_count', 'net_shares', 'last_transaction_date', 'avatar_url'],
    text: ['dynamic_type', 'avatar_url'], integers: ['transaction_count'], decimalText: ['net_shares'], dates: ['last_transaction_date'], single: true })
});

export const arkRestRoutes = Object.freeze(Object.fromEntries(Object.entries(specs).map(([tool, item]) => [tool, item.route])));

const exactDecimalKeys = new Set(['change_amount', 'change_shares', 'price_close', 'shares', 'shares_change', 'market_value',
  'weight', 'weight_change', 'return_rate', 'compare_increase', 'total_return_rate', 'market_value_change', 'net_turnover', 'value_change', 'net_shares']);
const fieldsToMap = names => Object.freeze(Object.fromEntries(names.map(name => [name,
  Object.freeze({ path: Object.freeze([name]) })])));

function verifySymbol(value) {
  check(typeof value === 'string' && value.length <= 32 && symbolPattern.test(value), 'INVALID_PARAMETER');
  return value;
}
function validateString(value, rule) {
  check(typeof value === 'string' && [...value].length >= rule.string[0] && [...value].length <= rule.string[1]
    && !/[\u0000-\u001f\u007f]/u.test(value) && value.isWellFormed(), 'INVALID_PARAMETER');
  return value;
}
function buildRequest(tool, inputs) {
  const item = specs[tool], names = Object.keys(item.params);
  only(inputs, [...(item.symbolPath ? ['symbol'] : []), ...names]);
  const symbol = item.symbolPath ? verifySymbol(inputs.symbol) : null, query = new URLSearchParams();
  for (const [name, rule] of Object.entries(item.params)) {
    if (!Object.hasOwn(inputs, name)) continue;
    const value = inputs[name];
    if (rule.enum) check(rule.enum.includes(value), 'INVALID_PARAMETER');
    else if (rule.integer) integer(value, rule.integer[0], rule.integer[1]);
    else if (rule.boolean) check(typeof value === 'boolean', 'INVALID_PARAMETER');
    else if (rule.string) validateString(value, rule);
    else check(false, 'INVALID_PARAMETER');
    query.set(name, value);
  }
  const path = item.route.slice(item.route.indexOf(' ') + 1).replace('{code}', encodeURIComponent(symbol ?? ''));
  return { method: 'GET', path: query.size ? path + '?' + query : path };
}
export function buildMoomooArkRequest(tool, inputs) {
  check(typeof tool === 'string' && Object.hasOwn(specs, tool), 'UNSUPPORTED');
  return buildRequest(tool, inputs);
}
export function describeMoomooArk(tool) {
  check(typeof tool === 'string' && Object.hasOwn(specs, tool), 'UNSUPPORTED');
  const item = specs[tool], fieldNames = [...(item.symbolPath ? ['symbol'] : []), ...item.fieldNames, ...(item.groups ? ['direction'] : [])];
  const rowLimit = item.pageInput ? { input: item.pageInput, fallback: item.defaultPageSize }
    : item.single ? 1 : item.seriesLimit;
  return structuredClone({ tool, route: item.route,
    fields: { ...(item.symbolPath && { symbol: { source: 'input', path: ['symbol'] } }), ...fieldsToMap(item.fieldNames),
      ...(item.groups && { direction: { path: ['direction'] } }) },
    field_names: fieldNames, text: item.text, integers: item.integers, decimal_text: item.decimalText, date: item.dates,
    optional_fields: item.optionalFields,
    params: item.params, rows_path: item.groups ? item.groups.map(group => group.path) : item.single ? [] : ['items'],
    ...(item.symbolPath && { symbol_path: true }), ...(item.single && { single_row: true }),
    ...(item.groups && { groups: item.groups }), ...(item.metadata.length && { metadata_fields: item.metadata }),
    ...(item.summary.length && { summary_fields: item.summary }),
    ...(item.pagination && { pagination: ['pagination'], cursor_limit: 20 }),
    ...(item.pageInput ? { row_limit: rowLimit } : { series_limit: rowLimit }) });
}

function object(value) { check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PAGE'); return value; }
function atPath(value, path) { for (const key of path) value = object(value)[key]; return value; }
function whole(value, signed = false) {
  const number = value instanceof WireNumber ? Number(value.source) : value;
  return integer(number, signed ? -Number.MAX_SAFE_INTEGER : 0, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE');
}
function valueFor(name, value, item) {
  check(value !== null && value !== undefined, 'INVALID_PAGE');
  if (item.integers.includes(name)) return whole(value, item.signedIntegers.includes(name));
  if (item.decimalText.includes(name)) return decimal(value);
  if (item.dates.includes(name)) return marketDate(value);
  return string(value);
}
function record(source, inputs, item, derived = {}) {
  object(source);
  const row = { ...(item.symbolPath && { symbol: verifySymbol(inputs.symbol) }), ...derived };
  for (const name of item.fieldNames) {
    if (!Object.hasOwn(source, name) && item.optionalFields.includes(name)) continue;
    row[name] = valueFor(name, source[name], item);
  }
  return row;
}
function valuesAt(data, names, item) {
  const values = {};
  for (const name of names) values[name] = valueFor(name, data[name], item);
  return values;
}
function paginationInfo(response, inputs) {
  const page = object(response.pagination);
  check(typeof page.completed === 'boolean' && typeof page.page_flag === 'string' && page.page_flag.length <= 20
    && !/[\u0000-\u001f\u007f]/u.test(page.page_flag) && page.page_flag.isWellFormed(), 'INVALID_PAGE');
  check(page.completed ? page.page_flag === '' : page.page_flag.length > 0 && page.page_flag !== (inputs.page_flag ?? ''), 'INVALID_PAGE');
  if (page.total !== undefined) whole(page.total);
  return { completed: page.completed, next_page_token: page.completed ? null : page.page_flag,
    ...(page.total !== undefined && { total: whole(page.total) }) };
}
function itemRows(data, path, inputs, item) {
  const rows = atPath(data, path);
  check(Array.isArray(rows), 'INVALID_PAGE');
  const limit = inputs[item.pageInput] ?? item.defaultPageSize ?? item.seriesLimit;
  check(rows.length <= limit, 'INVALID_PAGE');
  return rows.map(source => record(source, inputs, item));
}
function groupedRows(data, item) {
  const rows = [];
  for (const group of item.groups) {
    const values = atPath(data, group.path);
    check(Array.isArray(values), 'INVALID_PAGE');
    check(rows.length + values.length <= item.seriesLimit, 'INVALID_PAGE');
    rows.push(...values.map(source => record(source, {}, item, { direction: group.direction })));
  }
  return rows;
}
export function projectMoomooArkResponse(tool, inputs, wire) {
  check(typeof tool === 'string' && Object.hasOwn(specs, tool), 'UNSUPPORTED');
  buildRequest(tool, inputs);
  const item = specs[tool], response = readWire(wire, exactDecimalKeys);
  check(Number.isSafeInteger(response?.ret_code), 'INVALID_PAGE');
  if (response.ret_code !== 0) {
    const codes = { [-3]: 'INVALID_PARAMETER', [-8]: 'UNSUPPORTED', [-10]: 'NO_DATA' };
    check(false, codes[response.ret_code] ?? 'PROVIDER_ERROR');
  }
  const data = object(response.data);
  const rows = item.groups ? groupedRows(data, item)
    : item.single ? [record(data, inputs, item)]
      : itemRows(data, ['items'], inputs, item);
  const metadata = item.metadata.length ? valuesAt(data, item.metadata, item) : undefined;
  const summary = item.summary.length ? valuesAt(data, item.summary, item) : undefined;
  return { rows, ...(metadata && { metadata }), ...(summary && { summary }),
    ...(item.pagination && { pagination: paginationInfo(response, inputs) }) };
}

