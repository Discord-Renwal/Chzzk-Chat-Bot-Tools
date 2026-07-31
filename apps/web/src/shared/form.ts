import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * zod + react-hook-form 의 입력/출력 타입 차이를 한 곳에서 흡수합니다.
 *
 * `.default()` 가 붙은 필드는 zod 의 **입력** 타입에서 optional, **출력** 타입에서 required 입니다.
 * 그래서 `zodResolver(schema)` 는 Resolver<입력타입> 을 내놓는데, 폼에서 다루고 싶은 건
 * 모든 필드가 채워진 출력 타입입니다.
 *
 * 이 대시보드는 폼 기본값을 항상 서버에서 받은 **완성된 객체**로 채우므로 런타임에는 둘이 같습니다.
 * 그 사실을 단언으로 못 박아 두고, 대신 컴포넌트 쪽은 캐스팅 없이 깔끔하게 유지합니다.
 */
export function formResolver<TSchema extends z.ZodTypeAny>(
  schema: TSchema
): Resolver<z.output<TSchema>> {
  return zodResolver(schema);
}
