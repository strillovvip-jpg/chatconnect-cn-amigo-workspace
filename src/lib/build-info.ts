export const appBuildInfo = Object.freeze({
  version: import.meta.env.VITE_APP_VERSION || "1.0",
  buildNumber: import.meta.env.VITE_APP_BUILD_NUMBER || "0",
  gitCommit: import.meta.env.VITE_GIT_COMMIT || "0000000",
  diagnostic: import.meta.env.VITE_BUNDLE_DIAGNOSTIC === "1",
});
