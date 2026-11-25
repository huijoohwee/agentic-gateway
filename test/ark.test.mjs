import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from 'agentic-gateway/connectors/moomoo-catalog.json' with { type: 'json' };
import { arkRestRoutes, buildMoomooArkRequest as build, describeMoomooArk as describe,
  projectMoomooArkResponse as project } from 'agentic-gateway/connectors/moomoo-market-rest';

const wire = data => JSON.stringify({ ret_code: 0, data });
const page = (items, pagination = { completed: true, page_flag: '' }) =>
  JSON.stringify({ ret_code: 0, data: { items }, pagination });

test('ARK reader routes and display descriptors match the local source catalog', () => {
  assert.equal(Object.keys(arkRestRoutes).length, 9);
  const documented = new Set(catalog.sources.flatMap(source => source.routes ?? []));
  for (const [tool, route] of Object.entries(arkRestRoutes)) {
    assert.ok(documented.has(route), route);
    assert.equal(describe(tool).route, route);
    assert.ok(Object.keys(describe(tool).fields).length > 0);
  }
  assert.deepEqual(describe('rest_ark_fund_holding').row_limit, { input: 'page_size', fallback: 20 });
  assert.deepEqual(describe('rest_ark_stock_detail_daily').pagination, ['pagination']);
  assert.ok(describe('rest_ark_fund_return_rate').summary_fields.includes('market_value'));
  assert.ok(describe('rest_ark_net_turnover_rank').groups.some(group => group.direction === 'DECREASED'));
});

test('ARK requests preserve documented bounds, enums, booleans, path codes, and query encoding', () => {
  assert.deepEqual(build('rest_ark_active_transaction', { holding_type: 'NEW', page_size: 200, code: 'US.A&B' }),
    { method: 'GET', path: '/api/v1.0/quote/ark-active-transaction?holding_type=NEW&page_size=200&code=US.A%26B' });
  assert.equal(build('rest_ark_stock_detail_table', { symbol: 'US.AAPL', fund: '', page_size: 60 }).path,
    '/api/v1.0/quote/US.AAPL/ark-stock-detail-table?fund=&page_size=60');
  assert.deepEqual(build('rest_ark_stock_dynamic', { symbol: 'US.AAPL' }),
    { method: 'GET', path: '/api/v1.0/quote/US.AAPL/ark-stock-dynamic' });
  assert.deepEqual(build('rest_ark_active_transaction_query', { kline_based: false }),
    { method: 'GET', path: '/api/v1.0/quote/ark-active-transaction-query?kline_based=false' });
  for (const [tool, inputs] of [
    ['rest_ark_active_transaction', { page_size: 201 }],
    ['rest_ark_active_transaction_query', { kline_based: 0 }],
    ['rest_ark_fund_holding', { holding_type: 'UNKNOWN' }],
    ['rest_ark_stock_detail_daily', { symbol: '../US.AAPL' }],
    ['rest_ark_stock_detail_table', { symbol: 'US.AAPL', page_flag: 'x'.repeat(21) }],
    ['rest_ark_fund_return_rate', { account: 'private' }],
    ['rest_ark_fund_holding_industry', { fund: 'x'.repeat(33) }],
  ]) assert.throws(() => build(tool, inputs), /INVALID_PARAMETER/);
  assert.throws(() => build('rest_ark_not_documented', {}), /UNSUPPORTED/);
});

