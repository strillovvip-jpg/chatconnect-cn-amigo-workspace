import type { AiProvider, FaceSwapInput, FaceSwapResult } from "./types";

export const mockAiProvider: AiProvider = {
  mode: "mock",

  async swap(input: FaceSwapInput): Promise<FaceSwapResult> {
    return {
      success: true,
      requestId: `MOCK-${crypto.randomUUID().toUpperCase()}`,
      status: "completed",
      mode: "mock",
      faceId: input.faceId,
      sourceImageUrl: input.sourceImageUrl,
      targetImageUrl: input.targetImageUrl,
      resultImageUrl: input.targetImageUrl,
      processed: false,
      message: "模拟模式：未执行图像处理。",
    };
  },
};
