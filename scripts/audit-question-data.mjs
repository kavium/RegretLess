import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as cheerio from 'cheerio'

const DEFAULT_DATA_ROOT = 'public/data'
const CONTEXT_PATTERNS = [
  /\bcompound\s+[A-Z]\b/i,
  /\bmolecule\s+[A-Z]\b/i,
  /\bsubstance\s+[A-Z]\b/i,
  /\bspecies\s+[A-Z]\b/i,
  /\bfrom the (?:graph|diagram|figure|table|data|information|source|extract)\b/i,
  /\b(?:graph|diagram|figure|table|data|information|source|extract)\s+(?:above|below|shown|given|provided)\b/i,
  /\bin\s+(?:part\s+)?\(?[a-z]\)?\(?[ivxlcdm0-9]+\)?\b/i,
  /\bthe\s+(?:graph|diagram|figure|table|curve|image|photograph|micrograph|spectrum|chromatogram|map)\b/i,
  /\bthis\s+(?:graph|diagram|figure|table|data|information|source|extract|experiment|reaction|compound|molecule)\b/i,
  /\bthese\s+(?:results|data|compounds|molecules|structures|values)\b/i,
]

const TYPE_SELECTORS = [
  ['img', 'image'],
  ['svg', 'svg'],
  ['math', 'mathml'],
  ['table', 'table'],
  ['ol, ul', 'list'],
  ['blockquote', 'blockquote'],
]

