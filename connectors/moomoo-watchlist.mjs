import { check, only, root, string, integer, readWire, decimal, measure, marketDate, completePage } from './moomoo-rest-wire.mjs';

// A market quote grant alone does not identify the owner of a watchlist.
export const watchlistRestRoutes = Object.freeze({
  quote_user_security_group: 'GET ' + root + 'user-security-group',
  quote_user_security: 'GET ' + root + 'user-security',
});
function groupName(name, error) {
  check(typeof name === 'string' && name.isWellFormed() && name.length > 0 &&
    name.length <= 200 && [...name].length <= 100, error);
  return name;
}

export function buildMoomooWatchlistRequest(tool, inputs) {
  check(typeof tool === 'string' && Object.hasOwn(watchlistRestRoutes, tool), 'UNSUPPORTED');
  const directory = tool === 'quote_user_security_group';
  const key = directory ? 'group_type' : 'group_name';
  only(inputs, [key]);
  const value = Object.hasOwn(inputs, key) ? inputs[key] : directory ? 'ALL' : undefined;
  if (directory) check(['ALL', 'SYSTEM', 'CUSTOM'].includes(value));
  else groupName(value, 'INVALID_PARAMETER');
  const [method, path] = watchlistRestRoutes[tool].split(' ');
  return { method, path: path + '?' + new URLSearchParams({ [key]: value }) };
}

function watchlistSecurity(item) {
  check(item && typeof item.code === 'string' && item.code.length > 0, 'INVALID_PAGE');
  const row = { symbol: item.code, name: string(item.name), strike_price: measure(item, 'strike_price') };
  for (const key of ['sc_name', 'tc_name', 'stock_type', 'stock_owner'])
    row[key] = item[key] == null ? null : string(item[key]);
  for (const key of ['strike_time', 'listing_date', 'last_trade_time'])
    row[key] = item[key] == null || item[key] === '' ? null : marketDate(string(item[key]));
  for (const key of ['lot_size', 'stock_child_type'])
    row[key] = item[key] == null ? null : integer(item[key], 0, Number.MAX_SAFE_INTEGER, 'INVALID_PAGE');
  check(item.option_type == null || ['ALL', 'CALL', 'PUT', 'UNKNOWN'].includes(item.option_type), 'INVALID_PAGE');
  check(item.main_contract == null || typeof item.main_contract === 'boolean', 'INVALID_PAGE');
  row.option_type = item.option_type ?? null;
  row.main_contract = item.main_contract ?? null;
  row.stock_id = item.stock_id == null ? null : decimal(item.stock_id);
  check(row.stock_id === null || /^\d+$/.test(row.stock_id), 'INVALID_PAGE');
  return row;
}

export function projectMoomooWatchlistResponse(tool, inputs, wire) {
  buildMoomooWatchlistRequest(tool, inputs);
  const response = readWire(wire);
  check(Number.isSafeInteger(response?.ret_code), 'INVALID_PAGE');
  if (response.ret_code !== 0) {
    if (response.ret_code === -9) check(false, 'PERMISSION_DENIED');
    check(false, response.ret_code === -3 ? 'INVALID_PARAMETER' : 'PROVIDER_ERROR');
  }
  completePage(response.pagination);
  if (tool === 'quote_user_security_group') {
    const group_type = Object.hasOwn(inputs, 'group_type') ? inputs.group_type : 'ALL';
    check(Array.isArray(response.data?.group_list), 'INVALID_PAGE');
    const rows = response.data.group_list.map(item => {
      check(['CUSTOM', 'SYSTEM'].includes(item?.group_type), 'INVALID_PAGE');
      check(group_type === 'ALL' || item.group_type === group_type, 'GROUP_TYPE_MISMATCH');
      return { group_name: groupName(item.group_name, 'INVALID_PAGE'), group_type: item.group_type };
    });
    return { rows, requested: { group_type } };
  }
  check(Array.isArray(response.data?.security_list), 'INVALID_PAGE');
  return { rows: response.data.security_list.map(watchlistSecurity), requested: { group_name: inputs.group_name } };
}
