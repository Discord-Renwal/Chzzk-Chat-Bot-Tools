import { describe, expect, it } from 'vitest';
import { addMonth } from '../src/subscriptionService.js';

/**
 * 다음 결제일 계산.
 *
 * 달마다 날짜 수가 다르다는 사실이 결제에서는 실제 버그로 이어집니다. 1월 31일에
 * 결제한 사람의 다음 결제일이 3월 3일이 되면, 2월에는 청구가 없었던 셈이 됩니다.
 */
describe('addMonth', () => {
  it('보통은 같은 날짜의 다음 달', () => {
    expect(addMonth(new Date('2025-03-15T00:00:00Z')).getMonth()).toBe(3);
    expect(addMonth(new Date('2025-03-15T00:00:00Z')).getDate()).toBe(15);
  });

  it('1월 31일 → 2월 말일 (3월 3일로 새지 않는다)', () => {
    const next = addMonth(new Date(2025, 0, 31));
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it('윤년 2월도 올바르게 잡는다', () => {
    const next = addMonth(new Date(2024, 0, 31));
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it('12월에서 다음 해 1월로 넘어간다', () => {
    const next = addMonth(new Date(2025, 11, 10));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(0);
  });

  it('원본을 바꾸지 않는다', () => {
    const original = new Date(2025, 0, 15);
    const copy = new Date(original);
    addMonth(original);
    expect(original.getTime()).toBe(copy.getTime());
  });
});
