import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 사용자 웹.
 *
 * 개발 중에는 Vite 개발 서버(5173)가 HMR 을 제공하고 `/api` 만 API 서버로
 * 프록시합니다. 프록시를 쓰는 이유는 세션 쿠키 때문입니다 — 다른 포트로 직접
 * 부르면 크로스 오리진이 되어 쿠키 설정이 까다로워지고, 배포 환경(같은 도메인)과
 * 동작이 달라집니다.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 화면 단위 분할은 라우터의 lazy() 가 해 줍니다. 여기서는 거의 바뀌지 않는
    // 라이브러리만 따로 떼어, 우리 코드를 배포해도 그 청크의 캐시가 살아 있게 합니다.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
});
