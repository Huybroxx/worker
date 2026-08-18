// Standalone MQTT gateway worker for Bear Gadget devices.
// Deploy as a Render Background Worker (or any long-running Node host).
// Keeps a persistent MQTT connection alive so device status/audio messages
// are ingested into MongoDB continuously, independent of the web app.

import { getMqttClient, resetMqttClient } from './mqtt'
import { getDb, closeMongo } from './mongodb'
import { log } from './db'

const RETRY_MS = Number(process.env.WORKER_MQTT_RETRY_MS ?? 5_000)
const SWEEP_INTERVAL_MS = Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 30_000)
const OFFLINE_MS = Number(process.env.DEVICE_OFFLINE_AFTER_MS ?? 90_000)

let shuttingDown = false
let sweepTimer: NodeJS.Timeout | null = null

const stamp = () => new Date().toISOString()

// Marks devices offline in MongoDB when their heartbeat is stale, keeping the
// stored status truthful for any consumer reading the DB directly.
async function sweepStaleDevices() {
  try {
    const db = await getDb()
    const cutoff = new Date(Date.now() - OFFLINE_MS).toISOString()
    const result = await db.collection('devices').updateMany(
      { status: { $ne: 'offline' }, $or: [{ last_seen_at: { $lt: cutoff } }, { last_seen_at: null }] },
      { $set: { status: 'offline', updated_at: stamp() } },
    )
    if (result.modifiedCount > 0) {
      console.log(`[worker] ${stamp()} marked ${result.modifiedCount} device(s) offline`)
      await log(null, 'info', 'Worker marked stale devices offline', { count: result.modifiedCount })
    }
  } catch (error) {
    console.error(`[worker] ${stamp()} offline sweep failed:`, error instanceof Error ? error.message : error)
  }
}

async function connectWithRetry() {
  while (!shuttingDown) {
    try {
      const client = await getMqttClient()
      console.log(`[worker] ${stamp()} MQTT connected and subscribed (gift/device/+/status, gift/device/+/audio)`)
      await log(null, 'info', 'MQTT worker connected', {})

      client.on('reconnect', () => console.log(`[worker] ${stamp()} MQTT reconnecting...`))
      client.on('close', () => {
        if (!shuttingDown) console.warn(`[worker] ${stamp()} MQTT connection closed, mqtt.js will auto-reconnect`)
      })
      client.on('offline', () => {
        if (!shuttingDown) console.warn(`[worker] ${stamp()} MQTT client offline`)
      })
      return client
    } catch (error) {
      console.error(`[worker] ${stamp()} MQTT connect failed:`, error instanceof Error ? error.message : error)
      resetMqttClient()
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }
  return null
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] ${stamp()} received ${signal}, shutting down...`)
  if (sweepTimer) clearInterval(sweepTimer)
  try { await log(null, 'info', 'MQTT worker shutting down', { signal }) } catch { /* db may be gone */ }
  resetMqttClient()
  await closeMongo()
  process.exit(0)
}

async function main() {
  console.log(`[worker] ${stamp()} bear-gadget MQTT worker starting`)

  // Verify MongoDB before touching MQTT so misconfiguration fails loudly.
  const db = await getDb()
  await db.command({ ping: 1 })
  console.log(`[worker] ${stamp()} MongoDB connected (${db.databaseName})`)

  await connectWithRetry()

  await sweepStaleDevices()
  sweepTimer = setInterval(() => void sweepStaleDevices(), SWEEP_INTERVAL_MS)

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  console.error(`[worker] ${stamp()} fatal:`, error instanceof Error ? error.message : error)
  process.exit(1)
})
