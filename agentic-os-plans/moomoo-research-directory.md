---
doc_type: PRD-TAD-ADR-MVP-GTM
---
# Moomoo research directory and rating-change readers

Integrate three documented read-only quote routes from the Moomoo OpenAPI source catalog:
- `GET /api/v1.0/quote/research/analyst-info`
- `GET /api/v1.0/quote/research/institution-info`
- `GET /api/v1.0/quote/research/rating-change`

Gateway owns validated request/response descriptors and local response projection. Use the existing `moomoo-research` contract and public market REST facade, preserve response field names, source numeric text, dates and page cursors, and fail closed on unknown fields, malformed pages or unsupported errors. Read-only local projection only: no transport, credentials, host rights, quota, retention, or live provider calls. Fixtures must be synthetic.

Follow the published Moomoo route schemas and the pinned catalog’s source hashes. Do not claim any other research route is mapped. Keep this Gateway slice within two tracked files, under 8 KB of added production source, under the repository's file/module limits, and preserve existing Gateway API names. Run the focused connector validation and the repository's required Integration Gate through its normal lane workflow.
