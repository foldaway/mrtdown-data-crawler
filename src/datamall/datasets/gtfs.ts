import type { Dataset } from './types';

function validateNonemptyBody(bytes: ArrayBuffer) {
  if (bytes.byteLength === 0) {
    throw new Error('Empty download body');
  }
}

function validateScheduleArchive(bytes: ArrayBuffer) {
  validateNonemptyBody(bytes);
  const view = new Uint8Array(bytes);
  if (bytes.byteLength < 4 || view[0] !== 0x50 || view[1] !== 0x4b) {
    throw new Error('Schedule is not a ZIP archive');
  }
}

const common = {
  downloadHosts: ['dmprod-datasets.s3.ap-southeast-1.amazonaws.com'],
  maxBytes: 32 * 1024 * 1024,
};

export const gtfsDatasets = {
  schedule: {
    ...common,
    kind: 'schedule',
    endpoint: 'GTFSScheduleTrain',
    extension: 'zip',
    validate: validateScheduleArchive,
  },
  service_alerts: {
    ...common,
    kind: 'service_alerts',
    endpoint: 'GTFSRealTimeTrainServiceAlerts',
    extension: 'pb',
    validate: validateNonemptyBody,
  },
  trip_updates: {
    ...common,
    kind: 'trip_updates',
    endpoint: 'GTFSRealtimeTrainTripUpdates',
    extension: 'pb',
    validate: validateNonemptyBody,
  },
} satisfies Record<string, Dataset>;
