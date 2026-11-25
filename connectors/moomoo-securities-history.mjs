import { check, integer, only } from './moomoo-rest-wire.mjs';
import { readMoomooSecuritiesWire, projectMoomooSecuritiesOrder, projectMoomooSecuritiesFill } from './moomoo-trade-event.mjs';

const accountRoot = '/api/v1.0/accounts/{acc_id}/';
const openOrdersPath = accountRoot + 'orders';
export const securitiesHistoryRoutes = Object.freeze({
  account_orders_history: 'GET ' + accountRoot + 'orders_history',
  account_fills_history: 'GET ' + accountRoot + 'fills_history',
});
const markets = new Set(['HK', 'US', 'HKCC', 'SG', 'CA', 'FUTURES', 'JP', 'KR', 'MY', 'AU', 'FOREX', 'PREDICTION']);
const ninetyDaysUs = 90n * 86400n * 1000000n;
function uint64(value) {
  const digits = Number.isSafeInteger(value) ? String(value) : value;
  check(typeof digits === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(digits) && BigInt(digits) <= 18446744073709551615n);
  return digits;
}
const isText = value => typeof value === 'string' && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);

function accountQuery(inputs) {
  check(Object.hasOwn(inputs, 'acc_id') && typeof inputs.acc_id === 'string' && uint64(inputs.acc_id) !== '0');
  check(Object.hasOwn(inputs, 'trd_market') && markets.has(inputs.trd_market));
  return new URLSearchParams({ trd_market: inputs.trd_market });
}

function pageRequest(path, inputs, query, min, max) {
  if (Object.hasOwn(inputs, 'page_flag')) {
    check(isText(inputs.page_flag)); query.set('page_flag', inputs.page_flag);
  }
  if (Object.hasOwn(inputs, 'page_size')) query.set('page_size', integer(inputs.page_size, min, max));
  return { method: 'GET', path: path.replace('{acc_id}', inputs.acc_id) + '?' + query };
}

export function buildMoomooOpenOrdersRequest(inputs) {
  only(inputs, ['acc_id', 'trd_market', 'page_flag', 'page_size']);
  return pageRequest(openOrdersPath, inputs, accountQuery(inputs), 0, 100);
}

export function buildMoomooSecuritiesHistoryRequest(tool, inputs) {
  check(typeof tool === 'string' && Object.hasOwn(securitiesHistoryRoutes, tool), 'UNSUPPORTED');
  only(inputs, ['acc_id', 'trd_market', 'code', 'start', 'end', 'page_flag', 'page_size']);
  const query = accountQuery(inputs);
  const orders = tool === 'account_orders_history';
  check(orders || inputs.trd_market !== 'FOREX', 'UNSUPPORTED_MARKET');
  if (Object.hasOwn(inputs, 'code')) {
    check(isText(inputs.code) && inputs.code.trim().length > 0); query.set('code', inputs.code);
  }
  for (const key of ['start', 'end']) if (Object.hasOwn(inputs, key)) query.set(key, uint64(inputs[key]));
  const start = BigInt(query.get('start') ?? 0), end = BigInt(query.get('end') ?? 0);
  check(!start || !end || end > start);
  const [, path] = securitiesHistoryRoutes[tool].split(' ');
  return pageRequest(path, inputs, query, orders ? 10 : 1, orders ? 100 : 50);
}

function checkScope(row, inputs) {
  check(row && typeof row === 'object' && !Array.isArray(row), 'INVALID_PAGE');
  for (const key of ['acc_id', 'account_id']) {
    if (Object.hasOwn(row, key)) check(row[key] === inputs.acc_id, 'ACCOUNT_MISMATCH');
  }
  if (Object.hasOwn(row, 'trd_market')) check(row.trd_market === inputs.trd_market, 'MARKET_MISMATCH');
}
function historyFill(row) {
  if (row.update_time != null && row.updated_time != null) check(row.update_time === row.updated_time, 'CONFLICTING_FILL_TIME');
  const fill = projectMoomooSecuritiesFill({ ...row, side: row.trd_side, updated_time: row.updated_time ?? row.update_time });
  check(isText(row.order_id) && row.order_id.length > 0, 'INVALID_PAGE');
  fill.order_id = row.order_id;
  for (const key of ['stock_name', 'counter_broker_id', 'counter_broker_name']) {
    if (row[key] != null) { check(isText(row[key]), 'INVALID_PAGE'); fill[key] = row[key]; }
  }
  return fill;
}

