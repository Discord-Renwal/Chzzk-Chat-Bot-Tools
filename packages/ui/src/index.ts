/**
 * 공용 디자인 시스템.
 *
 * 사용자 웹(apps/web)과 내부 관리자 콘솔(apps/backoffice)이 같은 부품을 씁니다.
 * 두 앱이 각자 버튼을 만들면 처음엔 비슷하다가 반드시 어긋나고, 어긋난 뒤에는
 * 어느 쪽이 맞는지 아무도 모릅니다.
 *
 * 색과 간격은 여기서 하드코딩하지 않고 CSS 변수(`--surface-*`, `--brand-*`)를
 * 봅니다. 두 앱이 서로 다른 테마를 쓰면서도 같은 컴포넌트를 공유할 수 있는 이유입니다.
 */

export { cn } from './cn';

export { Button } from './components/Button';
export { Card, CardTitle, Badge, EmptyState } from './components/Card';
export { ConfirmDialog } from './components/ConfirmDialog';
export { Field, Input, Textarea, CheckChip } from './components/Field';
export { Select } from './components/Select';
export { Switch } from './components/Switch';
