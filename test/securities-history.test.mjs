import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMoomooSecuritiesHistoryRequest as build, projectMoomooSecuritiesHistoryResponse as project,
  securitiesHistoryRoutes } from 'agentic-gateway/connectors/moomoo-securities-history';
import catalog from '../connectors/moomoo-catalog.json' with { type: 'json' };

const orders = 'account_orders_history', fills = 'account_fills_history';
const inputs = { acc_id: '18446744073709551615', trd_market: 'US', start: '9007199254740992', end: '9007199254740995', code: 'US.TEST' };
const created = JSON.rawJSON('9007199254740993'), updated = JSON.rawJSON('9007199254740994');
const order = { order_id: 'o-1', code: inputs.code, side: 'BUY', order_type: 'LIMIT', order_status: 'FILLED_ALL', currency: 'USD',
  qty: '1.000000000000000003', price: '2.50000', dealt_qty: '1.000000000000000003', dealt_avg_price: '2.50000',
  create_time: created, updated_time: updated, remark: 'private broker note' };
const fill = { order_id: 'o-1', deal_id: 'f-1', code: inputs.code, trd_side: 'BUY', status: 'CHANGED',
  qty: order.qty, price: order.price, create_time: 10, updated_time: updated, counter_broker_id: JSON.rawJSON('9007199254740997') };
const wire = (key, rows, changes = {}) => JSON.stringify({ s: 'ok', d: { [key]: rows, page_flag: '', completed: true, ...changes } });

test('builds the published account-scoped GETs with lossless selectors and opaque pagination', () => {
  for (const [tool, path] of Object.entries(securitiesHistoryRoutes)) assert.equal(catalog.tools.find(t => t.name === tool).http, path);
  const flag = '次 &+/=';
  const request = build(orders, { ...inputs, page_size: 100, page_flag: flag });
  assert.equal(request.method, 'GET');
  const [path, query] = request.path.split('?');
  assert.equal(path, '/api/v1.0/accounts/18446744073709551615/orders_history');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(query)), { trd_market: 'US', start: inputs.start,
    end: inputs.end, code: inputs.code, page_size: '100', page_flag: flag });
  assert.match(build(fills, { acc_id: '1', trd_market: 'HK' }).path, /fills_history\?trd_market=HK$/);
  for (const [tool, delta] of [[orders, { acc_id: 45 }], [orders, { acc_id: '18446744073709551616' }],
    [fills, { trd_market: 'FOREX' }], [orders, { trd_market: 'NONE' }], [orders, { start: 2 ** 53 }],
    [orders, { start: inputs.end }], [orders, { page_size: 9 }], [fills, { page_size: 51 }], [fills, { effect: 'place' }]]) {
    assert.throws(() => build(tool, { ...inputs, ...delta }));
  }
  assert.throws(() => build('account_cancel_order', inputs), /UNSUPPORTED/);
});

test('order and fill pages use their own time bases and keep private account provenance explicit', () => {
  const result = project(orders, inputs, wire('orders', [{ ...order, updated_time: JSON.rawJSON('18446744073709551615') }]));
  assert.equal(result.time_basis, 'created_us'); assert.equal(result.rows[0].created_us, '9007199254740993');
  assert.equal(result.rows[0].updated_us, '18446744073709551615'); assert.equal(result.rows[0].quantity, order.qty);
  assert.equal(result.rows[0].price, order.price); assert.equal(result.account_binding, 'request-path');
  assert.equal(result.next_page_flag, null); assert(!JSON.stringify(result).includes(order.remark));
  const page = project(fills, inputs, wire('order_fills', [fill], { completed: false, page_flag: 'next +/' }));
  assert.equal(page.time_basis, 'updated_us'); assert.equal(page.rows[0].created_us, '10');
  assert.equal(page.rows[0].updated_us, '9007199254740994'); assert.equal(page.rows[0].order_id, 'o-1');
  assert.equal(page.rows[0].counter_broker_id, '9007199254740997'); assert.equal(page.next_page_flag, 'next +/');
  const { updated_time, ...dictionary } = fill;
  assert.deepEqual(project(fills, inputs, wire('order_fills', [{ ...dictionary, update_time: updated_time }])).rows, page.rows);
  assert.deepEqual(project(fills, inputs, wire('order_fills', [])).rows, []);
  assert.throws(() => project(orders, inputs, wire('orders', [{ ...order, create_time: 10 }])), /OUTSIDE_HISTORY_WINDOW/);
  assert.throws(() => project(fills, inputs, wire('order_fills', [{ ...fill, updated_time: 11 }])), /OUTSIDE_HISTORY_WINDOW/);
});

test('rejects scope drift, conflicting timestamps, repeated rows, oversized pages and stalled cursors', () => {
  const run = (rows, flags = {}, delta = {}) => project(fills, { ...inputs, ...delta }, wire('order_fills', rows, flags));
  assert.throws(() => run([fill], { acc_id: JSON.rawJSON('18446744073709551614') }), /ACCOUNT_MISMATCH/);
  assert.throws(() => run([{ ...fill, account_id: '7' }]), /ACCOUNT_MISMATCH/);
  assert.throws(() => project(fills, inputs, JSON.stringify({ s: 'ok', account_id: '7', d: {
    order_fills: [], completed: true } })), /ACCOUNT_MISMATCH/);
  assert.throws(() => run([fill], { trd_market: 'HK' }), /MARKET_MISMATCH/);
  assert.throws(() => run([{ ...fill, code: 'US.OTHER' }]), /SYMBOL_MISMATCH/);
  assert.throws(() => run([{ ...fill, update_time: 10 }]), /CONFLICTING_FILL_TIME/);
  assert.throws(() => run([fill, fill]), /DUPLICATE_HISTORY_ROW/);
  assert.throws(() => run([fill, fill], {}, { page_size: 1 }), /INVALID_PAGE/);
  assert.throws(() => run([], { completed: false }), /INVALID_CONTINUATION/);
  assert.throws(() => run([], { completed: false, page_flag: 'same' }, { page_flag: 'same' }), /INVALID_CONTINUATION/);
  assert.throws(() => project(orders, inputs, '{"s":"error","errcode":234,"errmsg":"private text"}'),
    err => err.message === 'PROVIDER_ERROR' && err.providerCode === 234 && !JSON.stringify(err).includes('private text'));
});

test('applies the documented ninety-day default when just one endpoint is known', () => {
  const span = 90n * 86400n * 1000000n;
  const ending = { acc_id: '5', trd_market: 'US', end: String(span + 30n) };
  const starting = { acc_id: '5', trd_market: 'US', start: 20 };
  assert.throws(() => project(fills, ending, wire('order_fills', [{...fill, updated_time: 29}])), /OUTSIDE_HISTORY_WINDOW/);
  assert.throws(() => project(fills, starting, wire('order_fills', [{...fill, updated_time: String(span + 21n)}])), /OUTSIDE_HISTORY_WINDOW/);
  assert.equal(project(fills, ending, wire('order_fills', [{ ...fill, updated_time: 30 }])).rows.length, 1);
});
