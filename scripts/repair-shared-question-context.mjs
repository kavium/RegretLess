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
const ORPHAN_CONTEXT_PATTERN =
  /\b(?:above|below|shown|following|given|provided|diagram|graph|table|figure|image|photograph|micrograph|source|extract|data|compound|molecule|substance|species|curve|function|sequence|series|investment|option|part)\b/i
const LEAF_ONLY_PATTERN =
  /^(?:option\s+[A-D][.;]?|[A-D][.;]?|hence\b|therefore\b|find\b|calculate\b|determine\b|state\b|write down\b|deduce\b|show that\b|explain\b|suggest\b|identify\b|outline\b)/i
const COMMAND_PATTERN =
  /^(?:find|calculate|determine|state|write down|deduce|show that|explain|suggest|identify|outline|describe|complete|use|sketch|draw|label|interpret|estimate|comment|justify|compare|distinguish|predict|evaluate)\b/i
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

function hasVisualContext(html) {
  return mediaCount(html) > 0
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
  const questionNumber = raw.match(/^(.*?\.TZ[^.]+\.\d+)/i)
  if (!questionNumber) return null

  return questionNumber[1]
}

function hasSubpartRef(referenceCode) {
  const family = familyRef(referenceCode)
  return Boolean(family && normalizeRef(referenceCode) !== normalizeRef(family))
}

