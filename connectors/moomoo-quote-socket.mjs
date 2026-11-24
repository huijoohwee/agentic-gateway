import { parseMoomooQuoteFrame, replayMoomooPush } from './moomoo.mjs';

export const MOOMOO_QUOTE_SOCKET = 'wss://webapi-quote.moomoo.com/ws';
const PERIODS = new Set(['1m', '3m', '5m', '10m', '15m', '30m', '60m', '120m',
  '180m', '240m', '1D', '1W', '1M', '1Q', '1Y']);
const ADJUST = new Set(['none', 'forward', 'forward_exclude_dividend', 'forward_include_dividend']);
const TYPES = new Set(['quote', 'order_book', 'ticker', 'kline']);
const MAX_WIRE_BYTES = 480_000;
const MAX_MESSAGES = 128;

function check(ok, reason) { if (!ok) throw Error(reason); }
function within(value, limit) { return Number.isSafeInteger(value) && value > 0 && value <= limit; }

function subscriptionFor(grant) {
  const { symbol, type, period, adjust } = grant ?? {};
  check(typeof symbol === 'string' && /^[A-Z][A-Z0-9]{0,11}\.[A-Z0-9][A-Z0-9.-]{0,31}$/.test(symbol) &&
    TYPES.has(type), 'INVALID_QUOTE_SUBSCRIPTION');
  if (type === 'kline') {
    check(PERIODS.has(period) && ADJUST.has(adjust), 'INVALID_KLINE_DIMENSION');
    return { kline: [{ symbol, period, adjust }] };
  }
  check(period === undefined && adjust === undefined, 'INVALID_QUOTE_SUBSCRIPTION');
  return { [type]: [symbol] };
}

function project(frame, subscription, seen) {
  const [type] = Object.keys(subscription);
  const item = subscription[type][0];
  const symbol = type === 'kline' ? item.symbol : item;
  // These derivative topics can arrive without a matching subscription key. They consume
  // wire budget but never occupy the reserved capture for the requested dimension.
  if (frame.type === 'MARKET_STATE' || frame.type === 'BROKER_QUEUE' && type === 'order_book') return null;
  check(frame.type === type.toUpperCase(), 'QUOTE_TOPIC_MISMATCH');
  if (type === 'kline') check(frame.data?.period === item.period && frame.data?.adjust === item.adjust, 'KLINE_DIMENSION_MISMATCH');
  const result = replayMoomooPush(symbol, frame);
  result.evidence = 'socket-frame';
  if (type !== 'ticker') return result;
  const ticks = [];
  for (const tick of result.ticks) {
    check(typeof tick.sequence === 'string', 'INVALID_TRADE_SEQUENCE');
    const digest = JSON.stringify(tick);
    if (seen.has(tick.sequence)) check(seen.get(tick.sequence) === digest, 'CONFLICTING_TRADE');
    else { seen.set(tick.sequence, digest); ticks.push(tick); }
  }
  return ticks.length || !result.ticks.length ? { ...result, ticks } : null;
}

