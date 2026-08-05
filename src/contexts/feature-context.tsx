import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

export type FeatureFlags = {
  canVideoCall: boolean;
  canVoiceCall: boolean;
  canAIFace: boolean;
  canVideoSource: boolean;
  canPlayVideo: boolean;
  canScreenShare: boolean;
  canTransferCall: boolean;
  canGroupCall: boolean;
  canPictureInPicture: boolean;
  canFloatingWindow: boolean;
  canFileSearch: boolean;
  canRecord: boolean;
};
export type FeatureKey = keyof FeatureFlags;

const safeDefaults: FeatureFlags = {
  canVideoCall: false,
  canVoiceCall: false,
  canAIFace: false,
  canVideoSource: false,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
  canGroupCall: false,
  canPictureInPicture: false,
  canFloatingWindow: false,
  canFileSearch: false,
  canRecord: false,
};

type FeatureContextValue = {
  flags: FeatureFlags;
  can: (feature: FeatureKey) => boolean;
  loading: boolean;
  profileName: string | null;
  expiresAt: number | null;
};
const FeatureContext = createContext<FeatureContextValue>({
  flags: safeDefaults,
  can: () => false,
  loading: true,
  profileName: null,
  expiresAt: null,
});

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const [credentials, setCredentials] = useState(() => ({
    code: localStorage.getItem("ksc_session_code") ?? "",
    deviceId: localStorage.getItem("ksc_device_id") ?? "",
  }));
  useEffect(() => {
    const sync = () =>
      setCredentials({
        code: localStorage.getItem("ksc_session_code") ?? "",
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
    window.addEventListener("chatconnect-session-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("chatconnect-session-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const license = useQuery(
    api.features.current,
    credentials.code && credentials.deviceId ? credentials : "skip",
  );
  const flags = license?.features ?? safeDefaults;
  const value = useMemo<FeatureContextValue>(
    () => ({
      flags,
      can: (feature) => flags[feature],
      loading: Boolean(
        credentials.code && credentials.deviceId && license === undefined,
      ),
      profileName: license?.profileName ?? null,
      expiresAt: license?.expiresAt ?? null,
    }),
    [credentials.code, credentials.deviceId, flags, license],
  );
  return (
    <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeatureContext);
}

export function Feature({
  name,
  children,
  fallback = null,
}: {
  name: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return useFeatures().can(name) ? children : fallback;
}
