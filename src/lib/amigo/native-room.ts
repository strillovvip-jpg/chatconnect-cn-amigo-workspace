import {
  amigoBridge,
  type AmigoPipelineCapabilities,
  type NativeRoomStatus,
  type NativeMediaPermissionStatus,
} from "./bridge.ts";

export type NativeRoomConnectOptions = {
  url: string;
  token: string;
  enableMicrophone?: boolean;
  enableCamera?: boolean;
};

class NativeAmigoRoomService {
  get isAvailable() {
    return amigoBridge.available;
  }

  getCapabilities(): Promise<AmigoPipelineCapabilities> {
    return amigoBridge.getPipelineCapabilities();
  }

  connect(options: NativeRoomConnectOptions): Promise<NativeRoomStatus> {
    return amigoBridge.connectNativeRoom(options);
  }

  disconnect(): Promise<NativeRoomStatus> {
    return amigoBridge.disconnectNativeRoom();
  }

  setFaceSwapEnabled(enabled: boolean): Promise<NativeRoomStatus> {
    return amigoBridge.setNativeFaceSwapEnabled(enabled);
  }

  getStatus(): Promise<NativeRoomStatus> {
    return amigoBridge.getNativeRoomStatus();
  }

  requestMediaPermissions(options: {
    openSettingsIfDenied?: boolean;
  } = {}): Promise<NativeMediaPermissionStatus> {
    return amigoBridge.requestMediaPermissions(options);
  }
}

export const nativeAmigoRoom = new NativeAmigoRoomService();
