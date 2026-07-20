import type { FieldAlarmActuatorStatus, FieldAlarmTongxiaoStatus } from "../api/client";

export function getFieldAlarmTerminal(
  actuator: FieldAlarmActuatorStatus | null | undefined
): FieldAlarmTongxiaoStatus | null {
  return actuator?.tongxiao ?? null;
}

export function isFieldAlarmTerminalOnline(
  actuator: FieldAlarmActuatorStatus | null | undefined
): boolean {
  return actuator?.available === true && actuator.dryRun !== true && getFieldAlarmTerminal(actuator)?.boardOnline === true;
}

export function fieldAlarmTerminalFirmware(
  actuator: FieldAlarmActuatorStatus | null | undefined
): string | null {
  const terminal = getFieldAlarmTerminal(actuator);
  return terminal?.reported?.firmware_version ?? terminal?.presence?.meta?.fw ?? null;
}

export function formatFieldAlarmPresenceAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "未收到";
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(seconds < 36_000 ? 1 : 0)} 小时`;
  return `${Math.floor(seconds / 86_400)} 天`;
}

export function fieldAlarmTerminalConnectionLabel(
  actuator: FieldAlarmActuatorStatus | null | undefined
): string {
  if (!actuator) return "状态未上报";
  if (actuator.dryRun) return "未接入实体终端";
  if (!actuator.available) return "告警桥不可用";
  const terminal = getFieldAlarmTerminal(actuator);
  if (!terminal) return "板端状态未上报";
  return terminal.boardOnline ? "RK2206 在线" : "RK2206 离线";
}
