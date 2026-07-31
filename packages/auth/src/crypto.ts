import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 남의 치지직 토큰을 보관하기 위한 암호화.
 *
 * DB 에 평문으로 두면 백업 파일 하나, 덤프 한 번으로 모든 고객의 방송 계정을
 * 조작할 수 있게 됩니다. AES-256-GCM 을 쓰는 이유는 기밀성과 **무결성**을 함께
 * 주기 때문입니다 — 누군가 암호문을 조작하면 복호화가 실패하지, 엉뚱한 값이
 * 조용히 나오지 않습니다.
 *
 * 저장 형식: `v1.<iv>.<authTag>.<ciphertext>` (각 조각은 base64url)
 * 버전 접두사를 둔 이유는 나중에 키를 교체하거나 알고리즘을 바꿀 때, 기존
 * 데이터를 읽으면서 점진적으로 옮기기 위해서입니다.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecryptionError';
  }
}

/** base64 로 인코딩된 32바이트 키를 Buffer 로. 형식이 틀리면 즉시 실패합니다. */
export function toEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY 는 base64 로 인코딩한 32바이트여야 합니다 (지금 ${key.length}바이트). ` +
        '`openssl rand -base64 32` 로 만드세요.'
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(encoded: string, key: Buffer): string {
  const [version, ivPart, tagPart, dataPart] = encoded.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new DecryptionError('암호문 형식이 올바르지 않습니다.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (cause) {
    // 키가 바뀌었거나 암호문이 손상된 경우입니다. 어느 쪽인지 구분해 알려줄 수는
    // 없지만, 원인을 감추지 않도록 cause 는 그대로 달아 둡니다.
    throw new DecryptionError(
      '복호화에 실패했습니다. TOKEN_ENCRYPTION_KEY 가 저장 당시와 다른지 확인하세요.',
      { cause }
    );
  }
}

/**
 * 세션 토큰과 API 키를 DB 에 넣기 전에 해시합니다.
 *
 * 비밀번호가 아니라 **충분히 긴 랜덤 값**이라 bcrypt 같은 느린 해시가 필요
 * 없습니다. 사전 공격의 대상이 아니고, 매 요청마다 검증하므로 오히려 빨라야
 * 합니다. 중요한 건 DB 가 새도 원문을 복원할 수 없다는 것뿐입니다.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** 세션 토큰·API 키 원문을 만듭니다. 256비트면 추측이 불가능합니다. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
