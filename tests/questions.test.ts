import { describe, expect, it } from 'vitest'
import { applyQuestionFilters, buildCanonicalQuestionSequence, computeBrokenQuestionIds, extractMarksLabel, getAvailableYears, getQuestionYearFilter, orderQuestionIds } from '../src/lib/questions'
import { buildSyllabusIndex } from '../src/lib/selection'
import type { SubjectBundle } from '../src/types'

const bundle: SubjectBundle = {
  subject: {
    id: 'physics',
    name: 'Physics',
  },
  syllabus: [
    { id: 'A', label: 'A', depth: 0, kind: 'umbrella', parentId: null, childIds: ['A1', 'A2'], canonicalOrder: 0 },
    { id: 'A1', label: 'A.1', depth: 1, kind: 'subunit', parentId: 'A', childIds: [], canonicalOrder: 1 },
    { id: 'A2', label: 'A.2', depth: 1, kind: 'subunit', parentId: 'A', childIds: [], canonicalOrder: 2 },
    { id: 'B', label: 'B', depth: 0, kind: 'umbrella', parentId: null, childIds: [], canonicalOrder: 3 },
  ],
  sectionQuestionOrder: {
    A: ['q1', 'q2', 'q3'],
    A1: ['q1', 'q2'],
    A2: ['q3'],
    B: ['q4'],
  },
  questions: [
    {
      questionId: 'q1',
      referenceCode: 'EXE.1A.HL.TZ0.1',
      subjectId: 'physics',
      title: 'q1',
      paper: '1A',
      level: 'HL',
      questionNumber: '1',
      marksAvailable: '1',
      breadcrumbLabels: ['A', 'A.1'],
      memberSectionIds: ['A', 'A1'],
      sectionOrders: { A: 0, A1: 0 },
    },
    {
      questionId: 'q2',
      referenceCode: 'EXE.2.SL.TZ0.2',
      subjectId: 'physics',
      title: 'q2',
      paper: '2',
      level: 'SL',
      questionNumber: '2',
      marksAvailable: '1',
      breadcrumbLabels: ['A', 'A.1'],
      memberSectionIds: ['A', 'A1'],
      sectionOrders: { A: 1, A1: 1 },
    },
    {
      questionId: 'q3',
      referenceCode: 'EXE.1B.SL.TZ0.3',
      subjectId: 'physics',
      title: 'q3',
      paper: '1B',
      level: 'SL',
      questionNumber: '3',
      marksAvailable: '1',
      breadcrumbLabels: ['A', 'A.2'],
      memberSectionIds: ['A', 'A2'],
      sectionOrders: { A: 2, A2: 0 },
    },
    {
      questionId: 'q4',
      referenceCode: 'EXE.1A.HL.TZ0.4',
      subjectId: 'physics',
      title: 'q4',
      paper: '1A',
      level: 'HL',
      questionNumber: '4',
      marksAvailable: '1',
      breadcrumbLabels: ['B'],
      memberSectionIds: ['B'],
      sectionOrders: { B: 0 },
    },
    {
      questionId: 'q5',
      referenceCode: 'EXE.2.SL.TZ0.2',
      subjectId: 'physics',
      title: 'duplicate q2',
      paper: '2',
      level: 'SL',
      questionNumber: '2',
      marksAvailable: '1',
      breadcrumbLabels: ['B'],
      memberSectionIds: ['B'],
      sectionOrders: { B: 1 },
    },
  ],
}

