import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../connectors/moomoo-catalog.json' with { type: 'json' };
import { cryptoReportTopics, replayMoomooCryptoReport as crypto, replayMoomooSecuritiesEvent as securities,
  securitiesTradeTopics } from 'agentic-gateway/connectors/moomoo-trade-event';

// Encoded independently with Python protobuf 6.33.6 and the published ReportMsg definitions.
// Source SHA-256 be1d4e55de21704076b8e42cbae8baaca9a0c56c360f358f42a0e18eafcc1b49.
const reports = {
  placed: 'CgNldnQiPwoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAGoBMHIBMDABOgcIABoDb3Jk',
  placeFailed: 'CgNldnQiPwoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAWoBMHIBMDABOiAI9///////////ARIOcHJpdmF0ZSByZW1hcmsaA29yZA==',
  cancelled: 'CgNldnQiPwoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAWoBMHIBMDADSgcIABoDb3Jk',
  cancelFailed: 'CgNldnQiPwoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAGoBMHIBMDADShcIERIOcHJpdmF0ZSByZW1hcmsaA29yZA==',
  partial: 'CgNldnQiQQoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAGoBMXIDMS4wMARSNQoDb3JkEgRmaWxsGhQxLjAwMDAwMDAwMDAwMDAwMDAwMSIBMSoBMTABSgQxLjAwUgRmbG93',
  filled: 'CgNldnQiQQoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAWoBMnIDMS4wMARSNQoDb3JkEgRmaWxsGhQxLjAwMDAwMDAwMDAwMDAwMDAwMSIBMioBMDACSgQxLjAwUgRmbG93',
  expired: 'CgNldnQiPwoDb3JkEAEaA0JUQyIDVVNEKhQxLjAwMDAwMDAwMDAwMDAwMDAwMTIBMjgBQAJYgYCAgICAgBBgAWoBMHIBMDAFWgUKA29yZA==',
};
const account = '987654321098765433', micros = '9007199254740993';
const base = {
  event_id: 'event-fixture-1', event_type: 'EVENT_FILL', event_time_us: JSON.rawJSON(micros),
  user_info: { uid: 998, acc_id: JSON.rawJSON(account) },
  order_info: { order_id: 'ord', side: 'BUY', order_type: 'LIMIT', order_status: 'FILLED_ALL', code: 'US.EXAMPLE',
    stock_name: 'Example', security_type: 'STOCK', qty: '100', price: '1.000000000000000001', currency: 'USD',
    create_time: 1751433500000000, updated_time: JSON.rawJSON(micros), dealt_qty: '100', dealt_avg_price: '0.999',
    remark: 'private remark', time_in_force: 'DAY', session: 'RTH', position_open_type: '', algo_info: null },
  fill_infos: [{ side: 'BUY', deal_id: 'fill', order_id: 'ord', code: 'US.EXAMPLE', stock_name: 'Example', qty: '100',
    price: '0.999', create_time: JSON.rawJSON(micros), updated_time: JSON.rawJSON(micros), status: 'OK' }],
};
const read = frame => securities(account, JSON.stringify(frame));
const bytes = (name, ...extra) => Buffer.concat([Buffer.from(reports[name], 'base64'), Buffer.from(extra)]);
const published = path => catalog.sources.find(row => row.path === '/api/' + path + '/trade_event_push/data-format')
  .routes.map(key => key.split('/').at(-1)).sort();

test('securities replay binds exact account digits and handles each documented event disposition', () => {
  assert.deepEqual([...securitiesTradeTopics].sort(), published('trading'));
  for (const topic of securitiesTradeTopics) {
    const status = ({ EVENT_FILL: 'OK', EVENT_FILL_CORRECT: 'CHANGED', EVENT_FILL_CANCEL: 'CANCELLED' })[topic];
    const fills = status ? [{ ...base.fill_infos[0], status }] : [];
    const event = read({ ...base, event_type: topic, fill_infos: fills });
    assert.equal(event.topic, topic); assert.equal(event.status, 'decoded'); assert.equal(event.account_binding, 'matched-frame');
    assert.equal(event.order.price, '1.000000000000000001'); assert.equal(event.event_time_us, micros);
    assert.equal(event.order.updated_us, micros); assert.equal(event.order.has_remark, true);
    assert.equal(event.fills.length, fills.length);
    if (status) assert.deepEqual(event.fills[0], { fill_id: 'fill', symbol: 'US.EXAMPLE', side: 'BUY', quantity: '100', price: '0.999',
      status, created_us: micros, updated_us: micros });
    assert(!JSON.stringify(event).includes(account)); assert(!JSON.stringify(event).includes('private remark'));
  }
  const wire = JSON.stringify(base);
  assert.throws(() => securities(String(BigInt(account) - 1n), wire), /ACCOUNT_BINDING/);
  assert.throws(() => securities(account, JSON.stringify(JSON.parse(wire))), /ACCOUNT_BINDING/);
  assert.throws(() => read({ ...base, event_type: 'EVENT_FILL_CANCEL' }), /INVALID_TRADE_EVENT/);
  assert.throws(() => read({ ...base, fill_infos: [{ ...base.fill_infos[0], order_id: 'unrelated' }] }), /ORDER_BINDING/);
  assert.throws(() => read({ ...base, fill_infos: [{ ...base.fill_infos[0], code: 'US.OTHER' }] }), /INSTRUMENT_BINDING/);
  assert.throws(() => read({ ...base, order_info: { ...base.order_info, qty: 100 } }), /PRECISION_UNKNOWN/);
  assert.deepEqual(read({ ...base, event_type: 'EVENT_FUTURE' }), { family: 'securities', topic: 'EVENT_FUTURE', status: 'unsupported' });
});

