import type { LevelCode, NormalizedSelection, OrderMode, PaperCode, WorkspaceFilterState } from '../types'
import type { SyllabusIndex } from './selection'
import { emptySelection, normalizeSelection } from './selection'

export function serializeSelection(selection: NormalizedSelection) {
  return [...selection.umbrellaIds, ...selection.subunitIds].join(',')
}

export function parseSelection(value: string | null, index: SyllabusIndex): NormalizedSelection {
  if (!value) {
    return emptySelection()
  }

  const ids = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return normalizeSelection(
    {
      umbrellaIds: ids.filter((id) => index.nodeMap.get(id)?.kind === 'umbrella'),
      subunitIds: ids.filter((id) => index.nodeMap.get(id)?.kind === 'subunit'),
    },
    index,
  )
}

const PAPER_CODES: readonly PaperCode[] = ['1A', '1B', '1', '2', '3']

function parsePapers(value: string | null): PaperCode[] {
  const fallback: PaperCode[] = [...PAPER_CODES]

  if (!value) {
    return fallback
  }

  const entries = value.split(',').filter((entry): entry is PaperCode =>
    (PAPER_CODES as readonly string[]).includes(entry),
  )
  return entries.length ? entries : fallback
}

function parseLevels(value: string | null): LevelCode[] {
  const fallback: LevelCode[] = ['SL', 'HL']

  if (!value) {
    return fallback
  }

  const entries = value.split(',').filter((entry): entry is LevelCode => entry === 'SL' || entry === 'HL')
  return entries.length ? entries : fallback
}

export function parseWorkspaceFilters(searchParams: URLSearchParams): WorkspaceFilterState {
  const order = searchParams.get('order')
  const orderMode: OrderMode = order === 'scrambled' ? 'scrambled' : 'source'
  const scrambleNonce = Number.parseInt(searchParams.get('shuffle') ?? '0', 10)

  return {
    paperFilters: parsePapers(searchParams.get('papers')),
    levelFilters: parseLevels(searchParams.get('levels')),
    onlyDifficult: searchParams.get('difficult') === '1',
    orderMode,
    scrambleNonce: Number.isNaN(scrambleNonce) ? 0 : scrambleNonce,
    expandedQuestionId: searchParams.get('expanded'),
  }
}

export function buildWorkspacePath(
  subjectId: string,
  selection: NormalizedSelection,
  filters: WorkspaceFilterState,
) {
  const params = new URLSearchParams()
  const units = serializeSelection(selection)

  if (units) {
    params.set('units', units)
  }

  params.set('papers', filters.paperFilters.join(','))
  params.set('levels', filters.levelFilters.join(','))

  if (filters.onlyDifficult) {
    params.set('difficult', '1')
  }

  params.set('order', filters.orderMode)
  params.set('shuffle', String(filters.scrambleNonce))

  if (filters.expandedQuestionId) {
    params.set('expanded', filters.expandedQuestionId)
  }

  return `/subject/${subjectId}/workspace?${params.toString()}`
}
