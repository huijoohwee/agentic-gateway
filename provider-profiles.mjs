import { createResolver } from './resolver.mjs';
import manifests from './connectors/profiles.json' with {type: 'json'};

// Discovery takes facts the calling host can establish locally. It does not probe
// a port, import an adapter, inspect credentials or confer an invocation grant.
const resolver = createResolver(manifests.map(manifest => ({manifest, bindings: {}})));
export function discoverProviderProfiles(hostFacts = []) {
  return resolver.discover(hostFacts).map(({manifest, routes}) => ({manifest, routes}));
}
