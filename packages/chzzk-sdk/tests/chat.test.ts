import { describe, expect, it } from 'vitest';
import { splitMessage, MAX_MESSAGE_LENGTH } from '../src/api/chat.js';

describe('splitMessage', () => {
  it('제한 이하 메시지는 그대로 둔다', () => {
    expect(splitMessage('안녕하세요')).toEqual(['안녕하세요']);
  });

  it('모든 조각이 제한을 넘지 않는다', () => {
    const long = '가'.repeat(250);
    const chunks = splitMessage(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('가능하면 공백 경계에서 끊는다', () => {
    const message = `${'a'.repeat(60)} ${'b'.repeat(60)}`;
    const [first] = splitMessage(message, 100);
    expect(first).toBe('a'.repeat(60));
  });

  it('공백이 없는 긴 토큰은 강제로 자른다', () => {
    const chunks = splitMessage('x'.repeat(30), 10);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length === 10)).toBe(true);
  });

  it('나눈 뒤 이어 붙이면 내용이 보존된다', () => {
    const message = '치지직 채팅 봇 테스트 메시지 '.repeat(10).trim();
    expect(splitMessage(message).join(' ')).toBe(message);
  });
});
