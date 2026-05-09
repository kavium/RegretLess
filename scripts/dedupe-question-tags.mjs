import { createHash } from 'node:crypto'
import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT_DIR = path.resolve(process.cwd(), 'public/data')
const SUBJECTS_DIR = path.join(OUT_DIR, 'subjects')
const SAFE_ID_PATTERN = /^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9_-]+$/
const PAPER_ORDER = ['1A', '1B', '1', '2', '3', 'unknown']

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
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  await writeFile(tmp, pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value))
  await rename(tmp, target)
}

function hashJson(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function paperCoverageFor(questions) {
  const papers = new Set(questions.map((question) => question.paper).filter(Boolean))
  return PAPER_ORDER.filter((paper) => papers.has(paper))
}

function textLength(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length : 0
}

function mediaCount(value) {
  if (typeof value !== 'string') return 0
  return (value.match(/<img\b|__IMG__|<svg\b|<table\b/gi) ?? []).length
}

function detailScore(detail) {
  if (!detail) return -1
  return (
    mediaCount(detail.questionHtml) * 1000
    + mediaCount(detail.markschemeHtml) * 200
    + textLength(detail.questionHtml)
    + Math.min(2000, textLength(detail.markschemeHtml))
  )
}

function compareQuestionIds(left, right) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) {
    return leftNumber - rightNumber
  }
  return String(left).localeCompare(String(right))
}

function pickKeeper(records, detailsById) {
  return records.slice().sort((left, right) => {
    const scoreDelta = detailScore(detailsById.get(right.questionId)) - detailScore(detailsById.get(left.questionId))
    if (scoreDelta !== 0) return scoreDelta
    return compareQuestionIds(left.questionId, right.questionId)
  })[0]
}

function orderedUnion(values, orderMap) {
  return [...new Set(values)].sort((left, right) => {
    const orderDelta = (orderMap.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(right) ?? Number.MAX_SAFE_INTEGER)
    if (orderDelta !== 0) return orderDelta
    return String(left).localeCompare(String(right))
  })
}

function dedupeSectionQuestionIds(ids) {
  const seen = new Set()
  const deduped = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    deduped.push(id)
  }
  return deduped
}

