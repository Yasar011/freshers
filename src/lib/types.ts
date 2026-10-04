export type CriterionKey = "makeup" | "presentation" | "styling" | "dressup";
export const CRITERIA_KEYS: CriterionKey[] = ["makeup", "presentation", "styling", "dressup"];

export interface Criterion {
  label: string;
  max: number;
  order: number;
}

export interface Settings {
  criteria: Record<CriterionKey, Criterion>;
  evaluatorCount: number;
  totalDays: number;
}

export type DayStatus = "open" | "locked";

export interface DayInfo {
  label: string;
  status: DayStatus;
  openedAt?: number;
  lockedAt?: number;
}

export interface EventInfo {
  name: string;
  activeDay: string;
  totalDays: number;
  status?: string;
  days: Record<string, DayInfo>;
}

export interface Student {
  studentId: string;
  name: string;
  programme?: string;
  year?: string;
  semester?: string;
  class?: string;
  photo?: string;
  photoPath?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Evaluator {
  email: string;
  name: string;
  number: number;
  active: boolean;
  createdAt?: number;
  uid?: string;
  lastLoginAt?: number;
}

export interface Correction {
  originalTotal: number;
  original?: Record<CriterionKey, number>;
  reason: string;
  correctedAt: number;
  correctedBy?: string;
  count: number;
}

export interface Evaluation {
  makeup: number;
  presentation: number;
  styling: number;
  dressup: number;
  total: number;
  timestamp: number;
  studentId: string;
  evaluatorName: string;
  evaluatorNumber?: number;
  evaluatorUid?: string;
  enteredByAdmin?: boolean;
  correction?: Correction;
}

/** evaluations/{day}/{evaluatorKey}/{studentKey} */
export type DayEvaluations = Record<string, Record<string, Evaluation>>;
export type EvaluationsTree = Record<string, DayEvaluations>;

export interface AuditLog {
  action: string;
  adminUid: string;
  adminEmail?: string;
  timestamp: number;
  details: string;
  studentId?: string;
  evaluator?: string;
  day?: string;
  reason?: string;
  before?: string;
  after?: string;
}

export type Scores = Record<CriterionKey, number>;
