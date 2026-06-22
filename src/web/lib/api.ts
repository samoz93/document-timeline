const RPC_URL = "/rpc";

async function rpc<T>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const json = await res.json() as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "RPC error");
  return json.data as T;
}

import type {
  Company,
  Document,
  Patient,
  ReviewItem,
  TimelineEvent,
  WorkerListRow,
  WorkerListSnapshot,
  WorkerSnapshotDiff,
  WorkspaceStats,
} from "./types.ts";

export const api = {
  listCompanies: () => rpc<Company[]>("listCompanies"),

  createCompany: (input: Partial<Company>) =>
    rpc<Company>("createCompany", input),

  updateCompanyFolder: (companyId: string, folderPath: string) =>
    rpc<{ ok: boolean }>("updateCompanyFolder", { companyId, folderPath }),

  getWorkspaceStats: (companyId: string) =>
    rpc<WorkspaceStats>("getWorkspaceStats", { companyId }),

  startReindex: (companyId: string) =>
    rpc<{ started: boolean }>("startReindex", { companyId }),

  getIndexingStatus: (companyId: string) =>
    rpc<unknown>("getIndexingStatus", { companyId }),

  searchDocuments: (input: {
    companyId: string;
    query?: string;
    year?: string;
    category?: string[];
    documentType?: string[];
    documentScope?: string[];
    needsReview?: boolean;
    dateMismatch?: boolean;
    patientId?: string;
    limit?: number;
    offset?: number;
  }) => rpc<Document[]>("searchDocuments", input),

  getDocumentDetails: (documentId: string) =>
    rpc<Document & { dateEvidence: unknown[] }>("getDocumentDetails", { documentId }),

  openDocument: (documentId: string) =>
    rpc<{ ok: boolean }>("openDocument", { documentId }),

  updateDocumentMetadata: (documentId: string, fields: Partial<Document>) =>
    rpc<Document>("updateDocumentMetadata", { documentId, ...fields }),

  markDocumentVerified: (documentId: string) =>
    rpc<{ ok: boolean }>("markDocumentVerified", { documentId }),

  listTimeline: (params: {
    companyId: string;
    patientId?: string;
    year?: string;
    limit?: number;
  }) => rpc<TimelineEvent[]>("listTimeline", params),

  listWorkers: (companyId: string, limit = 100, offset = 0) =>
    rpc<Patient[]>("listWorkers", { companyId, limit, offset }),

  getWorkerTimeline: (patientId: string) =>
    rpc<{ patient: Patient; timeline: TimelineEvent[] }>("getWorkerTimeline", { patientId }),

  listReviewItems: (companyId: string, status?: string) =>
    rpc<ReviewItem[]>("listReviewItems", { companyId, status }),

  resolveReviewItem: (reviewItemId: string, status: "resolved" | "ignored" = "resolved") =>
    rpc<{ ok: boolean }>("resolveReviewItem", { reviewItemId, status }),

  listWorkerListSnapshots: (companyId: string) =>
    rpc<WorkerListSnapshot[]>("listWorkerListSnapshots", { companyId }),

  getWorkerListSnapshot: (snapshotId: string) =>
    rpc<{ snapshotId: string; rows: WorkerListRow[] }>("getWorkerListSnapshot", { snapshotId }),

  compareWorkerListSnapshots: (previousSnapshotId: string, currentSnapshotId: string) =>
    rpc<WorkerSnapshotDiff>("compareWorkerListSnapshots", { previousSnapshotId, currentSnapshotId }),

  getIngestionStatus: (companyId: string) =>
    rpc<unknown>("getIngestionStatus", { companyId }),

  // Generic call for import center and other dynamic methods
  call: <T = unknown>(method: string, params: unknown = {}) => rpc<T>(method, params),
};
