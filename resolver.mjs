import { createRecordRelation } from './vendor/agentic-base/record-links.mjs';

// Local conformance host. The injected routes keep the native grant, result and receipt.
const id = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const revision = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const lists = ['routes', 'features', 'losses'];
const refused = reason => ({ ok: false, reason });

export function validateManifest(m) {
  if (!m || m.major !== 1 || !id.test(m.id) || !revision.test(m.revision) || !digest.test(m.schemaDigest)) {
    throw new TypeError('Invalid capability identity, version or pin');
  }
  for (const key of ['owner', 'operation', 'input', 'output', 'fidelity', 'mode']) {
    if (typeof m[key] !== 'string' || !m[key].trim()) throw new TypeError('Invalid manifest field ' + key);
  }
  for (const key of lists) {
    if (!Array.isArray(m[key]) || !m[key].every(x => typeof x === 'string' && x.length > 0)
      || new Set(m[key]).size !== m[key].length) throw new TypeError('Invalid manifest list ' + key);
  }
  if (!m.routes.length || m.locality !== 'device') throw new TypeError('Expected a local qualification route');
  const validated = { ...m, ...Object.fromEntries(lists.map(k => [k, Object.freeze([...m[k]])])) };
  if (m.requirements !== undefined) {
    if (!m.requirements || typeof m.requirements !== 'object' || Array.isArray(m.requirements) ||
        Object.keys(m.requirements).length !== m.routes.length) throw new TypeError('Expected requirements for every route');
    validated.requirements = Object.freeze(Object.fromEntries(m.routes.map(route => {
      const facts = m.requirements[route];
      if (!Object.hasOwn(m.requirements,route) || !Array.isArray(facts) ||
          !facts.every(fact => typeof fact === 'string' && fact.length > 0) || new Set(facts).size !== facts.length) {
        throw new TypeError('Invalid requirements for ' + route);
      }
      return [route, Object.freeze([...facts])];
    })));
  }
  return Object.freeze(validated);
}

export function createResolver(entries) {
  const catalog = entries.map(({ manifest, bindings }) => ({ m: validateManifest(manifest), bindings }));
  let routeIndex;
  function entriesForRoute(route) {
    if (typeof route !== 'string') throw new TypeError('Expected a route name');
    if (!routeIndex) {
      const names = new Set(), links = [];
      const sources = catalog.map(({ m }, index) => {
        const source = String(index);
        for (const name of m.routes) {
          // JSON string encoding preserves every route accepted by validateManifest.
          const target = JSON.stringify(name);
          names.add(target); links.push({ source, target });
        }
        return source;
      });
      routeIndex = { names, relation: createRecordRelation({ sources, targets: names, links }) };
    }
    const target = JSON.stringify(route);
    return routeIndex.names.has(target)
      ? routeIndex.relation.to(target).map(edge => catalog[Number(edge.source)])
      : [];
  }
  const configured = binding => typeof binding?.invoke === 'function';
  function resolve(request) {
    const matches = catalog.filter(({ m }) => m.id === request.id && m.major === request.major);
    if (matches.length !== 1) return refused(matches.length ? 'ambiguous_owner' : 'unknown_capability');
    const { m, bindings } = matches[0];
    if (request.owner !== m.owner || request.revision !== m.revision || request.schemaDigest !== m.schemaDigest) return refused('stale_pin');
    if (!m.routes.includes(request.route)) return refused('unsupported_route');
    const binding = bindings[request.route];
    if (!configured(binding)) return refused('not_configured');
    if (binding.revision !== m.revision || binding.schemaDigest !== m.schemaDigest) return refused('stale_pin');
    if (binding.costUsd !== 0 || binding.offline !== true) return refused('cost_or_locality_unknown');
    if (!Array.isArray(request.required) || !request.required.every(f => m.features.includes(f))) return refused('missing_feature');
    if (!Array.isArray(request.acceptedLosses) || !m.losses.every(f => request.acceptedLosses.includes(f))) return refused('unapproved_loss');
    return { ok: true, m, binding };
  }
  return {
    discover(hostFacts, { route } = {}) {
      const facts = hostFacts === undefined ? null : new Set(hostFacts);
      const entries = route === undefined ? catalog : entriesForRoute(route);
      return entries.map(({ m, bindings }) => {
        const entry = { manifest: m, configuredRoutes: m.routes.filter(route => configured(bindings[route])) };
        if (facts && m.requirements) {
          entry.routes = m.routes.map(route => {
            const missing = m.requirements[route].filter(fact => !facts.has(fact));
            return { route, available: missing.length === 0, missing };
          });
        }
        return entry;
      });
    },
    async invoke(request, nativeRequest, grant) {
      const decision = resolve(request);
      if (!decision.ok) return decision;
      const native = await decision.binding.invoke(nativeRequest, grant);
      return { ok: true, capability: decision.m.id, revision: decision.m.revision, losses: decision.m.losses, native };
    },
  };
}
