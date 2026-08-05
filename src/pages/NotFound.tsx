import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    console.error("404：用户尝试访问不存在的路径：", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
          <h2 className="text-2xl font-semibold">找不到页面</h2>
        </div>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          您访问的页面不存在。
        </p>
        <div className="pt-4">
          <Button asChild>
            <Link to="/">返回首页</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
