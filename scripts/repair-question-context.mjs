import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as cheerio from 'cheerio'

const DEFAULT_DATA_ROOT = 'public/data'
const DONOR_PAIRS = [
  ['46-dp-physics-last-assessment-2024', '59-dp-physics-first-assessment-2025'],
  ['43-dp-biology-last-assessment-2024', '57-dp-biology-first-assessment-2025'],
  ['45-dp-chemistry-last-assessment-2024', '58-dp-chemistry-first-assessment-2025'],
]

function parseArgs(argv) {
  const options = {
    dataRoot: DEFAULT_DATA_ROOT,
    dryRun: false,
    subjects: null,
  }

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    if (arg.startsWith('--data-root=')) options.dataRoot = arg.split('=')[1]
    if (arg.startsWith('--subjects=')) {
      options.subjects = new Set(arg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean))
    }
  }

  return options
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

function normalizeReference(referenceCode) {
  return String(referenceCode || '')
    .toLowerCase()
    .replace(/\.ahl\./g, '.hl.')
    .replace(/\.([sh]l)\./g, '.level.')
    .replace(/\s+/g, '')
}

function looseReference(referenceCode) {
  return normalizeReference(referenceCode)
    .replace(/\.\d+([a-z])(?=[(.])/g, '.$1')
    .replace(/\.\d+([a-z])(?=\.)/g, '.$1')
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

function hasParentContext(html) {
  return html.includes('qb-parent-stem') || /class=["'][^"']*q_resource/.test(html)
}

function isBetterDonor(target, donor) {
  const targetText = comparableText(textFromHtml(target.questionHtml))
  const donorText = comparableText(textFromHtml(donor.questionHtml))
  if (!targetText || !donorText.includes(targetText.slice(0, Math.min(targetText.length, 160)))) {
    return false
  }

  const targetImageCount = imgRefs(target.questionHtml).length
  const donorImageCount = imgRefs(donor.questionHtml).length
  const donorAddsContext = hasParentContext(donor.questionHtml) && !hasParentContext(target.questionHtml)
  const donorAddsImages = donorImageCount > targetImageCount
  const donorAddsText = donorText.length > targetText.length + 80

  return donorAddsContext || donorAddsImages || donorAddsText
}

async function loadSubjectDetails(dataRoot, subjectId) {
  const subjectDir = path.join(dataRoot, 'subjects', subjectId)
  const index = await readJson(path.join(subjectDir, 'index.json'))
  const details = []

  for (const meta of index.questions) {
    const detailPath = path.join(subjectDir, 'q', `${meta.questionId}.json`)
    if (!(await fileExists(detailPath))) continue
    const detail = await readJson(detailPath)
    details.push({ meta, detail })
  }

  return { subjectDir, index, details }
}

function addDonor(donorMap, key, donor) {
  if (!key) return
  const current = donorMap.get(key) ?? []
  current.push(donor)
  donorMap.set(key, current)
}

function donorScore(donor) {
  return Number(hasParentContext(donor.detail.questionHtml)) * 10
    + imgRefs(donor.detail.questionHtml).length
    + Math.min(10, textFromHtml(donor.detail.questionHtml).length / 200)
}

function sortedDonors(donors) {
  return donors.slice().sort((left, right) => donorScore(right) - donorScore(left))
}

function findBestDonor(donorMap, target) {
  const donors = [
    ...(donorMap.get(normalizeReference(target.meta.referenceCode)) ?? []),
    ...(donorMap.get(looseReference(target.meta.referenceCode)) ?? []),
  ]
  const seen = new Set()

  for (const donor of sortedDonors(donors)) {
    if (seen.has(donor.meta.questionId)) continue
    seen.add(donor.meta.questionId)
    if (isBetterDonor(target.detail, donor.detail)) return donor
  }

  return null
}

function buildDonorMap(subject) {
  const donorMap = new Map()
  for (const item of subject.details) {
    if (!hasParentContext(item.detail.questionHtml) && imgRefs(item.detail.questionHtml).length === 0) continue
    addDonor(donorMap, normalizeReference(item.meta.referenceCode), item)
    addDonor(donorMap, looseReference(item.meta.referenceCode), item)
  }
  return donorMap
}

async function copyQuestionImages(donorSubjectDir, targetSubjectDir, html, dryRun) {
  const targetImgDir = path.join(targetSubjectDir, 'img')
  if (!dryRun) await mkdir(targetImgDir, { recursive: true })

  for (const ref of imgRefs(html)) {
    const targetPath = path.join(targetImgDir, ref)
    if (await fileExists(targetPath)) continue
    const donorPath = path.join(donorSubjectDir, 'img', ref)
    if (!(await fileExists(donorPath))) continue
    if (!dryRun) await copyFile(donorPath, targetPath)
  }
}

async function repairSubject(dataRoot, donorId, targetId, dryRun) {
  const donorSubject = await loadSubjectDetails(dataRoot, donorId)
  const targetSubject = await loadSubjectDetails(dataRoot, targetId)
  const donorMap = buildDonorMap(donorSubject)
  const changed = []

  for (const item of targetSubject.details) {
    const donor = findBestDonor(donorMap, item)
    if (!donor) continue

    changed.push({
      questionId: item.meta.questionId,
      referenceCode: item.meta.referenceCode,
      donorQuestionId: donor.meta.questionId,
      donorReferenceCode: donor.meta.referenceCode,
    })

    if (!dryRun) {
      await copyQuestionImages(donorSubject.subjectDir, targetSubject.subjectDir, donor.detail.questionHtml, dryRun)
      const detailPath = path.join(targetSubject.subjectDir, 'q', `${item.meta.questionId}.json`)
      await writeJsonAtomic(detailPath, {
        ...item.detail,
        questionHtml: donor.detail.questionHtml,
      })
    }
  }

  return changed
}

async function rebuildManifest(dataRoot, touchedSubjectIds, dryRun) {
  if (dryRun || touchedSubjectIds.size === 0) return
  const manifestPath = path.join(dataRoot, 'manifest.json')
  const manifest = await readJson(manifestPath)

  for (const subjectId of touchedSubjectIds) {
    const subjectDir = path.join(dataRoot, 'subjects', subjectId)
    const index = await readJson(path.join(subjectDir, 'index.json'))
    const bundleHash = hashJson({
      index,
      repairedAt: new Date().toISOString(),
    })
    const hashedFilename = `index-${bundleHash}.json`
    await writeJsonAtomic(path.join(subjectDir, hashedFilename), index)
    await writeJsonAtomic(path.join(subjectDir, 'index.json'), index)

    const manifestSubject = manifest.subjects.find((subject) => subject.id === subjectId)
    if (manifestSubject) {
      manifestSubject.bundleHash = bundleHash
      manifestSubject.bundleUrl = `/data/subjects/${subjectId}/${hashedFilename}`
      manifestSubject.questionCount = index.questions.length
      manifestSubject.nodeCount = index.syllabus.length
      manifestSubject.paperCoverage = [...new Set(index.questions.map((q) => q.paper))]
    }
  }

  manifest.version = new Date().toISOString()
  manifest.generatedAt = manifest.version
  await writeJsonAtomic(manifestPath, manifest, { pretty: true })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const touchedSubjectIds = new Set()

  for (const [donorId, targetId] of DONOR_PAIRS) {
    if (options.subjects && !options.subjects.has(targetId)) continue
    const changed = await repairSubject(options.dataRoot, donorId, targetId, options.dryRun)
    if (changed.length) touchedSubjectIds.add(targetId)
    console.log(`${targetId}: repaired ${changed.length} questions from ${donorId}`)
    for (const entry of changed.slice(0, 12)) {
      console.log(`  ${entry.questionId} ${entry.referenceCode} <- ${entry.donorQuestionId} ${entry.donorReferenceCode}`)
    }
    if (changed.length > 12) console.log(`  ... ${changed.length - 12} more`)
  }

  await rebuildManifest(options.dataRoot, touchedSubjectIds, options.dryRun)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
