import {
  type Activity,
  type ActivityKind,
  type Backup,
  type Device,
  type DeviceStatus,
  type Job,
  type JobStatus,
} from "./types";

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  }

  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
        window.location.hostname &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1"
      ) {
        url.hostname = window.location.hostname;
        return url.origin;
      }
      return url.origin;
    } catch {
      // ignore parsing error
    }
  }

  if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  return "http://localhost:8000";
}

const API_AUTH_TOKEN = process.env.NEXT_PUBLIC_API_AUTH_TOKEN?.trim() ?? "";

type ApiDevice = {
  device_id: number;
  group_id: number;
  group_name?: string | null;
  device_code: string;
  device_name: string;
  ip_address: string;
  device_status: number;
  auto_backup_enabled?: boolean;
  last_seen_at: string | null;
  has_ssh_override?: boolean;
  ssh_username?: string | null;
  ssh_port?: number | null;
};

export type DeviceFormPayload = {
  group_id: number;
  device_code?: string;
  device_name: string;
  ip_address: string;
  device_status: number;
  auto_backup_enabled: boolean;
  ssh_username?: string;
  ssh_password?: string;
  ssh_port?: number;
  clear_ssh_override?: boolean;
};

export type DeviceBackupPath = {
  path: string;
  label: string;
};

export type DeviceGroupOption = {
  group_id: number;
  group_name: string;
};

export type RemoteFile = {
  name: string;
  path: string;
  file_type: string;
  size_bytes?: number | null;
  modified_at?: string | null;
};

export type DeviceStatusResult = {
  device_id?: number | null;
  ip_address: string;
  device_name: string;
  online: boolean;
  device_status: number;
  last_seen_at?: string | null;
  message: string;
};

export type BackupTarget = {
  key: string;
  label: string;
  path: string;
  target_type: "file" | "directory" | "database" | string;
  browsable: boolean;
  backup_api: "file" | "robot_db" | string;
  removable?: boolean;
};

export type CustomBackupPathResult = {
  path: string;
  label: string;
  message: string;
};

export type CombinedBackupPayload = {
  device_id: number;
  remote_paths: string[];
  include_database: boolean;
  backup_name?: string;
  zip_output?: boolean;
  created_by?: number;
};

export type BackupRunResult = {
  backup_id?: number | null;
  backup_name: string;
  device_id?: number | null;
  ip_address: string;
  device_name: string;
  total_file: number;
  total_size_mb: string | number;
  local_path: string;
  zip_path?: string | null;
  message: string;
};

export type UploadRunResult = {
  device_id: number;
  ip_address: string;
  device_name: string;
  target_path: string;
  total_file: number;
  files: Array<{
    file_name: string;
    target_path: string;
    file_size_mb: string | number;
  }>;
  message: string;
};

export type BackupCleanupPayload = {
  older_than_days: number;
  older_than_hours?: number;
  keep_latest_per_device: boolean;
  ignore_retention?: boolean;
};

export type BackupCleanupResult = {
  older_than_days: number;
  older_than_hours?: number | null;
  candidates: number;
  deleted: number;
  skipped: number;
  items: Array<{
    backup_id: number;
    device_id: number;
    backup_name: string;
    created_at: string;
    deleted: boolean;
    reason: string;
  }>;
};

export type AutoCleanupSettings = {
  enabled: boolean;
  older_than_days: number;
  older_than_hours: number;
  interval_hours: number;
  keep_latest_per_device: boolean;
};

export type AutoCleanupSettingsPayload = Partial<AutoCleanupSettings>;

export type AutoBackupSettings = {
  enabled: boolean;
  interval_hours: number;
  full_baseline_interval_days: number;
  zip_output: boolean;
  run_on_startup: boolean;
};

export type AutoBackupSettingsPayload = Partial<AutoBackupSettings>;

export type BackupFileDetail = {
  backup_file_id: number;
  backup_id: number;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size_mb: string | number;
  checksum?: string | null;
  file_status: number;
  created_at: string;
  remote_path?: string | null;
  file_exists?: boolean;
};

export type BackupDetail = {
  backup_id: number;
  device_id: number;
  backup_name: string;
  backup_type: number;
  backup_status: number;
  total_file: number;
  total_size_mb: string | number;
  created_by: number;
  created_at: string;
  updated_at: string;
  device_name?: string | null;
  ip_address?: string | null;
  files: BackupFileDetail[];
};

