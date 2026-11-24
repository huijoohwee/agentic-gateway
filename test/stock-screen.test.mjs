import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMoomooStockScreen as build, projectMoomooStockScreen as project } from 'agentic-gateway/connectors/moomoo-stock-screen';

const inputs = { market: 'HK', limit: 2, factors: ['last_price', 'pe_ttm', 'dividend_yield_pct'],
  filters: [{ factor: 'pe_ttm', upper: { value: '15.25', includes: true } }],
  sorts: [{ factor: 'last_price', direction: 'absolute_descending' }] };
const row = { code: 'HK.00700', name: 'Example', results: [
  { simple_property_result: { property: { name: 2201 }, res: { result_type: 2, ival: '9007199254740993' } } },
  { result_type: 2, res: { ival: -12345 } }, { result_type: 2, res: { ival: '0' } }] };
const page = { ret_code: 0, data: { items: [row] }, pagination: { total: 12, has_more: true, next_key: '003' } };

test('stock screen builds only reviewed market filters and scales bounds as decimal integers', () => {
  assert.deepEqual(build(inputs), { screen_queries: [{ simple_field_query: { simple_field: 1, screen_value_list: [1] } },
    { simple_property_query: { property: { name: 2303 }, upper: { value: 1525000, includes: true } } }],
    retrieve_queries: [2201, 2303, 2305].map(name => ({ simple_property: { name } })),
    sorts: [{ direction: 4, simple_property: { name: 2201 } }], limit: 2 });
  assert.equal(build({ ...inputs, next_key: '0003' }).next_key, '0003');
  for (const bad of [{ market: 'KR' }, { market: 'toString' }, { limit: 301 }, { limit: null }, { factors: ['pe_ttm','pe_ttm'] },
    { next_key: '-1' }, { next_key: 'abc' }, { watchlist_stock_ids: [1] }, { factors: ['constructor'] }]) {
    assert.throws(() => build({ ...inputs, ...bad }), /INVALID_PARAMETER/);
  }
  for (const value of ['0.000001', '1e5', '9999999999999999999', 0.1]) {
    assert.throws(() => build({ ...inputs, filters: [{ factor: 'pe_ttm', lower: { value, includes: false } }] }), /INVALID_PARAMETER/);
  }
});

test('stock-screen projection binds factor order, market and cursor and keeps 64-bit amounts exact', () => {
  assert.deepEqual(project(inputs, page), { rows: [{ symbol: 'HK.00700', name: 'Example', factors: [
    { factor: 'last_price', raw: '9007199254740993', value: '9007199254740.993' },
    { factor: 'pe_ttm', raw: '-12345', value: '-0.12345' }, { factor: 'dividend_yield_pct', raw: '0', value: '0.000' }] }],
    pagination: { total: 12, completed: false, next_cursor: '003' } });
  const empty = { rows: [], pagination: { total: 0, completed: true, next_cursor: null } };
  assert.deepEqual(project(inputs, { ret_code: -10 }), empty);
  assert.deepEqual(project(inputs, { ret_code: 0, data: { items: [] }, pagination: { has_more: false, next_key: '-1', total: 0 } }), empty);
  for (const bad of [{ ...row, code: 'US.00700' }, { ...row, results: [] }, { ...row, results: [...row.results].reverse() }]) {
    assert.throws(() => project(inputs, { ...page, data: { items: [bad] } }), /INVALID_PAGE/);
  }
  for (const ival of [9007199254740992, '9223372036854775808', '1.2']) {
    const bad = structuredClone(page); bad.data.items[0].results[0].simple_property_result.res.ival = ival;
    assert.throws(() => project(inputs, bad), /PRECISION_UNKNOWN/);
  }
  for (const next_key of ['003', '-1', '']) assert.throws(() => project({ ...inputs, next_key: '003' },
    { ...page, pagination: { ...page.pagination, next_key } }), /INVALID_PAGE/);
  assert.throws(() => project(inputs, { ...page, ret_code: -9 }), /SCOPE_DENIED/);
});
