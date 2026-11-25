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
    completed, next_page_flag: next };
}

const workingStatuses = new Set(['WAITING_SUBMIT', 'SUBMITTING', 'SUBMITTED', 'FILLED_PART']);
const terminalStatuses = new Set(['FILLED_ALL', 'CANCELLED_PART', 'CANCELLED_ALL', 'FAILED', 'DISABLED', 'DELETED']);

function openOrdersPage(inputs, wire, seenOrders) {
  buildMoomooOpenOrdersRequest(inputs);
  const { list, completed, next } = readPage(inputs, wire, 'orders');
  const rows = list.map(raw => {
    const order = projectMoomooSecuritiesOrder(raw);
    check(!seenOrders.has(order.order_id), 'DUPLICATE_ORDER');
    seenOrders.add(order.order_id);
    return order;
  });
  return { rows, account_binding: 'request-path', market: inputs.trd_market, completed, next_page_flag: next };
}

export function projectMoomooOpenOrdersResponse(inputs, wire) {
  return openOrdersPage(inputs, wire, new Set());
}

function savedOpenOrdersQuery(request, path, scope) {
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
    // A zero-size request cannot establish the presence or absence of working orders.
    integer(inputs.page_size, 1, 100, 'INVALID_PAGE_SIZE');
  }
  return inputs;
}

/** Read a complete chain of saved {request: {method, path}, wire} exchanges.
 * Page completion covers the REST listing only. No stream checkpoint is inferred.
 */
export function replayMoomooOpenOrdersBaseline(scope, exchanges) {
  only(scope, ['acc_id', 'trd_market']);
  accountQuery(scope);
  check(Array.isArray(exchanges) && exchanges.length > 0, 'INCOMPLETE_BASELINE');
  const path = openOrdersPath.replace('{acc_id}', scope.acc_id);
  const seenFlags = new Set(), seenOrders = new Set(), working = [], terminal = [];
  let expectedFlag = '';
  for (const exchange of exchanges) {
    check(expectedFlag !== null, 'EXTRA_PAGE');
    const inputs = savedOpenOrdersQuery(exchange?.request, path, scope);
    const flag = inputs.page_flag ?? '';
    check(flag === expectedFlag && !seenFlags.has(flag), 'INVALID_CONTINUATION');
    seenFlags.add(flag);
    const page = openOrdersPage(inputs, exchange.wire, seenOrders);
    for (const order of page.rows) {
      if (workingStatuses.has(order.status)) working.push(order);
      else {
        check(terminalStatuses.has(order.status), 'UNKNOWN_ORDER_STATUS');
        terminal.push(order);
      }
    }
    expectedFlag = page.next_page_flag;
  }
  check(expectedFlag === null, 'INCOMPLETE_BASELINE');
  return { account_binding: 'request-path', market: scope.trd_market, page_count: exchanges.length,
    working_orders: working, terminal_orders: terminal };
}
