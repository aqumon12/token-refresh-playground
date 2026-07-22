import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/**
 * 데모용 인메모리 토큰 저장소.
 *
 * - 액세스 토큰: `만료시각.uuid` 형태의 불투명 문자열 (기본 TTL 1초 — 만료를
 *   쉽게 재현하기 위해 짧게 잡음)
 * - 리프레시 토큰: 발급 목록을 Set으로 보관, revoke 시 제거
 * - refreshCallCount: single-flight 검증용 — 클라이언트가 재발급을 몇 번
 *   호출했는지 서버 입장에서 센다.
 */
@Injectable()
export class TokenService {
  private readonly validRefreshTokens = new Set<string>();
  private readonly validAccessTokens = new Set<string>();
  refreshCallCount = 0;

  private issueAccessToken(ttlMs: number): string {
    const token = `${Date.now() + ttlMs}.${randomUUID()}`;
    this.validAccessTokens.add(token);
    return token;
  }

  login(ttlMs = 1_000) {
    const refreshToken = randomUUID();
    this.validRefreshTokens.add(refreshToken);
    return { accessToken: this.issueAccessToken(ttlMs), refreshToken };
  }

  /** 재발급 — 일부러 150ms 지연을 줘서 동시 요청 경쟁을 재현하기 쉽게 한다 */
  async refresh(refreshToken: string, ttlMs = 1_000): Promise<string> {
    this.refreshCallCount += 1;
    await new Promise((r) => setTimeout(r, 150));

    if (!this.validRefreshTokens.has(refreshToken)) {
      throw new UnauthorizedException("refresh token expired");
    }
    return this.issueAccessToken(ttlMs);
  }

  verifyAccess(token: string | undefined): boolean {
    if (!token || !this.validAccessTokens.has(token)) return false;
    const expiresAt = Number(token.split(".")[0]);
    return Date.now() < expiresAt;
  }

  revokeRefreshToken(refreshToken: string) {
    this.validRefreshTokens.delete(refreshToken);
  }
}
