import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Agent, setGlobalDispatcher } from 'undici'
import { normalizeLevel, parseQuestionPage, parseSectionPage, parseSubjectLinksFromHtml, parseSyllabusPage } from './lib/parsers.mjs'

const DEFAULT_SEED_URL =
  'https://dynamicrepo.sbs/IB%20QUESTIONBANKS/6.%20Sixth%20Edition%20-%202025%20Sciences/questionbank/en/teachers/pirateIB/questionbanks/'
const SUBJECT_CONCURRENCY = 3
const SECTION_CONCURRENCY = 3
const QUESTION_CONCURRENCY = 6
const FETCH_TIMEOUT_MS = 120000

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
    connections: 8,
    allowH2: true,
  }),
)
const OUT_DIR = path.resolve(process.cwd(), 'public/data')
const SUBJECT_DIR = path.join(OUT_DIR, 'subjects')

function parseArgs(argv) {
  const options = {
    seedUrl: DEFAULT_SEED_URL,
    sample: false,
    subjects: null,
    maxQuestionsPerSubject: Infinity,
  }

  for (const arg of argv) {
    if (arg === '--sample') {
      options.sample = true
      options.maxQuestionsPerSubject = 48
      continue
    }

    if (arg.startsWith('--subjects=')) {
      options.subjects = arg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean)
      continue
    }

    if (arg.startsWith('--limit=')) {
      options.maxQuestionsPerSubject = Number.parseInt(arg.split('=')[1], 10)
      continue
    }
  }

  return options
}