test('market orders, conditional fields, strategy orders and option legs retain their source units', () => {
  const row = { ...base.order_info, order_type: 'MARKET', price: '', dealt_avg_price: '', security_type: 'MULTILEG_OPTION',
    multi_leg_info: { underlying_symbol: 'US.EXAMPLE', leg_infos: [{ code: 'US.OPT', side: 'BUY', security_type: 'OPTION',
      ratio_qty: '2', hp_multiplier: '100.00', avg_fill_price: '' }] },
    algo_info: { start_time: JSON.rawJSON(micros), pricing_strategy: 'PASSIVE', slicer: { slice_interval: 10, display_qty: 3 } },
    aux_price: '9.9', trail_value: '0.05', sub_acc_id: 'private-subaccount', extra: 'unrelated' };
  const event = read({ ...base, order_info: row, fill_infos: [{ ...base.fill_infos[0], code: 'US.OPT' }] });
  assert.equal(event.order.price, null); assert.equal(event.order.average_fill_price, null);
  assert.equal(event.order.algo.start_time, micros); assert.equal(event.order.algo.slicer.display_qty, 3);
  assert.equal(event.order.multi_leg.legs[0].hp_multiplier, '100.00'); assert.equal(event.order.trail_value, '0.05');
  assert(!JSON.stringify(event).includes('private-subaccount'));
});

test('crypto binary replay covers every published report type and distinguishes terminal states and rejections', () => {
  assert.deepEqual(cryptoReportTopics.map(String).sort(), published('crypto_trading'));
  const outcomes = ['placed', 'placement-rejected', 'cancelled', 'cancellation-rejected', 'partial-fill', 'filled', 'expired'];
  for (const [index, name] of Object.keys(reports).entries()) {
    const b = bytes(name), event = crypto(b);
    assert.deepEqual(crypto(Uint8Array.from(b).buffer), event);
    assert.equal(event.outcome, outcomes[index]); assert.equal(event.status, 'decoded');
    assert.equal(event.account_binding, 'absent-from-frame'); assert.equal(event.event_time_us, null);
    assert.equal(event.order.created_us, micros); assert.equal(event.order.price, '1.000000000000000001');
    assert.equal(event.has_error, name.endsWith('Failed')); assert(!JSON.stringify(event).includes('private remark'));
    if (event.topic === 4) {
      assert.equal(event.fill.flow_id, 'flow'); assert.equal(event.fill.price, event.order.price);
      assert.equal(event.order.closed, event.fill.remaining_quantity === '0');
    }
  }
  assert.equal(crypto(bytes('placeFailed')).result, -9);
  assert.deepEqual(crypto(bytes('partial', 0xa2, 0x06, 2, 0, 1)), crypto(bytes('partial')));
  assert.deepEqual(crypto(Uint8Array.of(0x30, 99)), { family: 'crypto', topic: 99, status: 'unsupported' });
});

test('incomplete wire data, mismatched order references and conflicting report branches fail before projection', () => {
  assert.throws(() => crypto(bytes('partial').subarray(0, -1)), /INVALID_PROTOBUF/);
  assert.throws(() => crypto(bytes('filled', 0x22, 2, 0x60, 0)), /INVALID_TRADE_EVENT/);
  assert.throws(() => crypto(bytes('placed', 0x3a, 3, 0x1a, 1, 0x73)), /ORDER_BINDING/);
  assert.throws(() => crypto(bytes('expired', 0x3a, 0)), /INVALID_TRADE_EVENT/);
  assert.throws(() => crypto(new Uint8Array(480001)), /INVALID_PROTOBUF/);
  assert.throws(() => crypto('{"code":0}'), /INVALID_PROTOBUF/);
  assert.throws(() => securities(account, '{}'), /ACCOUNT_BINDING/);
});
