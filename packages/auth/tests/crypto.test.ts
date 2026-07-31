import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  decryptSecret,
  encryptSecret,
  generateToken,
  hashToken,
  toEncryptionKey,
} from '../src/crypto.js';

/**
 * 토큰 암호화.
 *
 * 여기가 뚫리면 모든 고객의 방송 계정이 함께 뚫립니다. 그래서 "동작한다" 만이
 * 아니라 **틀렸을 때 실패하는지**를 함께 확인합니다 — 조용히 엉뚱한 값을
 * 돌려주는 것이 가장 위험한 실패 방식입니다.
 */

const KEY = randomBytes(32);

describe('toEncryptionKey', () => {
  it('base64 32바이트를 받는다', () => {
    const key = toEncryptionKey(randomBytes(32).toString('base64'));
    expect(key).toHaveLength(32);
  });

  it('길이가 다르면 거부한다', () => {
    expect(() => toEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32바이트/);
  });

  it('base64 가 아니면 거부한다', () => {
    // Buffer.from 은 잘못된 base64 를 조용히 잘라내므로 길이 검사에 걸립니다.
    expect(() => toEncryptionKey('not-a-key')).toThrow(/32바이트/);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('넣은 값을 그대로 돌려준다', () => {
    const plaintext = 'refresh_token_abcdef0123456789';
    expect(decryptSecret(encryptSecret(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it('한글과 이모지도 손상 없이 왕복한다', () => {
    const plaintext = '치지직 봇 토큰 🤖 값';
    expect(decryptSecret(encryptSecret(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it('같은 값을 두 번 암호화하면 결과가 다르다 — IV 가 매번 새로 만들어지므로', () => {
    const a = encryptSecret('same', KEY);
    const b = encryptSecret('same', KEY);

    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('버전 접두사를 붙인다 — 나중에 키를 교체할 때 구분해야 합니다', () => {
    expect(encryptSecret('x', KEY).startsWith('v1.')).toBe(true);
  });

  it('다른 키로는 복호화되지 않는다', () => {
    const encoded = encryptSecret('secret', KEY);
    expect(() => decryptSecret(encoded, randomBytes(32))).toThrow(DecryptionError);
  });

  it('암호문을 한 글자라도 고치면 실패한다 — GCM 인증 태그가 잡습니다', () => {
    const encoded = encryptSecret('secret', KEY);
    const parts = encoded.split('.');
    // 마지막 조각(암호문)의 첫 글자를 바꿉니다.
    const data = parts[3]!;
    parts[3] = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);

    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(DecryptionError);
  });

  it('형식이 깨진 값은 형식 오류로 거부한다', () => {
    expect(() => decryptSecret('garbage', KEY)).toThrow(/형식/);
    expect(() => decryptSecret('v2.a.b.c', KEY)).toThrow(/형식/);
  });
});

describe('hashToken / generateToken', () => {
  it('같은 토큰은 같은 해시가 된다', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('다른 토큰은 다른 해시가 된다', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('해시에서 원문을 유추할 수 없도록 길이가 고정된다', () => {
    expect(hashToken('a')).toHaveLength(hashToken('a'.repeat(1000)).length);
  });

  it('생성한 토큰은 매번 다르고 충분히 길다', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
    // 32바이트 → base64url 43자
    expect(generateToken()).toHaveLength(43);
  });
});
