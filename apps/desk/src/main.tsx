import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { notifyDeskAppReady, notifyDeskRuntimeError } from "./native/deskHost";
import "./styles.css";

function normalizeHashRouterLocation() {
  if (window.location.hash) return;
  const pathname = window.location.pathname;
  const search = window.location.search ?? "";

  const routePrefixes = ["/app/", "/app", "/login"];
  const hit = routePrefixes.find((p) => pathname.includes(p));
  if (!hit) return;

  const idx = pathname.indexOf(hit);
  if (idx < 0) return;
  const basePrefix = pathname.slice(0, idx);
  const route = pathname.slice(idx);

  const base = basePrefix.endsWith("/") ? basePrefix : `${basePrefix}/`;
  const target = `${base}#${route}${search}`;
  window.location.replace(target);
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

normalizeHashRouterLocation();

window.addEventListener("error", (event) => {
  const payload: { message: string; source?: string; stack?: string } = {
    message: event.message || "Unknown window error"
  };
  if (event.filename) {
    payload.source = event.filename;
  }
  if (event.error instanceof Error && event.error.stack) {
    payload.stack = event.error.stack;
  }
  notifyDeskRuntimeError(payload);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason instanceof Error) {
    const payload: { message: string; source?: string; stack?: string } = {
      message: reason.message,
      source: "unhandledrejection"
    };
    if (reason.stack) {
      payload.stack = reason.stack;
    }
    notifyDeskRuntimeError(payload);
    return;
  }

  notifyDeskRuntimeError({
    message: typeof reason === "string" ? reason : JSON.stringify(reason),
    source: "unhandledrejection"
  });
});

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

queueMicrotask(() => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      notifyDeskAppReady();
    });
  });
});
