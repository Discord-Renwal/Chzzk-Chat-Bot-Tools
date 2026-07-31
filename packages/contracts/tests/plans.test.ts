import { describe, expect, it } from 'vitest';
import { planLimits } from '../src/billing.js';
import {
  DEFAULT_PLAN_CODE,
  PLAN_CATALOG,
  TRIAL_PLAN_CODE,
  findPlanDefinition,
} from '../src/plans.js';

/**
 * 요금제 카탈로그의 불변식.
 *
 * 플랜 정의는 코드에 있고 시드가 DB 로 밀어 넣습니다. 여기서 깨진 값이 통과하면
 * 운영 DB 에 그대로 들어가고, 그때는 마이그레이션으로 고쳐야 합니다.
 */
describe('PLAN_CATALOG', () => {
  it('모든 플랜의 한도가 스키마를 만족한다', () => {
    for (const plan of PLAN_CATALOG) {
      expect(() => planLimits.parse(plan.limits)).not.toThrow();
    }
  });

  it('플랜 코드가 중복되지 않는다', () => {
    const codes = PLAN_CATALOG.map((plan) => plan.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('가격이 오름차순으로 정렬돼 있다 — 요금제 페이지가 이 순서를 그대로 씁니다', () => {
    const publicPlans = PLAN_CATALOG.filter((plan) => plan.isPublic).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    for (let i = 1; i < publicPlans.length; i += 1) {
      expect(publicPlans[i]!.priceMonthly).toBeGreaterThan(publicPlans[i - 1]!.priceMonthly);
    }
  });

  it('상위 플랜의 한도가 하위 플랜보다 좁지 않다', () => {
    const ordered = [...PLAN_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder);

    for (let i = 1; i < ordered.length; i += 1) {
      const lower = ordered[i - 1]!.limits;
      const upper = ordered[i]!.limits;

      // null 은 무제한이므로 항상 더 넓습니다.
      const atLeast = (a: number | null, b: number | null) =>
        a === null ? true : b === null ? false : a >= b;

      expect(atLeast(upper.maxCommands, lower.maxCommands)).toBe(true);
      expect(atLeast(upper.maxAutoResponses, lower.maxAutoResponses)).toBe(true);
      expect(atLeast(upper.maxBannedWords, lower.maxBannedWords)).toBe(true);
      expect(upper.eventRetentionDays).toBeGreaterThanOrEqual(lower.eventRetentionDays);
    }
  });

  it('무료 플랜에서는 공개 API 를 쓸 수 없다', () => {
    const free = findPlanDefinition('FREE');
    expect(free?.limits.publicApiEnabled).toBe(false);
    expect(free?.limits.apiRateLimitPerMinute).toBe(0);
  });

  it('공개 API 를 켠 플랜은 호출 상한이 0보다 크다', () => {
    for (const plan of PLAN_CATALOG) {
      if (plan.limits.publicApiEnabled) {
        expect(plan.limits.apiRateLimitPerMinute).toBeGreaterThan(0);
      }
    }
  });

  it('기본 플랜과 체험 플랜이 카탈로그에 존재한다', () => {
    expect(findPlanDefinition(DEFAULT_PLAN_CODE)).toBeDefined();
    expect(findPlanDefinition(TRIAL_PLAN_CODE)).toBeDefined();
  });

  it('없는 코드는 undefined 를 돌려준다', () => {
    expect(findPlanDefinition('NOPE')).toBeUndefined();
  });
});
