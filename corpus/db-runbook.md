---
source_id: db-runbook
source_name: Database Operations Runbook
source_type: runbook
version: "2.1"
effective_date: "2025-11-10"
precedence: 3
---
# Database Operations Runbook

## Clearing lock contention
If you observe lock contention on the primary database, restart the primary instance to clear the stuck locks and restore throughput quickly.

## Backups
Database backups run nightly at 02:00 UTC.
