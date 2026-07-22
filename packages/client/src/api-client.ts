/**
 * 401 → 재발급 → "정확히 1회" 재시도하는 fetch 래퍼
 *
 * 재시도를 1회로 제한하는 이유: 재발급 직후의 요청이 또 401이면
 * 그건 토큰 문제가 아니라 권한/서버 문제다. 무제한 재시도는
 * "만료 토큰 재사용 → 401 → 재발급 → 또 401 → ..." 무한 루프의 씨앗이 된다.
 */
import type { TokenManager } from "./token-manager";

export interface ApiClientOptions {
  baseUrl: string;
  tokenManager: TokenManager;
  fetchFn?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions) {
  const { baseUrl, tokenManager, fetchFn = fetch } = options;

  async function request(path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
    const token = tokenManager.getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetchFn(`${baseUrl}${path}`, { ...init, headers });

    if (response.status === 401 && !isRetry) {
      await tokenManager.refresh(); // 동시 401들은 여기서 한 번의 재발급으로 합류한다
      return request(path, init, true);
    }
    return response;
  }

  return {
    get: (path: string) => request(path),
    post: (path: string, body?: unknown) =>
      request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}