test('ARK active-transaction rows and metadata preserve exact amounts and US-local dates', () => {
  const response = project('rest_ark_active_transaction', { page_size: 1 },
    '{"ret_code":0,"data":{"items":[{"code":"AAPL","name":"Example","holding_type":"INCREASE","change_amount":1234567890.1234567890123,"change_shares":"9007199254740993"}],"update_time":1710000000000000,"update_date":"2026-10-16","max_abs_value_change":"1234567890.1234567890123"},"pagination":{"completed":true,"page_flag":""}}');
  assert.equal(response.rows[0].code, 'AAPL');
  assert.equal(response.rows[0].change_amount, '1234567890.1234567890123');
  assert.equal(response.rows[0].change_shares, '9007199254740993');
  assert.deepEqual(response.metadata, { update_time: 1710000000000000, update_date: '2026-10-16', max_abs_value_change: '1234567890.1234567890123' });
  assert.deepEqual(response.pagination, { completed: true, next_page_token: null });
  assert.throws(() => project('rest_ark_active_transaction', { page_size: 1 },
    page([{ code: 'AAPL', name: 'Example', holding_type: 'INCREASE', change_amount: '1', change_shares: '1' },
      { code: 'MSFT', name: 'Example', holding_type: 'INCREASE', change_amount: '1', change_shares: '1' }])), /INVALID_PAGE/);
});

test('ARK query and holding projections retain documented fields and require progressing cursors', () => {
  const queried = project('rest_ark_active_transaction_query', { page_flag: 'cursor/1' },
    JSON.stringify({ ret_code: 0, data: { items: [{ code: 'US.AAPL', name: 'Example', holding_type: 'NEW', date: '2026-10-16',
      change_amount: '12.50', change_shares: '3', price_close: 12.5 }], update_time: 1710000000000000, update_date: '2026-10-16' },
      pagination: { completed: false, page_flag: 'next/2' } }));
  assert.equal(queried.rows[0].price_close, '12.5');
  assert.deepEqual(queried.pagination, { completed: false, next_page_token: 'next/2' });
  const holdings = project('rest_ark_fund_holding', { page_size: 1 },
    page([{ code: 'US.AAPL', name: 'Example', shares: '9007199254740993', shares_change: '1.25', market_value: '123.00',
      weight: 12.34, weight_change: -0.01 }], { completed: false, page_flag: 'cursor-2' }));
  assert.equal(holdings.rows[0].shares, '9007199254740993');
  assert.equal(holdings.rows[0].weight_change, '-0.01');
  assert.equal(holdings.pagination.next_page_token, 'cursor-2');
  assert.throws(() => project('rest_ark_fund_holding', { page_flag: 'same' },
    page([], { completed: false, page_flag: 'same' })), /INVALID_PAGE/);
});

test('ARK industry, return-rate summary, and ranked groups retain all response data', () => {
  const industry = project('rest_ark_fund_holding_industry', { fund: 'US.ARKK' },
    wire({ items: [{ industry_id: 0, name: 'Software', weight: 12.34 }], update_time: 1710000000000000, update_date: '2026-10-16' }));
  assert.deepEqual(industry.rows, [{ industry_id: 0, name: 'Software', weight: '12.34' }]);
  assert.deepEqual(industry.metadata, { update_time: 1710000000000000, update_date: '2026-10-16' });

  const returns = project('rest_ark_fund_return_rate', { compare_code: 'US.QQQ' },
    '{"ret_code":0,"data":{"items":[{"date":"2026-10-16","return_rate":1.20000000000001,"compare_increase":-0.25}],"total_return_rate":1.2,"market_value":"123.4500","stock_count":10,"market_value_change":"-1.25","stock_count_change":-1,"update_time":1710000000000000,"update_date":"2026-10-16"}}');
  assert.equal(returns.rows[0].return_rate, '1.20000000000001');
  assert.deepEqual(returns.summary, { total_return_rate: '1.2', market_value: '123.4500', stock_count: 10,
    market_value_change: '-1.25', stock_count_change: -1, update_time: 1710000000000000, update_date: '2026-10-16' });

  const rank = project('rest_ark_net_turnover_rank', {},
    wire({ update_time: 1710000000000000, update_date: '2026-10-16',
      increased: [{ code: 'US.AAPL', name: 'Example', net_turnover: '100.00' }],
      decreased: [{ code: 'US.MSFT', name: 'Example', net_turnover: 25.5 }] }));
  assert.deepEqual(rank.rows, [
    { direction: 'INCREASED', code: 'US.AAPL', name: 'Example', net_turnover: '100.00' },
    { direction: 'DECREASED', code: 'US.MSFT', name: 'Example', net_turnover: '25.5' },
  ]);
  assert.deepEqual(rank.metadata, { update_time: 1710000000000000, update_date: '2026-10-16' });
});

