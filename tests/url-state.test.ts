import { describe, expect, it } from 'vitest'
import { parseWorkspaceFilters } from '../src/lib/url-state'

describe('parseWorkspaceFilters', () => {
  it('falls back to defaults when params are absent', () => {
    const r = parseWorkspaceFilters(new URLSearchParams())
    expect(r.paperFilters.length).toBeGreaterThan(0)
    expect(r.levelFilters).toEqual(['SL', 'HL'])
    expect(r.orderMode).toBe('source')
    expect(r.scrambleNonce).toBe(0)
    expect(r.expandedQuestionId).toBeNull()
    expect(r.onlyDifficult).toBe(false)
  })

  it('rejects garbage paper/level codes and falls back', () => {
    const r = parseWorkspaceFilters(new URLSearchParams('papers=zz,99&levels=foo,bar'))
    expect(r.paperFilters.length).toBeGreaterThan(0)
    expect(r.levelFilters).toEqual(['SL', 'HL'])
  })

  it('coerces non-numeric shuffle to 0', () => {
    const r = parseWorkspaceFilters(new URLSearchParams('shuffle=NaNgarbage'))
    expect(r.scrambleNonce).toBe(0)
  })

  it('keeps known order mode and rejects unknown', () => {
    expect(parseWorkspaceFilters(new URLSearchParams('order=scrambled')).orderMode).toBe('scrambled')
    expect(parseWorkspaceFilters(new URLSearchParams('order=hacker')).orderMode).toBe('source')
  })

  it('treats difficult=1 as true and any other value as false', () => {
    expect(parseWorkspaceFilters(new URLSearchParams('difficult=1')).onlyDifficult).toBe(true)
    expect(parseWorkspaceFilters(new URLSearchParams('difficult=true')).onlyDifficult).toBe(false)
    expect(parseWorkspaceFilters(new URLSearchParams('difficult=')).onlyDifficult).toBe(false)
  })
})
