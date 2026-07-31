import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { TokenResponse } from '../api/types.js';
import type { TokenProvider } from '../core/http.js';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { refreshToken, type OAuthConfig } from './oauth.js';

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** epoch ms — 액세스 토큰 만료 시각 */
  expiresAt: number;
  scope?: string;
  /** 발급 당시 조회한 채널 ID (있으면 기록) */
  channelId?: string;
}

/** 만료 몇 ms 전부터 미리 갱신할지 — 기본 5분 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function toStoredToken(res: TokenResponse): StoredToken {
  const expiresIn = Number(res.expiresIn);
  const stored: StoredToken = {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    tokenType: res.tokenType || 'Bearer',
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 86_400) * 1000,
  };
  if (res.scope) stored.scope = res.scope;
  return stored;
}

/**
 * 토큰을 JSON 파일에 보관하면서 만료 전 자동 갱신하는 TokenProvider.
 *
 * 리프레시 토큰은 1회용이므로 갱신 결과를 즉시 디스크에 반영합니다.
 * 동시 요청이 여러 개 몰려도 갱신은 한 번만 일어나도록 진행 중인 Promise 를 공유합니다.
 */
export class FileTokenStore implements TokenProvider {
  private readonly filePath: string;
  private readonly log: Logger;
  private cache: StoredToken | undefined;
  private inflight: Promise<string> | undefined;

  constructor(
    private readonly config: OAuthConfig,
    options: { filePath?: string; logger?: Logger } = {}
  ) {
    this.filePath = resolve(options.filePath ?? '.tokens/chzzk.json');
    this.log = (options.logger ?? noopLogger).child('token');
  }

  get path(): string {
    return this.filePath;
  }

  async save(token: StoredToken): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // 저장 중 프로세스가 죽어 파일이 반쯤 쓰이는 일이 없도록 임시 파일에 쓰고 교체합니다.
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.filePath);
    this.cache = token;
    this.log.debug(`토큰을 ${this.filePath} 에 저장했습니다.`);
  }

  async load(): Promise<StoredToken | null> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as StoredToken;
      return this.cache;
    } catch {
      return null;
    }
  }

  async getAccessToken(): Promise<string> {
    const token = await this.load();
    if (!token) {
      throw new Error(
        `저장된 토큰이 없습니다 (${this.filePath}). \`pnpm login\` 을 먼저 실행하세요.`
      );
    }
    if (Date.now() < token.expiresAt - REFRESH_MARGIN_MS) {
      return token.accessToken;
    }
    this.log.info('액세스 토큰 만료가 임박해 미리 갱신합니다.');
    return this.refreshAccessToken();
  }

  async refreshAccessToken(): Promise<string> {
    // 이미 갱신이 진행 중이면 그 결과를 함께 기다립니다.
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<string> {
    const current = await this.load();
    if (!current) {
      throw new Error(`갱신할 리프레시 토큰이 없습니다 (${this.filePath}).`);
    }

    const res = await refreshToken(this.config, current.refreshToken);
    const next = toStoredToken(res);
    if (current.channelId) next.channelId = current.channelId;
    await this.save(next);

    this.log.info('액세스 토큰을 갱신했습니다.');
    return next.accessToken;
  }
}