export type RestoreRunPayload = {
  restored_by: number;
  device_id?: number;
  target_path?: string;
  restore_type?: number;
  items?: Array<{
    backup_file_id: number;
    target_path: string;
  }>;
};

export type RestoreRunResult = {
  restore_id: number;
  backup_id: number;
  device_id: number;
  total_file: number;
  message: string;
};

type ApiBackup = {
  backup_id: number;
  device_id: number;
  backup_name: string;
  backup_type: number;
  backup_status: number;
  total_file: number;
  total_size_mb: string | number;
  created_at: string;
  device_name?: string | null;
  ip_address?: string | null;
};

type ApiJob = {
  job_id: number;
  job_type: string;
  job_status: number;
  device_id?: number | null;
  device_name?: string | null;
  backup_id?: number | null;
  checked_devices: number;
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  backups_created: number;
  failed_devices: number;
  retry_count: number;
  max_retries: number;
  job_message?: string | null;
  started_at: string;
  finished_at?: string | null;
  updated_at: string;
};

type ApiActivity = {
  log_id: number;
  device_id: number;
  device_name?: string | null;
  backup_id?: number | null;
  action: string;
  activity_status: number;
  activity_message?: string | null;
  created_at: string;
};

export type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  tone: "fail" | "wait" | "info";
  time: string;
};

export type LoginPayload = {
  user_name: string;
  password: string;
};

type ApiErrorResponse = {
  error_code?: string;
  message?: string;
  detail?: unknown;
  status_code?: number;
  path?: string;
};

async function getJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const response = await fetchApi(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `API ${path} failed: ${response.status}`));
  }

  return response.json() as Promise<T>;
}

export async function getDevicesForUi(): Promise<Device[]> {
  const [apiDevices, pendingJobs] = await Promise.all([
    getJson<ApiDevice[]>("/devices/", 5000),
    getJson<ApiJob[]>("/jobs/?job_status=4", 5000).catch((e) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[auto_backup] pending jobs fetch failed", e);
      }
      return [] as ApiJob[];
    }),
  ]);
  const pendingDeviceIds = new Set(
    pendingJobs
      .map((job) => job.device_id)
      .filter((deviceId): deviceId is number => typeof deviceId === "number"),
  );

  return apiDevices.map((device) => mapDevice(device, pendingDeviceIds));
}

export async function getDeviceGroupsForUi(): Promise<DeviceGroupOption[]> {
  return getJson<DeviceGroupOption[]>("/device-groups/", 5000);
}

export async function getBackupsForUi(): Promise<Backup[]> {
  const apiBackups = await getJson<ApiBackup[]>("/backups/?limit=100");
  return apiBackups.map(mapBackup);
}

export async function getJobsForUi(date?: string): Promise<Job[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (date) params.set("date", date);
  const apiJobs = await getJson<ApiJob[]>(`/jobs/?${params.toString()}`);
  return apiJobs.map(mapJob);
}

export async function getActivitiesForUi(date?: string): Promise<Activity[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (date) params.set("date", date);
  const apiActivities = await getJson<ApiActivity[]>(`/logs/?${params.toString()}`);
  return apiActivities.map(mapActivity);
}

export async function getNotificationsForUi(): Promise<NotificationItem[]> {
  const [jobs, activities] = await Promise.all([
    getJson<ApiJob[]>("/jobs/?limit=20").catch(() => []),
    getJson<ApiActivity[]>("/logs/?limit=8").catch(() => []),
  ]);
  const failedJobs = jobs.filter((job) => job.job_status === 2).slice(0, 5);
  const pendingJobs = jobs.filter((job) => job.job_status === 4).slice(0, 5);

  return [
    ...failedJobs.map((job) => mapJobNotification(job, "fail")),
    ...pendingJobs.map((job) => mapJobNotification(job, "wait")),
    ...activities
      .filter((activity) => activity.activity_status === 2 || activity.action.toLowerCase().includes("offline"))
      .map(mapActivityNotification),
  ]
    .sort((left, right) => right.sortTime - left.sortTime)
    .slice(0, 10)
    .map((item) => {
      const { sortTime, ...notification } = item;
      void sortTime;
      return notification;
    });
}

export async function createDevice(payload: DeviceFormPayload): Promise<void> {
  await sendJson("/devices/", "POST", payload);
}

