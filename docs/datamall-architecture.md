# Architecture

The crawler DataMall pipeline owns authenticated DataMall acquisition and private Tigris retention through the S3 API.
`mrtdown-data` owns offline inspection, reviewed mappings and generated schedules;
`mrtdown-site` consumes the generated artifact. The crawler dispatches public schedule receipts for offline inspection; no live
arrivals runtime is implemented here.

## Acquisition

For each discriminated feed (`schedule`, `service_alerts`, `trip_updates`), request
its documented DataMall endpoint with `AccountKey`, read the JSON
`value[0].link` (with legacy `Link` supported), and immediately download original bytes without that header.
The API guide defines `Link` and its 15-minute lifetime; the live GTFS API has been verified to return a `value` envelope with lowercase
`link` and `timestamp` fields. A missing/malformed envelope fails closed.

Only HTTPS downloads from the guide's
`dmprod-datasets.s3.ap-southeast-1.amazonaws.com` host are accepted. Redirects
are rejected. Every request has a 30-second timeout; link responses are bounded
to 64 KiB and files to 32 MiB. The fixed file bound can be changed in code after
measuring real schedule archives.

## Storage and handoff

- `blobs/<feed_kind>/<sha256>.zip|pb`: content-addressed original bytes.
- `captures/<feed_kind>/<retrieved_at>/<capture_id>.json`: successful acquisition
  metadata, written only after the blob is stored.

Capture schema version 1 includes source endpoint, feed kind, `retrieved_at`,
SHA-256, byte length, immutable `archive_ref` (a key within the private bucket),
LTA attribution, licence reference and an explicit pending rights review state.
Keys and temporary signed links never enter metadata or logs. Feed kind remains
explicit even when a realtime feed has zero entities.

This raw collector does not parse protobuf headers or timetable files.
`provider_timestamp` is null, meaning **not extracted**, not absent at source.
The offline inspector must extract provider timestamps from retained bytes
before interpreting source recency or ordering alerts. Schedule ZIP signature
checking is only a transport sanity check; nonempty realtime bodies are retained
without semantic validation. A valid zero-entity protobuf is retained; a
zero-byte HTTP download is rejected.

Public publication and notification retry behavior is described in
the public publication section below. The private archive stays private;
only allowlisted attributed GTFS captures are copied into the public bucket.

## Module ownership

| Module | Responsibility |
| --- | --- |
| `src/datamall/transport/http.ts` | Bounded requests, retry policy, redirect restrictions and bounded body reads |
| `src/datamall/transport/client.ts` | Authenticated **link-based** DataMall acquisition, temporary URL validation and credential-free file download |
| `src/datamall/datasets/types.ts` | Small descriptor for currently supported linked-file datasets |
| `src/datamall/datasets/gtfs.ts` | GTFS endpoint names, identity, allowed download hosts, size limits, extensions and transport sanity checks |
| `src/datamall/snapshots/store.ts` | SHA-256, original-byte deduplication, compatible provenance and blob-before-record persistence |
| `src/datamall/collector.ts` | Acquisition → dataset validation → snapshot storage |
| `src/datamall/poll.ts` | Feed selection, independent collection, sanitized logs and aggregate failure |
| `src/index.ts` | Hono Node adapter and sanitized Sentry reporting |

GTFS checks and extensions do not belong in the reusable DataMall client or
snapshot writer. The existing `feed_kind` JSON field remains unchanged; its
value comes from the dataset descriptor and need not identify a GTFS feed.
Tests remain alongside their responsibilities; `collector.test.ts` also retains
end-to-end mocked acquisition/persistence checks.

## Adding a dataset

For another documented **linked-file** DataMall dataset, add a descriptor in
`src/datamall/datasets/` with a unique stable kind, endpoint path, archive extension,
reviewed download-host allowlist, byte limit and dataset-specific validation.
Add mocked examples, then explicitly select it in `poll.ts` and configure its
cadence in the QStash provisioning script if needed. Update typed runtime configuration with configuration changes. Confirm attribution/rights before collection or publication.

Some DataMall endpoints return JSON records directly rather than a temporary
file link. Those need a separate acquisition adapter when implemented; the
linked-file descriptor is not a universal DataMall API framework. Reuse bounded
HTTP mechanics and snapshot persistence while keeping response parsing in the
adapter. Do not force JSON endpoints through `value[0].link` (with legacy `Link` supported) or put their parsing
inside GTFS code. No direct-JSON collector is implemented yet.

## Public publication and notification

`publication.ts` copies only known GTFS datasets into the separate `GTFS_PUBLIC`
bucket when explicitly enabled. It adds the actual Singapore Open Data Licence
link, access-date attribution and an independent historical-snapshot notice at
`/index.html`. An object hash identifies its public capture receipt. Conditional
receipt creation prevents a repeated acquisition from replacing original
provenance. The existing private capture schema remains unchanged.

Schedule notification uses GitHub `gtfs_capture` repository dispatch after
publication completes. A private pending/sent outbox is keyed by schedule hash;
failed notifications are retried, and crashes can produce safe duplicate
inspections. No full blobs, credentials or signed LTA links enter the dispatch.
Alerts/trip updates do not dispatch to canonical ingestion.