// The host verifies the signed grant and reserves one socket, one subscription key and
// three control sends before binding. The closure spends that reservation once, including
// timeouts. A reconnect needs a new reservation, OAuth login and a separate REST baseline.
export function bindMoomooQuoteCapture({ grant, accessToken, openSocket = url => new WebSocket(url) } = {}) {
  const subscription = subscriptionFor(grant);
  const { expiresAt, frameLimit, captureMs, controlTimeoutMs } = grant;
  check(grant.right === 'quote:read' && grant.entitled === true && grant.providerHardCapUsd === 0 &&
    grant.reservedSessions === 1 && grant.reservedKeys === 1 && grant.reservedControlCalls === 3,
    'ENTITLED_ZERO_COST_SUBSCRIPTION_REQUIRED');
  check(Number.isSafeInteger(expiresAt) && within(frameLimit, 64) && within(captureMs, 60_000) &&
    within(controlTimeoutMs, 10_000), 'INVALID_CAPTURE_LIMIT');
  check(typeof accessToken === 'function' && typeof openSocket === 'function', 'INVALID_QUOTE_HOST');
  let used = false;
  return async function capture({ signal } = {}) {
    check(!used, 'STREAM_GRANT_SPENT');
    check(Date.now() < expiresAt, 'STREAM_EXPIRED');
    check(signal == null || typeof signal.addEventListener === 'function' &&
      typeof signal.removeEventListener === 'function' && typeof signal.aborted === 'boolean', 'INVALID_CAPTURE_SIGNAL');
    check(!signal?.aborted, 'CAPTURE_ABORTED');
    used = true;
    const prefix = crypto.randomUUID();
    let socket;
    try { socket = openSocket(MOOMOO_QUOTE_SOCKET); } catch { throw Error('QUOTE_SOCKET_FAILED'); }
    return new Promise((resolve, reject) => {
      const frames = [], seen = new Map();
      let phase = 'connecting', timer, expiryTimer, received = 0, bytes = 0;
      function finish(reason) {
        if (phase === 'closed') return;
        phase = 'closed';
        clearTimeout(timer); clearTimeout(expiryTimer);
        signal?.removeEventListener('abort', abort);
        for (const [name, listener] of events) socket.removeEventListener(name, listener);
        try { socket.close(); } catch { /* transport already closed */ }
        if (reason) reject(Error(reason));
        else resolve({ subscription, frames, receivedMessages: received, wireBytes: bytes });
      }
      function authorized() {
        if (Date.now() >= expiresAt) { finish('STREAM_EXPIRED'); return false; }
        if (signal?.aborted) { finish('CAPTURE_ABORTED'); return false; }
        return phase !== 'closed';
      }
      function send(action, fields) {
        if (!authorized()) return;
        phase = action;
        clearTimeout(timer);
        timer = setTimeout(() => finish('QUOTE_CONTROL_TIMEOUT'), controlTimeoutMs);
        try { socket.send(JSON.stringify({ id: prefix + '-' + action, action, ...fields })); }
        catch { finish('QUOTE_SOCKET_FAILED'); }
      }
      function open() {
        if (phase !== 'connecting' || !authorized()) return;
        if (socket.url !== MOOMOO_QUOTE_SOCKET) return finish('QUOTE_ORIGIN_MISMATCH');
        let token;
        try { token = accessToken(); } catch { return finish('QUOTE_CREDENTIAL_UNAVAILABLE'); }
        if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 8192) {
          return finish('QUOTE_CREDENTIAL_UNAVAILABLE');
        }
        send('auth', { data: { auth_type: 'oauth2', authorization: 'Bearer ' + token } });
      }
      function unsubscribe() { send('unsubscribe', subscription); }
      function receive({ data }) {
        if (!authorized()) return;
        try {
          check(typeof data === 'string' && data.length <= MAX_WIRE_BYTES, 'QUOTE_WIRE_LIMIT');
          bytes += new TextEncoder().encode(data).byteLength;
          check(++received <= MAX_MESSAGES && bytes <= MAX_WIRE_BYTES, 'QUOTE_WIRE_LIMIT');
          let frame;
          try { frame = parseMoomooQuoteFrame(data); } catch { throw Error('INVALID_QUOTE_FRAME'); }
          if (Number.isInteger(frame.code) && frame.code !== 0) {
            // Provider text is private and can refer to credentials or account information.
            check(frame.code > 0 && frame.code <= 9999, 'INVALID_QUOTE_FRAME');
            throw Error('QUOTE_PROVIDER_REFUSED_' + frame.code);
          }
          if (Object.hasOwn(frame, 'type')) {
            if (phase === 'unsubscribe') return;
            check(phase === 'active', 'UNACKNOWLEDGED_QUOTE_FRAME');
            const result = project(frame, subscription, seen);
            if (result) frames.push(result);
            if (frames.length === frameLimit) unsubscribe();
            return;
          }
          check(frame.id === prefix + '-' + phase, 'QUOTE_ACK_MISMATCH');
          if (phase === 'auth') {
            check((frame.code == null || frame.code === 0) && typeof frame.session_id === 'string' && frame.session_id &&
              Number.isSafeInteger(frame.server_time) && frame.server_time > 0, 'INVALID_QUOTE_AUTH_ACK');
            send('subscribe', subscription);
          } else {
            check(frame.code === 0 && (phase === 'subscribe' || phase === 'unsubscribe'), 'INVALID_QUOTE_ACK');
            if (phase === 'unsubscribe') return finish();
            phase = 'active';
            clearTimeout(timer);
            timer = setTimeout(unsubscribe, captureMs);
          }
        } catch (error) { finish(error.message); }
      }
      const abort = () => finish('CAPTURE_ABORTED');
      const events = [['open', open], ['message', receive], ['close', () => finish('QUOTE_DISCONNECTED')],
        ['error', () => finish('QUOTE_SOCKET_FAILED')]];
      timer = setTimeout(() => finish('QUOTE_CONTROL_TIMEOUT'), controlTimeoutMs);
      // The longest possible session is shorter than the provider's refresh interval.
      // Clamp long-lived grant timers to avoid platform timer overflow.
      expiryTimer = setTimeout(() => finish('STREAM_EXPIRED'), Math.min(2_147_483_647, Math.max(0, expiresAt - Date.now())));
      for (const [name, listener] of events) socket.addEventListener(name, listener);
      signal?.addEventListener('abort', abort, { once: true });
      if (!authorized()) return;
      if (socket.readyState === 1) open();
      else if (socket.readyState !== 0) finish('QUOTE_DISCONNECTED');
    });
  };
}
