import { Component, type ErrorInfo, type ReactNode } from "react";
import { messages, resolveLocaleFromNavigator } from "@/lib/i18n";

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
    const copy = messages[resolveLocaleFromNavigator()].app;
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d1525] p-6 text-center text-white">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">{copy.fatalTitle}</h1>
          <p className="mt-2 text-sm text-white/55">
            {copy.fatalBody}
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
            {copy.reload}
          </button>
        </div>
      </main>
    );
  }
}
