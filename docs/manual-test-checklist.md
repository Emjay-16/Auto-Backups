# Manual Test Checklist

ใช้เช็คก่อนใช้งานจริงกับหุ่น หรือหลังแก้ backup/restore logic

## เตรียมระบบ

- Backend เปิดได้ที่ FastAPI docs และไม่มี error ตอน startup
- Frontend เข้าได้จากเครื่อง server และเครื่องอื่นในวง LAN
- Login user เดียวกันจาก 2 เครื่องได้ และ session หมดอายุแล้วกลับไปหน้า login
- หน้า Dashboard, Devices, Backups, Restore, Jobs, Activity Logs โหลดข้อมูลได้

## Manual Backup

- เลือกหุ่นออนไลน์ 1 ตัว แล้วกด New backup พร้อมตั้งชื่อ backup
- เลือก path แบบไฟล์ เช่น `flows.json` แล้ว backup สำเร็จ
- เลือก path แบบโฟลเดอร์ เช่น `maps` แล้ว backup เป็น zip หรือโครงสร้างไฟล์ครบ
- เลือก database JSON แล้วมีไฟล์ JSON ที่เปิดอ่านได้
- Download backup แบบเลือกบางไฟล์แล้วชื่อ zip ตรงกับชื่อที่ตั้ง

## Auto Backup

- เปิด Auto backup และตั้ง interval ทดสอบสั้น
- รอบแรกควรสร้าง backup ถ้ายังไม่มี manifest เดิม
- รอบถัดไปถ้าไฟล์ไม่เปลี่ยน ไม่ควรสร้าง backup ใหม่
- แก้ไฟล์ปลายทางจริง แล้วรอบถัดไปควรสร้าง backup ใหม่
- หุ่น offline retry ตาม config ครบแล้ว job เป็น skipped และ device เป็น offline

## Restore

- Restore `flows.json` กลับ path เดิม
- Restore zip โฟลเดอร์ maps ไปยัง target folder แล้วไฟล์ด้านในครบ
- Restore database JSON แล้วข้อมูลกลับเข้า MySQL table จริง
- เลือกบางไฟล์ใน popup แล้ว restore เฉพาะไฟล์ที่เลือก
- ถ้าไฟล์ธรรมดาไม่มี target path ต้องขึ้น error ชัดเจน

## Upload

- เลือกโหมด Upload
- เลือก device และ target path
- อัปโหลดหลายไฟล์แล้วปลายทางมีไฟล์ครบ

## Logs & Jobs

- Jobs แสดง running, success, skipped, failed พร้อม device/message
- Activity Logs เลือกวันที่ได้ และ default เป็นวันนี้
- Backup/restore/delete ต้องมี log ที่อ่านเข้าใจง่าย