// Ordinary pages inherit account context from the original request.
function readPage(inputs, wire, listKey) {
  const response = readMoomooSecuritiesWire(wire);
  if (response?.s === 'error') {
    const error = new Error('PROVIDER_ERROR');
    if (Number.isSafeInteger(response.errcode)) error.providerCode = response.errcode;
    throw error;
  }
  check(response?.s === 'ok', 'INVALID_PAGE');
  checkScope(response, inputs);
  const data = response.d;
  checkScope(data, inputs);
  const list = data[listKey];
  check(Array.isArray(list) && list.length <= (inputs.page_size ?? 50) && typeof data.completed === 'boolean', 'INVALID_PAGE');
  check(data.page_flag == null || isText(data.page_flag), 'INVALID_PAGE');
  const next = data.completed ? null : data.page_flag;
  check(data.completed || (typeof next === 'string' && next.length > 0 && next !== inputs.page_flag), 'INVALID_CONTINUATION');
  for (const row of list) checkScope(row, inputs);
  return { list, completed: data.completed, next };
}

export function projectMoomooSecuritiesHistoryResponse(tool, inputs, wire) {
  buildMoomooSecuritiesHistoryRequest(tool, inputs);
  const orders = tool === 'account_orders_history';
  const { list, completed, next } = readPage(inputs, wire, orders ? 'orders' : 'order_fills');
  const start = BigInt(inputs.start ?? 0), end = BigInt(inputs.end ?? 0);
  const lower = start || (end > ninetyDaysUs ? end - ninetyDaysUs : 0n);
  const upper = end || (start ? start + ninetyDaysUs : null);
  const seen = new Set();
  const rows = list.map(row => {
    const item = orders ? projectMoomooSecuritiesOrder(row) : historyFill(row);
    if (inputs.code !== undefined) check(item.symbol === inputs.code, 'SYMBOL_MISMATCH');
    const time = BigInt(orders ? item.created_us : item.updated_us);
    check(time >= lower && (upper === null || time <= upper), 'OUTSIDE_HISTORY_WINDOW');
    const id = orders ? item.order_id : item.fill_id;
    check(!seen.has(id), 'DUPLICATE_HISTORY_ROW'); seen.add(id);
    return item;
  });
  return { rows, account_binding: 'request-path', market: inputs.trd_market, symbol: inputs.code ?? null,
    time_basis: orders ? 'created_us' : 'updated_us', start_us: start.toString(), end_us: end.toString(),
    window_start_us: upper === null ? null : lower.toString(), window_end_us: upper?.toString() ?? null,
    completed, next_page_flag: next };
}

const workingStatuses = new Set(['WAITING_SUBMIT', 'SUBMITTING', 'SUBMITTED', 'FILLED_PART']);
const terminalStatuses = new Set(['FILLED_ALL', 'CANCELLED_PART', 'CANCELLED_ALL', 'FAILED', 'DISABLED', 'DELETED']);

export function projectMoomooOpenOrdersResponse(inputs, wire) {
  buildMoomooOpenOrdersRequest(inputs);
  const { list, completed, next } = readPage(inputs, wire, 'orders');
  const seenOrders = new Set();
  const rows = list.map(raw => {
    const order = projectMoomooSecuritiesOrder(raw);
    check(!seenOrders.has(order.order_id), 'DUPLICATE_ORDER');
    seenOrders.add(order.order_id);
    return order;
  });
  return { rows, account_binding: 'request-path', market: inputs.trd_market, completed, next_page_flag: next };
}

