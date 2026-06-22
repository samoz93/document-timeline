import { readdirSync, existsSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import type { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { ImportPreview, TemplateFingerprintRow } from "./importTypes.ts";
import { extractFile } from "../extractors.ts";
import { classifyDocument } from "../classifier.ts";

// ─── Fingerprint helpers ──────────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set([".pdf",".docx",".doc",".xlsx",".xls"]);
const FIELD_LABEL_RE = /([A-ZÇĞİÖŞÜa-zçğışöşü][a-zçğışöşüA-ZÇĞİÖŞÜ\s]{2,30})\s*[:\-_]{1}/g;

function extractFieldLabels(text: string): string[] {
  const labels = new Set<string>();
  let m: RegExpExecArray | null;
  FIELD_LABEL_RE.lastIndex = 0;
  while ((m = FIELD_LABEL_RE.exec(text)) !== null) {
    const label = m[1]?.trim();
    if (label && label.length >= 3 && label.length <= 40) labels.add(label.toLowerCase());
    if (labels.size > 50) break;
  }
  return [...labels];
}

function hashText(text: string): string {
  // Normalize whitespace to make minor formatting differences irrelevant
  const normalized = text.replace(/\s+/g, " ").trim().slice(0, 4000);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function fileNameToPattern(fileName: string): string {
  // Strip date components and numbers to create a generalised pattern
  return fileName
    .replace(/\d{4}[-_./]\d{2}[-_./]\d{2}/g, "YYYY-MM-DD")
    .replace(/\d{4}/g, "YYYY")
    .replace(/\d+/g, "N")
    .toLowerCase();
}

// ─── Collect files ────────────────────────────────────────────────────────────

function collectFiles(inputPath: string): string[] {
  if (!existsSync(inputPath)) return [];
  const ext = path.extname(inputPath).toLowerCase();
  if (ext) return SUPPORTED_EXTS.has(ext) ? [inputPath] : [];

  // It's a directory
  const results: string[] = [];
  try {
    const entries = readdirSync(inputPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(inputPath, e.name);
      if (e.isDirectory()) results.push(...collectFiles(full));
      else if (e.isFile() && SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase())) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewTemplateLibraryImport(
  inputPath: string
): Promise<ImportPreview<TemplateFingerprintRow>> {
  const files = collectFiles(inputPath);
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: TemplateFingerprintRow[] = [];

  for (const filePath of files.slice(0, 100)) {
    try {
      const extraction = await extractFile(filePath);
      if (extraction.status === "FAILED") {
        warnings.push(`Could not extract: ${path.basename(filePath)}`);
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);
      const classification = classifyDocument({
        fileName, filePath, fileExt: ext,
        extractedText: extraction.text, ocrUsed: extraction.ocrUsed,
      });

      rows.push({
        filePath,
        fileName,
        textHash: hashText(extraction.text),
        fieldLabels: extractFieldLabels(extraction.text),
        detectedDocumentType: classification.documentType,
        category: classification.category,
        fileNamePattern: fileNameToPattern(fileName),
      });
    } catch (e) {
      errors.push(`${path.basename(filePath)}: ${String(e)}`);
    }
  }

  if (files.length > 100) warnings.push(`Only first 100 files previewed out of ${files.length}.`);

  return {
    importType: "template_library",
    sourcePath: inputPath,
    status: errors.length > 0 && rows.length === 0 ? "has_errors" : "ready",
    summary: { totalFiles: files.length, supportedFiles: rows.length },
    rows,
    warnings,
    errors,
  };
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export function confirmTemplateLibraryImport(
  db: Database,
  rows: TemplateFingerprintRow[]
): { imported: number; skipped: number } {
  const now = new Date().toISOString();
  let imported = 0, skipped = 0;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO template_fingerprints
      (id, file_name_pattern, text_hash, field_labels_json, document_type, category, created_at)
    VALUES (?,?,?,?,?,?,?)
  `);
  for (const row of rows) {
    try {
      stmt.run(
        uuidv4(), row.fileNamePattern, row.textHash,
        JSON.stringify(row.fieldLabels),
        row.detectedDocumentType, row.category, now
      );
      imported++;
    } catch { skipped++; }
  }
  return { imported, skipped };
}
