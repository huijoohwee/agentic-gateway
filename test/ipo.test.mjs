import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMoomooMarketRequest as request, projectMoomooMarketResponse as project, describeMoomooIpo } from 'agentic-gateway/connectors/moomoo-market-rest';

const markets = [
  ['quote_ipo_list_cn', 'SH.601077', [1, 2, 3, 4, 5], 4],
  ['quote_ipo_list_us', 'US.EXAMPLE', [9, 10, 11], 11],
  ['quote_ipo_list_my', 'BMS.MYIPO007', [9, 10, 11], 11],
  ['quote_ipo_list_sg', 'SG.1V2', [9, 10, 11], 11],
  ['rest_ipo_list_jp', 'JP.7203', [], null],
];
for (const [tool, code, types, defaultType] of markets) {
  test(tool + ' binds its own market, filter and public fields', () => {
    const description = describeMoomooIpo(tool);
    const path = '/api/v1.0/quote/ipo-list/' + tool.slice(-2);
    assert.deepEqual(request(tool, {}), { method: 'GET', path });
    assert.deepEqual(description.requestTypes, types);
    assert.equal(description.defaultRequestType, defaultType);
    for (const type of types) assert.equal(request(tool, { request_type: type }).path, path + '?request_type=' + type);
    for (const inputs of [{ request_type: 0 }, { request_type: '11' }, { broker_id: 1 }, { page_flag: 'p' }])
      assert.throws(() => request(tool, inputs), { code: 'INVALID_PARAMETER' });
    const amount = description.decimalFields[0];
    const wire = '{"ret_code":0,"data":[{"code":"' + code + '","name":"Example","' + amount + '":1.000000000000000021,' +
      '"list_timestamp":9007199254740993,"list_time":"","is_user_applied":true,"placing_user_has_permission":true,' +
      '"is_placing_user_applied":false,"placing_apply_limit":10,"user_leverage_rate":3.5,"user_leverage_multiple":2,"leverage_end_timestamp":1}]}';
    assert.deepEqual(project(tool, {}, wire).rows, [{ code, name: 'Example', [amount]: '1.000000000000000021',
      list_timestamp: '9007199254740993', list_time: '' }]);
    assert.throws(() => project(tool, {}, wire.replace(code, 'HK.00700')), { code: 'SECURITY_MISMATCH' });
    assert.deepEqual(project(tool, {}, '{"ret_code":0,"data":[]}'), { rows: [] });
  });
}

test('IPO pages preserve missing values and reject contradictions or invalid types', () => {
  const tool = 'quote_ipo_list_sg', row = { code: 'SG.1V2', name: 'Example', ipo_price_min: null, list_timestamp: 0 };
  const read = (rows, pagination) => project(tool, {}, JSON.stringify({ ret_code: 0, data: rows, pagination }));
  assert.deepEqual(read([row], { total: 1, completed: true, page_flag: '' }).rows,
    [{ code: row.code, name: row.name, ipo_price_min: null, list_timestamp: '0' }]);
  for (const page of [{ completed: false }, { page_flag: 'next' }, { has_more: true }, { total: 2 }])
    assert.throws(() => read([row], page), { code: 'INCOMPLETE_PAGE' });
  for (const data of [[row, row], [{ ...row, issue_size: 0.5 }], [{ ...row, is_subscribe_status: 'false' }], [{ ...row, ipo_price_min: '5' }]])
    assert.throws(() => read(data), { code: 'INVALID_PAGE' });
  for (const [ret_code, code] of [[-3, 'INVALID_PARAMETER'], [-8, 'UNSUPPORTED'], [-9, 'PERMISSION_DENIED'], [-10, 'NO_DATA'], [-11, 'RATE_LIMITED']])
    assert.throws(() => project(tool, {}, JSON.stringify({ ret_code })), { code });
});