export async function updateDevice(deviceId: number, payload: Partial<DeviceFormPayload>): Promise<void> {
  await sendJson(`/devices/${deviceId}`, "PUT", payload);
}

export async function deleteDevice(deviceId: number): Promise<void> {
  const response = await fetchApi(`/devices/${deviceId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readApiError(response, `API /devices/${deviceId} failed: ${response.status}`));
  }
}

export async function getDeviceBackupPaths(deviceId: number): Promise<DeviceBackupPath[]> {
  return getJson<DeviceBackupPath[]>(`/devices/${deviceId}/paths`);
}

export async function addDeviceBackupPath(deviceId: number, path: string, label?: string): Promise<DeviceBackupPath> {
  return sendJson<DeviceBackupPath>(`/devices/${deviceId}/paths`, "POST", { path, label });
}

export async function deleteDeviceBackupPath(deviceId: number, path: string): Promise<void> {
  const response = await fetchApi(`/devices/${deviceId}/paths?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `API /devices/${deviceId}/paths failed: ${response.status}`));
  }
}

export async function getBackupTargets(deviceId?: number, category?: "robot" | "computer"): Promise<BackupTarget[]> {
  const params = new URLSearchParams();
  if (deviceId) params.set("device_id", String(deviceId));
  if (category) params.set("category", category);
  const query = params.toString() ? `?${params.toString()}` : "";
  return getJson<BackupTarget[]>(`/devices/backup-targets${query}`, 5000);
}

export async function saveCustomBackupPath(path: string, label = ""): Promise<CustomBackupPathResult> {
  const result = await postCustomBackupPath("/backups/auto-paths", path, label);
  if (result.ok) return result.data;

  throw new Error(result.message);
}

export async function deleteCustomBackupPath(path: string): Promise<CustomBackupPathResult> {
  const response = await fetchApi(`/backups/auto-paths?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `API /backups/auto-paths failed: ${response.status}`));
  }

  return response.json() as Promise<CustomBackupPathResult>;
}

export async function saveBackupPathLabel(path: string, label: string): Promise<CustomBackupPathResult> {
  return sendJson<CustomBackupPathResult>("/backups/auto-path-label", "PUT", { path, label });
}

export function backupTargetLabelFromPath(path: string): string {
  const normalizedPath = path.replace(/\/+$/, "");
  return normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
}

export function backupTargetTypeFromPath(path: string): "file" | "directory" {
  if (path.endsWith("/")) return "directory";
  const name = backupTargetLabelFromPath(path);
  return name.includes(".") ? "file" : "directory";
}

export async function listDeviceFiles(deviceId: number, path?: string): Promise<RemoteFile[]> {
  const params = path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : "";
  return getJson<RemoteFile[]>(`/devices/${deviceId}/files${params}`, 30000);
}

export async function checkDeviceStatus(deviceId: number): Promise<DeviceStatusResult> {
  return getJson<DeviceStatusResult>(`/devices/${deviceId}/status`, 8000);
}

export async function runCombinedBackup(payload: CombinedBackupPayload): Promise<BackupRunResult> {
  return sendJson<BackupRunResult>("/backups/combined", "POST", payload);
}

export async function cleanupBackups(payload: BackupCleanupPayload): Promise<BackupCleanupResult> {
  return sendJson<BackupCleanupResult>("/backups/cleanup", "POST", payload);
}

export async function getAutoCleanupSettings(): Promise<AutoCleanupSettings> {
  return getJson<AutoCleanupSettings>("/backups/cleanup/settings", 5000);
}

export async function updateAutoCleanupSettings(payload: AutoCleanupSettingsPayload): Promise<AutoCleanupSettings> {
  return sendJson<AutoCleanupSettings>("/backups/cleanup/settings", "PUT", payload);
}

export async function getAutoBackupSettings(): Promise<AutoBackupSettings> {
  return getJson<AutoBackupSettings>("/backups/auto/settings", 5000);
}

export async function updateAutoBackupSettings(payload: AutoBackupSettingsPayload): Promise<AutoBackupSettings> {
  return sendJson<AutoBackupSettings>("/backups/auto/settings", "PUT", payload);
}

export async function getBackupDetail(backupId: number): Promise<BackupDetail> {
  return getJson<BackupDetail>(`/backups/${backupId}`, 10000);
}

export async function deleteBackup(backupId: number): Promise<void> {
  const response = await fetchApi(`/backups/${backupId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `API /backups/${backupId} failed: ${response.status}`));
  }
}

