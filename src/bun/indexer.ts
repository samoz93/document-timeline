import { readdirSync, statSync, existsSync } from "fs";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { Database } from "bun:sqlite";

import type { WorkerListType } from "./domain.ts";
import {
  upsertDocument,
  upsertPatient,
  insertDateEvidence,
  syncDocumentFts,
  isDuplicateHash,
  createIndexingJob,
  updateIndexingJob,
  insertWorkerListSnapshot,
  insertWorkerListRows,
  normalizeName,
} from "./db.ts";
import { extractFile, extractWorkerRowsFromText, maskTckn, hashTckn, extToMime } from "./extractors.ts";
import {
  extractDatesFromContent,
  extractDatesFromFilename,
  extractDatesFromFolderPath,
  buildFilesystemDateEvidence,
  chooseBestDate,
} from "./dates.ts";
import { classifyDocument } from "./classifier.ts";
import {
  disabledLocalLlmClassifier,
  makeOllamaClassifier,
  classifyWithFallback,
  type LocalLlmClassifier,
} from "./llm-classifier.ts";
import { createTimelineEventForDocument } from "./timeline.ts";
import { createReviewItemsForDocument } from "./review.ts";

// Select LLM backend from environment — disabled unless explicitly set
function resolveLlmClassifier(): LocalLlmClassifier {
  const backend = process.env["HEALTHARCH_LLM"];
  if (backend === "ollama") {
    return makeOllamaClassifier({
      baseUrl: process.env["HEALTHARCH_OLLAMA_URL"],
      model: process.env["HEALTHARCH_OLLAMA_MODEL"],
    });
  }
  return disabledLocalLlmClassifier;
}

const llmClassifier = resolveLlmClassifier();

export type IndexingJobResult = {
  jobId: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
};

const SUPPORTED_EXTS = new Set([
  ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".csv",
  ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
  ".mp4", ".mov", ".avi", ".zip",
]);

