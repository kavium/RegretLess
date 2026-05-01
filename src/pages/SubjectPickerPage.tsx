import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useDataContext } from '../lib/data-context'
import { useRefreshControl } from '../lib/use-refresh-control'
import './SubjectPickerPage.css'

const TINTS = ['rose', 'butter', 'sage', 'sky'] as const
const COUNTDOWN_TARGET = new Date(2026, 3, 28, 9, 0, 0).getTime()

function getTimeLeft() {
  const diff = COUNTDOWN_TARGET - Date.now()
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, over: true }
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return { d, h, m, s, over: false }
}

const pad = (n: number) => String(n).padStart(2, '0')

function CountdownCard() {
  const [t, setT] = useState(getTimeLeft)
  useEffect(() => {
    if (t.over) return
    const id = window.setInterval(() => setT(getTimeLeft()), 1000)
    return () => window.clearInterval(id)
  }, [t.over])

  if (t.over) return null

  return (
    <div className="picker__hero-card">
      <div className="picker__countdown">
        <div className="picker__countdown-headline">Good Luck for M26 Exams!</div>
        <div className="picker__countdown-label">— Time until M26 —</div>
        <div className="picker__countdown-time">
          {t.d}d · {pad(t.h)}h · {pad(t.m)}m · {pad(t.s)}s
        </div>
      </div>
    </div>
  )
}

export function SubjectPickerPage() {
  const { manifest } = useDataContext()
  const { refreshState, handleRefresh, label } = useRefreshControl()
  const subjects = manifest?.subjects ?? []
  const totalQ = subjects.reduce((s, x) => s + x.questionCount, 0)

  return (
    <div className="picker">
      <div className="picker__grain" aria-hidden="true" />

      <header className="picker__masthead">
        <div className="picker__masthead-row">
          <div className="picker__brand">
            <span className="picker__brand-mark">RL</span>
            <span className="picker__brand-pipe" />
            <span className="picker__brand-name">RegretLess</span>
          </div>
          <div className="picker__masthead-meta">
            <span>{subjects.length} subjects · {totalQ.toLocaleString()} questions</span>
            <button type="button" className="picker__refresh" onClick={handleRefresh}>
              <RefreshCw size={12} className={refreshState === 'working' ? 'spin' : ''} />
              {label}
            </button>
          </div>
        </div>

        <div className="picker__hero">
          <div className="picker__hero-text">
            <span className="picker__eyebrow">— IB Past Paper Question Bank —</span>
            <h1 className="picker__title">
              IB Questionbank,<br />
              <em>done right</em>.
            </h1>
            <p className="picker__sub">
              Every past paper question. Every mark scheme. Organised by syllabus
              topic so you can drill exactly what you need — the night before, the
              week before, or right now.
            </p>
          </div>
          <CountdownCard />
        </div>
      </header>

      <section className="picker__shelves">
        {subjects.map((s, i) => {
          const tint = TINTS[i % TINTS.length]
          const shortName = s.name.split(':')[0].trim()
          return (
            <Link key={s.id} to={`/subject/${s.id}`} className={`picker__vol picker__vol--${tint}`}>
              <div className="picker__vol-top">
                <span className="picker__vol-no">{shortName}</span>
              </div>
              <h3 className="picker__vol-name">{s.name}</h3>
              <div className="picker__vol-tags">
                {(s.paperCoverage && s.paperCoverage.length ? s.paperCoverage : ['1A', '2', '3']).map((p) => (
                  <span key={p} className="picker__vol-tag">{p === '2' ? 'Paper 2' : `Paper ${p}`}</span>
                ))}
              </div>
              <div className="picker__vol-foot">
                <span><b>{s.questionCount.toLocaleString()}</b> questions</span>
                <span><b>{s.nodeCount}</b> topics</span>
                <span className="picker__vol-cta">open →</span>
              </div>
            </Link>
          )
        })}
        {subjects.length === 0 ? (
          <div className="picker__empty">— next issue: the manifest. stay tuned. —</div>
        ) : null}
      </section>

      <footer className="picker__foot">
        <span>RegretLess · IB Questionbank</span>
        <span className="picker__foot-rule" />
        <span>No regrets. Just marks. · M26</span>
      </footer>
    </div>
  )
}
