import { WireNumber, check, integer, string, readWire, decimal, marketDate, root } from './moomoo-rest-wire.mjs';

const symbolPattern = /^[A-Z0-9_]+\.[A-Za-z0-9_.-]+$/;
const uidRule = Object.freeze({ required: true, length: Object.freeze([1, 256]) });
const uidListRule = Object.freeze({ required: true, length: Object.freeze([1, 1024]), comma_separated: true });
const pageFlagRule = Object.freeze({ length: Object.freeze([0, 64]) });
const pageSizeRule = Object.freeze({ integer: Object.freeze([1, 20]) });
const countRule = Object.freeze({ integer: Object.freeze([1, 20]) });
const cursorFields = Object.freeze(['pagination']);
const itemPath = Object.freeze(['items']);
const rowFields = (names, symbolPath) => Object.freeze({
  ...(symbolPath && { symbol: Object.freeze({ source: 'input', path: Object.freeze(['symbol']) }) }),
  ...Object.fromEntries(names.map(name => [name, Object.freeze({ path: Object.freeze([name]) })]))
});
const freezeSpec = spec => Object.freeze({ ...spec, params: Object.freeze(spec.params ?? {}), rows_path: Object.freeze(spec.rows_path),
  fields: rowFields(spec.field_names, spec.symbol_path), field_names: Object.freeze(spec.field_names),
  text: Object.freeze([...new Set([...(spec.symbol_path ? ['symbol'] : []), ...(spec.text ?? [])])]), integer: Object.freeze(spec.integer ?? []),
  decimal_text: Object.freeze(spec.decimal_text ?? []), date: Object.freeze(spec.date ?? []),
  ...(spec.pagination && { pagination: cursorFields, cursor_limit: 64 }),
  ...(spec.total_required && { optional_total: false }) });

