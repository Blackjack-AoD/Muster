import { expect, it } from 'vitest';

it('gives a test file with no comment the node environment', () => {
  expect(typeof document).toBe('undefined');
});
