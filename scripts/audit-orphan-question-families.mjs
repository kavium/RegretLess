import { cpus } from 'node:os'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads'
import * as cheerio from 'cheerio'

const DEFAULT_DATA_ROOT = 'public/data'
const DEFAULT_REPORT = 'tmp/orphan-question-family-audit.json'
const DEFAULT_SHORT_TEXT_LIMIT = 180

const ORPHAN_CONTEXT_PATTERNS = [
  /\b(?:above|below|shown|following|given|provided)\b/i,
  /\b(?:diagram|graph|table|figure|image|photograph|micrograph|source|extract|data)\b/i,
  /\b(?:compound|molecule|substance|species|curve|function|sequence|series|investment|option)\s+[A-Z]\b/i,
  /\b(?:this|these|the)\s+(?:compound|molecule|substance|species|diagram|graph|table|figure|data|information|experiment|reaction|source|extract)\b/i,
  /\bin\s+(?:part\s+)?\(?[a-z]\)?(?:\(?[ivxlcdm0-9]+\)?)?\b/i,
]

const LEAF_ONLY_PATTERNS = [
  /^Option\s+[A-D][.;]?$/i,
  /^[A-D][.;]?$/i,
  /^(?:hence|therefore),?\s/i,
  /^(?:find|calculate|determine|state|write down|deduce|show that|explain|suggest|identify|outline)\b/i,
]

