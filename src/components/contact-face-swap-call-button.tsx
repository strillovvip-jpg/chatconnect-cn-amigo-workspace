import { ScanFace } from "lucide-react";
import { cn } from "@/lib/utils.ts";

type Props = {
  allowed: boolean;
  busy: boolean;
  label: string;
  onStart: () => void;
  className?: string;
  iconSize?: number;
};

export function ContactFaceSwapCallButton({
  allowed,
  busy,
  label,
  onStart,
  className,
  iconSize = 18,
}: Props) {
  if (!allowed) return null;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onStart}
      className={cn(
        "cursor-pointer rounded-lg p-2 text-fuchsia-300/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30",
        className,
      )}
    >
      <ScanFace size={iconSize} />
    </button>
  );
}
