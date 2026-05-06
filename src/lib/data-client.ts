import { z } from 'zod'
import { getCacheItem, setCacheItem } from './cache'
import { QuestionDetailSchema, QuestionIdSchema, SubjectBundleSchema, SubjectIdSchema, SubjectManifestSchema } from './schemas'
import type { QuestionDetail, SubjectBundle, SubjectManifest } from '../types'

function normalizeLevel(value: string): 'SL' | 'HL' {
  const upper = (value ?? '').toUpperCase()
  return upper === 'AHL' ? 'HL' : (upper as 'SL' | 'HL')
}

function normalizeBundle(bundle: SubjectBundle): SubjectBundle {
  let mutated = false
  const questions = bundle.questions.map((q) => {
    const level = normalizeLevel(q.level as string)
    if (level !== q.level) {
      mutated = true
      return { ...q, level }
    }
    return q
  })
  return mutated ? { ...bundle, questions } : bundle
}

interface CachedManifestRecord {
  schemaVersion: number
  data: SubjectManifest
}

interface CachedBundleRecord {
  schemaVersion: number
  hash: string
  data: SubjectBundle
}

interface CachedQuestionDetail {
  schemaVersion: number
  bundleHash: string
  data: QuestionDetail
}

// Bump this when the cached payload shape OR the __IMG__ rewrite base changes,
// otherwise stale entries continue serving old image origins / pre-A2 truncated HTML.
const CACHE_SCHEMA_VERSION = 2
const DATA_BASE_URL = typeof import.meta.env.VITE_DATA_BASE_URL === 'string'
  ? import.meta.env.VITE_DATA_BASE_URL.replace(/\/$/, '')
  : null

function getDataBaseUrl() {
  if (!DATA_BASE_URL) {
    return new URL(import.meta.env.BASE_URL, window.location.origin)
  }

  const url = new URL(DATA_BASE_URL)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error('Invalid VITE_DATA_BASE_URL')
  }
  return url
}

function assertSubjectId(subjectId: string): asserts subjectId is string {
  const parsed = SubjectIdSchema.safeParse(subjectId)
  if (!parsed.success) throw new Error(`invalid subjectId: ${subjectId}`)
}

function assertQuestionId(questionId: string): asserts questionId is string {
  const parsed = QuestionIdSchema.safeParse(questionId)
  if (!parsed.success) throw new Error(`invalid questionId: ${questionId}`)
}

function resolveAssetUrl(assetPath: string) {
  if (!assetPath.startsWith('/data/')) {
    throw new Error(`invalid asset path: ${assetPath}`)
  }

  if (!DATA_BASE_URL) {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
    return new URL(assetPath.replace(/^\//, ''), baseUrl).toString()
  }

  const baseUrl = getDataBaseUrl()
  return new URL(assetPath.replace(/^\/data\//, ''), `${baseUrl.toString().replace(/\/$/, '')}/`).toString()
}

function imageBaseFor(subjectId: string) {
  assertSubjectId(subjectId)
  return resolveAssetUrl(`/data/subjects/${subjectId}/img`)
}

function isCurrentCacheVersion(record: { schemaVersion?: number } | undefined | null) {
  return record?.schemaVersion === CACHE_SCHEMA_VERSION
}

async function fetchJsonValidated<T>(assetPath: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(resolveAssetUrl(assetPath), {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${assetPath}: ${response.status}`)
  }

  const json: unknown = await response.json()
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.warn(`schema mismatch fetching ${assetPath}:`, parsed.error.issues.slice(0, 3))
    throw new Error(`schema validation failed for ${assetPath}`)
  }
  return parsed.data
}

export async function loadPublishedManifest(signal?: AbortSignal): Promise<SubjectManifest> {
  try {
    const manifest = await fetchJsonValidated(
      `/data/manifest.json?t=${Date.now()}`,
      SubjectManifestSchema,
      signal,
    )
    await setCacheItem<CachedManifestRecord>('manifest', { schemaVersion: CACHE_SCHEMA_VERSION, data: manifest })
    return manifest
  } catch (error) {
    const cached = await getCacheItem<CachedManifestRecord>('manifest')
    if (cached && isCurrentCacheVersion(cached)) return cached.data
    throw error
  }
}

export async function loadPublishedSubjectBundle(
  manifest: SubjectManifest,
  subjectId: string,
  signal?: AbortSignal,
): Promise<SubjectBundle> {
  assertSubjectId(subjectId)
  const subject = manifest.subjects.find((entry) => entry.id === subjectId)

  if (!subject) {
    throw new Error(`Unknown subject: ${subjectId}`)
  }

  const cacheKey = `subject:${subjectId}`
  const cached = await getCacheItem<CachedBundleRecord>(cacheKey)

  if (cached && isCurrentCacheVersion(cached) && cached.hash === subject.bundleHash) {
    return normalizeBundle(cached.data)
  }

  const raw = await fetchJsonValidated(subject.bundleUrl, SubjectBundleSchema, signal)
  if (raw.subject.id !== subjectId) {
    throw new Error(`bundle subject mismatch for ${subjectId}`)
  }
  const bundle = normalizeBundle(raw)
  await setCacheItem<CachedBundleRecord>(cacheKey, {
    schemaVersion: CACHE_SCHEMA_VERSION,
    hash: subject.bundleHash,
    data: bundle,
  })
  return bundle
}

export async function loadQuestionDetail(
  subjectId: string,
  questionId: string,
  bundleHash: string,
  signal?: AbortSignal,
): Promise<QuestionDetail> {
  assertSubjectId(subjectId)
  assertQuestionId(questionId)

  const cacheKey = `question:${subjectId}:${questionId}`
  const cached = await getCacheItem<CachedQuestionDetail>(cacheKey)
  if (cached && isCurrentCacheVersion(cached) && cached.bundleHash === bundleHash) return cached.data

  const fetched = await fetchJsonValidated(
    `/data/subjects/${subjectId}/q/${questionId}.json`,
    QuestionDetailSchema,
    signal,
  )
  if (fetched.questionId !== questionId) {
    throw new Error(`question detail mismatch for ${questionId}`)
  }
  const imgBase = imageBaseFor(subjectId)
  const detail: QuestionDetail = {
    ...fetched,
    questionHtml: fetched.questionHtml.replaceAll('__IMG__', imgBase),
    markschemeHtml: fetched.markschemeHtml.replaceAll('__IMG__', imgBase),
  }
  await setCacheItem<CachedQuestionDetail>(cacheKey, {
    schemaVersion: CACHE_SCHEMA_VERSION,
    bundleHash,
    data: detail,
  })
  return detail
}

export async function refreshPublishedData(currentManifest: SubjectManifest | null) {
  // Re-fetch published manifest. Server-side re-scrape is run out-of-band by
  // the ingest CLI; there is no /api/refresh endpoint to call here.
  const manifest = await fetchJsonValidated(
    `/data/manifest.json?t=${Date.now()}`,
    SubjectManifestSchema,
  )

  const changedSubjectIds = manifest.subjects
    .filter((subject) => {
      const current = currentManifest?.subjects.find((entry) => entry.id === subject.id)
      return !current || current.bundleHash !== subject.bundleHash
    })
    .map((subject) => subject.id)

  await setCacheItem<CachedManifestRecord>('manifest', { schemaVersion: CACHE_SCHEMA_VERSION, data: manifest })
  for (const id of changedSubjectIds) {
    await loadPublishedSubjectBundle(manifest, id)
  }

  return {
    manifest,
    changedSubjectIds,
    scraped: false,
  }
}
