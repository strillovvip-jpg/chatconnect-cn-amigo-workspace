import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { messages } = useI18n();
  const location = useLocation();

  useEffect(() => {
    console.error("404 route not found:", location.pathname);
  }, [location.pathname]);

  const copy = messages.notFound;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
          <h2 className="text-2xl font-semibold">{copy.title}</h2>
        </div>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          {copy.body}
        </p>
        <div className="pt-4">
          <Button asChild>
            <Link to="/">{copy.action}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
