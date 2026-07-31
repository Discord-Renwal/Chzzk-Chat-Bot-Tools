export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const RANK: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export interface Logger {
  error(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  debug(msg: string, ...rest: unknown[]): void;
  child(scope: string): Logger;
}

export function createLogger(level: LogLevel = 'info', scope = 'chzzk'): Logger {
  const threshold = RANK[level];

  const emit =
    (at: Exclude<LogLevel, 'silent'>, sink: (...a: unknown[]) => void) =>
    (msg: string, ...rest: unknown[]) => {
      if (RANK[at] > threshold) return;
      sink(`${new Date().toISOString()} ${at.toUpperCase().padEnd(5)} [${scope}] ${msg}`, ...rest);
    };

  return {
    error: emit('error', console.error),
    warn: emit('warn', console.warn),
    info: emit('info', console.log),
    debug: emit('debug', console.log),
    child: (sub: string) => createLogger(level, `${scope}:${sub}`),
  };
}

export const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => noopLogger,
};