const specs = Object.freeze({
  rest_research_analyst_stock_ratings: freezeSpec({
    route: 'GET ' + root + '{code}/research/analyst-ratings', symbol_path: true, rows_path: itemPath,
    params: { analyst_uid: uidRule, count: countRule }, default_page_size: 10, row_limit: 20,
    field_names: ['rating', 'target_price', 'recommendation_date'], integer: ['rating'],
    decimal_text: ['target_price'], date: ['recommendation_date']
  }),
  rest_research_institution_rating_summary: freezeSpec({
    route: 'GET ' + root + '{code}/research/institution-rating-summary', symbol_path: true, single_row: true,
    rows_path: Object.freeze([]), row_limit: 1, params: { institution_uid: uidRule },
    field_names: ['institution_name', 'institution_uid'], text: ['institution_name', 'institution_uid']
  }),
  rest_research_institution_ratings: freezeSpec({
    route: 'GET ' + root + 'research/institution-ratings', rows_path: itemPath,
    params: { institution_uid: uidRule, market: Object.freeze({ length: Object.freeze([1, 64]) }), count: countRule },
    default_page_size: 10, row_limit: 20, field_names: ['code', 'rating', 'target_price', 'recommendation_date'],
    text: ['code'], integer: ['rating'], decimal_text: ['target_price'], date: ['recommendation_date']
  }),
  rest_research_institution_stock_ratings: freezeSpec({
    route: 'GET ' + root + '{code}/research/institution-ratings', symbol_path: true, rows_path: itemPath,
    params: { institution_uid: uidRule, count: countRule }, default_page_size: 10, row_limit: 20,
    field_names: ['rating', 'target_price', 'recommendation_date'], integer: ['rating'],
    decimal_text: ['target_price'], date: ['recommendation_date']
  }),
  rest_research_latest_ratings: freezeSpec({
    route: 'GET ' + root + 'research/latest-ratings', rows_path: itemPath,
    params: { market: Object.freeze({ enum: Object.freeze(['US', 'CA']) }), page_flag: pageFlagRule, page_size: pageSizeRule },
    default_page_size: 10, row_limit: 20, field_names: ['code', 'rating', 'target_price', 'institution_uid', 'institution_name', 'recommendation_date'],
    text: ['code', 'institution_uid', 'institution_name'], integer: ['rating'], decimal_text: ['target_price'],
    date: ['recommendation_date'], pagination: true
  }),
  rest_research_analyst_info: freezeSpec({
    route: 'GET ' + root + 'research/analyst-info', rows_path: itemPath,
    params: { uids: uidListRule }, row_limit: 600,
    field_names: ['analyst_uid', 'analyst_name', 'stars', 'success_rate', 'excess_return'],
    text: ['analyst_uid', 'analyst_name'], decimal_text: ['stars', 'success_rate', 'excess_return']
  }),
  rest_research_institution_info: freezeSpec({
    route: 'GET ' + root + 'research/institution-info', rows_path: itemPath,
    params: { uids: uidListRule }, row_limit: 600,
    field_names: ['institution_uid', 'institution_name', 'picture_url'],
    text: ['institution_uid', 'institution_name', 'picture_url']
  }),
  rest_research_rating_change: freezeSpec({
    route: 'GET ' + root + 'research/rating-change', rows_path: itemPath,
    params: { market: Object.freeze({ enum: Object.freeze(['US', 'CA']) }),
      change_type: Object.freeze({ enum: Object.freeze(['UPGRADE', 'DOWNGRADE', 'NEW_RATING']) }),
      page_flag: pageFlagRule, page_size: pageSizeRule },
    default_page_size: 10, row_limit: 20,
    field_names: ['code', 'name', 'rating', 'last_rating', 'target_price', 'last_target_price', 'change_type',
      'institution_name', 'institution_uid', 'recommendation_date', 'last_recommendation_date'],
    text: ['code', 'name', 'change_type', 'institution_name', 'institution_uid'],
    integer: ['rating', 'last_rating'], decimal_text: ['target_price', 'last_target_price'],
    date: ['recommendation_date', 'last_recommendation_date'], pagination: true, total_required: true
  }),
  rest_research_rating_plot: freezeSpec({
    route: 'GET ' + root + '{code}/research/rating-plot', symbol_path: true, rows_path: itemPath,
    params: { uid: uidRule, dimension: Object.freeze({ enum: Object.freeze(['INSTITUTION', 'ANALYST']) }), count: Object.freeze({ integer: Object.freeze([1, 500]) }) },
    default_page_size: 50, row_limit: 500, field_names: ['timestamp', 'close_price'],
    integer: ['timestamp'], decimal_text: ['close_price']
  }),
  rest_research_stock_ratings: freezeSpec({
    route: 'GET ' + root + '{code}/research/stock-ratings', symbol_path: true, rows_path: itemPath,
    params: { page_flag: pageFlagRule, page_size: pageSizeRule }, default_page_size: 10, row_limit: 20,
    field_names: ['analyst_uid', 'analyst_name', 'stars', 'rating', 'target_price', 'recommendation_date'],
    text: ['analyst_uid', 'analyst_name'], decimal_text: ['stars', 'target_price'], integer: ['rating'],
    date: ['recommendation_date'], pagination: true
  }),
  rest_research_target_plot: freezeSpec({
    route: 'GET ' + root + '{code}/research/target-plot', symbol_path: true, rows_path: itemPath,
    params: { months: Object.freeze({ integer: Object.freeze([1, 24]) }) }, row_limit: 600,
    field_names: ['timestamp', 'close_price', 'target_price'], integer: ['timestamp'],
    decimal_text: ['close_price', 'target_price']
  }),
  rest_research_target_price: freezeSpec({
    route: 'GET ' + root + '{code}/research/target-price', symbol_path: true, single_row: true,
    rows_path: Object.freeze([]), params: { need_plot: Object.freeze({ enum: Object.freeze([true, false]) }) },
    row_limit: 1, field_names: ['highest', 'average', 'lowest', 'analyst_count', 'update_time'],
    decimal_text: ['highest', 'average', 'lowest'], integer: ['analyst_count', 'update_time']
  }),
  rest_research_top_analysts: freezeSpec({
    route: 'GET ' + root + 'research/top-analysts', rows_path: itemPath,
    params: { market: Object.freeze({ enum: Object.freeze(['US', 'CA']) }), page_flag: pageFlagRule, page_size: pageSizeRule },
    default_page_size: 10, row_limit: 20, field_names: ['analyst_uid', 'analyst_name', 'stars', 'success_rate', 'excess_return'],
    text: ['analyst_uid', 'analyst_name'], decimal_text: ['stars', 'success_rate', 'excess_return'], pagination: true, total_required: true
  })
});

