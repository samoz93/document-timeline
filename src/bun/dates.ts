import type {
  DateEvidenceSource,
  DatePrecision,
  DocumentDateEvidence,
  DocumentTimelineDate,
} from "./domain.ts";

// ─── Turkish month name map ───────────────────────────────────────────────────

const TR_MONTHS: Record<string, number> = {
  ocak: 1,
  şubat: 2,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayıs: 5,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  ağustos: 8,
  agustos: 8,
  eylül: 9,
  eylul: 9,
  ekim: 10,
  kasım: 11,
  kasim: 11,
  aralık: 12,
  aralik: 12,
};

const EN_MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

// ─── Parse helpers ────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (y < 1940 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

function isValidYearMonth(y: number, m: number): boolean {
  return y >= 1940 && y <= 2100 && m >= 1 && m <= 12;
}

function isValidYear(y: number): boolean {
  return y >= 1940 && y <= 2100;
}

type ParsedDate = { iso: string; precision: DatePrecision };

function tryParseDate(raw: string): ParsedDate | null {
  raw = raw.trim();

  // DD.MM.YYYY  DD/MM/YYYY  DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (dmy) {
    const [, ds, ms, ys] = dmy;
    const d = parseInt(ds!, 10);
    const m = parseInt(ms!, 10);
    const y = parseInt(ys!, 10);
    if (isValidDate(y, m, d)) {
      return { iso: `${y}-${pad(m)}-${pad(d)}`, precision: "day" };
    }
  }

  // YYYY-MM-DD  YYYY_MM_DD  YYYY.MM.DD
  const ymd = raw.match(/^(\d{4})[.\-_](\d{1,2})[.\-_](\d{1,2})$/);
  if (ymd) {
    const [, ys, ms, ds] = ymd;
    const y = parseInt(ys!, 10);
    const m = parseInt(ms!, 10);
    const d = parseInt(ds!, 10);
    if (isValidDate(y, m, d)) {
      return { iso: `${y}-${pad(m)}-${pad(d)}`, precision: "day" };
    }
  }

  // MM.YYYY or MM/YYYY
  const my = raw.match(/^(\d{1,2})[./](\d{4})$/);
  if (my) {
    const [, ms, ys] = my;
    const m = parseInt(ms!, 10);
    const y = parseInt(ys!, 10);
    if (isValidYearMonth(y, m)) {
      return { iso: `${y}-${pad(m)}`, precision: "month" };
    }
  }

  // YYYY-MM
  const ym = raw.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const [, ys, ms] = ym;
    const y = parseInt(ys!, 10);
    const m = parseInt(ms!, 10);
    if (isValidYearMonth(y, m)) {
      return { iso: `${y}-${pad(m)}`, precision: "month" };
    }
  }

  // bare year
  const y4 = raw.match(/^(\d{4})$/);
  if (y4) {
    const y = parseInt(y4[1]!, 10);
    if (isValidYear(y)) {
      return { iso: String(y), precision: "year" };
    }
  }

  return null;
}

// ─── Extract all date mentions from arbitrary text ────────────────────────────

export function extractDatesFromText(text: string): ParsedDate[] {
  const found: ParsedDate[] = [];
  const seen = new Set<string>();

  const patterns = [
    // DD.MM.YYYY and variants
    /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g,
    // YYYY-MM-DD
    /\b(\d{4})[.\-_](\d{1,2})[.\-_](\d{1,2})\b/g,
    // Turkish month names: 15 Ocak 2022
    /\b(\d{1,2})\s+(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\s+(\d{4})\b/gi,
    // English month names: 15 January 2022
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})\b/gi,
    // month year Turkish: Ocak 2022
    /\b(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\s+(\d{4})\b/gi,
    // MM/YYYY month-year numeric
    /\b(\d{1,2})[./](\d{4})\b/g,
    // standalone 4-digit years
    /\b(20\d{2}|19[6-9]\d)\b/g,
  ];

  for (const pat of patterns) {
    let match: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((match = pat.exec(text)) !== null) {
      let parsed: ParsedDate | null = null;

      if (match.length === 4) {
        const a = match[1]!;
        const b = match[2]!.toLowerCase();
        const c = match[3]!;

        // Turkish month name day
        const trM = TR_MONTHS[b];
        if (trM !== undefined) {
          const d = parseInt(a, 10);
          const y = parseInt(c, 10);
          if (isValidDate(y, trM, d)) {
            parsed = { iso: `${y}-${pad(trM)}-${pad(d)}`, precision: "day" };
          }
        }

        // English month name day
        const enM = EN_MONTHS[b];
        if (!parsed && enM !== undefined) {
          const d = parseInt(a, 10);
          const y = parseInt(c, 10);
          if (isValidDate(y, enM, d)) {
            parsed = { iso: `${y}-${pad(enM)}-${pad(d)}`, precision: "day" };
          }
        }

        if (!parsed) {
          parsed = tryParseDate(`${a}.${b}.${c}`) ?? tryParseDate(`${a}-${b}-${c}`);
        }
      } else if (match.length === 3) {
        const a = match[1]!.toLowerCase();
        const b = match[2]!;
        // Turkish/English month year
        const trM = TR_MONTHS[a];
        if (trM !== undefined) {
          const y = parseInt(b, 10);
          if (isValidYearMonth(y, trM)) {
            parsed = { iso: `${y}-${pad(trM)}`, precision: "month" };
          }
        }
        if (!parsed) {
          parsed = tryParseDate(`${match[1]}.${match[2]}`);
        }
      } else if (match.length === 2) {
        const y = parseInt(match[1]!, 10);
        if (isValidYear(y)) {
          parsed = { iso: String(y), precision: "year" };
        }
      }

      if (parsed && !seen.has(parsed.iso)) {
        seen.add(parsed.iso);
        found.push(parsed);
      }
    }
  }

  return found;
}

