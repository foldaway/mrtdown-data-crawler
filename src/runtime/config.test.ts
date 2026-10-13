import { expect, it } from 'vitest';
import { createEnvironment, rootUrl } from './config';

it.each([
  'http://example.test',
  'https://secret@example.test',
  'https://example.test/path',
  'https://example.test/?q=secret',
])('rejects an unsafe destination origin %s', (value) => {
  expect(() => rootUrl(value)).toThrow();
});
it('does not fall back to ambient AWS credentials', () => {
  expect(() =>
    createEnvironment({ R2_ACCOUNT_ID: 'synthetic-account' }),
  ).toThrow('R2_ACCESS_KEY_ID');
});
