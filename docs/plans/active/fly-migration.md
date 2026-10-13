# Crawler migration to Fly

Preserve evidence acquisition, the five-minute realtime cadence, daily schedule
capture at 20:00 UTC, private R2 keys, public receipts and GitHub dispatch contracts.
Reference: the site's completed Fly migration and CI-owned QStash provisioning.

1. Introduce a small storage interface and R2 S3 adapter with contract tests.
2. Replace Worker bindings and scheduled events with Node configuration,
   signature-verified HTTP jobs, safe error reporting and graceful shutdown.
3. Package for Fly with scale-to-zero, add CI deployment and idempotent QStash
   provisioning, and document secrets, verification and rollback.
4. Provision only after implementation checks. Verify Fly before retiring the old
   cron and disable Cloudflare Builds before merging runtime removal. Activate
   collection only after the old producer is stopped to avoid duplicate dispatch.

Use focused commits. No storage relocation, new database, or always-on process.
Production cutover requires Fly access, an app deploy token, QStash keys/token,
R2 S3 credentials scoped to the two existing buckets, and existing producer secrets.

## Implementation status

Prepared locally on `codex/migrate-crawler-to-fly` in focused commits.
The operator requested code and setup instructions only: no app, credentials,
schedules, deployment or production cutover were provisioned.

Validation: type checking, lint and 54 deterministic tests; Node bundle; QStash
credential-free dry run; Fly config validation; production Docker image build.
Container smoke checks: health 200, unsigned job 401, signed disabled job 503.
Remaining rollout instructions: [Fly setup](../../fly-setup.md).
