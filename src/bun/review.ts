import type { Database } from "bun:sqlite";
import type {
  ClassificationResult,
  DocumentTimelineDate,
  ExtractionResult,
  ReviewIssueType,
  ReviewSeverity,
} from "./domain.ts";
import { createReviewItem } from "./db.ts";

export function createReviewItemsForDocument(
  db: Database,
  params: {
    companyId: string;
    documentId: string;
    classification: ClassificationResult;
    dateResult: DocumentTimelineDate;
    extraction: ExtractionResult;
    hasLinkedWorker: boolean;
    isWorkerScopeDoc: boolean;
  }
): void {
  const { companyId, documentId, classification, dateResult, extraction } = params;

  const add = (
    issueType: ReviewIssueType,
    severity: ReviewSeverity,
    message: string,
    evidence?: unknown
  ) => {
    createReviewItem(db, {
      companyId,
      documentId,
      issueType,
      severity,
      message,
      evidence,
    });
  };

  // Extraction failures
  if (extraction.status === "FAILED") {
    add("EXTRACTION_FAILED", "high", "Dosya içeriği okunamadı.", { warnings: extraction.warnings });
  } else if (extraction.status === "OCR_PENDING") {
    add("OCR_PENDING", "medium", "Taranmış PDF veya görsel tespit edildi. OCR bekleniyor.", { warnings: extraction.warnings });
  }

  // Classification issues
  if (classification.documentType === "UNKNOWN") {
    add("UNKNOWN_DOCUMENT_TYPE", "medium", "Belge türü belirlenemedi.");
  } else if (classification.confidence < 0.5) {
    add(
      "LOW_CLASSIFICATION_CONFIDENCE",
      "medium",
      `Sınıflandırma güven skoru düşük: ${(classification.confidence * 100).toFixed(0)}%`,
      { evidence: classification.evidence }
    );
  }

  // Scope uncertain
  if (classification.documentScope === "unknown") {
    add("SCOPE_UNCERTAIN", "medium", "Belge kapsamı (tek çalışan / liste / şirket) belirlenemedi.");
  }

  // Date issues
  if (dateResult.mismatch) {
    add(
      "DATE_MISMATCH",
      "high",
      `Tarih uyuşmazlığı: ${dateResult.warnings.join("; ")}`,
      { warnings: dateResult.warnings }
    );
  } else if (!dateResult.bestDate) {
    add("LOW_DATE_CONFIDENCE", "medium", "Belge için güvenilir tarih bulunamadı.");
  } else if (dateResult.confidence < 0.5) {
    add(
      "LOW_DATE_CONFIDENCE",
      "low",
      `Tarih güven skoru düşük: ${(dateResult.confidence * 100).toFixed(0)}%`
    );
  }

  // Unlinked single-worker document
  if (params.isWorkerScopeDoc && !params.hasLinkedWorker) {
    add(
      "UNLINKED_WORKER_DOCUMENT",
      "medium",
      "Tek çalışan belgesi var fakat ilgili çalışan tespit edilemedi."
    );
  }

  // Worker list needs review
  if (classification.documentScope === "worker_list" && extraction.status !== "SUCCESS") {
    add(
      "WORKER_LIST_EXTRACTION_REVIEW",
      "medium",
      "Çalışan listesi belgesi satır çıkarımı yapılamadı veya yetersiz."
    );
  }
}
