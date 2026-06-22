import type {
  ClassificationResult,
  DocumentCategory,
  DocumentDateEvidence,
  DocumentScope,
  DocumentType,
} from "./domain.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LlmClassificationSuggestion = {
  category: DocumentCategory;
  documentType: DocumentType;
  documentScope: DocumentScope;
  suggestedLabel?: string;
  confidence: number;
  reasoningSummary: string;
  evidence: string[];
  shouldCreateReviewItem: boolean;
};

export type LocalLlmClassifierInput = {
  fileName: string;
  folderPath: string;
  extractedTextSnippet: string;
  heuristicResult: ClassificationResult;
  dateEvidence: DocumentDateEvidence[];
};

export type LocalLlmClassifier = {
  isAvailable(): Promise<boolean>;
  classify(input: LocalLlmClassifierInput): Promise<LlmClassificationSuggestion>;
};

// ─── No-op adapter (default — disabled in MVP) ────────────────────────────────

export const disabledLocalLlmClassifier: LocalLlmClassifier = {
  async isAvailable() {
    return false;
  },
  async classify() {
    throw new Error("Local LLM classifier is disabled.");
  },
};

// ─── Ollama adapter skeleton ──────────────────────────────────────────────────
// TODO: wire this up when a local Ollama instance is available.
// The model must be running locally — no cloud calls.
//
// Example: ollama pull mistral or ollama pull phi3:mini
// Then enable by setting HEALTHARCH_LLM=ollama in environment.

export function makeOllamaClassifier(params: {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): LocalLlmClassifier {
  const baseUrl = params.baseUrl ?? "http://localhost:11434";
  const model = params.model ?? "phi3:mini";
  const timeoutMs = params.timeoutMs ?? 8000;

  return {
    async isAvailable() {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
        clearTimeout(t);
        return res.ok;
      } catch {
        return false;
      }
    },

    async classify(input: LocalLlmClassifierInput): Promise<LlmClassificationSuggestion> {
      const snippet = input.extractedTextSnippet.slice(0, 800).replace(/\n+/g, " ").trim();
      const dateHints = input.dateEvidence
        .slice(0, 3)
        .map((d) => `${d.source}:${d.date}`)
        .join(", ");

      const prompt = `You are classifying an occupational health document. Respond ONLY with valid JSON.

File: ${input.fileName}
Folder: ${input.folderPath}
Dates found: ${dateHints || "none"}
Text snippet: ${snippet || "(no text extracted)"}
Heuristic guess: type=${input.heuristicResult.documentType}, scope=${input.heuristicResult.documentScope}, confidence=${input.heuristicResult.confidence.toFixed(2)}

Classify this document. Choose documentType from:
ISE_GIRIS_MUAYENE, PERIYODIK_MUAYENE, SAGLIK_RAPORU, ODIOMETRI, SFT, AKCIGER_GRAFISI, LAB_RESULT,
SEVK_FORMU, SEVK_YANITI, ASI_KAYDI, RISK_DEGERLENDIRMESI, ORTAM_OLCUM_RAPORU, RAMAK_KALA,
IS_KAZASI_RAPORU, EGITIM_DOKUMANI, EGITIM_KATILIM_LISTESI, KKD_TESLIM_LISTESI,
EMPLOYEE_ROSTER, DEPARTMENT_ASSIGNMENT_LIST, VACCINATION_LIST, EXAM_TRACKING_LIST,
REFERRAL_TRACKING_LIST, PPE_DELIVERY_LIST, TEMPLATE, MEDIA,
OTHER_MEDICAL, OTHER_SAFETY, OTHER_ADMINISTRATIVE, UNKNOWN

Choose documentScope from: single_worker, worker_list, company_level, department_level, incident_level, template, media, unknown
Choose category from: medical, safety, education, template, media, administrative, unknown

Respond with JSON only:
{"category":"...","documentType":"...","documentScope":"...","suggestedLabel":"...","confidence":0.0,"reasoningSummary":"...","evidence":["..."],"shouldCreateReviewItem":false}`;

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      let body: string;
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
        const data = await res.json() as { response: string };
        body = data.response;
      } catch (e) {
        clearTimeout(t);
        throw new Error(`Ollama request failed: ${String(e)}`);
      }

      // Extract JSON from response (model may wrap it in prose)
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("LLM response contained no JSON object");

      let parsed: Partial<LlmClassificationSuggestion>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error("LLM response JSON was malformed");
      }

      // Validate required fields; fall back to heuristic values if absent
      return {
        category: (parsed.category as DocumentCategory) ?? input.heuristicResult.category,
        documentType: (parsed.documentType as DocumentType) ?? input.heuristicResult.documentType,
        documentScope: (parsed.documentScope as DocumentScope) ?? input.heuristicResult.documentScope,
        suggestedLabel: parsed.suggestedLabel,
        confidence: typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
        reasoningSummary: (parsed.reasoningSummary ?? "").slice(0, 300),
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 5) : [],
        shouldCreateReviewItem: parsed.shouldCreateReviewItem ?? true,
      };
    },
  };
}

// ─── Pipeline: merge heuristic + optional LLM result ─────────────────────────

const LLM_TRIGGER_THRESHOLD = 0.65;

export async function classifyWithFallback(
  heuristicResult: ClassificationResult,
  input: LocalLlmClassifierInput,
  llm: LocalLlmClassifier
): Promise<ClassificationResult> {
  const needsFallback =
    heuristicResult.confidence < LLM_TRIGGER_THRESHOLD ||
    heuristicResult.documentType === "UNKNOWN" ||
    heuristicResult.documentScope === "unknown";

  if (!needsFallback) return heuristicResult;

  let available = false;
  try {
    available = await llm.isAvailable();
  } catch {
    available = false;
  }

  if (!available) {
    // Silently continue with heuristic — caller will create review item
    return heuristicResult;
  }

  let suggestion: LlmClassificationSuggestion;
  try {
    suggestion = await llm.classify(input);
  } catch (e) {
    console.warn("[llm-classifier] fallback failed:", String(e));
    return heuristicResult;
  }

  // LLM suggestion must not override manual corrections (caller's responsibility),
  // must not be treated as verified, and keeps needsReview = true if confidence < 0.80
  const mergedConfidence = Math.max(heuristicResult.confidence, suggestion.confidence);
  const needsReview =
    suggestion.shouldCreateReviewItem ||
    suggestion.confidence < 0.8 ||
    heuristicResult.needsReview;

  return {
    category: suggestion.category,
    documentType: suggestion.documentType,
    documentScope: suggestion.documentScope,
    suggestedLabel: suggestion.suggestedLabel,
    confidence: mergedConfidence,
    source: "LOCAL_LLM",
    evidence: [
      ...heuristicResult.evidence,
      `llm: ${suggestion.reasoningSummary}`,
      ...suggestion.evidence,
    ],
    needsReview,
  };
}
