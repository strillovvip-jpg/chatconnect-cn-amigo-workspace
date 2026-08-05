export type AiMode = "mock";

export interface FaceSwapInput {
  faceId: string;
  sourceImageUrl: string;
  targetImageUrl: string;
}

export interface FaceSwapResult {
  success: true;
  requestId: string;
  status: "completed";
  mode: AiMode;
  faceId: string;
  sourceImageUrl: string;
  targetImageUrl: string;
  resultImageUrl: string;
  processed: false;
  message: string;
}

export interface AiProvider {
  readonly mode: AiMode;
  swap(input: FaceSwapInput): Promise<FaceSwapResult>;
}
