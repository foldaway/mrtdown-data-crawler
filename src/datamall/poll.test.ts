import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { collect } from './collector';
import { poll } from './poll';

vi.mock('./collector', () => ({ collect: vi.fn() }));
const env = {
  COLLECTION_ENABLED: 'true',
  SCHEDULE_CRON: '0 20 * * *',
  REALTIME_CRON: '*/2 * * * *',
  LTA_DATAMALL_ACCOUNT_KEY: 'dummy',
  SNAPSHOTS: {},
} as unknown as Env;
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
describe('polling', () => {
  it('does not collect until explicitly enabled', async () => {
    await poll('schedule', { ...env, COLLECTION_ENABLED: 'false' });
    expect(collect).not.toHaveBeenCalled();
  });
  it('isolates realtime feed failures and sanitizes logs', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(collect)
      .mockRejectedValueOnce(new Error('signed-url-secret'))
      .mockResolvedValueOnce({
        capture_id: 'id',
        sha256: 'hash',
        byte_length: 5,
      } as Awaited<ReturnType<typeof collect>>);
    await expect(poll('realtime', env)).rejects.toThrow(
      'One or more DataMall captures failed',
    );
    expect(collect).toHaveBeenCalledTimes(2);
    expect(vi.mocked(collect).mock.calls.map((call) => call[0].kind)).toEqual([
      'service_alerts',
      'trip_updates',
    ]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(
      'signed-url-secret',
    );
  });
});
