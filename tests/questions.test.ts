import { describe, expect, it } from 'vitest'
import { applyQuestionFilters, buildCanonicalQuestionSequence, orderQuestionIds } from '../src/lib/questions'
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
  ],
}

describe('question ordering', () => {
  const index = buildSyllabusIndex(bundle.syllabus)
  const selection = { umbrellaIds: ['A', 'B'], subunitIds: [] as string[] }

  it('preserves source order before completion partitioning', () => {
    const canonical = buildCanonicalQuestionSequence(bundle, selection, index)
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
          onlyDifficult: true,
          orderMode: 'source',
          scrambleNonce: 0,
          expandedQuestionId: null,
        },
        {
          q4: { completed: false, difficult: true, updatedAt: 'now' },
        },
      ),
    ).toEqual(['q4'])
  })
})
