<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Company } from "$lib/types.ts";
  import { api } from "$lib/api.ts";

  export let company: Company | null;

  // ─── Types ──────────────────────────────────────────────────────────────────

  type ZoneId =
    | "company_registry"
    | "archive_folder"
    | "worker_list"
    | "classification_seed"
    | "template_library"
    | "verified_corrections";

  type BadgeVariant = "orange" | "blue" | "green" | "gray" | "black";

  type ZoneDef = {
    id: ZoneId;
    title: string;
    subtitle: string;
    badge: string;
    badgeVariant: BadgeVariant;
    accept: string;
    acceptFolder: boolean;
    actionLabel: string;
  };

  type ZoneState = {
    status: "idle" | "parsing" | "preview" | "confirming" | "done" | "error";
    filePath: string;
    preview: Record<string, unknown> | null;
    result: Record<string, unknown> | null;
    error: string | null;
    dragging: boolean;
  };

  type IngestionStatus = {
    extractionQuality: number;
    extractionQualityDelta: number;
    activeJobProgress: number | null;
    activeJobStatus: string | null;
    recentAlerts: Array<{ id: string; severity: string; message: string; created_at: string }>;
    totalDocuments: number;
    processedToday: number;
  };

  // ─── Zone definitions ────────────────────────────────────────────────────────

  const zoneDefs: ZoneDef[] = [
    {
      id: "company_registry",
      title: "Company Registry",
      subtitle: "Excel, CSV, TSV",
      badge: "NEEDS MAPPING",
      badgeVariant: "orange",
      accept: ".xlsx,.xls,.csv,.tsv",
      acceptFolder: false,
      actionLabel: "Preview Mapping",
    },
    {
      id: "archive_folder",
      title: "Archive Folders",
      subtitle: "Full Directories, ZIP",
      badge: "READY TO INDEX",
      badgeVariant: "blue",
      accept: "",
      acceptFolder: true,
      actionLabel: "Preview Scan",
    },
    {
      id: "worker_list",
      title: "Worker Lists",
      subtitle: "Rosters, Vaccination Logs",
      badge: "LOCAL ONLY / KVKK",
      badgeVariant: "green",
      accept: ".xlsx,.xls,.csv",
      acceptFolder: false,
      actionLabel: "Compare Snapshots",
    },
    {
      id: "classification_seed",
      title: "Classification Seeds",
      subtitle: "Dictionaries, XML, YAML",
      badge: "RULE SEEDS",
      badgeVariant: "gray",
      accept: ".json,.xlsx,.xls,.yaml,.yml,.xml",
      acceptFolder: false,
      actionLabel: "Edit Keys",
    },
    {
      id: "template_library",
      title: "Template Library",
      subtitle: "Blank Forms, PDFs",
      badge: "CORE FORM",
      badgeVariant: "gray",
      accept: ".pdf,.docx,.doc,.xlsx,.xls",
      acceptFolder: true,
      actionLabel: "Browse",
    },
    {
      id: "verified_corrections",
      title: "Verified Corrections",
      subtitle: "JSON, CSV (Override data)",
      badge: "PRIORITY",
      badgeVariant: "black",
      accept: ".json,.csv,.xlsx",
      acceptFolder: false,
      actionLabel: "Debug Log",
    },
  ];

  // ─── State ───────────────────────────────────────────────────────────────────

  let zoneStates: Record<ZoneId, ZoneState> = Object.fromEntries(
    zoneDefs.map((z) => [
      z.id,
      { status: "idle", filePath: "", preview: null, result: null, error: null, dragging: false },
    ])
  ) as Record<ZoneId, ZoneState>;

  let folderInputs: Record<ZoneId, string> = Object.fromEntries(
    zoneDefs.map((z) => [z.id, ""])
  ) as Record<ZoneId, string>;

  let archiveMode: "single_company" | "multi_company_root" = "single_company";

  let ingestionStatus: IngestionStatus | null = null;
  let statusPollInterval: ReturnType<typeof setInterval> | null = null;

  // Live preview = last loaded corrections preview (shown at bottom)
  let livePreviewZone: ZoneId | null = null;

  onMount(() => {
    loadIngestionStatus();
    statusPollInterval = setInterval(loadIngestionStatus, 8000);
  });
  onDestroy(() => {
    if (statusPollInterval) clearInterval(statusPollInterval);
  });

  async function loadIngestionStatus() {
    if (!company) return;
    try {
      ingestionStatus = (await api.call("getIngestionStatus", { companyId: company.id })) as IngestionStatus;
    } catch { /* silent */ }
  }

  // ─── Drag & drop ─────────────────────────────────────────────────────────────

  function onDragOver(id: ZoneId, e: DragEvent) {
    e.preventDefault();
    zoneStates[id].dragging = true;
    zoneStates = { ...zoneStates };
  }
  function onDragLeave(id: ZoneId) {
    zoneStates[id].dragging = false;
    zoneStates = { ...zoneStates };
  }
  function onDrop(id: ZoneId, e: DragEvent) {
    e.preventDefault();
    zoneStates[id].dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const p = (file as unknown as { path?: string }).path ?? file.name;
      triggerPreview(id, p);
    }
    zoneStates = { ...zoneStates };
  }
  function onFileInput(id: ZoneId, e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) triggerPreview(id, (file as unknown as { path?: string }).path ?? file.name);
  }

  // ─── Preview ─────────────────────────────────────────────────────────────────

  function triggerPreview(id: ZoneId, filePath: string) {
    zoneStates[id] = { ...zoneStates[id], status: "parsing", filePath, error: null, preview: null, result: null };
    zoneStates = { ...zoneStates };
    runPreview(id, filePath);
  }

  async function runPreview(id: ZoneId, filePath: string) {
    try {
      let preview: unknown;
      switch (id) {
        case "company_registry":
          preview = await api.call("previewCompanyRegistryImport", { filePath }); break;
        case "archive_folder":
          preview = await api.call("previewArchiveFolderImport", {
            folderPath: filePath, mode: archiveMode, companyId: company?.id,
          }); break;
        case "worker_list":
          preview = await api.call("previewWorkerListImport", {
            filePath, companyId: company?.id ?? "",
          }); break;
        case "classification_seed":
          preview = await api.call("previewClassificationSeedImport", { filePath }); break;
        case "template_library":
          preview = await api.call("previewTemplateLibraryImport", { inputPath: filePath }); break;
        case "verified_corrections":
          preview = await api.call("previewVerifiedCorrectionsImport", { filePath }); break;
      }
      zoneStates[id] = { ...zoneStates[id], status: "preview", preview: preview as Record<string, unknown> };
      if (id === "verified_corrections") livePreviewZone = id;
    } catch (e) {
      zoneStates[id] = { ...zoneStates[id], status: "error", error: String(e) };
    }
    zoneStates = { ...zoneStates };
  }

  // ─── Confirm ─────────────────────────────────────────────────────────────────

  async function confirmImport(id: ZoneId) {
    const state = zoneStates[id];
    if (!state.preview) return;
    zoneStates[id] = { ...zoneStates[id], status: "confirming" };
    zoneStates = { ...zoneStates };

    try {
      const p = state.preview;
      let result: unknown;
      switch (id) {
        case "company_registry":
          result = await api.call("confirmCompanyRegistryImport", {
            rows: p["rows"], skipMissingSgk: false, updateExisting: true,
          }); break;
        case "archive_folder":
          result = await api.call("confirmArchiveFolderImport", {
            mode: (p["mode"] as string) ?? archiveMode,
            folderPath: p["sourcePath"],
            companyId: company?.id,
            subfolderMappings: (p["subfolders"] as Array<{ folderPath: string; matchedCompanyId: string | null }> | undefined)
              ?.filter((s) => s.matchedCompanyId)
              .map((s) => ({ folderPath: s.folderPath, companyId: s.matchedCompanyId! })),
          }); break;
        case "worker_list":
          result = await api.call("confirmWorkerListImport", {
            companyId: company?.id ?? "", documentId: "",
            listType: (p["detectedListType"] as string) ?? "unknown",
            snapshotDate: p["detectedSnapshotDate"] ?? null,
            snapshotDatePrecision: "day", snapshotDateSource: "filename",
            rows: p["rows"],
          }); break;
        case "classification_seed":
          result = await api.call("confirmClassificationSeedImport", { rows: p["rows"] }); break;
        case "template_library":
          result = await api.call("confirmTemplateLibraryImport", { rows: p["rows"] }); break;
        case "verified_corrections":
          result = await api.call("confirmVerifiedCorrectionsImport", { rows: p["rows"] }); break;
      }
      zoneStates[id] = { ...zoneStates[id], status: "done", result: result as Record<string, unknown> };
      loadIngestionStatus();
    } catch (e) {
      zoneStates[id] = { ...zoneStates[id], status: "error", error: String(e) };
    }
    zoneStates = { ...zoneStates };
  }

  function resetZone(id: ZoneId) {
    zoneStates[id] = { status: "idle", filePath: "", preview: null, result: null, error: null, dragging: false };
    zoneStates = { ...zoneStates };
    if (livePreviewZone === id) livePreviewZone = null;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function summarize(id: ZoneId, preview: Record<string, unknown>): string {
    const s = preview["summary"] as Record<string, unknown>;
    const rows = (preview["rows"] as unknown[])?.length ?? 0;
    if (id === "archive_folder") {
      const files = s["supportedFiles"] ?? s["totalFiles"] ?? 0;
      const yr = s["detectedYearRange"] as { from?: string; to?: string } | undefined;
      const yrStr = yr?.from ? `${yr.from}–${yr.to ?? yr.from}` : "";
      return `${files} files found${yrStr ? " · " + yrStr : ""}`;
    }
    if (id === "worker_list") {
      return `${s["totalRows"] ?? rows} Rows`;
    }
    return `${s["totalRows"] ?? rows} rows found${s["needsReviewCount"] ? " · " + s["needsReviewCount"] + " need review" : ""}`;
  }

  function subSummarize(id: ZoneId, preview: Record<string, unknown>): string {
    const s = preview["summary"] as Record<string, unknown>;
    if (id === "archive_folder") {
      const sub = (preview["subfolders"] as unknown[])?.length;
      if (sub) return `${sub} company folders detected`;
      const pdfs = (preview["rows"] as Array<{ ext: string }> | undefined)?.filter((r) => r.ext === ".pdf").length ?? 0;
      return pdfs ? `${pdfs} PDFs` : "";
    }
    if (id === "worker_list") {
      const snap = preview["detectedSnapshotDate"] as string | undefined;
      return snap ? `Last snapshot: ${snap.slice(0, 7).replace("-", " ")}` : "";
    }
    if (id === "company_registry") {
      const missing = s["needsReviewCount"];
      return missing ? `${missing} missing SGK` : "";
    }
    return "";
  }

  function resultText(id: ZoneId, result: Record<string, unknown>): string {
    switch (id) {
      case "company_registry": return `${result["created"]} created · ${result["updated"]} updated`;
      case "archive_folder": return `Indexing started for ${result["started"]} folder(s)`;
      case "worker_list": return `${result["rowsCreated"]} snapshot rows created`;
      case "classification_seed": return `${result["imported"]} rules imported`;
      case "template_library": return `${result["imported"]} templates fingerprinted`;
      case "verified_corrections": return `${result["applied"]} corrections applied`;
    }
  }

  function zoneStatusDot(status: ZoneState["status"]): string {
    switch (status) {
      case "done": return "#22c55e";
      case "error": return "#ef4444";
      case "preview": return "#3b82f6";
      case "parsing": case "confirming": return "#f59e0b";
      default: return "#475569";
    }
  }

  function zoneStatusLabel(state: ZoneState): string {
    switch (state.status) {
      case "idle": return "Idle";
      case "parsing": return "Parsing…";
      case "preview": return "Ready to Import";
      case "confirming": return "Importing…";
      case "done": return "Imported";
      case "error": return "Error";
    }
  }

  const badgeColors: Record<BadgeVariant, { bg: string; text: string }> = {
    orange: { bg: "#f97316", text: "#fff" },
    blue:   { bg: "#3b82f6", text: "#fff" },
    green:  { bg: "#22c55e", text: "#fff" },
    gray:   { bg: "#334155", text: "#94a3b8" },
    black:  { bg: "#0f172a", text: "#e2e8f0" },
  };

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // Corrections live preview rows
  $: livePreviewRows = livePreviewZone
    ? ((zoneStates[livePreviewZone].preview?.["rows"] as Array<Record<string, unknown>> | undefined) ?? [])
    : [];
  $: livePreviewFile = livePreviewZone
    ? (zoneStates[livePreviewZone].preview?.["sourcePath"] as string | undefined)?.split("/").pop() ?? ""
    : "";
  $: livePreviewValid = livePreviewRows.filter((r) => r["matchStatus"] !== "unmatched").length;
</script>

<!-- ─── Top bar ─────────────────────────────────────────────────────────────── -->
<div class="import-shell">
  <div class="topbar">
    <div class="topbar-left">
      <span class="tb-company">{company?.short_name ?? company?.name ?? "No Company"}</span>
      {#if zoneStates.archive_folder.filePath}
        <span class="tb-sep">›</span>
        <span class="tb-path">{zoneStates.archive_folder.filePath.split(/[\\/]/).slice(-2).join(" › ")}</span>
      {/if}
    </div>
    <div class="topbar-center">
      <button class="tb-btn" on:click={() => {
        if (company) api.call("startReindex", { companyId: company.id }).then(loadIngestionStatus);
      }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 5 5h-1.5A3.5 3.5 0 1 1 8 4.5V3z"/><path d="M8 1v4l3-2-3-2z"/></svg>
        Reindex Folder
      </button>
      {#if ingestionStatus?.activeJobProgress != null}
        <div class="tb-progress">
          <span class="tb-prog-dot pulsing"></span>
          Processing: {ingestionStatus.activeJobProgress}%
        </div>
      {:else if ingestionStatus}
        <div class="tb-progress idle">
          <span class="tb-prog-dot"></span>
          {ingestionStatus.totalDocuments} docs indexed
        </div>
      {/if}
    </div>
    <div class="topbar-right">
      <button class="icon-btn" title="Refresh" on:click={loadIngestionStatus}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
      </button>
      <button class="icon-btn alert-btn" title="Alerts">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zm.995-14.901a1 1 0 1 0-1.99 0A5.002 5.002 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901z"/></svg>
        {#if (ingestionStatus?.recentAlerts?.length ?? 0) > 0}
          <span class="alert-dot"></span>
        {/if}
      </button>
    </div>
  </div>

  <!-- ─── Main layout ────────────────────────────────────────────────────────── -->
  <div class="main-layout">
    <!-- Left: cards + page header -->
    <div class="cards-area">
      <div class="page-head">
        <h1>Archive Import Center</h1>
        <p>Import company registries, archive folders, worker lists, templates, and verified corrections into the local timeline database.</p>
      </div>

      <div class="zones-grid">
        {#each zoneDefs as def}
          {@const state = zoneStates[def.id]}
          {@const badge = badgeColors[def.badgeVariant]}

          <div class="zone-card" class:dragging={state.dragging}>
            <!-- Card header -->
            <div class="card-head">
              <div class="card-icon">
                {#if def.id === "company_registry"}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                {:else if def.id === "archive_folder"}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                {:else if def.id === "worker_list"}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.85"/></svg>
                {:else if def.id === "classification_seed"}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                {:else if def.id === "template_library"}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                {/if}
              </div>
              <div class="card-title-block">
                <span class="card-title">{def.title}</span>
                <span class="card-subtitle">{def.subtitle}</span>
              </div>
              <span class="card-badge" style="background:{badge.bg}; color:{badge.text}">
                {def.badge}
              </span>
            </div>

            <!-- Drop zone / content area -->
            <div
              class="drop-area"
              class:has-content={state.status !== "idle" && state.status !== "error"}
              on:dragover={(e) => onDragOver(def.id, e)}
              on:dragleave={() => onDragLeave(def.id)}
              on:drop={(e) => onDrop(def.id, e)}
            >
              {#if state.status === "idle" || state.status === "error"}
                {#if def.acceptFolder}
                  <div class="drop-inner">
                    <svg class="drop-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                    <input
                      class="path-field"
                      type="text"
                      placeholder="/path/to/folder"
                      bind:value={folderInputs[def.id]}
                      on:keydown={(e) => { if (e.key === "Enter" && folderInputs[def.id].trim()) triggerPreview(def.id, folderInputs[def.id].trim()); }}
                    />
                    <button class="mini-btn" on:click={() => { if (folderInputs[def.id].trim()) triggerPreview(def.id, folderInputs[def.id].trim()); }}>
                      Preview
                    </button>
                    {#if def.id === "archive_folder"}
                      <div class="mode-pills">
                        <button class="pill" class:active={archiveMode === "single_company"} on:click={() => (archiveMode = "single_company")}>Single</button>
                        <button class="pill" class:active={archiveMode === "multi_company_root"} on:click={() => (archiveMode = "multi_company_root")}>Multi</button>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <label class="drop-inner clickable">
                    <svg class="drop-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span class="drop-label">Drop {def.accept ? "file" : "folder"} here</span>
                    <span class="drop-hint">{def.subtitle}</span>
                    <input type="file" accept={def.accept} style="display:none" on:change={(e) => onFileInput(def.id, e)} />
                  </label>
                {/if}
                {#if state.error}
                  <div class="inline-error">{state.error}</div>
                {/if}

              {:else if state.status === "parsing"}
                <div class="status-inner">
                  <div class="spinner"></div>
                  <span>Parsing file…</span>
                </div>

              {:else if state.status === "confirming"}
                <div class="status-inner">
                  <div class="spinner"></div>
                  <span>Importing…</span>
                </div>

              {:else if state.status === "preview" && state.preview}
                <div class="preview-inner">
                  <div class="preview-count">{summarize(def.id, state.preview)}</div>
                  {#if subSummarize(def.id, state.preview)}
                    <div class="preview-sub">{subSummarize(def.id, state.preview)}</div>
                  {/if}
                  {#if (state.preview["warnings"] as string[])?.length}
                    <div class="preview-warn">
                      ⚠ {(state.preview["warnings"] as string[])[0]}
                    </div>
                  {/if}
                </div>

              {:else if state.status === "done" && state.result}
                <div class="done-inner">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{resultText(def.id, state.result)}</span>
                </div>
              {/if}
            </div>

            <!-- Card footer -->
            <div class="card-footer">
              <div class="footer-status">
                <span class="status-dot" style="background:{zoneStatusDot(state.status)}"></span>
                <span class="status-label">
                  {#if state.status === "preview" && state.preview}
                    {(state.preview["status"] as string) === "needs_mapping" ? "Needs Mapping" :
                     (state.preview["status"] as string) === "has_errors" ? "Has Errors" : "Ready to Import"}
                  {:else}
                    {zoneStatusLabel(state)}
                  {/if}
                </span>
              </div>
              <div class="footer-actions">
                {#if state.status === "preview"}
                  <button class="action-link confirm" on:click={() => confirmImport(def.id)}>
                    Confirm Import
                  </button>
                  <button class="action-link" on:click={() => resetZone(def.id)}>Cancel</button>
                {:else if state.status === "done"}
                  <button class="action-link" on:click={() => resetZone(def.id)}>Import Again</button>
                {:else if state.status === "idle" || state.status === "error"}
                  <span class="action-link passive">{def.actionLabel}</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <!-- ─── Live Preview ──────────────────────────────────────────────────── -->
      {#if livePreviewZone && livePreviewRows.length > 0}
        <div class="live-preview">
          <div class="lp-header">
            <div class="lp-title-area">
              <span class="lp-label">Live Preview:</span>
              <span class="lp-batch">{livePreviewFile || "Correction Set"}</span>
              <span class="lp-badge rows">{livePreviewRows.length} ROWS</span>
              {#if livePreviewValid === livePreviewRows.length}
                <span class="lp-badge validated">VALIDATED</span>
              {:else}
                <span class="lp-badge partial">{livePreviewValid} / {livePreviewRows.length} MATCHED</span>
              {/if}
            </div>
            <div class="lp-actions">
              <button class="lp-discard" on:click={() => { livePreviewZone && resetZone(livePreviewZone); }}>Discard</button>
              <button class="lp-commit" on:click={() => { if (livePreviewZone) confirmImport(livePreviewZone); }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>
                Mark Verified &amp; Commit
              </button>
            </div>
          </div>

          <div class="lp-table-wrap">
            <table class="lp-table">
              <thead>
                <tr>
                  <th>SOURCE ID</th>
                  <th>DOCUMENT</th>
                  <th>FIELD PATH</th>
                  <th>ORIGINAL (OCR)</th>
                  <th>CORRECTION</th>
                  <th>CONFIDENCE</th>
                </tr>
              </thead>
              <tbody>
                {#each livePreviewRows.slice(0, 20) as row}
                  <tr class:unmatched={row["matchStatus"] === "unmatched"}>
                    <td class="mono">#{String(row["rowIndex"]).padStart(4, "0")}</td>
                    <td class="mono small">{(row["fileName"] as string | null)?.slice(0, 30) ?? row["fileHash"]?.toString().slice(0, 12) ?? "—"}</td>
                    <td class="mono small">{row["documentType"] ? "document_type" : row["manualDate"] ? "manual_date" : "document_scope"}</td>
                    <td class="original">
                      <span class="strikethrough">
                        {row["matchStatus"] === "unmatched" ? "—" :
                         row["documentType"] ? "UNKNOWN" :
                         row["manualDate"] ? "unset" : "—"}
                      </span>
                    </td>
                    <td class="correction">
                      {row["documentType"] ?? row["manualDate"] ?? row["documentScope"] ?? "—"}
                    </td>
                    <td>
                      <div class="conf-bar-wrap">
                        <div class="conf-bar" style="width:{row['matchStatus'] === 'hash_match' ? 98 : row['matchStatus'] === 'name_match' ? 75 : 0}%"></div>
                        <span class="conf-pct">
                          {row["matchStatus"] === "hash_match" ? "98%" :
                           row["matchStatus"] === "name_match" ? "75%" : "0%"}
                        </span>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>

    <!-- ─── Right panel ──────────────────────────────────────────────────────── -->
    <aside class="right-panel">
      <div class="rp-section-label">INGESTION STATUS</div>
      <div class="rp-section-label sub">EXTRACTION QUALITY</div>

      <div class="eq-block">
        <div class="eq-row">
          <span class="eq-pct">{ingestionStatus?.extractionQuality ?? "—"}%</span>
          {#if ingestionStatus?.extractionQualityDelta != null && ingestionStatus.extractionQualityDelta !== 0}
            <span class="eq-delta" class:pos={ingestionStatus.extractionQualityDelta > 0}>
              {ingestionStatus.extractionQualityDelta > 0 ? "+" : ""}{ingestionStatus.extractionQualityDelta}%
            </span>
          {/if}
        </div>
        <div class="eq-bar">
          <div class="eq-fill" style="width:{ingestionStatus?.extractionQuality ?? 0}%"></div>
        </div>
      </div>

      <div class="rp-section-label">PROCESSING QUEUES</div>
      <div class="queue-list">
        <div class="queue-item">
          <span class="queue-name">Text Extraction</span>
          <span class="queue-status" class:active={ingestionStatus?.activeJobStatus === "running"}>
            {ingestionStatus?.activeJobStatus === "running" ? "Active" : "Idle"}
          </span>
          <div class="queue-bar">
            <div class="queue-fill text-ext" style="width:{ingestionStatus?.activeJobProgress ?? 0}%"></div>
          </div>
        </div>
        <div class="queue-item">
          <span class="queue-name">Entity Resolution</span>
          <span class="queue-status">Pending</span>
          <div class="queue-bar">
            <div class="queue-fill ent-res" style="width:30%"></div>
          </div>
        </div>
      </div>

      <div class="rp-section-label">RECENT ALERTS</div>
      <div class="alerts-list">
        {#if (ingestionStatus?.recentAlerts?.length ?? 0) === 0}
          <div class="alert-empty">No open alerts</div>
        {:else}
          {#each (ingestionStatus?.recentAlerts ?? []) as alert}
            <div class="alert-item" class:err={alert.severity === "high"} class:warn={alert.severity !== "high"}>
              <span class="alert-icon">{alert.severity === "high" ? "⊗" : "△"}</span>
              <span class="alert-msg">{alert.message}</span>
            </div>
          {/each}
        {/if}
      </div>

      {#if ingestionStatus}
        <div class="rp-stats">
          <div class="rp-stat">
            <span class="rp-stat-n">{ingestionStatus.totalDocuments.toLocaleString()}</span>
            <span class="rp-stat-l">Total docs</span>
          </div>
          <div class="rp-stat">
            <span class="rp-stat-n">{ingestionStatus.processedToday}</span>
            <span class="rp-stat-l">Today</span>
          </div>
        </div>
      {/if}

      <button class="goto-review" on:click={() => {/* emit navigate */}}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>
        Go to Review Queue
      </button>
    </aside>
  </div>
</div>

<style>
  /* ─── Shell ───────────────────────────────────────────────────────────────── */
  .import-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #0f1117;
    color: #e2e8f0;
    font-size: 13px;
  }

  /* ─── Top bar ─────────────────────────────────────────────────────────────── */
  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 20px;
    height: 46px;
    min-height: 46px;
    background: #0a0d14;
    border-bottom: 1px solid #1e2433;
    flex-shrink: 0;
  }
  .topbar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .tb-company {
    font-weight: 700;
    color: #f1f5f9;
    font-size: 14px;
    white-space: nowrap;
  }
  .tb-sep { color: #334155; }
  .tb-path {
    font-size: 12px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .topbar-center {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .tb-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    background: #1e2433;
    border: 1px solid #2d3748;
    color: #94a3b8;
    border-radius: 5px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tb-btn:hover { background: #263248; color: #e2e8f0; }
  .tb-progress {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #94a3b8;
    background: #1e2433;
    border: 1px solid #2d3748;
    border-radius: 5px;
    padding: 4px 10px;
    white-space: nowrap;
  }
  .tb-progress.idle { color: #475569; }
  .tb-prog-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #475569;
    flex-shrink: 0;
  }
  .tb-prog-dot.pulsing {
    background: #f59e0b;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .topbar-right { display: flex; align-items: center; gap: 6px; }
  .icon-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    position: relative;
  }
  .icon-btn:hover { color: #94a3b8; background: #1e2433; }
  .alert-dot {
    position: absolute;
    top: 2px; right: 2px;
    width: 6px; height: 6px;
    background: #ef4444;
    border-radius: 50%;
    border: 1px solid #0a0d14;
  }

  /* ─── Main layout ─────────────────────────────────────────────────────────── */
  .main-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
    gap: 0;
  }
  .cards-area {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* ─── Page header ─────────────────────────────────────────────────────────── */
  .page-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
  }
  .page-head h1 {
    font-size: 18px;
    font-weight: 700;
    color: #f1f5f9;
    margin: 0;
    white-space: nowrap;
  }
  .page-head p {
    font-size: 11px;
    color: #475569;
    margin: 0;
    line-height: 1.5;
  }

  /* ─── Zones grid ──────────────────────────────────────────────────────────── */
  .zones-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  @media (max-width: 900px) {
    .zones-grid { grid-template-columns: repeat(2, 1fr); }
  }

  /* ─── Zone card ───────────────────────────────────────────────────────────── */
  .zone-card {
    background: #141820;
    border: 1px solid #1e2433;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .zone-card.dragging { border-color: #3b82f6; }
  .card-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 12px 0;
  }
  .card-icon {
    width: 36px; height: 36px;
    background: #1e2433;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
    flex-shrink: 0;
  }
  .card-title-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .card-title {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    line-height: 1.2;
  }
  .card-subtitle {
    font-size: 10px;
    color: #475569;
  }
  .card-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 3px 7px;
    border-radius: 8px;
    letter-spacing: 0.4px;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 2px;
  }

  /* ─── Drop area ───────────────────────────────────────────────────────────── */
  .drop-area {
    flex: 1;
    margin: 10px 12px;
    border: 1.5px dashed #1e2433;
    border-radius: 7px;
    min-height: 88px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: border-color 0.15s, background 0.15s;
  }
  .dragging .drop-area { border-color: #3b82f6; background: #1a2035; }
  .drop-area.has-content { border-style: solid; border-color: #1e2433; }
  .drop-inner {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 10px;
    cursor: pointer;
  }
  .drop-inner.clickable:hover .drop-icon { color: #3b82f6; }
  .drop-icon { color: #334155; transition: color 0.15s; }
  .drop-label { font-size: 11px; color: #64748b; }
  .drop-hint { font-size: 10px; color: #334155; }
  .path-field {
    width: 100%;
    background: #0f1117;
    border: 1px solid #2d3748;
    color: #94a3b8;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    font-family: monospace;
    box-sizing: border-box;
  }
  .path-field:focus { outline: none; border-color: #3b82f6; }
  .mini-btn {
    background: #1e2433;
    border: 1px solid #2d3748;
    color: #94a3b8;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    align-self: flex-end;
  }
  .mini-btn:hover { background: #263248; color: #e2e8f0; }
  .mode-pills {
    display: flex;
    gap: 4px;
    align-self: flex-end;
  }
  .pill {
    background: transparent;
    border: 1px solid #2d3748;
    color: #475569;
    border-radius: 10px;
    padding: 2px 8px;
    font-size: 10px;
    cursor: pointer;
  }
  .pill.active { background: #1e2433; color: #94a3b8; border-color: #3b82f6; }
  .inline-error {
    font-size: 10px;
    color: #ef4444;
    padding: 4px 8px;
    background: #2a0f0f;
    border-radius: 0 0 5px 5px;
  }
  .status-inner {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 11px;
    color: #64748b;
    padding: 16px;
  }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid #1e2433;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .preview-inner {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
  }
  .preview-count {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
  }
  .preview-sub { font-size: 10px; color: #64748b; }
  .preview-warn { font-size: 10px; color: #f59e0b; }
  .done-inner {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    font-size: 11px;
    color: #86efac;
  }

  /* ─── Card footer ─────────────────────────────────────────────────────────── */
  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-top: 1px solid #1e2433;
  }
  .footer-status { display: flex; align-items: center; gap: 5px; }
  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-label { font-size: 11px; color: #64748b; }
  .footer-actions { display: flex; align-items: center; gap: 8px; }
  .action-link {
    font-size: 11px;
    font-weight: 600;
    color: #3b82f6;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }
  .action-link:hover { color: #60a5fa; }
  .action-link.passive { color: #475569; cursor: default; font-weight: 700; }
  .action-link.confirm { color: #22c55e; }
  .action-link.confirm:hover { color: #4ade80; }

  /* ─── Live preview ────────────────────────────────────────────────────────── */
  .live-preview {
    background: #141820;
    border: 1px solid #1e2433;
    border-radius: 10px;
    overflow: hidden;
  }
  .lp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #1e2433;
    gap: 12px;
    flex-wrap: wrap;
  }
  .lp-title-area { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lp-label { font-size: 12px; color: #64748b; }
  .lp-batch { font-size: 13px; font-weight: 600; color: #e2e8f0; }
  .lp-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 8px;
    letter-spacing: 0.3px;
  }
  .lp-badge.rows { background: #1e3a5f; color: #60a5fa; }
  .lp-badge.validated { background: #14291f; color: #22c55e; }
  .lp-badge.partial { background: #2a1f0f; color: #f59e0b; }
  .lp-actions { display: flex; align-items: center; gap: 8px; }
  .lp-discard {
    background: transparent;
    border: 1px solid #2d3748;
    color: #64748b;
    border-radius: 5px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .lp-discard:hover { color: #94a3b8; border-color: #475569; }
  .lp-commit {
    display: flex;
    align-items: center;
    gap: 5px;
    background: #1e2433;
    border: 1px solid #334155;
    color: #e2e8f0;
    border-radius: 5px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .lp-commit:hover { background: #263248; }
  .lp-table-wrap { overflow-x: auto; }
  .lp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .lp-table th {
    text-align: left;
    padding: 8px 14px;
    color: #475569;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #1e2433;
    white-space: nowrap;
  }
  .lp-table td {
    padding: 8px 14px;
    color: #94a3b8;
    border-bottom: 1px solid #1a1f2e;
    vertical-align: middle;
  }
  .lp-table tr.unmatched td { color: #475569; }
  .lp-table tr:last-child td { border-bottom: none; }
  .mono { font-family: monospace; }
  .small { font-size: 11px; }
  .original { color: #475569; }
  .strikethrough { text-decoration: line-through; }
  .correction { color: #e2e8f0; font-weight: 500; }
  .conf-bar-wrap { display: flex; align-items: center; gap: 6px; }
  .conf-bar {
    height: 5px;
    background: #22c55e;
    border-radius: 3px;
    min-width: 4px;
    max-width: 80px;
    transition: width 0.3s;
  }
  .conf-pct { font-size: 11px; color: #64748b; }

  /* ─── Right panel ─────────────────────────────────────────────────────────── */
  .right-panel {
    width: 220px;
    min-width: 220px;
    background: #0a0d14;
    border-left: 1px solid #1e2433;
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  .rp-section-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: #334155;
    text-transform: uppercase;
    margin-top: 6px;
  }
  .rp-section-label.sub {
    font-size: 9px;
    color: #475569;
    margin-top: -6px;
    letter-spacing: 0.5px;
  }
  .eq-block { display: flex; flex-direction: column; gap: 6px; }
  .eq-row { display: flex; align-items: baseline; gap: 6px; }
  .eq-pct { font-size: 26px; font-weight: 700; color: #e2e8f0; line-height: 1; }
  .eq-delta { font-size: 12px; font-weight: 600; color: #475569; }
  .eq-delta.pos { color: #22c55e; }
  .eq-bar {
    height: 5px;
    background: #1e2433;
    border-radius: 3px;
    overflow: hidden;
  }
  .eq-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #22c55e);
    border-radius: 3px;
    transition: width 0.6s;
  }
  .queue-list { display: flex; flex-direction: column; gap: 8px; }
  .queue-item { display: flex; flex-direction: column; gap: 3px; }
  .queue-name { font-size: 11px; color: #94a3b8; }
  .queue-status {
    font-size: 10px;
    color: #475569;
    align-self: flex-start;
  }
  .queue-status.active { color: #22c55e; }
  .queue-bar {
    height: 4px;
    background: #1e2433;
    border-radius: 2px;
    overflow: hidden;
  }
  .queue-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s;
  }
  .queue-fill.text-ext { background: #3b82f6; }
  .queue-fill.ent-res { background: #a855f7; }
  .alerts-list { display: flex; flex-direction: column; gap: 6px; }
  .alert-empty { font-size: 11px; color: #334155; }
  .alert-item {
    display: flex;
    gap: 6px;
    font-size: 10px;
    padding: 6px 8px;
    border-radius: 5px;
    line-height: 1.4;
  }
  .alert-item.err { background: #2a0f0f; color: #fca5a5; }
  .alert-item.warn { background: #2a1f0f; color: #fcd34d; }
  .alert-icon { flex-shrink: 0; margin-top: 1px; }
  .alert-msg { flex: 1; word-break: break-word; }
  .rp-stats {
    display: flex;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid #1e2433;
    margin-top: 4px;
  }
  .rp-stat { display: flex; flex-direction: column; gap: 2px; }
  .rp-stat-n { font-size: 16px; font-weight: 700; color: #e2e8f0; }
  .rp-stat-l { font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
  .goto-review {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: #1e2433;
    border: 1px solid #2d3748;
    color: #64748b;
    border-radius: 6px;
    padding: 8px;
    font-size: 11px;
    cursor: pointer;
    margin-top: auto;
  }
  .goto-review:hover { background: #263248; color: #94a3b8; }
</style>
