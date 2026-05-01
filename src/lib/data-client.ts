import { z } from 'zod'
import { getCacheItem, setCacheItem } from './cache'
import { QuestionDetailSchema, SubjectBundleSchema, SubjectIdSchema, SubjectManifestSchema } from './schemas'
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
  data: SubjectManifest
}

interface CachedBundleRecord {
  hash: string
  data: SubjectBundle
}

interface CachedQuestionDetail {
  data: QuestionDetail
}

const DATA_BASE_URL = (import.meta.env.VITE_DATA_BASE_URL as string | undefined)?.replace(/\/$/, '')

function assertSubjectId(subjectId: string): asserts subjectId is string {
  const parsed = SubjectIdSchema.safeParse(subjectId)
  if (!parsed.success) throw new Error(`invalid subjectId: ${subjectId}`)
}

function resolveAssetUrl(path: string) {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  if (DATA_BASE_URL && path.startsWith('/data/')) {
    return `${DATA_BASE_URL}${path.replace(/^\/data/, '')}`
  }

  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
  return new URL(path.replace(/^\//, ''), baseUrl).toString()
}

function imageBaseFor(subjectId: string) {
  assertSubjectId(subjectId)
  if (DATA_BASE_URL) return `${DATA_BASE_URL}/subjects/${subjectId}/img`
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
  return new URL(`data/subjects/${subjectId}/img`, baseUrl).toString()
}

async function fetchJsonValidated<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(resolveAssetUrl(path), {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }

  const json = await response.json()
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.warn(`schema mismatch fetching ${path}:`, parsed.error.issues.slice(0, 3))
    throw new Error(`schema validation failed for ${path}`)
  }
  return parsed.data
}

export async function loadPublishedManifest(): Promise<SubjectManifest> {
  try {
    const manifest = await fetchJsonValidated(
      `/data/manifest.json?t=${Date.now()}`,
      SubjectManifestSchema,
    )
    await setCacheItem<CachedManifestRecord>('manifest', { data: manifest })
    return manifest
  } catch (error) {
    const cached = await getCacheItem<CachedManifestRecord>('manifest')
    if (cached) return cached.data
    throw error
  }
}

export async function loadPublishedSubjectBundle(
  manifest: SubjectManifest,
  subjectId: string,
): Promise<SubjectBundle> {
  assertSubjectId(subjectId)
  const subject = manifest.subjects.find((entry) => entry.id === subjectId)

  if (!subject) {
    throw new Error(`Unknown subject: ${subjectId}`)
  }

  const cacheKey = `subject:${subjectId}`
  const cached = await getCacheItem<CachedBundleRecord>(cacheKey)

  if (cached?.hash === subject.bundleHash) {
    return normalizeBundle(cached.data)
  }

  const raw = await fetchJsonValidated(subject.bundleUrl, SubjectBundleSchema)
  const bundle = normalizeBundle(raw)
  await setCacheItem<CachedBundleRecord>(cacheKey, {
    hash: subject.bundleHash,
    data: bundle,
  })
  return bundle
}

export async function loadQuestionDetail(
  subjectId: string,
  questionId: string,
): Promise<QuestionDetail> {
  assertSubjectId(subjectId)
  if (!/^[\w-]+$/.test(questionId)) throw new Error(`invalid questionId: ${questionId}`)

  const cacheKey = `question:${subjectId}:${questionId}`
  const cached = await getCacheItem<CachedQuestionDetail>(cacheKey)
  if (cached) return cached.data

  const fetched = await fetchJsonValidated(
    `/data/subjects/${subjectId}/q/${questionId}.json`,
    QuestionDetailSchema,
  )
  const imgBase = imageBaseFor(subjectId)
  const detail: QuestionDetail = {
    ...fetched,
    questionHtml: fetched.questionHtml.replaceAll('__IMG__', imgBase),
    markschemeHtml: fetched.markschemeHtml.replaceAll('__IMG__', imgBase),
  }
  await setCacheItem<CachedQuestionDetail>(cacheKey, { data: detail })
  return detail
}

async function triggerScrape(): Promise<{ ok: boolean; available: boolean }> {
  try {
    const response = await fetch('/api/refresh', { method: 'POST' })
    return { ok: response.ok, available: response.status !== 404 && response.status !== 405 }
  } catch {
    return { ok: false, available: false }
  }
}

export async function refreshPublishedData(currentManifest: SubjectManifest | null) {
  const scrape = await triggerScrape()

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

  await setCacheItem<CachedManifestRecord>('manifest', { data: manifest })

  for (const id of changedSubjectIds) {
    await loadPublishedSubjectBundle(manifest, id)
  }

  return {
    manifest,
    changedSubjectIds,
    scraped: scrape.ok,
  }
}
