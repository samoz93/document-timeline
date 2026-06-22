import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import type { Database } from "bun:sqlite";
import type { ImportPreview, KronosColumnMapping, KronosPreviewRow, ImportProfile } from "./importTypes.ts";
import { upsertCompanyCandidate, writeImportStagingRows, saveImportProfile } from "../db.ts";

// ─── Column alias detection ───────────────────────────────────────────────────

const KRONOS_ALIASES: Record<keyof KronosColumnMapping, string[]> = {
  external_worker_id:  ["employee id","çalışan no","sicil no","personel no","employee number","çalışan id","emp id"],
  worker_name:         ["ad soyad","adı soyadı","adi soyadi","isim","name","worker name","calisan","çalışan","full name","tam isim"],
  tckn:                ["tckn","tc kimlik","t.c. kimlik","kimlik no","tc no","t.c. no","11 haneli","national id"],
  company_name:        ["firma","firma adı","firma adi","company","company name","işyeri adı","isyeri adi","şirket","sirket","işveren"],
  sgk_registration_no: ["sgk","sgk sicil","sgk sicil no","işyeri sicil","isyeri sicil","registration no","sicil no"],
  department:          ["departman","bölüm","bolum","department","birim","unit","kısım"],
  job_title:           ["görev","gorevi","unvan","job title","pozisyon","meslek","title","role"],
  start_date:          ["giriş tarihi","giris tarihi","başlangıç","baslangic","start date","hire date","işe giriş"],
  end_date:            ["çıkış tarihi","cikis tarihi","bitiş","bitis","end date","ayrılış tarihi","termination date"],
  employment_status:   ["durum","status","çalışma durumu","calisma durumu","aktif","employment status","iş durumu"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim()
    .replace(/İ/g, "i").replace(/I/g, "ı").replace(/Ğ/g, "ğ")
    .replace(/Ş/g, "ş").replace(/Ü/g, "ü").replace(/Ö/g, "ö").replace(/Ç/g, "ç");
}

export function detectKronosColumnMapping(headers: string[]): KronosColumnMapping {
  const mapping: KronosColumnMapping = {};
  const normHeaders = headers.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(KRONOS_ALIASES) as [keyof KronosColumnMapping, string[]][]) {
    for (const alias of aliases) {
      const idx = normHeaders.findIndex((h) => h.includes(alias));
      if (idx !== -1 && headers[idx]) { mapping[field] = headers[idx]; break; }
    }
  }
  return mapping;
}

export function applyProfileMapping(headers: string[], profile: ImportProfile): KronosColumnMapping {
  const mapping: KronosColumnMapping = {};
  for (const [target, source] of Object.entries(profile.columnMappings)) {
    if (headers.includes(source)) {
      mapping[target as keyof KronosColumnMapping] = source;
    }
  }
  return mapping;
}

// ─── TCKN helpers ─────────────────────────────────────────────────────────────

function maskTckn(t: string): string { return t.length === 11 ? "*******" + t.slice(7) : t; }
function hashTckn(t: string): string { return createHash("sha256").update(t).digest("hex"); }
function validTckn(t: string): boolean { return /^\d{11}$/.test(t.trim()); }

// ─── Row mapping ──────────────────────────────────────────────────────────────

function get(row: Record<string, string>, mapping: KronosColumnMapping, field: keyof KronosColumnMapping): string | null {
  const col = mapping[field];
  if (!col) return null;
  const v = row[col]?.trim();
  return v && v.length > 0 ? v : null;
}

