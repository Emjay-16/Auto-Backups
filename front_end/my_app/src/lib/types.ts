export type DeviceStatus = "online" | "offline" | "pending";
export type JobStatus = "success" | "running" | "pending" | "failed" | "skipped";
export type ActivityKind = "ok" | "run" | "wait" | "fail";

export type Device = {
  id: number;
  groupId?: number;
  code?: string;
  rawStatus?: number;
  name: string;
  group: "AMR" | "SMR" | "SMRL";
  ip: string;
  status: DeviceStatus;
  lastSeen: string;
};

export type Backup = {
  id?: number;
  name: string;
  device: string;
  type: string;
  files: number;
  size: string;
  status: JobStatus;
  createdAt: string;
};

export type Job = {
  id: number;
  deviceId?: number | null;
  backupId?: number | null;
  device: string;
  type: string;
  target: string;
  status: JobStatus;
  time: string;
  updatedAt: string;
  finishedAt: string;
  progress: number;
  checkedDevices: number;
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  backupsCreated: number;
  failedDevices: number;
  retryCount: number;
  maxRetries: number;
  message: string;
};

export type Activity = {
  id: number;
  kind: ActivityKind;
  text: string;
  meta: string;
  time: string;
  action: string;
  status: string;
  device: string;
  backup: string;
};
