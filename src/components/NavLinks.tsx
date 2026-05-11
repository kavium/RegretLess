import { Link, useLocation } from 'react-router-dom'
import type { MouseEvent } from 'react'
import './NavLinks.css'

const NAV_LINKS: Array<{ label: string; to: string; scrollTo?: string }> = [
  { label: 'Questionbank', to: '/', scrollTo: 'shelves' },
]

export function NavLinks() {
  const location = useLocation()

  const handleNavClick = (e: MouseEvent<HTMLAnchorElement>, scrollTo?: string) => {
    if (!scrollTo) return
    if (location.pathname === '/') {
      const el = document.getElementById(scrollTo)
      if (el) {
        e.preventDefault()
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }

  return (
    <nav className="site-nav" aria-label="Primary">
      {NAV_LINKS.map((link) => (
        <Link
          key={link.label}
          to={link.to}
          state={link.scrollTo ? { scrollTo: link.scrollTo } : undefined}
          className="site-nav__link"
          onClick={(e) => handleNavClick(e, link.scrollTo)}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
