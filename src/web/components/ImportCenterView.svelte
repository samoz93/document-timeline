<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Company } from "$lib/types.ts";
  import { api } from "$lib/api.ts";

  export let company: Company | null;

  const dispatch = createEventDispatcher();

  type ZoneId = "company_registry" | "archive_folder" | "worker_list" | "classification_seed" | "template_library" | "verified_corrections";

  type ZoneState = {
    id: ZoneId;
    title: string;
    description: string;
    accept: string;
    acceptFolder?: boolean;
    status: "idle" | "parsing" | "preview" | "confirming" | "done" | "error";
    preview: unknown;
    error: string | null;
    result: unknown;
    dragging: boolean;
  };

  const zones: ZoneState[] = [
    {
      id: "company_registry",
      title: "Company Registry",
      description: "Import companies from Excel/CSV. Auto-detects SGK numbers, names, hazard class.",
      accept: ".xlsx,.xls,.csv",
      status: "idle", preview: null, error: null, result: null, dragging: false,
    },
    {
      id: "archive_folder",
      title: "Archive Folder",
      description: "Point to a folder (or multi-company root) to index all documents.",
      accept: "",
      acceptFolder: true,
      status: "idle", preview: null, error: null, result: null, dragging: false,
    },
    {
      id: "worker_list",
      title: "Worker List",
      description: "Import a worker list snapshot (Excel). Auto-detects TCKN, names, departments.",
      accept: ".xlsx,.xls",
      status: "idle", preview: null, error: null, result: null, dragging: false,
    },
    {
      id: "classification_seed",
      title: "Classification Rules",
      description: "Seed classification rules from JSON or Excel.",
      accept: ".json,.xlsx,.xls",
      status: "idle", preview: null, error: null, result: null, dragging: false,
    },
    {
      id: "template_library",
      title: "Template Library",
      description: "Index a folder of blank template files to build fingerprints.",
      accept: "",
      acceptFolder: true,
      status: "idle", preview: null, error: null, result: null, dragging: false,
    },
    {
      id: "verified_corrections",
      title: "Verified Corrections",
      description: "Apply manual corrections from JSON or Excel (matched by file hash or name).",
      accept: ".json,.xlsx,.xls",
      status: "idle", preview: null, error: null, result: null, dragging: false,
    },
  ];

  // Track zone states reactively
  let zoneStates: Record<ZoneId, ZoneState> = Object.fromEntries(
    zones.map((z) => [z.id, { ...z }])
  ) as Record<ZoneId, ZoneState>;

  // Manual path input for folder zones
  let folderInputs: Record<ZoneId, string> = {
    company_registry: "",
    archive_folder: "",
    worker_list: "",
    classification_seed: "",
    template_library: "",
    verified_corrections: "",
  };

  let archiveMode: "single_company" | "multi_company_root" = "single_company";

  // ─── Drag and drop ────────────────────────────────────────────────────────

  function onDragOver(zoneId: ZoneId, e: DragEvent) {
    e.preventDefault();
    zoneStates[zoneId].dragging = true;
  }
  function onDragLeave(zoneId: ZoneId) {
    zoneStates[zoneId].dragging = false;
  }
  function onDrop(zoneId: ZoneId, e: DragEvent) {
    e.preventDefault();
    zoneStates[zoneId].dragging = false;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0]!;
      // In Electron/Bun desktop context the path is available; in browser it won't be
      const filePath = (file as unknown as { path?: string }).path ?? file.name;
      handleFilePath(zoneId, filePath);
    }
  }

  function onFileInput(zoneId: ZoneId, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const filePath = (file as unknown as { path?: string }).path ?? file.name;
    handleFilePath(zoneId, filePath);
  }

  function onFolderInput(zoneId: ZoneId, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const path = folderInputs[zoneId]?.trim();
    if (path) handleFilePath(zoneId, path);
  }

  function handleFilePath(zoneId: ZoneId, filePath: string) {
    zoneStates[zoneId].error = null;
    zoneStates[zoneId].preview = null;
    zoneStates[zoneId].result = null;
    zoneStates = { ...zoneStates };
    runPreview(zoneId, filePath);
  }

  // ─── Preview ─────────────────────────────────────────────────────────────

  async function runPreview(zoneId: ZoneId, filePath: string) {
    zoneStates[zoneId].status = "parsing";
    zoneStates = { ...zoneStates };

    try {
      let preview: unknown;

      switch (zoneId) {
        case "company_registry":
          preview = await api.call("previewCompanyRegistryImport", { filePath });
          break;
        case "archive_folder":
          preview = await api.call("previewArchiveFolderImport", {
            folderPath: filePath,
            mode: archiveMode,
            companyId: company?.id,
          });
          break;
        case "worker_list":
          preview = await api.call("previewWorkerListImport", {
            filePath,
            companyId: company?.id ?? "",
          });
          break;
        case "classification_seed":
          preview = await api.call("previewClassificationSeedImport", { filePath });
          break;
        case "template_library":
          preview = await api.call("previewTemplateLibraryImport", { inputPath: filePath });
          break;
        case "verified_corrections":
          preview = await api.call("previewVerifiedCorrectionsImport", { filePath });
          break;
      }

      zoneStates[zoneId].preview = preview;
      zoneStates[zoneId].status = "preview";
    } catch (e) {
      zoneStates[zoneId].error = String(e);
      zoneStates[zoneId].status = "error";
    }
    zoneStates = { ...zoneStates };
  }

  // ─── Confirm ─────────────────────────────────────────────────────────────

  async function confirmImport(zoneId: ZoneId) {
    const zone = zoneStates[zoneId];
    if (!zone.preview) return;
    zone.status = "confirming";
    zoneStates = { ...zoneStates };

    try {
      const p = zone.preview as Record<string, unknown>;
      let result: unknown;

      switch (zoneId) {
        case "company_registry":
          result = await api.call("confirmCompanyRegistryImport", {
            rows: p["rows"],
            skipMissingSgk: false,
            updateExisting: true,
          });
          break;
        case "archive_folder":
          result = await api.call("confirmArchiveFolderImport", {
            mode: (p["mode"] as string) ?? archiveMode,
            folderPath: p["sourcePath"],
            companyId: company?.id,
            subfolderMappings: p["subfolders"] ? (p["subfolders"] as Array<{ folderPath: string; matchedCompanyId: string | null }>)
              .filter((s) => s.matchedCompanyId)
              .map((s) => ({ folderPath: s.folderPath, companyId: s.matchedCompanyId! })) : undefined,
          });
          break;
        case "worker_list":
          result = await api.call("confirmWorkerListImport", {
            companyId: company?.id ?? "",
            documentId: "",
            listType: (p["detectedListType"] as string) ?? "unknown",
            snapshotDate: p["detectedSnapshotDate"] ?? null,
            snapshotDatePrecision: "day",
            snapshotDateSource: "filename",
            rows: p["rows"],
          });
          break;
        case "classification_seed":
          result = await api.call("confirmClassificationSeedImport", { rows: p["rows"] });
          break;
        case "template_library":
          result = await api.call("confirmTemplateLibraryImport", { rows: p["rows"] });
          break;
        case "verified_corrections":
          result = await api.call("confirmVerifiedCorrectionsImport", { rows: p["rows"] });
          break;
      }

      zoneStates[zoneId].result = result;
      zoneStates[zoneId].status = "done";
    } catch (e) {
      zoneStates[zoneId].error = String(e);
      zoneStates[zoneId].status = "error";
    }
    zoneStates = { ...zoneStates };
  }

  function resetZone(zoneId: ZoneId) {
    const original = zones.find((z) => z.id === zoneId)!;
    zoneStates[zoneId] = { ...original };
    zoneStates = { ...zoneStates };
  }

  function summaryText(preview: unknown): string {
    const p = preview as Record<string, unknown>;
    const s = p["summary"] as Record<string, unknown>;
    const parts: string[] = [];
    if (s["totalRows"] != null) parts.push(`${s["totalRows"]} rows`);
    if (s["totalFiles"] != null) parts.push(`${s["totalFiles"]} files`);
    if (s["supportedFiles"] != null) parts.push(`${s["supportedFiles"]} supported`);
    if (s["needsReviewCount"]) parts.push(`${s["needsReviewCount"]} need review`);
    return parts.join(" · ");
  }

  function resultText(result: unknown, zoneId: ZoneId): string {
    const r = result as Record<string, unknown>;
    switch (zoneId) {
      case "company_registry": return `Created: ${r["created"]} · Updated: ${r["updated"]} · Skipped: ${r["skipped"]}`;
      case "archive_folder": return `Indexing started for ${r["started"]} folder(s).`;
      case "worker_list": return `Snapshot rows created: ${r["rowsCreated"]}`;
      case "classification_seed": return `Imported: ${r["imported"]} · Skipped: ${r["skipped"]}`;
      case "template_library": return `Imported: ${r["imported"]} · Skipped: ${r["skipped"]}`;
      case "verified_corrections": return `Applied: ${r["applied"]} · Skipped: ${r["skipped"]}`;
    }
  }

  function statusColor(status: ZoneState["status"]): string {
    switch (status) {
      case "done": return "#22c55e";
      case "error": return "#ef4444";
      case "preview": return "#3b82f6";
      case "parsing": case "confirming": return "#f59e0b";
      default: return "#475569";
    }
  }
