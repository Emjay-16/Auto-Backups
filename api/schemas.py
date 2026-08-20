from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from api import constants


class UserBase(BaseModel):
    user_name: str
    role: int


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    user_id: int


class LoginRequest(BaseModel):
    user_name: str
    password: str


class LoginResponse(BaseModel):
    user_id: int
    user_name: str
    role: int
    message: str


class DeviceGroupBase(BaseModel):
    group_name: str


class DeviceGroupCreate(DeviceGroupBase):
    pass


class DeviceGroupResponse(DeviceGroupBase):
    model_config = ConfigDict(from_attributes=True)

    group_id: int


class DeviceBase(BaseModel):
    group_id: int
    device_code: str
    device_name: str
    ip_address: str
    device_status: int
    auto_backup_enabled: bool = True
    last_seen_at: Optional[datetime] = None


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    group_id: Optional[int] = None
    device_code: Optional[str] = None
    device_name: Optional[str] = None
    ip_address: Optional[str] = None
    device_status: Optional[int] = None
    auto_backup_enabled: Optional[bool] = None
    last_seen_at: Optional[datetime] = None


class DeviceResponse(DeviceBase):
    model_config = ConfigDict(from_attributes=True)

    device_id: int
    created_at: datetime
    updated_at: datetime


class DeviceNameResponse(BaseModel):
    device_name: str


class DeviceStatusResponse(BaseModel):
    device_id: Optional[int] = None
    ip_address: str
    device_name: str
    online: bool
    device_status: int
    last_seen_at: Optional[datetime] = None
    message: str


class RemoteFileResponse(BaseModel):
    name: str
    path: str
    file_type: str
    size_bytes: Optional[int] = None
    modified_at: Optional[datetime] = None


class RemotePathCheckResponse(BaseModel):
    device_id: int
    device_name: str
    ip_address: str
    path: str
    exists: bool
    file_count: int = 0
    message: str


class BackupTargetResponse(BaseModel):
    key: str
    label: str
    path: str
    target_type: str
    browsable: bool = False
    backup_api: str = "file"
    removable: bool = False


class CustomBackupPathRequest(BaseModel):
    path: str
    label: Optional[str] = None


class CustomBackupPathResponse(BaseModel):
    path: str
    label: str
    message: str


class BackupPathLabelRequest(BaseModel):
    path: str
    label: str


class DeviceSeedResponse(BaseModel):
    created_groups: int
    created_devices: int
    skipped_devices: int
    message: str


class BackupBase(BaseModel):
    device_id: int
    backup_name: str
    backup_type: int
    backup_status: int
    total_file: int
    total_size_mb: Decimal
    created_by: int


class BackupCreate(BackupBase):
    pass


class BackupResponse(BackupBase):
    model_config = ConfigDict(from_attributes=True)

    backup_id: int
    created_at: datetime
    updated_at: datetime


class BackupHistoryResponse(BackupResponse):
    device_name: Optional[str] = None
    ip_address: Optional[str] = None


class BackupRunResponse(BaseModel):
    backup_id: Optional[int] = None
    backup_name: str
    device_id: Optional[int] = None
    ip_address: str
    device_name: str
    total_file: int
    total_size_mb: Decimal
    local_path: str
    zip_path: Optional[str] = None
    message: str


class AutoBackupRequest(BaseModel):
    created_by: Optional[int] = None
    device_ids: Optional[List[int]] = None
    remote_paths: Optional[List[str]] = None
    zip_output: bool = False
    force_full_backup: bool = False
    full_baseline_interval_days: int = 30


class AutoBackupItemResponse(BaseModel):
    device_id: int
    ip_address: str
    device_name: str
    remote_path: str
    online: bool
    changed: bool
    backup_id: Optional[int] = None
    remote_modified_at: Optional[datetime] = None
    remote_checksum: Optional[str] = None
    message: str


class AutoBackupResponse(BaseModel):
    job_id: Optional[int] = None
    checked_devices: int
    skipped_offline: int
    online_devices: int = 0
    backups_created: int
    failed_devices: int = 0
    items: List[AutoBackupItemResponse]


class AutoBackupSettingsResponse(BaseModel):
    enabled: bool
    interval_hours: int
    full_baseline_interval_days: int
    zip_output: bool
    run_on_startup: bool


class AutoBackupSettingsRequest(BaseModel):
    enabled: Optional[bool] = None
    interval_hours: Optional[int] = None
    full_baseline_interval_days: Optional[int] = None
    zip_output: Optional[bool] = None
    run_on_startup: Optional[bool] = None


class BackupJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: int
    job_type: str
    job_status: int
    device_id: Optional[int] = None
    backup_id: Optional[int] = None
    requested_by: Optional[int] = None
    total_devices: int
    checked_devices: int
    online_devices: int
    offline_devices: int
    backups_created: int
    failed_devices: int
    retry_count: int
    max_retries: int
    job_message: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    updated_at: datetime


class BackupDeleteResponse(BaseModel):
    backup_id: int
    deleted_files: int
    message: str


class BackupCleanupRequest(BaseModel):
    older_than_days: int = 90
    older_than_hours: Optional[int] = None
    keep_latest_per_device: bool = True


class BackupCleanupItemResponse(BaseModel):
    backup_id: int
    device_id: int
    backup_name: str
    created_at: datetime
    deleted: bool
    reason: str


class BackupCleanupResponse(BaseModel):
    older_than_days: int
    older_than_hours: Optional[int] = None
    candidates: int
    deleted: int
    skipped: int
    items: List[BackupCleanupItemResponse]


class AutoCleanupSettingsRequest(BaseModel):
    enabled: Optional[bool] = None
    older_than_days: Optional[int] = None
    older_than_hours: Optional[int] = None
    interval_hours: Optional[int] = None
    keep_latest_per_device: Optional[bool] = None


class AutoCleanupSettingsResponse(BaseModel):
    enabled: bool
    older_than_days: int
    older_than_hours: int
    interval_hours: int
    keep_latest_per_device: bool


class CombinedBackupRequest(BaseModel):
    device_id: Optional[int] = None
    ip_address: Optional[str] = None
    device_name: Optional[str] = None
    remote_paths: List[str] = []
    include_database: bool = False
    created_by: Optional[int] = None
    backup_name: Optional[str] = None
    backup_type: int = constants.BACKUP_TYPE_SELECTED
    zip_output: bool = False


class RestoreFileItemRequest(BaseModel):
    backup_file_id: int
    target_path: str


class RestoreRunRequest(BaseModel):
    restored_by: int
    device_id: Optional[int] = None
    target_path: Optional[str] = None
    restore_type: int = 1
    items: Optional[List[RestoreFileItemRequest]] = None


class RestoreRunResponse(BaseModel):
    restore_id: int
    backup_id: int
    device_id: int
    total_file: int
    message: str


class UploadedFileResponse(BaseModel):
    file_name: str
    target_path: str
    file_size_mb: Decimal


class UploadRunResponse(BaseModel):
    device_id: int
    ip_address: str
    device_name: str
    target_path: str
    total_file: int
    files: List[UploadedFileResponse]
    message: str


class BackupFileBase(BaseModel):
    backup_id: int
    file_name: str
    file_path: str
    file_type: str
    file_size_mb: Decimal
    checksum: Optional[str] = None
    file_status: int


class BackupFileCreate(BackupFileBase):
    pass


class BackupFileResponse(BackupFileBase):
    model_config = ConfigDict(from_attributes=True)

    backup_file_id: int
    created_at: datetime
    remote_path: Optional[str] = None


class BackupDetailResponse(BackupHistoryResponse):
    files: List[BackupFileResponse]


class RestoreLogBase(BaseModel):
    backup_id: int
    device_id: int
    restored_by: int
    restore_type: int
    restore_log_status: int
    restore_message: Optional[str] = None
    finished_at: Optional[datetime] = None


class RestoreLogCreate(RestoreLogBase):
    pass


class RestoreLogResponse(RestoreLogBase):
    model_config = ConfigDict(from_attributes=True)

    restore_id: int
    restored_at: datetime


class RestoreItemBase(BaseModel):
    restore_id: int
    backup_file_id: int
    file_name: str
    target_path: str
    restore_item_status: int
    message: Optional[str] = None


class RestoreItemCreate(RestoreItemBase):
    pass


class RestoreItemResponse(RestoreItemBase):
    model_config = ConfigDict(from_attributes=True)

    restore_item_id: int
    created_at: datetime


class ActivityLogBase(BaseModel):
    user_id: int
    device_id: int
    backup_id: Optional[int] = None
    action: str
    activity_status: int
    activity_message: Optional[str] = None


class ActivityLogCreate(ActivityLogBase):
    pass


class ActivityLogResponse(ActivityLogBase):
    model_config = ConfigDict(from_attributes=True)

    log_id: int
    created_at: datetime
