import { mockAiProvider } from "./mock";
import type { AiProvider } from "./types";

// ChatConnect currently runs exclusively in Mock mode. This provider performs
// no model inference and makes no outbound requests to an AI service.
export const aiProvider: AiProvider = mockAiProvider;

export type { AiProvider, FaceSwapInput, FaceSwapResult } from "./types";