function normalizedParentKey(html) {
  return textFromHtml(html).toLowerCase().replace(/\s+/g, ' ').slice(0, 700)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function orphanNeedsContext(html) {
  if (hasParentContext(html)) return false

  const text = textFromHtml(html)
  if (!text || text.length > 320) return false
  if (mediaCount(html) > 0) return false

  return ORPHAN_CONTEXT_PATTERN.test(text) || LEAF_ONLY_PATTERN.test(text)
}

function referencedPartLetters(text) {
  return [...String(text || '').matchAll(/\bpart\s*\(?([a-z])\)?/gi)]
    .map((match) => match[1].toLowerCase())
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
    if (!hasSubpartRef(group[0].meta.referenceCode)) continue
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

function chooseParentForTarget(target, group) {
  const targetText = textFromHtml(target.detail.questionHtml)
  const family = familyRef(target.meta.referenceCode)

  const exactRefDonors = group.filter((item) => (
    item !== target
    && normalizeRef(item.meta.referenceCode) === normalizeRef(target.meta.referenceCode)
    && parentStems(item.detail.questionHtml).length > 0
  ))

  if (exactRefDonors.length) {
    return exactRefDonors
      .slice()
      .sort((left, right) => duplicateScore(right) - duplicateScore(left))[0]
      ? parentStems(exactRefDonors.slice().sort((left, right) => duplicateScore(right) - duplicateScore(left))[0].detail.questionHtml).join('\n')
      : null
  }

  for (const letter of referencedPartLetters(targetText)) {
    const partPattern = new RegExp(`^${escapeRegExp(family)}${letter}(?:$|[.()ivxlcdm])`, 'i')
    const partDonors = group.filter((item) => (
      item !== target
      && partPattern.test(String(item.meta.referenceCode || ''))
      && parentStems(item.detail.questionHtml).length > 0
    ))

    if (partDonors.length) {
      const donor = partDonors.slice().sort((left, right) => duplicateScore(right) - duplicateScore(left))[0]
      return parentStems(donor.detail.questionHtml).join('\n')
    }
  }

  const candidateParents = group
    .flatMap((item) => parentStems(item.detail.questionHtml))
    .filter(Boolean)

  if (!candidateParents.length) return null

  const counts = new Map()
  for (const parent of candidateParents) {
    const key = normalizedParentKey(parent)
    const current = counts.get(key) ?? { count: 0, parent }
    current.count += 1
    counts.set(key, current)
  }

  const ranked = [...counts.values()].sort((left, right) => right.count - left.count)
  const winner = ranked[0]
  const hasClearWinner = winner.count >= 2
    && winner.count >= Math.ceil(candidateParents.length * 0.5)
    && (usefulParent(winner.parent) || winner.count > 1)

  return hasClearWinner ? winner.parent : null
}

function fragmentChildren($) {
  const bodyChildren = $('body').children().toArray()
  if (bodyChildren.length) return bodyChildren
  return $.root().children().toArray()
}

function childHasVisual($, child) {
  return $(child).find('img, image, source, svg, table').length > 0
    || ['img', 'image', 'source', 'svg', 'table'].includes(child.tagName)
}

function extractEmbeddedContext(html) {
  if (!hasVisualContext(html) || hasParentContext(html)) return null

  const $ = cheerio.load(html || '')
  const children = fragmentChildren($).filter((child) => {
    if (child.type !== 'tag') return false
    return textFromHtml($.html(child)) || childHasVisual($, child)
  })

  if (!children.length) return null

  while (children.length) {
    const last = children.at(-1)
    const lastText = textFromHtml($.html(last))
    if (!lastText || (!childHasVisual($, last) && COMMAND_PATTERN.test(lastText))) {
      children.pop()
      continue
    }
    break
  }

  if (children.length > 1) {
    const first = children[0]
    const firstText = textFromHtml($.html(first))
    const restHasVisual = children.slice(1).some((child) => childHasVisual($, child))
    if (!childHasVisual($, first) && restHasVisual && COMMAND_PATTERN.test(firstText)) {
      children.shift()
    }
  }

  const contextHtml = children.map((child) => $.html(child)).join('\n')
  if (!contextHtml || !hasVisualContext(contextHtml)) return null

  return `<div class="qb-parent-stem">${contextHtml}</div>`
}

function chooseEmbeddedContextForTarget(target, group) {
  const targetText = textFromHtml(target.detail.questionHtml)
  const family = familyRef(target.meta.referenceCode)

  for (const letter of referencedPartLetters(targetText)) {
    const partPattern = new RegExp(`^${escapeRegExp(family)}${letter}(?:$|[.()ivxlcdm])`, 'i')
    const partDonors = group
      .filter((item) => item !== target && partPattern.test(String(item.meta.referenceCode || '')))
      .map((item) => extractEmbeddedContext(item.detail.questionHtml))
      .filter(Boolean)

    if (partDonors.length) return partDonors[0]
  }

  const candidates = group
    .filter((item) => item !== target)
    .map((item) => extractEmbeddedContext(item.detail.questionHtml))
    .filter(Boolean)

  if (!candidates.length) return null

  const counts = new Map()
  for (const candidate of candidates) {
    const key = normalizedParentKey(candidate)
    const current = counts.get(key) ?? { count: 0, candidate }
    current.count += 1
    counts.set(key, current)
  }

  const ranked = [...counts.values()].sort((left, right) => right.count - left.count)
  return ranked[0].count >= 2 ? ranked[0].candidate : null
}

async function repairOrphanFamilyParents(subject, dryRun) {
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

    for (const target of group) {
      if (!hasSubpartRef(target.meta.referenceCode)) continue
      if (!orphanNeedsContext(target.detail.questionHtml)) continue

      const parent = chooseParentForTarget(target, group)
        ?? chooseEmbeddedContextForTarget(target, group)
      if (!parent) continue

      const parentText = textFromHtml(parent)
      const currentText = textFromHtml(target.detail.questionHtml)
      if (currentText.includes(parentText.slice(0, Math.min(80, parentText.length)))) continue

      changes.push({
        questionId: target.meta.questionId,
        referenceCode: target.meta.referenceCode,
        kind: 'family-parent',
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

  if (/^24N\.3\.AHL\.TZ0\.1/.test(referenceCode)) {
    const troutRoot = `<div class="qb-parent-stem"><p>This question asks you to investigate models for the population of trout in a lake.</p>
<p>At the start of a year, a lake is estimated to contain 6000 trout. The owner of the lake estimates that the number of trout will increase by 10% per year.</p>
<p>At the end of each year, the owner proposes to remove 500 trout from the lake to prevent overpopulation.</p>
<p>Therefore, the relationship between <em>T</em><sub>n</sub>, the predicted number of trout at the start of year <em>n</em>, and <em>T</em><sub>n + 1</sub>, the predicted number of trout at the start of year <em>n + 1</em>, is given by <em>T</em><sub>n + 1</sub> = 1.1<em>T</em><sub>n</sub> - 500 and <em>T</em><sub>1</sub> = 6000.</p>
<p>For example, the predicted number of trout at the start of the second year is given by <em>T</em><sub>2</sub> = 1.1<em>T</em><sub>1</sub> - 500.</p></div>`
    const troutExplicit = `<div class="qb-parent-stem"><p>It is also known that <em>T</em><sub>n</sub> = 6000(1.1)<sup>n - 1</sup> - 5000((1.1)<sup>n - 1</sup> - 1).</p></div>`
    const fasterRemoval = `<div class="qb-parent-stem"><p>After deciding that the trout population would increase too quickly, the lake owner proposes instead to remove 750 trout at the end of each year.</p>
<p>The relationship between <em>D</em><sub>n</sub>, the predicted number of trout at the start of year <em>n</em>, and <em>D</em><sub>n + 1</sub>, the predicted number of trout at the start of year <em>n + 1</em>, is now given by <em>D</em><sub>n + 1</sub> = 1.1<em>D</em><sub>n</sub> - 750 and <em>D</em><sub>1</sub> = 6000.</p>
<p>It is also known that <em>D</em><sub>n</sub> = -1500(1.1)<sup>n - 1</sup> + 7500.</p></div>`
    const generalRemoval = `<div class="qb-parent-stem"><p>The lake owner now considers a more general approach where <em>d</em> trout are removed at the end of each year.</p>
<p>Let <em>C</em><sub>n</sub> denote the predicted number of trout in the lake at the start of the <em>n</em>th year where <em>C</em><sub>n</sub> = 6000(1.1)<sup>n - 1</sup> - 10<em>d</em>((1.1)<sup>n - 1</sup> - 1).</p></div>`
    const generatedSequences = `<div class="qb-parent-stem"><p>To model predicted numbers of trout, the lake owner has been using sequences generated by <em>u</em><sub>n + 1</sub> = <em>r</em><em>u</em><sub>n</sub> - <em>d</em>, where <em>d</em>, <em>r</em> &isin; &#8477;<sup>+</sup> and <em>r</em> &ne; 1.</p></div>`

    if (/\.1a$|\.1b(?:i|ii)$/.test(referenceCode)) return `${troutRoot}\n${leaf}`
    if (/\.1c(?:i|ii)$/.test(referenceCode)) return `${troutRoot}\n${troutExplicit}\n${leaf}`
    if (/\.1d(?:i|ii)$|\.1e$/.test(referenceCode)) return `${fasterRemoval}\n${leaf}`
    if (/\.1f$/.test(referenceCode)) return `${generalRemoval}\n${leaf}`
    if (/\.1g$/.test(referenceCode)) return `${generatedSequences}\n${leaf}`
  }

  const savingsMatch = referenceCode.match(/^23N\.2\.SL\.TZ([12])\.8/)
  if (savingsMatch) {
    const originalText = textFromHtml(originalHtml)
    if (originalText.startsWith('Daniela wins a prize. She is offered two options')) return null

    const values = savingsMatch[1] === '1'
      ? {
          monthlyPrize: '$4200',
          firstIncreasingPrize: '$1500',
          monthlyIncreasePercent: '4%',
          sorinInheritance: '$160 000',
          sorinInterestPercent: '5%',
        }
      : {
          monthlyPrize: '$5500',
          firstIncreasingPrize: '$2000',
          monthlyIncreasePercent: '6%',
          sorinInheritance: '$120 000',
          sorinInterestPercent: '4%',
        }

    const daniela = `<div class="qb-parent-stem"><p>Daniela wins a prize. She is offered two options for receiving her winnings over a period of three years.</p>
<p>Option A: Daniela receives ${values.monthlyPrize} at the end of each month.</p>
<p>Option B: Daniela receives ${values.firstIncreasingPrize} at the end of the first month. Each month after this, the amount she receives increases by ${values.monthlyIncreasePercent}.</p></div>`
    const sorin = `<div class="qb-parent-stem"><p>Sorin received an inheritance of ${values.sorinInheritance}. Sorin invested his inheritance in an account that pays a nominal annual interest rate of ${values.sorinInterestPercent} per annum, compounded monthly. The interest is added on the last day of each month.</p></div>`

    if (/\.8c(?:i|ii)$/.test(referenceCode)) return `${daniela}\n${sorin}\n${leaf}`
    return `${daniela}\n${originalHtml}`
  }

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
      ...(await repairOrphanFamilyParents(subject, options.dryRun)),
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
