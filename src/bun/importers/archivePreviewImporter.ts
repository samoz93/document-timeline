import { readdirSync, statSync, existsSync } from "fs";
import path from "path";
import type { Database } from "bun:sqlite";
import type {
  ArchiveFolderMode,
  ArchiveFolderPreviewRow,
  ArchiveFolderSubfolder,
  ImportPreview,
} from "./importTypes.ts";
import { extractDatesFromText } from "../dates.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set([".pdf",".docx",".doc",".xlsx",".xls",".txt",".csv",".png",".jpg",".jpeg",".webp",".tif",".tiff"]);
const LIKELY_SCANNED_EXTS = new Set([".pdf",".tif",".tiff",".jpg",".jpeg",".png"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function walkFiles(dir: string, depth = 0, maxDepth = 8): ArchiveFolderPreviewRow[] {
  const rows: ArchiveFolderPreviewRow[] = [];
  if (!existsSync(dir) || depth > maxDepth) return rows;

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return rows;
  }

  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      rows.push(...walkFiles(full, depth + 1, maxDepth));
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      let size = 0;
      try { size = statSync(full).size; } catch { /* ignore */ }
      rows.push({
        filePath: full,
        fileName: e.name,
        ext,
        sizeBytes: size,
        likelyScanned: LIKELY_SCANNED_EXTS.has(ext),
        detectedYear: detectYearFromPath(full),
      });
    }
  }
  return rows;
}

function detectYearFromPath(p: string): string | null {
  const dates = extractDatesFromText(p);
  const years = dates.filter((d) => d.precision === "year" || d.precision === "month" || d.precision === "day");
  if (years.length > 0) return years[0]!.iso.slice(0, 4);
  return null;
}

function yearRange(rows: ArchiveFolderPreviewRow[]): { from?: string; to?: string } {
  const years = rows.map((r) => r.detectedYear).filter(Boolean).map(Number).filter((y) => y > 1990 && y < 2100);
  if (years.length === 0) return {};
  return { from: String(Math.min(...years)), to: String(Math.max(...years)) };
}

// ─── Company matching for multi-company mode ──────────────────────────────────

function tryMatchCompany(
  db: Database,
  folderName: string
): { matchedCompanyId: string | null; matchedCompanyName: string | null; matchMethod: ArchiveFolderSubfolder["matchMethod"] } {
  type CompanyRow = { id: string; name: string; short_name: string | null; sgk_registration_no: string | null };
  const companies = db.prepare("SELECT id, name, short_name, sgk_registration_no FROM companies").all() as CompanyRow[];

  // 1. SGK number in folder name (digits sequence 10-11 chars)
  const sgkMatch = folderName.match(/\b(\d{10,11})\b/);
  if (sgkMatch) {
    const found = companies.find((c) => c.sgk_registration_no === sgkMatch[1]);
    if (found) return { matchedCompanyId: found.id, matchedCompanyName: found.name, matchMethod: "sgk_in_name" };
  }

  const normFolder = folderName.toLowerCase().trim();

  // 2. Exact short name
  const exactShort = companies.find((c) => c.short_name && c.short_name.toLowerCase() === normFolder);
  if (exactShort) return { matchedCompanyId: exactShort.id, matchedCompanyName: exactShort.name, matchMethod: "exact_short_name" };

  // 3. Fuzzy name: folder name is contained in company name or vice versa
  const fuzzy = companies.find((c) => {
    const cn = c.name.toLowerCase();
    return cn.includes(normFolder) || normFolder.includes(cn);
  });
  if (fuzzy) return { matchedCompanyId: fuzzy.id, matchedCompanyName: fuzzy.name, matchMethod: "fuzzy_name" };

  return { matchedCompanyId: null, matchedCompanyName: null, matchMethod: "unmatched" };
}

// ─── Single-company preview ───────────────────────────────────────────────────

