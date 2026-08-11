import { describe, expect, it } from 'vitest';
import { managementPercent } from './eventReport';

describe('management report percentages', () => {
  it('calculates rounded percentages and keeps progress values valid', () => {
    expect(managementPercent(45, 60)).toBe(75);
    expect(managementPercent(1, 3)).toBe(33);
    expect(managementPercent(4, 0)).toBe(0);
    expect(managementPercent(-1, 10)).toBe(0);
    expect(managementPercent(12, 10)).toBe(100);
  });
});
