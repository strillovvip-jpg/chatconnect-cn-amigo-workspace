import type { CapacitorConfig } from "@capacitor/cli";
import { appBrand } from "./src/app-brand";

const config: CapacitorConfig = {
  appId: "com.chatconnect.cn",
  appName: appBrand.downloadName,
  webDir: "dist",
  ios: {
    minVersion: "16.0",
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    AmigoFaceSwap: {},
    LocalNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
