// The host chooses the trusted index pin and supplies bytes for one selected owner reference.
import { sha256Text } from './presets.mjs';

const idPattern = /^(guideline|schema|route-dictionary|command-catalog|skill)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hex = /^[a-f0-9]{64}$/;
const fields = ['id', 'kind', 'owner', 'path', 'revisionKind', 'revision', 'digest', 'version', 'aliases', 'routes'];
const statuses = new Set(['metadata-only', 'runtime-declared']);

function refuse(code, cause) {
  throw Object.assign(new Error(code, {cause}), {code});
}

function validEntry(entry) {
  return entry && Object.keys(entry).length === fields.length && fields.every(key => Object.hasOwn(entry, key))
    && typeof entry.id === 'string' && idPattern.exec(entry.id)?.[1] === entry.kind && typeof entry.kind === 'string'
    && typeof entry.owner === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.owner)
    && typeof entry.path === 'string' && entry.path.split('/').every(part => /^[\w-][\w.-]*$/.test(part))
    && entry.revisionKind === 'git-commit' && /^[a-f0-9]{40}$/.test(entry.revision) && hex.test(entry.digest)
    && (entry.version === null || typeof entry.version === 'string' && entry.version.length > 0)
    && Array.isArray(entry.aliases) && entry.aliases.every(key => typeof key === 'string' && /^[\w/-]+$/.test(key))
    && Array.isArray(entry.routes) && entry.routes.every(route => route && Object.keys(route).length === 2
      && typeof route.token === 'string' && /^[#/@]\S+$/.test(route.token) && statuses.has(route.status));
}

export async function openReferenceIndex(indexText, pin) {
  if (!pin || !hex.test(pin.indexDigest)) refuse('missing_pin');
  if (typeof indexText !== 'string' || await sha256Text(indexText) !== pin.indexDigest) refuse('stale_pin');
  let index;
  try { index = JSON.parse(indexText); } catch (cause) { refuse('invalid_index', cause); }
  if (index?.schema !== 'gateway/reference-index/v1' || !Array.isArray(index.entries)
    || Object.keys(index).length !== 2) refuse('unsupported_index');
  const byKey = new Map();
  for (const entry of index.entries) {
    if (!validEntry(entry)) refuse('invalid_reference');
    for (const key of [entry.id, ...entry.aliases]) {
      if (byKey.has(key)) refuse('ambiguous_reference');
      byKey.set(key, entry);
    }
  }
  return Object.freeze({
    list() { return structuredClone(index.entries); },
    async select(key, readBody) {
      const entry = byKey.get(key);
      if (!entry) refuse('unknown_reference');
      let body;
      try { body = await readBody(structuredClone(entry)); } catch (cause) { refuse('owner_unavailable', cause); }
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      if (!(bytes instanceof Uint8Array)) refuse('invalid_owner_bytes');
      const snapshot = new Uint8Array(bytes);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', snapshot));
      if (Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== entry.digest) refuse('body_digest_mismatch');
      return {metadata: structuredClone(entry), bytes: snapshot};
    },
  });
}