export function backupDownloadUrl(backupId: number, fileIds: number[] = [], filename = ""): string {
  const queryParts: string[] = [];
  if (API_AUTH_TOKEN) {
    queryParts.push(`token=${encodeURIComponent(API_AUTH_TOKEN)}`);
  }
  fileIds.forEach((fileId) => queryParts.push(`file_ids=${encodeURIComponent(fileId)}`));
  if (filename.trim()) {
    queryParts.push(`filename=${encodeURIComponent(filename.trim())}`);
  }
  const params = queryParts.join("&");
  const publicApiUrl = getApiBaseUrl();
  return `${publicApiUrl}/backups/${backupId}/download${params ? `?${params}` : ""}`;
}

export async function restoreBackup(backupId: number, payload: RestoreRunPayload): Promise<RestoreRunResult> {
  return sendJson<RestoreRunResult>(`/restore/${backupId}`, "POST", payload);
}

export async function uploadFilesToDevice(payload: {
  device_id: number;
  target_path: string;
  files: File[];
  uploaded_by?: number;
}): Promise<UploadRunResult> {
  const formData = new FormData();
  formData.append("device_id", String(payload.device_id));
  formData.append("target_path", payload.target_path);
  if (payload.uploaded_by) formData.append("uploaded_by", String(payload.uploaded_by));
  payload.files.forEach((file) => formData.append("files", file));

  const response = await fetchApi(`/uploads/`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `API /uploads/ failed: ${response.status}`));
  }

  return response.json() as Promise<UploadRunResult>;
}

async function sendJson<T = void>(path: string, method: "POST" | "PUT", payload: unknown): Promise<T> {
  const response = await fetchApi(path, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, `API ${path} failed: ${response.status}`));
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function postCustomBackupPath(path: string, remotePath: string, label: string): Promise<
  | { ok: true; data: CustomBackupPathResult }
  | { ok: false; status: number; message: string }
> {
  const response = await fetchApi(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: remotePath, label: label.trim() || undefined }),
  });

  if (response.ok) {
    return {
      ok: true,
      data: await response.json() as CustomBackupPathResult,
    };
  }

  return {
    ok: false,
    status: response.status,
    message: await readApiError(response, `API ${path} failed: ${response.status}`),
  };
}

export async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? undefined);
  if (API_AUTH_TOKEN) {
    headers.set("Authorization", `Bearer ${API_AUTH_TOKEN}`);
  }

  const baseUrl = getApiBaseUrl();
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
}

