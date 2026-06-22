import { v4 as uuidv4 } from "uuid";
import type { Database } from "bun:sqlite";
import type { DocumentType, TimelineEventType } from "./domain.ts";
import { insertTimelineEvent } from "./db.ts";

function docTypeToEventType(docType: DocumentType): TimelineEventType {
  switch (docType) {
    case "PERIYODIK_MUAYENE": return "periodic_exam_found";
    case "ISE_GIRIS_MUAYENE": return "entry_exam_found";
    case "ODIOMETRI":
    case "SFT":
    case "AKCIGER_GRAFISI":
    case "LAB_RESULT": return "test_report_found";
    case "SEVK_FORMU": return "referral_created";
    case "SEVK_YANITI": return "referral_response_found";
    case "EMPLOYEE_ROSTER":
    case "DEPARTMENT_ASSIGNMENT_LIST":
    case "VACCINATION_LIST":
    case "EXAM_TRACKING_LIST":
    case "REFERRAL_TRACKING_LIST":
    case "KKD_TESLIM_LISTESI":
    case "PPE_DELIVERY_LIST": return "worker_list_snapshot";
    case "EGITIM_KATILIM_LISTESI": return "training_list_snapshot";
    case "RISK_DEGERLENDIRMESI": return "risk_assessment_found";
    case "ORTAM_OLCUM_RAPORU": return "measurement_report_found";
    case "IS_KAZASI_RAPORU": return "incident_report_found";
    case "RAMAK_KALA": return "near_miss_found";
    default: return "unknown_document_found";
  }
}

function buildTitle(docType: DocumentType, fileName: string, patientName?: string): string {
  const labels: Partial<Record<DocumentType, string>> = {
    PERIYODIK_MUAYENE: "Periyodik Muayene",
    ISE_GIRIS_MUAYENE: "İşe Giriş Muayenesi",
    SAGLIK_RAPORU: "Sağlık Raporu",
    ODIOMETRI: "Odyometri Testi",
    SFT: "Solunum Fonksiyon Testi",
    AKCIGER_GRAFISI: "Akciğer Grafisi",
    LAB_RESULT: "Lab Sonuçları",
    SEVK_FORMU: "Sevk Formu",
    SEVK_YANITI: "Sevk Yanıtı",
    ASI_KAYDI: "Aşı Kaydı",
    RISK_DEGERLENDIRMESI: "Risk Değerlendirmesi",
    ORTAM_OLCUM_RAPORU: "Ortam Ölçüm Raporu",
    RAMAK_KALA: "Ramak Kala Olayı",
    IS_KAZASI_RAPORU: "İş Kazası Raporu",
    EGITIM_DOKUMANI: "Eğitim Dokümanı",
    EGITIM_KATILIM_LISTESI: "Eğitim Katılım Listesi",
    KKD_TESLIM_LISTESI: "KKD Teslim Listesi",
    EMPLOYEE_ROSTER: "Personel Listesi",
    DEPARTMENT_ASSIGNMENT_LIST: "Departman Listesi",
    VACCINATION_LIST: "Aşı Listesi",
    EXAM_TRACKING_LIST: "Muayene Takip Listesi",
    REFERRAL_TRACKING_LIST: "Sevk Takip Listesi",
    PPE_DELIVERY_LIST: "KKD Teslim Listesi",
  };

  const label = labels[docType] ?? fileName;
  return patientName ? `${label} — ${patientName}` : label;
}

export function createTimelineEventForDocument(
  db: Database,
  params: {
    companyId: string;
    documentId: string;
    documentType: DocumentType;
    patientId: string | null;
    patientName?: string;
    eventDate: string | null;
    eventDatePrecision: string;
    eventDateSource: string;
    confidence: number;
    needsReview: boolean;
    fileName: string;
  }
): void {
  const eventType = docTypeToEventType(params.documentType);
  const title = buildTitle(params.documentType, params.fileName, params.patientName);

  insertTimelineEvent(db, {
    id: uuidv4(),
    company_id: params.companyId,
    patient_id: params.patientId,
    document_id: params.documentId,
    event_type: eventType,
    event_date: params.eventDate,
    event_date_precision: params.eventDatePrecision as any,
    event_date_source: params.eventDateSource,
    title,
    summary: null,
    confidence: params.confidence,
    needs_review: params.needsReview ? 1 : 0,
  });
}
