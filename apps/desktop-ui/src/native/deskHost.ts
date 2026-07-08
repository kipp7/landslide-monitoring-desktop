type DeskHostMessage =
  | { type: "app"; action: "quit" }
  | { type: "app"; action: "show" }
  | { type: "app"; action: "hide" }
  | { type: "app"; action: "focus" }
  | { type: "app"; action: "ready" }
  | {
      type: "app";
      action: "runtimeError";
      payload: { message: string; source?: string; stack?: string };
    }
  | { type: "app"; action: "openLogsDir" }
  | { type: "app"; action: "toggleTray"; payload?: { enabled?: boolean } }
  | { type: "app"; action: "toggleFullscreen" }
  | { type: "app"; action: "enterFullscreen" }
  | { type: "app"; action: "exitFullscreen" }
  | { type: "app"; action: "reload" }
  | { type: "app"; action: "minimize" }
  | { type: "app"; action: "maximize" }
  | { type: "app"; action: "restore" }
  | { type: "app"; action: "openExternal"; payload: { url: string } }
  | {
      type: "app";
      action: "notify";
      payload: {
        title?: string;
        message: string;
        route?: string;
        level?: "info" | "warning" | "error";
        timeoutMs?: number;
      };
    };

type WebView2Bridge = {
  postMessage: (message: unknown) => void;
};

export type DeskHostInfo = {
  app?: { name?: string; version?: string };
  webview2?: { browserVersion?: string; userDataFolder?: string; additionalArgs?: string };
  os?: { version?: string };
  api?: { mode?: "http" | "mock"; baseUrl?: string; force?: boolean; profile?: string };
};

function getBridge(): WebView2Bridge | null {
  if (typeof window === "undefined") return null;
  const chromeLike = (window as unknown as { chrome?: { webview?: WebView2Bridge } }).chrome;
  return chromeLike?.webview ?? null;
}

export function getDeskHostInfo(): DeskHostInfo | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __DESK_HOST_INFO?: DeskHostInfo };
  return w.__DESK_HOST_INFO ?? null;
}

export function isDeskHost(): boolean {
  return !!getBridge();
}

export function postDeskHostMessage(message: DeskHostMessage): boolean {
  const bridge = getBridge();
  if (!bridge) return false;
  bridge.postMessage(message);
  return true;
}

export function requestDeskQuit(): boolean {
  return postDeskHostMessage({ type: "app", action: "quit" });
}

export function requestDeskFocus(): boolean {
  return postDeskHostMessage({ type: "app", action: "focus" });
}

export function requestDeskToggleTray(enabled?: boolean): boolean {
  const payload = enabled === undefined ? undefined : { enabled };
  return postDeskHostMessage({ type: "app", action: "toggleTray", ...(payload ? { payload } : {}) });
}

export function requestDeskNotify(input: {
  title?: string;
  message: string;
  route?: string;
  level?: "info" | "warning" | "error";
  timeoutMs?: number;
}): boolean {
  return postDeskHostMessage({ type: "app", action: "notify", payload: input });
}

export function requestDeskOpenExternal(url: string): boolean {
  return postDeskHostMessage({ type: "app", action: "openExternal", payload: { url } });
}

export function requestDeskOpenLogsDir(): boolean {
  return postDeskHostMessage({ type: "app", action: "openLogsDir" });
}

export function requestDeskToggleFullscreen(): boolean {
  return postDeskHostMessage({ type: "app", action: "toggleFullscreen" });
}

export function requestDeskReload(): boolean {
  return postDeskHostMessage({ type: "app", action: "reload" });
}

export function notifyDeskAppReady(): boolean {
  return postDeskHostMessage({ type: "app", action: "ready" });
}

export function notifyDeskRuntimeError(input: {
  message: string;
  source?: string;
  stack?: string;
}): boolean {
  return postDeskHostMessage({ type: "app", action: "runtimeError", payload: input });
}
