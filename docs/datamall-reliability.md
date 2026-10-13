# Reliability

Network/timeout failures and HTTP 429/5xx retry up to three attempts with bounded
250/500 ms backoff. Other HTTP errors fail immediately. A signed link or body
failure fails the poll; the next cron obtains a new link. Storage failures are
not retried in-process. Feed failures are isolated and produce only sanitized
success/failure logs. After all selected feeds finish, any failure causes a
sanitized scheduled-handler error so Cloudflare records the run as failed.
Configure Cloudflare log alerts operationally.

Write the blob first, then its immutable capture record. Only complete capture
records are successful acquisitions. Failed polls leave prior records intact.
Failure between writes can leave an unreferenced blob, never a promoted capture.
There is no mutable latest pointer: concurrent cron invocations may produce
multiple records for the same bytes, and racing writes to a hash key contain
identical content. Repeated captures are preserved, deduplicating only bytes.
No source-version or lifecycle ordering is inferred from acquisition time.

## Retention

No automatic deletion is enabled. Monitor R2 growth (two realtime feeds at a
five-minute cadence create about 576 capture records per day). Before adding a
lifecycle policy, agree retention and applicable licence requirements; retain
blobs used by reviewed downstream artifacts and all needed provenance. An
operator can identify unreferenced blobs by comparing blob keys against all
capture `archive_ref` values. Use a grace period longer than active acquisition
runs before deleting orphans, and coordinate cleanup with readers. Do not add a
blanket lifecycle rule that expires shared blobs independently of records.

Process health is not acquisition health. Logs include successful capture id,
hash and byte length; failures include feed kind only. No persistent error
status or live provider freshness guarantee is provided.
