import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as cheerio from 'cheerio'

const DEFAULT_DATA_ROOT = 'public/data'
const MATH_SUBJECT_IDS = new Set([
  '50-dp-mathematics-analysis-and-approaches',
  '51-dp-mathematics-applications-and-interpretation',
])
const USEFUL_PARENT_PATTERN =
  /\b(?:consider|diagram|graph|table|figure|shown|given|following|data|function|random|model|experiment|let)\b/i
function parseArgs(argv) {
  const options = {
    dataRoot: DEFAULT_DATA_ROOT,
    dryRun: false,
  }

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    if (arg.startsWith('--data-root=')) options.dataRoot = arg.split('=')[1]
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

function textFromHtml(html) {
  return cheerio.load(html || '').text().replace(/\s+/g, ' ').trim()
}

function mediaCount(html) {
  const $ = cheerio.load(html || '')
  return $('img, image, source, svg, table').length
}

function parentStems(html) {
  const $ = cheerio.load(html || '')
  return $('.qb-parent-stem, .q_resource').map((_, element) => $.html(element)).get()
}

function hasParentContext(html) {
  return parentStems(html).length > 0
}

function normalizeRef(referenceCode) {
  return String(referenceCode || '').toLowerCase().replace(/\s+/g, '')
}

function familyRef(referenceCode) {
  const raw = String(referenceCode || '')
  const numberedPart = raw.match(/^(.*?\.(?:T_)?\d+)[a-z](?:(?:\.|\()?([ivxlcdm]+)\)?)?$/i)
  if (numberedPart) return numberedPart[1]

  const compactPart = raw.match(/^(.*?\.(?:T_)?\d+)[a-z]+$/i)
  return compactPart ? compactPart[1] : null
}

function normalizedParentKey(html) {
  return textFromHtml(html).toLowerCase().replace(/\s+/g, ' ').slice(0, 700)
}

function outerHtmlForLeaf(html) {
  const $ = cheerio.load(html || '')
  const leaf = $('.qb-leaf-prompt').last()
  if (leaf.length) return $.html(leaf)
  return `<div class="qb-leaf-prompt">${html || ''}</div>`
}

function isBetterExactDonor(target, donor) {
  const targetText = textFromHtml(target.questionHtml)
  const donorText = textFromHtml(donor.questionHtml)
  if (!targetText || !donorText.includes(targetText.slice(0, Math.min(targetText.length, 120)))) {
    return false
  }

  return parentStems(donor.questionHtml).length > parentStems(target.questionHtml).length
    || mediaCount(donor.questionHtml) > mediaCount(target.questionHtml)
    || donorText.length > targetText.length + 80
}

function duplicateScore(item) {
  return parentStems(item.detail.questionHtml).length * 100
    + mediaCount(item.detail.questionHtml) * 20
    + Math.min(20, textFromHtml(item.detail.questionHtml).length / 100)
}

async function loadSubject(dataRoot, subjectId) {
  const subjectDir = path.join(dataRoot, 'subjects', subjectId)
  const index = await readJson(path.join(subjectDir, 'index.json'))
  const items = []

  for (const meta of index.questions) {
    const detailPath = path.join(subjectDir, 'q', `${meta.questionId}.json`)
    if (!(await fileExists(detailPath))) continue
    items.push({
      meta,
      detail: await readJson(detailPath),
      detailPath,
    })
  }

  return { subjectDir, index, items }
}

async function repairExactDuplicates(subject, dryRun) {
  const byRef = new Map()
  const changes = []

  for (const item of subject.items) {
    const key = normalizeRef(item.meta.referenceCode)
    const group = byRef.get(key) ?? []
    group.push(item)
    byRef.set(key, group)
  }

  for (const group of byRef.values()) {
    if (group.length < 2) continue
    const donor = group.slice().sort((left, right) => duplicateScore(right) - duplicateScore(left))[0]

    for (const target of group) {
      if (target === donor || !isBetterExactDonor(target.detail, donor.detail)) continue
      changes.push({
        questionId: target.meta.questionId,
        referenceCode: target.meta.referenceCode,
        source: donor.meta.questionId,
        kind: 'exact-ref',
      })

      if (!dryRun) {
        target.detail.questionHtml = donor.detail.questionHtml
        await writeJsonAtomic(target.detailPath, target.detail)
      }
    }
  }

  return changes
}

function usefulParent(html) {
  return mediaCount(html) > 0 || USEFUL_PARENT_PATTERN.test(textFromHtml(html))
}

function chooseStableFamilyParent(items) {
  const firstParents = items
    .map((item) => parentStems(item.detail.questionHtml)[0])
    .filter(Boolean)
    .filter(usefulParent)

  if (!firstParents.length) return null

  const counts = new Map()
  for (const parent of firstParents) {
    const key = normalizedParentKey(parent)
    const current = counts.get(key) ?? { count: 0, parent }
    current.count += 1
    counts.set(key, current)
  }

  const ranked = [...counts.values()].sort((left, right) => right.count - left.count)
  const winner = ranked[0]
  const distinctCount = ranked.length
  const enoughAgreement = distinctCount <= 2 || winner.count >= Math.ceil(firstParents.length * 0.6)

  return enoughAgreement ? winner.parent : null
}

async function repairMathFamilyParents(subject, dryRun) {
  if (!MATH_SUBJECT_IDS.has(subject.index.subject?.id)) return []

  const byFamily = new Map()
  const changes = []

  for (const item of subject.items) {
    const family = familyRef(item.meta.referenceCode)
    if (!family) continue
    const group = byFamily.get(family) ?? []
    group.push(item)
    byFamily.set(family, group)
  }

  for (const group of byFamily.values()) {
    if (group.length < 2) continue
    const parent = chooseStableFamilyParent(group)
    if (!parent) continue

    const parentText = textFromHtml(parent)
    for (const target of group) {
      const currentText = textFromHtml(target.detail.questionHtml)
      if (hasParentContext(target.detail.questionHtml)) continue
      if (currentText.length > 320) continue
      if (currentText.includes(parentText.slice(0, Math.min(80, parentText.length)))) continue

      changes.push({
        questionId: target.meta.questionId,
        referenceCode: target.meta.referenceCode,
        kind: 'math-family',
      })

      if (!dryRun) {
        target.detail.questionHtml = `${parent}\n${outerHtmlForLeaf(target.detail.questionHtml)}`
        await writeJsonAtomic(target.detailPath, target.detail)
      }
    }
  }

  return changes
}

const cylinderDiagram = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 230" role="img" aria-label="A hollow cylinder with outer radius 4r, inner radius r, and height h" style="max-width:420px;width:100%;height:auto;display:block;margin:0 auto;">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor"/></marker>
  </defs>
  <ellipse cx="210" cy="54" rx="118" ry="34" fill="none" stroke="currentColor" stroke-width="3"/>
  <ellipse cx="210" cy="54" rx="31" ry="10" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M92 54 L92 164" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M328 54 L328 164" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M179 54 L179 164" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="5 6"/>
  <path d="M241 54 L241 164" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="5 6"/>
  <ellipse cx="210" cy="164" rx="118" ry="34" fill="none" stroke="currentColor" stroke-width="3"/>
  <ellipse cx="210" cy="164" rx="31" ry="10" fill="none" stroke="currentColor" stroke-width="3"/>
  <line x1="350" y1="54" x2="350" y2="164" stroke="currentColor" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="365" y="113" font-size="24" fill="currentColor">h</text>
  <line x1="210" y1="164" x2="241" y2="164" stroke="currentColor" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="219" y="194" font-size="22" fill="currentColor">r</text>
  <line x1="241" y1="164" x2="328" y2="164" stroke="currentColor" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="276" y="194" font-size="22" fill="currentColor">3r</text>
  <text x="136" y="216" font-size="15" fill="currentColor">diagram not to scale</text>
</svg>`

function knownMathContext(referenceCode, originalHtml) {
  const leaf = outerHtmlForLeaf(originalHtml)

  if (/^23N\.2\.(?:SL\.TZ2\.9|AHL\.TZ[12]\.10)/.test(referenceCode)) {
    const root = `<div class="qb-parent-stem"><p>A farmer is growing a field of wheat plants. The height, <em>H</em> cm, of each plant can be modelled by a normal distribution with mean &mu; and standard deviation &sigma;.</p>
<p>It is known that P(<em>H</em> &lt; 94.6) = 0.288 and P(<em>H</em> &gt; 98.1) = 0.434.</p></div>`
    const partC = `<div class="qb-parent-stem"><p>The farmer measures 100 randomly selected plants. Any plant with a height greater than 98.1 cm is considered ready to harvest. Heights of plants are independent of each other.</p></div>`
    return /^23N\.2\.(?:SL\.TZ2\.9|AHL\.TZ[12]\.10)c(?:i|ii)$/.test(referenceCode)
      ? `${root}\n${partC}\n${leaf}`
      : `${root}\n${leaf}`
  }

  if (/^23N\.2\.SL\.TZ1\.9/.test(referenceCode)) {
    const root = `<div class="qb-parent-stem"><p>A farmer is growing a field of rice plants. The height, <em>H</em> cm, of each plant can be modelled by a normal distribution with mean &mu; and standard deviation &sigma;.</p>
<p>It is known that P(<em>H</em> &lt; 82.4) = 0.213 and P(<em>H</em> &gt; 87.3) = 0.409.</p></div>`
    const partC = `<div class="qb-parent-stem"><p>The farmer measures 100 randomly selected plants. Any plant with a height greater than 87.3 cm is considered ready to harvest. Heights of plants are independent of each other.</p></div>`
    return /^23N\.2\.SL\.TZ1\.9c(?:i|ii)$/.test(referenceCode)
      ? `${root}\n${partC}\n${leaf}`
      : `${root}\n${leaf}`
  }

  if (/^24N\.1\.SL\.TZ[12]\.9/.test(referenceCode)) {
    const root = `<div class="qb-parent-stem"><p>Consider a cylinder of radius 4<em>r</em> and height <em>h</em>. A smaller cylinder of radius <em>r</em> is removed from the centre to form a hollow cylinder. This is shown in the following diagram.</p>
<p>All lengths are measured in centimetres.</p>
${cylinderDiagram}
<p>The total surface area of the hollow cylinder, in cm<sup>2</sup>, is given by <em>S</em>.</p>
<p>The volume of the hollow cylinder, in cm<sup>3</sup>, is given by <em>V</em>.</p></div>`
    const volume = `<div class="qb-parent-stem"><p>The total surface area of the hollow cylinder is 240&pi; cm<sup>2</sup>.</p>
<p>From part (b), <em>V</em> = 360&pi;<em>r</em> - 45&pi;<em>r</em><sup>3</sup>.</p></div>`
    const maximum = `<div class="qb-parent-stem"><p>The hollow cylinder has its maximum volume when <em>r</em> = <em>p</em>&radic;(2/3), where <em>p</em> &isin; Z<sup>+</sup>.</p></div>`
    const parts = [root]
    if (/\.9(?:c|d|e)$/.test(referenceCode)) parts.push(volume)
    if (/\.9(?:d|e)$/.test(referenceCode)) parts.push(maximum)
    return [...parts, leaf].join('\n')
  }

  return null
}

async function repairKnownMathContext(subject, dryRun) {
  if (subject.index.subject?.id !== '50-dp-mathematics-analysis-and-approaches') return []

  const changes = []
  for (const item of subject.items) {
    const nextHtml = knownMathContext(item.meta.referenceCode, item.detail.questionHtml)
    if (!nextHtml || nextHtml === item.detail.questionHtml) continue

    changes.push({
      questionId: item.meta.questionId,
      referenceCode: item.meta.referenceCode,
      kind: 'known-math',
    })

    if (!dryRun) {
      item.detail.questionHtml = nextHtml
      await writeJsonAtomic(item.detailPath, item.detail)
    }
  }

  return changes
}

async function rebuildManifest(dataRoot, touchedSubjectIds, dryRun) {
  if (dryRun || touchedSubjectIds.size === 0) return
  const manifestPath = path.join(dataRoot, 'manifest.json')
  const manifest = await readJson(manifestPath)

  for (const subjectId of touchedSubjectIds) {
    const subjectDir = path.join(dataRoot, 'subjects', subjectId)
    await mkdir(subjectDir, { recursive: true })
    const index = await readJson(path.join(subjectDir, 'index.json'))
    const bundleHash = hashJson({ index, repairedAt: new Date().toISOString() })
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readJson(path.join(options.dataRoot, 'manifest.json'))
  const touchedSubjectIds = new Set()

  for (const manifestSubject of manifest.subjects) {
    const subject = await loadSubject(options.dataRoot, manifestSubject.id)
    const changes = [
      ...(await repairExactDuplicates(subject, options.dryRun)),
      ...(await repairMathFamilyParents(subject, options.dryRun)),
      ...(await repairKnownMathContext(subject, options.dryRun)),
    ]

    if (changes.length) touchedSubjectIds.add(manifestSubject.id)
    console.log(`${manifestSubject.id}: repaired ${changes.length} questions`)
    for (const change of changes.slice(0, 12)) {
      const source = change.source ? ` <- ${change.source}` : ''
      console.log(`  ${change.kind} ${change.questionId} ${change.referenceCode}${source}`)
    }
    if (changes.length > 12) console.log(`  ... ${changes.length - 12} more`)
  }

  await rebuildManifest(options.dataRoot, touchedSubjectIds, options.dryRun)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
