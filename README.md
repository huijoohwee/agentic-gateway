# agentic-gateway

A headless JavaScript resolver for locally configured capabilities. It runs offline in a browser or a Node host with zero runtime dependencies. The host supplies each native adapter and its cost, locality and revision evidence.

Import `createResolver` and `validateManifest` from `agentic-gateway`. Register entries shaped as `{manifest, bindings}`. Each binding is addressed by route. Call `discover()` to list descriptors and configured routes. Call `invoke(plan, nativeRequest, nativeGrant)` to check the requested pin, route, features and accepted losses before calling the selected native handler. The result carries the capability, revision, declared losses and native response. A native refusal or exception retains its native form. The local v1 profile admits device execution with a known zero provider cost.

Run `npm test` in the source checkout for the portable contract fixtures. The native cross-product qualification runs in [Trading PR 8](https://github.com/huijoohwee/agentic-trading-platform/pull/8) against [Graph PR 2064](https://github.com/huijoohwee/agentic-graph/pull/2064).

## Prompt presets

The optional `agentic-gateway/presets` export reads a pinned metadata index. Its `list()` operation reads zero prompt bodies. `select(idOrAlias, readBody)` reads a single content-addressed text body, checks its SHA-256, and returns the text and metadata. The host handles explicit submission.

Edit shared presets in [catalog/PROMPT-PRESETS.md](catalog/PROMPT-PRESETS.md). Run `npm ci`, `npm run presets:build`, then `npm test`. Commit the authored Markdown and its generated index, pin and body files together. The source revision in the index is the Git blob ID of the Markdown. Consumers pin a gateway commit. The OS compatibility export retains its existing path and refreshes from a gateway commit.
