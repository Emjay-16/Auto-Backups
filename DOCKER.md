# รัน Auto Backup ด้วย Docker

ชุดนี้ใช้ Docker Compose แยกเป็น 3 service:

- `db`: PostgreSQL และ volume ชื่อ `postgres_data`
- `api`: FastAPI ที่ port `8000` และเก็บ backup/config ผ่าน `./storage`
- `web`: Next.js production ที่ port `3000`

## เตรียมเครื่อง

ติดตั้ง Docker Engine และ Docker Compose plugin แล้วตรวจสอบ:

```bash
docker --version
docker compose version
```

## เริ่มใช้งานครั้งแรก

รันจากโฟลเดอร์โปรเจกต์ `/home/dev/Documents/auto_backup`:

```bash
cp .env.example .env
```

เปิด `.env` แล้วเปลี่ยนอย่างน้อย:

- `POSTGRES_PASSWORD`
- `AUTH_SECRET`
- `API_AUTH_TOKEN` ถ้าจะเปิด token authentication
- ค่า `ROBOT_SSH_*` และ `ROBOT_DB_*` สำหรับการเชื่อมต่อ robot จริง

สร้าง secret แบบสุ่มได้ด้วย:

```bash
openssl rand -hex 32
```

เริ่มระบบ:

```bash
docker compose up -d --build
```

เปิดใช้งานที่:

- Web: http://localhost:3000
- API health/root: http://localhost:8000/
- API docs: http://localhost:8000/docs

ดูสถานะและ log:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
```

## หยุดและเริ่มใหม่

หยุด container แต่เก็บข้อมูล:

```bash
docker compose stop
```

เริ่มใหม่:

```bash
docker compose start
```

หยุดและลบ container/network แต่ไม่ลบ volume:

```bash
docker compose down
```

ลบข้อมูล PostgreSQL ด้วย ต้องใช้คำสั่งนี้เท่านั้นเมื่อยอมรับการลบฐานข้อมูลแล้ว:

```bash
docker compose down -v
```

## อัปเดตโค้ด

```bash
git pull
docker compose up -d --build
```

## ข้อมูลถาวร

- ไฟล์ backup และ config อยู่ที่ `storage/` บนเครื่อง host
- PostgreSQL อยู่ใน Docker volume `postgres_data`
- การลบ container ด้วย `docker compose down` จะไม่ลบข้อมูลสองส่วนนี้

สำรองข้อมูลก่อนย้ายเครื่อง:

```bash
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
tar -czf storage-backup.tar.gz storage
```

## Migration

`docker-entrypoint.sh` รองรับการรัน `alembic upgrade head` เมื่อ image มีทั้ง `alembic.ini` และโฟลเดอร์ `alembic/` แต่ checkout นี้ไม่มีไฟล์ migration ดังกล่าวและ Dockerfile จึงไม่รวม migration เข้า image

ดังนั้นฐานข้อมูล PostgreSQL ใหม่จะยังไม่มี schema จนกว่าจะ restore database เดิมหรือเพิ่ม migration/schema ก่อนใช้งานจริง หากใช้ฐานข้อมูลเดิม ให้ตั้ง `POSTGRESQL_DB` ใน `.env` เป็น connection string ที่ถูกต้อง และตั้ง `RUN_ALEMBIC_MIGRATIONS=false`.

## ใช้ฐานข้อมูลภายนอก

ถ้าไม่ต้องการให้ Compose สร้าง PostgreSQL ให้แก้ `docker-compose.yml` โดยเอา service `db` และ `depends_on.api.db` ออก แล้วตั้งค่าใน `.env`:

```dotenv
POSTGRESQL_DB=postgresql+psycopg2://user:password@host:5432/database
```

API ต้องเข้าถึง host นั้นได้จาก container และต้องเปิด port/firewall ให้เรียบร้อย

## หมายเหตุเรื่อง URL และ token

`NEXT_PUBLIC_API_URL` ถูกฝังลงใน frontend ตอน build ดังนั้นต้องตั้งเป็น URL ที่ browser ของผู้ใช้เข้าถึงได้ ไม่ใช่ `http://api:8000` เพราะชื่อนี้ใช้ได้เฉพาะระหว่าง container เท่านั้น

ถ้าเปลี่ยน `NEXT_PUBLIC_API_URL`, `API_AUTH_TOKEN` หรือ `AUTH_SECRET` ให้ rebuild:

```bash
docker compose up -d --build
```
