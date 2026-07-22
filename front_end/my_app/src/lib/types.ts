export type DeviceStatus = "online" | "offline" | "pending";
export type JobStatus = "success" | "running" | "pending" | "failed";
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
  device: string;
  type: string;
  target: string;
  status: JobStatus;
  time: string;
  progress: number;
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
