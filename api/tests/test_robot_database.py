from api.services.robot_database import (
    _build_replace_table_sql,
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


def test_build_replace_table_sql_uses_transaction_and_escapes_values():
    sql = _build_replace_table_sql(
        "ros_maps",
        [
            {"id": "1", "name": "Map's home", "note": "line\nbreak"},
            {"id": "2", "name": None, "note": "ok"},
        ],
    )

    assert "START TRANSACTION;" in sql
    assert "DELETE FROM `ros_maps`;" in sql
    assert "INSERT INTO `ros_maps` (`id`, `name`, `note`) VALUES" in sql
    assert "'Map\\'s home'" in sql
    assert "'line\\nbreak'" in sql
    assert "NULL" in sql
    assert "COMMIT;" in sql
