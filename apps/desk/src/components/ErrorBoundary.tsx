import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[desk] render error:", error, info);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="desk-page" style={{ paddingTop: 24 }}>
        <div
          style={{
            border: "1px solid rgba(239, 68, 68, 0.35)",
            background: "rgba(15, 23, 42, 0.55)",
            borderRadius: 14,
            padding: 16,
            maxWidth: 920
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 900, color: "rgba(248, 113, 113, 0.95)" }}>页面渲染失败</div>
          <div style={{ marginTop: 8, color: "rgba(226, 232, 240, 0.9)" }}>{error.message}</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.28)",
                background: "rgba(51, 65, 85, 0.22)",
                color: "rgba(226, 232, 240, 0.92)",
                padding: "8px 12px",
                borderRadius: 10,
                cursor: "pointer"
              }}
            >
              刷新页面
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.28)",
                background: "rgba(51, 65, 85, 0.22)",
                color: "rgba(226, 232, 240, 0.92)",
                padding: "8px 12px",
                borderRadius: 10,
                cursor: "pointer"
              }}
            >
              清空缓存并重载
            </button>
            <button
              type="button"
              onClick={this.reset}
              style={{
                border: "1px solid rgba(34, 211, 238, 0.35)",
                background: "rgba(34, 211, 238, 0.12)",
                color: "rgba(165, 243, 252, 0.95)",
                padding: "8px 12px",
                borderRadius: 10,
                cursor: "pointer"
              }}
            >
              尝试继续
            </button>
          </div>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", color: "rgba(148, 163, 184, 0.92)" }}>查看错误堆栈</summary>
            <pre
              style={{
                marginTop: 10,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
                color: "rgba(226, 232, 240, 0.9)",
                background: "rgba(2, 6, 23, 0.45)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
                borderRadius: 12,
                padding: 12
              }}
            >
              {error.stack ?? "(no stack)"}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
