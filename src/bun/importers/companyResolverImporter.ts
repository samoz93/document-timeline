import { v4 as uuidv4 } from "uuid";
import type { Database } from "bun:sqlite";
import type { CompanyCandidateRow, ImportPreview } from "./importTypes.ts";
import { listCompanyCandidates, resolveCompanyCandidate, countPendingCandidates } from "../db.ts";

// ─── Preview: load pending candidates and try to match against companies ───────

export async function previewCompanyResolverImport(
  db: Database
): Promise<ImportPreview<CompanyCandidateRow>> {
  const warnings: string[] = [];
  const rawCandidates = listCompanyCandidates(db, "pending");

  type CompanyRow = { id: string; name: string; sgk_registration_no: string | null };
  const companies = db.prepare("SELECT id, name, sgk_registration_no FROM companies").all() as CompanyRow[];
  const bySgk = new Map(companies.filter((c) => c.sgk_registration_no).map((c) => [c.sgk_registration_no!, c]));
  const byName = new Map(companies.map((c) => [c.name.toLowerCase().trim(), c]));

  // Worker count per candidate (from staging rows)
  const workerCounts = new Map<string, number>();
  const staging = db.prepare(
    "SELECT mapped_row_json FROM import_staging_rows WHERE mapping_status = 'mapped'"
  ).all() as Array<{ mapped_row_json: string | null }>;
  for (const row of staging) {
    if (!row.mapped_row_json) continue;
    try {
      const m = JSON.parse(row.mapped_row_json) as { companyName?: string; sgkRegistrationNo?: string };
      const key = m.sgkRegistrationNo ?? m.companyName?.toLowerCase().trim() ?? "__unknown__";
      if (key !== "__unknown__") workerCounts.set(key, (workerCounts.get(key) ?? 0) + 1);
    } catch { /* skip */ }
  }

  const rows: CompanyCandidateRow[] = rawCandidates.map((c) => {
    // Try to match against known companies
    let matchedCompanyId: string | null = null;
    let matchedCompanyName: string | null = null;

    if (c.detected_sgk_registration_no) {
      const match = bySgk.get(c.detected_sgk_registration_no);
      if (match) { matchedCompanyId = match.id; matchedCompanyName = match.name; }
    }
    if (!matchedCompanyId && c.detected_name) {
      const match = byName.get(c.detected_name.toLowerCase().trim());
      if (match) { matchedCompanyId = match.id; matchedCompanyName = match.name; }
    }

    const workerKey = c.detected_sgk_registration_no ?? c.detected_name?.toLowerCase().trim() ?? "__unknown__";

    return {
      id: c.id,
      sourceType: c.source_type,
      sourceRef: c.source_ref,
      detectedName: c.detected_name,
      detectedSgk: c.detected_sgk_registration_no,
      detectedAddress: c.detected_address,
      confidence: c.confidence,
      status: c.status as CompanyCandidateRow["status"],
      matchedCompanyId,
      matchedCompanyName,
      workerCount: workerCounts.get(workerKey) ?? 0,
      evidenceJson: c.evidence_json,
      createdAt: c.created_at,
    };
  });

  const autoMatchable = rows.filter((r) => r.matchedCompanyId).length;
  const unmatched = rows.filter((r) => !r.matchedCompanyId).length;

  if (unmatched > 0) warnings.push(`${unmatched} candidate(s) could not be matched to existing companies — will be created as new.`);
  if (autoMatchable > 0) warnings.push(`${autoMatchable} candidate(s) matched to existing companies by SGK or name.`);

  return {
    importType: "company_resolver",
    sourcePath: "company_candidates",
    status: rows.length === 0 ? "has_errors" : unmatched > 0 ? "needs_mapping" : "ready",
    summary: { totalRows: rows.length, needsReviewCount: unmatched },
    rows,
    warnings,
    errors: rows.length === 0 ? ["No pending company candidates found. Import HR/Kronos data first."] : [],
  };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export type ResolveCandidateAction = {
  candidateId: string;
  action: "confirm_new" | "merge_existing" | "reject";
  mergeIntoCompanyId?: string;
  overrideName?: string;
  overrideSgk?: string;
};

export function confirmCompanyResolverImport(
  db: Database,
  actions: ResolveCandidateAction[]
): { created: number; merged: number; rejected: number } {
  let created = 0, merged = 0, rejected = 0;
  const now = new Date().toISOString();

  for (const action of actions) {
    try {
      if (action.action === "reject") {
        resolveCompanyCandidate(db, action.candidateId, "reject");
        rejected++;
        continue;
      }

      if (action.action === "merge_existing" && action.mergeIntoCompanyId) {
        resolveCompanyCandidate(db, action.candidateId, "merge", action.mergeIntoCompanyId);
        merged++;
        continue;
      }

      if (action.action === "confirm_new") {
        const cand = db.prepare("SELECT * FROM company_candidates WHERE id = ?").get(action.candidateId) as {
          detected_name: string | null;
          detected_sgk_registration_no: string | null;
          detected_address: string | null;
        } | undefined;
        if (!cand) continue;

        const name = action.overrideName ?? cand.detected_name ?? "Unknown Company";
        const sgk = action.overrideSgk ?? cand.detected_sgk_registration_no ?? null;

        const companyId = uuidv4();
        db.prepare(`
          INSERT INTO companies (id, name, hazard_class, sgk_registration_no, address, created_at, updated_at)
          VALUES (?, ?, 'UNKNOWN', ?, ?, ?, ?)
        `).run(companyId, name, sgk, cand.detected_address ?? null, now, now);

        resolveCompanyCandidate(db, action.candidateId, "confirm", companyId);
        created++;
      }
    } catch { rejected++; }
  }

  return { created, merged, rejected };
}
