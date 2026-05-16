import type { UserQuestionStateMap, WorkspaceState } from '../types'
import { QuestionIdSchema, SubjectIdSchema } from './schemas'

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
    return null
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
  const keys: Array<{ key: string; updatedAt: number }> = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (!key || !key.startsWith(USER_STATE_KEY_PREFIX)) continue
    const state = readJson<UserQuestionStateMap>(key)
    const updatedAt = state
      ? Math.max(
          0,
          ...Object.values(state).map((entry) => Date.parse(entry.updatedAt) || 0),
        )
      : 0
    keys.push({ key, updatedAt })
  }
  keys.sort((left, right) => right.updatedAt - left.updatedAt)
  for (const { key } of keys.slice(1)) {
    window.localStorage.removeItem(key)
  }
}

function sanitizeUserQuestionStateMap(value: unknown): UserQuestionStateMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const next = Object.create(null) as UserQuestionStateMap
  for (const [questionId, entry] of Object.entries(value)) {
    if (!QuestionIdSchema.safeParse(questionId).success || !entry || typeof entry !== 'object') {
      continue
    }

    const completed = typeof entry.completed === 'boolean' ? entry.completed : false
    const difficult = typeof entry.difficult === 'boolean' ? entry.difficult : false
    const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString()

    next[questionId] = { completed, difficult, updatedAt }
  }

  return next
}

function sanitizeResumeState(value: unknown): WorkspaceState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<WorkspaceState>
  if (!SubjectIdSchema.safeParse(candidate.subjectId).success) {
    return null
  }
  if (typeof candidate.workspaceUrl !== 'string' || typeof candidate.summaryLabel !== 'string' || typeof candidate.updatedAt !== 'string') {
    return null
  }
  const scrambleNonce = typeof candidate.scrambleNonce === 'number' ? candidate.scrambleNonce : Number.NaN
  const scrollY = typeof candidate.scrollY === 'number' ? candidate.scrollY : Number.NaN
  if (
    !candidate.selection
    || typeof candidate.selection !== 'object'
    || !Array.isArray(candidate.selection.umbrellaIds)
    || !Array.isArray(candidate.selection.subunitIds)
    || !Array.isArray(candidate.paperFilters)
    || !Array.isArray(candidate.levelFilters)
    || typeof candidate.onlyDifficult !== 'boolean'
    || (candidate.orderMode !== 'source' && candidate.orderMode !== 'scrambled')
    || !Number.isSafeInteger(scrambleNonce)
    || scrambleNonce < 0
    || Number.isNaN(scrollY)
  ) {
    return null
  }

  const expandedQuestionId =
    candidate.expandedQuestionId === null || candidate.expandedQuestionId === undefined
      ? null
      : QuestionIdSchema.safeParse(candidate.expandedQuestionId).success
      ? candidate.expandedQuestionId
      : null
  const selection = candidate.selection as WorkspaceState['selection']
  const paperFilters = candidate.paperFilters as WorkspaceState['paperFilters']
  const levelFilters = candidate.levelFilters as WorkspaceState['levelFilters']
  const yearFilters = Array.isArray(candidate.yearFilters)
    ? candidate.yearFilters as WorkspaceState['yearFilters']
    : []
  const showBroken = typeof candidate.showBroken === 'boolean' ? candidate.showBroken : false
  const displayMode = candidate.displayMode === 'numbered' ? 'numbered' : 'tags'
  const questionGroupingMode = candidate.questionGroupingMode === 'full-question' ? 'full-question' : 'per-part'
  const subjectId = candidate.subjectId as string
  const workspaceUrl = candidate.workspaceUrl as string
  const summaryLabel = candidate.summaryLabel as string
  const updatedAt = candidate.updatedAt as string

  return {
    subjectId,
    workspaceUrl,
    summaryLabel,
    selection: {
      umbrellaIds: selection.umbrellaIds.filter((id) => SubjectIdSchema.safeParse(id).success),
      subunitIds: selection.subunitIds.filter((id) => SubjectIdSchema.safeParse(id).success),
    },
    paperFilters: paperFilters.filter((value): value is WorkspaceState['paperFilters'][number] =>
      value === '1A' || value === '1B' || value === '1' || value === '2' || value === '3',
    ),
    levelFilters: levelFilters.filter((value): value is WorkspaceState['levelFilters'][number] => value === 'SL' || value === 'HL'),
    yearFilters: yearFilters.filter((value): value is WorkspaceState['yearFilters'][number] =>
      value === 'specimen' || (typeof value === 'string' && /^20\d{2}$/.test(value)),
    ),
    onlyDifficult: candidate.onlyDifficult,
    showBroken,
    displayMode,
    questionGroupingMode,
    orderMode: candidate.orderMode,
    scrambleNonce,
    expandedQuestionId,
    scrollY: Number.isFinite(scrollY) ? scrollY : 0,
    updatedAt,
  }
}

export function getResumeState() {
  return sanitizeResumeState(readJson<WorkspaceState>(RESUME_KEY))
}

export function setResumeState(state: WorkspaceState) {
  writeJson(RESUME_KEY, state)
}

export function clearResumeState() {
  window.localStorage.removeItem(RESUME_KEY)
}

export function getUserQuestionState(subjectId: string) {
  return sanitizeUserQuestionStateMap(readJson<UserQuestionStateMap>(`${USER_STATE_KEY_PREFIX}${subjectId}`))
}

export function setUserQuestionState(subjectId: string, state: UserQuestionStateMap) {
  writeJson(`${USER_STATE_KEY_PREFIX}${subjectId}`, state)
}