export function formatUserFriendlyError(error: unknown, fallback?: string): string {
  let message = "";
  let code = "";
  let detailInfo = "";

  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    message = typeof errObj.message === "string" ? errObj.message : "";
    code = typeof errObj.error_code === "string" ? errObj.error_code : "";
    if (!message && typeof errObj.detail === "string") {
      message = errObj.detail;
    }
  }

  // If message has code in bracket like [SFTP_CONNECTION_FAILED] ...
  const codeMatch = message.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
  if (codeMatch) {
    code = codeMatch[1];
    message = codeMatch[2];
  }

  // Extract trailing device/IP detail if present e.g. (Robot 1 · 192.168.1.10)
  const detailMatch = message.match(/\s*\(([^)]+)\)$/);
  if (detailMatch) {
    detailInfo = ` (${detailMatch[1]})`;
  }

  const normalized = message.toLowerCase();

  // 1. Connection / Network / Socket Errors
  if (normalized.includes("connection refused") || normalized.includes("errno 111")) {
    return `ไม่สามารถเชื่อมต่ออุปกรณ์ได้ (อุปกรณ์ปฏิเสธการเชื่อมต่อ หรือ SSH service ปิดอยู่)${detailInfo}`;
  }
  if (normalized.includes("no route to host") || normalized.includes("errno 113")) {
    return `ไม่พบอุปกรณ์ในเครือข่าย กรุณาตรวจสอบว่าอุปกรณ์เปิดอยู่และอยู่ในวง LAN เดียวกัน${detailInfo}`;
  }
  if (normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("errno 110")) {
    return `การเชื่อมต่อไปยังอุปกรณ์หมดเวลา (อุปกรณ์อาจปิดอยู่หรือไม่ตอบสนอง)${detailInfo}`;
  }
  if (normalized.includes("authentication failed") || normalized.includes("bad authentication")) {
    return `ชื่อผู้ใช้หรือรหัสผ่าน SSH ของอุปกรณ์ไม่ถูกต้อง กรุณาตรวจสอบข้อมูลเข้าสู่ระบบ${detailInfo}`;
  }
  if (normalized.includes("host key verification failed")) {
    return `การยืนยันความปลอดภัย Host Key ของอุปกรณ์ล้มเหลว${detailInfo}`;
  }
  if (normalized.includes("permission denied")) {
    return `ไม่มีสิทธิ์เข้าถึงไฟล์หรือโฟลเดอร์บนอุปกรณ์ (Permission Denied)${detailInfo}`;
  }
  if (normalized.includes("no such file or directory") || normalized.includes("errno 2")) {
    return `ไม่พบไฟล์หรือโฟลเดอร์ที่ระบุบนอุปกรณ์${detailInfo}`;
  }
  if (normalized.includes("no space left") || normalized.includes("disk full") || normalized.includes("errno 28")) {
    return "พื้นที่จัดเก็บข้อมูลบนอุปกรณ์หรือเซิร์ฟเวอร์เต็ม";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("fetch failed")) {
    return "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อเครือข่าย";
  }

  // 2. Specific Error Codes
  if (code === "SFTP_CONNECTION_FAILED" || normalized.includes("sftp connect failed")) {
    return `ไม่สามารถเชื่อมต่อ SFTP ไปยังอุปกรณ์ได้ กรุณาตรวจสอบว่าอุปกรณ์เปิดอยู่และต่อเครือข่ายเรียบร้อย${detailInfo}`;
  }
  if (code === "SSH_CREDENTIALS_MISSING" || normalized.includes("ssh credentials missing")) {
    return `ไม่ได้ระบุชื่อผู้ใช้หรือรหัสผ่าน SSH ของอุปกรณ์นี้ กรุณาแก้ไขข้อมูลอุปกรณ์${detailInfo}`;
  }
  if (code === "ROBOT_DATABASE_CONFIG_MISSING" || normalized.includes("database config missing")) {
    return "ไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูลสำหรับหุ่นยนต์นี้";
  }
  if (code === "DATABASE_CONNECTION_FAILED" || normalized.includes("database connection failed")) {
    return "ไม่สามารถเชื่อมต่อฐานข้อมูลหลักของระบบได้ กรุณาตรวจสอบเซิร์ฟเวอร์ฐานข้อมูล";
  }
  if (code === "AUTO_BACKUP_ALREADY_RUNNING" || code === "JOB_ALREADY_RUNNING" || normalized.includes("already running")) {
    return "กำลังมีการสำรองข้อมูลอื่นทำงานอยู่ กรุณารอสักครู่ให้งานปัจจุบันเสร็จสิ้น";
  }
  if (code === "DEVICE_NOT_FOUND" || (normalized.includes("device") && normalized.includes("not found"))) {
    return "ไม่พบข้อมูลอุปกรณ์นี้ในระบบ";
  }
  if (code === "DEVICE_GROUP_NOT_FOUND") {
    return "ไม่พบกลุ่มอุปกรณ์ที่ระบุในระบบ";
  }
  if (code === "BACKUP_NOT_FOUND" || normalized.includes("backup not found")) {
    return "ไม่พบข้อมูลการสำรองข้อมูลในระบบ";
  }
  if (code === "BACKUP_FILE_NOT_FOUND" || normalized.includes("backup file not found")) {
    return "ไม่พบไฟล์สำรองข้อมูลบนเซิร์ฟเวอร์ (ไฟล์อาจถูกลบหรือย้ายที่อยู่)";
  }
  if (code === "RESOURCE_ALREADY_EXISTS" || normalized.includes("already exists")) {
    if (normalized.includes("code")) return "รหัสอุปกรณ์ (Device Code) นี้มีอยู่ในระบบแล้ว";
    if (normalized.includes("ip")) return "IP Address นี้มีอยู่ในระบบแล้ว";
    return "ข้อมูลนี้มีอยู่ในระบบแล้ว";
  }
  if (code === "INVALID_IP_ADDRESS" || normalized.includes("invalid ip")) {
    return "รูปแบบ IP Address ไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง";
  }
  if (code === "INVALID_LOGIN" || normalized.includes("ชื่อ หรือ รหัสไม่ถูกต้อง")) {
    return "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง";
  }
  if (code === "VALIDATION_ERROR" || normalized.includes("validation failed")) {
    return "ข้อมูลที่ระบุไม่ถูกต้องหรือไม่ครบถ้วน กรุณาตรวจสอบข้อมูลที่กรอก";
  }
  if (code === "TARGET_PATH_REQUIRED" || code === "SELECTION_REQUIRED") {
    return "กรุณาเลือกไฟล์หรือโฟลเดอร์เป้าหมายอย่างน้อย 1 รายการ";
  }

  // 3. HTTP status pattern
  const statusMatch = message.match(/failed:\s*(\d{3})/i);
  if (statusMatch) {
    const statusCode = statusMatch[1];
    if (statusCode === "401") return "เซสชันหมดอายุหรือไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบใหม่";
    if (statusCode === "403") return "คุณไม่มีสิทธิ์ในการดำเนินการนี้";
    if (statusCode === "404") return "ไม่พบข้อมูลที่ต้องการบนเซิร์ฟเวอร์ (404)";
    if (statusCode === "409") return "ข้อมูลมีความขัดแย้ง หรือมีการทำงานซ้ำซ้อนกันอยู่ในขณะนี้";
    if (statusCode === "500") return "เซิร์ฟเวอร์เกิดข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง";
    if (statusCode === "502" || statusCode === "503") return "ระบบเซิร์ฟเวอร์ปลายทางไม่พร้อมให้บริการในขณะนี้";
  }

  // 4. Fallback
  if (fallback && fallback.trim()) {
    return fallback;
  }

  return message || "เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง";
}

