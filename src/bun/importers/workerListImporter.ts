import type { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import type { WorkerListType } from "../domain.ts";
import type {
  ImportPreview,
  WorkerListColumnMapping,
  WorkerListPreviewRow,
} from "./importTypes.ts";
import { normalizeName } from "../db.ts";
import { extractDatesFromFilename, extractDatesFromFolderPath, chooseBestDate } from "../dates.ts";

// ─── List type detection ──────────────────────────────────────────────────────

const LIST_TYPE_HINTS: Array<{ type: WorkerListType; keywords: string[] }> = [
  { type: "employee_roster",       keywords: ["personel", "calisan listesi", "çalışan listesi", "roster", "employee"] },
  { type: "department_assignment", keywords: ["departman", "gorev listesi", "görev listesi", "assignment"] },
  { type: "training_attendance",   keywords: ["egitim", "eğitim", "katilim", "katılım", "training", "attendance"] },
  { type: "vaccination_list",      keywords: ["asi listesi", "aşı listesi", "vaccination", "immunization"] },
  { type: "exam_tracking_list",    keywords: ["muayene takip", "exam tracking", "periyodik liste"] },
  { type: "referral_tracking_list",keywords: ["sevk takip", "referral tracking"] },
  { type: "ppe_delivery_list",     keywords: ["kkd", "kişisel koruyucu", "ppe", "delivery list", "teslim"] },
];

export function detectWorkerListType(hint: string): WorkerListType {
  const norm = hint.toLowerCase()
    .replace(/İ/g, "i").replace(/I/g, "ı").replace(/Ş/g, "ş")
    .replace(/Ü/g, "ü").replace(/Ö/g, "ö").replace(/Ç/g, "ç");
  for (const { type, keywords } of LIST_TYPE_HINTS) {
    if (keywords.some((k) => norm.includes(k))) return type;
  }
  return "unknown";
}

// ─── Column alias detection ───────────────────────────────────────────────────

const WORKER_COLUMN_ALIASES: Record<keyof WorkerListColumnMapping, string[]> = {
  workerName: ["ad soyad", "adı soyadı", "adi soyadi", "isim", "name", "worker name", "calisan", "çalışan"],
  tckn:       ["tckn", "tc kimlik", "t.c. kimlik", "tc no", "kimlik no", "11 haneli"],
  department: ["departman", "bolum", "bölüm", "department", "birim"],
  jobTitle:   ["gorevi", "görevi", "unvan", "job title", "pozisyon", "meslek"],
  employmentStatus: ["durum", "status", "calışma durumu", "çalışma durumu", "aktif"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim()
    .replace(/İ/g, "i").replace(/I/g, "ı").replace(/Ğ/g, "ğ")
    .replace(/Ş/g, "ş").replace(/Ü/g, "ü").replace(/Ö/g, "ö").replace(/Ç/g, "ç");
}

export function detectWorkerListColumnMapping(headers: string[]): WorkerListColumnMapping {
  const mapping: WorkerListColumnMapping = {};
  const normHeaders = headers.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(WORKER_COLUMN_ALIASES) as [keyof WorkerListColumnMapping, string[]][]) {
    for (const alias of aliases) {
      const idx = normHeaders.findIndex((h) => h.includes(alias));
      if (idx !== -1 && headers[idx]) { mapping[field] = headers[idx]; break; }
    }
  }
  return mapping;
}

// ─── TCKN helpers ─────────────────────────────────────────────────────────────

function maskTckn(tckn: string): string {
  return tckn.length === 11 ? "*******" + tckn.slice(7) : tckn;
}
function hashTckn(tckn: string): string {
  return createHash("sha256").update(tckn).digest("hex");
}
function validateTckn(raw: string): boolean {
  return /^\d{11}$/.test(raw.trim());
}

// ─── Parse rows ───────────────────────────────────────────────────────────────

function get(row: Record<string, string>, mapping: WorkerListColumnMapping, field: keyof WorkerListColumnMapping): string | null {
  const col = mapping[field];
  if (!col) return null;
  const val = row[col]?.trim();
  return val && val.length > 0 ? val : null;
}

export function parseWorkerListRows(
  rawRows: Record<string, string>[],
  mapping: WorkerListColumnMapping
): WorkerListPreviewRow[] {
  return rawRows.map((row, i) => {
    const tcknRaw = get(row, mapping, "tckn")?.replace(/\s/g, "") ?? null;
    const issues: string[] = [];
    let tcknMasked: string | null = null;
    let tcknHash: string | null = null;

    if (tcknRaw) {
      if (!validateTckn(tcknRaw)) {
        issues.push(`Invalid TCKN format: ${tcknRaw}`);
      } else {
        tcknMasked = maskTckn(tcknRaw);
        tcknHash = hashTckn(tcknRaw);
      }
    }

    const name = get(row, mapping, "workerName");
    if (!name && !tcknRaw) issues.push("No name or TCKN detected");

    return {
      rowIndex: i,
      workerName: name,
      tcknMasked,
      tcknHash,
      tcknRaw, // kept only for preview; not written to DB
      department: get(row, mapping, "department"),
      jobTitle: get(row, mapping, "jobTitle"),
      employmentStatus: get(row, mapping, "employmentStatus"),
      rawRowText: Object.values(row).join(" | "),
      issues,
    };
  });
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewWorkerListImport(
  _db: Database,
  params: {
    filePath: string;
    companyId: string;
    listTypeHint?: WorkerListType;
  }
): Promise<ImportPreview<WorkerListPreviewRow> & {
  detectedListType: WorkerListType;
  detectedSnapshotDate: string | null;
  mapping: WorkerListColumnMapping;
  detectedHeaders: string[];
}> {
  const XLSX = await import("xlsx");
  const warnings: string[] = [];
  const errors: string[] = [];

  let rawRows: Record<string, string>[] = [];
  let headers: string[] = [];

  try {
    const wb = XLSX.readFile(params.filePath);
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("No sheets found");
    const ws = wb.Sheets[sheetName]!;
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    if (jsonRows.length > 0) headers = Object.keys(jsonRows[0]!);
    rawRows = jsonRows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))
    );
  } catch (e) {
    errors.push(`Failed to parse file: ${String(e)}`);
    return {
      importType: "worker_list", sourcePath: params.filePath, status: "has_errors",
      summary: { totalRows: 0 }, rows: [], warnings, errors,
      detectedListType: "unknown", detectedSnapshotDate: null, mapping: {}, detectedHeaders: [],
    };
  }

  const mapping = detectWorkerListColumnMapping(headers);
  if (!mapping.workerName) warnings.push("Worker name column not detected.");
  if (!mapping.tckn) warnings.push("TCKN column not detected — rows will be matched by name only.");

  const rows = parseWorkerListRows(rawRows, mapping);
  const withIssues = rows.filter((r) => r.issues.length > 0).length;

  const fileName = params.filePath.split(/[/\\]/).pop() ?? "";
  const listType = params.listTypeHint ??
    detectWorkerListType(fileName + " " + (headers.join(" ")));

  // Detect snapshot date from filename/folder
  const fnDates = extractDatesFromFilename(fileName);
  const folderDates = extractDatesFromFolderPath(params.filePath);
  const bestDate = chooseBestDate([...fnDates, ...folderDates]);

  return {
    importType: "worker_list",
    sourcePath: params.filePath,
    status: errors.length > 0 ? "has_errors" : "ready",
    summary: { totalRows: rows.length, needsReviewCount: withIssues },
    rows,
    warnings,
    errors,
    detectedListType: listType,
    detectedSnapshotDate: bestDate.bestDate ?? null,
    mapping,
    detectedHeaders: headers,
  };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export type ConfirmWorkerListInput = {
  companyId: string;
  documentId: string;
  listType: WorkerListType;
  snapshotDate: string | null;
  snapshotDatePrecision: string;
  snapshotDateSource: string;
  rows: WorkerListPreviewRow[];
};

