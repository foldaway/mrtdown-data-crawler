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

Create two Tigris buckets through Fly/Tigris, keeping the archive private and
making only the snapshot bucket public. The prepared names are
`mrtdown-datamall-snapshots` and `mrtdown-public-snapshots`; if a name is unavailable,
update the corresponding `*_S3_BUCKET` variable before deployment. No buckets
have been created by this migration.

Each bucket has its **own** access key ID and secret. Import the private pair as
`SNAPSHOTS_S3_ACCESS_KEY_ID` / `SNAPSHOTS_S3_SECRET_ACCESS_KEY` and the public pair as
`GTFS_PUBLIC_S3_ACCESS_KEY_ID` / `GTFS_PUBLIC_S3_SECRET_ACCESS_KEY`. The runtime
constructs separate S3 clients; it never uses shared `AWS_ACCESS_KEY_ID` defaults
or falls back to the other bucket's credentials. Both endpoints default to
`https://t3.storage.dev`, with region `auto`, and can be configured independently.

`fly storage create` may automatically set generic `AWS_*` secrets when run in an
app context. Creating a second bucket can replace those generic values. Save each
credential pair when created and map it to the distinct names above; those
provider-generated generic names are deliberately unused by this application.
Private credentials need list/get/head/put/delete for archive and notification
state; public credentials need head/get/put for publication. Keep each scoped to
its own bucket.
[Fly's Tigris guide](https://fly.io/docs/tigris/) documents bucket creation,
private/public visibility, per-bucket credentials and the S3 endpoint.

The adapter preserves all object keys, capture records, content types and
conditional receipt creation. Existing Worker secrets cannot be read back;
retrieve producer keys from your original secret store.

Install these **Fly runtime secrets**, using `flyctl secrets import -a
mrtdown-data-crawler` from a protected local file or password-manager output:

| Secret | Purpose |
| --- | --- |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Verify QStash requests and rotation |
| `SNAPSHOTS_S3_ACCESS_KEY_ID`, `SNAPSHOTS_S3_SECRET_ACCESS_KEY` | Private Tigris bucket only |
| `GTFS_PUBLIC_S3_ACCESS_KEY_ID`, `GTFS_PUBLIC_S3_SECRET_ACCESS_KEY` | Public Tigris bucket only |
| `GITHUB_ACCESS_TOKEN` | Existing `mrtdown-data` dispatch authorization |
| `TWITTER_BEARER_TOKEN` | Existing X acquisition |
| `LTA_DATAMALL_ACCOUNT_KEY` | Existing DataMall acquisition |
| `SENTRY_DSN` | Optional error reporting |

QStash provisioning credentials belong in GitHub, not in the runtime. Public
configuration (independent S3 endpoints/regions/buckets, root URL and collection flags) is in the Fly
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

## 3. Copy existing data and prepare the public domain

Inspect the two existing R2 buckets. If populated, copy every key to the matching
Tigris bucket using an S3-compatible copy tool with separate named source and
destination credentials (for example, two rclone remotes per bucket pair).
Preserve `blobs/`, `captures/`, `notifications/pending/`, `notifications/sent/`
and `index.html`, plus object content types. Do not expose the private archive
or delete source objects. Compare key counts and verify sample blob SHA-256 and
capture byte lengths; preserve original capture JSON unchanged. Retain the R2
buckets through the rollback window. If both are empty, there is nothing to copy.

Register `sources.mrtdown.org` as the public Tigris bucket's custom domain. Test
copied objects through its direct public bucket URL first. Before changing DNS,
stop the old crawler cron and perform a final copy of any intervening writes.
Disconnect the domain from the R2 bucket and apply the CNAME target provided by
Tigris, then verify HTTPS, `index.html`, capture JSON and matching blobs at the
original `sources.mrtdown.org` URLs. Keep the receiver's
`GTFS_SNAPSHOT_BASE_URL=https://sources.mrtdown.org`; no downstream code change is
needed if the origin and paths stay the same.

[Fly's public bucket/custom domain instructions](https://fly.io/docs/tigris/)
describe registration and DNS. Domain migration is an operator action, not
something the local branch has performed. Never move notification state into
the public bucket.

## 4. Cut over one producer at a time

1. Remove the **old crawler cron** in Cloudflare; retain the Worker for rollback.
   Do not delete its secrets or either original R2 bucket. Removing one slot alone may
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

## 5. Rollback

Pause the three crawler schedules in QStash and wait for in-flight deliveries to
finish (or cancel pending retries). Setting `CRAWLER_SCHEDULES_ENABLED=false`
only skips future provisioning; it **does not pause existing schedules**.
Deploy with `CRAWLER_ENABLED=false` to reject signed work with 503. Restore the
old Worker cron only after Fly stops producing. The account's Free cron limit
may prevent restoration until another slot is freed. Before returning to the old R2-backed Worker, copy new Tigris objects back into
the matching R2 buckets (including private notification state), verify them,
and restore `sources.mrtdown.org` to R2. Do not resume the old producer until the
storage and public origin are ready. Object keys and downstream contracts remain
compatible, but objects written only to Tigris are not automatically present in R2.

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