function parseArgs(argv) {
  const options = {
    dataRoot: DEFAULT_DATA_ROOT,
    report: null,
    maxExamples: 8,
  }

  for (const arg of argv) {
    if (arg.startsWith('--data-root=')) options.dataRoot = arg.split('=')[1]
    if (arg.startsWith('--report=')) options.report = arg.split('=')[1]
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

function textFromHtml(html) {
  return cheerio.load(html || '').text().replace(/\s+/g, ' ').trim()
}

function refsFromHtml(html) {
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

function typeSetFromHtml(html) {
  const $ = cheerio.load(html || '')
  const types = new Set()

  for (const [selector, label] of TYPE_SELECTORS) {
    if ($(selector).length) types.add(label)
  }

  const text = $.text()
  if (/\$[^$]+\$|\\\(|\\\[/.test(html || '')) types.add('latex')
  if (/[A-D]\.\s/.test(text)) types.add('mcq-options')
  if (!types.size) types.add('plain-text')
  return [...types].sort()
}

function hasContextReference(text) {
  return CONTEXT_PATTERNS.some((pattern) => pattern.test(text))
}

function rootReference(referenceCode) {
  const raw = String(referenceCode || '')
  return raw
    .replace(/\.[a-z](?:\.[ivxlcdm]+|\([ivxlcdm]+\))$/i, '')
    .replace(/\.\d+[a-z](?:\.[ivxlcdm]+|\([ivxlcdm]+\))$/i, '')
    .replace(/\.[a-z]$/i, '')
}

function samplePush(items, value, max) {
  if (items.length < max) items.push(value)
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function summarizeSubject(subject, questions) {
  const byRoot = new Map()
  for (const q of questions) {
    const root = rootReference(q.referenceCode)
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(q)
  }

  let contextWithSiblingImage = 0
  for (const q of questions) {
    const siblings = byRoot.get(rootReference(q.referenceCode)) ?? []
    q.siblingQuestionImageCount = siblings
      .filter((sibling) => sibling.questionId !== q.questionId)
      .reduce((sum, sibling) => sum + sibling.questionImageRefs.length, 0)
    if (q.contextReference && q.questionImageRefs.length === 0 && q.siblingQuestionImageCount > 0) {
      contextWithSiblingImage += 1
    }
  }

  const paperCounts = {}
  const typeCounts = {}
  const subunitPaperSamples = {}
  const contextExamples = []
  const missingImageExamples = []

  for (const q of questions) {
    paperCounts[q.paper] = (paperCounts[q.paper] ?? 0) + 1
    const typeKey = q.questionTypes.join('+')
    typeCounts[typeKey] = (typeCounts[typeKey] ?? 0) + 1

    for (const sectionId of q.memberSectionIds) {
      const key = `${sectionId}|${q.paper}`
      subunitPaperSamples[key] ??= []
      samplePush(subunitPaperSamples[key], q.questionId, 3)
    }

    if (q.contextReference && q.questionText.length < 500) {
      samplePush(contextExamples, {
        questionId: q.questionId,
        referenceCode: q.referenceCode,
        paper: q.paper,
        title: q.questionText.slice(0, 220),
        questionImageRefs: q.questionImageRefs.length,
        siblingQuestionImageCount: q.siblingQuestionImageCount,
      }, 10)
    }

    if (q.missingImageRefs.length) {
      samplePush(missingImageExamples, {
        questionId: q.questionId,
        referenceCode: q.referenceCode,
        missingImageRefs: q.missingImageRefs,
      }, 10)
    }
  }

  const sampledSubunitPaperCombos = Object.keys(subunitPaperSamples).length
  const combosWithThreeSamples = Object.values(subunitPaperSamples).filter((ids) => ids.length >= 3).length

  return {
    subjectId: subject.id,
    subjectName: subject.name,
    questionCount: questions.length,
    questionWithImages: questions.filter((q) => q.questionImageRefs.length > 0).length,
    markschemeWithImages: questions.filter((q) => q.markschemeImageRefs.length > 0).length,
    missingImageQuestionCount: questions.filter((q) => q.missingImageRefs.length > 0).length,
    contextReferenceCount: questions.filter((q) => q.contextReference).length,
    contextNoQuestionImageCount: questions.filter((q) => q.contextReference && q.questionImageRefs.length === 0).length,
    contextNoQuestionImageWithSiblingImageCount: contextWithSiblingImage,
    sampledSubunitPaperCombos,
    combosWithThreeSamples,
    paperCounts,
    typeCounts,
    contextExamples,
    missingImageExamples,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readJson(path.join(options.dataRoot, 'manifest.json'))
  const report = {
    generatedAt: new Date().toISOString(),
    dataRoot: options.dataRoot,
    subjects: [],
  }

  for (const subject of manifest.subjects) {
    const subjectDir = path.join(options.dataRoot, 'subjects', subject.id)
    const index = await readJson(path.join(subjectDir, 'index.json'))
    const questions = []

    for (const meta of index.questions) {
      const detail = await readJson(path.join(subjectDir, 'q', `${meta.questionId}.json`))
      const questionText = textFromHtml(detail.questionHtml)
      const questionImageRefs = refsFromHtml(detail.questionHtml)
      const markschemeImageRefs = refsFromHtml(detail.markschemeHtml)
      const allImageRefs = [...new Set([...questionImageRefs, ...markschemeImageRefs])]
      const missingImageRefs = []

      for (const ref of allImageRefs) {
        if (!(await fileExists(path.join(subjectDir, 'img', ref)))) {
          missingImageRefs.push(ref)
        }
      }

      questions.push({
        questionId: meta.questionId,
        referenceCode: meta.referenceCode,
        paper: meta.paper,
        memberSectionIds: meta.memberSectionIds ?? [],
        questionText,
        questionTypes: typeSetFromHtml(detail.questionHtml),
        markschemeTypes: typeSetFromHtml(detail.markschemeHtml),
        questionImageRefs,
        markschemeImageRefs,
        missingImageRefs,
        contextReference: hasContextReference(questionText),
      })
    }

    const summary = summarizeSubject(subject, questions)
    report.subjects.push(summary)
    console.log(
      [
        summary.subjectId,
        `${summary.questionCount} qs`,
        `${summary.questionWithImages} q-img`,
        `${summary.missingImageQuestionCount} missing-img`,
        `${summary.contextNoQuestionImageCount} context-no-img`,
        `${summary.contextNoQuestionImageWithSiblingImageCount} context-sibling-img`,
      ].join(' | '),
    )
  }

  if (options.report) {
    await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`wrote ${options.report}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
