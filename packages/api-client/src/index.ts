import type { ApiError } from '@pos/dto-types';

/**
 * @pos/api-client — typed HTTP client for pos-system-server.
 *
 * Consumed by pos-system-client (Next.js) and pos-system-app (React Native).
 * Translates HTTP responses into typed results or thrown ApiErrors so TanStack
 * Query hooks can handle error state uniformly. Fase 2+ populates per-module methods.
 */

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiClientError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Token setter — Fase 2 wires JWT here. */
  getToken?: () => string | undefined;
}

export function createApiClient(options: ApiClientOptions) {
  const { baseUrl, getToken } = options;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const token = getToken?.();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const body = await res.json().catch(() => undefined);

    if (!res.ok) {
      throw new ApiClientError(res.status, (body ?? { code: 'INTERNAL_ERROR', message: res.statusText }) as ApiError);
    }
    return body as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, data: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
    put: <T>(path: string, data: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
    patch: <T>(path: string, data: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
