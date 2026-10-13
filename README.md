# MRTDown Data Crawler

Cloudflare Worker with two acquisition pipelines:

- Evidence: official X accounts, Mastodon RSS and rail-related news → GitHub repository dispatch to `mrtdown-data`, every five minutes.
- DataMall: original GTFS schedule ZIP and realtime protobuf files → private R2 snapshots. Collection is disabled by default.

The former standalone `mrtdown-datamall-collector` implementation now lives in `src/datamall/`. No separate collector Worker is needed.

## Setup and checks

```sh
npm ci
npm run typegen
npm run check
npm run build
npm run build:production
npm run dev
```

Use Node 26. Existing source behavior remains in `src/evidence/index.ts`; `src/index.ts` routes scheduled invocations and wraps both pipelines with Sentry.
The lint command covers the migrated pipeline, entry points and changed configuration; legacy source formatting is outside this integration's scope.

## Configuration

Use ignored `.dev.vars` locally and Worker secrets in production:

- `TWITTER_BEARER_TOKEN`: official-account X API access.
- `GITHUB_ACCESS_TOKEN`: repository dispatch access to `foldaway/mrtdown-data`.
- `SENTRY_DSN`: existing monitoring configuration.
- `LTA_DATAMALL_ACCOUNT_KEY`: DataMall API access, required only when collection is enabled.

Create the private R2 bucket `mrtdown-datamall-snapshots` manually. Both default and production Wrangler environments bind it as `SNAPSHOTS`.
Set the DataMall secret on the crawler Worker; secrets on a deleted collector Worker do not transfer automatically.

```sh
npx wrangler secret put LTA_DATAMALL_ACCOUNT_KEY --env production
```

Set `COLLECTION_ENABLED` to `"true"` in the environment you deploy, then regenerate types and run checks.
Deploy production deliberately with `npx wrangler deploy --env production`.
No command above provisions a bucket or deploys automatically.

## Polling

| Pipeline | Cron (UTC) |
| --- | --- |
| Existing evidence | `0,5,10,15,20,25,30,35,40,45,50,55 * * * *` |
| DataMall schedule | `0 20 * * *` (04:00 Singapore) |
| DataMall alerts and trip updates | `*/2 * * * *` |

These are polling choices, not provider publication guarantees. One master trigger (`* * * * *`) selects due jobs using the scheduled UTC instant. Pipelines run independently and aggregate failures; only one account cron slot is used. The table lists logical job cadences, not separate registered triggers.
`npm run dev:invoke` invokes evidence. To test DataMall locally, pass the matching cron to Wrangler's `/__scheduled` URL. Local R2 is simulated; enabling collection still makes real upstream calls.

## Snapshot handoff and cutover

See [DataMall architecture](docs/datamall-architecture.md), [reliability and retention](docs/datamall-reliability.md), [security](docs/datamall-security.md) and [references](docs/datamall-references.md).
`mrtdown-data` still owns offline validation, canonical mappings and generated schedule publication. No automatic snapshot delivery is implemented.

If a standalone collector was deployed, disable its collection/cron before enabling the crawler pipeline. Keep its R2 bucket and captures; using the same bucket preserves existing keys and provenance. Deleting the GitHub repo alone does not remove a deployed Worker.

## Public GTFS handoff

A separate `mrtdown-public-snapshots` R2 Standard bucket is bound as `GTFS_PUBLIC`.
Attach a production custom domain such as `sources.mrtdown.org` manually.
Publication and GitHub notifications are opt-in, currently disabled in both
environments. Keep the original `SNAPSHOTS` bucket private.

Set `GTFS_PUBLICATION_ENABLED` to `"true"` in production to publish only known
LTA GTFS files, content-addressed capture JSON and `/index.html` attribution.
After the receiver workflow is on `mrtdown-data`'s default branch and its
`GTFS_SNAPSHOT_BASE_URL` repository variable names the active HTTPS domain,
enable `GTFS_NOTIFICATION_ENABLED`. This reuses `GITHUB_ACCESS_TOKEN` to dispatch
`gtfs_capture` with a schedule capture key. Alerts/trip updates are published
but do not trigger canonical ingestion.

Notification markers and pending retries stay private. On each enabled DataMall
poll, up to 20 pending schedule hashes are retried. Repeated bytes share one
public receipt and successful notification marker. At-least-once notifications
may cause repeat inspections after a crash; there are no canonical writes.
Neither domain attachment nor resource creation nor deployment is automated.
