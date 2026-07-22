import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS 데코레이터 메타데이터(emitDecoratorMetadata)는 esbuild가 지원하지
// 않아서, 테스트 트랜스파일러를 SWC로 교체한다.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 15000 },
  plugins: [
    swc.vite({ jsc: { transform: { decoratorMetadata: true }, target: "es2022" } }),
  ],
});
