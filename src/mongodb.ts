import { MongoClient, type Db } from 'mongodb'

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB_NAME ?? 'bear_gadget'

let clientPromise: Promise<MongoClient> | undefined
let indexesEnsured = false

export async function getDb(): Promise<Db> {
  if (!uri) throw new Error('MONGODB_URI is not configured')
  clientPromise ??= new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8_000 }).connect()
  const db = (await clientPromise).db(dbName)
  if (!indexesEnsured) {
    indexesEnsured = true
    await Promise.all([
      db.collection('devices').createIndex({ device_code: 1 }, { unique: true }),
      db.collection('logs').createIndex({ device_id: 1, created_at: -1 }),
      db.collection('mqtt_messages').createIndex({ device_id: 1, created_at: -1 }),
      db.collection('mqtt_messages').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    ])
  }
  return db
}

export async function closeMongo() {
  if (!clientPromise) return
  try {
    const client = await clientPromise
    await client.close()
  } catch {
    /* already closed */
  }
  clientPromise = undefined
}
