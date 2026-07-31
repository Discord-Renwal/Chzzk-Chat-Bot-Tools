import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 내부 관리자 콘솔.
 *
 * 사용자 웹(5173)과 **다른 포트**로 띄웁니다. 같은 앱 안에 관리자 화면을 두면
 * 일반 사용자에게도 그 코드가 배포되고, 라우팅 실수 하나가 곧바로 권한 사고가
 * 됩니다. 앱을 나누면 서버 권한 검사와 별개로 물리적인 경계가 하나 더 생깁니다.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
});