async function removeIfExists(filePath) {
  try {
    await unlink(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function pruneHashedBundles(subjectDir, keepFilename) {
  const entries = await readdir(subjectDir)
  let removed = 0
  for (const entry of entries) {
    if (!/^index-[a-f0-9]{40}\.json$/.test(entry) || entry === keepFilename) continue
    await unlink(resolveInside(subjectDir, entry))
    removed += 1
  }
  return removed
}

async function dedupeSubject(subjectId) {
  assertSafeId(subjectId, 'subject id')
  const subjectDir = resolveInside(SUBJECTS_DIR, subjectId)
  const indexPath = resolveInside(subjectDir, 'index.json')
  const index = await readJson(indexPath)
  const sectionOrderMap = new Map(index.syllabus.map((node) => [node.id, node.canonicalOrder]))

  const byReferenceCode = new Map()
  for (const question of index.questions) {
    if (!question.referenceCode) continue
    const group = byReferenceCode.get(question.referenceCode) ?? []
    group.push(question)
    byReferenceCode.set(question.referenceCode, group)
  }

  const duplicateGroups = [...byReferenceCode.values()].filter((group) => group.length > 1)
  if (duplicateGroups.length === 0) {
    return { subjectId, removedQuestions: 0, duplicateTags: 0, newHash: null, removedHashedBundles: 0 }
  }

  const duplicateIds = new Set(duplicateGroups.flatMap((group) => group.map((question) => question.questionId)))
  const detailsById = new Map()
  await Promise.all([...duplicateIds].map(async (questionId) => {
    assertSafeId(questionId, 'question id')
    const detailPath = resolveInside(subjectDir, 'q', `${questionId}.json`)
    detailsById.set(questionId, await readJson(detailPath))
  }))

  const duplicateToKeeper = new Map()
  const keeperIds = new Set()
  const removedIds = new Set()
  const mergedByKeeperId = new Map()

  for (const group of duplicateGroups) {
    const keeper = pickKeeper(group, detailsById)
    keeperIds.add(keeper.questionId)
    const allSectionIds = group.flatMap((question) => question.memberSectionIds ?? [])
    const sectionOrders = {}
    for (const question of group) {
      for (const [sectionId, order] of Object.entries(question.sectionOrders ?? {})) {
        sectionOrders[sectionId] = Math.min(sectionOrders[sectionId] ?? order, order)
      }
    }

    mergedByKeeperId.set(keeper.questionId, {
      ...keeper,
      memberSectionIds: orderedUnion(allSectionIds, sectionOrderMap),
      sectionOrders,
    })

    for (const question of group) {
      duplicateToKeeper.set(question.questionId, keeper.questionId)
      if (question.questionId !== keeper.questionId) {
        removedIds.add(question.questionId)
      }
    }
  }

  const questions = index.questions
    .filter((question) => !removedIds.has(question.questionId))
    .map((question) => mergedByKeeperId.get(question.questionId) ?? question)
    .sort((left, right) => left.referenceCode.localeCompare(right.referenceCode))

  const sectionQuestionOrder = {}
  for (const [sectionId, ids] of Object.entries(index.sectionQuestionOrder)) {
    sectionQuestionOrder[sectionId] = dedupeSectionQuestionIds(ids.map((id) => duplicateToKeeper.get(id) ?? id))
  }

  const nextIndex = {
    ...index,
    sectionQuestionOrder,
    questions,
  }

  const knownQuestionIds = new Set(questions.map((question) => question.questionId))
  for (const [sectionId, ids] of Object.entries(sectionQuestionOrder)) {
    for (const questionId of ids) {
      if (!knownQuestionIds.has(questionId)) {
        throw new Error(`${subjectId}: section ${sectionId} references removed question ${questionId}`)
      }
    }
  }

  await writeJsonAtomic(indexPath, nextIndex)
  const newHash = hashJson(nextIndex)
  const hashedFilename = `index-${newHash}.json`
  await writeJsonAtomic(resolveInside(subjectDir, hashedFilename), nextIndex)
  const removedHashedBundles = await pruneHashedBundles(subjectDir, hashedFilename)

  let removedQuestionFiles = 0
  for (const questionId of removedIds) {
    if (keeperIds.has(questionId)) continue
    removedQuestionFiles += await removeIfExists(resolveInside(subjectDir, 'q', `${questionId}.json`)) ? 1 : 0
  }

  return {
    subjectId,
    removedQuestions: removedIds.size,
    removedQuestionFiles,
    duplicateTags: duplicateGroups.length,
    questionCount: questions.length,
    nodeCount: nextIndex.syllabus.length,
    paperCoverage: paperCoverageFor(questions),
    newHash,
    hashedFilename,
    removedHashedBundles,
  }
}

async function main() {
  const manifestPath = resolveInside(OUT_DIR, 'manifest.json')
  const manifest = await readJson(manifestPath)
  const subjectIds = (await readdir(SUBJECTS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const results = []
  for (const subjectId of subjectIds) {
    results.push(await dedupeSubject(subjectId))
  }

  const changedBySubjectId = new Map(results.filter((result) => result.newHash).map((result) => [result.subjectId, result]))
  if (changedBySubjectId.size > 0) {
    const subjects = manifest.subjects.map((subject) => {
      const changed = changedBySubjectId.get(subject.id)
      if (!changed) return subject
      return {
        ...subject,
        bundleUrl: `/data/subjects/${subject.id}/${changed.hashedFilename}`,
        bundleHash: changed.newHash,
        questionCount: changed.questionCount,
        nodeCount: changed.nodeCount,
        paperCoverage: changed.paperCoverage,
      }
    })

    await writeJsonAtomic(manifestPath, {
      ...manifest,
      version: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      subjects,
    }, { pretty: true })
  }

  for (const result of results) {
    if (!result.newHash) {
      console.log(`${result.subjectId}: no duplicate question tags`)
      continue
    }
    console.log(
      `${result.subjectId}: removed ${result.removedQuestions} duplicate questions across ${result.duplicateTags} tags; `
      + `${result.questionCount} remain; removed ${result.removedQuestionFiles} detail files and `
      + `${result.removedHashedBundles} old hashed bundles`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
