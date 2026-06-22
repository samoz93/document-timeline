// Frontend types mirroring domain.ts

export type HazardClass = "LESS_HAZARDOUS" | "HAZARDOUS" | "VERY_HAZARDOUS" | "UNKNOWN";
export type DocumentCategory = "medical" | "safety" | "education" | "template" | "media" | "administrative" | "unknown";
export type DocumentScope = "single_worker" | "worker_list" | "company_level" | "department_level" | "incident_level" | "template" | "media" | "unknown";
export type DatePrecision = "day" | "month" | "year" | "unknown";
export type ExtractionStatus = "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED" | "UNSUPPORTED" | "OCR_PENDING";
export type ReviewStatus = "open" | "in_progress" | "resolved" | "ignored";
export type ReviewSeverity = "low" | "medium" | "high";

export type Company = {
  id: string;
  name: string;
  legal_name: string | null;
  short_name: string | null;
  hazard_class: HazardClass;
  master_folder_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Patient = {
  id: string;
  company_id: string;
  name: string;
  normalized_name: string;
  tckn_masked: string | null;
  tckn_hash: string | null;
  birth_year: number | null;
  department: string | null;
  job_title: string | null;
  first_seen_date: string | null;
  last_seen_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Document = {
  id: string;
  company_id: string;
  patient_id: string | null;
  file_path: string;
  file_name: string;
  file_ext: string | null;
  file_size: number | null;
  category: DocumentCategory;
  document_type: string;
  document_scope: DocumentScope;
  suggested_label: string | null;
  ocr_used: number;
  classification_confidence: number;
  date_confidence: number;
  best_date: string | null;
  best_date_precision: DatePrecision;
  best_date_source: string;
  manual_date: string | null;
  date_mismatch: number;
  date_warnings_json: string | null;
  parsing_status: ExtractionStatus;
  needs_review: number;
  verified_at: string | null;
  created_at: string;
  dateEvidence?: DateEvidence[];
};

export type DateEvidence = {
  source: string;
  date: string;
  precision: DatePrecision;
  rawText: string;
  confidence: number;
};

export type TimelineEvent = {
  id: string;
  company_id: string;
  patient_id: string | null;
  document_id: string;
  event_type: string;
  event_date: string | null;
  event_date_precision: DatePrecision;
  event_date_source: string;
  title: string;
  summary: string | null;
  confidence: number;
  needs_review: number;
  created_at: string;
};

export type ReviewItem = {
  id: string;
  company_id: string;
  document_id: string;
  issue_type: string;
  severity: ReviewSeverity;
  status: ReviewStatus;
  message: string;
  evidence_json: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type WorkerListSnapshot = {
  id: string;
  company_id: string;
  document_id: string;
  snapshot_date: string | null;
  snapshot_date_precision: DatePrecision;
  snapshot_date_source: string;
  list_type: string;
  row_count: number;
  confidence: number;
  needs_review: number;
  created_at: string;
};

export type WorkerListRow = {
  id: string;
  snapshot_id: string;
  worker_name: string | null;
  normalized_worker_name: string | null;
  tckn_masked: string | null;
  department: string | null;
  job_title: string | null;
  employment_status: string | null;
  raw_row_text: string | null;
};

export type WorkspaceStats = {
  totalDocuments: number;
  needsReview: number;
  dateMismatch: number;
  unlinkedWorkerDocs: number;
  workerLists: number;
  timelineEvents: number;
};

export type WorkerSnapshotDiff = {
  joined: WorkerListRow[];
  left: WorkerListRow[];
  departmentChanged: Array<{ worker: WorkerListRow; fromDepartment?: string; toDepartment?: string }>;
  jobTitleChanged: Array<{ worker: WorkerListRow; fromJobTitle?: string; toJobTitle?: string }>;
};
