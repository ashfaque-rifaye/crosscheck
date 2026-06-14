---
source_id: architecture-doc
source_name: Platform Architecture Reference
source_type: architecture
version: "4.0"
effective_date: "2026-01-20"
precedence: 4
---
# Platform Architecture Reference

## Primary database failure handling
Never restart the primary database to resolve lock contention. Always fail over to a healthy replica and investigate afterward. Restarting the primary can cause data loss for in-flight transactions.

## Backups
Database backups run nightly at 02:00 UTC.

## Database engine
The primary datastore runs PostgreSQL 15.
