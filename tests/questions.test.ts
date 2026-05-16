import { describe, expect, it } from 'vitest'
import { applyQuestionFilters, buildCanonicalQuestionSequence, buildQuestionRows, computeBrokenQuestionIds, extractMarkValue, extractMarksLabel, formatQuestionReferenceTitle, formatTotalMarksLabel, getAvailableYears, getQuestionYearFilter, orderQuestionIds } from '../src/lib/questions'
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
          questionGroupingMode: 'per-part',
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
          questionGroupingMode: 'per-part',
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

  it('does not reuse broken-question results across new bundles with the same subject id', () => {
    const firstBundle: SubjectBundle = {
      ...bundle,
      subject: { id: 'physics-cache-same-id', name: 'Physics' },
      questions: [
        { ...bundle.questions[0], questionId: 'first-a', referenceCode: 'FAM.a', questionNumber: 'a' },
        { ...bundle.questions[0], questionId: 'first-c', referenceCode: 'FAM.c', questionNumber: 'c' },
      ],
    }
    const secondBundle: SubjectBundle = {
      ...firstBundle,
      questions: [
        { ...bundle.questions[0], questionId: 'second-a', referenceCode: 'FAM.a', questionNumber: 'a' },
        { ...bundle.questions[0], questionId: 'second-b', referenceCode: 'FAM.b', questionNumber: 'b' },
      ],
    }

    expect(computeBrokenQuestionIds(firstBundle)).toEqual(new Set(['first-c']))
    expect(computeBrokenQuestionIds(secondBundle)).toEqual(new Set())
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
      questionGroupingMode: 'per-part' as const,
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
    expect(extractMarkValue('[Maximum mark: 4]')).toBe(4)
    expect(extractMarkValue('<p>[1 mark]</p><p>[ 2 marks ]</p>')).toBe(2)
    expect(formatTotalMarksLabel(9)).toBe('Total 9 marks')
  })

  it('formats question references for display without changing stored codes', () => {
    expect(formatQuestionReferenceTitle('21M.3.AHL.TZ2.2')).toBe('May 2021 | Paper 3 | Time Zone 2 | Question 2')
    expect(formatQuestionReferenceTitle('24N.3.AHL.TZ0.1bii')).toBe('November 2024 | Paper 3 | Time Zone 0 | Question 1 b(ii)')
    expect(formatQuestionReferenceTitle('24N.3.AHL.TZ0.1b.ii')).toBe('November 2024 | Paper 3 | Time Zone 0 | Question 1 b(ii)')
    expect(formatQuestionReferenceTitle('not-a-standard-code')).toBe('not-a-standard-code')
  })

  it('combines non-broken sibling parts into full-question rows', () => {
    const fullBundle: SubjectBundle = {
      ...bundle,
      subject: { id: 'physics-full-rows', name: 'Physics' },
      questions: [
        { ...bundle.questions[0], questionId: 'a', referenceCode: 'FAM.1a', questionNumber: 'a', marksAvailable: '[Maximum mark: 1]' },
        { ...bundle.questions[0], questionId: 'b', referenceCode: 'FAM.1b', questionNumber: 'b', marksAvailable: '[Maximum mark: 2]' },
        { ...bundle.questions[0], questionId: 'c-i', referenceCode: 'FAM.1c.i', questionNumber: 'c.i', marksAvailable: '[Maximum mark: 3]' },
        { ...bundle.questions[0], questionId: 'c-iii', referenceCode: 'FAM.1c(iii)', questionNumber: 'c(iii)', marksAvailable: '[Maximum mark: 4]' },
        { ...bundle.questions[0], questionId: 'd-ii', referenceCode: 'FAM.1dii', questionNumber: 'dii', marksAvailable: '[Maximum mark: 5]' },
        { ...bundle.questions[0], questionId: 'numeric-1', referenceCode: 'P1.1', questionNumber: '1', marksAvailable: '[Maximum mark: 1]' },
        { ...bundle.questions[0], questionId: 'numeric-2', referenceCode: 'P1.2', questionNumber: '2', marksAvailable: '[Maximum mark: 1]' },
        { ...bundle.questions[0], questionId: 'paper3-a', referenceCode: '24N.3.AHL.TZ0.1a', questionNumber: 'a', marksAvailable: '[Maximum mark: 2]' },
        { ...bundle.questions[0], questionId: 'paper3-b-i', referenceCode: '24N.3.AHL.TZ0.1bi', questionNumber: 'i', marksAvailable: '[Maximum mark: 1]' },
        { ...bundle.questions[0], questionId: 'paper3-b-ii', referenceCode: '24N.3.AHL.TZ0.1bii', questionNumber: 'ii', marksAvailable: '[Maximum mark: 2]' },
      ],
    }
    const rows = buildQuestionRows(
      ['b', 'numeric-1', 'numeric-2'],
      fullBundle,
      {
        paperFilters: ['1A', '1B', '1', '2', '3'],
        levelFilters: ['SL', 'HL'],
        yearFilters: [],
        onlyDifficult: false,
        showBroken: false,
        displayMode: 'tags',
        questionGroupingMode: 'full-question',
        orderMode: 'source',
        scrambleNonce: 0,
        expandedQuestionId: null,
      },
      new Set(['c-iii']),
    )
    const paper3Rows = buildQuestionRows(
      ['paper3-a'],
      fullBundle,
      {
        paperFilters: ['1A', '1B', '1', '2', '3'],
        levelFilters: ['SL', 'HL'],
        yearFilters: [],
        onlyDifficult: false,
        showBroken: false,
        displayMode: 'tags',
        questionGroupingMode: 'full-question',
        orderMode: 'source',
        scrambleNonce: 0,
        expandedQuestionId: null,
      },
      new Set(),
    )

    expect(rows).toEqual([
      {
        rowId: 'family:FAM.1',
        representativeId: 'b',
        questionIds: ['a', 'b', 'c-i', 'd-ii'],
        isFullQuestion: true,
      },
      {
        rowId: 'numeric-1',
        representativeId: 'numeric-1',
        questionIds: ['numeric-1'],
        isFullQuestion: false,
      },
      {
        rowId: 'numeric-2',
        representativeId: 'numeric-2',
        questionIds: ['numeric-2'],
        isFullQuestion: false,
      },
    ])
    expect(paper3Rows).toEqual([
      {
        rowId: 'family:24N.3.AHL.TZ0.1',
        representativeId: 'paper3-a',
        questionIds: ['paper3-a', 'paper3-b-i', 'paper3-b-ii'],
        isFullQuestion: true,
      },
    ])
  })
})
