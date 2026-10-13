export const MASTER_CRON = '* * * * *';
export const EVIDENCE_CRON = '0,5,10,15,20,25,30,35,40,45,50,55 * * * *';

// Use the scheduled instant, not execution time: delivery may be delayed.
export function dueJobs(scheduledTime: number) {
  const time = new Date(scheduledTime);
  if (!Number.isFinite(time.getTime()))
    throw new Error('Invalid scheduled time');
  const minute = time.getUTCMinutes();
  return {
    evidence: minute % 5 === 0,
    realtime: minute % 2 === 0,
    schedule: time.getUTCHours() === 20 && minute === 0,
  };
}
