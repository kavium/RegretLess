import { describe, expect, it } from 'vitest'
import { buildWorkspacePath, parseWorkspaceFilters } from '../src/lib/url-state'

describe('parseWorkspaceFilters', () => {
  it('falls back to defaults when params are absent', () => {
    const r = parseWorkspaceFilters(new URLSearchParams())
    expect(r.paperFilters.length).toBeGreaterThan(0)
    expect(r.levelFilters).toEqual(['SL', 'HL'])
    expect(r.yearFilters).toEqual([])
    expect(r.orderMode).toBe('source')
    expect(r.scrambleNonce).toBe(0)
    expect(r.expandedQuestionId).toBeNull()
    expect(r.onlyDifficult).toBe(false)
    expect(r.showBroken).toBe(false)
    expect(r.displayMode).toBe('tags')
    expect(r.questionGroupingMode).toBe('per-part')
  })

  it('rejects garbage paper/level codes and falls back', () => {
    const r = parseWorkspaceFilters(new URLSearchParams('papers=zz,99&levels=foo,bar'))
    expect(r.paperFilters.length).toBeGreaterThan(0)
    expect(r.levelFilters).toEqual(['SL', 'HL'])
  })

  it('parses year filters and drops invalid year tokens', () => {
    const r = parseWorkspaceFilters(new URLSearchParams('years=2024,specimen,EXN,18M,1999'))
    expect(r.yearFilters).toEqual(['2024', 'specimen'])
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

  it('parses broken and numbered display params', () => {
    const r = parseWorkspaceFilters(new URLSearchParams('broken=1&display=numbered&group=full'))
    expect(r.showBroken).toBe(true)
    expect(r.displayMode).toBe('numbered')
    expect(r.questionGroupingMode).toBe('full-question')
    expect(parseWorkspaceFilters(new URLSearchParams('broken=true&display=tags')).showBroken).toBe(false)
    expect(parseWorkspaceFilters(new URLSearchParams('display=other')).displayMode).toBe('tags')
    expect(parseWorkspaceFilters(new URLSearchParams('group=parts')).questionGroupingMode).toBe('per-part')
  })

  it('drops invalid expanded question ids', () => {
    expect(parseWorkspaceFilters(new URLSearchParams('expanded=__proto__')).expandedQuestionId).toBeNull()
  })

  it('rejects unsafe subject ids when building workspace paths', () => {
    expect(() =>
      buildWorkspacePath(
        '../physics',
        { umbrellaIds: ['A'], subunitIds: [] },
        {
          paperFilters: ['1A'],
          levelFilters: ['HL'],
          yearFilters: [],
          onlyDifficult: false,
          showBroken: false,
          displayMode: 'tags',
          questionGroupingMode: 'per-part',
          orderMode: 'source',
          scrambleNonce: 0,
          expandedQuestionId: null,
        },
      ),
    ).toThrow('Invalid subject id')
  })
})

describe('buildWorkspacePath', () => {
  it('emits broken and numbered display params only when enabled', () => {
    const path = buildWorkspacePath(
      'physics',
      { umbrellaIds: ['A'], subunitIds: [] },
      {
        paperFilters: ['1A'],
        levelFilters: ['HL'],
        yearFilters: ['2024', 'specimen'],
        onlyDifficult: false,
        showBroken: true,
        displayMode: 'numbered',
        questionGroupingMode: 'full-question',
        orderMode: 'source',
        scrambleNonce: 0,
        expandedQuestionId: null,
      },
    )

    expect(path).toContain('broken=1')
    expect(path).toContain('display=numbered')
    expect(path).toContain('group=full')
    expect(path).toContain('years=2024%2Cspecimen')

    const defaultPath = buildWorkspacePath(
      'physics',
      { umbrellaIds: ['A'], subunitIds: [] },
      {
        paperFilters: ['1A'],
        levelFilters: ['HL'],
        yearFilters: [],
        onlyDifficult: false,
        showBroken: false,
        displayMode: 'tags',
        questionGroupingMode: 'per-part',
        orderMode: 'source',
        scrambleNonce: 0,
        expandedQuestionId: null,
      },
    )
    expect(defaultPath).not.toContain('broken=')
    expect(defaultPath).not.toContain('display=')
    expect(defaultPath).not.toContain('group=')
    expect(defaultPath).not.toContain('years=')
  })
})
