"""add per-device SSH credentials and backup paths

Revision ID: 003_device_ssh_paths
Revises: 002_device_auto_backup
Create Date: 2026-09-03
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "003_device_ssh_paths"
down_revision = "002_device_auto_backup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add per-device SSH override columns to the devices table
    op.add_column("devices", sa.Column("ssh_username", sa.Text(), nullable=True))
    op.add_column("devices", sa.Column("ssh_password_encrypted", sa.Text(), nullable=True))
    op.add_column("devices", sa.Column("ssh_port", sa.Integer(), nullable=True))

    # Create the new device_backup_paths table
    op.create_table(
        "device_backup_paths",
        sa.Column("device_backup_path_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.device_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("device_backup_path_id"),
        sa.UniqueConstraint("device_id", "path", name="uq_device_backup_paths_device_path"),
    )
    op.create_index(
        "ix_device_backup_paths_device_id",
        "device_backup_paths",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_backup_paths_device_backup_path_id",
        "device_backup_paths",
        ["device_backup_path_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_device_backup_paths_device_backup_path_id", table_name="device_backup_paths")
    op.drop_index("ix_device_backup_paths_device_id", table_name="device_backup_paths")
    op.drop_table("device_backup_paths")
    op.drop_column("devices", "ssh_port")
    op.drop_column("devices", "ssh_password_encrypted")
    op.drop_column("devices", "ssh_username")