export function getErrorMessage(errorResponse: unknown, fallback?: string): string {
  return formatUserFriendlyError(errorResponse, fallback);
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const data = await response.json() as ApiErrorResponse;
      const message = data.message || (typeof data.detail === "string" ? data.detail : "");
      const detail = formatApiErrorDetail(data.detail);
      const combined = message ? `${message}${detail}` : fallback;
      return formatUserFriendlyError({ error_code: data.error_code, message: combined, detail: data.detail }, fallback);
    } catch {
      return formatUserFriendlyError(fallback);
    }
  }

  const text = await response.text();
  return formatUserFriendlyError(text || fallback);
}

function formatApiErrorDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";

  const data = detail as Record<string, unknown>;
  const parts = [
    typeof data.device_name === "string" ? data.device_name : "",
    typeof data.ip_address === "string" ? data.ip_address : "",
    typeof data.remote_path === "string" ? data.remote_path : "",
  ].filter(Boolean);

  return parts.length ? ` (${parts.join(" · ")})` : "";
}

function mapDevice(device: ApiDevice, pendingDeviceIds: Set<number>): Device {
  return {
    id: device.device_id,
    groupId: device.group_id,
    code: device.device_code,
    rawStatus: device.device_status,
    autoBackupEnabled: device.auto_backup_enabled ?? true,
    name: device.device_name,
    group: device.group_name ?? inferDeviceGroup(device.device_name, device.device_code),
    ip: device.ip_address,
    status: pendingDeviceIds.has(device.device_id) ? "pending" : mapDeviceStatus(device.device_status),
    lastSeen: formatTime(device.last_seen_at),
    hasSshOverride: device.has_ssh_override ?? false,
    sshUsername: device.ssh_username ?? undefined,
    sshPort: device.ssh_port ?? undefined,
  };
}

function mapDeviceStatus(deviceStatus: number): DeviceStatus {
  return deviceStatus === 1 ? "online" : "offline";
}

function inferDeviceGroup(deviceName: string, deviceCode: string): string {
  const value = `${deviceName} ${deviceCode}`.toUpperCase();
  if (value.includes("SMRL") || /\bSMR\d+L\b/.test(value)) return "SMRL";
  if (value.includes("SMR")) return "SMR";
  return "AMR";
}

function mapBackup(backup: ApiBackup): Backup {
  return {
    id: backup.backup_id,
    deviceId: backup.device_id,
    name: backup.backup_name,
    device: backup.device_name ?? `Device #${backup.device_id}`,
    type: mapBackupType(backup.backup_type),
    files: backup.total_file,
    size: `${Number(backup.total_size_mb).toFixed(2)} MB`,
    status: mapBackupStatus(backup.backup_status),
    createdAt: formatDateTime(backup.created_at),
    createdAtRaw: backup.created_at,
  };
}

