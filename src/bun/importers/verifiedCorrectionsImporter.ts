import type { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { DocumentType, DocumentScope } from "../domain.ts";
import type { ImportPreview, VerifiedCorrectionRow } from "./importTypes.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_DOC_TYPES = new Set<string>([
  "ISE_GIRIS_MUAYENE","PERIYODIK_MUAYENE","SAGLIK_RAPORU","ODIOMETRI","SFT",
  "AKCIGER_GRAFISI","LAB_RESULT","SEVK_FORMU","SEVK_YANITI","ASI_KAYDI",
  "RISK_DEGERLENDIRMESI","ORTAM_OLCUM_RAPORU","RAMAK_KALA","IS_KAZASI_RAPORU",
  "EGITIM_DOKUMANI","EGITIM_KATILIM_LISTESI","KKD_TESLIM_LISTESI",
  "EMPLOYEE_ROSTER","DEPARTMENT_ASSIGNMENT_LIST","VACCINATION_LIST",
  "EXAM_TRACKING_LIST","REFERRAL_TRACKING_LIST","PPE_DELIVERY_LIST",
  "TEMPLATE","MEDIA","OTHER_MEDICAL","OTHER_SAFETY","OTHER_ADMINISTRATIVE","UNKNOWN",
]);

const VALID_SCOPES = new Set<string>([
  "single_worker","worker_list","company_level","department_level",
  "incident_level","template","media","unknown",
]);

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim()
    .replace(/İ/g, "i").replace(/I/g, "ı")
    .replace(/Ğ/g, "ğ").replace(/Ş/g, "ş")
    .replace(/Ü/g, "ü").replace(/Ö/g, "ö").replace(/Ç/g, "ç");
}

function findCol(headers: string[], aliases: string[]): string | null {
  const norm = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = norm.findIndex((h) => h.includes(alias));
    if (idx !== -1) return headers[idx]!;
  }
  return null;
}

const COLUMN_ALIASES = {
  fileHash:      ["file_hash", "sha256", "hash", "dosya hash"],
  fileName:      ["file_name", "dosya adı", "dosya adi", "filename"],
  documentType:  ["document_type", "belge tipi", "tip", "doc type"],
  documentScope: ["document_scope", "kapsam", "scope"],
  manualDate:    ["manual_date", "tarih", "date", "belge tarihi"],
  workerLink:    ["worker_name", "tckn", "calisan", "çalışan", "worker"],
};

// ─── Resolve match against existing documents ─────────────────────────────────

function resolveMatch(
  db: Database,
  fileHash: string | null,
  fileName: string | null
): { matchStatus: VerifiedCorrectionRow["matchStatus"]; existingDocumentId: string | null } {
  if (fileHash) {
    const row = db.prepare("SELECT id FROM documents WHERE file_hash = ? LIMIT 1").get(fileHash) as { id: string } | undefined;
    if (row) return { matchStatus: "hash_match", existingDocumentId: row.id };
  }
  if (fileName) {
    const row = db.prepare("SELECT id FROM documents WHERE file_name = ? LIMIT 1").get(fileName) as { id: string } | undefined;
    if (row) return { matchStatus: "name_match", existingDocumentId: row.id };
  }
  return { matchStatus: "unmatched", existingDocumentId: null };
}

// ─── Parse spreadsheet ────────────────────────────────────────────────────────

async function parseSpreadsheet(filePath: string): Promise<Record<string, string>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
}

