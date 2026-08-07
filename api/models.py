from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from api.database import Base

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("user_name", name="uq_users_user_name"),
    )

    user_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_name = Column(Text, nullable=False)
    password = Column(Text, nullable=False)
    role = Column(Integer, nullable=False)

    backups = relationship("Backup", back_populates="creator")
    backup_jobs = relationship("BackupJob", back_populates="requester")
    restore_logs = relationship("RestoreLog", back_populates="restorer")
    activity_logs = relationship("ActivityLog", back_populates="user")


class DeviceGroup(Base):
    __tablename__ = "device_groups"
    __table_args__ = (
        UniqueConstraint("group_name", name="uq_device_groups_group_name"),
    )

    group_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    group_name = Column(Text, nullable=False)

    devices = relationship("Device", back_populates="group")


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("device_code", name="uq_devices_device_code"),
        UniqueConstraint("ip_address", name="uq_devices_ip_address"),
        Index("ix_devices_group_id", "group_id"),
    )

    device_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("device_groups.group_id"), nullable=False)
    device_code = Column(Text, nullable=False)
    device_name = Column(Text, nullable=False)
    ip_address = Column(Text, nullable=False)
    device_status = Column(Integer, nullable=False, default=0)
    auto_backup_enabled = Column(Boolean, nullable=False, default=True)
    last_seen_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    group = relationship("DeviceGroup", back_populates="devices")
    backups = relationship("Backup", back_populates="device")
    backup_jobs = relationship("BackupJob", back_populates="device")
    restore_logs = relationship("RestoreLog", back_populates="device")
    activity_logs = relationship("ActivityLog", back_populates="device")


class Backup(Base):
    __tablename__ = "backups"
    __table_args__ = (
        Index("ix_backups_device_created_at", "device_id", "created_at"),
        Index("ix_backups_created_by", "created_by"),
    )

    backup_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id = Column(Integer, ForeignKey("devices.device_id"), nullable=False)
    backup_name = Column(Text, nullable=False)
    backup_type = Column(Integer, nullable=False)
    backup_status = Column(Integer, nullable=False)
    total_file = Column(Integer, nullable=False)
    total_size_mb = Column(Numeric(10, 2), nullable=False)
    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    device = relationship("Device", back_populates="backups")
    creator = relationship("User", back_populates="backups")
    files = relationship("BackupFile", back_populates="backup")
    restore_logs = relationship("RestoreLog", back_populates="backup")
    activity_logs = relationship("ActivityLog", back_populates="backup")
    jobs = relationship("BackupJob", back_populates="backup")


class BackupJob(Base):
    __tablename__ = "backup_jobs"
    __table_args__ = (
        Index("ix_backup_jobs_status_created_at", "job_status", "started_at"),
        Index("ix_backup_jobs_device_created_at", "device_id", "started_at"),
    )

    job_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    job_type = Column(Text, nullable=False)
    job_status = Column(Integer, nullable=False)
    device_id = Column(Integer, ForeignKey("devices.device_id"))
    backup_id = Column(Integer, ForeignKey("backups.backup_id"))
    requested_by = Column(Integer, ForeignKey("users.user_id"))
    total_devices = Column(Integer, nullable=False, default=0)
    checked_devices = Column(Integer, nullable=False, default=0)
    online_devices = Column(Integer, nullable=False, default=0)
    offline_devices = Column(Integer, nullable=False, default=0)
    backups_created = Column(Integer, nullable=False, default=0)
    failed_devices = Column(Integer, nullable=False, default=0)
    retry_count = Column(Integer, nullable=False, default=0)
    max_retries = Column(Integer, nullable=False, default=0)
    job_message = Column(Text)
    started_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime)
    updated_at = Column(DateTime, nullable=False)

    device = relationship("Device", back_populates="backup_jobs")
    backup = relationship("Backup", back_populates="jobs")
    requester = relationship("User", back_populates="backup_jobs")


class JobLock(Base):
    __tablename__ = "job_locks"

    lock_name = Column(Text, primary_key=True)
    locked_by = Column(Text, nullable=False)
    locked_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class BackupFile(Base):
    __tablename__ = "backup_files"
    __table_args__ = (
        Index("ix_backup_files_backup_id", "backup_id"),
    )

    backup_file_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    backup_id = Column(Integer, ForeignKey("backups.backup_id"), nullable=False)
    file_name = Column(Text, nullable=False)
    file_path = Column(Text, nullable=False)
    file_type = Column(Text, nullable=False)
    file_size_mb = Column(Numeric(10, 2), nullable=False)
    checksum = Column(Text)
    file_status = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False)

    backup = relationship("Backup", back_populates="files")
    restore_items = relationship("RestoreItem", back_populates="backup_file")


class RestoreLog(Base):
    __tablename__ = "restore_logs"
    __table_args__ = (
        Index("ix_restore_logs_backup_id", "backup_id"),
        Index("ix_restore_logs_device_id", "device_id"),
    )

    restore_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    backup_id = Column(Integer, ForeignKey("backups.backup_id"), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.device_id"), nullable=False)
    restored_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    restore_type = Column(Integer, nullable=False)
    restore_log_status = Column(Integer, nullable=False)
    restore_message = Column(Text)
    restored_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime)

    backup = relationship("Backup", back_populates="restore_logs")
    device = relationship("Device", back_populates="restore_logs")
    restorer = relationship("User", back_populates="restore_logs")
    items = relationship("RestoreItem", back_populates="restore_log")


class RestoreItem(Base):
    __tablename__ = "restore_items"
    __table_args__ = (
        Index("ix_restore_items_restore_id", "restore_id"),
    )

    restore_item_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restore_id = Column(Integer, ForeignKey("restore_logs.restore_id"), nullable=False)
    backup_file_id = Column(Integer, ForeignKey("backup_files.backup_file_id"), nullable=False)
    file_name = Column(Text, nullable=False)
    target_path = Column(Text, nullable=False)
    restore_item_status = Column(Integer, nullable=False)
    message = Column(Text)
    created_at = Column(DateTime, nullable=False)

    restore_log = relationship("RestoreLog", back_populates="items")
    backup_file = relationship("BackupFile", back_populates="restore_items")


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_user_created_at", "user_id", "created_at"),
        Index("ix_activity_logs_device_created_at", "device_id", "created_at"),
    )

    log_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.device_id"), nullable=False)
    backup_id = Column(Integer, ForeignKey("backups.backup_id"))
    action = Column(Text, nullable=False)
    activity_status = Column(Integer, nullable=False)
    activity_message = Column(Text)
    created_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="activity_logs")
    device = relationship("Device", back_populates="activity_logs")
    backup = relationship("Backup", back_populates="activity_logs")
