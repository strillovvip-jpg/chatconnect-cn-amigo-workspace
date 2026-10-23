let virtualCameraDeviceId: string | null = null;
let stopProcessing: (() => Promise<unknown>) | null = null;
let processingActive = false;

export function registerWindowsHelperStop(stop: () => Promise<unknown>) {
  stopProcessing = stop;
  processingActive = true;
  return () => {
    if (stopProcessing === stop) stopProcessing = null;
  };
}

export function markWindowsVirtualCameraDevice(deviceId: string) {
  virtualCameraDeviceId = deviceId;
}

export function isWindowsVirtualCameraDevice(deviceId?: string) {
  return Boolean(deviceId && deviceId === virtualCameraDeviceId);
}

export async function stopWindowsHelperForPublisher(deviceId?: string) {
  if (
    !isWindowsVirtualCameraDevice(deviceId) ||
    !processingActive ||
    !stopProcessing
  )
    return false;
  processingActive = false;
  await stopProcessing();
  return true;
}

export function clearWindowsHelperRuntime() {
  virtualCameraDeviceId = null;
  stopProcessing = null;
  processingActive = false;
}
