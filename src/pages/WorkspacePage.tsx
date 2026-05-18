import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, Flag, RefreshCw, Shuffle, SlidersHorizontal, BookOpen, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SafeHtml } from '../components/SafeHtml'
import { NavLinks } from '../components/NavLinks'
import { loadQuestionDetail } from '../lib/data-client'
import { useDataContext } from '../lib/data-context'
import { formatPaperLabel } from '../lib/paper-display'
import { applyQuestionFilters, buildCanonicalQuestionSequence, buildQuestionRows, computeBrokenQuestionIds, createQuestionMap, extractMarkValue, extractMarksLabel, formatQuestionPartLabel, formatQuestionReferenceTitle, formatTotalMarksLabel, formatYearFilterLabel, getAvailableLevels, getAvailablePapers, getAvailableYears, getQuestionFamilyStem, orderQuestionIds } from '../lib/questions'
import { buildSyllabusIndex, getSelectionLabels } from '../lib/selection'
import { getResumeState, getUserQuestionState, setResumeState, setUserQuestionState } from '../lib/storage'
import { useSubjectBundle } from '../lib/use-subject-bundle'
import { buildWorkspacePath, parseSelection, parseWorkspaceFilters } from '../lib/url-state'
import type { LevelCode, PaperCode, QuestionDetail, QuestionRecord, WorkspaceFilterState, YearFilterCode } from '../types'
import './WorkspacePage.css'

const PAPER_TINTS: Record<string, 'rose' | 'butter' | 'sky'> = { '1A': 'rose', '1B': 'butter', '1': 'rose', '2': 'sky', '3': 'butter' }
const COMPLETED_TIP_KEY = 'qol-ib-qb:completed-tip-shown'
const BROKEN_TIP_KEY = 'qol-ib-qb:broken-tip-shown'
const COMPLETED_TIP_MESSAGE = 'Questions selected as completed appear at the bottom of the question list on next scramble or page refresh.'
const BROKEN_TIP_MESSAGE = "Broken questions refer to earlier missing parts, so they may be hard to solve in isolation. They stay hidden unless you use the Broken filter. Don't worry, if you attempt one and mark it difficult, we will still show it when you filter by difficult only."

interface VirtualQuestionListProps {
  rows: QuestionRowViewModel[]
  renderRow: (row: QuestionRowViewModel) => React.ReactNode
}

interface QuestionRowViewModel {
  rowId: string
  representativeId: string
  questionIds: string[]
  isFullQuestion: boolean
}

interface QuestionUiState {
  orderKey: string
  completedSnapshot: Set<string>
  revealedMs: Record<string, boolean>
}

