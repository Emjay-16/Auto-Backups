"""add backup jobs and job locks

Revision ID: 001_add_backup_jobs_and_locks
Revises: None
Create Date: 2026-07-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "001_add_backup_jobs_and_locks"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "backup_jobs",
        sa.Column("job_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_type", sa.Text(), nullable=False),
        sa.Column("job_status", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("backup_id", sa.Integer(), nullable=True),
        sa.Column("requested_by", sa.Integer(), nullable=True),
        sa.Column("total_devices", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checked_devices", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("online_devices", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("offline_devices", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("backups_created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_devices", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("job_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["backup_id"], ["backups.backup_id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.ForeignKeyConstraint(["requested_by"], ["users.user_id"]),
        sa.PrimaryKeyConstraint("job_id"),
    )
    op.create_index("ix_backup_jobs_job_id", "backup_jobs", ["job_id"])
    op.create_index(
        "ix_backup_jobs_status_created_at",
        "backup_jobs",
        ["job_status", "started_at"],
    )
    op.create_index(
        "ix_backup_jobs_device_created_at",
        "backup_jobs",
        ["device_id", "started_at"],
    )

    op.create_table(
        "job_locks",
        sa.Column("lock_name", sa.Text(), nullable=False),
        sa.Column("locked_by", sa.Text(), nullable=False),
        sa.Column("locked_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("lock_name"),
    )


def downgrade() -> None:
    op.drop_table("job_locks")
    op.drop_index("ix_backup_jobs_device_created_at", table_name="backup_jobs")
    op.drop_index("ix_backup_jobs_status_created_at", table_name="backup_jobs")
    op.drop_index("ix_backup_jobs_job_id", table_name="backup_jobs")
    op.drop_table("backup_jobs")