</script>

<div class="import-center">
  <header class="page-header">
    <h1>Import Center</h1>
    <p class="subtitle">Drop files or enter paths to import data. All imports are local-only — nothing leaves your machine.</p>
  </header>

  <div class="zones-grid">
    {#each zones as zone}
      {@const state = zoneStates[zone.id]}
      <div class="zone-card" class:dragging={state.dragging}>
        <div class="zone-header">
          <span class="zone-title">{zone.title}</span>
          <span class="zone-badge" style="background: {statusColor(state.status)}20; color: {statusColor(state.status)}">
            {state.status}
          </span>
        </div>
        <p class="zone-desc">{zone.description}</p>

        {#if state.status === "idle" || state.status === "error"}
          {#if zone.acceptFolder}
            <div class="folder-input-row">
              <input
                class="path-input"
                type="text"
                placeholder="/path/to/folder"
                bind:value={folderInputs[zone.id]}
              />
              <button class="btn-primary" on:click={() => {
                const p = folderInputs[zone.id]?.trim();
                if (p) handleFilePath(zone.id, p);
              }}>Preview</button>
            </div>
            {#if zone.id === "archive_folder"}
              <div class="mode-row">
                <label>
                  <input type="radio" bind:group={archiveMode} value="single_company" /> Single company
                </label>
                <label>
                  <input type="radio" bind:group={archiveMode} value="multi_company_root" /> Multi-company root
                </label>
              </div>
            {/if}
          {:else}
            <div
              class="drop-zone"
              on:dragover={(e) => onDragOver(zone.id, e)}
              on:dragleave={() => onDragLeave(zone.id)}
              on:drop={(e) => onDrop(zone.id, e)}
            >
              <span class="drop-label">Drop file here or</span>
              <label class="file-pick">
                Browse
                <input
                  type="file"
                  accept={zone.accept}
                  style="display:none"
                  on:change={(e) => onFileInput(zone.id, e)}
                />
              </label>
            </div>
          {/if}
          {#if state.error}
            <p class="error-msg">{state.error}</p>
          {/if}
        {/if}

        {#if state.status === "parsing" || state.status === "confirming"}
          <div class="spinner-row">
            <div class="spinner"></div>
            <span>{state.status === "parsing" ? "Parsing..." : "Importing..."}</span>
          </div>
        {/if}

        {#if state.status === "preview" && state.preview}
          {@const p = state.preview as Record<string, unknown>}
          <div class="preview-box">
            <div class="preview-summary">{summaryText(state.preview)}</div>

            {#if (p["warnings"] as string[])?.length > 0}
              <ul class="warn-list">
                {#each (p["warnings"] as string[]) as w}
                  <li>{w}</li>
                {/each}
              </ul>
            {/if}

            {#if zone.id === "archive_folder" && p["subfolders"]}
              <div class="subfolder-table">
                <table>
                  <thead><tr><th>Folder</th><th>Match</th><th>Files</th></tr></thead>
                  <tbody>
                    {#each (p["subfolders"] as Array<Record<string, unknown>>) as sf}
                      <tr class:unmatched={sf["matchMethod"] === "unmatched"}>
                        <td>{sf["folderName"]}</td>
                        <td>{sf["matchedCompanyName"] ?? "—"}</td>
                        <td>{sf["supportedFileCount"]}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if (p["rows"] as unknown[])?.length > 0}
              <div class="row-preview">
                <span class="row-count">{(p["rows"] as unknown[]).length} rows ready</span>
              </div>
            {/if}

            <div class="confirm-row">
              <button class="btn-primary" on:click={() => confirmImport(zone.id)}>Confirm Import</button>
              <button class="btn-ghost" on:click={() => resetZone(zone.id)}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if state.status === "done" && state.result}
          <div class="done-box">
            <span class="done-icon">✓</span>
            <span class="done-text">{resultText(state.result, zone.id)}</span>
            <button class="btn-ghost" on:click={() => resetZone(zone.id)}>Import Again</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .import-center {
    height: 100%;
    overflow-y: auto;
    padding: 24px;
    background: #0f1117;
    color: #e2e8f0;
  }
  .page-header {
    margin-bottom: 24px;
  }
  h1 {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 4px;
    color: #f1f5f9;
  }
  .subtitle {
    font-size: 13px;
    color: #64748b;
    margin: 0;
  }
  .zones-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  .zone-card {
    background: #151820;
    border: 1px solid #1e2433;
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 0.15s;
  }
  .zone-card.dragging {
    border-color: #3b82f6;
    background: #1a2035;
  }
  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .zone-title {
    font-size: 14px;
    font-weight: 600;
    color: #f1f5f9;
  }
  .zone-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .zone-desc {
    font-size: 12px;
    color: #64748b;
    margin: 0;
    line-height: 1.5;
  }
  .drop-zone {
    border: 1px dashed #2d3748;
    border-radius: 7px;
    padding: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 12px;
    color: #64748b;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .drop-zone:hover {
    border-color: #3b82f6;
  }
  .drop-label { color: #64748b; }
  .file-pick {
    color: #3b82f6;
    cursor: pointer;
    text-decoration: underline;
    font-size: 12px;
  }
  .folder-input-row {
    display: flex;
    gap: 6px;
  }
  .path-input {
    flex: 1;
    background: #1e2433;
    border: 1px solid #2d3748;
    color: #e2e8f0;
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 12px;
    font-family: monospace;
  }
  .path-input:focus {
    outline: none;
    border-color: #3b82f6;
  }
  .mode-row {
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: #94a3b8;
  }
  .mode-row label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .spinner-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #94a3b8;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #2d3748;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .preview-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .preview-summary {
    font-size: 12px;
    color: #94a3b8;
    background: #1e2433;
    border-radius: 5px;
    padding: 6px 10px;
  }
  .warn-list {
    margin: 0;
    padding: 0 0 0 14px;
    font-size: 11px;
    color: #f59e0b;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .subfolder-table {
    max-height: 160px;
    overflow-y: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th {
    text-align: left;
    color: #475569;
    padding: 3px 6px;
    border-bottom: 1px solid #1e2433;
  }
  td {
    color: #94a3b8;
    padding: 3px 6px;
  }
  tr.unmatched td { color: #ef4444; }
  .row-count {
    font-size: 11px;
    color: #64748b;
  }
  .confirm-row {
    display: flex;
    gap: 8px;
  }
  .done-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #14291f;
    border: 1px solid #166534;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .done-icon {
    color: #22c55e;
    font-size: 14px;
  }
  .done-text {
    flex: 1;
    font-size: 12px;
    color: #86efac;
  }
  .error-msg {
    font-size: 11px;
    color: #ef4444;
    margin: 0;
    background: #2a0f0f;
    padding: 6px 8px;
    border-radius: 4px;
  }
  .btn-primary {
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 5px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-primary:hover { background: #2563eb; }
  .btn-ghost {
    background: transparent;
    color: #64748b;
    border: 1px solid #2d3748;
    border-radius: 5px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-ghost:hover { color: #94a3b8; border-color: #475569; }
</style>
