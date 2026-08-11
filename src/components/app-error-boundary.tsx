import { Component, type ErrorInfo, type ReactNode } from "react";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ChatConnect UI error", error, info.componentStack);
    this.setState({
      failed: true,
      message: error?.message || "Unknown UI error",
    });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d1525] p-6 text-center text-white">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">无法加载页面</h1>
          <p className="mt-2 text-sm text-white/55">
            应用启动时捕获到了前端错误。请把下方第一条错误文字发给我。
          </p>
          {this.state.message ? (
            <pre className="mt-4 overflow-x-auto rounded-xl bg-black/30 p-4 text-left text-xs text-red-200 whitespace-pre-wrap break-words">
              {this.state.message}
            </pre>
          ) : null}
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold"
          >
            重新加载
          </button>
        </div>
      </main>
    );
  }
}