// ─── Extract dates from file name ────────────────────────────────────────────

export function extractDatesFromFilename(filename: string): DocumentDateEvidence[] {
  const results = extractDatesFromText(filename);
  return results.map((p) => ({
    source: "filename" as DateEvidenceSource,
    date: p.iso,
    precision: p.precision,
    rawText: filename,
    confidence: p.precision === "day" ? 0.8 : p.precision === "month" ? 0.7 : 0.5,
  }));
}

// ─── Extract dates from folder path ──────────────────────────────────────────

export function extractDatesFromFolderPath(filePath: string): DocumentDateEvidence[] {
  const parts = filePath.split(/[/\\]/);
  const evidence: DocumentDateEvidence[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const results = extractDatesFromText(part);
    for (const p of results) {
      if (!seen.has(p.iso)) {
        seen.add(p.iso);
        evidence.push({
          source: "folder",
          date: p.iso,
          precision: p.precision,
          rawText: part,
          confidence:
            p.precision === "day" ? 0.65 : p.precision === "month" ? 0.6 : 0.45,
        });
      }
    }
  }

  return evidence;
}

// ─── Extract dates from file system metadata ──────────────────────────────────

export function buildFilesystemDateEvidence(
  createdAt: Date | null,
  modifiedAt: Date | null
): DocumentDateEvidence[] {
  const evidence: DocumentDateEvidence[] = [];
  if (modifiedAt) {
    evidence.push({
      source: "filesystem",
      date: modifiedAt.toISOString().slice(0, 10),
      precision: "day",
      rawText: modifiedAt.toISOString(),
      confidence: 0.3,
    });
  }
  if (createdAt && createdAt.getTime() !== modifiedAt?.getTime()) {
    evidence.push({
      source: "filesystem",
      date: createdAt.toISOString().slice(0, 10),
      precision: "day",
      rawText: createdAt.toISOString(),
      confidence: 0.25,
    });
  }
  return evidence;
}

// ─── Extract dates from document content ─────────────────────────────────────

export function extractDatesFromContent(text: string): DocumentDateEvidence[] {
  if (!text) return [];

  const all = extractDatesFromText(text);
  const evidence: DocumentDateEvidence[] = [];

  // Look for dates near key Turkish field labels to boost confidence
  const highConfidencePatterns = [
    /(?:muayene\s+tarihi|tarih|date|tarih[i:]|rapor\s+tarihi|düzenleme\s+tarihi)[:\s]+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/gi,
    /(?:düzenlenme|düzenleme|hazırlanma)\s+tarihi[:\s]+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/gi,
    /(?:exam|report|issue)\s+date[:\s]+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/gi,
  ];

  const boostedDates = new Set<string>();

  for (const pat of highConfidencePatterns) {
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((m = pat.exec(text)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      const p = tryParseDate(raw);
      if (p) boostedDates.add(p.iso);
    }
  }

  for (const p of all) {
    evidence.push({
      source: "content",
      date: p.iso,
      precision: p.precision,
      rawText: p.iso,
      confidence: boostedDates.has(p.iso)
        ? 0.92
        : p.precision === "day"
        ? 0.75
        : p.precision === "month"
        ? 0.6
        : 0.4,
    });
  }

  return evidence;
}

// ─── Choose best date from all evidence ──────────────────────────────────────

const SOURCE_PRIORITY: DateEvidenceSource[] = [
  "manual",
  "content",
  "filename",
  "folder",
  "filesystem",
];

function dateYear(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

function mismatchWarning(a: DocumentDateEvidence, b: DocumentDateEvidence): string {
  return `${a.source} date (${a.date}) conflicts with ${b.source} date (${b.date})`;
}

export function chooseBestDate(
  evidence: DocumentDateEvidence[]
): DocumentTimelineDate {
  if (evidence.length === 0) {
    return {
      bestDate: null,
      bestDatePrecision: "unknown",
      bestDateSource: "unknown",
      confidence: 0,
      mismatch: false,
      warnings: [],
    };
  }

  // Sort by source priority then by precision quality
  const precisionWeight: Record<DatePrecision, number> = {
    day: 3,
    month: 2,
    year: 1,
    unknown: 0,
  };

  const sorted = [...evidence].sort((a, b) => {
    const ap = SOURCE_PRIORITY.indexOf(a.source);
    const bp = SOURCE_PRIORITY.indexOf(b.source);
    if (ap !== bp) return ap - bp;
    return precisionWeight[b.precision] - precisionWeight[a.precision];
  });

  const best = sorted[0]!;
  const warnings: string[] = [];
  let mismatch = false;

  // Check year-level mismatches across high-confidence non-filesystem sources
  const nonFs = evidence.filter((e) => e.source !== "filesystem" && e.confidence > 0.4);
  if (nonFs.length > 1) {
    const years = new Set(nonFs.map((e) => dateYear(e.date)));
    if (years.size > 1) {
      mismatch = true;
      for (let i = 1; i < nonFs.length; i++) {
        if (dateYear(nonFs[i]!.date) !== dateYear(nonFs[0]!.date)) {
          warnings.push(mismatchWarning(nonFs[0]!, nonFs[i]!));
        }
      }
    }
  }

  return {
    bestDate: best.date,
    bestDatePrecision: best.precision,
    bestDateSource: best.source,
    confidence: best.confidence,
    mismatch,
    warnings,
  };
}
