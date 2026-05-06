import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'qol-ib-qb'
const STORE_NAME = 'kv'
const SCHEMA_MARKER_KEY = '__schemaVersion'

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      },
      terminated() {
        dbPromise = null
      },
      blocking() {
        dbPromise = null
      },
    }).then((db) => {
      db.addEventListener('close', () => { dbPromise = null })
      db.addEventListener('versionchange', () => {
        db.close()
        dbPromise = null
      })
      return db
    }).catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

function isClosingError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return /database connection is closing|InvalidStateError|database is closed/i.test(msg)
}

export async function getCacheItem<T>(key: string): Promise<T | undefined> {
  try {
    const db = await getDb()
    return await db.get(STORE_NAME, key)
  } catch (err) {
    if (isClosingError(err)) {
      dbPromise = null
      try {
        const db = await getDb()
        return await db.get(STORE_NAME, key)
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

// Wipe every cached entry. Used on schema bumps to evict records the new
// client code would just ignore anyway, instead of letting them sit forever.
export async function clearAllCache() {
  try {
    const db = await getDb()
    await db.clear(STORE_NAME)
  } catch {
    /* best-effort */
  }
}

// Read the marker that records which schema version last touched this DB.
// Returns null if the DB is fresh or unreachable.
export async function getStoredSchemaVersion(): Promise<number | null> {
  const value = await getCacheItem<number>(SCHEMA_MARKER_KEY)
  return typeof value === 'number' ? value : null
}

export async function setStoredSchemaVersion(version: number) {
  await setCacheItem<number>(SCHEMA_MARKER_KEY, version)
}

export async function setCacheItem<T>(key: string, value: T) {
  try {
    const db = await getDb()
    await db.put(STORE_NAME, value, key)
  } catch (err) {
    if (isClosingError(err)) {
      dbPromise = null
      try {
        const db = await getDb()
        await db.put(STORE_NAME, value, key)
      } catch {
        /* swallow — cache is best-effort */
      }
    }
  }
}
