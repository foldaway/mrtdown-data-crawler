# Security

Store the account key in ignored `.env` locally and Fly secrets in
production. Never copy credentials from the mirror. AccountKey goes only to the
fixed DataMall API endpoint, never to object downloads. Do not log caught fetch
errors: they can embed signed URLs. DataMall logs fixed failure records only; Node runtime error reporting drops original upstream exceptions and Sentry breadcrumbs.

The archive R2 bucket stays private. The separate opt-in GTFS public bucket
contains only original GTFS blobs, attribution and publication capture records;
notification state remains private. The crawler exposes no snapshot download endpoint. Download destinations are allowlisted,
redirects blocked and response sizes/timeouts bounded. Configure observability
retention deliberately; R2 storage and capture logging have ongoing costs.

QStash job routes verify both signing keys, the raw body digest and the exact
configured destination. Never derive that destination from proxy headers.
There is no authentication bypass. Keep QStash signing keys in Fly and
provisioning tokens in GitHub; scope R2 S3 credentials to the two named buckets.
