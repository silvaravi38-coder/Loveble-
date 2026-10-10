const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryDelay(response, attempt) {
  if (response.status === 429) {
    const value = response.headers?.get('retry-after');
    const seconds = value === null || value === undefined ? NaN : Number(value);
    const waitMs = Number.isFinite(seconds)
      ? seconds * 1000
      : value ? Math.max(0, Date.parse(value) - Date.now()) : 500;
    return waitMs <= 1500 ? Math.max(0, waitMs) : null;
  }
  return attempt === 0 ? 250 : 700;
}

export async function sendWithRetry(url, init, send = fetch, options = {}) {
  const { attempts = 3, timeoutMs = 8000, pause = sleep } = options;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const request = timeoutMs
        ? { ...init, signal: AbortSignal.timeout(timeoutMs) }
        : init;
      const response = await send(url, request);
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transient || attempt === attempts - 1) return response;
      const delay = retryDelay(response, attempt);
      if (delay === null) return response;
      await pause(delay);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await pause(attempt === 0 ? 250 : 700);
    }
  }
}