export function scanFolderRecursive(folderPath: string): string[] {
  if (!existsSync(folderPath)) return [];
  const results: string[] = [];

  function walk(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTS.has(ext)) {
            results.push(full);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(folderPath);
  return results;
}

export async function computeFileHash(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function workerListTypeFromDocType(docType: string): WorkerListType {
  switch (docType) {
    case "EMPLOYEE_ROSTER": return "employee_roster";
    case "DEPARTMENT_ASSIGNMENT_LIST": return "department_assignment";
    case "EGITIM_KATILIM_LISTESI": return "training_attendance";
    case "VACCINATION_LIST": return "vaccination_list";
    case "EXAM_TRACKING_LIST": return "exam_tracking_list";
    case "REFERRAL_TRACKING_LIST": return "referral_tracking_list";
    case "KKD_TESLIM_LISTESI":
    case "PPE_DELIVERY_LIST": return "ppe_delivery_list";
    default: return "unknown";
  }
}

export async function indexFile(
  db: Database,
  companyId: string,
  filePath: string
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const mime = extToMime(ext);

  // File stats
  let stats: ReturnType<typeof statSync> | null = null;
  try {
    stats = statSync(filePath);
  } catch {
    return;
  }

  // Compute hash and check for duplicate
  const hash = await computeFileHash(filePath);
  if (isDuplicateHash(db, hash)) return;

  // Extract text
  const extraction = await extractFile(filePath);

  // Date evidence from all sources
  const fsEvidence = buildFilesystemDateEvidence(
    stats.birthtime ?? null,
    stats.mtime ?? null
  );
  const fnEvidence = extractDatesFromFilename(fileName);
  const folderEvidence = extractDatesFromFolderPath(filePath);
  const contentEvidence = extractDatesFromContent(extraction.text);

  const allEvidence = [...contentEvidence, ...fnEvidence, ...folderEvidence, ...fsEvidence];
  const dateResult = chooseBestDate(allEvidence);

  // Classify — heuristic first, optional local LLM fallback for low-confidence docs
  const heuristicResult = classifyDocument({
    fileName,
    filePath,
    fileExt: ext,
    extractedText: extraction.text,
    ocrUsed: extraction.ocrUsed,
  });

  const classification = await classifyWithFallback(
    heuristicResult,
    {
      fileName,
      folderPath: filePath,
      extractedTextSnippet: extraction.text.slice(0, 800),
      heuristicResult,
      dateEvidence: allEvidence,
    },
    llmClassifier
  );

  // Try to find/create worker if single_worker scope
  let patientId: string | null = null;
  let patientName: string | undefined;

  if (classification.documentScope === "single_worker" && extraction.text) {
    const workerRows = extractWorkerRowsFromText(extraction.text);
    const firstRow = workerRows[0];

    if (firstRow && (firstRow.workerName || firstRow.tcknRaw)) {
      const name = firstRow.workerName ?? "Bilinmeyen Çalışan";
      const tckn = firstRow.tcknRaw;
      const patient = upsertPatient(db, {
        company_id: companyId,
        name,
        normalized_name: normalizeName(name),
        tckn_masked: tckn ? maskTckn(tckn) : null,
        tckn_hash: tckn ? hashTckn(tckn) : null,
        birth_year: null,
        department: firstRow.department ?? null,
        job_title: firstRow.jobTitle ?? null,
        first_seen_date: dateResult.bestDate ?? null,
        last_seen_date: dateResult.bestDate ?? null,
      });
      patientId = patient.id;
      patientName = patient.name;
    }
  }

  const documentId = uuidv4();
  const needsReview =
    classification.needsReview ||
    dateResult.mismatch ||
    extraction.status === "FAILED" ||
    extraction.status === "OCR_PENDING" ||
    (classification.documentScope === "single_worker" && !patientId);

  // Upsert document
  upsertDocument(db, {
    id: documentId,
    company_id: companyId,
    patient_id: patientId,
    file_path: filePath,
    file_name: fileName,
    file_ext: ext,
    mime_type: mime,
    file_size: stats.size,
    hash,
    category: classification.category,
    document_type: classification.documentType,
    document_scope: classification.documentScope,
    suggested_label: classification.suggestedLabel ?? null,
    extracted_text: extraction.text.slice(0, 100000),
    language_hint: extraction.languageHint,
    ocr_used: extraction.ocrUsed ? 1 : 0,
    classification_confidence: classification.confidence,
    date_confidence: dateResult.confidence,
    best_date: dateResult.bestDate ?? null,
    best_date_precision: dateResult.bestDatePrecision,
    best_date_source: dateResult.bestDateSource,
    manual_date: null,
    date_mismatch: dateResult.mismatch ? 1 : 0,
    date_warnings_json: dateResult.warnings.length > 0 ? JSON.stringify(dateResult.warnings) : null,
    file_created_at: stats.birthtime?.toISOString() ?? null,
    file_modified_at: stats.mtime?.toISOString() ?? null,
    compliance_status: "not_evaluated",
    expiry_date: null,
    next_review_date: null,
    parsing_status: extraction.status,
    parsing_error: extraction.warnings.join("; ") || null,
    needs_review: needsReview ? 1 : 0,
    verified_at: null,
    verified_by: null,
    last_indexed_at: new Date().toISOString(),
  });

  // Insert date evidence
  insertDateEvidence(db, documentId, allEvidence);

  // Sync FTS
  syncDocumentFts(db, documentId);

  // Create timeline event
  createTimelineEventForDocument(db, {
    companyId,
    documentId,
    documentType: classification.documentType,
    patientId,
    patientName,
    eventDate: dateResult.bestDate ?? null,
    eventDatePrecision: dateResult.bestDatePrecision,
    eventDateSource: dateResult.bestDateSource,
    confidence: Math.min(classification.confidence, dateResult.confidence + 0.1),
    needsReview,
    fileName,
  });

  // Create review items
  createReviewItemsForDocument(db, {
    companyId,
    documentId,
    classification,
    dateResult,
    extraction,
    hasLinkedWorker: !!patientId,
    isWorkerScopeDoc: classification.documentScope === "single_worker",
  });

  // Worker list snapshot
  if (classification.documentScope === "worker_list" && extraction.text) {
    const rows = extractWorkerRowsFromText(extraction.text);
    const snapshotId = uuidv4();
    const listType = workerListTypeFromDocType(classification.documentType);

    insertWorkerListSnapshot(db, {
      id: snapshotId,
      company_id: companyId,
      document_id: documentId,
      snapshot_date: dateResult.bestDate ?? null,
      snapshot_date_precision: dateResult.bestDatePrecision,
      snapshot_date_source: dateResult.bestDateSource,
      list_type: listType,
      row_count: rows.length,
      confidence: classification.confidence,
      needs_review: rows.length === 0 ? 1 : 0,
    });

    if (rows.length > 0) {
      insertWorkerListRows(
        db,
        rows.map((r) => ({
          id: uuidv4(),
          snapshot_id: snapshotId,
          worker_name: r.workerName,
          normalized_worker_name: r.workerName ? normalizeName(r.workerName) : null,
          tckn_masked: r.tcknRaw ? maskTckn(r.tcknRaw) : null,
          tckn_hash: r.tcknRaw ? hashTckn(r.tcknRaw) : null,
          department: r.department,
          job_title: r.jobTitle,
          employment_status: r.employmentStatus,
          raw_row_text: r.rawRowText,
        }))
      );
    }
  }
}

export async function scanCompanyFolder(
  db: Database,
  companyId: string,
  folderPath: string
): Promise<IndexingJobResult> {
  const job = createIndexingJob(db, companyId, folderPath);
  const files = scanFolderRecursive(folderPath);

  updateIndexingJob(db, job.id, {
    total_files: files.length,
    started_at: new Date().toISOString(),
  });

  let processed = 0;
  let failed = 0;

  for (const filePath of files) {
    try {
      await indexFile(db, companyId, filePath);
      processed++;
    } catch (e) {
      console.error(`[indexer] failed: ${filePath}`, e);
      failed++;
    }

    // Update progress every 10 files
    if ((processed + failed) % 10 === 0) {
      updateIndexingJob(db, job.id, {
        processed_files: processed,
        failed_files: failed,
      });
    }
  }

  updateIndexingJob(db, job.id, {
    status: "done",
    processed_files: processed,
    failed_files: failed,
    finished_at: new Date().toISOString(),
  });

  return { jobId: job.id, totalFiles: files.length, processedFiles: processed, failedFiles: failed };
}
