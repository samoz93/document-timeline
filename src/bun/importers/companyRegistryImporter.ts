import type { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { HazardClass } from "../domain.ts";
import type {
  CompanyColumnMapping,
  CompanyRegistryRow,
  ImportPreview,
} from "./importTypes.ts";

// ─── Column alias detection ───────────────────────────────────────────────────

const COLUMN_ALIASES: Record<keyof CompanyColumnMapping, string[]> = {
  sgk_registration_no: [
    "sgk", "sgk sicil no", "sgk sicil numarası", "sgk sicil numarasi",
    "isyeri sicil no", "işyeri sicil no", "işyeri sicil numarası",
    "isyeri sicil numarasi", "registration no", "sicil no",
  ],
  name: [
    "firma", "firma adı", "firma adi", "company", "company name",
    "işyeri adı", "isyeri adi", "şirket adı", "sirket adi", "unvan",
  ],
  legal_name: [
    "legal name", "ticaret unvanı", "ticaret unvani", "tam unvan",
    "resmi unvan",
  ],
  short_name: [
    "short name", "kısa ad", "kisa ad", "kısaltma", "kisaltma",
  ],
  hazard_class: [
    "tehlike sınıfı", "tehlike sinifi", "hazard class", "tehlike",
  ],
  nace_code: [
    "nace", "nace kodu", "nace code", "faaliyet kodu",
  ],
  address: [
    "adres", "address", "işyeri adresi", "isyeri adresi",
  ],
  employer_representative: [
    "işveren temsilcisi", "isveren temsilcisi", "employer representative",
    "işveren vekili",
  ],
  osgb_responsible_person: [
    "osgb sorumlusu", "osgb responsible", "isg sorumlusu",
    "iş güvenliği uzmanı", "is guvenligi uzmani",
  ],
  contract_start_date: [
    "sözleşme başlangıç", "sozlesme baslangic", "contract start",
    "başlangıç tarihi", "baslangic tarihi",
  ],
  contract_end_date: [
    "sözleşme bitiş", "sozlesme bitis", "contract end",
    "bitiş tarihi", "bitis tarihi",
  ],
  notes: [
    "notlar", "notes", "açıklama", "aciklama", "not",
  ],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim()
    .replace(/İ/g, "i").replace(/I/g, "ı")
    .replace(/Ğ/g, "ğ").replace(/Ş/g, "ş")
    .replace(/Ü/g, "ü").replace(/Ö/g, "ö").replace(/Ç/g, "ç");
}

export function detectColumnMapping(headers: string[]): CompanyColumnMapping {
  const mapping: CompanyColumnMapping = {};
  const normHeaders = headers.map(normalizeHeader);

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [keyof CompanyColumnMapping, string[]][]) {
    for (const alias of aliases) {
      const idx = normHeaders.findIndex((h) => h.includes(alias));
      if (idx !== -1 && headers[idx]) {
        mapping[field] = headers[idx];
        break;
      }
    }
  }
  return mapping;
}

// ─── Parse raw rows using mapping ────────────────────────────────────────────

const HAZARD_NORMALIZE: Record<string, HazardClass> = {
  "az tehlikeli": "LESS_HAZARDOUS", "az tehlikeli sınıf": "LESS_HAZARDOUS",
  "less hazardous": "LESS_HAZARDOUS", "1": "LESS_HAZARDOUS",
  "tehlikeli": "HAZARDOUS", "hazardous": "HAZARDOUS", "2": "HAZARDOUS",
  "çok tehlikeli": "VERY_HAZARDOUS", "very hazardous": "VERY_HAZARDOUS", "3": "VERY_HAZARDOUS",
};

function normalizeHazardClass(raw: string | null): HazardClass {
  if (!raw) return "UNKNOWN";
  const key = raw.toLowerCase().trim()
    .replace(/İ/g, "i").replace(/Ş/g, "ş").replace(/Ü/g, "ü")
    .replace(/Ö/g, "ö").replace(/Ç/g, "ç");
  return HAZARD_NORMALIZE[key] ?? "UNKNOWN";
}

function get(row: Record<string, string>, mapping: CompanyColumnMapping, field: keyof CompanyColumnMapping): string | null {
  const col = mapping[field];
  if (!col) return null;
  const val = row[col]?.trim();
  return val && val.length > 0 ? val : null;
}

function resolveMatchStatus(
  db: Database,
  sgk: string | null,
  name: string | null
): { matchStatus: CompanyRegistryRow["matchStatus"]; existingCompanyId: string | null } {
  if (sgk) {
    const existing = db.prepare("SELECT id FROM companies WHERE sgk_registration_no = ?").get(sgk) as { id: string } | undefined;
    if (existing) return { matchStatus: "matched_sgk", existingCompanyId: existing.id };
    return { matchStatus: "new", existingCompanyId: null };
  }
  if (!name) return { matchStatus: "missing_sgk", existingCompanyId: null };
  return { matchStatus: "needs_review", existingCompanyId: null };
}

