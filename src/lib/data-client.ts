import { getCacheItem, setCacheItem } from './cache'
import type { QuestionDetail, SubjectBundle, SubjectManifest } from '../types'

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
  if (DATA_BASE_URL) return `${DATA_BASE_URL}/subjects/${subjectId}/img`
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
  return new URL(`data/subjects/${subjectId}/img`, baseUrl).toString()
}

async function fetchJson<T>(path: string) {
  const response = await fetch(resolveAssetUrl(path), {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }

  return (await response.json()) as T
}

export async function loadPublishedManifest(): Promise<SubjectManifest> {
  try {
    const manifest = await fetchJson<SubjectManifest>(`/data/manifest.json?t=${Date.now()}`)
    await setCacheItem<CachedManifestRecord>('manifest', { data: manifest })
    return manifest
  } catch (error) {
    const cached = await getCacheItem<CachedManifestRecord>('manifest')

    if (cached) {
      return cached.data
    }

    throw error
  }
}

export async function loadPublishedSubjectBundle(
  manifest: SubjectManifest,
  subjectId: string,
): Promise<SubjectBundle> {
  const subject = manifest.subjects.find((entry) => entry.id === subjectId)

  if (!subject) {
    throw new Error(`Unknown subject: ${subjectId}`)
  }

  const cacheKey = `subject:${subjectId}`
  const cached = await getCacheItem<CachedBundleRecord>(cacheKey)

  if (cached?.hash === subject.bundleHash) {
    return cached.data
  }

  const bundle = await fetchJson<SubjectBundle>(subject.bundleUrl)
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
  const cacheKey = `question:${subjectId}:${questionId}`
  const cached = await getCacheItem<CachedQuestionDetail>(cacheKey)
  if (cached) return cached.data

  const fetched = await fetchJson<QuestionDetail>(`/data/subjects/${subjectId}/q/${questionId}.json`)
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
  const repo = (import.meta.env.VITE_GH_REPO as string | undefined)?.trim()
  const token = window.localStorage.getItem('qol-ib-qb:gh-token')
  if (!repo || !token) {
    try {
      const response = await fetch('/api/refresh', { method: 'POST' })
      return { ok: response.ok, available: response.status !== 404 && response.status !== 405 }
    } catch {
      return { ok: false, available: false }
    }
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      },
    )
    return { ok: response.ok, available: true }
  } catch {
    return { ok: false, available: false }
  }
}

export async function refreshPublishedData(
  currentManifest: SubjectManifest | null,
  _subjectId?: string,
) {
  const scrape = await triggerScrape()

  const manifest = await fetchJson<SubjectManifest>(`/data/manifest.json?t=${Date.now()}`)

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
