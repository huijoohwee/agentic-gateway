# agentic-gateway

A headless JavaScript resolver for locally configured capabilities. It runs offline in a browser or a Node host with zero runtime dependencies. The host supplies each native adapter and its cost, locality and revision evidence.

Import `createResolver` and `validateManifest` from `agentic-gateway`. Register entries shaped as `{manifest, bindings}`. Each binding is addressed by route. Call `discover()` to list descriptors and configured routes. Call `invoke(plan, nativeRequest, nativeGrant)` to check the requested pin, route, features and accepted losses before calling the selected native handler. The result carries the capability, revision, declared losses and native response. A native refusal or exception retains its native form. The local v1 profile admits device execution with a known zero provider cost.

Run `npm test` in the source checkout for the portable contract fixtures. The native cross-product qualification runs in [Trading PR 8](https://github.com/huijoohwee/agentic-trading-platform/pull/8) against [Graph PR 2064](https://github.com/huijoohwee/agentic-graph/pull/2064).

## Prompt presets

The optional `agentic-gateway/presets` export reads a pinned metadata index. Its `list()` operation reads zero prompt bodies. `select(idOrAlias, readBody)` reads a single content-addressed text body, checks its SHA-256, and returns the text and metadata. The host handles explicit submission.

Edit shared presets in [catalog/PROMPT-PRESETS.md](catalog/PROMPT-PRESETS.md). Run `npm ci`, `npm run presets:build`, then `npm test`. Commit the authored Markdown and its generated index, pin and body files together. The source revision in the index is the Git blob ID of the Markdown. Consumers pin a gateway commit. The OS compatibility export retains its existing path and refreshes from a gateway commit.

## Optional provider connectors

Import `agentic-gateway/connectors/hyperframes` for standalone declarative HTML. Pass the source and a browser document to `importHyperframesHtml` to get inspected HTML, composition identity, dimensions, duration in milliseconds and ordered clip intervals. The host applies clip visibility at each seek. The authored HTML remains the editable source.

Import `agentic-gateway/connectors/moomoo` to project a one-symbol OpenD snapshot. `replayMoomooSnapshot(symbol, response)` labels local evidence as replay. `bindMoomooSnapshot(client, grant)` accepts an authenticated quote client and an explicit one-read entitlement with a zero USD cost and expiry. The host supplies that evidence and selects the online read. The optional Python bridge uses the operator’s local OpenD and separately installed SDK.

[Qualified features, losses and verification](qualification/provider-handoff.md)

### Offline provider discovery

`discoverProviderProfiles(hostFacts)` from `agentic-gateway/provider-profiles` loads metadata only. The optional gateway module registers both manifests with the existing resolver. Each entry returns its input, output, features, losses and per-route requirements. The caller supplies only facts it can establish. For example, a Trading process can declare `snapshot-replay` and `opend-reader` without checking a port or reading credentials.

`createResolver(entries).discover(hostFacts)` also assesses any registered manifest with per-route requirements. `available` means the supplied facts satisfy those requirements. Native invocation still applies the host's binding, cost and grant checks. Existing `discover()` callers retain their original response shape. The manifest revision is the connector’s Git blob ID, and its schema digest covers the functional profile and its route requirements. Consumers pin the complete gateway package.
