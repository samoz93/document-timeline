import type { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { DocumentCategory, DocumentScope, DocumentType } from "../domain.ts";
import type { ClassificationSeedRow, ImportPreview } from "./importTypes.ts";

// ─── Valid enum sets for validation ──────────────────────────────────────────

const VALID_DOC_TYPES = new Set<string>([
  "ISE_GIRIS_MUAYENE","PERIYODIK_MUAYENE","SAGLIK_RAPORU","ODIOMETRI","SFT",
  "AKCIGER_GRAFISI","LAB_RESULT","SEVK_FORMU","SEVK_YANITI","ASI_KAYDI",
  "RISK_DEGERLENDIRMESI","ORTAM_OLCUM_RAPORU","RAMAK_KALA","IS_KAZASI_RAPORU",
  "EGITIM_DOKUMANI","EGITIM_KATILIM_LISTESI","KKD_TESLIM_LISTESI",
  "EMPLOYEE_ROSTER","DEPARTMENT_ASSIGNMENT_LIST","VACCINATION_LIST",
  "EXAM_TRACKING_LIST","REFERRAL_TRACKING_LIST","PPE_DELIVERY_LIST",
  "TEMPLATE","MEDIA","OTHER_MEDICAL","OTHER_SAFETY","OTHER_ADMINISTRATIVE","UNKNOWN",
]);

const VALID_CATEGORIES = new Set<string>(["medical","safety","education","template","media","administrative","unknown"]);
const VALID_SCOPES = new Set<string>(["single_worker","worker_list","company_level","department_level","incident_level","template","media","unknown"]);

function splitList(val: string | null | undefined): string[] {
  if (!val) return [];
  return val.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
}

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

// ─── Parse from xlsx/csv ──────────────────────────────────────────────────────

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

function mapRow(row: Record<string, string>, colMap: Record<string, string | null>): ClassificationSeedRow {
  const get = (field: string) => colMap[field] ? (row[colMap[field]!]?.trim() ?? "") : "";

  const docType = get("document_type").toUpperCase() as DocumentType;
  const category = get("category").toLowerCase() as DocumentCategory;
  const scope = get("document_scope").toLowerCase() as DocumentScope;

  const issues: string[] = [];
  if (!VALID_DOC_TYPES.has(docType)) issues.push(`Unknown document_type: ${docType}`);
  if (!VALID_CATEGORIES.has(category)) issues.push(`Unknown category: ${category}`);
  if (!VALID_SCOPES.has(scope)) issues.push(`Unknown document_scope: ${scope}`);

  return {
    rowIndex: 0,
    document_type: VALID_DOC_TYPES.has(docType) ? docType : null,
    category: VALID_CATEGORIES.has(category) ? category : null,
    document_scope: VALID_SCOPES.has(scope) ? scope : null,
    keywords: splitList(get("keywords")),
    negative_keywords: splitList(get("negative_keywords")),
    filename_hints: splitList(get("filename_hints")),
    folder_hints: splitList(get("folder_hints")),
    confidence_boost: parseFloat(get("confidence_boost")) || 0,
    notes: get("notes") || null,
    valid: issues.length === 0,
    issues,
  };
}

export async function previewClassificationSeedImport(
  filePath: string
): Promise<ImportPreview<ClassificationSeedRow>> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const ext = filePath.split(".").pop()?.toLowerCase();
  let rawRows: ClassificationSeedRow[] = [];

  try {
    if (ext === "json") {
      const data = await parseJson(filePath);
      rawRows = (data as Record<string, unknown>[]).map((item, i) => {
        const row: ClassificationSeedRow = {
          rowIndex: i,
          document_type: (item["document_type"] as DocumentType) ?? null,
          category: (item["category"] as DocumentCategory) ?? null,
          document_scope: (item["document_scope"] as DocumentScope) ?? null,
          keywords: Array.isArray(item["keywords"]) ? item["keywords"] as string[] : splitList(item["keywords"] as string),
          negative_keywords: Array.isArray(item["negative_keywords"]) ? item["negative_keywords"] as string[] : splitList(item["negative_keywords"] as string),
          filename_hints: Array.isArray(item["filename_hints"]) ? item["filename_hints"] as string[] : splitList(item["filename_hints"] as string),
          folder_hints: Array.isArray(item["folder_hints"]) ? item["folder_hints"] as string[] : splitList(item["folder_hints"] as string),
          confidence_boost: Number(item["confidence_boost"] ?? 0),
          notes: (item["notes"] as string) ?? null,
          valid: true,
          issues: [],
        };
        if (row.document_type && !VALID_DOC_TYPES.has(row.document_type)) {
          row.issues.push(`Unknown document_type: ${row.document_type}`);
          row.valid = false;
        }
        return row;
      });
    } else {
      const spreadsheetRows = await parseSpreadsheet(filePath);
      if (spreadsheetRows.length === 0) { warnings.push("No rows found."); }
      else {
        const headers = Object.keys(spreadsheetRows[0]!);
        const colMap: Record<string, string | null> = {
          document_type:    findCol(headers, ["document_type", "belge tipi", "tip"]),
          category:         findCol(headers, ["category", "kategori"]),
          document_scope:   findCol(headers, ["document_scope", "kapsam", "scope"]),
          keywords:         findCol(headers, ["keywords", "anahtar kelimeler", "kelimeler"]),
          negative_keywords:findCol(headers, ["negative_keywords", "olumsuz kelimeler"]),
          filename_hints:   findCol(headers, ["filename_hints", "dosya adi ipucu"]),
          folder_hints:     findCol(headers, ["folder_hints", "klasor ipucu"]),
          confidence_boost: findCol(headers, ["confidence_boost", "guven artisi"]),
          notes:            findCol(headers, ["notes", "notlar"]),
        };
        rawRows = spreadsheetRows.map((r, i) => ({ ...mapRow(r, colMap), rowIndex: i }));
      }
    }
  } catch (e) {
    errors.push(String(e));
  }

  const invalidCount = rawRows.filter((r) => !r.valid).length;
  if (invalidCount > 0) warnings.push(`${invalidCount} row(s) have validation errors and will be skipped on import.`);

  return {
    importType: "classification_seed",
    sourcePath: filePath,
    status: errors.length > 0 ? "has_errors" : "ready",
    summary: { totalRows: rawRows.length, needsReviewCount: invalidCount },
    rows: rawRows,
    warnings,
    errors,
  };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export function confirmClassificationSeedImport(
  db: Database,
  rows: ClassificationSeedRow[]
): { imported: number; skipped: number } {
  const now = new Date().toISOString();
  let imported = 0, skipped = 0;
  const stmt = db.prepare(`
    INSERT INTO classification_rules
      (id, document_type, category, document_scope, keywords_json, negative_keywords_json,
       filename_hints_json, folder_hints_json, confidence_boost, source, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,'user',?,?)
  `);
  for (const row of rows) {
    if (!row.valid || !row.document_type || !row.category || !row.document_scope) { skipped++; continue; }
    try {
      stmt.run(
        uuidv4(), row.document_type, row.category, row.document_scope,
        JSON.stringify(row.keywords), JSON.stringify(row.negative_keywords),
        JSON.stringify(row.filename_hints), JSON.stringify(row.folder_hints),
        row.confidence_boost, row.notes ?? null, now
      );
      imported++;
    } catch { skipped++; }
  }
  return { imported, skipped };
}
