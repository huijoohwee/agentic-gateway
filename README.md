# agentic-gateway

A headless JavaScript resolver for locally configured capabilities. It runs offline in a browser or a Node host with zero runtime dependencies. The host supplies each native adapter and its cost, locality and revision evidence.

Run `npm run dev` to browse the verified reference index locally. Open the printed loopback URL (default port 4178, separate from Agentic Base's offline demo on 4174). Use `npm run dev -- --port 0` to request a free port. The preview uses Node.js built-ins and works offline.

Import `createResolver` and `validateManifest` from `agentic-gateway`. Register entries shaped as `{manifest, bindings}`. Each binding is addressed by route. Call `discover()` to list descriptors and configured routes. Pass `discover(hostFacts, { route })` to find every capability advertising a particular route. The optional provider discovery entry accepts the same filter. The reverse lookup uses the pinned Base record-link module distributed with Gateway so it also works directly in an offline browser. Call `invoke(plan, nativeRequest, nativeGrant)` to check the requested pin, route, features and accepted losses before calling the selected native handler. The result carries the capability, revision, declared losses and native response. A native refusal or exception retains its native form. The local v1 profile admits device execution with a known zero provider cost.

Run `npm test` in the source checkout for the portable contract fixtures. The native cross-product qualification runs in [Trading PR 8](https://github.com/huijoohwee/agentic-trading-platform/pull/8) against [Graph PR 2064](https://github.com/huijoohwee/agentic-graph/pull/2064).

## Governing references

Find owner files by ID or alias in the [pinned reference index](references/README.md). The optional `agentic-gateway/references` module lists metadata offline and verifies the bytes supplied by the host on selection.

## Prompt presets

The optional `agentic-gateway/presets` export reads a pinned metadata index. Its `list()` operation reads zero prompt bodies. `select(idOrAlias, readBody)` reads a single content-addressed text body, checks its SHA-256, and returns the text and metadata. The host handles explicit submission.

Edit shared presets in [catalog/PROMPT-PRESETS.md](catalog/PROMPT-PRESETS.md). Run `npm ci`, `npm run presets:build`, then `npm test`. Commit the authored Markdown and its generated index, pin and body files together. The source revision in the index is the Git blob ID of the Markdown. Consumers pin a gateway commit. The OS compatibility export retains its existing path and refreshes from a gateway commit.

## Optional provider connectors

Import `agentic-gateway/connectors/hyperframes` for standalone declarative HTML. Pass the source and a browser document to `importHyperframesHtml` to get inspected HTML, composition identity, dimensions, duration in milliseconds and ordered clip intervals. The host applies clip visibility at each seek. The authored HTML remains the editable source.

Use `agentic-gateway/connectors/moomoo-coverage` with the packaged catalog and public field register for offline discovery. `publicRoutes(catalog)` keeps the documented REST, MCP and Push spellings and their source digests. `coverageRelations(catalog, routes)` looks up tools and references in both directions. `httpFieldInventory(register, catalog)` exposes individual field records, and `namingDictionaries(catalog)` resolves the published dictionary links. The consumer supplies its own admission and evidence when displaying a route.

Use `agentic-gateway/connectors/moomoo-market-rest` for documented market reads. `marketRestRoutes` includes the nine ARK routes; `describeMoomooArk(tool)` exposes their field types and bounded inputs, while `buildMoomooMarketRequest` and `projectMoomooMarketResponse` validate requests and project saved response text. These functions do not send requests or own credentials, rights, quota, or retention; the host owns those decisions.

Import `agentic-gateway/connectors/moomoo` to project a one-symbol OpenD snapshot. `replayMoomooSnapshot(symbol, response)` labels local evidence as replay. `bindMoomooSnapshot(client, grant)` accepts an authenticated quote client and an explicit one-read entitlement with a zero USD cost and expiry. The host supplies that evidence and selects the online read. The optional Python bridge uses the operator’s local OpenD and separately installed SDK.

[Qualified features, losses and verification](qualification/provider-handoff.md)

### Saved securities history

For a saved securities history page, import `buildMoomooSecuritiesHistoryRequest` and `projectMoomooSecuritiesHistoryResponse` from `agentic-gateway/connectors/moomoo-securities-history`. Supply `account_orders_history` or `account_fills_history`, the original request selectors including the exact decimal account ID and trading market, and the response text to the projection. It returns exact amounts, microsecond timestamps and the next opaque page flag. Each call reads one page locally. The account comes from the request path. Provider pages omit a stream cursor and normally omit an account ID. Order windows select by creation time, so reconciliation also needs a baseline for orders already working when a connection drops. Fill windows select by update time.

For the orders already working at disconnect, use `buildMoomooOpenOrdersRequest` and `projectMoomooOpenOrdersResponse` from the same module. Follow each returned `next_page_flag` until `completed`. Pass the selected `{acc_id, trd_market}` and saved `{request: {method, path}, wire}` exchanges to `replayMoomooOpenOrdersBaseline` in request order. It returns `working_orders` and `terminal_orders` only after it verifies the entire page chain. For one file at a time, create a listing with `createMoomooOpenOrdersBaseline`, call `append` with each saved exchange and call `result` after completion. A rejected page can be retried. Unknown statuses remain visible on individual pages and prevent classifying a baseline. A completed listing describes the captured pages. The stream still needs independent account and continuity evidence. [Open orders](https://open.moomoo.com/api/trading/order/get-open-orders) · [Order statuses](https://open.moomoo.com/api/trading/naming-dictionary#order-status)

For a sequence of saved history pages, call `createMoomooSecuritiesHistoryPages(tool, {acc_id, trd_market})`, then `append({request, wire})` for each original GET and response. Each result contains that page’s records, its position in the saved files, and whether the first saved request already had a continuation flag. A rejected page leaves the reader ready to retry. The returned window uses exact Unix microseconds. When both time selectors default to the provider’s clock, its absolute bounds are unknown.

### Offline provider discovery

`discoverProviderProfiles(hostFacts)` from `agentic-gateway/provider-profiles` loads metadata only. The optional gateway module registers both manifests with the existing resolver. Each entry returns its input, output, features, losses and per-route requirements. The caller supplies only facts it can establish. For example, a Trading process can declare `snapshot-replay` and `opend-reader` without checking a port or reading credentials.

`createResolver(entries).discover(hostFacts)` also assesses any registered manifest with per-route requirements. `available` means the supplied facts satisfy those requirements. Native invocation still applies the host's binding, cost and grant checks. Existing `discover()` callers retain their original response shape. The manifest revision is the connector’s Git blob ID, and its schema digest covers the functional profile and its route requirements. Consumers pin the complete gateway package.

## Import and export

Applications can import individual transfer modules in a browser or Node host. Each module works offline. Importing one loads no provider connectors.

- `agentic-gateway/transfer/copied-page` stages HTML or plain text supplied with a source URL. Create one store per workspace with `createPageCaptureStore({maxBytes})`. Pass the result of a user-initiated `readCopiedPage()` or a paste to `store.stage(url, html, text)`, then call `store.consume(requestUrl)` once. The host converts the returned source content for display.
- `agentic-gateway/transfer/browser-files` supplies file picker, write and Blob download functions. Host renderers can supply any file type, including documents, images and 3D scenes. For imports, `importWithFallback` dispatches the selected source to a primary host handler. The host declares which results it accepts and which errors permit fallback.
- `agentic-gateway/transfer/record-export` exposes `recordFormats`, `serializeRecordView` and `downloadRecordView`. Supply ordered columns and rows, and optionally a transposed orientation. CSV protects spreadsheet formula cells. JSON retains column order, duplicate labels and scalar types. Markdown escapes table syntax. The caller chooses the records its view permits exporting.

The optional `agentic-gateway/connectors/openai-audio` export transcribes an uploaded file and requests WAV speech from a locally operated OpenAI-compatible server. Supply its loopback `/v1` base URL and installed model ID. Requests run on explicit invocation, accept an abort signal and time out after 30 seconds. The adapter requires no API key and follows the dedicated file transcription and speech contracts. [Audio API guide](https://developers.openai.com/api/docs/guides/audio)