export const researchRestRoutes = Object.freeze(Object.fromEntries(Object.entries(specs).map(([tool, spec]) => [tool, spec.route])));
const exactDecimalKeys = new Set(['target_price', 'last_target_price', 'stars', 'close_price', 'highest', 'average', 'lowest', 'success_rate', 'excess_return']);
function verifySymbol(value) {
  check(typeof value === 'string' && value.length <= 128 && symbolPattern.test(value)); return value;
}
function validateParams(tool, inputs) {
  const spec = specs[tool], keys = ['symbol', ...Object.keys(spec.params)];
  check(inputs && typeof inputs === 'object' && !Array.isArray(inputs) && Object.keys(inputs).every(key => keys.includes(key)));
  const symbol = spec.symbol_path ? verifySymbol(inputs.symbol) : null;
  if (!spec.symbol_path) check(!Object.hasOwn(inputs, 'symbol'));
  const query = new URLSearchParams();
  for (const [name, rule] of Object.entries(spec.params)) {
    if (!Object.hasOwn(inputs, name)) {
      check(!rule.required, 'INVALID_PARAMETER');
      continue;
    }
    const value = inputs[name];
    if (rule.enum) check(rule.enum.includes(value), 'INVALID_PARAMETER');
    else if (rule.integer) integer(value, rule.integer[0], rule.integer[1]);
    else if (rule.length) {
      check(typeof value === 'string' && [...value].length >= rule.length[0] &&
        [...value].length <= rule.length[1] && !/[\u0000-\u001f\u007f]/u.test(value) && value.isWellFormed(), 'INVALID_PARAMETER');
      if (rule.comma_separated) check(value.split(',').every(part => part.trim().length > 0), 'INVALID_PARAMETER');
    }
    else check(false, 'INVALID_PARAMETER');
    query.set(name, value);
  }
  const path = spec.route.slice(spec.route.indexOf(' ') + 1)
    .replace('{code}', encodeURIComponent(symbol ?? ''));
  return { method: 'GET', path: query.size ? path + '?' + query : path };
}
export function buildMoomooResearchRequest(tool, inputs) {
  check(typeof tool === 'string' && Object.hasOwn(specs, tool), 'UNSUPPORTED');
  return validateParams(tool, inputs);
}
export function describeMoomooResearch(tool) {
  check(typeof tool === 'string' && Object.hasOwn(specs, tool), 'UNSUPPORTED');
  const spec = specs[tool];
  const { integer: integers, row_limit, total_required, field_names, symbol_path, ...shape } = spec;
  const rowInput = Object.hasOwn(spec.params, 'page_size') ? 'page_size'
    : Object.hasOwn(spec.params, 'count') ? 'count' : undefined;
  return structuredClone({ tool, ...shape, ...(symbol_path && { symbol_path: true }),
    ...(integers.length && { integers }),
    ...(rowInput && { row_limit: { input: rowInput, fallback: spec.default_page_size ?? row_limit } }),
    ...(!rowInput && row_limit && { series_limit: row_limit }),
    ...(total_required && { optional_total: false }) });
}
function object(value) { check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PAGE'); return value; }
function text(value) { return string(value); }
function whole(value) {
  if (value instanceof WireNumber) value = Number(value.source);
  return integer(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE');
}
function exact(value) { return decimal(value); }
function fieldValue(name, value, spec) {
  if (value === null || value === undefined) check(false, 'INVALID_PAGE');
  if (spec.integer.includes(name)) return whole(value);
  if (spec.decimal_text.includes(name)) return exact(value);
  if (spec.date.includes(name)) return marketDate(value);
  return text(value);
}
function pageInfo(response, inputs, spec) {
  const page = object(response.pagination);
  check(typeof page.completed === 'boolean' && typeof page.page_flag === 'string' &&
    page.page_flag.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(page.page_flag) && page.page_flag.isWellFormed(), 'INVALID_PAGE');
  check(page.completed ? page.page_flag === '' : page.page_flag.length > 0 && page.page_flag !== (inputs.page_flag ?? ''), 'INVALID_PAGE');
  const total = page.total;
  if (spec.total_required) check(Number.isSafeInteger(total) && total >= 0, 'INVALID_PAGE');
  else if (total !== undefined) check(Number.isSafeInteger(total) && total >= 0, 'INVALID_PAGE');
  return { completed: page.completed, next_page_token: page.completed ? null : page.page_flag,
    ...(total !== undefined && { total }) };
}
function researchRow(source, inputs, spec) {
  object(source);
  const row = {};
  if (spec.symbol_path) row.symbol = verifySymbol(inputs.symbol);
  for (const name of spec.field_names) row[name] = fieldValue(name, source[name], spec);
  if (row.code !== undefined) verifySymbol(row.code);
  return row;
}
function rowsAt(response, path) {
  let value = response.data;
  for (const key of path) value = object(value)[key];
  return value;
}
export function projectMoomooResearchResponse(tool, inputs, wire) {
  check(typeof tool === 'string' && Object.hasOwn(specs, tool), 'UNSUPPORTED');
  validateParams(tool, inputs);
  const spec = specs[tool], response = readWire(wire, exactDecimalKeys);
  check(Number.isSafeInteger(response?.ret_code), 'INVALID_PAGE');
  if (response.ret_code !== 0) {
    const codes = { [-3]: 'INVALID_PARAMETER', [-8]: 'UNSUPPORTED', [-10]: 'NO_DATA' };
    check(false, codes[response.ret_code] ?? 'PROVIDER_ERROR');
  }
  const value = rowsAt(response, spec.rows_path);
  const rawRows = spec.single_row ? [value] : value;
  check(Array.isArray(rawRows) && rawRows.length <= (inputs.page_size ?? inputs.count ?? spec.row_limit), 'INVALID_PAGE');
  const rows = rawRows.map(row => researchRow(row, inputs, spec));
  const pagination = spec.pagination ? pageInfo(response, inputs, spec) : undefined;
  return { rows, ...(pagination && { pagination }) };
}

