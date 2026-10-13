# mrtdown-data-crawler

MRTDown evidence and DataMall acquisition on Node.js, packaged for Fly.io and
scheduled through Upstash QStash. Tigris provides the private archive and public
snapshot store with independent bucket credentials; `mrtdown-data` receives the existing GitHub dispatch contracts.

The Fly migration is prepared locally. Provisioning and production cutover are
separate operator steps; see [the setup guide](docs/fly-setup.md).

## Jobs

| Signed endpoint | Cadence (UTC) | Purpose |
| --- | --- | --- |
| `POST /internal/jobs/evidence` | Every five minutes | Official X accounts, Mastodon RSS and rail-related news → `ingest` dispatch |
| `POST /internal/jobs/realtime` | Every five minutes | LTA train service alerts and trip updates → Tigris |
| `POST /internal/jobs/schedule` | `0 20 * * *` (04:00 Singapore daily) | LTA train schedule ZIP → Tigris |

QStash signs each request. The service verifies the raw body and configured
public destination URL, waits for collection, then returns success or a retryable
failure. Job failures do not replay unrelated jobs. `GET /healthz` checks the
process without contacting upstream services. Schedule provisioning owns three
crawler-specific IDs and does not change the site's schedules.

## Local development

Node 24 or newer is required.

```sh
npm ci
cp .env.example .env
npm run dev
curl http://localhost:3000/healthz
npm run check
npm run build
```

The example configuration disables collection. Signing is always enforced;
there is no public unauthenticated job route or development bypass. Use QStash
with an HTTPS development tunnel and set `CRAWLER_ROOT_URL` to that exact origin
for real local job checks. Use separate test S3 buckets and disable publication
and notifications when exercising real providers.

```sh
CRAWLER_ROOT_URL=https://mrtdown-data-crawler.fly.dev npm run qstash:schedules:sync -- --dry-run
```

The dry run requires no credentials and makes no network calls. `npm start`
runs the built service. Docker builds use Node 24, production dependencies and
an unprivileged user.

## Module map

- `src/runtime`: configuration, signed request handling, job selection.
- `src/storage`: object-store contract and S3 adapter.
- `src/evidence`: source collection and existing GitHub ingest dispatch.
- `src/sources`: RSS, X and bounded article enrichment.
- `src/datamall`: linked-file acquisition, immutable snapshots, publication and notification retries.
- `scripts/qstash-schedules.ts`: idempotent CI-owned schedule provisioning.

See [DataMall architecture](docs/datamall-architecture.md),
[reliability](docs/datamall-reliability.md), and
[the public handoff](docs/datamall-architecture.md#public-publication-and-notification).
