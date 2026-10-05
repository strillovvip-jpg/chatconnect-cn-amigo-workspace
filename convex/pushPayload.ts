export type WebPushPayloadInput = {
  userId: string;
  title: string;
  message: string;
  url?: string;
  type?: string;
  data?: unknown;
};

export function createWebPushPayload(input: WebPushPayloadInput) {
  return {
    title: input.title,
    type: input.type,
    data: input.data,
    options: {
      body: input.message,
      icon: "/icon/shojin-192.png?v=2",
      badge: "/icon/shojin-192.png?v=2",
      vibrate: [400, 180, 400],
      renotify: true,
      tag: `chatconnect-${input.userId}`,
      data: { url: input.url ?? "/" },
    },
  };
}
