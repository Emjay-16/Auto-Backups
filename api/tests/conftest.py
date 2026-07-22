from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api import constants, models
from api.database import Base


@pytest.fixture()
def db_session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def sample_user_device(db_session):
    now = datetime.now()
    group = models.DeviceGroup(group_name="AMR")
    user = models.User(
        user_name="system",
        password="system",
        role=constants.ROLE_ADMIN,
    )
    db_session.add_all([group, user])
    db_session.flush()

    device = models.Device(
        group_id=group.group_id,
        device_code="AMR-001",
        device_name="AMR01",
        ip_address="172.30.39.101",
        device_status=constants.DEVICE_STATUS_ONLINE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(device)
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(device)
    return user, device
