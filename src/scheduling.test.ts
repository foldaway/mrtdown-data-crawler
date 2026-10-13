import { describe, expect, it } from 'vitest';
import { dueJobs } from './scheduling';

describe('one-trigger scheduling', () => {
  it.each([
    ['2026-10-12T19:01:00Z', false, false, false],
    ['2026-10-12T19:02:00Z', false, true, false],
    ['2026-10-12T19:05:00Z', true, false, false],
    ['2026-10-12T19:10:00Z', true, true, false],
    ['2026-10-12T20:00:00Z', true, true, true],
    ['2026-10-12T20:01:00Z', false, false, false],
  ])('selects jobs at %s', (instant, evidence, realtime, schedule) => {
    expect(dueJobs(Date.parse(instant))).toEqual({
      evidence,
      realtime,
      schedule,
    });
  });
});