export function parseCompanyRegistryRows(
  db: Database,
  rawRows: Record<string, string>[],
  mapping: CompanyColumnMapping
): CompanyRegistryRow[] {
  return rawRows.map((row, i) => {
    const sgk = get(row, mapping, "sgk_registration_no");
    const name = get(row, mapping, "name");
    const { matchStatus, existingCompanyId } = resolveMatchStatus(db, sgk, name);

    return {
      rowIndex: i,
      sgk_registration_no: sgk,
      name,
      legal_name: get(row, mapping, "legal_name"),
      short_name: get(row, mapping, "short_name"),
      hazard_class: normalizeHazardClass(get(row, mapping, "hazard_class")),
      nace_code: get(row, mapping, "nace_code"),
      address: get(row, mapping, "address"),
      employer_representative: get(row, mapping, "employer_representative"),
      osgb_responsible_person: get(row, mapping, "osgb_responsible_person"),
      contract_start_date: get(row, mapping, "contract_start_date"),
      contract_end_date: get(row, mapping, "contract_end_date"),
      notes: get(row, mapping, "notes"),
      matchStatus,
      existingCompanyId,
    };
  });
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewCompanyRegistryImport(
  db: Database,
  filePath: string
): Promise<ImportPreview<CompanyRegistryRow> & { detectedHeaders: string[]; mapping: CompanyColumnMapping }> {
  const XLSX = await import("xlsx");
  const warnings: string[] = [];
  const errors: string[] = [];

  let rawRows: Record<string, string>[] = [];
  let headers: string[] = [];

  try {
    const wb = XLSX.readFile(filePath);
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
      importType: "company_registry",
      sourcePath: filePath,
      status: "has_errors",
      summary: { totalRows: 0 },
      rows: [],
      warnings,
      errors,
      detectedHeaders: [],
      mapping: {},
    };
  }

  const mapping = detectColumnMapping(headers);
  if (!mapping.sgk_registration_no) warnings.push("SGK registration number column not detected — matching will fall back to name.");
  if (!mapping.name) warnings.push("Company name column not detected.");

  const rows = parseCompanyRegistryRows(db, rawRows, mapping);
  const needsReviewCount = rows.filter((r) => r.matchStatus === "needs_review" || r.matchStatus === "missing_sgk").length;

  return {
    importType: "company_registry",
    sourcePath: filePath,
    status: Object.keys(mapping).length < 2 ? "needs_mapping" : errors.length > 0 ? "has_errors" : "ready",
    summary: { totalRows: rows.length, needsReviewCount },
    rows,
    warnings,
    errors,
    detectedHeaders: headers,
    mapping,
  };
}

// ─── Confirm import ───────────────────────────────────────────────────────────

export type ConfirmCompanyRegistryInput = {
  rows: CompanyRegistryRow[];
  skipMissingSgk?: boolean;
  updateExisting?: boolean;
};

export type ConfirmCompanyRegistryResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export function confirmCompanyRegistryImport(
  db: Database,
  input: ConfirmCompanyRegistryInput
): ConfirmCompanyRegistryResult {
  const now = new Date().toISOString();
  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];

  for (const row of input.rows) {
    if (!row.name && !row.sgk_registration_no) { skipped++; continue; }
    if (input.skipMissingSgk && !row.sgk_registration_no) { skipped++; continue; }

    try {
      if (row.matchStatus === "matched_sgk" && row.existingCompanyId && input.updateExisting) {
        db.prepare(`
          UPDATE companies SET
            name = COALESCE(?, name),
            legal_name = COALESCE(?, legal_name),
            short_name = COALESCE(?, short_name),
            hazard_class = COALESCE(?, hazard_class),
            nace_code = COALESCE(?, nace_code),
            address = COALESCE(?, address),
            employer_representative = COALESCE(?, employer_representative),
            osgb_responsible_person = COALESCE(?, osgb_responsible_person),
            contract_start_date = COALESCE(?, contract_start_date),
            contract_end_date = COALESCE(?, contract_end_date),
            notes = COALESCE(?, notes),
            updated_at = ?
          WHERE id = ?
        `).run(
          row.name, row.legal_name, row.short_name, row.hazard_class,
          row.nace_code, row.address, row.employer_representative,
          row.osgb_responsible_person, row.contract_start_date,
          row.contract_end_date, row.notes, now, row.existingCompanyId
        );
        updated++;
      } else if (row.matchStatus === "new" || (row.matchStatus === "needs_review" && row.name)) {
        db.prepare(`
          INSERT INTO companies (id, name, legal_name, short_name, hazard_class,
            sgk_registration_no, nace_code, address, employer_representative,
            osgb_responsible_person, contract_start_date, contract_end_date, notes,
            created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          uuidv4(), row.name ?? "Unnamed", row.legal_name, row.short_name,
          row.hazard_class ?? "UNKNOWN", row.sgk_registration_no,
          row.nace_code, row.address, row.employer_representative,
          row.osgb_responsible_person, row.contract_start_date,
          row.contract_end_date, row.notes, now, now
        );
        created++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(`Row ${row.rowIndex}: ${String(e)}`);
      skipped++;
    }
  }

  return { created, updated, skipped, errors };
}
