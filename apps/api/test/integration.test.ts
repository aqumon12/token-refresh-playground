/**
 * 통합 테스트 — 목(mock) 없이 진짜 NestJS 서버를 띄워서 검증한다.
 *
 * 핵심 시나리오: 액세스 토큰이 만료된 상태에서 동시 요청 5개를 쏘면,
 * 전부 401을 맞고 재발급을 원하게 되지만 — single-flight 토큰 매니저가
 * 이를 한 번의 재발급으로 합치는지를 "서버가 받은 재발급 호출 횟수"로 증명한다.
 */
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createApiClient,
  createTokenManager,
  SessionExpiredError,
} from "@playground/client";

import { AppModule } from "../src/app.module";

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0); // 임의 포트
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
});

afterAll(async () => {
  await app.close();
});

async function loginAndBuildClient() {
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttlMs: 1 }), // 1ms — 사실상 즉시 만료되는 액세스 토큰
  });
  const { accessToken, refreshToken } = (await loginRes.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  const sessionExpiredCalls: number[] = [];
  const manager = createTokenManager({
    requestNewToken: async () => {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.status === 401) throw new SessionExpiredError();
      if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
      const data = (await res.json()) as { accessToken: string };
      return data.accessToken;
    },
    onSessionExpired: () => sessionExpiredCalls.push(Date.now()),
  });
  manager.setToken(accessToken);

  const api = createApiClient({ baseUrl, tokenManager: manager });
  return { api, manager, refreshToken, sessionExpiredCalls };
}

async function getRefreshCount(): Promise<number> {
  const res = await fetch(`${baseUrl}/debug/refresh-count`);
  const data = (await res.json()) as { count: number };
  return data.count;
}

describe("만료 토큰 + 동시 요청 (진짜 서버 상대)", () => {
  it("동시 요청 5개가 전부 성공하고, 서버가 받은 재발급 호출은 1회다", async () => {
    const { api } = await loginAndBuildClient();
    const before = await getRefreshCount();

    await new Promise((r) => setTimeout(r, 10)); // 액세스 토큰 만료 대기

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => api.get("/me")),
    );

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await getRefreshCount()) - before).toBe(1); // ← single-flight의 증명
  });

  it("리프레시 토큰이 폐기되면 SessionExpiredError로 수렴하고 onSessionExpired는 1회만 호출된다", async () => {
    const { api, refreshToken, sessionExpiredCalls } = await loginAndBuildClient();

    await fetch(`${baseUrl}/debug/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    await new Promise((r) => setTimeout(r, 10));

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => api.get("/me")),
    );

    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(SessionExpiredError);
      }
    }
    expect(sessionExpiredCalls).toHaveLength(1);
  });
});
