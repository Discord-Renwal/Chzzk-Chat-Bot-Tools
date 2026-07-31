import type {
  BotInstanceState,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
} from '@chzzk-bot/contracts';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { ApiException } from './errors.js';

export interface CoreClientOptions {
  baseUrl: string;
  token: string;
  logger?: Logger;
  timeoutMs?: number;
}

/**
 * Core 워커 제어 API 클라이언트.
 *
 * API 서버는 봇을 직접 돌리지 않습니다. 두 프로세스를 나눈 이유는 수명이 다르기
 * 때문입니다 — API 는 배포할 때마다 재시작해도 되지만, Core 를 재시작하면 모든
 * 방송의 봇 세션이 끊깁니다. 섞어 두면 프런트 문구 하나 고치는 배포가 방송을
 * 끊습니다.
 *
 * Core 가 죽어 있어도 API 는 살아 있어야 합니다(설정 저장·결제는 계속 되어야
 * 하므로). 그래서 여기서 나는 오류는 전부 502 로 감싸 "봇이 응답하지 않는다" 로
 * 보이게 하고, 요청 전체를 실패시키지 않는 쪽은 호출자가 정합니다.
 */
export class CoreClient {
  private readonly log: Logger;
  private readonly timeoutMs: number;

  constructor(private readonly options: CoreClientOptions) {
    this.log = (options.logger ?? noopLogger).child('core-client');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Core 가 살아 있는지. 대시보드 상태 표시에 씁니다. */
  async health(): Promise<{ ok: boolean; bots: number } | null> {
    try {
      return await this.request<{ ok: boolean; bots: number }>('GET', '/health');
    } catch {
      return null;
    }
  }

  async state(tenantId: string): Promise<BotInstanceState | null> {
    try {
      return await this.request<BotInstanceState>('GET', `/internal/tenants/${tenantId}`);
    } catch {
      // 이 워커가 안 맡고 있을 뿐일 수 있습니다. 호출자는 DB 의 상태로 대신합니다.
      return null;
    }
  }

  async start(tenantId: string): Promise<boolean> {
    const result = await this.request<{ ok: boolean }>(
      'POST',
      `/internal/tenants/${tenantId}/start`
    );
    return result.ok;
  }

  async stop(tenantId: string): Promise<boolean> {
    const result = await this.request<{ ok: boolean }>(
      'POST',
      `/internal/tenants/${tenantId}/stop`
    );
    return result.ok;
  }

  async setJoined(tenantId: string, joined: boolean, by: string | null): Promise<void> {
    await this.request('POST', `/internal/tenants/${tenantId}/${joined ? 'join' : 'leave'}`, {
      by,
    });
  }

  /**
   * 설정이 바뀌었다고 알립니다.
   *
   * 실패해도 던지지 않습니다. Core 는 주기적으로도 설정을 다시 읽으므로, 이
   * 신호를 놓치면 반영이 몇 초 늦을 뿐입니다. 그 몇 초 때문에 "저장 실패" 를
   * 보여주면 사용자는 저장이 안 된 줄 알고 같은 작업을 반복합니다.
   */
  async notifyConfigChanged(tenantId: string): Promise<void> {
    try {
      await this.request('POST', `/internal/tenants/${tenantId}/reload`);
    } catch (error) {
      this.log.debug(`설정 반영 알림 실패 (${tenantId}) — 주기 새로고침으로 처리됩니다.`, error);
    }
  }

  async executeCommand(
    tenantId: string,
    request: ExecuteCommandRequest
  ): Promise<ExecuteCommandResponse> {
    return this.request<ExecuteCommandResponse>(
      'POST',
      `/internal/tenants/${tenantId}/execute`,
      request
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed: unknown = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const detail = parsed as { error?: string };
        throw ApiException.upstream(
          detail.error ?? `봇 서버가 ${response.status} 를 반환했습니다.`,
          response.status === 404 ? 404 : 502
        );
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw ApiException.upstream('봇 서버가 응답하지 않습니다.', 504);
      }
      throw ApiException.upstream('봇 서버에 연결하지 못했습니다.', 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
