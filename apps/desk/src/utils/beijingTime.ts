type BeijingTimeInput = Date | string | number | null | undefined;

const BEIJING_TIME_ZONE = "Asia/Shanghai";

function toValidDate(value: BeijingTimeInput): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInBeijing(
  value: BeijingTimeInput,
  options: Intl.DateTimeFormatOptions,
  fallback = "—"
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: BEIJING_TIME_ZONE, hour12: false, ...options }).format(date);
}

export function formatBeijingTime(value: BeijingTimeInput, includeSeconds = true, fallback = "—"): string {
  return formatInBeijing(
    value,
    includeSeconds
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" },
    fallback
  );
}

export function formatBeijingDate(value: BeijingTimeInput, includeWeekday = false, fallback = "—"): string {
  return formatInBeijing(
    value,
    includeWeekday
      ? { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }
      : { year: "numeric", month: "2-digit", day: "2-digit" },
    fallback
  );
}

export function formatBeijingDateTime(
  value: BeijingTimeInput,
  options?: { includeSeconds?: boolean; includeWeekday?: boolean },
  fallback = "—"
): string {
  return formatInBeijing(
    value,
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(options?.includeSeconds === false ? {} : { second: "2-digit" }),
      ...(options?.includeWeekday ? { weekday: "short" } : {})
    },
    fallback
  );
}

export function formatBeijingMonthDayTime(
  value: BeijingTimeInput,
  options?: { includeMinutes?: boolean; includeSeconds?: boolean },
  fallback = "—"
): string {
  return formatInBeijing(
    value,
    {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      ...(options?.includeSeconds
        ? { minute: "2-digit", second: "2-digit" }
        : options?.includeMinutes === false
          ? {}
          : { minute: "2-digit" })
    },
    fallback
  );
}

export function formatBeijingMonthDay(value: BeijingTimeInput, fallback = "—"): string {
  return formatInBeijing(value, { month: "2-digit", day: "2-digit" }, fallback);
}
