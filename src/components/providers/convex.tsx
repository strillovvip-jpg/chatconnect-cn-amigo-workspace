import {
  ConvexProvider as BaseConvexProvider,
  ConvexReactClient,
} from "convex/react";

const DEFAULT_CONVEX_URL = "https://adorable-parakeet-350.convex.cloud";
const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim() || DEFAULT_CONVEX_URL;
const convex = new ConvexReactClient(convexUrl);

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  return <BaseConvexProvider client={convex}>{children}</BaseConvexProvider>;
}
