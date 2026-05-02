import type { NormalizedSelection, OrderMode, PaperCode, QuestionRecord, SubjectBundle, UserQuestionStateMap, WorkspaceFilterState } from '../types'
import type { SyllabusIndex } from './selection'

const PAPER_ORDER: PaperCode[] = ['1A', '1B', '1', '2', '3']
const LEVEL_ORDER = ['SL', 'HL'] as const

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
  const questionIds: string[] = []

  for (const sectionId of orderedSectionIds) {
    const sectionQuestionIds = bundle.sectionQuestionOrder[sectionId] ?? []

    for (const questionId of sectionQuestionIds) {
      if (seen.has(questionId)) {
        continue
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

export function describeQuestion(question: QuestionRecord) {
  return `${question.referenceCode} · ${question.breadcrumbLabels.join(' > ')}`
}