export function confirmWorkerListImport(db: Database, input: ConfirmWorkerListInput): { rowsCreated: number } {
  const now = new Date().toISOString();
  const snapshotId = uuidv4();

  // Create snapshot
  db.prepare(`
    INSERT INTO worker_list_snapshots (id, company_id, document_id, snapshot_date,
      snapshot_date_precision, snapshot_date_source, list_type, row_count, confidence, needs_review, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    snapshotId, input.companyId, input.documentId,
    input.snapshotDate, input.snapshotDatePrecision, input.snapshotDateSource,
    input.listType, input.rows.length, 0.9, 0, now
  );

  // Insert rows — tcknRaw is stripped here, only hash/masked persisted
  const stmt = db.prepare(`
    INSERT INTO worker_list_rows (id, snapshot_id, worker_name, normalized_worker_name,
      tckn_masked, tckn_hash, department, job_title, employment_status, raw_row_text, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);

  let rowsCreated = 0;
  for (const row of input.rows) {
    if (!row.workerName && !row.tcknHash) continue;
    stmt.run(
      uuidv4(), snapshotId,
      row.workerName, row.workerName ? normalizeName(row.workerName) : null,
      row.tcknMasked, row.tcknHash,
      row.department, row.jobTitle, row.employmentStatus,
      row.rawRowText, now
    );
    rowsCreated++;
  }

  return { rowsCreated };
}