async function fetchHtml(url, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      })

      if (response.ok) {
        return response.text()
      }

      if (attempt === retries) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`)
      }
    } catch (error) {
      if (attempt === retries) {
        throw error
      }
    } finally {
      clearTimeout(timeoutId)
    }

    const backoff = Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500)
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }

  throw new Error(`Failed to fetch ${url}`)
}

async function readJson(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

function hashJson(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function dedupeByCanonicalOrder(ids, orderMap) {
  return [...new Set(ids)].sort((left, right) => (orderMap[left] ?? 0) - (orderMap[right] ?? 0))
}

async function runWithConcurrency(items, limit, worker) {
  const queue = items.slice()
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift()
      if (next === undefined) return
      await worker(next)
    }
  })
  await Promise.all(runners)
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function ingestSubject(subject, options) {
  const subjectDir = path.join(SUBJECT_DIR, subject.id)
  const questionsDir = path.join(subjectDir, 'q')
  await mkdir(questionsDir, { recursive: true })

  const indexPath = path.join(subjectDir, 'index.json')
  const existingIndex = await readJson(indexPath)

  const syllabusUrl = subject.url
  const syllabusHtml = await fetchHtml(syllabusUrl)
  const syllabus = parseSyllabusPage(syllabusHtml, syllabusUrl)

  const metaMap = new Map(
    (existingIndex?.questions ?? []).map((question) => [
      question.questionId,
      { ...question, level: normalizeLevel(question.level), memberSectionIds: [], sectionOrders: {} },
    ]),
  )
  const sectionQuestionOrder = {}
  const sectionOrderIndex = Object.fromEntries(syllabus.map((node) => [node.id, node.canonicalOrder]))
  let addedQuestionCount = 0

  console.log(`[${subject.id}] ${syllabus.length} sections, ${metaMap.size} cached questions`)

  const imagesDir = path.join(subjectDir, 'img')
  await mkdir(imagesDir, { recursive: true })

  let sectionsDone = 0
  const writeIndexSnapshot = async () => {
    const snapshotQuestions = [...metaMap.values()].sort((left, right) =>
      left.referenceCode.localeCompare(right.referenceCode),
    )
    await writeFile(
      indexPath,
      JSON.stringify({
        subject: { id: subject.id, name: subject.name },
        syllabus,
        sectionQuestionOrder,
        questions: snapshotQuestions,
      }),
    )
  }

  await runWithConcurrency(syllabus, SECTION_CONCURRENCY, async (section) => {
    const sectionUrl = new URL(`syllabus_sections/${section.id}.html`, syllabusUrl).toString()
    let sectionHtml

    try {
      sectionHtml = await fetchHtml(sectionUrl)
    } catch (error) {
      console.warn(`Skipping section ${section.id}: ${error instanceof Error ? error.message : String(error)}`)
      sectionQuestionOrder[section.id] = []
      return
    }

    const sectionQuestions = parseSectionPage(sectionHtml, sectionUrl)
    const includedQuestionIds = []
    const positionByQuestionId = new Map()

    sectionQuestions.forEach((entry, position) => {
      positionByQuestionId.set(entry.questionId, position)
    })

    const toFetch = []
    for (const entry of sectionQuestions) {
      const detailPath = path.join(questionsDir, `${entry.questionId}.json`)
      const hasMeta = metaMap.has(entry.questionId)
      const hasDetail = await fileExists(detailPath)
      if (hasMeta && hasDetail) continue
      if (hasDetail && !hasMeta) {
        try {
          const cached = JSON.parse(await readFile(detailPath, 'utf8'))
          if (cached?.meta) {
            metaMap.set(entry.questionId, { ...cached.meta, level: normalizeLevel(cached.meta.level), memberSectionIds: [], sectionOrders: {} })
            continue
          }
        } catch {}
      }
      if (toFetch.length >= options.maxQuestionsPerSubject) break
      toFetch.push(entry)
    }

    await runWithConcurrency(toFetch, QUESTION_CONCURRENCY, async (entry) => {
      try {
        const questionHtml = await fetchHtml(entry.url)
        const { meta, detail, images } = parseQuestionPage(questionHtml, entry.url, subject.id)
        for (const image of images ?? []) {
          const imagePath = path.join(imagesDir, image.filename)
          if (!(await fileExists(imagePath))) {
            await writeFile(imagePath, Buffer.from(image.base64, 'base64'))
          }
        }
        await writeFile(path.join(questionsDir, `${entry.questionId}.json`), JSON.stringify({ ...detail, meta }))
        metaMap.set(entry.questionId, meta)
        addedQuestionCount += 1
      } catch (error) {
        console.warn(`Skipping question ${entry.questionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    for (const entry of sectionQuestions) {
      const meta = metaMap.get(entry.questionId)
      if (!meta) continue
      meta.memberSectionIds = dedupeByCanonicalOrder([...meta.memberSectionIds, section.id], sectionOrderIndex)
      meta.sectionOrders = {
        ...meta.sectionOrders,
        [section.id]: positionByQuestionId.get(entry.questionId) ?? 0,
      }
      includedQuestionIds.push(entry.questionId)
    }

    sectionQuestionOrder[section.id] = includedQuestionIds
    sectionsDone += 1
    console.log(
      `[${subject.id}] (${sectionsDone}/${syllabus.length}) section ${section.id}: ${sectionQuestions.length} qs (fetched ${toFetch.length})`,
    )

    if (sectionsDone % 5 === 0) {
      await writeIndexSnapshot()
    }
  })

  const questions = [...metaMap.values()].sort((left, right) => left.referenceCode.localeCompare(right.referenceCode))

  const index = {
    subject: { id: subject.id, name: subject.name },
    syllabus,
    sectionQuestionOrder,
    questions,
  }

  await writeFile(indexPath, JSON.stringify(index))

  console.log(`[${subject.id}] done: ${questions.length} total, +${addedQuestionCount} new`)

  return index
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await mkdir(SUBJECT_DIR, { recursive: true })

  let subjects
  if (/syllabus_sections\.html$/.test(options.seedUrl)) {
    const folderMatch = options.seedUrl.match(/\/(\d+-[A-Za-z0-9-]+)\/syllabus_sections\.html$/)
    const id = folderMatch?.[1] ?? 'unknown-subject'
    subjects = [{ id, name: id, url: options.seedUrl }]
  } else {
    const seedHtml = await fetchHtml(options.seedUrl)
    subjects = parseSubjectLinksFromHtml(seedHtml, options.seedUrl)
    if (subjects.length === 0) {
      console.warn(`Seed HTML returned 0 subjects. len=${seedHtml.length}. First 800 chars:\n${seedHtml.slice(0, 800)}`)
    }
  }

  if (options.subjects) {
    subjects = subjects.filter((subject) => options.subjects.includes(subject.id))
  }

  console.log(`Ingesting ${subjects.length} subjects: ${subjects.map((s) => s.id).join(', ')}`)

  const existingManifest = await readJson(path.join(OUT_DIR, 'manifest.json'))
  const manifestSubjects = existingManifest?.subjects ? [...existingManifest.subjects] : []

  const writeManifest = async () => {
    const manifest = {
      version: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      subjects: manifestSubjects,
    }
    await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }

  await runWithConcurrency(subjects, SUBJECT_CONCURRENCY, async (subject) => {
    let bundle
    try {
      bundle = await ingestSubject(subject, options)
    } catch (error) {
      console.error(`[${subject.id}] FAILED: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const summary = {
      id: subject.id,
      name: subject.name,
      bundleUrl: `/data/subjects/${subject.id}/index.json`,
      bundleHash: hashJson(bundle),
      questionCount: bundle.questions.length,
      nodeCount: bundle.syllabus.length,
    }
    const existingIdx = manifestSubjects.findIndex((entry) => entry.id === subject.id)
    if (existingIdx >= 0) manifestSubjects[existingIdx] = summary
    else manifestSubjects.push(summary)
    await writeManifest()
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