function parseKronosRows(rawRows: Record<string, string>[], mapping: KronosColumnMapping): KronosPreviewRow[] {
  return rawRows.map((row, i) => {
    const tcknRaw = get(row, mapping, "tckn")?.replace(/\s/g, "") ?? null;
    const issues: string[] = [];
    let tcknMasked: string | null = null;
    let tcknHash: string | null = null;

    if (tcknRaw) {
      if (!validTckn(tcknRaw)) issues.push(`Invalid TCKN: ${tcknRaw}`);
      else { tcknMasked = maskTckn(tcknRaw); tcknHash = hashTckn(tcknRaw); }
    }

    const workerName = get(row, mapping, "worker_name");
    const companyName = get(row, mapping, "company_name");
    const sgk = get(row, mapping, "sgk_registration_no");

    if (!workerName && !tcknRaw) issues.push("No name or TCKN found");

    return {
      rowIndex: i,
      externalWorkerId: get(row, mapping, "external_worker_id"),
      workerName,
      tcknMasked, tcknHash, tcknRaw,
      companyName,
      sgkRegistrationNo: sgk,
      department: get(row, mapping, "department"),
      jobTitle: get(row, mapping, "job_title"),
      startDate: get(row, mapping, "start_date"),
      endDate: get(row, mapping, "end_date"),
      employmentStatus: get(row, mapping, "employment_status"),
      rawRowJson: JSON.stringify(Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, v]) // strip tcknRaw from persisted JSON
      )),
      issues,
    };
  });
}

// ─── Company candidate extraction ─────────────────────────────────────────────

function extractCompanyCandidates(rows: KronosPreviewRow[]): Map<string, { name: string | null; sgk: string | null; count: number }> {
  const map = new Map<string, { name: string | null; sgk: string | null; count: number }>();
  for (const row of rows) {
    const key = row.sgkRegistrationNo ?? row.companyName?.toLowerCase().trim() ?? "__unknown__";
    const existing = map.get(key);
    if (existing) { existing.count++; }
    else { map.set(key, { name: row.companyName, sgk: row.sgkRegistrationNo, count: 1 }); }
  }
  map.delete("__unknown__");
  return map;
}

// ─── Parse spreadsheet ────────────────────────────────────────────────────────

