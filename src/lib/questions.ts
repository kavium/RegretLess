import type { NormalizedSelection, OrderMode, PaperCode, QuestionRecord, SubjectBundle, UserQuestionStateMap, WorkspaceFilterState, YearFilterCode } from '../types'
import type { SyllabusIndex } from './selection'

const PAPER_ORDER: PaperCode[] = ['1A', '1B', '1', '2', '3', 'unknown']
const LEVEL_ORDER = ['SL', 'HL'] as const
const YEAR_PREFIX_PATTERN = /^(\d{2})[MN]\b/i
const QUESTION_PART_PATTERN = /^([a-z])(?:\.(i|ii|iii|iv|v|vi|vii|viii|ix|x))?$/
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
const brokenQuestionCache = new Map<string, Set<string>>()

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

function getQuestionFamilyStem(question: QuestionRecord) {
  const questionNumber = question.questionNumber
  const referenceCode = question.referenceCode
  if (!questionNumber || !referenceCode.endsWith(questionNumber)) {
    return referenceCode
  }

  const stem = referenceCode.slice(0, -questionNumber.length)
  return stem.endsWith('.') ? stem.slice(0, -1) : stem
}

export function computeBrokenQuestionIds(bundle: SubjectBundle): Set<string> {
  const cached = brokenQuestionCache.get(bundle.subject.id)
  if (cached) {
    return cached
  }

  const families = new Map<string, { letters: Set<string>; subOrders: Map<string, Set<number>> }>()
  const parsedQuestions: Array<{ questionId: string; familyStem: string; letter: string; subOrder: number | null }> = []

  for (const question of bundle.questions) {
    const match = QUESTION_PART_PATTERN.exec(question.questionNumber)
    if (!match) {
      continue
    }

    const letter = match[1]
    const subOrder = match[2] ? ROMAN_ORDER.get(match[2]) ?? null : null
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

  brokenQuestionCache.set(bundle.subject.id, brokenIds)
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

export function extractMarksLabel(markschemeHtml: string): string | null {
  const matches = [...(markschemeHtml ?? '').matchAll(/\[\s*\d+\s*marks?\s*\]/gi)]
  return matches.length ? matches[matches.length - 1][0] : null
}
