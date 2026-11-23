const hexDigest = /^[a-f0-9]{64}$/;
const revisionPin = /^[a-f0-9]{40}$/;

export async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function failure(code) {
  return Object.assign(new Error(code), { code });
}

export async function openPresetCatalog(indexText, pin) {
  if (!pin || !revisionPin.test(pin.revision) || !hexDigest.test(pin.indexDigest) || !hexDigest.test(pin.sourceDigest)) {
    throw failure('missing_pin');
  }
  if (await sha256Text(indexText) !== pin.indexDigest) throw failure('stale_pin');
  const index = JSON.parse(indexText);
  if (index.schema !== 'gateway/preset-index/v1' || !Array.isArray(index.presets)) throw failure('unsupported_index');
  if (index.source?.revision !== pin.revision || index.source?.digest !== pin.sourceDigest) throw failure('stale_pin');
  const byKey = new Map();
  for (const item of index.presets) {
    if (typeof item.id !== 'string' || !item.id || typeof item.slash_command !== 'string' || !item.slash_command.startsWith('/')
      || !hexDigest.test(item.bodyDigest) || Object.hasOwn(item, 'prompt')) throw failure('invalid_preset');
    for (const key of [item.id, item.slash_command]) {
      if (byKey.has(key)) throw failure('ambiguous_preset');
      byKey.set(key, item);
    }
  }
  return Object.freeze({
    list() { return structuredClone(index.presets); },
    async select(key, readBody) {
      const item = byKey.get(key);
      if (!item) throw failure('unknown_preset');
      const text = await readBody(item.bodyDigest);
      if (typeof text !== 'string' || await sha256Text(text) !== item.bodyDigest) throw failure('body_digest_mismatch');
      return { metadata: structuredClone(item), prompt: text };
    },
  });
}
