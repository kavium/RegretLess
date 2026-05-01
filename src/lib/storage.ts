import type { UserQuestionStateMap, WorkspaceState } from '../types'

const RESUME_KEY = 'qol-ib-qb:resume'
const USER_STATE_KEY_PREFIX = 'qol-ib-qb:user-state:'
const SCHEMA_VERSION = 1

interface VersionedEnvelope<T> {
  schemaVersion: number
  data: T
}

function readJson<T>(key: string): T | null {
  try {
    const rawValue = window.localStorage.getItem(key)

    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue)
    if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && 'data' in parsed) {
      const envelope = parsed as VersionedEnvelope<T>
      return envelope.schemaVersion === SCHEMA_VERSION ? envelope.data : null
    }
    return parsed as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  const envelope: VersionedEnvelope<unknown> = { schemaVersion: SCHEMA_VERSION, data: value }
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope))
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)) {
      pruneOldUserStateKeys()
      try {
        window.localStorage.setItem(key, JSON.stringify(envelope))
      } catch {
        /* give up silently — UI still functions in-memory */
      }
    }
  }
}

function pruneOldUserStateKeys() {
  const keys: string[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (key && key.startsWith(USER_STATE_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys.slice(0, Math.max(0, keys.length - 1))) {
    window.localStorage.removeItem(key)
  }
}

export function getResumeState() {
  return readJson<WorkspaceState>(RESUME_KEY)
}

export function setResumeState(state: WorkspaceState) {
  writeJson(RESUME_KEY, state)
}

export function clearResumeState() {
  window.localStorage.removeItem(RESUME_KEY)
}

export function getUserQuestionState(subjectId: string) {
  return readJson<UserQuestionStateMap>(`${USER_STATE_KEY_PREFIX}${subjectId}`) ?? {}
}

export function setUserQuestionState(subjectId: string, state: UserQuestionStateMap) {
  writeJson(`${USER_STATE_KEY_PREFIX}${subjectId}`, state)
}
