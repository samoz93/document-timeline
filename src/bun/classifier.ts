import type {
  ClassificationResult,
  DocumentCategory,
  DocumentScope,
  DocumentType,
} from "./domain.ts";

// ─── Keyword rule sets ────────────────────────────────────────────────────────

const MEDICAL_KEYWORDS = [
  "ise giris", "işe giriş", "periyodik muayene", "periyodik",
  "çalışanın adı", "t.c. kimlik", "tckn", "saglik raporu", "sağlık raporu",
  "muayene", "tetkik", "odyometri", "solunum fonksiyon", "sft", "akciğer",
  "akciger", "hemogram", "idrar tahlili", "uygun değildir", "uygun degildir",
  "işe uygundur", "ise uygundur", "şartlı uygundur", "sartli uygundur",
  "sevk", "konsültasyon", "konsultasyon", "lab result", "lab sonuc",
  "asi kaydi", "aşı kaydı", "vaccination", "biyometri",
];

const SAFETY_KEYWORDS = [
  "risk değerlendirmesi", "risk degerlendirmesi", "ramak kala",
  "iş kazası", "is kazasi", "kaza araştırma", "kaza arastirma",
  "ortam ölçümü", "ortam olcumu", "gürültü ölçümü", "gurultu olcumu",
  "toz ölçümü", "toz olcumu", "aydınlatma ölçümü", "aydinlatma olcumu",
  "termal konfor", "acil durum planı", "acil durum plani",
  "isg kurulu", "saha denetimi", "uygunsuzluk",
  "düzeltici önleyici", "duzeltici onleyici", "döf", "dof",
  "kkd teslim", "near miss", "incident",
];

const EDUCATION_KEYWORDS = [
  "eğitim", "egitim", "iş sağlığı ve güvenliği eğitimi",
  "is sagligi ve guvenligi egitimi", "hijyen eğitimi", "hijyen egitimi",
  "ilk yardım", "ilk yardim", "yangın eğitimi", "yangin egitimi",
  "katılım listesi", "katilim listesi", "eğitim tutanağı",
  "egitim tutanagi", "training", "seminar",
];

const TEMPLATE_KEYWORDS = [
  "form", "şablon", "sablon", "boş", "bos", "örnek", "ornek",
  "taslak", "doldurulacak", "ek-", "template", "blank",
];

const ROSTER_KEYWORDS = [
  "personel listesi", "çalışan listesi", "calisan listesi",
  "isim listesi", "bordro", "departman", "görev", "gorev",
  "işe giriş tarihi", "ise giris tarihi", "işten çıkış", "isten cikis",
  "katılım listesi", "katilim listesi", "aşı listesi", "asi listesi",
  "kkd teslim listesi", "teslim listesi", "employee roster",
  "personnel list", "payroll",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .replace(/Ğ/g, "ğ")
    .replace(/Ş/g, "ş")
    .replace(/Ü/g, "ü")
    .replace(/Ö/g, "ö")
    .replace(/Ç/g, "ç");
}

function countKeywords(text: string, keywords: string[]): number {
  const norm = normalize(text);
  return keywords.filter((k) => norm.includes(normalize(k))).length;
}

function hasTCKN(text: string): boolean {
  return /\b\d{11}\b/.test(text);
}

function estimatePersonCount(text: string): number {
  // Count occurrences of TC kimlik 11-digit numbers as proxy for distinct people
  const matches = text.match(/\b\d{11}\b/g);
  if (matches && matches.length > 1) return matches.length;
  // Rough row counting for tabular content
  const lines = text.split("\n").filter((l) => l.trim().length > 5);
  if (lines.length > 20) return Math.min(lines.length, 999);
  return 1;
}

