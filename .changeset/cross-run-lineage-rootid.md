---
"@workflow/world": minor
"@workflow/core": minor
"@workflow/world-local": minor
"@workflow/world-postgres": minor
"@workflow/world-vercel": patch
---

Add cross-run lineage via reserved run attributes. `start()` records `$rootRunId` (and `$parentRunId`) on each run: a run started with no parent is its own root, and a run started from inside another run inherits the parent's `$rootRunId`, so a chain of any depth groups under one id. Adds an `attributes` filter to `ListWorkflowRunsParams` so a lineage is queryable (`list({ attributes: { $rootRunId } })`), and an `attributes` field on run creation.

The attributes filter is implemented for `world-local` and `world-postgres` (jsonb containment). `world-vercel` filtering executes server-side in the platform `/v2/runs` endpoint, which does not yet accept an attributes filter, so it throws rather than silently returning every run.
