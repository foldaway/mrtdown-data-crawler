# Fly crawler setup and cutover

This guide prepares `mrtdown-data-crawler` as a separate Fly app in Singapore.
No resources were provisioned as part of the local migration. The design follows
`mrtdown-site`'s completed Fly migration, with a small Node HTTP service in place
of its full application framework.

## 1. Prepare the app and credentials

Sign in with `flyctl auth login`, create the `mrtdown-data-crawler` app in the
same organization as the site, and allocate its public networking. The checked-in
`fly.production.toml` assumes `https://mrtdown-data-crawler.fly.dev`; if the app
name differs, update the app name, root URL, CI destinations and dry-run check
together before deployment. Use `flyctl apps create` and `flyctl ips allocate-v6`
(and a shared IPv4 if needed by your setup). Do not use `fly launch` to overwrite
the prepared configuration.

Create a crawler-scoped Fly deploy token. In GitHub, create a `production`
environment and add `FLY_API_TOKEN`, `QSTASH_URL` and `QSTASH_TOKEN` as environment
secrets. Use the existing Upstash account; these credentials must belong to the
same QStash region as the signing keys below. Set repository variable
`CRAWLER_FLY_DEPLOY_ENABLED=true` only when the app is ready for CI deployment.

Create R2 S3 credentials granting Object Read & Write to **only** these existing
buckets:

- `mrtdown-datamall-snapshots` (private archive and notification state).
- `mrtdown-public-snapshots` (public snapshots on `sources.mrtdown.org`).

The S3 adapter preserves all existing keys, metadata and conditional receipt
creation. There is no bucket copy or domain change. It needs list/get/head/put
and delete access for the private pending notification queue.
[Cloudflare's S3 setup](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
explains credential creation. Existing Worker secrets cannot be read back;
retrieve them from your original secret store.

Install these **Fly runtime secrets**, using `flyctl secrets import -a
mrtdown-data-crawler` from a protected local file or password-manager output:

| Secret | Purpose |
| --- | --- |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Verify QStash requests and rotation |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Access the two R2 buckets |
| `GITHUB_ACCESS_TOKEN` | Existing `mrtdown-data` dispatch authorization |
| `TWITTER_BEARER_TOKEN` | Existing X acquisition |
| `LTA_DATAMALL_ACCOUNT_KEY` | Existing DataMall acquisition |
| `SENTRY_DSN` | Optional error reporting |

QStash provisioning credentials belong in GitHub, not in the runtime. Public
configuration (R2 account/buckets, root URL and collection flags) is in the Fly
config. `GIT_SHA` is supplied by CI for Sentry releases. The GitHub access token
needs the same repository-dispatch permission as before.

## 2. Deploy disabled through CI

Keep repository variables `CRAWLER_ENABLED` and `CRAWLER_SCHEDULES_ENABLED`
unset or `false`. The checked-in deployment gate keeps jobs disabled by default.

Before merging this migration, disable the crawler's **Cloudflare Workers Builds
integration**. Removing Wrangler from code does not disable its existing deploy
command. Leave the currently deployed Worker and its existing cron in place
until the replacement has been checked.

Push/review the migration and merge when ready. The GitHub workflow validates
source, tests, schedule configuration and the production Docker image before
calling Fly. The deployment uses `--ha=false`; keep one Machine and no local
persistent volume. Confirm `https://mrtdown-data-crawler.fly.dev/healthz` is 200.
Unsigned POST requests to the three job endpoints must return 401.

Fly is configured with `min_machines_running=0`, autostart and autostop.
Requests stay open until their jobs finish, so active work counts as load.
Five-minute traffic may keep the Machine warm; scale-to-zero does not guarantee
it stops between every run. QStash has a ten-minute request timeout and three
retries; Fly's proxy idle timeout is eleven minutes. SIGTERM stops accepting
requests and drains active ones, with a best-effort five-minute Fly shutdown
window. Interrupted work returns no success acknowledgement and can be retried.
[Fly configuration](https://fly.io/docs/reference/configuration/) documents these
runtime settings.

## 3. Cut over one producer at a time

1. Remove the **old crawler cron** in Cloudflare; retain the Worker for rollback.
   Do not delete its secrets or either R2 bucket. Removing one slot alone may
   still leave the account above the Free-plan limit; confirm the API accepted
   the removal. This migration does not remove unrelated account triggers.
2. Set repository variable `CRAWLER_ENABLED=true` and dispatch the GitHub
   deployment workflow. QStash schedules are still not provisioned automatically.
3. Send a signed test message through QStash to each job endpoint. Check evidence
   dispatch, realtime capture logs and the daily schedule path separately. Confirm
   public capture JSON and its matching blob can be downloaded from
   `sources.mrtdown.org`, and their hashes/lengths match.
4. Set `CRAWLER_SCHEDULES_ENABLED=true` and dispatch CI again. Only after a
   successful deployment will CI upsert the three deterministic schedules.
5. Inspect QStash deliveries, retries/DLQ and Fly logs across several intervals.
   Verify one schedule run at 04:00 Singapore; an immediate signed one-off message
   can test the same endpoint without changing its daily cadence.
6. Keep `GTFS_NOTIFICATION_ENABLED=false` until public artifacts and the receiving
   `mrtdown-data` workflow are verified. Then change that Fly configuration flag,
   review/commit it and deploy through CI. Verify a `gtfs_capture` dispatch and
   the receiver's report artifact before calling the handoff complete.

The managed IDs are `mrtdown-crawler-production-evidence`,
`mrtdown-crawler-production-realtime` and `mrtdown-crawler-production-schedule`.
The first two poll every five minutes, the third at 20:00 UTC. Flow control limits
each job to one delivery at a time; a process-local guard also rejects concurrent
manual requests for the same job. Different jobs can run independently.

There are 577 scheduled deliveries per day before retries (288 evidence, 288
realtime, one schedule). Check the **combined** QStash account usage, including
site jobs, against your plan. Schedule IDs are upserted, not accumulated; unrelated
schedules are never listed or deleted by provisioning.
[Upstash schedules](https://upstash.com/docs/qstash/api-reference/schedules/create-a-schedule)
and [request signing](https://upstash.com/docs/qstash/features/security) describe
these API contracts.

## 4. Rollback

Pause the three crawler schedules in QStash and wait for in-flight deliveries to
finish (or cancel pending retries). Setting `CRAWLER_SCHEDULES_ENABLED=false`
only skips future provisioning; it **does not pause existing schedules**.
Deploy with `CRAWLER_ENABLED=false` to reject signed work with 503. Restore the
old Worker cron only after Fly stops producing. The account's Free cron limit
may prevent restoration until another slot is freed. Storage and downstream
contracts remain compatible, so no data rollback is required.

QStash delivery and GitHub dispatch are at least once. A crash after dispatch can
repeat evidence or inspection; the existing downstream deduplication/immutable
receipt behavior remains important. Flow control is scheduling coordination,
not an exactly-once transaction or distributed lease. Avoid running multiple
producers or bypassing QStash with concurrent manual messages.

## Prepared validation

Run `npm run check`, `npm run build`, the schedule `--dry-run`,
`flyctl config validate --config fly.production.toml`, and `docker build`.
Exercise `/healthz` and unsigned-job rejection on the built container. Production
credentials, real provider acquisition, QStash delivery and Fly autostop/cold
starts must be checked during cutover; local tests cannot establish those.