function parseArgs(argv) {
  const options = {
    dataRoot: DEFAULT_DATA_ROOT,
    report: DEFAULT_REPORT,
    workers: Math.max(1, Math.min(cpus().length, 6)),
    shortTextLimit: DEFAULT_SHORT_TEXT_LIMIT,
    maxExamples: 20,
  }

  for (const arg of argv) {
    if (arg.startsWith('--data-root=')) options.dataRoot = arg.split('=')[1]
    if (arg.startsWith('--report=')) options.report = arg.split('=')[1]
    if (arg.startsWith('--workers=')) {
      const parsed = Number.parseInt(arg.split('=')[1], 10)
      if (Number.isSafeInteger(parsed) && parsed > 0) options.workers = parsed
    }
    if (arg.startsWith('--short-text-limit=')) {
      const parsed = Number.parseInt(arg.split('=')[1], 10)
      if (Number.isSafeInteger(parsed) && parsed > 0) options.shortTextLimit = parsed
    }
    if (arg.startsWith('--max-examples=')) {
      const parsed = Number.parseInt(arg.split('=')[1], 10)
      if (Number.isSafeInteger(parsed) && parsed >= 0) options.maxExamples = parsed
    }
  }

  return options
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function textFromHtml(html) {
  return cheerio.load(html || '').text().replace(/\s+/g, ' ').trim()
}

function mediaCount(html) {
  const $ = cheerio.load(html || '')
  return $('img, image, source, svg, table').length
}

function parentCount(html) {
  const $ = cheerio.load(html || '')
  return $('.qb-parent-stem, .q_resource').length
}

function imageRefsFromHtml(html) {
  const $ = cheerio.load(html || '')
  const refs = []

  $('img, image, source').each((_, element) => {
    for (const attr of ['src', 'href', 'xlink:href', 'poster']) {
      const value = $(element).attr(attr)
      if (!value || !value.includes('__IMG__/')) continue
      refs.push(value.split('__IMG__/')[1].split(/[?#]/)[0])
    }
  })

  return refs
}

function familyRef(referenceCode) {
  const raw = String(referenceCode || '')
  const questionNumber = raw.match(/^(.*?\.TZ[^.]+\.\d+)/i)
  return questionNumber ? questionNumber[1] : null
}

function hasContextPhrase(text) {
  return ORPHAN_CONTEXT_PATTERNS.some((pattern) => pattern.test(text))
}

function isLeafLike(text) {
  return LEAF_ONLY_PATTERNS.some((pattern) => pattern.test(text))
}

function riskForQuestion(question, family, shortTextLimit) {
  if (question.parentCount > 0) return null

  const shortText = question.textLength <= shortTextLimit
  const noUsefulMedia = question.mediaCount === 0
  const siblingHasContext = family.maxParentCount > 0 || family.maxMediaCount > 0 || family.maxTextLength >= shortTextLimit * 2
  const contextual = question.contextPhrase || question.leafLike

  if (!shortText || !noUsefulMedia || !contextual) return null

  let score = 0
  const reasons = []

  if (question.leafLike) {
    score += 3
    reasons.push('leaf-like wording')
  }
  if (question.contextPhrase) {
    score += 3
    reasons.push('mentions missing context')
  }
  if (siblingHasContext) {
    score += 4
    reasons.push('sibling has context')
  }
  if (family.size > 1) {
    score += 1
    reasons.push('multi-part family')
  }
  if (question.textLength <= 40) {
    score += 2
    reasons.push('very short text')
  }

  return {
    score,
    reasons,
    severity: score >= 9 ? 'high' : score >= 6 ? 'medium' : 'low',
  }
}

async function analyzeSubject(dataRoot, subject, shortTextLimit, maxExamples) {
  const subjectDir = path.join(dataRoot, 'subjects', subject.id)
  const index = await readJson(path.join(subjectDir, 'index.json'))
  const questions = []
  let missingImageQuestionCount = 0

  for (const meta of index.questions) {
    const detail = await readJson(path.join(subjectDir, 'q', `${meta.questionId}.json`))
    const questionHtml = detail.questionHtml || ''
    const markschemeHtml = detail.markschemeHtml || ''
    const questionImageRefs = imageRefsFromHtml(questionHtml)
    const markschemeImageRefs = imageRefsFromHtml(markschemeHtml)
    const missingImageRefs = []

    for (const ref of new Set([...questionImageRefs, ...markschemeImageRefs])) {
      if (!(await fileExists(path.join(subjectDir, 'img', ref)))) missingImageRefs.push(ref)
    }

    if (missingImageRefs.length) missingImageQuestionCount += 1

    const text = textFromHtml(questionHtml)
    questions.push({
      questionId: meta.questionId,
      referenceCode: meta.referenceCode,
      title: meta.title,
      paper: meta.paper,
      familyRef: familyRef(meta.referenceCode),
      text,
      textLength: text.length,
      parentCount: parentCount(questionHtml),
      mediaCount: mediaCount(questionHtml),
      questionImageCount: questionImageRefs.length,
      missingImageRefs,
      leafLike: isLeafLike(text),
      contextPhrase: hasContextPhrase(text),
    })
  }

  const byFamily = new Map()
  for (const question of questions) {
    if (!question.familyRef) continue
    const group = byFamily.get(question.familyRef) ?? []
    group.push(question)
    byFamily.set(question.familyRef, group)
  }

  const riskyFamilies = []
  let highRiskQuestionCount = 0
  let mediumRiskQuestionCount = 0
  let lowRiskQuestionCount = 0

  for (const [ref, familyQuestions] of byFamily) {
    const family = {
      ref,
      size: familyQuestions.length,
      maxParentCount: Math.max(...familyQuestions.map((question) => question.parentCount)),
      maxMediaCount: Math.max(...familyQuestions.map((question) => question.mediaCount)),
      maxTextLength: Math.max(...familyQuestions.map((question) => question.textLength)),
    }

    const risks = familyQuestions
      .map((question) => {
        const risk = riskForQuestion(question, family, shortTextLimit)
        if (!risk) return null
        return {
          questionId: question.questionId,
          referenceCode: question.referenceCode,
          paper: question.paper,
          textLength: question.textLength,
          parentCount: question.parentCount,
          mediaCount: question.mediaCount,
          score: risk.score,
          severity: risk.severity,
          reasons: risk.reasons,
          text: question.text.slice(0, 260),
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.referenceCode.localeCompare(right.referenceCode))

    if (!risks.length) continue

    for (const risk of risks) {
      if (risk.severity === 'high') highRiskQuestionCount += 1
      else if (risk.severity === 'medium') mediumRiskQuestionCount += 1
      else lowRiskQuestionCount += 1
    }

    const siblingContextExamples = familyQuestions
      .filter((question) => question.parentCount > 0 || question.mediaCount > 0 || question.textLength >= shortTextLimit * 2)
      .sort((left, right) => right.parentCount - left.parentCount || right.mediaCount - left.mediaCount || right.textLength - left.textLength)
      .slice(0, 3)
      .map((question) => ({
        questionId: question.questionId,
        referenceCode: question.referenceCode,
        textLength: question.textLength,
        parentCount: question.parentCount,
        mediaCount: question.mediaCount,
        text: question.text.slice(0, 220),
      }))

    riskyFamilies.push({
      familyRef: ref,
      familySize: familyQuestions.length,
      maxParentCount: family.maxParentCount,
      maxMediaCount: family.maxMediaCount,
      maxTextLength: family.maxTextLength,
      risks: risks.slice(0, maxExamples),
      siblingContextExamples,
    })
  }

  riskyFamilies.sort((left, right) => {
    const leftScore = left.risks[0]?.score ?? 0
    const rightScore = right.risks[0]?.score ?? 0
    return rightScore - leftScore || right.risks.length - left.risks.length || left.familyRef.localeCompare(right.familyRef)
  })

  return {
    subjectId: subject.id,
    subjectName: subject.name,
    questionCount: questions.length,
    familyCount: byFamily.size,
    missingImageQuestionCount,
    highRiskQuestionCount,
    mediumRiskQuestionCount,
    lowRiskQuestionCount,
    riskyFamilyCount: riskyFamilies.length,
    riskyFamilies,
  }
}

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: payload })
    worker.on('message', resolve)
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`))
    })
  })
}

async function runMain() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readJson(path.join(options.dataRoot, 'manifest.json'))
  const subjects = manifest.subjects
  const workers = Math.max(1, Math.min(options.workers, subjects.length))
  const chunks = Array.from({ length: workers }, () => [])

  subjects.forEach((subject, index) => chunks[index % workers].push(subject))

  const results = (await Promise.all(
    chunks
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => runWorker({
        dataRoot: options.dataRoot,
        subjects: chunk,
        shortTextLimit: options.shortTextLimit,
        maxExamples: options.maxExamples,
      })),
  )).flat()

  results.sort((left, right) => left.subjectId.localeCompare(right.subjectId))

  const report = {
    generatedAt: new Date().toISOString(),
    dataRoot: options.dataRoot,
    shortTextLimit: options.shortTextLimit,
    subjects: results,
    totals: {
      subjects: results.length,
      questions: results.reduce((sum, subject) => sum + subject.questionCount, 0),
      families: results.reduce((sum, subject) => sum + subject.familyCount, 0),
      riskyFamilies: results.reduce((sum, subject) => sum + subject.riskyFamilyCount, 0),
      highRiskQuestions: results.reduce((sum, subject) => sum + subject.highRiskQuestionCount, 0),
      mediumRiskQuestions: results.reduce((sum, subject) => sum + subject.mediumRiskQuestionCount, 0),
      lowRiskQuestions: results.reduce((sum, subject) => sum + subject.lowRiskQuestionCount, 0),
      missingImageQuestions: results.reduce((sum, subject) => sum + subject.missingImageQuestionCount, 0),
    },
  }

  await mkdir(path.dirname(options.report), { recursive: true })
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`wrote ${options.report}`)
  console.log(`questions: ${report.totals.questions}`)
  console.log(`families: ${report.totals.families}`)
  console.log(`risky families: ${report.totals.riskyFamilies}`)
  console.log(`risk questions: high ${report.totals.highRiskQuestions}, medium ${report.totals.mediumRiskQuestions}, low ${report.totals.lowRiskQuestions}`)
  console.log(`missing image questions: ${report.totals.missingImageQuestions}`)

  for (const subject of results) {
    if (!subject.riskyFamilyCount && !subject.missingImageQuestionCount) continue
    console.log(
      `${subject.subjectId}: ${subject.riskyFamilyCount} risky families, `
      + `${subject.highRiskQuestionCount} high, ${subject.mediumRiskQuestionCount} medium, `
      + `${subject.lowRiskQuestionCount} low, ${subject.missingImageQuestionCount} missing-image questions`,
    )
  }
}

async function runWorkerThread() {
  const results = []
  for (const subject of workerData.subjects) {
    results.push(await analyzeSubject(
      workerData.dataRoot,
      subject,
      workerData.shortTextLimit,
      workerData.maxExamples,
    ))
  }
  parentPort.postMessage(results)
}

if (isMainThread) {
  runMain().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  runWorkerThread().catch((error) => {
    throw error
  })
}
