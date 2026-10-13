import { poll } from '../datamall/poll';
import type { Env } from '../env';
import { crawlEvidence } from '../evidence';

export const jobNames = ['evidence', 'realtime', 'schedule'] as const;
export type JobName = (typeof jobNames)[number];

export async function runJob(job: JobName, env: Env) {
  if (job === 'evidence') await crawlEvidence(env);
  else await poll(job, env);
}
