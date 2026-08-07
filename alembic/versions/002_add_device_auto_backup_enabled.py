"""add device auto backup enabled

Revision ID: 002_device_auto_backup
Revises: 001_add_backup_jobs_and_locks
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "002_device_auto_backup"
down_revision: Union[str, None] = "001_add_backup_jobs_and_locks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("auto_backup_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column("devices", "auto_backup_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("devices", "auto_backup_enabled")
