import { useCallback, useEffect, useMemo, useState } from "react";
import { WindowsHelperClient } from "@/lib/windows-helper/client";

const MAX_FACE_BYTES = 15 * 1024 * 1024;

export type WindowsFaceSwapCopy = {
  title: string;
  windowsOnly: string;
  fullFeatureOnly: string;
  checking: string;
  installRequired: string;
  downloadHelper: string;
  outdated: string;
  engineUnavailable: string;
  selectPhoto: string;
  photoHint: string;
  invalidPhoto: string;
  photoTooLarge: string;
  localConsent: string;
  enroll: string;
  enrolling: string;
  ready: string;
  start: string;
  stop: string;
  clear: string;
  preview: string;
  retry: string;
  unavailableRecovery: string;
  genericError: string;
};

type SetupState =
  | "checking"
  | "install-required"
  | "outdated"
  | "engine-unavailable"
  | "ready"
  | "enrolling"
  | "enrolled"
  | "preview"
  | "error";

type Props = {
  authorizationCode: string;
  deviceId: string;
  fullFeature: boolean;
  platform?: string;
  copy: WindowsFaceSwapCopy;
  createAssertion: (input: {
    code: string;
    deviceId: string;
    helperNonce: string;
  }) => Promise<{ assertion: string }>;
  client?: WindowsHelperClient;
  helperDownloadUrl?: string;
};

export function WindowsFaceSwapSetup({
  authorizationCode,
  deviceId,
  fullFeature,
  platform = navigator.platform,
  copy,
  createAssertion,
  client: suppliedClient,
  helperDownloadUrl = "/downloads/USA.Filing.FaceSwap.Setup.exe",
}: Props) {
  const client = useMemo(
    () => suppliedClient ?? new WindowsHelperClient(),
    [suppliedClient],
  );
  const [state, setState] = useState<SetupState>("checking");
  const [selectedFace, setSelectedFace] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const isWindows = /win/i.test(platform);

  const checkHelper = useCallback(async () => {
    if (!isWindows || !fullFeature) return;
    setState("checking");
    setOperationError(null);
    try {
      const status = await client.detect();
      if (!status.engineReady || !status.virtualCameraReady) {
        setState("engine-unavailable");
        return;
      }
      await client.createSession({
        deviceId,
        assertionProvider: ({ helperNonce }) =>
          createAssertion({ code: authorizationCode, deviceId, helperNonce }),
      });
      setState("ready");
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "HELPER_ERROR";
      if (code === "HELPER_UNAVAILABLE") setState("install-required");
      else if (code === "UNSUPPORTED_VERSION") setState("outdated");
      else {
        setOperationError(copy.genericError);
        setState("error");
      }
    }
  }, [
    authorizationCode,
    client,
    copy.genericError,
    createAssertion,
    deviceId,
    fullFeature,
    isWindows,
  ]);

  useEffect(() => {
    void checkHelper();
  }, [checkHelper]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (!isWindows)
    return (
      <section aria-label={copy.title}>
        <p>{copy.windowsOnly}</p>
      </section>
    );
  if (!fullFeature)
    return (
      <section aria-label={copy.title}>
        <p>{copy.fullFeatureOnly}</p>
      </section>
    );

  const chooseFace = (file: File | undefined) => {
    setValidationError(null);
    setConsented(false);
    if (!file) return;
    if (!(["image/jpeg", "image/png"] as string[]).includes(file.type)) {
      setSelectedFace(null);
      setValidationError(copy.invalidPhoto);
      return;
    }
    if (file.size > MAX_FACE_BYTES) {
      setSelectedFace(null);
      setValidationError(copy.photoTooLarge);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFace(file);
    setPreviewUrl(
      typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null,
    );
  };

  const enroll = async () => {
    if (!selectedFace || !consented) return;
    setState("enrolling");
    try {
      const result = await client.enrollFace(selectedFace, { confirmed: true });
      if (!result.enrolled) throw new Error("Face enrollment failed");
      setState("enrolled");
    } catch {
      setOperationError(copy.genericError);
      setState("error");
    }
  };

  const start = async () => {
    try {
      await client.start();
      setState("preview");
    } catch {
      setOperationError(copy.genericError);
      setState("error");
    }
  };
  const stop = async () => {
    try {
      await client.stop();
      setState("enrolled");
    } catch {
      setOperationError(copy.genericError);
      setState("error");
    }
  };
  const clear = async () => {
    try {
      await client.clearFace();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setSelectedFace(null);
      setConsented(false);
      setState("ready");
    } catch {
      setOperationError(copy.genericError);
      setState("error");
    }
  };

  return (
    <section
      aria-label={copy.title}
      className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white"
    >
      <h2 className="font-semibold">{copy.title}</h2>
      {state === "checking" && <p>{copy.checking}</p>}
      {state === "install-required" && (
        <>
          <p>{copy.installRequired}</p>
          <p>{copy.unavailableRecovery}</p>
          <a href={helperDownloadUrl}>{copy.downloadHelper}</a>
        </>
      )}
      {state === "outdated" && (
        <>
          <p>{copy.outdated}</p>
          <button type="button" onClick={() => void checkHelper()}>
            {copy.retry}
          </button>
        </>
      )}
      {state === "engine-unavailable" && <p>{copy.engineUnavailable}</p>}
      {state === "error" && (
        <>
          <p role="alert">{operationError}</p>
          <button type="button" onClick={() => void checkHelper()}>
            {copy.retry}
          </button>
        </>
      )}
      {["ready", "enrolling", "enrolled", "preview"].includes(state) && (
        <>
          {state === "ready" && (
            <>
              <label>
                {copy.selectPhoto}
                <input
                  aria-label={copy.selectPhoto}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => chooseFace(event.target.files?.[0])}
                />
              </label>
              <p>{copy.photoHint}</p>
              {validationError && <p role="alert">{validationError}</p>}
              {previewUrl && (
                <img src={previewUrl} alt="" className="max-h-32 rounded-xl" />
              )}
              {selectedFace && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={consented}
                      onChange={(event) => setConsented(event.target.checked)}
                    />
                    {copy.localConsent}
                  </label>
                  <button
                    type="button"
                    disabled={!consented}
                    onClick={() => void enroll()}
                  >
                    {copy.enroll}
                  </button>
                </>
              )}
            </>
          )}
          {state === "enrolling" && <p>{copy.enrolling}</p>}
          {state === "enrolled" && (
            <>
              <p>{copy.ready}</p>
              <button type="button" onClick={() => void start()}>
                {copy.start}
              </button>
              <button type="button" onClick={() => void clear()}>
                {copy.clear}
              </button>
            </>
          )}
          {state === "preview" && (
            <>
              <p>{copy.preview}</p>
              <button type="button" onClick={() => void stop()}>
                {copy.stop}
              </button>
              <button type="button" onClick={() => void clear()}>
                {copy.clear}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
