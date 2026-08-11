export type NotificationChannel = "native" | "web" | "unsupported";

export function getNotificationChannel(options: {
  nativeApp: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotificationApi: boolean;
}): NotificationChannel {
  if (options.nativeApp) return "native";
  if (
    options.hasServiceWorker &&
    options.hasPushManager &&
    options.hasNotificationApi
  ) {
    return "web";
  }
  return "unsupported";
}
