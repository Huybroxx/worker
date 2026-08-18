import mqtt, { type MqttClient } from 'mqtt'
import { findDeviceByCode, insert, log, updateDevice } from './db'
import type { DeviceStatus } from './types'

type StatusPayload = Record<string, unknown>

let activeClient: MqttClient | undefined
let readyPromise: Promise<MqttClient> | undefined

const statuses = new Set<DeviceStatus>(['online', 'offline', 'busy', 'error'])
const parse = (value: Buffer) => {
  const raw = value.toString('utf8')
  try { return JSON.parse(raw) } catch { return raw }
}

function statusPatch(payload: unknown) {
  const body: StatusPayload = typeof payload === 'object' && payload !== null ? payload as StatusPayload : {}
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
  const status = typeof body.status === 'string' ? body.status : 'online'
  patch.status = statuses.has(status as DeviceStatus) ? status : 'online'

  const battery = body.battery_level ?? body.battery
  if (typeof battery === 'number' && Number.isInteger(battery) && battery >= 0 && battery <= 100) patch.battery_level = battery

  const firmware = body.firmware_version ?? body.firmware
  if (typeof firmware === 'string' && firmware.length <= 60) patch.firmware_version = firmware
  return patch
}

export async function getMqttClient() {
  if (activeClient?.connected) return activeClient
  if (readyPromise) return readyPromise

  const host = process.env.MQTT_HOST
  const username = process.env.MQTT_USERNAME
  const password = process.env.MQTT_PASSWORD
  if (!host || !username || !password) throw new Error('MQTT TLS is not configured (MQTT_HOST, MQTT_USERNAME, MQTT_PASSWORD)')

  readyPromise = new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtts://${host}:${Number(process.env.MQTT_PORT ?? 8883)}`, {
      username,
      password,
      rejectUnauthorized: true,
      connectTimeout: 8_000,
      reconnectPeriod: 3_000,
      clean: true,
    })
    activeClient = client
    const timer = setTimeout(() => reject(new Error('MQTT connection timed out')), 10_000)

    client.once('connect', () => {
      clearTimeout(timer)
      client.subscribe(['gift/device/+/status', 'gift/device/+/audio'], { qos: 1 }, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(client)
      })
    })
    client.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    client.on('message', (topic, bytes, packet) => {
      void (async () => {
        const parts = topic.split('/')
        const code = parts[2]
        const channel = parts[3]
        const device = await findDeviceByCode(code)
        const payload = parse(bytes)

        await insert('mqtt_messages', {
          device_id: device?.id ?? null,
          direction: 'in',
          topic,
          payload,
          qos: packet.qos,
          retained: packet.retain,
          expires_at: new Date(Date.now() + 7 * 864e5),
        })

        if (device && channel === 'status') await updateDevice(device.id, statusPatch(payload))
      })().catch((error: unknown) => void log(null, 'error', 'MQTT message handling failed', {
        topic,
        error: error instanceof Error ? error.message : String(error),
      }))
    })
    client.on('error', (error) => void log(null, 'error', 'MQTT client error', { error: error.message }))
  })

  try { return await readyPromise } finally { readyPromise = undefined }
}

export function resetMqttClient() {
  try { activeClient?.end(true) } catch { /* already closed */ }
  activeClient = undefined
  readyPromise = undefined
}