function VirtualQuestionList({ rows, renderRow }: VirtualQuestionListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const [parentOffset, setParentOffset] = useState(0)

  useLayoutEffect(() => {
    const update = () => {
      if (parentRef.current) {
        const rect = parentRef.current.getBoundingClientRect()
        const next = rect.top + window.scrollY
        setParentOffset((cur) => (Math.abs(cur - next) < 0.5 ? cur : next))
      }
    }
    update()
    window.addEventListener('resize', update)
    const ro = new ResizeObserver(update)
    if (parentRef.current?.parentElement) ro.observe(parentRef.current.parentElement)
    if (document.body) ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      ro.disconnect()
    }
  }, [])

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    // Higher initial estimate so long math-AA / econ-P3 questions don't clip
    // before ResizeObserver re-measures. Real height replaces this on first paint.
    estimateSize: () => 320,
    overscan: 5,
    scrollMargin: parentOffset,
    getItemKey: (index) => rows[index]?.rowId ?? index,
  })

  if (!rows.length) {
    return <div className="ws__list"><div className="ws__empty">No questions match the current filters.</div></div>
  }

  const items = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="ws__list" style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
      {items.map((vi) => {
        const row = rows[vi.index]
        return (
          <div
            key={row.rowId}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)`,
              paddingBottom: 14,
              // Removed `contain: 'layout paint'`: it blocked async size growth
              // (e.g. MathJax typesetting) from propagating to the virtualizer's
              // ResizeObserver, causing Math AA rows to clip on filter change.
            }}
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}

function toggleValue<T extends string>(items: T[], value: T, fallback: T[]) {
  const next = items.includes(value) ? items.filter((x) => x !== value) : [...items, value]
  return next.length ? next : fallback
}

function toggleYearValue(items: YearFilterCode[], value: YearFilterCode, fallback: YearFilterCode[]) {
  return toggleValue(items.length ? items : fallback, value, fallback)
}

function yearDropdownLabel(filters: YearFilterCode[], availableYears: YearFilterCode[]) {
  if (!filters.length || filters.length === availableYears.length) return 'All years'
  if (filters.length === 1) return formatYearFilterLabel(filters[0])
  return `${filters.length} years`
}

function normalizeStemKey(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripRepeatedParentStem(html: string, seenStemKeys: Set<string>) {
  if (typeof DOMParser === 'undefined') return html

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html')
  const parentStem = doc.body.querySelector('.qb-parent-stem')
  if (!parentStem) return html

  const stemKey = normalizeStemKey(parentStem.textContent ?? parentStem.innerHTML)
  if (!stemKey || !seenStemKeys.has(stemKey)) {
    if (stemKey) seenStemKeys.add(stemKey)
    return doc.body.firstElementChild?.innerHTML ?? html
  }

  parentStem.remove()
  return doc.body.firstElementChild?.innerHTML ?? html
}

function marksTotalForParts(parts: QuestionRecord[], details: Record<string, QuestionDetail | 'loading' | 'error'>) {
  let total = 0

  for (const part of parts) {
    const metaValue = extractMarkValue(part.marksAvailable)
    if (metaValue !== null) {
      total += metaValue
      continue
    }

    const detail = details[part.questionId]
    const detailValue = detail && detail !== 'loading' && detail !== 'error'
      ? extractMarkValue(detail.markschemeHtml)
      : null
    if (detailValue !== null) {
      total += detailValue
    }
  }

  return total > 0 ? total : null
}

function marksLabelForPart(part: QuestionRecord | undefined, detail: QuestionDetail) {
  const markschemeLabel = extractMarksLabel(detail.markschemeHtml)
  if (markschemeLabel) return markschemeLabel

  const metaValue = part ? extractMarkValue(part.marksAvailable) : null
  return metaValue === null ? null : `${metaValue} ${metaValue === 1 ? 'mark' : 'marks'}`
}

function hasSessionFlag(key: string) {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return true
  }
}

function setSessionFlag(key: string) {
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    /* tip persistence is best-effort */
  }
}

function getRowQuestionState(
  questionIds: string[],
  userState: ReturnType<typeof getUserQuestionState>,
) {
  const states = questionIds.map((id) => userState[id])
  return {
    completed: states.length > 0 && states.every((state) => state?.completed),
    difficult: states.some((state) => state?.difficult),
  }
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { subjectId } = useParams()
  const { manifest, refreshPublishedData } = useDataContext()
  const { bundle, status, error } = useSubjectBundle(subjectId)
  const [searchParams] = useSearchParams()
  // KeyedWorkspace in App.tsx remounts this component on subjectId change, so all
  // per-subject state initialises fresh from storage; no in-render reset needed.
  const [userState, setUserState] = useState(() => (subjectId ? getUserQuestionState(subjectId) : {}))
  const [details, setDetails] = useState<Record<string, QuestionDetail | 'loading' | 'error'>>({})
  const [refreshState, setRefreshState] = useState<'idle' | 'working'>('idle')
  const [completedTip, setCompletedTip] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [brokenTip, setBrokenTip] = useState<{ anchor: HTMLElement } | null>(null)
  const [yearMenuAnchor, setYearMenuAnchor] = useState<HTMLElement | null>(null)
  const restoreAttempted = useRef(false)
  const detailAttemptsRef = useRef<Map<string, 'pending' | 'done' | 'failed'>>(new Map())
  const [retryTick, setRetryTick] = useState(0)
  const bundleHash = useMemo(
    () => manifest?.subjects.find((entry) => entry.id === subjectId)?.bundleHash ?? null,
    [manifest, subjectId],
  )

  const retryDetail = useCallback((id: string) => {
    detailAttemptsRef.current.delete(id)
    setRetryTick((n) => n + 1)
  }, [])

  const syllabusIndex = useMemo(() => (bundle ? buildSyllabusIndex(bundle.syllabus) : null), [bundle])
  const selection = useMemo(
    () => (syllabusIndex ? parseSelection(searchParams.get('units'), syllabusIndex) : null),
    [searchParams, syllabusIndex],
  )
  const filters = useMemo(() => parseWorkspaceFilters(searchParams), [searchParams])
  const questionMap = useMemo(() => (bundle ? createQuestionMap(bundle) : new Map()), [bundle])
  const brokenIds = useMemo(() => (bundle ? computeBrokenQuestionIds(bundle) : new Set<string>()), [bundle])

  const canonicalQuestionIds = useMemo(() => {
    if (!bundle || !selection || !syllabusIndex) return []
    return buildCanonicalQuestionSequence(bundle, selection, syllabusIndex)
  }, [bundle, selection, syllabusIndex])

  const orderKey = useMemo(
    () =>
      [
        subjectId,
        searchParams.get('units') ?? '',
        filters.paperFilters.join(','),
        filters.levelFilters.join(','),
        filters.yearFilters.join(','),
        filters.onlyDifficult ? '1' : '0',
        filters.showBroken ? '1' : '0',
        filters.questionGroupingMode,
        filters.orderMode,
        filters.scrambleNonce,
      ].join('|'),
    [subjectId, searchParams, filters.paperFilters, filters.levelFilters, filters.yearFilters, filters.onlyDifficult, filters.showBroken, filters.questionGroupingMode, filters.orderMode, filters.scrambleNonce],
  )

  const [questionUiState, setQuestionUiState] = useState<QuestionUiState>(() => ({
    orderKey,
    completedSnapshot: new Set(Object.keys(userState).filter((id) => userState[id]?.completed)),
    revealedMs: {},
  }))
  const questionUi = useMemo(
    () =>
      questionUiState.orderKey === orderKey
        ? questionUiState
        : {
            orderKey,
            completedSnapshot: new Set(Object.keys(userState).filter((id) => userState[id]?.completed)),
            revealedMs: {},
          },
    [orderKey, questionUiState, userState],
  )

  const orderedQuestionIds = useMemo(() => {
    if (!bundle) return []
    return orderQuestionIds(
      applyQuestionFilters(bundle, canonicalQuestionIds, filters, brokenIds, userState, questionMap),
      bundle,
      questionUi.completedSnapshot,
      filters.orderMode,
      filters.scrambleNonce,
    )
  }, [bundle, canonicalQuestionIds, filters, brokenIds, userState, questionMap, questionUi])

  const sourceOrderedQuestionIds = useMemo(() => {
    if (!bundle) return []
    return applyQuestionFilters(bundle, canonicalQuestionIds, filters, brokenIds, userState, questionMap)
  }, [bundle, canonicalQuestionIds, filters, brokenIds, userState, questionMap])

  const visibleRows = useMemo(() => {
    if (!bundle) return []
    return buildQuestionRows(orderedQuestionIds, bundle, filters, brokenIds, questionMap)
  }, [orderedQuestionIds, bundle, filters, brokenIds, questionMap])

  const sourceOrderedRows = useMemo(() => {
    if (!bundle) return []
    return buildQuestionRows(sourceOrderedQuestionIds, bundle, filters, brokenIds, questionMap)
  }, [sourceOrderedQuestionIds, bundle, filters, brokenIds, questionMap])

  const expandedRowQuestionIds = useMemo(() => {
    if (!filters.expandedQuestionId) return []
    const row = visibleRows.find((entry) => entry.questionIds.includes(filters.expandedQuestionId!))
    return row?.questionIds ?? [filters.expandedQuestionId]
  }, [filters.expandedQuestionId, visibleRows])

  const numberByRowId = useMemo(() => {
    const map = new Map<string, number>()
    sourceOrderedRows.forEach((row, index) => map.set(row.rowId, index + 1))
    return map
  }, [sourceOrderedRows])

  const availablePapers = useMemo(() => (bundle ? getAvailablePapers(bundle) : []), [bundle])
  const availableLevels = useMemo(() => (bundle ? getAvailableLevels(bundle) : []), [bundle])
  const availableYears = useMemo(() => (bundle ? getAvailableYears(bundle) : []), [bundle])
  const activeYearFilters = filters.yearFilters.length ? filters.yearFilters : availableYears
  const selectionLabels = useMemo(
    () => (selection && syllabusIndex ? getSelectionLabels(selection, syllabusIndex) : []),
    [selection, syllabusIndex],
  )
  const { completedCount, difficultCount } = useMemo(() => {
    let completed = 0
    let difficult = 0
    for (const row of visibleRows) {
      const rowState = getRowQuestionState(row.questionIds, userState)
      if (rowState.completed) completed += 1
      if (rowState.difficult) difficult += 1
    }
    return { completedCount: completed, difficultCount: difficult }
  }, [userState, visibleRows])
  const includedPartCount = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.questionIds.length, 0),
    [visibleRows],
  )

  useEffect(() => {
    if (!subjectId || !bundleHash || !expandedRowQuestionIds.length) return

    const controller = new AbortController()
    for (const questionId of expandedRowQuestionIds) {
      const status = detailAttemptsRef.current.get(questionId)
      if (status === 'pending' || status === 'done') continue

      detailAttemptsRef.current.set(questionId, 'pending')
      setDetails((cur) => ({ ...cur, [questionId]: 'loading' }))
      loadQuestionDetail(subjectId, questionId, bundleHash, controller.signal)
        .then((detail) => {
          if (controller.signal.aborted) return
          detailAttemptsRef.current.set(questionId, 'done')
          setDetails((cur) => ({ ...cur, [questionId]: detail }))
        })
        .catch((nextError) => {
          if (controller.signal.aborted) return
          detailAttemptsRef.current.set(questionId, 'failed')
          if (nextError instanceof Error && nextError.name !== 'AbortError') {
            console.warn(nextError.message)
          }
          setDetails((cur) => ({ ...cur, [questionId]: 'error' }))
        })
    }

    return () => {
      controller.abort()
    }
  }, [subjectId, bundleHash, expandedRowQuestionIds, retryTick])

  useEffect(() => {
    if (!subjectId) return
    setUserQuestionState(subjectId, userState)
  }, [subjectId, userState])

  useEffect(() => {
    if (!bundle || !selection || !subjectId) return

    const paperSummary = filters.paperFilters.map((paper) => formatPaperLabel(paper, bundle.subject, availablePapers)).join(', ')
    const yearSummary = activeYearFilters.map(formatYearFilterLabel).join(', ')
    const summaryLabel = `${bundle.subject.name} -> ${selectionLabels.join(', ') || 'No units'} -> ${paperSummary} + ${filters.levelFilters.join(', ')}${yearSummary ? ` + ${yearSummary}` : ''}${filters.onlyDifficult ? ' + Difficult only' : ''}${filters.showBroken ? ' + Broken only' : ''}${filters.displayMode === 'numbered' ? ' + Numbered' : ''}${filters.questionGroupingMode === 'full-question' ? ' + Full questions' : ''}`
    const workspaceUrl = buildWorkspacePath(subjectId, selection, filters)

    const persist = () => {
      setResumeState({
        subjectId,
        workspaceUrl,
        summaryLabel,
        selection,
        paperFilters: filters.paperFilters,
        levelFilters: filters.levelFilters,
        yearFilters: filters.yearFilters,
        onlyDifficult: filters.onlyDifficult,
        showBroken: filters.showBroken,
        displayMode: filters.displayMode,
        questionGroupingMode: filters.questionGroupingMode,
        orderMode: filters.orderMode,
        scrambleNonce: filters.scrambleNonce,
        expandedQuestionId: filters.expandedQuestionId,
        scrollY: window.scrollY,
        updatedAt: new Date().toISOString(),
      })
    }

    persist()

    let frame = 0
    const onScroll = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => persist())
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [activeYearFilters, availablePapers, bundle, filters, selection, selectionLabels, subjectId])

  useEffect(() => {
    if (restoreAttempted.current || !bundle || !selection || !subjectId) return

    const resume = getResumeState()
    const expandedId = filters.expandedQuestionId

    window.setTimeout(() => {
      if (expandedId) {
        const el = document.querySelector(`[data-qid="${CSS.escape(expandedId)}"]`) as HTMLElement | null
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' })
          return
        }
      }
      if (resume?.subjectId === subjectId && typeof resume.scrollY === 'number') {
        window.scrollTo({ top: resume.scrollY })
      }
    }, 80)

    restoreAttempted.current = true
  }, [bundle, filters.expandedQuestionId, location.pathname, location.search, selection, subjectId])

  if (status === 'loading' || status === 'idle') {
    return <div className="ws ws--empty"><span>— sautéing the questions —</span></div>
  }

  if (status === 'error' || !bundle || !subjectId || !selection || !syllabusIndex) {
    return <div className="ws ws--empty"><span>— could not load this workspace. {error} —</span></div>
  }

  function updateFilters(next: WorkspaceFilterState) {
    navigate(buildWorkspacePath(subjectId!, selection!, next), { replace: true })
  }

  function toggleYearFilter(year: YearFilterCode) {
    updateFilters({ ...filters, yearFilters: toggleYearValue(filters.yearFilters, year, availableYears) })
  }

  async function handleRefresh() {
    setRefreshState('working')
    try {
      await refreshPublishedData()
      updateFilters({ ...filters, scrambleNonce: filters.scrambleNonce + 1 })
    } finally {
      setRefreshState('idle')
    }
  }

  const subjectShort = bundle.subject.name.split(':')[0].trim()

  return (
    <div className="ws">
      <div className="ws__grain" aria-hidden="true" />

      <header className="ws__masthead">
        <div className="ws__masthead-row">
          <div className="ws__brand">
            <Link to="/" state={{ fromLogo: true }} className="ws__brand-mark" aria-label="Home">RL</Link>
            <span className="ws__brand-pipe" />
            <span className="ws__brand-name">RegretLess · Workspace</span>
          </div>
          <NavLinks />
          <div className="ws__masthead-meta">
            <button
              type="button"
              className="ws__back"
              onClick={() => navigate(`/subject/${subjectId}?units=${encodeURIComponent(searchParams.get('units') ?? '')}`)}
            >
              <ChevronLeft size={14} /> back to question select
            </button>
            <span>·</span>
            <span>subj — {subjectShort}</span>
          </div>
        </div>
      </header>

      <section className="ws__hero">
        <div>
          <p className="ws__hero-eyebrow">— the question workspace —</p>
          <h2>{bundle.subject.name}</h2>
          <p className="ws__hero-summary">{selectionLabels.join(' · ')}</p>
        </div>
        <div className="ws__stats">
          {filters.questionGroupingMode === 'full-question' ? (
            <>
              <div className="ws__stat"><b>{visibleRows.length}</b><span>full questions</span></div>
              <div className="ws__stat"><b>{orderedQuestionIds.length}</b><span>matched parts</span></div>
              <div className="ws__stat"><b>{includedPartCount}</b><span>included parts</span></div>
            </>
          ) : (
            <div className="ws__stat"><b>{orderedQuestionIds.length}</b><span>visible</span></div>
          )}
          <div className="ws__stat"><b>{completedCount}</b><span>completed</span></div>
          <div className="ws__stat"><b>{difficultCount}</b><span>difficult</span></div>
        </div>
      </section>

      <div className="ws__toolbar">
        <div className="ws__tool-group">
          <span className="ws__tool-label"><SlidersHorizontal size={14} /> paper</span>
          {availablePapers.map((paper) => (
            <button
              key={paper}
              type="button"
              className={`ws__chip${filters.paperFilters.includes(paper) ? ' is-active' : ''}`}
              onClick={() => updateFilters({ ...filters, paperFilters: toggleValue(filters.paperFilters, paper as PaperCode, availablePapers) })}
            >
              {formatPaperLabel(paper, bundle.subject, availablePapers)}
            </button>
          ))}
        </div>

        <div className="ws__tool-group">
          <span className="ws__tool-label">level</span>
          {availableLevels.map((level) => (
            <button
              key={level}
              type="button"
              className={`ws__chip${filters.levelFilters.includes(level) ? ' is-active' : ''}`}
              onClick={() => updateFilters({ ...filters, levelFilters: toggleValue(filters.levelFilters, level as LevelCode, availableLevels) })}
            >
              {level}
            </button>
          ))}
        </div>

        {availableYears.length ? (
          <div className="ws__tool-group">
            <span className="ws__tool-label">year</span>
            <button
              type="button"
              className={`ws__chip ws__dropdown-toggle${filters.yearFilters.length ? ' is-active' : ''}`}
              aria-expanded={Boolean(yearMenuAnchor)}
              onClick={(event) => setYearMenuAnchor((current) => (current ? null : event.currentTarget))}
            >
              {yearDropdownLabel(filters.yearFilters, availableYears)}
              <ChevronDown size={12} />
            </button>
          </div>
        ) : null}

        <div className="ws__tool-group">
          <span className="ws__tool-label">flags</span>
          <button
            type="button"
            className={`ws__chip${filters.onlyDifficult ? ' is-active' : ''}`}
            onClick={() => updateFilters({ ...filters, onlyDifficult: !filters.onlyDifficult })}
          >
            <Flag size={12} /> Only difficult
          </button>
          <button
            type="button"
            className={`ws__chip${filters.showBroken ? ' is-active' : ''}`}
            onClick={(event) => {
              const target = event.currentTarget
              updateFilters({ ...filters, showBroken: !filters.showBroken })
              if (!hasSessionFlag(BROKEN_TIP_KEY)) {
                setSessionFlag(BROKEN_TIP_KEY)
                setBrokenTip({ anchor: target })
              }
            }}
          >
            <AlertTriangle size={12} /> Broken
          </button>
        </div>

        <div className="ws__tool-group">
          <span className="ws__tool-label">order</span>
          <button
            type="button"
            className={`ws__chip${filters.orderMode === 'source' ? ' is-active' : ''}`}
            onClick={() => updateFilters({ ...filters, orderMode: 'source' })}
          >
            Source order
          </button>
          <button
            type="button"
            className={`ws__chip${filters.orderMode === 'scrambled' ? ' is-active' : ''}`}
            onClick={() => updateFilters({ ...filters, orderMode: 'scrambled', scrambleNonce: filters.scrambleNonce + 1 })}
          >
            <Shuffle size={12} /> Scrambled
          </button>
        </div>

        <div className="ws__tool-group">
          <span className="ws__tool-label">display</span>
          <div className="ws__segmented" role="group" aria-label="Question display mode">
            <button
              type="button"
              className="ws__segmented-option"
              aria-pressed={filters.displayMode === 'tags'}
              onClick={() => updateFilters({ ...filters, displayMode: 'tags' })}
            >
              Tags
            </button>
            <button
              type="button"
              className="ws__segmented-option"
              aria-pressed={filters.displayMode === 'numbered'}
              onClick={() => updateFilters({ ...filters, displayMode: 'numbered' })}
            >
              Numbered
            </button>
          </div>
        </div>

        <div className="ws__tool-group">
          <span className="ws__tool-label">parts</span>
          <div className="ws__segmented" role="group" aria-label="Question grouping mode">
            <button
              type="button"
              className="ws__segmented-option"
              aria-pressed={filters.questionGroupingMode === 'per-part'}
              onClick={() => updateFilters({ ...filters, questionGroupingMode: 'per-part' })}
            >
              Per-part
            </button>
            <button
              type="button"
              className="ws__segmented-option"
              aria-pressed={filters.questionGroupingMode === 'full-question'}
              onClick={() => updateFilters({ ...filters, questionGroupingMode: 'full-question' })}
            >
              Full question
            </button>
          </div>
        </div>

        <div className="ws__tool-end">
          <button type="button" className="ws__chip" onClick={handleRefresh}>
            <RefreshCw size={12} className={refreshState === 'working' ? 'spin' : ''} />
            {refreshState === 'working' ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <VirtualQuestionList
        rows={visibleRows}
        renderRow={(row) => {
          const questionId = row.representativeId
          const question = questionMap.get(questionId)
          if (!question) return null

          const expanded = filters.expandedQuestionId ? row.questionIds.includes(filters.expandedQuestionId) : false
          const rowState = getRowQuestionState(row.questionIds, userState)
          const msRevealed = row.questionIds.some((id) => questionUi.revealedMs[id])
          const paperTint = PAPER_TINTS[question.paper] ?? 'rose'
          const rowQuestions = row.questionIds
            .map((id) => questionMap.get(id))
            .filter((part): part is QuestionRecord => Boolean(part))
          const totalMarks = row.isFullQuestion
            ? marksTotalForParts(rowQuestions, details)
            : null
          const displayReference = row.isFullQuestion ? getQuestionFamilyStem(question) : question.referenceCode
          const displayTitle = filters.displayMode === 'numbered'
            ? `Q${numberByRowId.get(row.rowId) ?? '?'}`
            : formatQuestionReferenceTitle(displayReference)

          return (
            <article
              data-qid={questionId}
              className={`ws__q${expanded ? ' is-expanded' : ''}${rowState.difficult ? ' is-difficult' : ''}${rowState.completed ? ' is-completed' : ''}`}
            >
              <div className="ws__q-row">
                <button
                  type="button"
                  className="ws__q-toggle"
                  onClick={() => updateFilters({ ...filters, expandedQuestionId: expanded ? null : questionId })}
                >
                  <div className="ws__q-headline">
                    <span className="ws__q-ref">{displayTitle}</span>
                    <span className={`ws__q-tag ws__q-tag--${paperTint}`}>{formatPaperLabel(question.paper, bundle.subject, availablePapers)}</span>
                    <span className="ws__q-tag ws__q-tag--sage">{question.level}</span>
                    {row.isFullQuestion ? <span className="ws__q-tag ws__q-tag--full">{row.questionIds.length} parts</span> : null}
                    {row.isFullQuestion && totalMarks !== null ? <span className="ws__q-tag ws__q-tag--marks">{formatTotalMarksLabel(totalMarks)}</span> : null}
                    {brokenIds.has(questionId) ? <span className="ws__q-tag ws__q-tag--broken">Broken</span> : null}
                    {rowState.completed ? <span className="ws__q-tag ws__q-tag--done"><CheckCircle2 size={10} />completed</span> : null}
                    {rowState.difficult ? <span className="ws__q-tag ws__q-tag--hard"><Flag size={10} />difficult</span> : null}
                  </div>
                </button>

                <div className="ws__q-actions">
                  <div className="ws__complete-wrap">
                    <button
                      type="button"
                      className={`ws__icon-btn${rowState.completed ? ' is-active' : ''}`}
                      title="Mark completed"
                      onClick={(event) => {
                        const target = event.currentTarget
                        const updatedAt = new Date().toISOString()
                        setUserState((cur) => {
                          const completed = !getRowQuestionState(row.questionIds, cur).completed
                          const next = { ...cur }
                          for (const id of row.questionIds) {
                            next[id] = {
                              completed,
                              difficult: cur[id]?.difficult ?? false,
                              updatedAt,
                            }
                          }
                          return next
                        })
                        if (!hasSessionFlag(COMPLETED_TIP_KEY)) {
                          setSessionFlag(COMPLETED_TIP_KEY)
                          setCompletedTip({ id: questionId, anchor: target })
                        }
                      }}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`ws__icon-btn is-danger${rowState.difficult ? ' is-active' : ''}`}
                    title="Toggle difficult"
                    onClick={() => {
                      const updatedAt = new Date().toISOString()
                      setUserState((cur) => {
                        const difficult = !getRowQuestionState(row.questionIds, cur).difficult
                        const next = { ...cur }
                        for (const id of row.questionIds) {
                          next[id] = {
                            completed: cur[id]?.completed ?? false,
                            difficult,
                            updatedAt,
                          }
                        }
                        return next
                      })
                    }}
                  >
                    <Flag size={16} />
                  </button>
                  <button
                    type="button"
                    className="ws__icon-btn"
                    title={expanded ? 'Collapse' : 'Expand'}
                    onClick={() => updateFilters({ ...filters, expandedQuestionId: expanded ? null : questionId })}
                  >
                    <ChevronDown size={16} className={expanded ? 'ws__chev ws__chev--open' : 'ws__chev'} />
                  </button>
                </div>
              </div>

              {expanded ? (
                <div className="ws__q-detail">
                  {(() => {
                    const rowDetails = row.questionIds.map((id) => details[id])
                    if (rowDetails.some((detail) => !detail || detail === 'loading')) {
                      return <div className="ws__q-question">— loading question —</div>
                    }
                    if (rowDetails.some((detail) => detail === 'error')) {
                      return (
                        <div className="ws__q-question">
                          — failed to load question —{' '}
                          <button
                            type="button"
                            className="ws__q-retry"
                            onClick={() => row.questionIds.forEach(retryDetail)}
                          >
                            retry
                          </button>
                        </div>
                      )
                    }
                    const loadedDetails = rowDetails as QuestionDetail[]
                    const marksLabel = row.isFullQuestion
                      ? formatTotalMarksLabel(totalMarks)
                      : extractMarksLabel(loadedDetails[0].markschemeHtml)
                    const seenStemKeys = new Set<string>()
                    return (
                      <>
                        <div className={row.isFullQuestion ? 'ws__q-question ws__q-question--combined' : 'ws__q-question'}>
                          {loadedDetails.map((detail, index) => {
                            const part = rowQuestions[index]
                            const partMarksLabel = row.isFullQuestion ? marksLabelForPart(part, detail) : null
                            return (
                              <section key={detail.questionId} className="ws__part">
                                {row.isFullQuestion && part ? (
                                  <div className="ws__part-head">
                                    <p className="ws__part-label">{formatQuestionPartLabel(part)}</p>
                                    {partMarksLabel ? <span className="ws__part-marks">{partMarksLabel}</span> : null}
                                  </div>
                                ) : null}
                                <SafeHtml html={row.isFullQuestion ? stripRepeatedParentStem(detail.questionHtml, seenStemKeys) : detail.questionHtml} />
                              </section>
                            )
                          })}
                        </div>
                        <div className="ws__reveal-row">
                          <button
                            type="button"
                            className="ws__q-reveal"
                            onClick={() =>
                              setQuestionUiState((cur) => {
                                const base =
                                  cur.orderKey === orderKey
                                    ? cur
                                    : {
                                        orderKey,
                                        completedSnapshot: questionUi.completedSnapshot,
                                        revealedMs: {},
                                      }
                                return {
                                  ...base,
                                  revealedMs: {
                                    ...base.revealedMs,
                                    ...Object.fromEntries(row.questionIds.map((id) => [id, !msRevealed])),
                                  },
                                }
                              })
                            }
                          >
                            <BookOpen size={14} /> {msRevealed ? 'hide mark scheme' : 'reveal mark scheme'}
                          </button>
                          {marksLabel ? <span className="ws__q-marks">{marksLabel}</span> : null}
                        </div>
                        {msRevealed ? (
                          <div className={row.isFullQuestion ? 'ws__ms ws__ms--combined' : 'ws__ms'}>
                            {loadedDetails.map((detail, index) => {
                              const part = rowQuestions[index]
                              return (
                                <section key={detail.questionId} className="ws__part">
                                  {row.isFullQuestion && part ? <p className="ws__part-label">{formatQuestionPartLabel(part)}</p> : null}
                                  <SafeHtml html={detail.markschemeHtml} />
                                </section>
                              )
                            })}
                          </div>
                        ) : null}
                      </>
                    )
                  })()}
                </div>
              ) : null}
            </article>
          )
        }}
      />

      <footer className="ws__foot">
        <span>RegretLess · IB Questionbank</span>
        <span className="ws__foot-rule" />
        <span>No regrets. Just marks. · M26</span>
      </footer>

      {completedTip ? <WorkspaceTipBubble anchor={completedTip.anchor} message={COMPLETED_TIP_MESSAGE} onDismiss={() => setCompletedTip(null)} /> : null}
      {brokenTip ? <WorkspaceTipBubble anchor={brokenTip.anchor} message={BROKEN_TIP_MESSAGE} onDismiss={() => setBrokenTip(null)} /> : null}
      {yearMenuAnchor ? (
        <WorkspaceYearDropdown
          anchor={yearMenuAnchor}
          years={availableYears}
          activeYears={activeYearFilters}
          onToggle={toggleYearFilter}
          onDismiss={() => setYearMenuAnchor(null)}
        />
      ) : null}

    </div>
  )
}

function WorkspaceYearDropdown({
  anchor,
  years,
  activeYears,
  onToggle,
  onDismiss,
}: {
  anchor: HTMLElement
  years: YearFilterCode[]
  activeYears: YearFilterCode[]
  onToggle: (year: YearFilterCode) => void
  onDismiss: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const menuW = menuRef.current?.offsetWidth ?? 180
      const gap = 8
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuW - 8)
      setPos({ top: rect.bottom + gap, left })
    }
    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (anchor.contains(target) || menuRef.current?.contains(target))) return
      onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor, onDismiss])

  return createPortal(
    <div
      ref={menuRef}
      className="ws__dropdown-menu"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: 0, visibility: 'hidden' }}
    >
      {years.map((year) => (
        <button
          key={year}
          type="button"
          className={`ws__chip${activeYears.includes(year) ? ' is-active' : ''}`}
          onClick={() => onToggle(year)}
        >
          {formatYearFilterLabel(year)}
        </button>
      ))}
    </div>,
    document.body,
  )
}

function WorkspaceTipBubble({ anchor, message, onDismiss }: { anchor: HTMLElement; message: string; onDismiss: () => void }) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; right: number; placement: 'top' | 'bottom' } | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const bubbleH = bubbleRef.current?.offsetHeight ?? 80
      const gap = 10
      const spaceBelow = window.innerHeight - rect.bottom
      const placement: 'top' | 'bottom' = spaceBelow < bubbleH + gap + 16 ? 'top' : 'bottom'
      const top = placement === 'bottom' ? rect.bottom + gap : rect.top - gap - bubbleH
      const right = Math.max(8, window.innerWidth - rect.right)
      setPos({ top, right, placement })
    }
    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={bubbleRef}
      className={`ws__bubble ws__bubble--${pos?.placement ?? 'bottom'}`}
      role="status"
      style={pos ? { top: pos.top, right: pos.right } : { top: -9999, right: 0, visibility: 'hidden' }}
    >
      <span>{message}</span>
      <button type="button" className="ws__bubble-x" aria-label="Dismiss" onClick={onDismiss}>
        <X size={12} />
      </button>
    </div>,
    document.body,
  )
}
