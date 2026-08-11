import { Loader2Icon } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { messages } = useI18n();
  return (
    <Loader2Icon
      role="status"
      aria-label={messages.uiKit.loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
