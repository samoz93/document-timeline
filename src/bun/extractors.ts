import { readFileSync, existsSync } from "fs";
import path from "path";
import type { ExtractionResult } from "./domain.ts";

// ─── MIME type helpers ────────────────────────────────────────────────────────

export function extToMime(ext: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".txt": "text/plain",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

// ─── Language detection heuristic ────────────────────────────────────────────

export function detectLanguage(text: string): "tr" | "en" | "mixed" | "unknown" {
  if (!text || text.length < 20) return "unknown";
  const trChars = (text.match(/[ğşıöüçĞŞİÖÜÇ]/g) ?? []).length;
  const enWords = (text.match(/\b(the|and|of|for|report|health|worker)\b/gi) ?? []).length;
  const trWords = (text.match(/\b(ve|ile|için|tarih|muayene|çalışan|calisan|sağlık|saglik)\b/gi) ?? []).length;

  if (trChars > 5 || trWords > enWords) return trWords > 2 && enWords > 2 ? "mixed" : "tr";
  if (enWords > 2) return "en";
  return "unknown";
}

// ─── Plain text ───────────────────────────────────────────────────────────────

function extractTxt(filePath: string): ExtractionResult {
  try {
    const text = readFileSync(filePath, "utf-8");
    return {
      text,
      ocrUsed: false,
      languageHint: detectLanguage(text),
      warnings: [],
      status: text.trim().length > 0 ? "SUCCESS" : "PARTIAL_SUCCESS",
    };
  } catch (e) {
    return { text: "", ocrUsed: false, languageHint: "unknown", warnings: [String(e)], status: "FAILED" };
  }
}

// ─── PDF text extraction ──────────────────────────────────────────────────────
// We use a dynamic import so if pdfjs is not available the rest still works.

async function extractPdf(filePath: string): Promise<ExtractionResult> {
  try {
    // Try to dynamically import pdfjs-dist (user must install separately)
    // TODO: replace with a stable Bun-compatible PDF text extractor when available
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string).catch(() => null);

    if (!pdfjsLib) {
      // Fallback: try reading raw text tokens from PDF binary (very basic)
      const buf = readFileSync(filePath);
      const raw = buf.toString("latin1");
      const textTokens: string[] = [];
      const bt = /BT[\s\S]*?ET/g;
      let m: RegExpExecArray | null;
      while ((m = bt.exec(raw)) !== null) {
        const tj = m[0].match(/\(([^)]*)\)\s*Tj/g);
        if (tj) textTokens.push(...tj.map((t) => t.replace(/\(|\)\s*Tj/g, "")));
      }
      const text = textTokens.join(" ").trim();
      if (text.length > 30) {
        return { text, ocrUsed: false, languageHint: detectLanguage(text), warnings: ["basic PDF token extraction"], status: "PARTIAL_SUCCESS" };
      }
      return { text: "", ocrUsed: false, languageHint: "unknown", warnings: ["pdfjs-dist not available, text empty — OCR pending"], status: "OCR_PENDING" };
    }

    const loadingTask = (pdfjsLib as any).getDocument({ url: filePath, useSystemFonts: true });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as any[])
        .map((item: any) => item.str ?? "")
        .join(" ");
      pages.push(pageText);
    }
    const text = pages.join("\n").trim();
    if (text.length < 20) {
      return { text: "", ocrUsed: false, languageHint: "unknown", warnings: ["PDF appears scanned"], status: "OCR_PENDING" };
    }
    return { text, ocrUsed: false, languageHint: detectLanguage(text), warnings: [], status: "SUCCESS" };
  } catch (e) {
    return { text: "", ocrUsed: false, languageHint: "unknown", warnings: [String(e)], status: "FAILED" };
  }
}

// ─── DOCX extraction ──────────────────────────────────────────────────────────

async function extractDocx(filePath: string): Promise<ExtractionResult> {
  try {
    const mammoth = await import("mammoth");
    const buf = readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = result.value.trim();
    return {
      text,
      ocrUsed: false,
      languageHint: detectLanguage(text),
      warnings: result.messages.map((m: any) => String(m.message)),
      status: text.length > 0 ? "SUCCESS" : "PARTIAL_SUCCESS",
    };
  } catch (e) {
    return { text: "", ocrUsed: false, languageHint: "unknown", warnings: [String(e)], status: "FAILED" };
  }
}

// ─── XLSX/XLS extraction ──────────────────────────────────────────────────────