describe('question ordering', () => {
  const index = buildSyllabusIndex(bundle.syllabus)
  const selection = { umbrellaIds: ['A', 'B'], subunitIds: [] as string[] }

  it('preserves source order before completion partitioning', () => {
    const canonical = buildCanonicalQuestionSequence(bundle, selection, index)
    expect(canonical).toEqual(['q1', 'q2', 'q3', 'q4'])
  })

  it('shows only one copy of duplicated question tags', () => {
    const canonical = buildCanonicalQuestionSequence(
      {
        ...bundle,
        sectionQuestionOrder: {
          ...bundle.sectionQuestionOrder,
          B: ['q4', 'q5'],
        },
      },
      selection,
      index,
    )
    expect(canonical).toEqual(['q1', 'q2', 'q3', 'q4'])
  })

  it('moves completed questions to the bottom', () => {
    const canonical = buildCanonicalQuestionSequence(bundle, selection, index)
    expect(
      orderQuestionIds(canonical, bundle, new Set(['q2']), 'source', 0),
    ).toEqual(['q1', 'q3', 'q4', 'q2'])
  })

  it('filters by paper, level and difficult flag', () => {
    const canonical = buildCanonicalQuestionSequence(bundle, selection, index)
    expect(
      applyQuestionFilters(
        bundle,
        canonical,
        {
          paperFilters: ['1A'],
          levelFilters: ['HL'],
          yearFilters: [],
          onlyDifficult: true,
          showBroken: false,
          displayMode: 'tags',
          orderMode: 'source',
          scrambleNonce: 0,
          expandedQuestionId: null,
        },
        new Set(),
        {
          q4: { completed: false, difficult: true, updatedAt: 'now' },
        },
      ),
    ).toEqual(['q4'])
  })

  it('filters by parsed year and groups non-year prefixes as specimen', () => {
    const yearBundle: SubjectBundle = {
      ...bundle,
      questions: [
        { ...bundle.questions[0], questionId: 'q1', referenceCode: '18M.1A.HL.TZ0.1' },
        { ...bundle.questions[1], questionId: 'q2', referenceCode: '19N.2.SL.TZ0.2' },
        { ...bundle.questions[2], questionId: 'q3', referenceCode: 'EXN.1B.SL.TZ0.3' },
      ],
    }
    const ids = ['q1', 'q2', 'q3']

    expect(getQuestionYearFilter(yearBundle.questions[0])).toBe('2018')
    expect(getQuestionYearFilter(yearBundle.questions[2])).toBe('specimen')
    expect(getAvailableYears(yearBundle)).toEqual(['2019', '2018', 'specimen'])
    expect(
      applyQuestionFilters(
        yearBundle,
        ids,
        {
          paperFilters: ['1A', '1B', '1', '2', '3'],
          levelFilters: ['SL', 'HL'],
          yearFilters: ['specimen'],
          onlyDifficult: false,
          showBroken: false,
          displayMode: 'tags',
          orderMode: 'source',
          scrambleNonce: 0,
          expandedQuestionId: null,
        },
        new Set(),
        {},
      ),
    ).toEqual(['q3'])
  })

  it('detects leaf questions with missing earlier siblings or subparts', () => {
    const brokenBundle: SubjectBundle = {
      ...bundle,
      subject: { id: 'physics-broken-detection', name: 'Physics' },
      questions: [
        { ...bundle.questions[0], questionId: 'family-a', referenceCode: 'FAM.a', questionNumber: 'a' },
        { ...bundle.questions[0], questionId: 'family-c', referenceCode: 'FAM.c', questionNumber: 'c' },
        { ...bundle.questions[0], questionId: 'sub-a', referenceCode: 'SUB.a', questionNumber: 'a' },
        { ...bundle.questions[0], questionId: 'sub-b-ii', referenceCode: 'SUB.b.ii', questionNumber: 'b.ii' },
        { ...bundle.questions[0], questionId: 'numeric', referenceCode: 'NUM.1', questionNumber: '1' },
      ],
    }

    expect(computeBrokenQuestionIds(brokenBundle)).toEqual(new Set(['family-c', 'sub-b-ii']))
  })

  it('keeps difficult broken questions visible when only difficult is enabled', () => {
    const ids = ['q1', 'q2', 'q3']
    const filters = {
      paperFilters: ['1A', '1B', '1', '2', '3'],
      levelFilters: ['SL', 'HL'],
      yearFilters: [],
      onlyDifficult: true,
      showBroken: false,
      displayMode: 'tags' as const,
      orderMode: 'source' as const,
      scrambleNonce: 0,
      expandedQuestionId: null,
    }

    expect(
      applyQuestionFilters(
        bundle,
        ids,
        filters,
        new Set(['q1', 'q2']),
        {
          q1: { completed: false, difficult: true, updatedAt: 'now' },
          q2: { completed: false, difficult: false, updatedAt: 'now' },
        },
      ),
    ).toEqual(['q1'])
  })

  it('extracts the final literal mark count from markscheme html', () => {
    expect(extractMarksLabel('<p>step</p><p>[1 mark]</p><p>[ 2 marks ]</p>')).toBe('[ 2 marks ]')
    expect(extractMarksLabel('<p>no count</p>')).toBeNull()
  })
})
