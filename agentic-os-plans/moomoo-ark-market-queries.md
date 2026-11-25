---
doc_type: PRD-TAD-ADR-MVP-GTM
---
# Moomoo ARK market-query readers

## Product

Add deterministic, read-only Gateway request and response contracts for the nine ARK REST routes documented in the checked-in Moomoo source catalog. This is the next bounded market-query slice of the larger outstanding Moomoo inventory; it does not claim full coverage.

Routes: aggregate ARK active transactions; filtered active-transaction query; fund holdings; fund holdings by industry; fund return series and summary; net-turnover ranks; per-symbol daily holding series; per-symbol holding table; and per-symbol dynamic summary.

## Contract and ownership

- Derive route paths, allowed query values, bounds, response fields, pagination, and types only from the local ARK source documents and the current Gateway connector conventions.
- Export one descriptor per operation with inputs, fields, row shape, and pagination limits so consumers can build views without re-declaring the Moomoo contract.
- Validate symbol and fund identities, field types, date strings, bounded pages, and cursor progress. Preserve provider decimal values losslessly as decimal strings; do not convert money, shares, weights, prices, or rates through binary floating point.
- Keep credentials, transport, rights, quota admission, retention, and live-call policy with the consuming host. Every route remains read-only under the host's existing `quote:read` admission.
- Use the existing Gateway REST facade and wire parser. Do not add a second generic REST client, live provider call, credential, entitlement inference, order action, or duplicated route implementation.

## Decision

Isolate ARK-specific schemas in `connectors/moomoo-ark.mjs`; expose them through the existing market REST facade and package entry. Do not expand the research-reader module with an unrelated schema family.

## MVP and validation

Use only local source documents and synthetic wire fixtures. Cover request allowlists, path/query encoding, every response shape, pagination completion and cursor progress, identity mismatch, malformed fields, provider errors, and exact decimal preservation. Run the focused Gateway checks, package build if available, and protected Integration Gate. Make no live Moomoo request.

Keep changed files at or below 13, production additions below 30 KB, every authored file below 600 lines, and each shipped chunk below 500 kB. Preserve unrelated worktree and canonical-checkout files.

## Source records

The nine source documents live under `docs_/websites/open.moomoo.com/api/quote/ark/` in the local documentation mirror. The Gateway documentation catalog already records these exact source paths, route strings, and SHA-256 values; verify those records before relying on them.
