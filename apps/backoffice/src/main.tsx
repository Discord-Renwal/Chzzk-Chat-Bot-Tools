import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import { App } from './app/App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root 엘리먼트를 찾을 수 없습니다.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster
        position="bottom-center"
        theme="system"
        toastOptions={{
          style: {
            background: 'var(--surface-panel)',
            border: '1px solid var(--surface-border)',
            color: 'var(--surface-text)',
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>
);
