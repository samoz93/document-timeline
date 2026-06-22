import { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type {
  Company,
  Document,
  DocumentDateEvidence,
  IndexingJob,
  Patient,
  ReviewItem,
  ReviewIssueType,
  ReviewSeverity,
  TimelineEvent,
  WorkerListRow,
  WorkerListSnapshot,
  WorkerSnapshotDiff,
} from "./domain.ts";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}

export function initDb(dbPath = "./healtharch.db"): Database {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA synchronous=NORMAL;");
  _db = db;
  createSchema(db);
  return db;
}

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      short_name TEXT,
      hazard_class TEXT NOT NULL DEFAULT 'UNKNOWN',
      master_folder_path TEXT,
      notes TEXT,
      sgk_registration_no TEXT UNIQUE,
      nace_code TEXT,
      address TEXT,
      employer_representative TEXT,
      osgb_responsible_person TEXT,
      contract_start_date TEXT,
      contract_end_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      tckn_masked TEXT,
      tckn_hash TEXT,
      birth_year INTEGER,
      department TEXT,
      job_title TEXT,
      first_seen_date TEXT,
      last_seen_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      patient_id TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_ext TEXT,
      mime_type TEXT,
      file_size INTEGER,
      hash TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_scope TEXT NOT NULL,
      suggested_label TEXT,
      extracted_text TEXT,
      language_hint TEXT,
      ocr_used INTEGER NOT NULL DEFAULT 0,
      classification_confidence REAL NOT NULL DEFAULT 0,
      date_confidence REAL NOT NULL DEFAULT 0,
      best_date TEXT,
      best_date_precision TEXT NOT NULL DEFAULT 'unknown',
      best_date_source TEXT NOT NULL DEFAULT 'unknown',
      manual_date TEXT,
      date_mismatch INTEGER NOT NULL DEFAULT 0,
      date_warnings_json TEXT,
      file_created_at TEXT,
      file_modified_at TEXT,
      compliance_status TEXT NOT NULL DEFAULT 'not_evaluated',
      expiry_date TEXT,
      next_review_date TEXT,
      parsing_status TEXT NOT NULL,
      parsing_error TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      verified_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_indexed_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS document_date_evidence (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      source TEXT NOT NULL,
      date TEXT NOT NULL,
      precision TEXT NOT NULL,
      raw_text TEXT,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      patient_id TEXT,
      document_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT,
      event_date_precision TEXT NOT NULL DEFAULT 'unknown',
      event_date_source TEXT NOT NULL DEFAULT 'unknown',
      title TEXT NOT NULL,
      summary TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(patient_id) REFERENCES patients(id),
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      message TEXT NOT NULL,
      evidence_json TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS worker_list_snapshots (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      snapshot_date TEXT,
      snapshot_date_precision TEXT NOT NULL DEFAULT 'unknown',
      snapshot_date_source TEXT NOT NULL DEFAULT 'unknown',
      list_type TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS worker_list_rows (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      worker_name TEXT,
      normalized_worker_name TEXT,
      tckn_masked TEXT,
      tckn_hash TEXT,
      department TEXT,
      job_title TEXT,
      employment_status TEXT,
      raw_row_text TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(snapshot_id) REFERENCES worker_list_snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS indexing_jobs (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      folder_path TEXT NOT NULL,
      status TEXT NOT NULL,
      total_files INTEGER NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      document_id UNINDEXED,
      company_id UNINDEXED,
      file_name,
      category,
      document_type,
      document_scope,
      suggested_label,
      patient_name,
      extracted_text
    );

    CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
    CREATE INDEX IF NOT EXISTS idx_documents_patient ON documents(patient_id);
    CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(best_date);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
    CREATE INDEX IF NOT EXISTS idx_documents_review ON documents(needs_review);
    CREATE INDEX IF NOT EXISTS idx_timeline_company ON timeline_events(company_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_patient ON timeline_events(patient_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_events(event_date);
    CREATE INDEX IF NOT EXISTS idx_review_company ON review_items(company_id);
    CREATE INDEX IF NOT EXISTS idx_review_status ON review_items(status);
    CREATE INDEX IF NOT EXISTS idx_patients_company ON patients(company_id);
    CREATE INDEX IF NOT EXISTS idx_patients_hash ON patients(tckn_hash);

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      import_type TEXT NOT NULL,
      source_path TEXT NOT NULL,
      company_id TEXT,
      status TEXT NOT NULL,
      summary_json TEXT,
      warnings_json TEXT,
      errors_json TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS classification_rules (
      id TEXT PRIMARY KEY,
      document_type TEXT NOT NULL,
      category TEXT NOT NULL,
      document_scope TEXT NOT NULL,
      keywords_json TEXT,
      negative_keywords_json TEXT,
      filename_hints_json TEXT,
      folder_hints_json TEXT,
      confidence_boost REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'user',
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS template_fingerprints (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      file_name_pattern TEXT,
      text_hash TEXT,
      field_labels_json TEXT,
      document_type TEXT,
      category TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_companies_sgk ON companies(sgk_registration_no);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_type ON import_jobs(import_type);
  `);

  // Migrate existing companies table — add new columns if absent
  const companyColumns = (db.prepare("PRAGMA table_info(companies)").all() as { name: string }[]).map((r) => r.name);
  const newCompanyCols: [string, string][] = [
    ["sgk_registration_no", "TEXT"],
    ["nace_code", "TEXT"],
    ["address", "TEXT"],
    ["employer_representative", "TEXT"],
    ["osgb_responsible_person", "TEXT"],
    ["contract_start_date", "TEXT"],
    ["contract_end_date", "TEXT"],
  ];
  for (const [col, type] of newCompanyCols) {
    if (!companyColumns.includes(col)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${col} ${type}`);
    }
  }
}

const now = () => new Date().toISOString();

// ─── Companies ────────────────────────────────────────────────────────────────

export function createCompany(
  db: Database,
  input: Omit<Company, "id" | "created_at" | "updated_at">
): Company {
  const id = uuidv4();
  const ts = now();
  db.prepare(`
    INSERT INTO companies (id, name, legal_name, short_name, hazard_class, master_folder_path, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.legal_name ?? null,
    input.short_name ?? null,
    input.hazard_class,
    input.master_folder_path ?? null,
    input.notes ?? null,
    ts,
    ts
  );
  return getCompany(db, id)!;
}

export function listCompanies(db: Database): Company[] {
  return db.prepare("SELECT * FROM companies ORDER BY name").all() as Company[];
}

export function getCompany(db: Database, id: string): Company | null {
  return (
    (db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as Company | undefined) ?? null
  );
}

export function updateCompany(
  db: Database,
  id: string,
  fields: Partial<Omit<Company, "id" | "created_at">>
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

// ─── Patients ─────────────────────────────────────────────────────────────────

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .replace(/Ğ/g, "ğ")
    .replace(/Ş/g, "ş")
    .replace(/Ü/g, "ü")
    .replace(/Ö/g, "ö")
    .replace(/Ç/g, "ç")
    .replace(/\s+/g, " ")
    .trim();
}

export function upsertPatient(
  db: Database,
  input: Omit<Patient, "id" | "created_at" | "updated_at">
): Patient {
  const ts = now();

  // Try to find by TCKN hash first, then name
  let existing: Patient | null = null;

  if (input.tckn_hash) {
    existing =
      (db
        .prepare("SELECT * FROM patients WHERE company_id = ? AND tckn_hash = ?")
        .get(input.company_id, input.tckn_hash) as Patient | undefined) ?? null;
  }

  if (!existing) {
    existing =
      (db
        .prepare(
          "SELECT * FROM patients WHERE company_id = ? AND normalized_name = ?"
        )
        .get(input.company_id, input.normalized_name) as Patient | undefined) ?? null;
  }

  if (existing) {
    // Update last_seen_date and fill in missing fields
    const updates: Record<string, unknown> = { updated_at: ts };
    if (input.tckn_hash && !existing.tckn_hash) {
      updates["tckn_hash"] = input.tckn_hash;
      updates["tckn_masked"] = input.tckn_masked;
    }
    if (input.department && !existing.department)
      updates["department"] = input.department;
    if (input.job_title && !existing.job_title)
      updates["job_title"] = input.job_title;
    if (input.birth_year && !existing.birth_year)
      updates["birth_year"] = input.birth_year;
    if (!existing.last_seen_date || (input.last_seen_date && input.last_seen_date > existing.last_seen_date)) {
      updates["last_seen_date"] = input.last_seen_date;
    }

    const sets = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    db.prepare(`UPDATE patients SET ${sets} WHERE id = ?`).run(
      ...Object.values(updates),
      existing.id
    );
    return getPatientById(db, existing.id)!;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO patients (id, company_id, name, normalized_name, tckn_masked, tckn_hash,
      birth_year, department, job_title, first_seen_date, last_seen_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.company_id,
    input.name,
    input.normalized_name,
    input.tckn_masked ?? null,
    input.tckn_hash ?? null,
    input.birth_year ?? null,
    input.department ?? null,
    input.job_title ?? null,
    input.first_seen_date ?? null,
    input.last_seen_date ?? null,
    ts,
    ts
  );

  return getPatientById(db, id)!;
}

export function getPatientById(db: Database, id: string): Patient | null {
  return (db.prepare("SELECT * FROM patients WHERE id = ?").get(id) as Patient | undefined) ?? null;
}

export function listPatients(
  db: Database,
  companyId: string,
  limit = 100,
  offset = 0
): Patient[] {
  return db
    .prepare("SELECT * FROM patients WHERE company_id = ? ORDER BY name LIMIT ? OFFSET ?")
    .all(companyId, limit, offset) as Patient[];
}

// ─── Documents ────────────────────────────────────────────────────────────────

export function upsertDocument(
  db: Database,
  doc: Omit<Document, "created_at" | "updated_at">
): void {
  const ts = now();
  const existing = db
    .prepare("SELECT id FROM documents WHERE hash = ?")
    .get(doc.hash);

  if (existing) {
    db.prepare(`
      UPDATE documents SET
        company_id=?, patient_id=?, file_path=?, file_name=?, file_ext=?,
        mime_type=?, file_size=?, category=?, document_type=?, document_scope=?,
        suggested_label=?, extracted_text=?, language_hint=?, ocr_used=?,
        classification_confidence=?, date_confidence=?, best_date=?,
        best_date_precision=?, best_date_source=?, manual_date=?, date_mismatch=?,
        date_warnings_json=?, file_created_at=?, file_modified_at=?,
        compliance_status=?, expiry_date=?, next_review_date=?, parsing_status=?,
        parsing_error=?, needs_review=?, verified_at=?, verified_by=?,
        updated_at=?, last_indexed_at=?
      WHERE hash=?
    `).run(
      doc.company_id, doc.patient_id ?? null, doc.file_path, doc.file_name, doc.file_ext ?? null,
      doc.mime_type ?? null, doc.file_size ?? null, doc.category, doc.document_type, doc.document_scope,
      doc.suggested_label ?? null, doc.extracted_text ?? null, doc.language_hint ?? null, doc.ocr_used,
      doc.classification_confidence, doc.date_confidence, doc.best_date ?? null,
      doc.best_date_precision, doc.best_date_source, doc.manual_date ?? null, doc.date_mismatch,
      doc.date_warnings_json ?? null, doc.file_created_at ?? null, doc.file_modified_at ?? null,
      doc.compliance_status, doc.expiry_date ?? null, doc.next_review_date ?? null, doc.parsing_status,
      doc.parsing_error ?? null, doc.needs_review, doc.verified_at ?? null, doc.verified_by ?? null,
      ts, ts,
      doc.hash
    );
    return;
  }

  db.prepare(`
    INSERT INTO documents (
      id, company_id, patient_id, file_path, file_name, file_ext, mime_type, file_size, hash,
      category, document_type, document_scope, suggested_label, extracted_text, language_hint,
      ocr_used, classification_confidence, date_confidence, best_date, best_date_precision,
      best_date_source, manual_date, date_mismatch, date_warnings_json, file_created_at,
      file_modified_at, compliance_status, expiry_date, next_review_date, parsing_status,
      parsing_error, needs_review, verified_at, verified_by, created_at, updated_at, last_indexed_at
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
  `).run(
    doc.id, doc.company_id, doc.patient_id ?? null, doc.file_path, doc.file_name,
    doc.file_ext ?? null, doc.mime_type ?? null, doc.file_size ?? null, doc.hash,
    doc.category, doc.document_type, doc.document_scope, doc.suggested_label ?? null,
    doc.extracted_text ?? null, doc.language_hint ?? null, doc.ocr_used,
    doc.classification_confidence, doc.date_confidence, doc.best_date ?? null,
    doc.best_date_precision, doc.best_date_source, doc.manual_date ?? null,
    doc.date_mismatch, doc.date_warnings_json ?? null, doc.file_created_at ?? null,
    doc.file_modified_at ?? null, doc.compliance_status, doc.expiry_date ?? null,
    doc.next_review_date ?? null, doc.parsing_status, doc.parsing_error ?? null,
    doc.needs_review, doc.verified_at ?? null, doc.verified_by ?? null,
    ts, ts, ts
  );
}

export function getDocumentById(db: Database, id: string): Document | null {
  return (
    (db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Document | undefined) ?? null
  );
}

export function getDocumentByHash(db: Database, hash: string): Document | null {
  return (
    (db.prepare("SELECT * FROM documents WHERE hash = ?").get(hash) as Document | undefined) ?? null
  );
}

export function isDuplicateHash(db: Database, hash: string): boolean {
  return !!db.prepare("SELECT 1 FROM documents WHERE hash = ?").get(hash);
}

export function updateDocumentMetadata(
  db: Database,
  id: string,
  fields: Partial<Pick<Document,
    "document_type" | "document_scope" | "category" | "manual_date" | "patient_id" |
    "suggested_label" | "needs_review" | "verified_at" | "verified_by"
  >>
): void {
  const ts = now();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v ?? null);
  }
  if (fields.manual_date !== undefined) {
    sets.push("best_date_source = ?");
    vals.push("manual");
    sets.push("best_date = ?");
    vals.push(fields.manual_date);
  }
  sets.push("updated_at = ?");
  vals.push(ts);
  vals.push(id);
  db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  syncDocumentFts(db, id);
}

export function markDocumentVerified(
  db: Database,
  documentId: string,
  verifiedBy = "physician"
): void {
  db.prepare(`
    UPDATE documents SET verified_at = ?, verified_by = ?, needs_review = 0, updated_at = ? WHERE id = ?
  `).run(now(), verifiedBy, now(), documentId);
}

// ─── FTS ──────────────────────────────────────────────────────────────────────

export function syncDocumentFts(db: Database, documentId: string): void {
  const doc = getDocumentById(db, documentId);
  if (!doc) return;

  const patient = doc.patient_id
    ? (db.prepare("SELECT name FROM patients WHERE id = ?").get(doc.patient_id) as { name: string } | undefined)
    : null;

  db.prepare("DELETE FROM documents_fts WHERE document_id = ?").run(documentId);
  db.prepare(`
    INSERT INTO documents_fts (document_id, company_id, file_name, category, document_type, document_scope, suggested_label, patient_name, extracted_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    doc.id,
    doc.company_id,
    doc.file_name,
    doc.category,
    doc.document_type,
    doc.document_scope,
    doc.suggested_label ?? "",
    patient?.name ?? "",
    (doc.extracted_text ?? "").slice(0, 50000)
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────

export type SearchDocumentsInput = {
  companyId: string;
  query?: string;
  year?: string;
  month?: string;
  category?: string[];
  documentType?: string[];
  documentScope?: string[];
  needsReview?: boolean;
  dateMismatch?: boolean;
  patientId?: string;
  limit?: number;
  offset?: number;
};

export function searchDocuments(
  db: Database,
  input: SearchDocumentsInput
): Document[] {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  if (input.query && input.query.trim()) {
    // FTS path
    const ftsResults = db.prepare(`
      SELECT document_id FROM documents_fts
      WHERE company_id = ? AND documents_fts MATCH ?
      LIMIT ? OFFSET ?
    `).all(input.companyId, input.query.trim() + "*", limit, offset) as { document_id: string }[];

    if (ftsResults.length === 0) return [];

    const ids = ftsResults.map((r) => r.document_id);
    const placeholders = ids.map(() => "?").join(",");
    return db.prepare(`
      SELECT * FROM documents WHERE id IN (${placeholders}) AND company_id = ?
    `).all(...ids, input.companyId) as Document[];
  }

  const conditions: string[] = ["company_id = ?"];
  const params: unknown[] = [input.companyId];

  if (input.year) {
    conditions.push("best_date LIKE ?");
    params.push(`${input.year}%`);
  }
  if (input.month && input.year) {
    conditions.push("best_date LIKE ?");
    params.push(`${input.year}-${input.month.padStart(2, "0")}%`);
  }
  if (input.category?.length) {
    const ph = input.category.map(() => "?").join(",");
    conditions.push(`category IN (${ph})`);
    params.push(...input.category);
  }
  if (input.documentType?.length) {
    const ph = input.documentType.map(() => "?").join(",");
    conditions.push(`document_type IN (${ph})`);
    params.push(...input.documentType);
  }
  if (input.documentScope?.length) {
    const ph = input.documentScope.map(() => "?").join(",");
    conditions.push(`document_scope IN (${ph})`);
    params.push(...input.documentScope);
  }
  if (input.needsReview !== undefined) {
    conditions.push("needs_review = ?");
    params.push(input.needsReview ? 1 : 0);
  }
  if (input.dateMismatch !== undefined) {
    conditions.push("date_mismatch = ?");
    params.push(input.dateMismatch ? 1 : 0);
  }
  if (input.patientId) {
    conditions.push("patient_id = ?");
    params.push(input.patientId);
  }

  params.push(limit, offset);
  return db.prepare(`
    SELECT * FROM documents WHERE ${conditions.join(" AND ")}
    ORDER BY best_date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as Document[];
}

// ─── Date evidence ────────────────────────────────────────────────────────────

export function insertDateEvidence(
  db: Database,
  documentId: string,
  evidence: DocumentDateEvidence[]
): void {
  const ts = now();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO document_date_evidence (id, document_id, source, date, precision, raw_text, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of evidence) {
    stmt.run(uuidv4(), documentId, e.source, e.date, e.precision, e.rawText, e.confidence, ts);
  }
}

export function getDateEvidence(
  db: Database,
  documentId: string
): DocumentDateEvidence[] {
  return db
    .prepare("SELECT source, date, precision, raw_text as rawText, confidence FROM document_date_evidence WHERE document_id = ?")
    .all(documentId) as DocumentDateEvidence[];
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export function insertTimelineEvent(
  db: Database,
  event: Omit<TimelineEvent, "created_at">
): void {
  const ts = now();
  db.prepare(`
    INSERT OR IGNORE INTO timeline_events (id, company_id, patient_id, document_id, event_type,
      event_date, event_date_precision, event_date_source, title, summary, confidence, needs_review, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.company_id, event.patient_id ?? null, event.document_id,
    event.event_type, event.event_date ?? null, event.event_date_precision,
    event.event_date_source, event.title, event.summary ?? null,
    event.confidence, event.needs_review, ts
  );
}

export function listTimelineEvents(
  db: Database,
  companyId: string,
  opts: {
    patientId?: string;
    year?: string;
    limit?: number;
    offset?: number;
  } = {}
): TimelineEvent[] {
  const conditions: string[] = ["company_id = ?"];
  const params: unknown[] = [companyId];
  if (opts.patientId) {
    conditions.push("patient_id = ?");
    params.push(opts.patientId);
  }
  if (opts.year) {
    conditions.push("event_date LIKE ?");
    params.push(`${opts.year}%`);
  }
  params.push(opts.limit ?? 100, opts.offset ?? 0);
  return db.prepare(`
    SELECT * FROM timeline_events WHERE ${conditions.join(" AND ")}
    ORDER BY event_date DESC, created_at DESC LIMIT ? OFFSET ?
  `).all(...params) as TimelineEvent[];
}

// ─── Review items ─────────────────────────────────────────────────────────────

export function createReviewItem(
  db: Database,
  item: {
    companyId: string;
    documentId: string;
    issueType: ReviewIssueType;
    severity: ReviewSeverity;
    message: string;
    evidence?: unknown;
  }
): void {
  db.prepare(`
    INSERT INTO review_items (id, company_id, document_id, issue_type, severity, status, message, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    uuidv4(),
    item.companyId,
    item.documentId,
    item.issueType,
    item.severity,
    item.message,
    item.evidence ? JSON.stringify(item.evidence) : null,
    now()
  );
}

export function listReviewItems(
  db: Database,
  companyId: string,
  opts: { status?: string; limit?: number; offset?: number } = {}
): ReviewItem[] {
  const conditions: string[] = ["company_id = ?"];
  const params: unknown[] = [companyId];
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  } else {
    conditions.push("status IN ('open', 'in_progress')");
  }
  params.push(opts.limit ?? 100, opts.offset ?? 0);
  return db.prepare(`
    SELECT * FROM review_items WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params) as ReviewItem[];
}

export function resolveReviewItem(
  db: Database,
  reviewItemId: string,
  status: "resolved" | "ignored" = "resolved"
): void {
  db.prepare(`
    UPDATE review_items SET status = ?, resolved_at = ? WHERE id = ?
  `).run(status, now(), reviewItemId);
}

export function resolveReviewItemsByDocument(
  db: Database,
  documentId: string,
  issueTypes?: ReviewIssueType[]
): void {
  if (issueTypes?.length) {
    const ph = issueTypes.map(() => "?").join(",");
    db.prepare(`
      UPDATE review_items SET status = 'resolved', resolved_at = ?
      WHERE document_id = ? AND issue_type IN (${ph}) AND status = 'open'
    `).run(now(), documentId, ...issueTypes);
  } else {
    db.prepare(`
      UPDATE review_items SET status = 'resolved', resolved_at = ?
      WHERE document_id = ? AND status = 'open'
    `).run(now(), documentId);
  }
}

// ─── Worker list snapshots ────────────────────────────────────────────────────

export function insertWorkerListSnapshot(
  db: Database,
  snapshot: Omit<WorkerListSnapshot, "created_at">
): void {
  db.prepare(`
    INSERT OR IGNORE INTO worker_list_snapshots (id, company_id, document_id, snapshot_date,
      snapshot_date_precision, snapshot_date_source, list_type, row_count, confidence, needs_review, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id, snapshot.company_id, snapshot.document_id,
    snapshot.snapshot_date ?? null, snapshot.snapshot_date_precision,
    snapshot.snapshot_date_source, snapshot.list_type, snapshot.row_count,
    snapshot.confidence, snapshot.needs_review, now()
  );
}

export function insertWorkerListRows(
  db: Database,
  rows: Omit<WorkerListRow, "created_at">[]
): void {
  const stmt = db.prepare(`
    INSERT INTO worker_list_rows (id, snapshot_id, worker_name, normalized_worker_name,
      tckn_masked, tckn_hash, department, job_title, employment_status, raw_row_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ts = now();
  for (const row of rows) {
    stmt.run(
      row.id, row.snapshot_id, row.worker_name ?? null, row.normalized_worker_name ?? null,
      row.tckn_masked ?? null, row.tckn_hash ?? null, row.department ?? null,
      row.job_title ?? null, row.employment_status ?? null, row.raw_row_text ?? null, ts
    );
  }
}

export function listWorkerListSnapshots(
  db: Database,
  companyId: string
): WorkerListSnapshot[] {
  return db.prepare(`
    SELECT * FROM worker_list_snapshots WHERE company_id = ?
    ORDER BY snapshot_date DESC
  `).all(companyId) as WorkerListSnapshot[];
}

export function getWorkerListSnapshotRows(
  db: Database,
  snapshotId: string
): WorkerListRow[] {
  return db.prepare(`
    SELECT * FROM worker_list_rows WHERE snapshot_id = ? ORDER BY worker_name
  `).all(snapshotId) as WorkerListRow[];
}

export function compareWorkerSnapshots(
  db: Database,
  previousSnapshotId: string,
  currentSnapshotId: string
): WorkerSnapshotDiff {
  const prevRows = getWorkerListSnapshotRows(db, previousSnapshotId);
  const currRows = getWorkerListSnapshotRows(db, currentSnapshotId);

  const prevByKey = new Map<string, WorkerListRow>();
  const currByKey = new Map<string, WorkerListRow>();

  const rowKey = (r: WorkerListRow) =>
    r.tckn_hash ?? r.normalized_worker_name ?? r.raw_row_text ?? r.id;

  for (const r of prevRows) prevByKey.set(rowKey(r), r);
  for (const r of currRows) currByKey.set(rowKey(r), r);

  const joined: WorkerListRow[] = [];
  const left: WorkerListRow[] = [];
  const departmentChanged: WorkerSnapshotDiff["departmentChanged"] = [];
  const jobTitleChanged: WorkerSnapshotDiff["jobTitleChanged"] = [];

  for (const [key, curr] of currByKey) {
    const prev = prevByKey.get(key);
    if (!prev) {
      joined.push(curr);
    } else {
      if (prev.department !== curr.department) {
        departmentChanged.push({
          worker: curr,
          fromDepartment: prev.department ?? undefined,
          toDepartment: curr.department ?? undefined,
        });
      }
      if (prev.job_title !== curr.job_title) {
        jobTitleChanged.push({
          worker: curr,
          fromJobTitle: prev.job_title ?? undefined,
          toJobTitle: curr.job_title ?? undefined,
        });
      }
    }
  }

  for (const [key, prev] of prevByKey) {
    if (!currByKey.has(key)) {
      left.push(prev);
    }
  }

  return { joined, left, departmentChanged, jobTitleChanged };
}

// ─── Indexing jobs ────────────────────────────────────────────────────────────

export function createIndexingJob(
  db: Database,
  companyId: string,
  folderPath: string
): IndexingJob {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO indexing_jobs (id, company_id, folder_path, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(id, companyId, folderPath, now());
  return db.prepare("SELECT * FROM indexing_jobs WHERE id = ?").get(id) as IndexingJob;
}

export function updateIndexingJob(
  db: Database,
  id: string,
  fields: Partial<IndexingJob>
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id") continue;
    sets.push(`${k} = ?`);
    vals.push(v ?? null);
  }
  vals.push(id);
  db.prepare(`UPDATE indexing_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getLatestIndexingJob(
  db: Database,
  companyId: string
): IndexingJob | null {
  return (
    (db.prepare(`
      SELECT * FROM indexing_jobs WHERE company_id = ? ORDER BY started_at DESC LIMIT 1
    `).get(companyId) as IndexingJob | undefined) ?? null
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export type WorkspaceStats = {
  totalDocuments: number;
  needsReview: number;
  dateMismatch: number;
  unlinkedWorkerDocs: number;
  workerLists: number;
  timelineEvents: number;
};

export function getWorkspaceStats(db: Database, companyId: string): WorkspaceStats {
  const total = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE company_id = ?").get(companyId) as { c: number }).c;
  const review = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE company_id = ? AND needs_review = 1").get(companyId) as { c: number }).c;
  const mismatch = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE company_id = ? AND date_mismatch = 1").get(companyId) as { c: number }).c;
  const unlinked = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE company_id = ? AND document_scope = 'single_worker' AND patient_id IS NULL").get(companyId) as { c: number }).c;
  const lists = (db.prepare("SELECT COUNT(*) as c FROM worker_list_snapshots WHERE company_id = ?").get(companyId) as { c: number }).c;
  const timeline = (db.prepare("SELECT COUNT(*) as c FROM timeline_events WHERE company_id = ?").get(companyId) as { c: number }).c;
  return {
    totalDocuments: total,
    needsReview: review,
    dateMismatch: mismatch,
    unlinkedWorkerDocs: unlinked,
    workerLists: lists,
    timelineEvents: timeline,
  };
}
