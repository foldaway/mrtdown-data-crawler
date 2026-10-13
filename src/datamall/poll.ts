import { collect } from './collector';
import { gtfsDatasets } from './datasets/gtfs';
import type { Dataset } from './datasets/types';

export async function poll(
  controller: Pick<ScheduledController, 'cron'>,
  env: Env,
) {
  if (String(env.COLLECTION_ENABLED) !== 'true') {
    return;
  }
  if (!env.LTA_DATAMALL_ACCOUNT_KEY) {
    console.error('Collection failed: missing account key');
    throw new Error('Collection failed: missing account key');
  }

  let datasets: Dataset[];
  if (controller.cron === env.SCHEDULE_CRON) {
    datasets = [gtfsDatasets.schedule];
  } else if (controller.cron === env.REALTIME_CRON) {
    datasets = [gtfsDatasets.service_alerts, gtfsDatasets.trip_updates];
  } else {
    console.error('Collection skipped: unrecognized cron');
    throw new Error('Collection skipped: unrecognized cron');
  }

  // Independent feeds continue after another feed fails. Only sanitized fields are logged.
  const outcomes = await Promise.all(
    datasets.map(async (dataset) => {
      try {
        const capture = await collect(
          dataset,
          env.LTA_DATAMALL_ACCOUNT_KEY,
          env.SNAPSHOTS,
        );
        console.log(
          JSON.stringify({
            event: 'capture_success',
            feed_kind: dataset.kind,
            capture_id: capture.capture_id,
            sha256: capture.sha256,
            byte_length: capture.byte_length,
          }),
        );
        return true;
      } catch {
        console.error(
          JSON.stringify({ event: 'capture_failure', feed_kind: dataset.kind }),
        );
        return false;
      }
    }),
  );
  if (outcomes.some((succeeded) => !succeeded)) {
    throw new Error('One or more DataMall captures failed');
  }
}
