import type { PaperCode, SubjectManifestEntry } from '../types'

const SCIENCE_PAPER_COVERAGE: PaperCode[] = ['1A', '1B', '2']
const DEFAULT_PAPER_COVERAGE: PaperCode[] = ['1A', '2']
const SCIENCE_SUBJECT_RE = /\b(?:biology|chemistry|physics)\b/i
const SCIENCE_LEGACY_PAPER_LABELS: Partial<Record<PaperCode, string>> = {
  '1': 'Paper 1A',
  '2': 'Paper 1B',
  '3': 'Paper 2',
}

export function isScienceSubject(subjectName: string) {
  return SCIENCE_SUBJECT_RE.test(subjectName)
}

export function formatPaperLabel(
  paper: PaperCode,
  subject: Pick<SubjectManifestEntry, 'name'> | string | null = null,
  availablePapers: readonly PaperCode[] = [],
) {
  const subjectName = typeof subject === 'string' ? subject : subject?.name
  const hasCurrentSciencePapers = availablePapers.includes('1A') || availablePapers.includes('1B')
  const hasLegacySciencePapers = availablePapers.includes('1') || availablePapers.includes('3')
  const scienceLabel = subjectName && isScienceSubject(subjectName) && hasLegacySciencePapers && !hasCurrentSciencePapers
    ? SCIENCE_LEGACY_PAPER_LABELS[paper]
    : null

  if (scienceLabel) {
    return scienceLabel
  }

  return paper === 'unknown' ? 'Uncategorized' : `Paper ${paper}`
}

export function getSubjectCardPaperCoverage(subject: Pick<SubjectManifestEntry, 'name' | 'paperCoverage'>): PaperCode[] {
  if (isScienceSubject(subject.name)) {
    return SCIENCE_PAPER_COVERAGE
  }

  const coverage = subject.paperCoverage?.filter((paper) => paper !== 'unknown')
  return coverage?.length ? coverage : DEFAULT_PAPER_COVERAGE
}