function folderHint(filePath: string): {
  category: DocumentCategory | null;
  docType: DocumentType | null;
} {
  const lower = normalize(filePath);
  if (lower.includes("muayene") || lower.includes("periyodik"))
    return { category: "medical", docType: "PERIYODIK_MUAYENE" };
  if (lower.includes("ise_giris") || lower.includes("ise-giris") || lower.includes("işe giriş"))
    return { category: "medical", docType: "ISE_GIRIS_MUAYENE" };
  if (lower.includes("risk"))
    return { category: "safety", docType: "RISK_DEGERLENDIRMESI" };
  if (lower.includes("kaza"))
    return { category: "safety", docType: "IS_KAZASI_RAPORU" };
  if (lower.includes("egitim") || lower.includes("eğitim"))
    return { category: "education", docType: "EGITIM_DOKUMANI" };
  if (lower.includes("olcum") || lower.includes("ölçüm"))
    return { category: "safety", docType: "ORTAM_OLCUM_RAPORU" };
  return { category: null, docType: null };
}

// ─── Main classifier ──────────────────────────────────────────────────────────

export function classifyDocument(params: {
  fileName: string;
  filePath: string;
  fileExt: string;
  extractedText: string;
  ocrUsed: boolean;
}): ClassificationResult {
  const { fileName, filePath, fileExt, extractedText } = params;
  const combined = `${filePath}\n${fileName}\n${extractedText}`;
  const evidence: string[] = [];

  // Media files - shortcut
  const mediaExts = [".mp4", ".mov", ".avi", ".mp3", ".wav", ".mkv"];
  if (mediaExts.includes(fileExt.toLowerCase())) {
    return {
      category: "media",
      documentType: "MEDIA",
      documentScope: "media",
      confidence: 0.95,
      source: "HEURISTIC",
      evidence: ["media file extension"],
      needsReview: false,
    };
  }

  // Template detection
  const templateScore = countKeywords(combined, TEMPLATE_KEYWORDS);
  if (templateScore >= 2 && extractedText.length < 500) {
    return {
      category: "template",
      documentType: "TEMPLATE",
      documentScope: "template",
      confidence: 0.7,
      source: "HEURISTIC",
      evidence: [`template keywords: ${templateScore}`],
      needsReview: false,
    };
  }

  // Score each category
  const medScore = countKeywords(combined, MEDICAL_KEYWORDS);
  const safScore = countKeywords(combined, SAFETY_KEYWORDS);
  const eduScore = countKeywords(combined, EDUCATION_KEYWORDS);
  const rosScore = countKeywords(combined, ROSTER_KEYWORDS);

  // Folder hint can override
  const hint = folderHint(filePath);
  if (hint.category) evidence.push(`folder hint: ${hint.category}`);

  // Determine scope
  const personCount = estimatePersonCount(extractedText);
  const hasTckn = hasTCKN(extractedText);

  let scope: DocumentScope = "unknown";
  let docType: DocumentType = "UNKNOWN";
  let category: DocumentCategory = "unknown";
  let confidence = 0.3;

  // Worker list / roster detection
  if (rosScore >= 2 || personCount > 5) {
    scope = "worker_list";
    evidence.push(`roster keywords: ${rosScore}, person estimate: ${personCount}`);
  }

  // Determine primary category
  const maxCat = Math.max(medScore, safScore, eduScore);
  if (maxCat === 0 && !hint.category) {
    category = "unknown";
  } else if ((medScore >= safScore && medScore >= eduScore) || hint.category === "medical") {
    category = "medical";
    evidence.push(`medical keywords: ${medScore}`);
  } else if ((safScore >= medScore && safScore >= eduScore) || hint.category === "safety") {
    category = "safety";
    evidence.push(`safety keywords: ${safScore}`);
  } else {
    category = "education";
    evidence.push(`education keywords: ${eduScore}`);
  }

  // Determine document type
  const norm = normalize(combined);

  if (category === "medical") {
    if (
      norm.includes("ise giris") ||
      norm.includes("işe giriş") ||
      hint.docType === "ISE_GIRIS_MUAYENE"
    ) {
      docType = "ISE_GIRIS_MUAYENE";
    } else if (
      norm.includes("periyodik") ||
      hint.docType === "PERIYODIK_MUAYENE"
    ) {
      docType = "PERIYODIK_MUAYENE";
    } else if (norm.includes("odyometri")) {
      docType = "ODIOMETRI";
    } else if (norm.includes("solunum fonksiyon") || norm.includes("sft")) {
      docType = "SFT";
    } else if (norm.includes("akciğer") || norm.includes("akciger")) {
      docType = "AKCIGER_GRAFISI";
    } else if (norm.includes("lab") || norm.includes("tetkik") || norm.includes("hemogram")) {
      docType = "LAB_RESULT";
    } else if (norm.includes("sevk")) {
      docType = norm.includes("yanıt") || norm.includes("yanit") || norm.includes("sonuç")
        ? "SEVK_YANITI"
        : "SEVK_FORMU";
    } else if (norm.includes("aşı") || norm.includes("asi kaydi") || norm.includes("vaccination")) {
      docType = "ASI_KAYDI";
    } else if (norm.includes("sağlık raporu") || norm.includes("saglik raporu")) {
      docType = "SAGLIK_RAPORU";
    } else {
      docType = "OTHER_MEDICAL";
    }
  } else if (category === "safety") {
    if (norm.includes("risk değerlendirmesi") || norm.includes("risk degerlendirmesi")) {
      docType = "RISK_DEGERLENDIRMESI";
    } else if (norm.includes("ortam ölçüm") || norm.includes("ortam olcum")) {
      docType = "ORTAM_OLCUM_RAPORU";
    } else if (norm.includes("ramak kala")) {
      docType = "RAMAK_KALA";
    } else if (norm.includes("iş kazası") || norm.includes("is kazasi")) {
      docType = "IS_KAZASI_RAPORU";
    } else if (norm.includes("kkd teslim")) {
      docType = scope === "worker_list" ? "KKD_TESLIM_LISTESI" : "OTHER_SAFETY";
    } else {
      docType = "OTHER_SAFETY";
    }
  } else if (category === "education") {
    if (scope === "worker_list" || norm.includes("katılım") || norm.includes("katilim")) {
      docType = "EGITIM_KATILIM_LISTESI";
    } else {
      docType = "EGITIM_DOKUMANI";
    }
  }

  // Worker list document type overrides
  if (scope === "worker_list") {
    if (norm.includes("personel") || norm.includes("çalışan") || norm.includes("calisan")) {
      docType = "EMPLOYEE_ROSTER";
    } else if (norm.includes("aşı") || norm.includes("asi listesi") || norm.includes("vaccination list")) {
      docType = "VACCINATION_LIST";
    } else if (norm.includes("kkd") && scope === "worker_list") {
      docType = "PPE_DELIVERY_LIST";
    } else if (norm.includes("muayene") && scope === "worker_list") {
      docType = "EXAM_TRACKING_LIST";
    } else if (norm.includes("sevk") && scope === "worker_list") {
      docType = "REFERRAL_TRACKING_LIST";
    } else if (norm.includes("departman") || norm.includes("görev") || norm.includes("gorev")) {
      docType = "DEPARTMENT_ASSIGNMENT_LIST";
    }
  }

  // Final scope refinement if still unknown
  if (scope === "unknown") {
    if (category === "safety" && docType !== "IS_KAZASI_RAPORU") {
      scope = "company_level";
    } else if (docType === "IS_KAZASI_RAPORU") {
      scope = "incident_level";
    } else if (hasTckn || medScore >= 2) {
      scope = "single_worker";
    } else {
      scope = "unknown";
    }
  }

  // Compute confidence
  const keywordTotal = medScore + safScore + eduScore + rosScore;
  confidence = Math.min(
    0.95,
    0.3 +
      (keywordTotal * 0.05) +
      (hint.category ? 0.1 : 0) +
      (docType !== "UNKNOWN" && docType !== "OTHER_MEDICAL" && docType !== "OTHER_SAFETY" ? 0.1 : 0) +
      (scope !== "unknown" ? 0.05 : 0)
  );

  const needsReview =
    confidence < 0.5 ||
    docType === "UNKNOWN" ||
    scope === "unknown" ||
    (scope === "single_worker" && !hasTckn && medScore < 2);

  return {
    category,
    documentType: docType,
    documentScope: scope,
    confidence,
    source: hint.category ? "FOLDER_HINT" : "HEURISTIC",
    evidence,
    needsReview,
  };
}
