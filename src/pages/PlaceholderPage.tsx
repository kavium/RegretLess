import { Link } from 'react-router-dom'
import { NavLinks } from '../components/NavLinks'
import './PlaceholderPage.css'

interface PlaceholderPageProps {
  title: string
  eyebrow?: string
  blurb?: string
}

export function PlaceholderPage({ title, eyebrow, blurb }: PlaceholderPageProps) {
  return (
    <div className="placeholder">
      <div className="placeholder__grain" aria-hidden="true" />

      <header className="placeholder__masthead">
        <div className="placeholder__masthead-row">
          <Link to="/" className="placeholder__brand">
            <span className="placeholder__brand-mark">RL</span>
            <span className="placeholder__brand-pipe" />
            <span className="placeholder__brand-name">RegretLess</span>
          </Link>
          <NavLinks />
          <Link to="/" className="placeholder__back">← Back to Questionbank</Link>
        </div>
      </header>

      <main className="placeholder__body">
        <span className="placeholder__eyebrow">— {eyebrow ?? title} —</span>
        <h1 className="placeholder__title">{title}</h1>
        <p className="placeholder__sub">
          {blurb ?? 'Coming soon.'}
        </p>

        <section className="placeholder__slot">
          <p className="placeholder__slot-hint">COMING SOON!</p>
        </section>
      </main>

      <footer className="placeholder__foot">
        <span>RegretLess · IB Questionbank</span>
        <span className="placeholder__foot-rule" />
        <span>No regrets. Just marks. · M26</span>
      </footer>
    </div>
  )
}
