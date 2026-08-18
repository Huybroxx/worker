import { randomUUID } from 'node:crypto'
import { getDb } from './mongodb'

const now = () => new Date().toISOString()

export async function findDeviceByCode(code: string) {
  const db = await getDb()
  return db.collection('devices').findOne({ device_code: code }, { projection: { _id: 0 } })
}

export async function updateDevice(id: string, patch: Record<string, unknown>) {
  const db = await getDb()
  await db.collection('devices').updateOne({ id }, { $set: { ...patch, updated_at: now() } })
}

export async function insert(collection: string, value: Record<string, unknown>) {
  const db = await getDb()
  const row = { id: randomUUID(), created_at: now(), ...value }
  await db.collection(collection).insertOne(row)
  return row
}

export async function log(deviceId: string | null, level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown> = {}) {
  return insert('logs', { device_id: deviceId, level, message, metadata })
}
