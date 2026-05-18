import type { NormalizedSelection, OrderMode, PaperCode, QuestionRecord, SubjectBundle, UserQuestionStateMap, WorkspaceFilterState, YearFilterCode } from '../types'
import type { SyllabusIndex } from './selection'

const PAPER_ORDER: PaperCode[] = ['1A', '1B', '1', '2', '3', 'unknown']
const LEVEL_ORDER = ['SL', 'HL'] as const
const YEAR_PREFIX_PATTERN = /^(\d{2})[MN]\b/i
const ROMAN_PATTERN = 'viii|vii|vi|iv|iii|ii|ix|x|v|i'
const QUESTION_PART_PATTERN = new RegExp(`^([a-z])(?:\\.?(${ROMAN_PATTERN}|\\d+)|\\((${ROMAN_PATTERN}|\\d+)\\))?$`, 'i')
const REFERENCE_PAREN_PART_PATTERN = new RegExp(`^(.+?)([a-z])\\((${ROMAN_PATTERN}|\\d+)\\)$`)
const REFERENCE_DOT_PART_PATTERN = new RegExp(`^(.+?)([a-z])\\.(${ROMAN_PATTERN}|\\d+)$`)
const REFERENCE_COMPACT_PART_PATTERN = new RegExp(`^(.+?)([a-z])(${ROMAN_PATTERN}|\\d+)$`)
const REFERENCE_LETTER_PART_PATTERN = /^(.+?)\.?([a-z])$/
const MARK_VALUE_PATTERN = /\[\s*(?:maximum\s+mark:\s*)?(\d+)(?:\s*marks?)?\s*\]/gi
const QUESTION_REFERENCE_DISPLAY_PATTERN = /^(\d{2})([MN])$/i
const SPECIMEN_REFERENCE_DISPLAY_PATTERN = /^(?:EX[MN]|SPM)$/i
const ROMAN_ORDER = new Map([
  ['i', 1],
  ['ii', 2],
  ['iii', 3],
  ['iv', 4],
  ['v', 5],
  ['vi', 6],
  ['vii', 7],
  ['viii', 8],
  ['ix', 9],
  ['x', 10],
])
const brokenQuestionCache = new WeakMap<SubjectBundle, Set<string>>()

export interface QuestionRowModel {
  rowId: string
  representativeId: string
  questionIds: string[]
  isFullQuestion: boolean
}

interface ParsedQuestionPart {
  familyStem: string
  letter: string
  letterOrder: number
  subOrder: number | null
  subpartLabel: string | null
}

