import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from "@nestjs/common";

import { TokenService } from "./token.service";

@Controller()
export class AuthController {
  constructor(private readonly tokens: TokenService) {}

  /** 로그인 — 액세스(짧은 TTL) + 리프레시 토큰 발급 */
  @Post("auth/login")
  login(@Body() body: { ttlMs?: number }) {
    return this.tokens.login(body?.ttlMs);
  }

  /** 액세스 토큰 재발급 (150ms 인위 지연 — 동시성 재현용) */
  @Post("auth/refresh")
  async refresh(@Body() body: { refreshToken?: string }) {
    const accessToken = await this.tokens.refresh(body?.refreshToken ?? "");
    return { accessToken };
  }

  /** 보호 리소스 — Bearer 액세스 토큰 필요 */
  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!this.tokens.verifyAccess(token)) {
      throw new UnauthorizedException("access token invalid or expired");
    }
    return { user: "demo-user" };
  }

  /** single-flight 검증용 — 서버가 받은 재발급 호출 횟수 */
  @Get("debug/refresh-count")
  refreshCount() {
    return { count: this.tokens.refreshCallCount };
  }

  /** 세션 만료 시나리오용 — 리프레시 토큰 강제 폐기 */
  @Post("debug/revoke")
  revoke(@Body() body: { refreshToken?: string }) {
    this.tokens.revokeRefreshToken(body?.refreshToken ?? "");
    return { revoked: true };
  }
}
