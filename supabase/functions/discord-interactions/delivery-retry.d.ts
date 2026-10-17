export function sendWithRetry(
  url: string,
  init: RequestInit,
  send?: typeof fetch,
  options?: {
    attempts?: number;
    timeoutMs?: number;
    pause?: (milliseconds: number) => Promise<void>;
  },
): Promise<Response>;
