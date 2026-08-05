import { Component, type ErrorInfo, type ReactNode } from "react";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ChatConnect UI error", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d1525] p-6 text-center text-white">
        <div>
          <h1 className="text-xl font-bold">无法加载页面</h1>
          <p className="mt-2 text-sm text-white/55">
            通话仍保持连接，请重新加载页面。
          </p>
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
