/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_CONVEX_SITE_URL?: string;
  readonly VITE_FORCE_DEVICE_CONTEXT?: "browser" | "standalone";
  readonly VITE_FORCE_DEVICE_ID?: string;
  readonly VITE_TEST_LOGIN_CODE?: string;
  readonly VITE_TEST_LOGIN_NAME?: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_BUILD_NUMBER: string;
  readonly VITE_GIT_COMMIT: string;
  readonly VITE_BUNDLE_DIAGNOSTIC: "0" | "1";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
