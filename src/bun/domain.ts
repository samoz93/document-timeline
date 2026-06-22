// ─── Core domain types for HealthArch MVP ───────────────────────────────────

export type HazardClass =
  | "LESS_HAZARDOUS"
  | "HAZARDOUS"
  | "VERY_HAZARDOUS"
  | "UNKNOWN";

export type DocumentCategory =
  | "medical"
  | "safety"
  | "education"
  | "template"
  | "media"
  | "administrative"
  | "unknown";

export type DocumentType =
  | "ISE_GIRIS_MUAYENE"
  | "PERIYODIK_MUAYENE"
  | "SAGLIK_RAPORU"
  | "ODIOMETRI"
  | "SFT"
  | "AKCIGER_GRAFISI"
  | "LAB_RESULT"
  | "SEVK_FORMU"
  | "SEVK_YANITI"
  | "ASI_KAYDI"
  | "RISK_DEGERLENDIRMESI"
  | "ORTAM_OLCUM_RAPORU"
  | "RAMAK_KALA"
  | "IS_KAZASI_RAPORU"
  | "EGITIM_DOKUMANI"
  | "EGITIM_KATILIM_LISTESI"
  | "KKD_TESLIM_LISTESI"
  | "EMPLOYEE_ROSTER"
  | "DEPARTMENT_ASSIGNMENT_LIST"
  | "VACCINATION_LIST"
  | "EXAM_TRACKING_LIST"
  | "REFERRAL_TRACKING_LIST"
  | "PPE_DELIVERY_LIST"
  | "TEMPLATE"
  | "MEDIA"
  | "OTHER_MEDICAL"
  | "OTHER_SAFETY"
  | "OTHER_ADMINISTRATIVE"
  | "UNKNOWN";

export type DocumentScope =
  | "single_worker"
  | "worker_list"
  | "company_level"
  | "department_level"
  | "incident_level"
  | "template"
  | "media"
  | "unknown";

export type ClassificationSource =
  | "HEURISTIC"
  | "FOLDER_HINT"
  | "LOCAL_LLM"
  | "MANUAL"
  | "UNKNOWN";

export type ClassificationResult = {
  category: DocumentCategory;
  documentType: DocumentType;
  documentScope: DocumentScope;
  suggestedLabel?: string;
  confidence: number;
  source: ClassificationSource;
  evidence: string[];
  needsReview: boolean;
};

export type DateEvidenceSource =
  | "content"
  | "filename"
  | "folder"
  | "filesystem"
  | "manual";

export type DatePrecision = "day" | "month" | "year" | "unknown";

export type DocumentDateEvidence = {
  source: DateEvidenceSource;
  date: string; // ISO yyyy-mm-dd or yyyy-mm or yyyy
  precision: DatePrecision;
  rawText: string;
  confidence: number;
};

export type DocumentTimelineDate = {
  bestDate?: string | null;
  bestDatePrecision: DatePrecision;
  bestDateSource:
    | "content"
    | "filename"
    | "folder"
    | "filesystem"
    | "manual"
    | "unknown";
  confidence: number;
  mismatch: boolean;
  warnings: string[];
};

export type ExtractionStatus =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILED"
  | "UNSUPPORTED"
  | "OCR_PENDING";

export type ExtractionResult = {
  text: string;
  ocrUsed: boolean;
  languageHint: "tr" | "en" | "mixed" | "unknown";
  warnings: string[];
  status: ExtractionStatus;
};

export type TimelineEventType =
  | "document_indexed"
  | "periodic_exam_found"
  | "entry_exam_found"
  | "test_report_found"
  | "referral_created"
  | "referral_response_found"
  | "worker_list_snapshot"
  | "training_list_snapshot"
  | "ppe_delivery_snapshot"
  | "risk_assessment_found"
  | "measurement_report_found"
  | "incident_report_found"
  | "near_miss_found"
  | "safety_finding_found"
  | "unknown_document_found";

export type ReviewIssueType =
  | "LOW_CLASSIFICATION_CONFIDENCE"
  | "UNKNOWN_DOCUMENT_TYPE"
  | "DATE_MISMATCH"
  | "LOW_DATE_CONFIDENCE"
  | "UNLINKED_WORKER_DOCUMENT"
  | "POSSIBLE_DUPLICATE_WORKER"
  | "OCR_FAILED"
  | "OCR_PENDING"
  | "EXTRACTION_FAILED"
  | "SCOPE_UNCERTAIN"
  | "WORKER_LIST_EXTRACTION_REVIEW";

export type ReviewStatus = "open" | "in_progress" | "resolved" | "ignored";

export type ReviewSeverity = "low" | "medium" | "high";

export type WorkerListType =
  | "employee_roster"
  | "department_assignment"
  | "training_attendance"
  | "vaccination_list"
  | "exam_tracking_list"
  | "referral_tracking_list"
  | "ppe_delivery_list"
  | "unknown";

// ─── DB row shapes ────────────────────────────────────────────────────────────

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
  mime_type: string | null;
  file_size: number | null;
  hash: string;
  category: DocumentCategory;
  document_type: DocumentType;
  document_scope: DocumentScope;
  suggested_label: string | null;
  extracted_text: string | null;
  language_hint: string | null;
  ocr_used: number;
  classification_confidence: number;
  date_confidence: number;
  best_date: string | null;
  best_date_precision: DatePrecision;
  best_date_source: string;
  manual_date: string | null;
  date_mismatch: number;
  date_warnings_json: string | null;
  file_created_at: string | null;
  file_modified_at: string | null;
  compliance_status: string;
  expiry_date: string | null;
  next_review_date: string | null;
  parsing_status: ExtractionStatus;
  parsing_error: string | null;
  needs_review: number;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
  last_indexed_at: string;
};

export type TimelineEvent = {
  id: string;
  company_id: string;
  patient_id: string | null;
  document_id: string;
  event_type: TimelineEventType;
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
  issue_type: ReviewIssueType;
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
  list_type: WorkerListType;
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
  tckn_hash: string | null;
  department: string | null;
  job_title: string | null;
  employment_status: string | null;
  raw_row_text: string | null;
  created_at: string;
};

export type WorkerSnapshotDiff = {
  joined: WorkerListRow[];
  left: WorkerListRow[];
  departmentChanged: Array<{
    worker: WorkerListRow;
    fromDepartment?: string;
    toDepartment?: string;
  }>;
  jobTitleChanged: Array<{
    worker: WorkerListRow;
    fromJobTitle?: string;
    toJobTitle?: string;
  }>;
};

export type IndexingJob = {
  id: string;
  company_id: string | null;
  folder_path: string;
  status: "pending" | "running" | "done" | "failed";
  total_files: number;
  processed_files: number;
  failed_files: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};
