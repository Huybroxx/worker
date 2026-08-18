# Bear Gadget MQTT Worker

Worker độc lập, chạy liên tục để:

- Giữ kết nối MQTT (TLS) tới broker, subscribe `gift/device/+/status` và `gift/device/+/audio`
- Ghi mọi message nhận được vào collection `mqtt_messages` (tự xoá sau 7 ngày)
- Cập nhật trạng thái thiết bị (`status`, `battery_level`, `firmware_version`, `last_seen_at`)
- Quét định kỳ và đánh dấu `offline` các thiết bị mất heartbeat

Folder này hoàn toàn độc lập với web app — chỉ cần copy/tải riêng folder `worker/` là deploy được.

## Chạy local

```bash
cd worker
npm install        # hoặc pnpm install
cp .env.example .env   # điền thông tin MongoDB + MQTT
npm run dev
```

## Deploy lên Render (Background Worker)

1. Push folder này lên một repo Git (hoặc dùng repo chính, đặt **Root Directory** = `worker`)
2. Trên Render: **New → Background Worker**
3. Cấu hình:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Thêm environment variables (xem `.env.example`):
   - `MONGODB_URI`, `MONGODB_DB_NAME`
   - `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`
   - (tuỳ chọn) `DEVICE_OFFLINE_AFTER_MS`, `WORKER_MQTT_RETRY_MS`, `WORKER_SWEEP_INTERVAL_MS`

Worker không mở HTTP port — Render Background Worker là loại service phù hợp (không dùng Web Service).

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Mô tả |
| --- | --- | --- | --- |
| `MONGODB_URI` | Có | — | Connection string MongoDB (cùng DB với web app) |
| `MONGODB_DB_NAME` | Không | `bear_gadget` | Tên database |
| `MQTT_HOST` | Có | — | Hostname broker MQTT (TLS) |
| `MQTT_PORT` | Không | `8883` | Port TLS |
| `MQTT_USERNAME` | Có | — | Username broker |
| `MQTT_PASSWORD` | Có | — | Password broker |
| `DEVICE_OFFLINE_AFTER_MS` | Không | `90000` | Quá thời gian này không có heartbeat thì coi là offline |
| `WORKER_MQTT_RETRY_MS` | Không | `5000` | Thời gian chờ giữa các lần retry kết nối MQTT |
| `WORKER_SWEEP_INTERVAL_MS` | Không | `30000` | Chu kỳ quét thiết bị offline |
# worker
