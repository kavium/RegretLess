import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'qol-ib-qb'
const STORE_NAME = 'kv'

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
