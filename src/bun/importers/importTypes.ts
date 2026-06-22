import type { DocumentCategory, DocumentScope, DocumentType, WorkerListType } from "../domain.ts";

// ─── Generic import preview shell ─────────────────────────────────────────────

export type ImportType =
  | "company_registry"
  | "archive_folder"
  | "worker_list"
  | "classification_seed"
  | "template_library"
  | "verified_corrections";

export type ImportStatus = "ready" | "needs_mapping" | "has_errors";

export type ImportPreview<T> = {
  importType: ImportType;
  sourcePath: string;
  status: ImportStatus;
  summary: {
    totalRows?: number;
    totalFiles?: number;
    supportedFiles?: number;
    unsupportedFiles?: number;
    needsReviewCount?: number;
    detectedYearRange?: { from?: string; to?: string };
  };
  rows: T[];
  warnings: string[];
  errors: string[];
};

// ─── Company registry ─────────────────────────────────────────────────────────

export type CompanyRegistryRow = {
  rowIndex: number;
  sgk_registration_no: string | null;
  name: string | null;
  legal_name: string | null;
  short_name: string | null;
  hazard_class: string | null;
  nace_code: string | null;
  address: string | null;
  employer_representative: string | null;
  osgb_responsible_person: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  notes: string | null;
  // resolved status
  matchStatus: "new" | "matched_sgk" | "missing_sgk" | "needs_review";
  existingCompanyId: string | null;
};

export type CompanyColumnMapping = {
  sgk_registration_no?: string;
  name?: string;
  legal_name?: string;
  short_name?: string;
  hazard_class?: string;
  nace_code?: string;
  address?: string;
  employer_representative?: string;
  osgb_responsible_person?: string;
  contract_start_date?: string;
  contract_end_date?: string;
  notes?: string;
};

// ─── Archive folder ───────────────────────────────────────────────────────────

export type ArchiveFolderMode = "single_company" | "multi_company_root";

export type ArchiveFolderSubfolder = {
  folderPath: string;
  folderName: string;
  matchedCompanyId: string | null;
  matchedCompanyName: string | null;
  matchMethod: "sgk_in_name" | "exact_short_name" | "fuzzy_name" | "manual" | "unmatched";
  fileCount: number;
  supportedFileCount: number;
  unsupportedFileCount: number;
  estimatedOcrCount: number;
  detectedYearRange: { from?: string; to?: string };
};

export type ArchiveFolderPreviewRow = {
  filePath: string;
  fileName: string;
  ext: string;
  sizeBytes: number;
  likelyScanned: boolean;
  detectedYear: string | null;
};

// ─── Worker list ──────────────────────────────────────────────────────────────

export type WorkerListPreviewRow = {
  rowIndex: number;
  workerName: string | null;
  tcknMasked: string | null;
  tcknHash: string | null;
  tcknRaw: string | null; // only held in memory during preview, never persisted
  department: string | null;
  jobTitle: string | null;
  employmentStatus: string | null;
  rawRowText: string;
  issues: string[];
};

export type WorkerListColumnMapping = {
  workerName?: string;
  tckn?: string;
  department?: string;
  jobTitle?: string;
  employmentStatus?: string;
};

// ─── Classification seed ──────────────────────────────────────────────────────

export type ClassificationSeedRow = {
  rowIndex: number;
  document_type: DocumentType | null;
  category: DocumentCategory | null;
  document_scope: DocumentScope | null;
  keywords: string[];
  negative_keywords: string[];
  filename_hints: string[];
  folder_hints: string[];
  confidence_boost: number;
  notes: string | null;
  valid: boolean;
  issues: string[];
};

// ─── Template fingerprint ─────────────────────────────────────────────────────

export type TemplateFingerprintRow = {
  filePath: string;
  fileName: string;
  textHash: string;
  fieldLabels: string[];
  detectedDocumentType: DocumentType | null;
  category: DocumentCategory | null;
  fileNamePattern: string;
};

// ─── Verified corrections ─────────────────────────────────────────────────────

export type VerifiedCorrectionRow = {
  rowIndex: number;
  fileHash: string | null;
  fileName: string | null;
  documentType: DocumentType | null;
  documentScope: DocumentScope | null;
  manualDate: string | null;
  workerLink: string | null;
  verifiedStatus: boolean;
  matchStatus: "hash_match" | "name_match" | "unmatched";
  existingDocumentId: string | null;
};

// ─── Import job (DB row) ──────────────────────────────────────────────────────

export type ImportJob = {
  id: string;
  import_type: ImportType;
  source_path: string;
  company_id: string | null;
  status: "running" | "done" | "failed";
  summary_json: string | null;
  warnings_json: string | null;
  errors_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};
