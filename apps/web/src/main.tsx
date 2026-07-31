import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Providers } from './app/providers';
import './index.css';

/**
 * 백엔드 없이 화면만 보고 싶을 때:
 *
 *   VITE_MOCK_API=1 pnpm dev:web
 *
 * `import.meta.env.DEV` 안에 두어 프로덕션 번들에는 들어가지 않습니다.
 */
if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === '1') {
  const { installDevMock } = await import('./shared/api/devMock');
  installDevMock();
}

const root = document.getElementById('root');
if (!root) throw new Error('#root 엘리먼트를 찾을 수 없습니다.');

createRoot(root).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>
);
