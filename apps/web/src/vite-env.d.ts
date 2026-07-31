/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 1 이면 백엔드 대신 개발용 목을 씁니다 (`shared/api/devMock.ts`). */
  readonly VITE_MOCK_API?: string;
  /** 마이페이지에서 관리자 콘솔로 보내는 주소 */
  readonly VITE_BACKOFFICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