function savedSecuritiesQuery(request, path, scope) {
  check(request?.method === 'GET' && typeof request.path === 'string' && !request.path.includes('#'), 'REQUEST_MISMATCH');
  const offset = request.path.indexOf('?');
  check(offset > 0 && request.path.slice(0, offset) === path, 'REQUEST_MISMATCH');
  const query = new URLSearchParams(request.path.slice(offset + 1));
  check(new Set(query.keys()).size === query.size && query.get('trd_market') === scope.trd_market, 'REQUEST_MISMATCH');
  check(!query.has('acc_id'), 'REQUEST_MISMATCH');
  const inputs = { acc_id: scope.acc_id, ...Object.fromEntries(query) };
  if (query.has('page_size')) {
    check(/^\d+$/.test(inputs.page_size), 'INVALID_PAGE_SIZE');
    inputs.page_size = Number(inputs.page_size);
    integer(inputs.page_size, 1, 100, 'INVALID_PAGE_SIZE');
  }
  return inputs;
}

function savedSecuritiesPages(tool, scope) {
  only(scope, ['acc_id', 'trd_market']);
  accountQuery(scope);
  scope = { ...scope };
  const openOrders = tool === 'account_orders';
  const path = (openOrders ? openOrdersPath : securitiesHistoryRoutes[tool].slice(4)).replace('{acc_id}', scope.acc_id);
  const seenFlags = new Set(), seenRows = new Set();
  const idKey = tool === 'account_fills_history' ? 'fill_id' : 'order_id';
  let expectedFlag, selectors, startedAtContinuation;
  return exchange => {
    check(expectedFlag !== null, 'EXTRA_PAGE');
    const inputs = savedSecuritiesQuery(exchange?.request, path, scope);
    const flag = inputs.page_flag ?? '';
    if (expectedFlag !== undefined || openOrders) check(flag === (expectedFlag ?? ''), 'INVALID_CONTINUATION');
    const page = openOrders ? projectMoomooOpenOrdersResponse(inputs, exchange.wire)
      : projectMoomooSecuritiesHistoryResponse(tool, inputs, exchange.wire);
    const selection = JSON.stringify([page.symbol, page.start_us, page.end_us]);
    check(selectors === undefined || selectors === selection, 'HISTORY_SELECTION_CHANGED');
    check(!seenFlags.has(page.next_page_flag), 'INVALID_CONTINUATION');
    for (const row of page.rows) {
      check(!seenRows.has(row[idKey]), openOrders ? 'DUPLICATE_ORDER' : 'DUPLICATE_HISTORY_ROW');
      if (openOrders) check(workingStatuses.has(row.status) || terminalStatuses.has(row.status), 'UNKNOWN_ORDER_STATUS');
    }
    // Advance only after validating the entire exchange, so a rejected page can be retried.
    for (const row of page.rows) seenRows.add(row[idKey]);
    startedAtContinuation ??= flag !== '';
    selectors = selection; expectedFlag = page.next_page_flag; seenFlags.add(flag);
    return { ...page, page_count: seenFlags.size, started_at_continuation: startedAtContinuation };
  };
}

/** Inspect the selected page even when earlier history pages were not saved. */
export function createMoomooSecuritiesHistoryPages(tool, scope) {
  check(Object.hasOwn(securitiesHistoryRoutes, tool), 'UNSUPPORTED');
  return Object.freeze({ append: savedSecuritiesPages(tool, scope) });
}

/** Only a complete listing from the beginning can establish the working-order baseline. */
export function createMoomooOpenOrdersBaseline(scope) {
  const read = savedSecuritiesPages('account_orders', scope), working = [], terminal = [];
  const market = scope.trd_market;
  let completed = false, pageCount = 0;
  function append(exchange) {
    const page = read(exchange);
    for (const order of page.rows) (workingStatuses.has(order.status) ? working : terminal).push(order);
    completed = page.completed; pageCount = page.page_count;
    return { page_count: pageCount, completed, next_page_flag: page.next_page_flag };
  }
  function result() {
    check(completed, 'INCOMPLETE_BASELINE');
    return { account_binding: 'request-path', market, page_count: pageCount,
      working_orders: [...working], terminal_orders: [...terminal] };
  }
  return Object.freeze({ append, result });
}

export function replayMoomooOpenOrdersBaseline(scope, exchanges) {
  check(Array.isArray(exchanges), 'INCOMPLETE_BASELINE');
  const baseline = createMoomooOpenOrdersBaseline(scope);
  for (const exchange of exchanges) baseline.append(exchange);
  return baseline.result();
}