function createSeed(seedInput: string) {
  let hash = 2166136261

  for (let index = 0; index < seedInput.length; index += 1) {
    hash ^= seedInput.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function mulberry32(seed: number) {
  return () => {
    let next = (seed += 0x6d2b79f5)
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleQuestionIds(ids: string[], seedInput: string) {
  const nextIds = [...ids]
  const random = mulberry32(createSeed(seedInput))

  for (let index = nextIds.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[nextIds[index], nextIds[swapIndex]] = [nextIds[swapIndex], nextIds[index]]
  }

  return nextIds
}

export function createQuestionMap(bundle: SubjectBundle) {
  return new Map(bundle.questions.map((question) => [question.questionId, question]))
}

function normalizeFamilyStem(stem: string) {
  return stem.endsWith('.') ? stem.slice(0, -1) : stem
}

export function getQuestionFamilyStem(question: QuestionRecord) {
  const parsed = parseQuestionPartInfo(question)
  if (parsed) {
    return parsed.familyStem
  }

  const questionNumber = question.questionNumber
  const referenceCode = question.referenceCode
  if (!questionNumber || !referenceCode.endsWith(questionNumber)) {
    return referenceCode
  }

  const stem = referenceCode.slice(0, -questionNumber.length)
  return normalizeFamilyStem(stem)
}

function subpartOrder(rawSubpart: string | null) {
  if (!rawSubpart) return null

  const normalized = rawSubpart.toLowerCase()
  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10)
    return Number.isSafeInteger(parsed) ? parsed : null
  }

  return ROMAN_ORDER.get(normalized) ?? null
}

function createParsedPart(familyStem: string, letter: string, rawSubpart: string | null): ParsedQuestionPart {
  const normalizedLetter = letter.toLowerCase()
  const normalizedSubpart = rawSubpart?.toLowerCase() ?? null
  return {
    familyStem: normalizeFamilyStem(familyStem),
    letter: normalizedLetter,
    letterOrder: normalizedLetter.charCodeAt(0) - 'a'.charCodeAt(0),
    subOrder: subpartOrder(rawSubpart),
    subpartLabel: normalizedSubpart,
  }
}

function parseQuestionPartInfo(question: Pick<QuestionRecord, 'questionNumber' | 'referenceCode'>): ParsedQuestionPart | null {
  const referenceCode = question.referenceCode.trim()
  const referenceMatch =
    REFERENCE_PAREN_PART_PATTERN.exec(referenceCode)
    ?? REFERENCE_DOT_PART_PATTERN.exec(referenceCode)
    ?? REFERENCE_COMPACT_PART_PATTERN.exec(referenceCode)
    ?? REFERENCE_LETTER_PART_PATTERN.exec(referenceCode)

  if (referenceMatch) {
    return createParsedPart(referenceMatch[1], referenceMatch[2], referenceMatch[3] ?? null)
  }

  const questionNumber = question.questionNumber.trim().toLowerCase()
  const match = QUESTION_PART_PATTERN.exec(questionNumber)
  if (!match) return null

  const familyStem = question.questionNumber && referenceCode.endsWith(question.questionNumber)
    ? referenceCode.slice(0, -question.questionNumber.length)
    : referenceCode

  return createParsedPart(familyStem, match[1], match[2] ?? match[3] ?? null)
}

function compareQuestionParts(left: QuestionRecord, right: QuestionRecord) {
  const leftPart = parseQuestionPartInfo(left)
  const rightPart = parseQuestionPartInfo(right)

  if (leftPart && rightPart) {
    if (leftPart.letterOrder !== rightPart.letterOrder) {
      return leftPart.letterOrder - rightPart.letterOrder
    }
    return (leftPart.subOrder ?? 0) - (rightPart.subOrder ?? 0)
  }

  if (leftPart) return -1
  if (rightPart) return 1
  return left.referenceCode.localeCompare(right.referenceCode)
}

function createFamilyGroups(bundle: SubjectBundle) {
  const families = new Map<string, QuestionRecord[]>()

  for (const question of bundle.questions) {
    if (!parseQuestionPartInfo(question)) {
      continue
    }

    const familyStem = getQuestionFamilyStem(question)
    const family = families.get(familyStem) ?? []
    family.push(question)
    families.set(familyStem, family)
  }

  for (const family of families.values()) {
    family.sort(compareQuestionParts)
  }

  return families
}

export function computeBrokenQuestionIds(bundle: SubjectBundle): Set<string> {
  const cached = brokenQuestionCache.get(bundle)
  if (cached) {
    return cached
  }

  const families = new Map<string, { letters: Set<string>; subOrders: Map<string, Set<number>> }>()
  const parsedQuestions: Array<{ questionId: string; familyStem: string; letter: string; subOrder: number | null }> = []

  for (const question of bundle.questions) {
    const part = parseQuestionPartInfo(question)
    if (!part) {
      continue
    }

    const letter = part.letter
    const subOrder = part.subOrder
    const familyStem = getQuestionFamilyStem(question)
    let family = families.get(familyStem)
    if (!family) {
      family = { letters: new Set(), subOrders: new Map() }
      families.set(familyStem, family)
    }

    family.letters.add(letter)
    if (subOrder !== null) {
      const letterSubOrders = family.subOrders.get(letter) ?? new Set<number>()
      letterSubOrders.add(subOrder)
      family.subOrders.set(letter, letterSubOrders)
    }
    parsedQuestions.push({ questionId: question.questionId, familyStem, letter, subOrder })
  }

  const brokenIds = new Set<string>()

  for (const question of parsedQuestions) {
    const family = families.get(question.familyStem)
    if (!family) {
      continue
    }

    const letterOrder = question.letter.charCodeAt(0) - 'a'.charCodeAt(0)
    let isBroken = false
    for (let index = 0; index < letterOrder; index += 1) {
      if (!family.letters.has(String.fromCharCode('a'.charCodeAt(0) + index))) {
        isBroken = true
        break
      }
    }

    if (!isBroken && question.subOrder !== null) {
      const letterSubOrders = family.subOrders.get(question.letter) ?? new Set<number>()
      for (let index = 1; index < question.subOrder; index += 1) {
        if (!letterSubOrders.has(index)) {
          isBroken = true
          break
        }
      }
    }

    if (isBroken) {
      brokenIds.add(question.questionId)
    }
  }

  brokenQuestionCache.set(bundle, brokenIds)
  return brokenIds
}

export function buildCanonicalQuestionSequence(
  bundle: SubjectBundle,
  selection: NormalizedSelection,
  index: SyllabusIndex,
) {
  const selectedSectionIds = new Set([...selection.umbrellaIds, ...selection.subunitIds])
  const orderedSectionIds = index.orderedIds.filter(
    (nodeId) => selectedSectionIds.has(nodeId),
  )
  const seen = new Set<string>()
  const seenReferenceCodes = new Set<string>()
  const questionMap = createQuestionMap(bundle)
  const questionIds: string[] = []

  for (const sectionId of orderedSectionIds) {
    const sectionQuestionIds = bundle.sectionQuestionOrder[sectionId] ?? []

    for (const questionId of sectionQuestionIds) {
      if (seen.has(questionId)) {
        continue
      }

      const question = questionMap.get(questionId)
      if (question?.referenceCode) {
        if (seenReferenceCodes.has(question.referenceCode)) {
          continue
        }
        seenReferenceCodes.add(question.referenceCode)
      }

      seen.add(questionId)
      questionIds.push(questionId)
    }
  }

  return questionIds
}

export function applyQuestionFilters(
  bundle: SubjectBundle,
  questionIds: string[],
  filters: WorkspaceFilterState,
  brokenIds: Set<string>,
  userState: UserQuestionStateMap,
  questionMap?: Map<string, QuestionRecord>,
) {
  const map = questionMap ?? createQuestionMap(bundle)

  return questionIds.filter((questionId) => {
    const question = map.get(questionId)

    if (!question) {
      return false
    }

    if (!filters.paperFilters.includes(question.paper)) {
      return false
    }

    if (!filters.levelFilters.includes(question.level)) {
      return false
    }

    if (filters.yearFilters.length > 0 && !filters.yearFilters.includes(getQuestionYearFilter(question))) {
      return false
    }

    const isBroken = brokenIds.has(questionId)
    if (filters.showBroken) {
      if (!isBroken) {
        return false
      }
    } else if (isBroken && !(filters.onlyDifficult && userState[questionId]?.difficult)) {
      return false
    }

    if (filters.onlyDifficult && !userState[questionId]?.difficult) {
      return false
    }

    return true
  })
}

export function orderQuestionIds(
  questionIds: string[],
  bundle: SubjectBundle,
  completedSnapshot: Set<string>,
  orderMode: OrderMode,
  scrambleNonce: number,
) {
  const incomplete: string[] = []
  const completed: string[] = []

  for (const questionId of questionIds) {
    if (completedSnapshot.has(questionId)) {
      completed.push(questionId)
    } else {
      incomplete.push(questionId)
    }
  }

  if (orderMode === 'source') {
    return [...incomplete, ...completed]
  }

  const subjectId = bundle.subject.id
  const shuffledIncomplete = shuffleQuestionIds(incomplete, `${subjectId}:incomplete:${scrambleNonce}`)
  const shuffledCompleted = shuffleQuestionIds(completed, `${subjectId}:completed:${scrambleNonce}`)
  return [...shuffledIncomplete, ...shuffledCompleted]
}

export function buildQuestionRows(
  orderedQuestionIds: string[],
  bundle: SubjectBundle,
  filters: WorkspaceFilterState,
  brokenIds: Set<string>,
  questionMap?: Map<string, QuestionRecord>,
): QuestionRowModel[] {
  if (filters.questionGroupingMode !== 'full-question') {
    return orderedQuestionIds.map((questionId) => ({
      rowId: questionId,
      representativeId: questionId,
      questionIds: [questionId],
      isFullQuestion: false,
    }))
  }

  const map = questionMap ?? createQuestionMap(bundle)
  const families = createFamilyGroups(bundle)
  const emittedFamilies = new Set<string>()
  const rows: QuestionRowModel[] = []

  for (const questionId of orderedQuestionIds) {
    const question = map.get(questionId)
    if (!question) continue

    const familyStem = getQuestionFamilyStem(question)
    const family = families.get(familyStem)
    if (!family || brokenIds.has(questionId)) {
      rows.push({
        rowId: questionId,
        representativeId: questionId,
        questionIds: [questionId],
        isFullQuestion: false,
      })
      continue
    }

    if (emittedFamilies.has(familyStem)) {
      continue
    }

    emittedFamilies.add(familyStem)
    const questionIds = family
      .filter((part) => !brokenIds.has(part.questionId))
      .map((part) => part.questionId)

    rows.push({
      rowId: `family:${familyStem}`,
      representativeId: questionId,
      questionIds,
      isFullQuestion: questionIds.length > 1,
    })
  }

  return rows
}

export function getAvailablePapers(bundle: SubjectBundle) {
  const papers = new Set(bundle.questions.map((question) => question.paper))
  return PAPER_ORDER.filter((paper) => papers.has(paper))
}

export function getAvailableLevels(bundle: SubjectBundle) {
  const levels = new Set(bundle.questions.map((question) => question.level))
  return LEVEL_ORDER.filter((level) => levels.has(level))
}

export function getQuestionYearFilter(question: Pick<QuestionRecord, 'referenceCode'>): YearFilterCode {
  const match = YEAR_PREFIX_PATTERN.exec(question.referenceCode.trim())
  return match ? (`20${match[1]}` as YearFilterCode) : 'specimen'
}

export function formatYearFilterLabel(year: YearFilterCode) {
  return year === 'specimen' ? 'Specimen' : year
}

export function getAvailableYears(bundle: SubjectBundle): YearFilterCode[] {
  const years = new Set(bundle.questions.map((question) => getQuestionYearFilter(question)))
  const numericYears = [...years]
    .filter((year) => year !== 'specimen')
    .sort((left, right) => Number(right) - Number(left))
  return years.has('specimen') ? [...numericYears, 'specimen'] : numericYears
}

export function describeQuestion(question: QuestionRecord) {
  return `${question.referenceCode} · ${question.breadcrumbLabels.join(' > ')}`
}

export function formatQuestionPartLabel(question: Pick<QuestionRecord, 'questionNumber' | 'referenceCode'>) {
  const parsed = parseQuestionPartInfo(question)
  if (parsed) {
    const suffix = parsed.subpartLabel === null ? '' : `.${parsed.subpartLabel}`
    return `Part ${parsed.letter}${suffix}`
  }

  return question.questionNumber ? `Part ${question.questionNumber}` : question.referenceCode
}

function formatQuestionPartDisplay(rawPart: string) {
  const normalized = rawPart.trim()
  if (!normalized) return ''

  const compactMatch = /^([a-z])([ivx]+|\d+)$/i.exec(normalized)
  if (compactMatch) {
    return `${compactMatch[1].toLowerCase()}(${compactMatch[2].toLowerCase()})`
  }

  const dottedMatch = /^([a-z])\.?([ivx]+|\d+)$/i.exec(normalized)
  if (dottedMatch) {
    return `${dottedMatch[1].toLowerCase()}(${dottedMatch[2].toLowerCase()})`
  }

  return normalized.toLowerCase()
}

function formatQuestionNumberDisplay(rawQuestion: string) {
  const normalized = rawQuestion.trim()
  const match = /^(\d+)(.*)$/.exec(normalized)
  if (!match) return normalized

  const questionNumber = match[1]
  const part = formatQuestionPartDisplay(match[2] ?? '')
  return part ? `${questionNumber} ${part}` : questionNumber
}

export function formatQuestionReferenceTitle(referenceCode: string) {
  const code = referenceCode.trim()
  const parts = code.split('.').filter(Boolean)
  if (parts.length < 5) return code

  const sessionMatch = QUESTION_REFERENCE_DISPLAY_PATTERN.exec(parts[0])
  const isSpecimen = SPECIMEN_REFERENCE_DISPLAY_PATTERN.test(parts[0])
  const paper = parts[1]
  const timeZoneIndex = parts.findIndex((part) => /^TZ/i.test(part))
  const timeZone = timeZoneIndex >= 0 ? parts[timeZoneIndex] : ''
  const questionPart = timeZoneIndex >= 0 ? parts.slice(timeZoneIndex + 1).join('.') : ''

  if ((!sessionMatch && !isSpecimen) || !paper || !timeZone || !questionPart) return code

  const sessionLabel = isSpecimen
    ? 'Specimen'
    : `${sessionMatch![2].toUpperCase() === 'M' ? 'May' : 'November'} 20${sessionMatch![1]}`
  const timeZoneNumber = timeZone.replace(/^TZ/i, '')
  const questionNumber = formatQuestionNumberDisplay(questionPart)
  const labels = [sessionLabel, `Paper ${paper}`]

  if (timeZoneNumber) {
    labels.push(`Time Zone ${timeZoneNumber}`)
  } else {
    labels.push(timeZone)
  }
  labels.push(`Question ${questionNumber}`)

  return labels.join(' | ')
}

export function extractMarksLabel(markschemeHtml: string): string | null {
  const matches = [...(markschemeHtml ?? '').matchAll(/\[\s*\d+\s*marks?\s*\]/gi)]
  return matches.length ? matches[matches.length - 1][0] : null
}

export function extractMarkValue(value: string): number | null {
  const matches = [...(value ?? '').matchAll(MARK_VALUE_PATTERN)]
  if (!matches.length) return null
  const finalMatch = matches[matches.length - 1]
  const parsed = Number.parseInt(finalMatch[1], 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function formatTotalMarksLabel(total: number | null): string | null {
  if (total === null) return null
  return `Total ${total} ${total === 1 ? 'mark' : 'marks'}`
}