async function parseSpreadsheet(filePath: string): Promise<{ rows: Record<string, string>[]; sheetName: string; headers: string[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0]!;
  const ws = wb.Sheets[sheetName]!;
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const headers = json.length > 0 ? Object.keys(json[0]!) : [];
  const rows = json.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
  return { rows, sheetName, headers };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewKronosImport(
  params: {
    filePath: string;
    profileId?: string;
    profiles?: ImportProfile[];
    overrideMapping?: KronosColumnMapping;
  }
): Promise<ImportPreview<KronosPreviewRow> & {
  detectedHeaders: string[];
  mapping: KronosColumnMapping;
  companyCandidates: Array<{ key: string; name: string | null; sgk: string | null; count: number }>;
  usedProfileId: string | null;
}> {
  const warnings: string[] = [];
  const errors: string[] = [];

  let headers: string[] = [];
  let rawRows: Record<string, string>[] = [];
  let sheetName = "";

  try {
    const parsed = await parseSpreadsheet(params.filePath);
    headers = parsed.headers;
    rawRows = parsed.rows;
    sheetName = parsed.sheetName;
  } catch (e) {
    errors.push(`Failed to parse: ${String(e)}`);
    return {
      importType: "hr_kronos", sourcePath: params.filePath, status: "has_errors",
      summary: { totalRows: 0 }, rows: [], warnings, errors,
      detectedHeaders: [], mapping: {}, companyCandidates: [], usedProfileId: null,
    };
  }

  // Determine column mapping
  let mapping: KronosColumnMapping;
  let usedProfileId: string | null = null;

  if (params.overrideMapping) {
    mapping = params.overrideMapping;
  } else if (params.profileId && params.profiles) {
    const profile = params.profiles.find((p) => p.id === params.profileId);
    if (profile) { mapping = applyProfileMapping(headers, profile); usedProfileId = profile.id; }
    else { mapping = detectKronosColumnMapping(headers); }
  } else {
    mapping = detectKronosColumnMapping(headers);
  }

  const missing = (["worker_name", "company_name"] as const).filter((f) => !mapping[f]);
  if (missing.length > 0) warnings.push(`Could not auto-detect: ${missing.join(", ")}. Please review column mapping.`);
  if (!mapping.tckn) warnings.push("TCKN column not detected — workers will be matched by name only.");

  const rows = parseKronosRows(rawRows, mapping);
  const withIssues = rows.filter((r) => r.issues.length > 0).length;
  if (withIssues > 0) warnings.push(`${withIssues} row(s) have issues and will need review.`);

  const candidates = extractCompanyCandidates(rows);
  const companyCandidates = [...candidates.entries()].map(([key, v]) => ({ key, ...v }));

  if (companyCandidates.length === 0) warnings.push("No company identifiers detected in data.");
  else if (companyCandidates.length > 20) warnings.push(`${companyCandidates.length} distinct companies detected — large multi-company export.`);

  return {
    importType: "hr_kronos",
    sourcePath: params.filePath,
    status: missing.length > 0 ? "needs_mapping" : "ready",
    summary: { totalRows: rows.length, needsReviewCount: withIssues },
    rows,
    warnings,
    errors,
    detectedHeaders: headers,
    mapping,
    companyCandidates,
    usedProfileId,
  };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export type ConfirmKronosInput = {
  companyId: string;
  filePath: string;
  sheetName?: string;
  rows: KronosPreviewRow[];
  mapping: KronosColumnMapping;
  saveProfileAs?: string; // profile name to save
};

export async function confirmKronosImport(
  db: Database,
  input: ConfirmKronosInput
): Promise<{ stagingRows: number; candidatesCreated: number; profileSaved: boolean }> {
  // Create import job record
  const jobId = uuidv4();
  db.prepare(`
    INSERT INTO import_jobs (id, import_type, source_path, company_id, status, created_at)
    VALUES (?, 'hr_kronos', ?, ?, 'done', ?)
  `).run(jobId, input.filePath, input.companyId, new Date().toISOString());

  // Write staging rows (raw rows preserved, TCKN stripped from JSON)
  writeImportStagingRows(db, jobId, input.rows.map((r) => ({
    sourceSheet: input.sheetName ?? null,
    rowIndex: r.rowIndex,
    rawRowJson: r.rawRowJson,
    mappedRowJson: JSON.stringify({
      externalWorkerId: r.externalWorkerId,
      workerName: r.workerName,
      tcknMasked: r.tcknMasked, // raw TCKN never written
      tcknHash: r.tcknHash,
      companyName: r.companyName,
      sgkRegistrationNo: r.sgkRegistrationNo,
      department: r.department,
      jobTitle: r.jobTitle,
      startDate: r.startDate,
      endDate: r.endDate,
      employmentStatus: r.employmentStatus,
    }),
    warnings: r.issues,
  })));

  // Extract and upsert company candidates
  const candidates = extractCompanyCandidates(input.rows);
  let candidatesCreated = 0;
  for (const [, cand] of candidates) {
    if (!cand.name && !cand.sgk) continue;
    upsertCompanyCandidate(db, {
      sourceType: "hr_kronos",
      sourceRef: input.filePath,
      detectedName: cand.name,
      detectedSgk: cand.sgk,
      confidence: cand.sgk ? 0.9 : 0.65,
      evidence: { workerCount: cand.count, mapping: input.mapping },
    });
    candidatesCreated++;
  }

  // Optionally save mapping profile
  let profileSaved = false;
  if (input.saveProfileAs?.trim()) {
    saveImportProfile(db, {
      name: input.saveProfileAs.trim(),
      sourceType: "kronos",
      columnMappings: Object.fromEntries(
        Object.entries(input.mapping).filter(([, v]) => v != null)
      ) as Record<string, string>,
      dateFormats: [],
      sheetRules: null,
    });
    profileSaved = true;
  }

  return { stagingRows: input.rows.length, candidatesCreated, profileSaved };
}
