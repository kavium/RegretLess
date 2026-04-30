import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, ChevronLeft, Layers2, RotateCcw, X } from 'lucide-react'
import { useSubjectBundle } from '../lib/use-subject-bundle'
import { buildCanonicalQuestionSequence } from '../lib/questions'
import {
  buildSyllabusIndex,
  emptySelection,
  getNodeSelectionState,
  getSelectionEntries,
  selectAllUnits,
  toggleSelectionNode,
} from '../lib/selection'
import { buildWorkspacePath, parseSelection, serializeSelection } from '../lib/url-state'
import type { SyllabusIndex } from '../lib/selection'
import type { NormalizedSelection, SyllabusNode, WorkspaceFilterState } from '../types'
import './StudySetupPage.css'

const TINTS = ['rose', 'butter', 'sage', 'sky'] as const

function PqNode({
  node, index, selection, onToggle, depth = 0,
}: {
  node: SyllabusNode
  index: SyllabusIndex
  selection: NormalizedSelection
  onToggle: (id: string) => void
  depth?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  const state = getNodeSelectionState(selection, index, node.id)
  const children = node.childIds
    .map((id) => index.nodeMap.get(id))
    .filter((c): c is SyllabusNode => Boolean(c))

  useEffect(() => { if (ref.current) ref.current.indeterminate = state.partial }, [state.partial])

  return (
    <div className={`setup-node setup-node--d${depth}`} data-checked={state.checked} data-partial={state.partial}>
      <label className="setup-node__row">
        <input ref={ref} type="checkbox" checked={state.checked} onChange={() => onToggle(node.id)} />
        <span className="setup-node__box" aria-hidden="true">
          {state.checked ? '●' : state.partial ? '◐' : '○'}
        </span>
        <span className="setup-node__copy">
          <span className="setup-node__title">{node.label}</span>
        </span>
      </label>
      {children.length ? (
        <div className="setup-node__children">
          {children.map((c) => (
            <PqNode key={c.id} node={c} index={index} selection={selection} onToggle={onToggle} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function StudySetupPage() {
  const navigate = useNavigate()
  const { subjectId } = useParams()
  const [searchParams] = useSearchParams()
  const { bundle, status, error } = useSubjectBundle(subjectId)

  const syllabusIndex = useMemo(() => (bundle ? buildSyllabusIndex(bundle.syllabus) : null), [bundle])
  const [selection, setSelection] = useState<NormalizedSelection>(emptySelection())

  useEffect(() => {
    if (!bundle || !syllabusIndex) return
    setSelection(parseSelection(searchParams.get('units'), syllabusIndex))
  }, [bundle, searchParams, syllabusIndex])

  const questionCount = useMemo(() => {
    if (!bundle || !syllabusIndex) return 0
    return buildCanonicalQuestionSequence(bundle, selection, syllabusIndex).length
  }, [bundle, selection, syllabusIndex])

  const selectionEntries = useMemo(
    () => (syllabusIndex ? getSelectionEntries(selection, syllabusIndex) : []),
    [selection, syllabusIndex],
  )

  if (status === 'loading' || status === 'idle') {
    return <div className="setup setup--empty"><span>— sautéing the questions —</span></div>
  }
  if (status === 'error' || !bundle || !syllabusIndex || !subjectId) {
    return <div className="setup setup--empty"><span>— this volume is missing. {error} —</span></div>
  }

  const defaultFilters: WorkspaceFilterState = {
    paperFilters: ['1A', '1B', '1', '2', '3'],
    levelFilters: ['SL', 'HL'],
    onlyDifficult: false,
    orderMode: 'source',
    scrambleNonce: 0,
    expandedQuestionId: null,
  }

  const rootNodes = syllabusIndex.rootIds
    .map((id) => syllabusIndex.nodeMap.get(id))
    .filter((n): n is SyllabusNode => Boolean(n))

  const total = bundle.questions.length

  return (
    <div className="setup">
      <div className="setup__grain" aria-hidden="true" />

      <header className="setup__masthead">
        <div className="setup__masthead-row">
          <div className="setup__brand">
            <span className="setup__brand-mark">RL</span>
            <span className="setup__brand-pipe" />
            <span className="setup__brand-name">RegretLess · {bundle.subject.name}</span>
          </div>
          <div className="setup__masthead-meta">
            <Link to="/" className="setup__back"><ChevronLeft size={14} /> all subjects</Link>
          </div>
        </div>
      </header>

      <section className="setup__layout">
        <aside className="setup__panel">
          <div className="setup__panel-head">
            <span className="setup__panel-no">Your set</span>
          </div>
          <h3 className="setup__panel-name">Selection</h3>
          <div className="setup__panel-rule" />
          <ul className="setup__panel-stats">
            <li><span>Selected units</span><b>{selectionEntries.length}</b></li>
            <li><span>Questions</span><b>{questionCount.toLocaleString()}</b></li>
            <li><span>Total</span><b>{total.toLocaleString()}</b></li>
          </ul>

          <div className="setup__chips">
            {selectionEntries.length
              ? selectionEntries.map((entry) => (
                  <span key={entry.id} className="setup__chip">
                    <span className="setup__chip-label">{entry.label}</span>
                    <button
                      type="button"
                      className="setup__chip-x"
                      aria-label={`Remove ${entry.label}`}
                      onClick={() => setSelection((cur) => toggleSelectionNode(cur, syllabusIndex, entry.id))}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              : <span className="setup__chip setup__chip--empty">no units chosen yet</span>}
          </div>

          <button
            type="button"
            className="setup__go"
            disabled={!selectionEntries.length}
            onClick={() =>
              navigate(buildWorkspacePath(subjectId, selection, defaultFilters), {
                state: { selection: serializeSelection(selection) },
              })
            }
          >
            let's start cooking
            <ArrowRight size={16} />
          </button>
        </aside>

        <div className="setup__main">
          <div className="setup__main-head">
            <div>
              <span className="setup__main-eyebrow">— Units —</span>
              <h2>Choose any combination</h2>
            </div>
            <div className="setup__main-actions">
              <button type="button" className="setup__action setup__action--primary" onClick={() => setSelection(selectAllUnits(syllabusIndex))}>
                <Layers2 size={14} /> select all
              </button>
              <button type="button" className="setup__action" onClick={() => setSelection(emptySelection())}>
                <RotateCcw size={14} /> clear
              </button>
            </div>
          </div>

          <div className="setup__shelves">
            {rootNodes.map((node, i) => {
              const tint = TINTS[i % TINTS.length]
              return (
                <div key={node.id} className={`setup__vol setup__vol--${tint}`}>
                  <div className="setup__vol-band">
                    <span className="setup__vol-no">Unit {String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <PqNode node={node} index={syllabusIndex} selection={selection} onToggle={(id) => setSelection((cur) => toggleSelectionNode(cur, syllabusIndex, id))} />
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <footer className="setup__foot">
        <span>RegretLess · IB Questionbank</span>
        <span className="setup__foot-rule" />
        <span>No regrets. Just marks. · M26</span>
      </footer>
    </div>
  )
}
