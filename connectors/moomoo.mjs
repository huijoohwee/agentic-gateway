// Qot_GetSecuritySnapshot. The host owns the signed-in SDK session and entitlement.
const markets = { HK: 1, US: 11 };
const symbolPattern = /^(HK|US)\.([A-Z0-9][A-Z0-9.-]{0,19})$/;

function securityFor(symbol) {
  const match = typeof symbol === 'string' && symbolPattern.exec(symbol);
  if (!match) throw Error('UNSUPPORTED_SECURITY');
  return { market: markets[match[1]], code: match[2] };
}

function sidePrice(row, key) {
  if (!Object.hasOwn(row, key) || row[key] == null || row[key] === 0) return null;
  if (!Number.isFinite(row[key]) || row[key] < 0) throw Error('INVALID_SNAPSHOT');
  return String(row[key]);
}

function projectSnapshot(symbol, response, evidence) {
  const security = securityFor(symbol);
  if (response?.retType !== 0 || (response.errCode != null && response.errCode !== 0)) {
    throw Error('PROVIDER_REFUSED');
  }
  const list = response.s2c?.snapshotList;
  const row = Array.isArray(list) && list.length === 1 && list[0]?.basic;
  if (row?.security?.market !== security.market || row.security.code !== security.code) throw Error('SECURITY_MISMATCH');
  if (!Number.isFinite(row.curPrice) || row.curPrice <= 0 || typeof row.isSuspend !== 'boolean') throw Error('INVALID_SNAPSHOT');
  let marketTimeUtc = null;
  if (Object.hasOwn(row, 'updateTimestamp') && row.updateTimestamp != null) {
    const milliseconds = row.updateTimestamp * 1000;
    if (typeof row.updateTimestamp !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0 ||
        milliseconds > 8.64e15) throw Error('INVALID_MARKET_TIME');
    marketTimeUtc = new Date(Math.round(milliseconds)).toISOString();
  }
  return {
    provider: 'moomoo', evidence, symbol, price: String(row.curPrice),
    bid: sidePrice(row, 'bidPrice'), ask: sidePrice(row, 'askPrice'),
    pricePrecision: 'provider-double', currency: null, marketTimeUtc,
    delayClass: 'unknown', suspended: row.isSuspend,
  };
}

export function replayMoomooSnapshot(symbol, response) {
  return projectSnapshot(symbol, response, 'replay');
}

// A host can bind one already authenticated, entitled read. Consume before dispatch so
// concurrent calls and failed requests cannot exceed the granted one-call budget.
export function bindMoomooSnapshot(client, grant) {
  const security = securityFor(grant?.symbol);
  if (typeof client?.GetSecuritySnapshot !== 'function' || grant.costUsd !== 0 ||
      grant.entitled !== true || grant.maxCalls !== 1) throw Error('ENTITLED_ZERO_COST_READ_REQUIRED');
  const symbol = grant.symbol;
  const expiresAt = grant.expiresAt;
  let used = false;
  return async () => {
    if (used || !Number.isSafeInteger(expiresAt) || Date.now() >= expiresAt) throw Error('READ_GRANT_EXHAUSTED');
    used = true;
    const response = await client.GetSecuritySnapshot({ c2s: { securityList: [security] } });
    return projectSnapshot(symbol, response, 'sdk-response');
  };
}
