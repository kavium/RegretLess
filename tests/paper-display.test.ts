import { describe, expect, it } from 'vitest'
import { formatPaperLabel, getSubjectCardPaperCoverage, isScienceSubject } from '../src/lib/paper-display'

describe('science subject paper display', () => {
  it('uses the current science paper set on subject cards', () => {
    expect(getSubjectCardPaperCoverage({
      name: 'DP Biology Last Assessment (2024)',
      paperCoverage: ['1', '2', '3', 'unknown'],
    })).toEqual(['1A', '1B', '2'])

    expect(getSubjectCardPaperCoverage({
      name: 'DP Chemistry First Assessment (2025)',
      paperCoverage: ['1A', '1B', '2'],
    })).toEqual(['1A', '1B', '2'])
  })

  it('does not treat non-science subjects as science', () => {
    expect(isScienceSubject('DP Economics')).toBe(false)
    expect(getSubjectCardPaperCoverage({
      name: 'DP Mathematics Applications And Interpretation',
      paperCoverage: ['1', '2', '3', 'unknown'],
    })).toEqual(['1', '2', '3'])
  })

  it('does not render unknown as a paper number', () => {
    expect(formatPaperLabel('unknown')).toBe('Uncategorized')
  })

  it('maps legacy science paper codes to the current science labels', () => {
    const subject = { name: 'DP Physics Last Assessment (2024)' }
    const legacyPapers = ['1', '2', '3'] as const

    expect(formatPaperLabel('1', subject, legacyPapers)).toBe('Paper 1A')
    expect(formatPaperLabel('2', subject, legacyPapers)).toBe('Paper 1B')
    expect(formatPaperLabel('3', subject, legacyPapers)).toBe('Paper 2')
    expect(formatPaperLabel('1A', subject, legacyPapers)).toBe('Paper 1A')
    expect(formatPaperLabel('1B', subject, legacyPapers)).toBe('Paper 1B')
  })

  it('keeps current science paper codes literal when current papers are available', () => {
    const subject = { name: 'DP Physics First Assessment (2025)' }
    const currentPapers = ['1A', '1B', '2'] as const

    expect(formatPaperLabel('1A', subject, currentPapers)).toBe('Paper 1A')
    expect(formatPaperLabel('1B', subject, currentPapers)).toBe('Paper 1B')
    expect(formatPaperLabel('2', subject, currentPapers)).toBe('Paper 2')
  })

  it('keeps non-science paper labels unchanged', () => {
    const subject = { name: 'DP Mathematics Applications And Interpretation' }

    expect(formatPaperLabel('1', subject)).toBe('Paper 1')
    expect(formatPaperLabel('2', subject)).toBe('Paper 2')
    expect(formatPaperLabel('3', subject)).toBe('Paper 3')
  })
})
