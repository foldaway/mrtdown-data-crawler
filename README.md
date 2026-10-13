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

These are polling choices, not provider publication guarantees. Dedicated triggers isolate evidence and dataset failures; consolidation does not reduce cron slots automatically.
`npm run dev:invoke` invokes evidence. To test DataMall locally, pass the matching cron to Wrangler's `/__scheduled` URL. Local R2 is simulated; enabling collection still makes real upstream calls.

## Snapshot handoff and cutover

See [DataMall architecture](docs/datamall-architecture.md), [reliability and retention](docs/datamall-reliability.md), [security](docs/datamall-security.md) and [references](docs/datamall-references.md).
`mrtdown-data` still owns offline validation, canonical mappings and generated schedule publication. No automatic snapshot delivery is implemented.

If a standalone collector was deployed, disable its collection/cron before enabling the crawler pipeline. Keep its R2 bucket and captures; using the same bucket preserves existing keys and provenance. Deleting the GitHub repo alone does not remove a deployed Worker.
