import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Agent, setGlobalDispatcher } from 'undici'
import * as cheerio from 'cheerio'
import { parseQuestionPage } from './lib/parsers.mjs'

const DEFAULT_DATA_ROOT = 'public/data'
const DEFAULT_SEED_URL =
  'https://dynamicrepo.sbs/IB%20QUESTIONBANKS/6.%20Sixth%20Edition%20-%202025%20Sciences/questionbank/en/teachers/pirateIB/questionbanks/?noscript'
const FETCH_TIMEOUT_MS = 120000
const QUESTION_SCHEMA_VERSION = 3
const SAFE_ID_PATTERN = /^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9_-]+$/

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
    connections: 8,
    allowH2: true,
  }),
)

let allowedSourceOrigin = new URL(DEFAULT_SEED_URL).origin

function parseArgs(argv) {
  const options = {
    dataRoot: DEFAULT_DATA_ROOT,
    seedUrl: DEFAULT_SEED_URL,
    dryRun: false,
    questions: [],
    refs: [],
  }

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg.startsWith('--data-root=')) options.dataRoot = arg.split('=')[1]
    else if (arg.startsWith('--seed-url=')) options.seedUrl = arg.split('=').slice(1).join('=')
    else if (arg.startsWith('--questions=')) options.questions = parsePairs(arg.split('=')[1])
    else if (arg.startsWith('--refs=')) options.refs = parsePairs(arg.split('=')[1])
  }

  return options
}

function parsePairs(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(':')
      if (separator <= 0 || separator === item.length - 1) {
        throw new Error(`expected subject:value pair, got ${item}`)
      }
      return {
        subjectId: item.slice(0, separator),
        value: item.slice(separator + 1),
      }
    })
}

function assertSafeId(value, label) {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new Error(`invalid ${label}: ${value}`)
  }
}

function resolveInside(baseDir, ...segments) {
  const resolved = path.resolve(baseDir, ...segments)
  const baseWithSep = `${path.resolve(baseDir)}${path.sep}`
  if (resolved !== path.resolve(baseDir) && !resolved.startsWith(baseWithSep)) {
    throw new Error(`path escaped base dir: ${resolved}`)
  }
  return resolved
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeJsonAtomic(target, value, { pretty = false } = {}) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
  await rename(tmp, target)
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function hashJson(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function assertAllowedSourceUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== allowedSourceOrigin) {
    throw new Error(`disallowed source URL: ${rawUrl}`)
  }
  return url.toString()
}

