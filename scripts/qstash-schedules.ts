import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { required, rootUrl } from '../src/runtime/config';

export function managedSchedules(origin: string) {
  const root = rootUrl(origin);
  return [
    { job: 'evidence', cron: '*/5 * * * *' },
    { job: 'realtime', cron: '*/5 * * * *' },
    { job: 'schedule', cron: '0 20 * * *' },
  ].map(({ job, cron }) => ({
    id: `mrtdown-crawler-production-${job}`,
    destination: `${root}/internal/jobs/${job}`,
    cron,
  }));
}

export function scheduleRequest(
  schedule: ReturnType<typeof managedSchedules>[number],
  token: string,
  baseUrl: string,
) {
  const base = new URL(baseUrl);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error('QSTASH_URL must be HTTPS without credentials');
  }
  return {
    url: `${base.href.replace(/\/$/, '')}/v2/schedules/${schedule.destination}`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Upstash-Cron': schedule.cron,
        'Upstash-Schedule-Id': schedule.id,
        'Upstash-Retries': '3',
        'Upstash-Timeout': '600s',
        'Upstash-Flow-Control-Key': schedule.id,
        'Upstash-Flow-Control-Value': 'parallelism=1',
      },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    },
  };
}

export async function syncSchedules(
  origin: string,
  token: string,
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  for (const schedule of managedSchedules(origin)) {
    const { url, init } = scheduleRequest(schedule, token, baseUrl);
    const response = await fetcher(url, init);
    await response.body?.cancel();
    if (!response.ok)
      throw new Error(
        `Schedule sync failed: ${schedule.id} (${response.status})`,
      );
    console.log(`Synced ${schedule.id}`);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const origin = required(process.env, 'CRAWLER_ROOT_URL');
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(managedSchedules(origin), null, 2));
  } else {
    await syncSchedules(
      origin,
      required(process.env, 'QSTASH_TOKEN'),
      required(process.env, 'QSTASH_URL'),
    );
  }
}
