/**
 * single-flight 토큰 매니저
 *
 * 문제: 액세스 토큰이 만료되는 순간 여러 요청이 동시에 401을 받으면,
 * 각 요청이 저마다 재발급을 호출해 서버에 불필요한 부하가 가고
 * (재발급 API가 토큰을 회전시키는 경우) 나중에 도착한 재발급이
 * 앞선 재발급을 무효화하는 경쟁 상태까지 생긴다.
 *
 * 해결: 진행 중인 재발급 Promise를 하나만 유지한다.
 * - 첫 요청만 실제 재발급을 실행하고, 나머지는 같은 Promise를 기다린다.
 * - 성공/실패와 무관하게 완료 후에는 반드시 비워서 다음 재발급이 막히지 않게 한다.
 *
 * 세션 폐기 정책: 서버가 인증을 거부한 경우(SessionExpiredError)에만
 * 세션을 정리한다. 네트워크 오류·5xx 같은 일시 장애에 로그아웃시키면
 * 사용자는 "가만히 있다가 튕긴" 경험을 하게 된다.
 */

/** 서버가 리프레시 토큰을 거부했음(= 재로그인 필요)을 나타내는 에러 */
export class SessionExpiredError extends Error {
  constructor(message = "세션이 만료되었습니다. 다시 로그인해주세요.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export interface TokenManagerOptions {
  /** 실제 재발급 요청. 새 액세스 토큰을 resolve하거나, 인증 거부 시 SessionExpiredError를 throw */
  requestNewToken: () => Promise<string>;
  /** 세션 만료가 확정됐을 때 1회 호출 (스토어 정리, 로그인 화면 이동 등) */
  onSessionExpired?: () => void;
}

export interface TokenManager {
  /** 현재 보관 중인 액세스 토큰 (없으면 null) */
  getToken(): string | null;
  /** 토큰 직접 주입 (로그인 직후 등) */
  setToken(token: string): void;
  /** 재발급 — 동시에 여러 번 불려도 실제 요청은 1회 */
  refresh(): Promise<string>;
  /** 재발급 진행 여부 */
  isRefreshing(): boolean;
}

export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const { requestNewToken, onSessionExpired } = options;

  let accessToken: string | null = null;
  let inflight: Promise<string> | null = null;

  async function executeRefresh(): Promise<string> {
    try {
      const token = await requestNewToken();
      accessToken = token;
      return token;
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        accessToken = null;
        onSessionExpired?.();
      }
      // 네트워크 오류 등은 세션을 건드리지 않고 그대로 올린다 — 재시도 여지를 남긴다.
      throw error;
    }
  }

  return {
    getToken: () => accessToken,
    setToken: (token) => {
      accessToken = token;
    },
    refresh() {
      if (inflight) return inflight;

      inflight = executeRefresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    isRefreshing: () => inflight !== null,
  };
}
