/**
 * HydroOJ CLI 2.x Data Contracts
 */

export interface ListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    httpStatus?: number;
    hint?: string;
  };
}

export interface ProblemOutput {
  id: number;
  displayId: string | null;
  title: string;
  difficulty?: number;
  tag?: string[];
  accepted?: number;
  submission?: number;
  timeLimit?: number;
  memoryLimit?: number;
  content?: string;
  samples?: {
    input: string;
    output: string;
  }[];
}

export interface ContestOutput {
  id: string;
  displayId?: string | null;
  title: string;
  rule: string;
  status: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  problemIds?: number[];
}

export interface HomeworkOutput {
  id: string;
  displayId?: string | null;
  title: string;
  rule: string;
  status: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  problemIds?: number[];
}

export interface SubmissionOutput {
  id: string;
  problemId: number;
  displayProblemId?: string;
  status: string;
  score?: number;
  time?: number;
  memory?: number;
  language?: string;
  submitAt?: string;
}
