export type PaperCode = '1A' | '1B' | '1' | '2' | '3'
export type LevelCode = 'SL' | 'HL'
export type OrderMode = 'source' | 'scrambled'
export type SyllabusNodeKind = 'umbrella' | 'subunit'

export interface SubjectManifestEntry {
  id: string
  name: string
  bundleUrl: string
  bundleHash: string
  questionCount: number
  nodeCount: number
  paperCoverage?: PaperCode[]
}

export interface SubjectManifest {
  version: string
  generatedAt: string
  subjects: SubjectManifestEntry[]
}

export interface SyllabusNode {
  id: string
  label: string
  depth: number
  kind: SyllabusNodeKind
  parentId: string | null
  childIds: string[]
  canonicalOrder: number
}

export interface QuestionRecord {
  questionId: string
  referenceCode: string
  subjectId: string
  title: string
  paper: PaperCode
  level: LevelCode
  questionNumber: string
  marksAvailable: string
  breadcrumbLabels: string[]
  memberSectionIds: string[]
  sectionOrders: Record<string, number>
}

export interface QuestionDetail {
  questionId: string
  questionHtml: string
  markschemeHtml: string
}

export interface SubjectBundle {
  subject: {
    id: string
    name: string
  }
  syllabus: SyllabusNode[]
  sectionQuestionOrder: Record<string, string[]>
  questions: QuestionRecord[]
}

export interface NormalizedSelection {
  umbrellaIds: string[]
  subunitIds: string[]
}

export interface UserQuestionState {
  completed: boolean
  difficult: boolean
  updatedAt: string
}

export type UserQuestionStateMap = Record<string, UserQuestionState>

export interface WorkspaceState {
  subjectId: string
  workspaceUrl: string
  summaryLabel: string
  selection: NormalizedSelection
  paperFilters: PaperCode[]
  levelFilters: LevelCode[]
  onlyDifficult: boolean
  orderMode: OrderMode
  scrambleNonce: number
  expandedQuestionId: string | null
  scrollY: number
  updatedAt: string
}

export interface WorkspaceFilterState {
  paperFilters: PaperCode[]
  levelFilters: LevelCode[]
  onlyDifficult: boolean
  orderMode: OrderMode
  scrambleNonce: number
  expandedQuestionId: string | null
}
