import type { Device, Station } from "../../api/client";

export type HomeTaskPriority = "high" | "mid" | "low";
export type HomeTaskCategory = "device" | "site" | "data" | "safety" | "other";
export type HomeTaskSource = "system" | "manual";

export type HomeTask = {
  id: string;
  source: HomeTaskSource;
  title: string;
  description?: string;
  stationId?: string;
  stationName?: string;
  deviceId?: string;
  deviceName?: string;
  category: HomeTaskCategory;
  priority: HomeTaskPriority;
  createdAt: string;
};

export type HomeTodoPersist = {
  version: 1;
  manualTasks: HomeTask[];
  doneAtById: Record<string, string>;
};

export type HomeAnnouncementLevel = "info" | "warning" | "critical";

export type HomeAnnouncement = {
  id: string;
  level: HomeAnnouncementLevel;
  title: string;
  body: string;
  createdAt: string;
  route?: string;
};

export type HomeAnnouncementPersist = {
  version: 1;
  items: HomeAnnouncement[];
};

export const HOME_TODO_KEY = "desk.home.todos.v1";
export const HOME_PINS_KEY = "desk.home.pins.v1";
export const HOME_ANN_KEY = "desk.home.announcements.v1";
export const HOME_ANN_READ_PREFIX = "desk.home.announcements.read.v1.";

export function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadTodos(): HomeTodoPersist {
  try {
    const parsed = safeJsonParse<HomeTodoPersist>(localStorage.getItem(HOME_TODO_KEY));
    if (!parsed || parsed.version !== 1) return { version: 1, manualTasks: [], doneAtById: {} };
    return {
      version: 1,
      manualTasks: Array.isArray(parsed.manualTasks) ? parsed.manualTasks : [],
      doneAtById: parsed.doneAtById && typeof parsed.doneAtById === "object" ? parsed.doneAtById : {}
    };
  } catch {
    return { version: 1, manualTasks: [], doneAtById: {} };
  }
}

export function saveTodos(next: HomeTodoPersist) {
  try {
    localStorage.setItem(HOME_TODO_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

export function loadPins(): string[] {
  try {
    const parsed = safeJsonParse<{ version: number; pinnedStationIds: string[] }>(localStorage.getItem(HOME_PINS_KEY));
    if (!parsed || parsed.version !== 1) return [];
    if (!Array.isArray(parsed.pinnedStationIds)) return [];
    return parsed.pinnedStationIds.filter((v) => typeof v === "string");
  } catch {
    return [];
  }
}

export function savePins(pinnedStationIds: string[]) {
  try {
    localStorage.setItem(HOME_PINS_KEY, JSON.stringify({ version: 1, pinnedStationIds }));
  } catch {
    return;
  }
}

export function defaultAnnouncements(): HomeAnnouncement[] {
  const now = new Date().toISOString();
  return [
    {
      id: "sys:delivery-check",
      level: "info",
      title: "上线前检查",
      body: "请在交付前确认接口地址、告警通道、值守通知和设备身份信息均已完成配置，并校验桌面端与后端时间同步。",
      createdAt: now,
      route: "/app/settings"
    },
    {
      id: "sys:duty-reminder",
      level: "warning",
      title: "值守提醒：雨季加强巡查与复核",
      body: "雨季或强降雨期间，请加强重点站点巡检频次，并重点关注 GNSS 位移速度、雨量峰值与设备离线情况。",
      createdAt: now
    }
  ];
}

export function loadAnnouncements(): HomeAnnouncementPersist {
  try {
    const parsed = safeJsonParse<HomeAnnouncementPersist>(localStorage.getItem(HOME_ANN_KEY));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return { version: 1, items: defaultAnnouncements() };
    }
    return { version: 1, items: parsed.items };
  } catch {
    return { version: 1, items: defaultAnnouncements() };
  }
}

export function saveAnnouncements(next: HomeAnnouncementPersist) {
  try {
    localStorage.setItem(HOME_ANN_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

export function loadAnnouncementRead(userId: string): Record<string, string> {
  try {
    const parsed = safeJsonParse<Record<string, string>>(localStorage.getItem(`${HOME_ANN_READ_PREFIX}${userId}`));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveAnnouncementRead(userId: string, next: Record<string, string>) {
  try {
    localStorage.setItem(`${HOME_ANN_READ_PREFIX}${userId}`, JSON.stringify(next));
  } catch {
    return;
  }
}

export function priorityLabel(priority: HomeTaskPriority) {
  if (priority === "high") return { text: "高优先", color: "red" };
  if (priority === "mid") return { text: "中优先", color: "orange" };
  return { text: "低优先", color: "blue" };
}

export function announcementLabel(level: HomeAnnouncementLevel) {
  if (level === "critical") return { text: "重要", color: "red" };
  if (level === "warning") return { text: "提醒", color: "orange" };
  return { text: "信息", color: "cyan" };
}

export function createId(prefix: string) {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      const uuid = (crypto as unknown as { randomUUID: () => string }).randomUUID();
      return `${prefix}${uuid}`;
    }
  } catch {
    void 0;
  }
  return `${prefix}${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function buildSystemTasks(stations: Station[], devices: Device[]): HomeTask[] {
  const now = new Date().toISOString();
  const tasks: HomeTask[] = [];

  for (const d of devices) {
    if (d.status === "offline") {
      tasks.push({
        id: `sys:device-offline:${d.id}`,
        source: "system",
        title: `检查离线设备：${d.name}`,
        description: "建议检查供电、通信链路、天线/线路与现场环境；必要时安排现场巡检。",
        stationId: d.stationId,
        stationName: d.stationName,
        deviceId: d.id,
        deviceName: d.name,
        category: "device",
        priority: "high",
        createdAt: d.lastSeenAt
      });
    }

    if (d.status === "warning") {
      tasks.push({
        id: `sys:device-warning:${d.id}`,
        source: "system",
        title: `复核预警设备：${d.name}`,
        description: "建议核对阈值/基线配置，关注数据连续性与波动是否与雨量/地质条件相关。",
        stationId: d.stationId,
        stationName: d.stationName,
        deviceId: d.id,
        deviceName: d.name,
        category: "device",
        priority: "mid",
        createdAt: now
      });
    }
  }

  for (const st of stations) {
    if (st.risk !== "high") continue;
    tasks.push({
      id: `sys:station-focus:${st.id}`,
      source: "system",
      title: `重点站点关注：${st.name}`,
      description: "建议在强降雨时段提高巡检频次，并重点关注 GNSS 位移速度与设备离线情况。",
      stationId: st.id,
      stationName: st.name,
      category: "site",
      priority: st.status === "warning" ? "high" : "mid",
      createdAt: now
    });
  }

  tasks.push({
    id: "sys:daily-checklist",
    source: "system",
    title: "例行检查：确认上报链路与告警规则",
    description: "建议确认采集链路、告警规则启停、值班通知通道与大屏数据刷新是否正常。",
    category: "data",
    priority: "low",
    createdAt: now
  });

  const unique = new Map(tasks.map((t) => [t.id, t] as const));
  return Array.from(unique.values());
}
