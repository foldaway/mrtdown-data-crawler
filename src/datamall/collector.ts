import type { Dataset } from './datasets/types';
import { type Capture, type Storage, archiveSnapshot } from './snapshots/store';
import { datamallBase, downloadDataset } from './transport/client';

export interface Dependencies {
  fetch: typeof fetch;
  now: () => Date;
  uuid: () => string;
  sleep: (ms: number) => Promise<void>;
}

const defaults: Dependencies = {
  fetch: globalThis.fetch,
  now: () => new Date(),
  uuid: () => crypto.randomUUID(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function collect(
  dataset: Dataset,
  accountKey: string,
  storage: Storage,
  options: { maxBytes?: number; dependencies?: Partial<Dependencies> } = {},
): Promise<Capture> {
  const dependencies = { ...defaults, ...options.dependencies };
  const bytes = await downloadDataset({
    endpoint: dataset.endpoint,
    accountKey,
    downloadHosts: dataset.downloadHosts,
    maxBytes: options.maxBytes ?? dataset.maxBytes,
    dependencies,
  });
  dataset.validate(bytes);
  return archiveSnapshot(
    {
      kind: dataset.kind,
      extension: dataset.extension,
      source: datamallBase + dataset.endpoint,
    },
    bytes,
    storage,
    dependencies,
  );
}