async function extractXlsx(filePath: string): Promise<ExtractionResult> {
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.readFile(filePath, { type: "file", sheetStubs: true });
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      parts.push(`[Sheet: ${sheetName}]`);
      const csv = XLSX.utils.sheet_to_csv(ws);
      parts.push(csv);
    }
    const text = parts.join("\n").trim();
    return {
      text,
      ocrUsed: false,
      languageHint: detectLanguage(text),
      warnings: [],
      status: text.length > 0 ? "SUCCESS" : "PARTIAL_SUCCESS",
    };
  } catch (e) {
    return { text: "", ocrUsed: false, languageHint: "unknown", warnings: [String(e)], status: "FAILED" };
  }
}

// ─── Image OCR ────────────────────────────────────────────────────────────────

async function extractImageOcr(filePath: string): Promise<ExtractionResult> {
  try {
    const Tesseract = await import("tesseract.js");
    const worker = await Tesseract.createWorker(["tur", "eng"]);
    const {
      data: { text, confidence },
    } = await worker.recognize(filePath);
    await worker.terminate();

    if (!text || text.trim().length < 10) {
      return { text: "", ocrUsed: true, languageHint: "unknown", warnings: ["OCR returned empty text"], status: "PARTIAL_SUCCESS" };
    }
    return {
      text: text.trim(),
      ocrUsed: true,
      languageHint: detectLanguage(text),
      warnings: confidence < 50 ? [`low OCR confidence: ${confidence.toFixed(0)}%`] : [],
      status: "SUCCESS",
    };
  } catch (e) {
    return { text: "", ocrUsed: true, languageHint: "unknown", warnings: [String(e)], status: "FAILED" };
  }
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

export async function extractFile(filePath: string): Promise<ExtractionResult> {
  if (!existsSync(filePath)) {
    return { text: "", ocrUsed: false, languageHint: "unknown", warnings: ["file not found"], status: "FAILED" };
  }

  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".txt":
    case ".csv":
      return extractTxt(filePath);

    case ".pdf":
      return extractPdf(filePath);

    case ".docx":
    case ".doc":
      return extractDocx(filePath);

    case ".xlsx":
    case ".xls":
      return extractXlsx(filePath);

    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
    case ".tif":
    case ".tiff":
      return extractImageOcr(filePath);

    case ".mp4":
    case ".mov":
    case ".avi":
    case ".mkv":
    case ".mp3":
    case ".wav":
      return { text: "", ocrUsed: false, languageHint: "unknown", warnings: ["media file — metadata only"], status: "UNSUPPORTED" };

    case ".zip":
    case ".rar":
    case ".7z":
      return { text: "", ocrUsed: false, languageHint: "unknown", warnings: ["archive file — metadata only"], status: "UNSUPPORTED" };

    default:
      return { text: "", ocrUsed: false, languageHint: "unknown", warnings: [`unsupported extension: ${ext}`], status: "UNSUPPORTED" };
  }
}

// ─── Worker row extraction from tabular text ──────────────────────────────────

export type RawWorkerRow = {
  workerName: string | null;
  tcknRaw: string | null;
  department: string | null;
  jobTitle: string | null;
  employmentStatus: string | null;
  rawRowText: string;
};

const TCKN_RE = /\b(\d{11})\b/g;
const NAME_RE = /^([A-ZÇĞİÖŞÜa-zçğışöşü]+ [A-ZÇĞİÖŞÜa-zçğışöşü]+(?:\s+[A-ZÇĞİÖŞÜa-zçğışöşü]+)?)/;

export function extractWorkerRowsFromText(text: string): RawWorkerRow[] {
  const rows: RawWorkerRow[] = [];
  const lines = text.split("\n").filter((l) => l.trim().length > 3);

  for (const line of lines) {
    TCKN_RE.lastIndex = 0;
    const tcknMatch = TCKN_RE.exec(line);
    const nameMatch = NAME_RE.exec(line.trim());

    if (tcknMatch || nameMatch) {
      rows.push({
        workerName: nameMatch ? nameMatch[1] ?? null : null,
        tcknRaw: tcknMatch ? tcknMatch[1] ?? null : null,
        department: null,
        jobTitle: null,
        employmentStatus: null,
        rawRowText: line.trim(),
      });
    }
  }

  return rows;
}

// ─── TCKN masking and hashing ─────────────────────────────────────────────────

import { createHash } from "crypto";

export function maskTckn(tckn: string): string {
  if (tckn.length !== 11) return tckn;
  return "*******" + tckn.slice(7);
}

export function hashTckn(tckn: string): string {
  return createHash("sha256").update(tckn).digest("hex");
}
