import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function gitCommit() {
  const fromCi = process.env.CI_COMMIT?.trim();
  if (fromCi) return fromCi.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "0000000";
  }
}

function projectSetting(name: string, fallback: string) {
  try {
    const project = readFileSync(
      path.join(projectRoot, "ios/App/App.xcodeproj/project.pbxproj"),
      "utf8",
    );
    return project.match(new RegExp(`${name} = ([^;]+);`))?.[1]?.trim() ?? fallback;
  } catch {
    return fallback;
  }
}

const appVersion = process.env.VITE_APP_VERSION?.trim()
  || projectSetting("MARKETING_VERSION", "1.0");
const appBuildNumber = process.env.VITE_APP_BUILD_NUMBER?.trim()
  || process.env.CI_BUILD_NUMBER?.trim()
  || projectSetting("CURRENT_PROJECT_VERSION", "0");
const appGitCommit = process.env.VITE_GIT_COMMIT?.trim() || gitCommit();
const bundleDiagnostic = process.env.VITE_BUNDLE_DIAGNOSTIC === "1";

// https://vite.dev/config/
export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    "import.meta.env.VITE_APP_BUILD_NUMBER": JSON.stringify(appBuildNumber),
    "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(appGitCommit),
    "import.meta.env.VITE_BUNDLE_DIAGNOSTIC": JSON.stringify(
      bundleDiagnostic ? "1" : "0",
    ),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@/convex": path.resolve(projectRoot, "./convex"),
      "@": path.resolve(projectRoot, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("livekit")) return "livekit";
        },
      },
    },
  },
});
