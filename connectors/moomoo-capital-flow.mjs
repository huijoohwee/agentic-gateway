import { check, completePage, decimal, integer, marketDate, only, root } from './moomoo-rest-wire.mjs';

export const capitalFlowRoutes = Object.freeze({
  quote_capital_distribution: 'GET ' + root + '{symbol}/capital-distribution',
  quote_capital_flow_history: 'GET ' + root + '{symbol}/capital-flow/history',
});
const distribution = ['in', 'out'].flatMap(side => ['super', 'big', 'mid', 'small'].map(size => 'capital_' + side + '_' + size));
const history = ['in_flow', 'main_in_flow', 'super_in_flow', 'big_in_flow', 'mid_in_flow', 'sml_in_flow'];
const optional = ['main_deal_ratio', 'acc_main_in_flow'];
export const flowNumbers = new Set([...distribution, ...history, ...optional]);
const timestamp = (n, code) => integer(n, 0, 8640000000000000, code);

export function flowRequest(tool, inputs, path, symbol) {
  const series = tool === 'quote_capital_flow_history';
  only(inputs, series ? ['symbol', 'period_type', 'start', 'end', 'count', 'next_time'] : ['symbol']);
  path = path.replace('{symbol}', encodeURIComponent(symbol(inputs.symbol)));
  const params = new URLSearchParams();
  if (Object.hasOwn(inputs, 'period_type')) {
    check(['DAY', 'WEEK', 'MONTH'].includes(inputs.period_type)); params.set('period_type', inputs.period_type);
  }
  for (const key of ['start', 'end']) if (Object.hasOwn(inputs, key)) {
    if (inputs[key] !== '') { check(typeof inputs[key] === 'string'); marketDate(inputs[key], 'INVALID_PARAMETER'); }
    params.set(key, inputs[key]);
  }
  check(!inputs.start || !inputs.end || inputs.next_time > 0 || inputs.start <= inputs.end);
  if (Object.hasOwn(inputs, 'count')) params.set('count', integer(inputs.count, 1, 1000));
  if (Object.hasOwn(inputs, 'next_time')) params.set('next_time', timestamp(inputs.next_time, 'INVALID_PARAMETER'));
  return { method: 'GET', path: params.size ? path + '?' + params : path };
}

function amounts(record, names) {
  return Object.fromEntries(names.map(key => [key, decimal(record[key])]));
}
export function flowPage(tool, inputs, response) {
  const data = response.data;
  check(data && typeof data === 'object' && !Array.isArray(data), 'INVALID_PAGE');
  if (tool === 'quote_capital_distribution') {
    completePage(response.pagination);
    return { rows: [{ symbol: inputs.symbol, update_time: timestamp(data.update_time, 'INVALID_PAGE'), ...amounts(data, distribution) }] };
  }
  const more = response.pagination?.has_more;
  check(typeof more === 'boolean' && Array.isArray(data.flow_list) && data.flow_list.length <= (inputs.count ?? 365), 'INVALID_PAGE');
  const seen = new Set();
  const rows = data.flow_list.map(item => {
    check(item && typeof item === 'object', 'INVALID_PAGE');
    const time = timestamp(item.capital_flow_item_time, 'INVALID_PAGE');
    check(!seen.has(time) && (!inputs.next_time || time < inputs.next_time), 'INVALID_PAGE');
    seen.add(time);
    return { symbol: inputs.symbol, period_type: inputs.period_type ?? 'DAY', capital_flow_item_time: time,
      ...amounts(item, history), ...amounts(item, optional.filter(key => Object.hasOwn(item, key))) };
  });
  let next = null;
  if (more) {
    next = timestamp(data.next_time, 'INVALID_PAGE');
    check(next > 0 && rows.length > 0 && next <= Math.min(...seen) && (!inputs.next_time || next < inputs.next_time), 'INVALID_PAGE');
  } else check(data.next_time == null || data.next_time === 0, 'INVALID_PAGE');
  return { rows, pagination: { has_more: more, next_time: next } };
}