test('ARK stock history and dynamic views validate the requested symbol and retain exact values', () => {
  const history = { date: '2026-10-16', shares: '9007199254740993', weight: 1.2, shares_change: '-2',
    value_change: 123.456789, price_close: '10.5000', market_value: '1000000000000.01' };
  const daily = project('rest_ark_stock_detail_daily', { symbol: 'US.AAPL', page_size: 1 },
    JSON.stringify({ ret_code: 0, data: { items: [history], update_time: 1710000000000000, update_date: '2026-10-16' },
      pagination: { completed: true, page_flag: '' } }));
  assert.deepEqual(daily.rows[0], { symbol: 'US.AAPL', ...history, weight: '1.2', value_change: '123.456789', price_close: '10.5000' });
  assert.equal(daily.metadata.update_date, '2026-10-16');
  const table = project('rest_ark_stock_detail_table', { symbol: 'US.AAPL' },
    JSON.stringify({ ret_code: 0, data: { items: [history], update_time: 1710000000000000, update_date: '2026-10-16' },
      pagination: { completed: true, page_flag: '' } }));
  assert.equal(table.rows[0].market_value, '1000000000000.01');
  const sparse = project('rest_ark_stock_detail_daily', { symbol: 'US.AAPL' },
    JSON.stringify({ ret_code: 0, data: { items: [{ date: '2026-10-15', price_close: '10.25' }],
      update_time: 1710000000000000, update_date: '2026-10-16' }, pagination: { completed: true, page_flag: '' } }));
  assert.deepEqual(sparse.rows, [{ symbol: 'US.AAPL', date: '2026-10-15', price_close: '10.25' }]);
  assert.ok(describe('rest_ark_stock_detail_daily').optional_fields.includes('shares'));
  assert.throws(() => project('rest_ark_stock_detail_daily', { symbol: 'US.AAPL' },
    JSON.stringify({ ret_code: 0, data: { items: [{ date: '2026-10-15' }],
      update_time: 1710000000000000, update_date: '2026-10-16' }, pagination: { completed: true, page_flag: '' } })), /INVALID_PAGE/);
  const dynamic = project('rest_ark_stock_dynamic', { symbol: 'US.AAPL' },
    wire({ dynamic_type: '0', transaction_count: 0, net_shares: '9007199254740993', last_transaction_date: '2026-10-16', avatar_url: 'https://example.invalid/a.png' }));
  assert.deepEqual(dynamic.rows, [{ symbol: 'US.AAPL', dynamic_type: '0', transaction_count: 0,
    net_shares: '9007199254740993', last_transaction_date: '2026-10-16', avatar_url: 'https://example.invalid/a.png' }]);
  assert.throws(() => project('rest_ark_stock_dynamic', { symbol: 'US.AAPL' },
    wire({ dynamic_type: '0', transaction_count: 0, net_shares: '1', last_transaction_date: '2026-02-30', avatar_url: '' })), /INVALID_PAGE/);
});

test('ARK source errors and malformed or oversized wire data fail closed', () => {
  for (const [code, error] of [[-3, 'INVALID_PARAMETER'], [-8, 'UNSUPPORTED'], [-10, 'NO_DATA'], [-99, 'PROVIDER_ERROR']])
    assert.throws(() => project('rest_ark_stock_dynamic', { symbol: 'US.AAPL' }, JSON.stringify({ ret_code: code })), new RegExp(error));
  for (const invalid of ['{', '{}', ' '.repeat(480001)])
    assert.throws(() => project('rest_ark_fund_holding', {}, invalid));
  assert.throws(() => project('rest_ark_fund_holding_industry', {}, wire({ items: [{ industry_id: 0, name: 'x', weight: null }], update_time: 1, update_date: '2026-10-16' })), /INVALID_PAGE/);
});
