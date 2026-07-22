from api.services.robot_database import (
    _database_payload_checksum,
    _mysql_batch_output_to_rows,
)


def test_mysql_batch_output_to_rows_parses_nulls_and_values():
    output = "id\tname\tdescription\n1\tG2F\tNULL\n2\tMap\ttext\n"

    rows = _mysql_batch_output_to_rows(output)

    assert rows == [
        {"id": "1", "name": "G2F", "description": None},
        {"id": "2", "name": "Map", "description": "text"},
    ]


def test_database_checksum_ignores_dump_time_and_is_stable():
    rows = [{"id": "1", "name": "G2F"}]

    first = _database_payload_checksum("istuvd", "ros_maps", rows)
    second = _database_payload_checksum("istuvd", "ros_maps", rows)

    assert first == second
    assert first != _database_payload_checksum("istuvd", "ros_maps", [{"id": "2"}])
