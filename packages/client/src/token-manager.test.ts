import { describe, it, expect, vi } from "vitest";

import { createTokenManager, SessionExpiredError } from "./token-manager";
import { createApiClient } from "./api-client";

describe("single-flight 재발급", () => {
  it("동시 refresh 5건이 실제 재발급 1회로 합쳐지고, 전부 같은 토큰을 받는다", async () => {
    let resolveRefresh!: (token: string) => void;
    const requestNewToken = vi.fn(
      () => new Promise<string>((resolve) => (resolveRefresh = resolve)),
    );
    const manager = createTokenManager({ requestNewToken });

    const results = Promise.all(Array.from({ length: 5 }, () => manager.refresh()));
    expect(manager.isRefreshing()).toBe(true);

    resolveRefresh("token-A");
    expect(await results).toEqual(Array(5).fill("token-A"));
    expect(requestNewToken).toHaveBeenCalledTimes(1);
  });

  it("재발급 완료 후의 refresh는 새 요청을 보낸다 (promise 재사용 아님)", async () => {
    const requestNewToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");
    const manager = createTokenManager({ requestNewToken });

    await expect(manager.refresh()).resolves.toBe("token-1");
    await expect(manager.refresh()).resolves.toBe("token-2");
    expect(requestNewToken).toHaveBeenCalledTimes(2);
  });

  it("재발급 실패 후에도 다음 refresh가 다시 시도된다 (실패한 promise가 남지 않음)", async () => {
    const requestNewToken = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce("recovered");
    const manager = createTokenManager({ requestNewToken });

    await expect(manager.refresh()).rejects.toThrow("network down");
    expect(manager.isRefreshing()).toBe(false);
    await expect(manager.refresh()).resolves.toBe("recovered");
  });
});

describe("세션 폐기 정책 — 인증 거부일 때만", () => {
  it("SessionExpiredError면 토큰을 비우고 onSessionExpired를 호출한다", async () => {
    const onSessionExpired = vi.fn();
    const manager = createTokenManager({
      requestNewToken: () => Promise.reject(new SessionExpiredError()),
      onSessionExpired,
    });
    manager.setToken("stale");

    await expect(manager.refresh()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(manager.getToken()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("네트워크 오류에는 세션을 유지한다 (onSessionExpired 미호출)", async () => {
    const onSessionExpired = vi.fn();
    const manager = createTokenManager({
      requestNewToken: () => Promise.reject(new TypeError("Failed to fetch")),
      onSessionExpired,
    });
    manager.setToken("still-valid-refresh-side");

    await expect(manager.refresh()).rejects.toThrow("Failed to fetch");
    expect(manager.getToken()).toBe("still-valid-refresh-side");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe("api 클라이언트 — 401 재시도 정책", () => {
  const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const unauthorized = () => new Response(null, { status: 401 });

  it("401을 받으면 재발급 후 정확히 1회 재시도한다", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(okResponse());
    const manager = createTokenManager({ requestNewToken: () => Promise.resolve("fresh") });
    const api = createApiClient({ baseUrl: "http://test", tokenManager: manager, fetchFn });

    const res = await api.get("/me");

    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const retryHeaders = new Headers(fetchFn.mock.calls[1]![1]!.headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh");
  });

  it("재시도 후에도 401이면 그대로 반환한다 (무한 루프 방지)", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(unauthorized());
    const manager = createTokenManager({ requestNewToken: () => Promise.resolve("fresh") });
    const api = createApiClient({ baseUrl: "http://test", tokenManager: manager, fetchFn });

    const res = await api.get("/me");

    expect(res.status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(2); // 원요청 1 + 재시도 1, 그 이상 없음
  });
});
