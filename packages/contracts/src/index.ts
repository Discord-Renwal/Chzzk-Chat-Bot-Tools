/**
 * 서버와 프런트가 **함께 쓰는** 계약.
 *
 * 여기 있는 zod 스키마 하나로 서버 검증과 프런트 폼 검증을 동시에 만듭니다.
 * 규칙(글자 수, 허용값, 범위)이 양쪽에서 어긋날 수 없다는 게 이 패키지의 존재
 * 이유이므로, 어느 한쪽에만 필요한 타입은 여기 두지 마세요.
 */

export * from './bot-config.js';
export * from './identity.js';
export * from './billing.js';
export * from './plans.js';
export * from './bot-runtime.js';
export * from './system-variables.js';
export * from './chzzk-console.js';
export * from './http.js';
export * from './admin.js';
