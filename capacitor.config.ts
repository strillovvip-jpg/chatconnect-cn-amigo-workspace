import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.chatconnect.cn",
  appName: "ChatConnect",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    AmigoFaceSwap: {},
  },
};

export default config;
