type NativeDisplayPermission =
  | "prompt"
  | "prompt-with-rationale"
  | "granted"
  | "denied";

type NativePermissionStatus = { display: NativeDisplayPermission };

export type NativeNotificationPlugin = {
  checkPermissions: () => Promise<NativePermissionStatus>;
  requestPermissions: () => Promise<NativePermissionStatus>;
  schedule: (options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      sound?: string;
      extra?: Record<string, unknown>;
    }>;
  }) => Promise<unknown>;
};

export type NativeNotificationPermission = "granted" | "denied";

function normalizedPermission(
  status: NativePermissionStatus,
): NativeNotificationPermission {
  return status.display === "granted" ? "granted" : "denied";
}

export async function readNativeNotificationPermission(
  plugin: NativeNotificationPlugin,
): Promise<NativeNotificationPermission> {
  return normalizedPermission(await plugin.checkPermissions());
}

export async function ensureNativeNotificationPermission(
  plugin: NativeNotificationPlugin,
): Promise<NativeNotificationPermission> {
  const current = await plugin.checkPermissions();
  if (current.display === "granted") return "granted";
  if (
    current.display !== "prompt" &&
    current.display !== "prompt-with-rationale"
  )
    return "denied";

  await plugin.requestPermissions();
  return readNativeNotificationPermission(plugin);
}

export async function scheduleNativeAlert(
  plugin: NativeNotificationPlugin,
  alert: {
    id: number;
    title: string;
    body: string;
    sound?: boolean;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  await plugin.schedule({
    notifications: [
      {
        id: alert.id,
        title: alert.title,
        body: alert.body,
        ...(alert.sound === false ? {} : { sound: "default" }),
        ...(alert.extra ? { extra: alert.extra } : {}),
      },
    ],
  });
}
