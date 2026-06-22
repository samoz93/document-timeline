import { existsSync } from "fs";
import path from "path";
import type { Database } from "bun:sqlite";
import type { HazardClass } from "./domain.ts";
import {
  getIngestionStatus,
  listCompanies,
  createCompany,
  getCompany,
  updateCompany,
  searchDocuments,
  getDocumentById,
  listTimelineEvents,
  listPatients,
  getPatientById,
  listReviewItems,
  resolveReviewItem,
  listWorkerListSnapshots,
  getWorkerListSnapshotRows,
  compareWorkerSnapshots,
  updateDocumentMetadata,
  markDocumentVerified,
  getWorkspaceStats,
  getLatestIndexingJob,
  getDateEvidence,
  type SearchDocumentsInput,
} from "./db.ts";
import { scanCompanyFolder } from "./indexer.ts";
import { previewCompanyRegistryImport, confirmCompanyRegistryImport } from "./importers/companyRegistryImporter.ts";
import { previewArchiveFolderImport, confirmArchiveFolderImport } from "./importers/archivePreviewImporter.ts";
import { previewWorkerListImport, confirmWorkerListImport } from "./importers/workerListImporter.ts";
import { previewClassificationSeedImport, confirmClassificationSeedImport } from "./importers/classificationSeedImporter.ts";
import { previewTemplateLibraryImport, confirmTemplateLibraryImport } from "./importers/templateLibraryImporter.ts";
import { previewVerifiedCorrectionsImport, confirmVerifiedCorrectionsImport } from "./importers/verifiedCorrectionsImporter.ts";
import type { WorkerListType } from "./domain.ts";
import type { ConfirmWorkerListInput } from "./importers/workerListImporter.ts";
import type { ConfirmArchiveFolderInput } from "./importers/archivePreviewImporter.ts";

// ─── Safe file opener ─────────────────────────────────────────────────────────

async function openFileSafely(
  filePath: string,
  allowedRoots: string[]
): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const resolved = path.resolve(filePath);
  const isAllowed = allowedRoots.some((root) =>
    resolved.startsWith(path.resolve(root))
  );
  if (!isAllowed) {
    throw new Error(`File is outside allowed roots: ${filePath}`);
  }

  const platform = process.platform;
  let cmd: string[];
  if (platform === "darwin") {
    cmd = ["open", resolved];
  } else if (platform === "win32") {
    cmd = ["cmd", "/c", "start", "", resolved];
  } else {
    cmd = ["xdg-open", resolved];
  }

  await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

// ─── RPC dispatcher ───────────────────────────────────────────────────────────