function mapBackupType(backupType: number): string {
  if (backupType === 0) return "Full";
  if (backupType === 2) return "Auto";
  return "Selected";
}

function mapBackupStatus(backupStatus: number): JobStatus {
  if (backupStatus === 0) return "running";
  if (backupStatus === 1) return "success";
  return "failed";
}

function mapJob(job: ApiJob): Job {
  const message = job.job_message ?? "";
  const deviceLabel = job.device_name || (job.device_id ? `Device #${job.device_id}` : "Fleet");
  return {
    id: job.job_id,
    deviceId: job.device_id,
    backupId: job.backup_id,
    device: deviceLabel,
    type: job.job_type.replaceAll("_", " "),
    target: message || `checked ${job.checked_devices}/${job.total_devices}`,
    status: mapJobStatus(job.job_status),
    time: formatTime(job.started_at ?? job.updated_at),
    updatedAt: formatTime(job.updated_at),
    finishedAt: job.finished_at ? formatTime(job.finished_at) : "-",
    progress: mapJobProgress(job.job_status),
    checkedDevices: job.checked_devices,
    totalDevices: job.total_devices,
    onlineDevices: job.online_devices,
    offlineDevices: job.offline_devices,
    backupsCreated: job.backups_created,
    failedDevices: job.failed_devices,
    retryCount: job.retry_count,
    maxRetries: job.max_retries,
    message,
  };
}

function mapJobStatus(jobStatus: number): JobStatus {
  if (jobStatus === 0) return "running";
  if (jobStatus === 1) return "success";
  if (jobStatus === 2) return "failed";
  if (jobStatus === 3) return "skipped";
  return "pending";
}

function mapJobProgress(jobStatus: number): number {
  if (jobStatus === 1) return 100;
  if (jobStatus === 4) return 0;
  if (jobStatus === 3) return 12;
  if (jobStatus === 2) return 20;
  return 55;
}

function mapActivity(activity: ApiActivity): Activity {
  const deviceLabel = activity.device_name || (activity.device_id ? `Device #${activity.device_id}` : "-");
  return {
    id: activity.log_id,
    kind: mapActivityKind(activity.activity_status),
    text: activity.action,
    meta: activity.activity_message ?? deviceLabel,
    time: formatTime(activity.created_at),
    action: activity.action,
    status: mapActivityStatusLabel(activity.activity_status),
    device: deviceLabel,
    backup: activity.backup_id ? `Backup #${activity.backup_id}` : "-",
  };
}

function mapActivityKind(activityStatus: number): ActivityKind {
  if (activityStatus === 1) return "ok";
  if (activityStatus === 2) return "fail";
  if (activityStatus === 0) return "run";
  return "wait";
}

function mapActivityStatusLabel(activityStatus: number): string {
  if (activityStatus === 1) return "Success";
  if (activityStatus === 2) return "Failed";
  if (activityStatus === 0) return "Running";
  return "Pending";
}

function mapJobNotification(job: ApiJob, tone: NotificationItem["tone"]): NotificationItem & { sortTime: number } {
  const timeValue = job.updated_at ?? job.started_at;
  const deviceLabel = job.device_name || (job.device_id ? `Device #${job.device_id}` : "Fleet");
  return {
    id: `job-${job.job_id}`,
    title: tone === "fail" ? "Job failed" : "Job pending",
    detail: job.job_message ?? `${job.job_type.replaceAll("_", " ")} · ${deviceLabel}`,
    tone,
    time: formatDateTime(timeValue),
    sortTime: toTime(timeValue),
  };
}

function mapActivityNotification(activity: ApiActivity): NotificationItem & { sortTime: number } {
  const deviceLabel = activity.device_name || (activity.device_id ? `Device #${activity.device_id}` : "-");
  return {
    id: `activity-${activity.log_id}`,
    title: activity.action,
    detail: activity.activity_message ?? deviceLabel,
    tone: activity.activity_status === 2 ? "fail" : "info",
    time: formatDateTime(activity.created_at),
    sortTime: toTime(activity.created_at),
  };
}

function formatTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toTime(value?: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
