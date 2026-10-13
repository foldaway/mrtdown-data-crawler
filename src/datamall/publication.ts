import type { Capture } from './snapshots/store';

const licence =
  'https://datamall.lta.gov.sg/content/datamall/en/SingaporeOpenDataLicence.html';
const sources = {
  schedule: 'GTFSScheduleTrain',
  service_alerts: 'GTFSRealTimeTrainServiceAlerts',
  trip_updates: 'GTFSRealtimeTrainTripUpdates',
} as const;
const notice = `<!doctype html><html lang="en"><meta charset="utf-8"><title>MRTDown GTFS snapshots</title><h1>MRTDown GTFS snapshots</h1><p>Original LTA DataMall GTFS Schedule (Train), GTFS Realtime (Train Service Alerts) and GTFS Realtime (Train Trip Updates) snapshots. Each capture record identifies its access date, source endpoint and SHA-256.</p><p>Contains information from LTA DataMall made available under the <a href="${licence}">Singapore Open Data Licence version 1.0</a>. Files are historical snapshots, not a live service. MRTDown is independent and is not endorsed by LTA.</p></html>`;

export async function publishCapture(
  capture: Capture,
  archive: R2Bucket,
  publicBucket: R2Bucket,
): Promise<string> {
  const kind = capture.feed_kind as keyof typeof sources;
  const endpoint = sources[kind];
  if (
    !endpoint ||
    capture.source !==
      `https://datamall2.mytransport.sg/ltaodataservice/${endpoint}`
  ) {
    throw new Error('Only known LTA GTFS datasets may be published');
  }
  const extension = kind === 'schedule' ? 'zip' : 'pb';
  if (
    !/^[a-f0-9]{64}$/.test(capture.sha256) ||
    capture.archive_ref !== `blobs/${kind}/${capture.sha256}.${extension}`
  ) {
    throw new Error('Unexpected GTFS archive identity');
  }
  const captureKey = `captures/${kind}/${capture.sha256}.json`;
  if (!(await publicBucket.head(capture.archive_ref))) {
    const blob = await archive.get(capture.archive_ref);
    if (!blob) throw new Error('Original snapshot is missing');
    await publicBucket.put(capture.archive_ref, blob.body, {
      httpMetadata: {
        contentType:
          kind === 'schedule' ? 'application/zip' : 'application/octet-stream',
      },
    });
  }
  if (!(await publicBucket.head(captureKey))) {
    const published = {
      ...capture,
      rights_status: 'redistribution_permitted',
      licence_reference: licence,
      attribution: `Contains information from ${endpoint} accessed on ${capture.retrieved_at} from LTA DataMall, under the Singapore Open Data Licence version 1.0 (${licence}).`,
    };
    await publicBucket.put(captureKey, JSON.stringify(published), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
  }
  // Conspicuous human-readable attribution, separate from immutable machine records.
  await publicBucket.put('index.html', notice, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  if (kind === 'schedule') {
    const sentKey = `notifications/sent/${capture.sha256}.json`;
    if (!(await archive.head(sentKey))) {
      await archive.put(
        `notifications/pending/${capture.sha256}.json`,
        JSON.stringify({ capture_key: captureKey }),
      );
    }
  }
  return captureKey;
}

export async function flushScheduleNotifications(
  archive: R2Bucket,
  githubToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const pending = await archive.list({
    prefix: 'notifications/pending/',
    limit: 20,
  });
  let failed = false;
  for (const object of pending.objects) {
    const hash = object.key
      .slice('notifications/pending/'.length)
      .replace(/\.json$/, '');
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new Error('Invalid notification key');
    const sentKey = `notifications/sent/${hash}.json`;
    if (await archive.head(sentKey)) {
      await archive.delete(object.key);
      continue;
    }
    try {
      const response = await fetcher(
        'https://api.github.com/repos/foldaway/mrtdown-data/dispatches',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${githubToken}`,
            'User-Agent': 'mrtdown-data-crawler/1.0',
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({
            event_type: 'gtfs_capture',
            client_payload: { capture_key: `captures/schedule/${hash}.json` },
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        },
      );
      await response.body?.cancel();
      if (!response.ok) throw new Error('GitHub notification failed');
      // At-least-once delivery: a crash after dispatch can repeat an inspection safely.
      await archive.put(
        sentKey,
        JSON.stringify({ capture_key: `captures/schedule/${hash}.json` }),
      );
      await archive.delete(object.key);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('One or more schedule notifications failed');
}