export type RpcRequest = {
  method: string;
  params: unknown;
};

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export async function handleRpc(
  db: Database,
  req: RpcRequest
): Promise<RpcResponse> {
  try {
    const data = await dispatch(db, req.method, req.params);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function dispatch(
  db: Database,
  method: string,
  params: unknown
): Promise<unknown> {
  const p = params as Record<string, unknown>;

  switch (method) {
    // ── Companies ──────────────────────────────────────────────────────────
    case "listCompanies":
      return listCompanies(db);

    case "createCompany": {
      return createCompany(db, {
        name: String(p["name"] ?? ""),
        legal_name: p["legal_name"] ? String(p["legal_name"]) : null,
        short_name: p["short_name"] ? String(p["short_name"]) : null,
        hazard_class: (p["hazard_class"] as HazardClass) ?? "UNKNOWN",
        master_folder_path: p["master_folder_path"] ? String(p["master_folder_path"]) : null,
        notes: p["notes"] ? String(p["notes"]) : null,
      });
    }

    case "updateCompanyFolder": {
      const companyId = String(p["companyId"] ?? "");
      const folderPath = String(p["folderPath"] ?? "");
      updateCompany(db, companyId, { master_folder_path: folderPath });
      return { ok: true };
    }

    case "getCompany":
      return getCompany(db, String(p["companyId"] ?? ""));

    case "getWorkspaceStats":
      return getWorkspaceStats(db, String(p["companyId"] ?? ""));

    case "getIngestionStatus":
      return getIngestionStatus(db, String(p["companyId"] ?? ""));

    // ── Indexing ───────────────────────────────────────────────────────────
    case "startReindex": {
      const companyId = String(p["companyId"] ?? "");
      const company = getCompany(db, companyId);
      if (!company?.master_folder_path) throw new Error("No folder configured for company.");
      // Run in background, return job info immediately
      scanCompanyFolder(db, companyId, company.master_folder_path).catch((e) =>
        console.error("[reindex]", e)
      );
      return { started: true, folderPath: company.master_folder_path };
    }

    case "getIndexingStatus": {
      const companyId = String(p["companyId"] ?? "");
      return getLatestIndexingJob(db, companyId);
    }

    // ── Documents ──────────────────────────────────────────────────────────
    case "searchDocuments": {
      const input = p as SearchDocumentsInput;
      return searchDocuments(db, input);
    }

    case "getDocumentDetails": {
      const doc = getDocumentById(db, String(p["documentId"] ?? ""));
      if (!doc) return null;
      const evidence = getDateEvidence(db, doc.id);
      return { ...doc, dateEvidence: evidence };
    }

    case "openDocument": {
      const doc = getDocumentById(db, String(p["documentId"] ?? ""));
      if (!doc) throw new Error("Document not found.");
      const company = getCompany(db, doc.company_id);
      const allowedRoots = company?.master_folder_path ? [company.master_folder_path] : [];
      await openFileSafely(doc.file_path, allowedRoots);
      return { ok: true };
    }

    case "updateDocumentMetadata": {
      const { documentId, ...fields } = p as { documentId: string } & Parameters<typeof updateDocumentMetadata>[2];
      updateDocumentMetadata(db, documentId, fields);
      return getDocumentById(db, documentId);
    }

    case "markDocumentVerified": {
      markDocumentVerified(db, String(p["documentId"] ?? ""));
      return { ok: true };
    }

    // ── Timeline ───────────────────────────────────────────────────────────
    case "listTimeline": {
      return listTimelineEvents(db, String(p["companyId"] ?? ""), {
        patientId: p["patientId"] ? String(p["patientId"]) : undefined,
        year: p["year"] ? String(p["year"]) : undefined,
        limit: p["limit"] ? Number(p["limit"]) : undefined,
        offset: p["offset"] ? Number(p["offset"]) : undefined,
      });
    }

    // ── Workers ────────────────────────────────────────────────────────────
    case "listWorkers":
      return listPatients(db, String(p["companyId"] ?? ""), Number(p["limit"] ?? 100), Number(p["offset"] ?? 0));

    case "getWorkerTimeline": {
      const patientId = String(p["patientId"] ?? "");
      const patient = getPatientById(db, patientId);
      if (!patient) return null;
      const timeline = listTimelineEvents(db, patient.company_id, { patientId });
      return { patient, timeline };
    }

    // ── Review ─────────────────────────────────────────────────────────────
    case "listReviewItems": {
      return listReviewItems(db, String(p["companyId"] ?? ""), {
        status: p["status"] ? String(p["status"]) : undefined,
        limit: p["limit"] ? Number(p["limit"]) : undefined,
      });
    }

    case "resolveReviewItem": {
      const status = (p["status"] as "resolved" | "ignored") ?? "resolved";
      resolveReviewItem(db, String(p["reviewItemId"] ?? ""), status);
      return { ok: true };
    }

    // ── Lists ──────────────────────────────────────────────────────────────
    case "listWorkerListSnapshots":
      return listWorkerListSnapshots(db, String(p["companyId"] ?? ""));

    case "getWorkerListSnapshot": {
      const snapshotId = String(p["snapshotId"] ?? "");
      const rows = getWorkerListSnapshotRows(db, snapshotId);
      return { snapshotId, rows };
    }

    case "compareWorkerListSnapshots": {
      return compareWorkerSnapshots(
        db,
        String(p["previousSnapshotId"] ?? ""),
        String(p["currentSnapshotId"] ?? "")
      );
    }

    // ── Import: Company Registry ───────────────────────────────────────────
    case "previewCompanyRegistryImport":
      return previewCompanyRegistryImport(db, String(p["filePath"] ?? ""));

    case "confirmCompanyRegistryImport":
      return confirmCompanyRegistryImport(db, {
        rows: p["rows"] as Parameters<typeof confirmCompanyRegistryImport>[1]["rows"],
        skipMissingSgk: Boolean(p["skipMissingSgk"]),
        updateExisting: Boolean(p["updateExisting"]),
      });

    // ── Import: Archive Folder ─────────────────────────────────────────────
    case "previewArchiveFolderImport":
      return previewArchiveFolderImport(db, {
        folderPath: String(p["folderPath"] ?? ""),
        mode: (p["mode"] as "single_company" | "multi_company_root") ?? "single_company",
        companyId: p["companyId"] ? String(p["companyId"]) : undefined,
      });

    case "confirmArchiveFolderImport":
      return confirmArchiveFolderImport(
        db,
        p as ConfirmArchiveFolderInput,
        (dbInner, companyId, folderPath) => scanCompanyFolder(dbInner, companyId, folderPath)
      );

    // ── Import: Worker List ────────────────────────────────────────────────
    case "previewWorkerListImport":
      return previewWorkerListImport(db, {
        filePath: String(p["filePath"] ?? ""),
        companyId: String(p["companyId"] ?? ""),
        listTypeHint: p["listTypeHint"] as WorkerListType | undefined,
      });

    case "confirmWorkerListImport":
      return confirmWorkerListImport(db, p as ConfirmWorkerListInput);

    // ── Import: Classification Seed ────────────────────────────────────────
    case "previewClassificationSeedImport":
      return previewClassificationSeedImport(String(p["filePath"] ?? ""));

    case "confirmClassificationSeedImport":
      return confirmClassificationSeedImport(db, p["rows"] as Parameters<typeof confirmClassificationSeedImport>[1]);

    // ── Import: Template Library ───────────────────────────────────────────
    case "previewTemplateLibraryImport":
      return previewTemplateLibraryImport(String(p["inputPath"] ?? ""));

    case "confirmTemplateLibraryImport":
      return confirmTemplateLibraryImport(db, p["rows"] as Parameters<typeof confirmTemplateLibraryImport>[1]);

    // ── Import: Verified Corrections ───────────────────────────────────────
    case "previewVerifiedCorrectionsImport":
      return previewVerifiedCorrectionsImport(db, String(p["filePath"] ?? ""));

    case "confirmVerifiedCorrectionsImport":
      return confirmVerifiedCorrectionsImport(db, {
        rows: p["rows"] as Parameters<typeof confirmVerifiedCorrectionsImport>[1]["rows"],
      });

    default:
      throw new Error(`Unknown RPC method: ${method}`);
  }
}
