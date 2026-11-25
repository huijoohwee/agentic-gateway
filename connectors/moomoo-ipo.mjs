import { WireNumber, check, completePage, decimal, only, root, string } from './moomoo-rest-wire.mjs';

const commonTypes = [9, 10, 11];
const subscriptionTimes = ['apply_start_timestamp', 'apply_end_timestamp', 'lucky_timestamp'];
const prices = ['ipo_price_min', 'ipo_price_max'];
// These allowlists describe public offering information. Account-specific subscription and margin fields stay private.
const profiles = {
  quote_ipo_list_cn: {
    region: 'cn', prefixes: ['SH', 'SZ', 'BJ'], types: [1, 2, 3, 4, 5], defaultType: 4,
    text: ['apply_code', 'winning_time'], number: ['ipo_price', 'winning_ratio', 'issue_pe_rate'],
    integer: ['apply_upper_limit', 'apply_time', 'apply_timestamp', 'winning_timestamp'],
    boolean: ['is_estimate_apply_limit', 'is_estimate_ipo_price', 'is_estimate_winning_ratio', 'is_has_won'],
  },
  quote_ipo_list_us: {
    region: 'us', prefixes: ['US'], types: commonTypes, defaultType: 11,
    text: ['stock_status', 'offer_type'], number: [...prices, 'apply_limit'],
    integer: ['issue_size', ...subscriptionTimes, 'placing_apply_start_timestamp', 'placing_apply_end_timestamp'],
  },
  quote_ipo_list_sg: {
    region: 'sg', prefixes: ['SG'], types: commonTypes, defaultType: 11,
    text: ['offer_price_display', 'issue_size_display', 'apply_limit_display', 'market_cap_display', 'fund_amount_display',
      'industry_display', 'managers_display', 'business_display', 'security_type', 'ipo_book_link'],
    number: [...prices, 'apply_limit'], integer: ['issue_size', ...subscriptionTimes], boolean: ['is_subscribe_status'],
  },
  quote_ipo_list_my: {
    region: 'my', prefixes: ['BMS'], types: commonTypes, defaultType: 11,
    text: ['currency', 'manager_code', 'manager', 'industry_plate', 'business', 'ipo_book_link', 'security_type'],
    number: ['ipo_price', 'fund_amount', 'apply_limit'],
    integer: ['issue_size', 'market_cap', 'industry_plate_id', ...subscriptionTimes, 'draw_timestamp'],
    boolean: ['is_subscribe_status', 'support_leverage'],
  },
  rest_ipo_list_jp: {
    region: 'jp', prefixes: ['JP'], types: [], defaultType: null,
    text: ['sc_name', 'tc_name', 'issued_shares', 'isin', 'industry', 'market_segment'], number: prices,
    integer: ['issue_size', 'lot_size', ...subscriptionTimes, 'draw_timestamp'], boolean: ['is_subscribe_status'],
  },
};
export const ipoRoutes = Object.freeze(Object.fromEntries(Object.entries(profiles).map(([tool, profile]) =>
  [tool, 'GET ' + root + 'ipo-list/' + profile.region])));

export function describeMoomooIpo(tool) {
  check(Object.hasOwn(profiles, tool), 'UNSUPPORTED');
  const profile = profiles[tool];
  return {
    market: profile.region.toUpperCase(), requestTypes: [...profile.types], defaultRequestType: profile.defaultType,
    textFields: ['code', 'name', 'list_time', ...profile.text], decimalFields: [...profile.number],
    integerFields: ['list_timestamp', ...profile.integer], booleanFields: [...(profile.boolean ?? [])],
  };
}

export function ipoRequest(tool, inputs, path) {
  const profile = profiles[tool];
  only(inputs, profile.types.length ? ['request_type'] : []);
  if (!Object.hasOwn(inputs, 'request_type')) return { method: 'GET', path };
  check(profile.types.includes(inputs.request_type));
  return { method: 'GET', path: path + '?request_type=' + inputs.request_type };
}

export function ipoNumberKeys(tool) {
  const { number, integer } = profiles[tool];
  return new Set([...number, 'list_timestamp', ...integer]);
}

export function ipoPage(tool, response) {
  const { pagination, data } = response;
  completePage(pagination);
  check([undefined, true].includes(pagination?.completed) && [undefined, ''].includes(pagination?.page_flag), 'INCOMPLETE_PAGE');
  check(Array.isArray(data), 'INVALID_PAGE');
  if (pagination?.total !== undefined) check(pagination.total === data.length, 'INCOMPLETE_PAGE');
  const { textFields, booleanFields, decimalFields, integerFields } = describeMoomooIpo(tool);
  const optionalFields = [...textFields.slice(2), ...booleanFields, ...decimalFields, ...integerFields];
  const seen = new Set();
  const rows = data.map(item => {
    check(item && typeof item === 'object' && !Array.isArray(item), 'INVALID_PAGE');
    const code = string(item.code);
    check(/^[A-Z]+\.[A-Za-z0-9_.-]+$/.test(code) && profiles[tool].prefixes.includes(code.split('.')[0]), 'SECURITY_MISMATCH');
    check(!seen.has(code), 'INVALID_PAGE');
    seen.add(code);
    const row = { code, name: string(item.name) };
    for (const key of optionalFields) {
      if (!Object.hasOwn(item, key)) continue;
      const value = item[key];
      if (value === null) row[key] = null;
      else if (textFields.includes(key)) row[key] = string(value);
      else if (booleanFields.includes(key)) {
        check(typeof value === 'boolean', 'INVALID_PAGE');
        row[key] = value;
      } else {
        check(value instanceof WireNumber, 'INVALID_PAGE');
        row[key] = decimal(value);
        if (integerFields.includes(key)) check(/^-?\d+$/.test(row[key]), 'INVALID_PAGE');
      }
    }
    return row;
  });
  return { rows };
}
