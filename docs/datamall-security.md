# Security

Store the account key in ignored `.dev.vars` locally and Wrangler secrets in
production. Never copy credentials from the mirror. AccountKey goes only to the
fixed DataMall API endpoint, never to object downloads. Do not log caught fetch
errors: they can embed signed URLs. This Worker logs fixed failure records only.

The archive R2 bucket stays private. The separate opt-in GTFS public bucket
contains only original GTFS blobs, attribution and publication capture records;
notification state remains private. The crawler exposes no snapshot download endpoint. Download destinations are allowlisted,
redirects blocked and response sizes/timeouts bounded. Configure observability
retention deliberately; R2 storage and capture logging have ongoing costs.
