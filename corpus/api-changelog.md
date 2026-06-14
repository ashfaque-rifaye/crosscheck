---
source_id: api-changelog
source_name: API Changelog (v2)
source_type: changelog
version: "v2"
effective_date: "2026-05-01"
precedence: 4
---
# API Changelog (v2)

## Rate limit change
Breaking change: the per-key rate limit is now 60 requests per second, reduced from the previous 100. Update clients to back off accordingly.

## Authentication change
Breaking change: authentication now uses the `Authorization: Bearer <key>` header. The legacy `X-Api-Key` header is no longer accepted.
