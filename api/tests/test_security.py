from api import constants
from api.security import (
    create_access_token,
    hash_password,
    password_needs_rehash,
    verify_password,
)


def test_hash_password_verifies_and_needs_no_rehash():
    hashed = hash_password("secret-password")

    assert hashed != "secret-password"
    assert verify_password("secret-password", hashed)
    assert not verify_password("wrong-password", hashed)
    assert not password_needs_rehash(hashed)


def test_plain_password_is_temporarily_supported_for_migration():
    assert verify_password("legacy", "legacy")
    assert password_needs_rehash("legacy")


def test_create_access_token_contains_signed_user(sample_user_device):
    user, _ = sample_user_device
    user.role = constants.ROLE_ADMIN

    token = create_access_token(user)

    assert token.count(".") == 2