function sourceRoot(seedUrl) {
  const url = new URL(seedUrl)
  url.search = ''
  url.hash = ''
  return url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`
}

function questionSourceUrl(seedUrl, subjectId, questionId) {
  assertSafeId(subjectId, 'subject id')
  assertSafeId(questionId, 'question id')
  return assertAllowedSourceUrl(new URL(`${subjectId}/question_node_trees/${questionId}.html`, sourceRoot(seedUrl)).toString())
}

async function fetchHtml(url, retries = 10) {
  const safeUrl = assertAllowedSourceUrl(url)

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(safeUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      })

      if (response.ok) {
        assertAllowedSourceUrl(response.url)
        return response.text()
      }

      if (attempt === retries) {
        throw new Error(`Failed to fetch ${safeUrl}: ${response.status}`)
      }
    } catch (error) {
      if (attempt === retries) throw error
    } finally {
      clearTimeout(timeoutId)
    }

    const backoff = Math.min(60000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000)
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }

  throw new Error(`Failed to fetch ${safeUrl}`)
}

async function fetchImageBytes(rawUrl, retries = 3) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`disallowed scheme: ${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new Error(`credentials in image url: ${rawUrl}`)
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url.toString(), {
        headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*,*/*;q=0.8' },
        signal: controller.signal,
      })
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer())
        if (!buffer.length) throw new Error('empty image body')
        return buffer
      }
      if (attempt === retries) throw new Error(`image fetch ${response.status} for ${rawUrl}`)
    } catch (error) {
      if (attempt === retries) throw error
    } finally {
      clearTimeout(timeoutId)
    }
    const backoff = Math.min(15000, 1500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500)
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }

  throw new Error(`image fetch exhausted retries: ${rawUrl}`)
}

function textFromHtml(html) {
  return cheerio.load(html || '').text().replace(/\s+/g, ' ').trim()
}

function comparableText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

function parentCount(html) {
  const $ = cheerio.load(html || '')
  return $('.qb-parent-stem, .q_resource').length
}

function mediaCount(html) {
  const $ = cheerio.load(html || '')
  return $('img, image, source, svg, table').length
}

function imgRefs(html) {
  const $ = cheerio.load(html || '')
  const refs = []
  $('img, image, source').each((_, element) => {
    for (const attr of ['src', 'href', 'xlink:href', 'poster']) {
      const value = $(element).attr(attr)
      if (!value || !value.includes('__IMG__/')) continue
      refs.push(value.split('__IMG__/')[1].split(/[?#]/)[0])
    }
  })
  return [...new Set(refs)]
}

function shouldReplace(existing, parsed) {
  const existingText = comparableText(textFromHtml(existing.questionHtml))
  const parsedText = comparableText(textFromHtml(parsed.questionHtml))
  if (!existingText || !parsedText) return false

  const sample = existingText.slice(0, Math.min(120, existingText.length))
  if (sample && !parsedText.includes(sample)) return false

  return parentCount(parsed.questionHtml) > parentCount(existing.questionHtml)
    || mediaCount(parsed.questionHtml) > mediaCount(existing.questionHtml)
    || parsedText.length > existingText.length + 80
}

async function writeImages(subjectDir, images, dryRun) {
  const imgDir = path.join(subjectDir, 'img')
  if (!dryRun) await mkdir(imgDir, { recursive: true })

  for (const image of images ?? []) {
    const imagePath = resolveInside(imgDir, image.filename)
    if (await fileExists(imagePath)) continue
    try {
      if (image.base64) {
        if (!dryRun) await writeFile(imagePath, Buffer.from(image.base64, 'base64'))
      } else if (image.sourceUrl) {
        const bytes = await fetchImageBytes(image.sourceUrl)
        if (!dryRun) await writeFile(imagePath, bytes)
      }
    } catch (error) {
      console.warn(`image fetch failed (${image.filename}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function questionIdsForRef(dataRoot, subjectId, refPrefix) {
  assertSafeId(subjectId, 'subject id')
  const index = await readJson(path.join(dataRoot, 'subjects', subjectId, 'index.json'))
  return index.questions
    .filter((question) => String(question.referenceCode || '').startsWith(refPrefix))
    .map((question) => question.questionId)
}

async function repairQuestion(dataRoot, seedUrl, subjectId, questionId, dryRun) {
  assertSafeId(subjectId, 'subject id')
  assertSafeId(questionId, 'question id')
  const subjectDir = path.join(dataRoot, 'subjects', subjectId)
  const detailPath = path.join(subjectDir, 'q', `${questionId}.json`)
  const existing = await readJson(detailPath)
  const url = questionSourceUrl(seedUrl, subjectId, questionId)
  const html = await fetchHtml(url)
  const parsed = parseQuestionPage(html, url, subjectId)

  if (parsed.meta.questionId !== questionId || parsed.detail.questionId !== questionId) {
    throw new Error(`source question id mismatch for ${subjectId}:${questionId}`)
  }

  if (!shouldReplace(existing, parsed.detail)) return null

  if (!dryRun) {
    await writeImages(subjectDir, parsed.images, dryRun)
    await writeJsonAtomic(detailPath, {
      ...existing,
      questionHtml: parsed.detail.questionHtml,
      markschemeHtml: parsed.detail.markschemeHtml,
      schemaVersion: existing.schemaVersion ?? QUESTION_SCHEMA_VERSION,
      meta: existing.meta,
    })
  }

  return {
    questionId,
    referenceCode: existing.meta?.referenceCode ?? parsed.meta.referenceCode,
    previousLength: textFromHtml(existing.questionHtml).length,
    nextLength: textFromHtml(parsed.detail.questionHtml).length,
    previousParents: parentCount(existing.questionHtml),
    nextParents: parentCount(parsed.detail.questionHtml),
    imageCount: imgRefs(parsed.detail.questionHtml).length,
  }
}

async function rebuildManifest(dataRoot, touchedSubjectIds, dryRun) {
  if (dryRun || touchedSubjectIds.size === 0) return
  const manifestPath = path.join(dataRoot, 'manifest.json')
  const manifest = await readJson(manifestPath)

  for (const subjectId of touchedSubjectIds) {
    const subjectDir = path.join(dataRoot, 'subjects', subjectId)
    const index = await readJson(path.join(subjectDir, 'index.json'))
    const bundleHash = hashJson({ index, sourceRepairedAt: new Date().toISOString() })
    const hashedFilename = `index-${bundleHash}.json`
    await writeJsonAtomic(path.join(subjectDir, hashedFilename), index)
    await writeJsonAtomic(path.join(subjectDir, 'index.json'), index)

    const manifestSubject = manifest.subjects.find((subject) => subject.id === subjectId)
    if (manifestSubject) {
      manifestSubject.bundleHash = bundleHash
      manifestSubject.bundleUrl = `/data/subjects/${subjectId}/${hashedFilename}`
      manifestSubject.questionCount = index.questions.length
      manifestSubject.nodeCount = index.syllabus.length
      manifestSubject.paperCoverage = [...new Set(index.questions.map((question) => question.paper))]
    }
  }

  manifest.version = new Date().toISOString()
  manifest.generatedAt = manifest.version
  await writeJsonAtomic(manifestPath, manifest, { pretty: true })
}

async function pruneOldHashedBundles(dataRoot, touchedSubjectIds, keep = 3) {
  for (const subjectId of touchedSubjectIds) {
    const subjectDir = path.join(dataRoot, 'subjects', subjectId)
    const entries = await readdir(subjectDir)
    const hashedFiles = (
      await Promise.all(
        entries
          .filter((name) => /^index-[0-9a-f]+\.json$/.test(name))
          .map(async (name) => ({
            name,
            mtimeMs: (await stat(path.join(subjectDir, name))).mtimeMs,
          })),
      )
    ).sort((left, right) => right.mtimeMs - left.mtimeMs)

    for (const { name } of hashedFiles.slice(keep)) {
      try {
        await unlink(path.join(subjectDir, name))
      } catch {
        /* best-effort */
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  allowedSourceOrigin = new URL(options.seedUrl).origin
  const requested = new Map()

  for (const { subjectId, value } of options.questions) {
    assertSafeId(subjectId, 'subject id')
    assertSafeId(value, 'question id')
    const ids = requested.get(subjectId) ?? new Set()
    ids.add(value)
    requested.set(subjectId, ids)
  }

  for (const { subjectId, value } of options.refs) {
    const ids = requested.get(subjectId) ?? new Set()
    for (const questionId of await questionIdsForRef(options.dataRoot, subjectId, value)) {
      ids.add(questionId)
    }
    requested.set(subjectId, ids)
  }

  if (requested.size === 0) {
    console.log('No source questions requested')
    return
  }

  const touchedSubjectIds = new Set()
  for (const [subjectId, ids] of requested) {
    const changes = []
    for (const questionId of [...ids].sort()) {
      const change = await repairQuestion(options.dataRoot, options.seedUrl, subjectId, questionId, options.dryRun)
      if (change) changes.push(change)
    }

    if (changes.length) touchedSubjectIds.add(subjectId)
    console.log(`${subjectId}: source-repaired ${changes.length} questions`)
    for (const change of changes.slice(0, 12)) {
      console.log(`  ${change.questionId} ${change.referenceCode} parents ${change.previousParents}->${change.nextParents} text ${change.previousLength}->${change.nextLength}`)
    }
    if (changes.length > 12) console.log(`  ... ${changes.length - 12} more`)
  }

  await rebuildManifest(options.dataRoot, touchedSubjectIds, options.dryRun)
  if (!options.dryRun) await pruneOldHashedBundles(options.dataRoot, touchedSubjectIds)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
