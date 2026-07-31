import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 조건부 클래스 + Tailwind 충돌 해소.
 * `cn('p-2', condition && 'p-4')` 처럼 쓰면 뒤쪽 p-4 가 이깁니다.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
