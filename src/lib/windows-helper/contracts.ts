export type HelperStatus = {
  apiVersion: string;
  helperVersion: string;
  engineReady: boolean;
  virtualCameraReady: boolean;
  processingState: string;
};

export type HelperSession = {
  sessionId: string;
  helperNonce: string;
  expiresAt: number;
};

export type EnrollFaceResult = {
  enrolled: boolean;
  faceCount: number;
  error: HelperError | null;
};

export type ProcessingStatus = {
  state: string;
  framesPerSecond: number;
  error: HelperError | null;
};

export type HelperError = {
  code: string;
  message: string;
  recoverable: boolean;
};

export type AssertionProvider = (input: {
  helperNonce: string;
}) => Promise<{ assertion: string }>;