async function parseJson(filePath: string): Promise<unknown[]> {
  const text = await Bun.file(filePath).text();
  return JSON.parse(text);
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewVerifiedCorrectionsImport(
  db: Database,
  filePath: string
): Promise<ImportPreview<VerifiedCorrectionRow>> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let rawRows: Array<{ fileHash: string | null; fileName: string | null; documentType: string | null; documentScope: string | null; manualDate: string | null; workerLink: string | null }> = [];

  try {
    const ext = filePath.split(".").pop()?.toLowerCase();

    if (ext === "json") {
      const data = await parseJson(filePath) as Record<string, unknown>[];
      rawRows = data.map((item) => ({
        fileHash: (item["file_hash"] as string) ?? null,
        fileName: (item["file_name"] as string) ?? null,
        documentType: (item["document_type"] as string) ?? null,
        documentScope: (item["document_scope"] as string) ?? null,
        manualDate: (item["manual_date"] as string) ?? null,
        workerLink: ((item["worker_name"] ?? item["tckn"] ?? item["worker_link"]) as string | null) ?? null,
      }));
    } else {
      const spreadsheetRows = await parseSpreadsheet(filePath);
      if (spreadsheetRows.length === 0) {
        warnings.push("No rows found.");
      } else {
        const headers = Object.keys(spreadsheetRows[0]!);
        const colMap = {
          fileHash:      findCol(headers, COLUMN_ALIASES.fileHash),
          fileName:      findCol(headers, COLUMN_ALIASES.fileName),
          documentType:  findCol(headers, COLUMN_ALIASES.documentType),
          documentScope: findCol(headers, COLUMN_ALIASES.documentScope),
          manualDate:    findCol(headers, COLUMN_ALIASES.manualDate),
          workerLink:    findCol(headers, COLUMN_ALIASES.workerLink),
        };
        rawRows = spreadsheetRows.map((r) => ({
          fileHash:      colMap.fileHash ? (r[colMap.fileHash]?.trim() || null) : null,
          fileName:      colMap.fileName ? (r[colMap.fileName]?.trim() || null) : null,
          documentType:  colMap.documentType ? (r[colMap.documentType]?.trim() || null) : null,
          documentScope: colMap.documentScope ? (r[colMap.documentScope]?.trim() || null) : null,
          manualDate:    colMap.manualDate ? (r[colMap.manualDate]?.trim() || null) : null,
          workerLink:    colMap.workerLink ? (r[colMap.workerLink]?.trim() || null) : null,
        }));
      }
    }
  } catch (e) {
    errors.push(String(e));
    return {
      importType: "verified_corrections",
      sourcePath: filePath,
      status: "has_errors",
      summary: { totalRows: 0 },
      rows: [],
      warnings,
      errors,
    };
  }

  const rows: VerifiedCorrectionRow[] = rawRows.map((raw, i) => {
    const docType = raw.documentType?.toUpperCase() as DocumentType | null;
    const docScope = raw.documentScope?.toLowerCase() as DocumentScope | null;
    const validType = docType && VALID_DOC_TYPES.has(docType) ? docType : null;
    const validScope = docScope && VALID_SCOPES.has(docScope) ? docScope : null;
    const { matchStatus, existingDocumentId } = resolveMatch(db, raw.fileHash, raw.fileName);

    return {
      rowIndex: i,
      fileHash: raw.fileHash,
      fileName: raw.fileName,
      documentType: validType,
      documentScope: validScope,
      manualDate: raw.manualDate,
      workerLink: raw.workerLink,
      verifiedStatus: true,
      matchStatus,
      existingDocumentId,
    };
  });

  const unmatchedCount = rows.filter((r) => r.matchStatus === "unmatched").length;
  if (unmatchedCount > 0) {
    warnings.push(`${unmatchedCount} row(s) could not be matched to existing documents and will be skipped.`);
  }

  return {
    importType: "verified_corrections",
    sourcePath: filePath,
    status: errors.length > 0 ? "has_errors" : "ready",
    summary: { totalRows: rows.length, needsReviewCount: unmatchedCount },
    rows,
    warnings,
    errors,
  };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export type ConfirmVerifiedCorrectionsInput = {
  rows: VerifiedCorrectionRow[];
};

export function confirmVerifiedCorrectionsImport(
  db: Database,
  input: ConfirmVerifiedCorrectionsInput
): { applied: number; skipped: number } {
  let applied = 0, skipped = 0;

  for (const row of input.rows) {
    if (row.matchStatus === "unmatched" || !row.existingDocumentId) { skipped++; continue; }

    try {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (row.documentType) { fields.push("document_type = ?"); values.push(row.documentType); }
      if (row.documentScope) { fields.push("document_scope = ?"); values.push(row.documentScope); }
      if (row.manualDate) { fields.push("manual_date = ?", "date_source = 'manual'"); values.push(row.manualDate); }
      if (row.verifiedStatus) { fields.push("verified = 1", "classification_source = 'MANUAL'"); }

      if (fields.length === 0) { skipped++; continue; }

      values.push(row.existingDocumentId);
      db.prepare(`UPDATE documents SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      applied++;
    } catch {
      skipped++;
    }
  }

  return { applied, skipped };
}
