/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORCE_DEVICE_CONTEXT?: "browser" | "standalone";
  readonly VITE_FORCE_DEVICE_ID?: string;
  readonly VITE_TEST_LOGIN_CODE?: string;
  readonly VITE_TEST_LOGIN_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