export async function previewArchiveFolderImport(
  db: Database,
  params: {
    folderPath: string;
    mode: ArchiveFolderMode;
    companyId?: string;
  }
): Promise<ImportPreview<ArchiveFolderPreviewRow> & {
  mode: ArchiveFolderMode;
  subfolders?: ArchiveFolderSubfolder[];
}> {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!existsSync(params.folderPath)) {
    return {
      importType: "archive_folder", sourcePath: params.folderPath, status: "has_errors",
      summary: { totalFiles: 0 }, rows: [], warnings, mode: params.mode,
      errors: [`Folder not found: ${params.folderPath}`],
    };
  }

  if (params.mode === "single_company") {
    const allFiles = walkFiles(params.folderPath);
    const supported = allFiles.filter((f) => SUPPORTED_EXTS.has(f.ext));
    const unsupported = allFiles.filter((f) => !SUPPORTED_EXTS.has(f.ext));
    const ocrEstimate = supported.filter((f) => f.likelyScanned).length;

    return {
      importType: "archive_folder",
      sourcePath: params.folderPath,
      status: "ready",
      mode: "single_company",
      summary: {
        totalFiles: allFiles.length,
        supportedFiles: supported.length,
        unsupportedFiles: unsupported.length,
        estimatedOcrCount: ocrEstimate,
        detectedYearRange: yearRange(supported),
      } as any,
      rows: supported.slice(0, 200), // cap preview rows
      warnings: unsupported.length > 0
        ? [`${unsupported.length} unsupported files will be skipped.`]
        : [],
      errors,
    };
  }

  // Multi-company root: scan top-level subdirectories
  let topDirs: string[] = [];
  try {
    topDirs = readdirSync(params.folderPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => path.join(params.folderPath, e.name));
  } catch (e) {
    errors.push(String(e));
  }

  const subfolders: ArchiveFolderSubfolder[] = topDirs.map((dir) => {
    const folderName = path.basename(dir);
    const files = walkFiles(dir);
    const supported = files.filter((f) => SUPPORTED_EXTS.has(f.ext));
    const match = tryMatchCompany(db, folderName);
    return {
      folderPath: dir,
      folderName,
      ...match,
      fileCount: files.length,
      supportedFileCount: supported.length,
      unsupportedFileCount: files.length - supported.length,
      estimatedOcrCount: supported.filter((f) => f.likelyScanned).length,
      detectedYearRange: yearRange(supported),
    };
  });

  const unmatchedCount = subfolders.filter((s) => s.matchMethod === "unmatched").length;
  if (unmatchedCount > 0) warnings.push(`${unmatchedCount} subfolder(s) could not be matched to a company — manual mapping required.`);

  const totalSupported = subfolders.reduce((s, f) => s + f.supportedFileCount, 0);

  return {
    importType: "archive_folder",
    sourcePath: params.folderPath,
    status: unmatchedCount > 0 ? "needs_mapping" : "ready",
    mode: "multi_company_root",
    summary: { totalFiles: subfolders.reduce((s, f) => s + f.fileCount, 0), supportedFiles: totalSupported },
    rows: [],
    subfolders,
    warnings,
    errors,
  };
}

// ─── Confirm: launches background indexing ────────────────────────────────────

export type ConfirmArchiveFolderInput = {
  mode: ArchiveFolderMode;
  // single company
  folderPath?: string;
  companyId?: string;
  // multi company
  subfolderMappings?: Array<{ folderPath: string; companyId: string }>;
};

export async function confirmArchiveFolderImport(
  db: Database,
  input: ConfirmArchiveFolderInput,
  indexFn: (db: Database, companyId: string, folderPath: string) => Promise<void>
): Promise<{ started: number }> {
  const tasks: Array<{ companyId: string; folderPath: string }> = [];

  if (input.mode === "single_company" && input.companyId && input.folderPath) {
    tasks.push({ companyId: input.companyId, folderPath: input.folderPath });
  } else if (input.mode === "multi_company_root" && input.subfolderMappings) {
    tasks.push(...input.subfolderMappings);
  }

  for (const t of tasks) {
    // fire-and-forget background indexing
    indexFn(db, t.companyId, t.folderPath).catch((e) =>
      console.error(`[archive-import] failed ${t.folderPath}:`, e)
    );
  }

  return { started: tasks.length };
}
