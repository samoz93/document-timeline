<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Company } from "$lib/types.ts";
  import { api } from "$lib/api.ts";

  export let company: Company | null;

  // ─── Types ───────────────────────────────────────────────────────────────────

  type ZoneId =
    | "company_registry"
    | "archive_folder"
    | "worker_list"
    | "classification_seed"
    | "template_library"
    | "verified_corrections";

  type BadgeVariant = "orange" | "blue" | "green" | "grayblue" | "gray" | "black";

  type ZoneDef = {
    id: ZoneId;
    title: string;
    subtitle: string;
    badge: string;
    badgeVariant: BadgeVariant;
    accept: string;
    acceptFolder: boolean;
    idleActionLabel: string;
  };

  type ZoneState = {
    phase: "resting" | "parsing" | "preview" | "confirming" | "done" | "error";
    filePath: string;
    preview: Record<string, unknown> | null;
    result: Record<string, unknown> | null;
    error: string | null;
    dragging: boolean;
  };

  type ImportCenterSummary = {
    company_registry:    { companyCount: number; lastImportAt: string | null; lastImportStatus: string | null };
    archive_folder:      { fileCount: number; lastJobStatus: string | null; lastJobProgress: number; lastJobAt: string | null };
    worker_list:         { snapshotCount: number; lastSnapshotDate: string | null; lastRowCount: number };
    classification_seed: { ruleCount: number; lastImportAt: string | null };
    template_library:    { templateCount: number; lastImportAt: string | null };
    verified_corrections:{ lastImportAt: string | null; lastImportStatus: string | null };
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

  // ─── Zone definitions ─────────────────────────────────────────────────────────

  const zoneDefs: ZoneDef[] = [
    {
      id: "company_registry",
      title: "Company Registry",
      subtitle: "Excel, CSV, TSV",
      badge: "NEEDS MAPPING",
      badgeVariant: "orange",
      accept: ".xlsx,.xls,.csv,.tsv",
      acceptFolder: false,
      idleActionLabel: "Preview Mapping",
    },
    {
      id: "archive_folder",
      title: "Archive Folders",
      subtitle: "Full Directories, ZIP",
      badge: "READY TO INDEX",
      badgeVariant: "blue",
      accept: "",
      acceptFolder: true,
      idleActionLabel: "Preview Scan",
    },
    {
      id: "worker_list",
      title: "Worker Lists",
      subtitle: "Rosters, Vaccination Logs",
      badge: "LOCAL ONLY / KVKK",
      badgeVariant: "green",
      accept: ".xlsx,.xls,.csv",
      acceptFolder: false,
      idleActionLabel: "Compare Snapshots",
    },
    {
      id: "classification_seed",
      title: "Classification Seeds",
      subtitle: "Dictionaries, XML, YAML",
      badge: "RULE SEEDS",
      badgeVariant: "grayblue",
      accept: ".json,.xlsx,.xls,.yaml,.yml",
      acceptFolder: false,
      idleActionLabel: "Edit Rules",
    },
    {
      id: "template_library",
      title: "Template Library",
      subtitle: "Blank Forms, PDFs",
      badge: "CORE FORM",
      badgeVariant: "gray",
      accept: ".pdf,.docx,.doc,.xlsx,.xls",
      acceptFolder: true,
      idleActionLabel: "Browse",
    },
    {
      id: "verified_corrections",
      title: "Verified Corrections",
      subtitle: "JSON, CSV (Override data)",
      badge: "PRIORITY",
      badgeVariant: "black",
      accept: ".json,.csv,.xlsx",
      acceptFolder: false,
      idleActionLabel: "Debug Log",
    },
  ];

  // ─── State ────────────────────────────────────────────────────────────────────

  let zoneStates: Record<ZoneId, ZoneState> = Object.fromEntries(
    zoneDefs.map((z) => [z.id, { phase: "resting", filePath: "", preview: null, result: null, error: null, dragging: false }])
  ) as Record<ZoneId, ZoneState>;

  let folderInputs: Record<ZoneId, string> = Object.fromEntries(zoneDefs.map((z) => [z.id, ""])) as Record<ZoneId, string>;
  let archiveMode: "single_company" | "multi_company_root" = "single_company";

  let summary: ImportCenterSummary | null = null;
  let ingestion: IngestionStatus | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let livePreviewZone: ZoneId | null = null;

  onMount(() => { refresh(); pollInterval = setInterval(refresh, 9000); });
  onDestroy(() => { if (pollInterval) clearInterval(pollInterval); });

  async function refresh() {
    if (!company) return;
    try {
      [summary, ingestion] = await Promise.all([
        api.call<ImportCenterSummary>("getImportCenterSummary", { companyId: company.id }),
        api.call<IngestionStatus>("getIngestionStatus", { companyId: company.id }),
      ]);
    } catch { /* silent */ }
  }

  // ─── Derived card status labels from summary ──────────────────────────────────

  function restingStatusLabel(id: ZoneId): string {
    if (!summary) return "Not configured";
    switch (id) {
      case "company_registry":
        return summary.company_registry.lastImportStatus === "done"
          ? `${summary.company_registry.companyCount} companies`
          : summary.company_registry.lastImportAt ? "Needs mapping" : "Not configured";
      case "archive_folder":
        if (!summary.archive_folder.lastJobAt) return "Not configured";
        return summary.archive_folder.lastJobStatus === "running" ? "Indexing…" :
               summary.archive_folder.lastJobStatus === "done" ? "Ready to index" : "Not configured";
      case "worker_list":
        return summary.worker_list.snapshotCount > 0
          ? `Imported · ${summary.worker_list.snapshotCount} snapshot${summary.worker_list.snapshotCount !== 1 ? "s" : ""}`
          : "Not configured";
      case "classification_seed":
        return summary.classification_seed.ruleCount > 0
          ? `Stable · v${summary.classification_seed.ruleCount} rules`
          : "Not configured";
      case "template_library":
        return summary.template_library.templateCount > 0
          ? `${summary.template_library.templateCount} templates active`
          : "Not configured";
      case "verified_corrections":
        if (!summary.verified_corrections.lastImportAt) return "Not configured";
        return summary.verified_corrections.lastImportStatus === "done" ? "Last import: OK" : "Last import: Failed";
    }
  }

  function restingStatusDot(id: ZoneId): string {
    if (!summary) return "#334155";
    switch (id) {
      case "company_registry":
        return summary.company_registry.lastImportAt ? "#f59e0b" : "#334155";
      case "archive_folder":
        return summary.archive_folder.lastJobStatus === "done" ? "#3b82f6"
             : summary.archive_folder.lastJobStatus === "running" ? "#f59e0b" : "#334155";
      case "worker_list":
        return summary.worker_list.snapshotCount > 0 ? "#22c55e" : "#334155";
      case "classification_seed":
        return summary.classification_seed.ruleCount > 0 ? "#64748b" : "#334155";
      case "template_library":
        return summary.template_library.templateCount > 0 ? "#22c55e" : "#334155";
      case "verified_corrections":
        return summary.verified_corrections.lastImportStatus === "done" ? "#22c55e"
             : summary.verified_corrections.lastImportAt ? "#ef4444" : "#334155";
    }
  }

  function restingLine1(id: ZoneId): string {
    if (!summary) return "";
    switch (id) {
      case "company_registry":
        return summary.company_registry.lastImportAt
          ? `${summary.company_registry.companyCount} companies registered`
          : "Drop company list to begin";
      case "archive_folder":
        return summary.archive_folder.fileCount > 0
          ? `${summary.archive_folder.fileCount.toLocaleString()} files found`
          : "Enter folder path to scan";
      case "worker_list":
        return summary.worker_list.lastRowCount > 0
          ? `${summary.worker_list.lastRowCount.toLocaleString()} Rows`
          : "Drop roster or vaccination log";
      case "classification_seed":
        return summary.classification_seed.ruleCount > 0
          ? `${summary.classification_seed.ruleCount} classification rules loaded`
          : "Drop classification map";
      case "template_library":
        return summary.template_library.templateCount > 0
          ? `${summary.template_library.templateCount} templates fingerprinted`
          : "Upload blank form";
      case "verified_corrections":
        return summary.verified_corrections.lastImportAt
          ? "Import Correction Set"
          : "Drop correction file";
    }
  }

  function restingLine2(id: ZoneId): string {
    if (!summary) return "";
    switch (id) {
      case "company_registry":
        return summary.company_registry.lastImportAt
          ? `Last import: ${fmtDate(summary.company_registry.lastImportAt)}`
          : "Supports Excel, CSV, TSV";
      case "archive_folder":
        return summary.archive_folder.lastJobAt
          ? `Last scan: ${fmtDate(summary.archive_folder.lastJobAt)}`
          : "Supports full directories";
      case "worker_list":
        return summary.worker_list.lastSnapshotDate
          ? `Last snapshot: ${summary.worker_list.lastSnapshotDate.slice(0, 7).replace("-", " ")}`
          : "TCKN masked · hash only";
      case "classification_seed":
        return summary.classification_seed.ruleCount > 0
          ? "Updates heuristic rule set"
          : "Updates global classification mapping";
      case "template_library":
        return summary.template_library.templateCount > 0
          ? "Used for anchor point detection"
          : "For anchor point detection";
      case "verified_corrections":
        return summary.verified_corrections.lastImportAt
          ? `Last: ${fmtDate(summary.verified_corrections.lastImportAt)} · ${summary.verified_corrections.lastImportStatus === "done" ? "OK" : "FAILED"}`
          : "Overwrites unverified OCR data";
    }
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
    } catch { return iso.slice(0, 10); }
  }

  // ─── Drag & drop ──────────────────────────────────────────────────────────────

  function onDragOver(id: ZoneId, e: DragEvent) {
    e.preventDefault();
    zoneStates[id].dragging = true; zoneStates = { ...zoneStates };
  }
  function onDragLeave(id: ZoneId) {
    zoneStates[id].dragging = false; zoneStates = { ...zoneStates };
  }
  function onDrop(id: ZoneId, e: DragEvent) {
    e.preventDefault();
    zoneStates[id].dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) triggerPreview(id, (file as unknown as { path?: string }).path ?? file.name);
    zoneStates = { ...zoneStates };
  }
  function onFileInput(id: ZoneId, e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) triggerPreview(id, (file as unknown as { path?: string }).path ?? file.name);
  }

  // ─── Preview / confirm ────────────────────────────────────────────────────────

  function triggerPreview(id: ZoneId, filePath: string) {
    zoneStates[id] = { ...zoneStates[id], phase: "parsing", filePath, error: null, preview: null, result: null };
    zoneStates = { ...zoneStates };
    runPreview(id, filePath);
  }

  async function runPreview(id: ZoneId, filePath: string) {
    try {
      let preview: unknown;
      switch (id) {
        case "company_registry":   preview = await api.call("previewCompanyRegistryImport", { filePath }); break;
        case "archive_folder":     preview = await api.call("previewArchiveFolderImport", { folderPath: filePath, mode: archiveMode, companyId: company?.id }); break;
        case "worker_list":        preview = await api.call("previewWorkerListImport", { filePath, companyId: company?.id ?? "" }); break;
        case "classification_seed":preview = await api.call("previewClassificationSeedImport", { filePath }); break;
        case "template_library":   preview = await api.call("previewTemplateLibraryImport", { inputPath: filePath }); break;
        case "verified_corrections":preview = await api.call("previewVerifiedCorrectionsImport", { filePath }); break;
      }
      zoneStates[id] = { ...zoneStates[id], phase: "preview", preview: preview as Record<string, unknown> };
      if (id === "verified_corrections") livePreviewZone = id;
    } catch (e) {
      zoneStates[id] = { ...zoneStates[id], phase: "error", error: String(e) };
    }
    zoneStates = { ...zoneStates };
  }

  async function confirmImport(id: ZoneId) {
    const state = zoneStates[id];
    if (!state.preview) return;
    zoneStates[id] = { ...zoneStates[id], phase: "confirming" };
    zoneStates = { ...zoneStates };
    try {
      const p = state.preview;
      let result: unknown;
      switch (id) {
        case "company_registry":   result = await api.call("confirmCompanyRegistryImport", { rows: p["rows"], skipMissingSgk: false, updateExisting: true }); break;
        case "archive_folder":     result = await api.call("confirmArchiveFolderImport", { mode: (p["mode"] as string) ?? archiveMode, folderPath: p["sourcePath"], companyId: company?.id, subfolderMappings: (p["subfolders"] as Array<{ folderPath: string; matchedCompanyId: string | null }> | undefined)?.filter((s) => s.matchedCompanyId).map((s) => ({ folderPath: s.folderPath, companyId: s.matchedCompanyId! })) }); break;
        case "worker_list":        result = await api.call("confirmWorkerListImport", { companyId: company?.id ?? "", documentId: "", listType: (p["detectedListType"] as string) ?? "unknown", snapshotDate: p["detectedSnapshotDate"] ?? null, snapshotDatePrecision: "day", snapshotDateSource: "filename", rows: p["rows"] }); break;
        case "classification_seed":result = await api.call("confirmClassificationSeedImport", { rows: p["rows"] }); break;
        case "template_library":   result = await api.call("confirmTemplateLibraryImport", { rows: p["rows"] }); break;
        case "verified_corrections":result = await api.call("confirmVerifiedCorrectionsImport", { rows: p["rows"] }); break;
      }
      zoneStates[id] = { ...zoneStates[id], phase: "done", result: result as Record<string, unknown> };
      refresh();
    } catch (e) {
      zoneStates[id] = { ...zoneStates[id], phase: "error", error: String(e) };
    }
    zoneStates = { ...zoneStates };
  }

  function resetZone(id: ZoneId) {
    zoneStates[id] = { phase: "resting", filePath: "", preview: null, result: null, error: null, dragging: false };
    zoneStates = { ...zoneStates };
    if (livePreviewZone === id) livePreviewZone = null;
  }

  // ─── Card footer helpers ──────────────────────────────────────────────────────

  function activeDotColor(phase: ZoneState["phase"]): string {
    switch (phase) {
      case "done":       return "#22c55e";
      case "error":      return "#ef4444";
      case "preview":    return "#3b82f6";
      case "parsing": case "confirming": return "#f59e0b";
      default: return "";
    }
  }

  function activeStatusLabel(state: ZoneState): string {
    switch (state.phase) {
      case "parsing":    return "Parsing…";
      case "preview":    return previewStatusText(state.preview);
      case "confirming": return "Importing…";
      case "done":       return "Imported";
      case "error":      return "Error";
      default: return "";
    }
  }

  function previewStatusText(p: Record<string, unknown> | null): string {
    if (!p) return "Ready";
    const s = p["status"] as string;
    if (s === "needs_mapping") return "Needs Mapping";
    if (s === "has_errors")    return "Has Errors";
    return "Ready to Import";
  }

  function summarize(id: ZoneId, preview: Record<string, unknown>): string {
    const s = preview["summary"] as Record<string, unknown>;
    const rows = (preview["rows"] as unknown[])?.length ?? 0;
    if (id === "archive_folder") {
      const files = s["supportedFiles"] ?? s["totalFiles"] ?? 0;
      const yr = s["detectedYearRange"] as { from?: string; to?: string } | undefined;
      return `${files} files found${yr?.from ? " · " + yr.from + "–" + (yr.to ?? yr.from) : ""}`;
    }
    if (id === "worker_list") return `${s["totalRows"] ?? rows} rows`;
    return `${s["totalRows"] ?? rows} rows found${s["needsReviewCount"] ? " · " + s["needsReviewCount"] + " need review" : ""}`;
  }

  function resultText(id: ZoneId, r: Record<string, unknown>): string {
    switch (id) {
      case "company_registry":    return `${r["created"]} created · ${r["updated"]} updated`;
      case "archive_folder":      return `Indexing started for ${r["started"]} folder(s)`;
      case "worker_list":         return `${r["rowsCreated"]} snapshot rows created`;
      case "classification_seed": return `${r["imported"]} rules imported`;
      case "template_library":    return `${r["imported"]} templates fingerprinted`;
      case "verified_corrections":return `${r["applied"]} corrections applied`;
    }
  }

  const badgeColors: Record<BadgeVariant, { bg: string; text: string }> = {
    orange:   { bg: "#f97316", text: "#fff" },
    blue:     { bg: "#3b82f6", text: "#fff" },
    green:    { bg: "#22c55e", text: "#fff" },
    grayblue: { bg: "#334155", text: "#94a3b8" },
    gray:     { bg: "#1e2433", text: "#64748b" },
    black:    { bg: "#0f172a", text: "#e2e8f0" },
  };

  // Live preview
  $: liveRows    = livePreviewZone ? ((zoneStates[livePreviewZone].preview?.["rows"] as Array<Record<string, unknown>>) ?? []) : [];
  $: liveFile    = livePreviewZone ? ((zoneStates[livePreviewZone].preview?.["sourcePath"] as string)?.split("/").pop() ?? "") : "";
  $: liveMatched = liveRows.filter((r) => r["matchStatus"] !== "unmatched").length;
</script>

<!-- ─── Top bar ─────────────────────────────────────────────────────────────── -->
<div class="shell">
  <div class="topbar">
    <div class="tb-left">
      <span class="tb-company">{company?.short_name ?? company?.name ?? "—"}</span>
      {#if zoneStates.archive_folder.filePath}
        <span class="tb-sep">›</span>
        <span class="tb-path">{zoneStates.archive_folder.filePath.split(/[\\/]/).slice(-2).join(" › ")}</span>
      {/if}
    </div>
    <div class="tb-mid">
      <button class="tb-btn" on:click={() => { if (company) api.call("startReindex", { companyId: company.id }).then(refresh); }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 5 5h-1.5A3.5 3.5 0 1 1 8 4.5V3z"/><path d="M8 1v4l3-2-3-2z"/></svg>
        Reindex Folder
      </button>
      {#if ingestion?.activeJobProgress != null}
        <div class="tb-pill active">
          <span class="dot pulsing"></span>
          Processing: {ingestion.activeJobProgress}%
        </div>
      {:else if ingestion}
        <div class="tb-pill">
          <span class="dot"></span>
          {ingestion.totalDocuments.toLocaleString()} docs indexed
        </div>
      {/if}
    </div>
    <div class="tb-right">
      <button class="icon-btn" title="Refresh" on:click={refresh}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
      </button>
      <button class="icon-btn" title="Alerts">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zm.995-14.901a1 1 0 1 0-1.99 0A5.002 5.002 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901z"/></svg>
        {#if (ingestion?.recentAlerts?.length ?? 0) > 0}
          <span class="alert-dot"></span>
        {/if}
      </button>
    </div>
  </div>

  <!-- ─── Content ──────────────────────────────────────────────────────────── -->
  <div class="content">
    <div class="cards-col">
      <!-- Page header -->
      <div class="page-head">
        <div class="ph-left">
          <h1>Archive Import Center</h1>
          <p>Import company registries, archive folders, worker lists, templates, and verified corrections into the local timeline database.</p>
        </div>
        {#if summary}
          <div class="ph-caps">
            <span class="cap">IMPORT COMPANY REGISTRIES, ARCHIVE FOLDERS, WORKER LISTS,<br>TEMPLATES, AND VERIFIED CORRECTIONS INTO THE LOCAL<br>TIMELINE DATABASE.</span>
          </div>
        {/if}
      </div>

      <!-- Zone cards -->
      <div class="grid">
        {#each zoneDefs as def}
          {@const state = zoneStates[def.id]}
          {@const badge = badgeColors[def.badgeVariant]}
          {@const isActive = state.phase !== "resting"}

          <div class="card" class:dragging={state.dragging}
            on:dragover={(e) => onDragOver(def.id, e)}
            on:dragleave={() => onDragLeave(def.id)}
            on:drop={(e) => onDrop(def.id, e)}
          >
            <!-- Card head -->
            <div class="card-head">
              <div class="card-icon">
                {#if def.id === "company_registry"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                {:else if def.id === "archive_folder"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                {:else if def.id === "worker_list"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.85"/></svg>
                {:else if def.id === "classification_seed"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                {:else if def.id === "template_library"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                {/if}
              </div>
              <div class="card-meta">
                <span class="card-title">{def.title}</span>
                <span class="card-sub">{def.subtitle}</span>
              </div>
              <span class="badge" style="background:{badge.bg}; color:{badge.text}">{def.badge}</span>
            </div>

            <!-- Drop / status body -->
            <div class="card-body" class:has-content={isActive}>
              {#if state.phase === "resting"}
                <!-- Resting: show persistent status from DB -->
                <div class="resting-body">
                  <div class="resting-main">
                    {#if def.acceptFolder}
                      <svg class="body-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                      <input
                        class="path-input"
                        type="text"
                        placeholder="/path/to/folder"
                        bind:value={folderInputs[def.id]}
                        on:keydown={(e) => { if (e.key === "Enter" && folderInputs[def.id].trim()) triggerPreview(def.id, folderInputs[def.id].trim()); }}
                      />
                      <button class="sm-btn" on:click={() => { if (folderInputs[def.id].trim()) triggerPreview(def.id, folderInputs[def.id].trim()); }}>
                        Preview
                      </button>
                      {#if def.id === "archive_folder"}
                        <div class="mode-pills">
                          <button class="pill" class:on={archiveMode === "single_company"} on:click={() => (archiveMode = "single_company")}>Single</button>
                          <button class="pill" class:on={archiveMode === "multi_company_root"} on:click={() => (archiveMode = "multi_company_root")}>Multi</button>
                        </div>
                      {/if}
                    {:else}
                      <label class="drop-label-wrap">
                        <svg class="body-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <input type="file" accept={def.accept} style="display:none" on:change={(e) => onFileInput(def.id, e)} />
                      </label>
                    {/if}
                  </div>
                  <div class="resting-info">
                    <span class="ri-line1">{restingLine1(def.id)}</span>
                    {#if restingLine2(def.id)}
                      <span class="ri-line2">{restingLine2(def.id)}</span>
                    {/if}
                  </div>
                </div>

              {:else if state.phase === "parsing" || state.phase === "confirming"}
                <div class="center-body">
                  <div class="spinner"></div>
                  <span>{state.phase === "parsing" ? "Parsing file…" : "Importing…"}</span>
                </div>

              {:else if state.phase === "preview" && state.preview}
                <div class="preview-body">
                  <span class="prev-count">{summarize(def.id, state.preview)}</span>
                  {#if (state.preview["warnings"] as string[] | undefined)?.length}
                    <span class="prev-warn">⚠ {(state.preview["warnings"] as string[])[0]}</span>
                  {/if}
                  {#if state.error}
                    <span class="inline-err">{state.error}</span>
                  {/if}
                </div>

              {:else if state.phase === "done" && state.result}
                <div class="done-body">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{resultText(def.id, state.result)}</span>
                </div>

              {:else if state.phase === "error"}
                <div class="err-body">
                  <span>⊗ {state.error}</span>
                  <button class="sm-btn" on:click={() => resetZone(def.id)}>Reset</button>
                </div>
              {/if}
            </div>

            <!-- Card footer -->
            <div class="card-foot">
              <div class="cf-status">
                <span class="cf-dot" style="background:{isActive ? activeDotColor(state.phase) : restingStatusDot(def.id)}"></span>
                <span class="cf-label">
                  {#if isActive}
                    {activeStatusLabel(state)}
                  {:else}
                    {restingStatusLabel(def.id)}
                  {/if}
                </span>
              </div>
              <div class="cf-actions">
                {#if state.phase === "preview"}
                  <button class="act confirm" on:click={() => confirmImport(def.id)}>Confirm Import</button>
                  <button class="act" on:click={() => resetZone(def.id)}>Cancel</button>
                {:else if state.phase === "done"}
                  <button class="act" on:click={() => resetZone(def.id)}>Import Again</button>
                {:else if state.phase === "resting" || state.phase === "error"}
                  <span class="act passive">{def.idleActionLabel}</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <!-- ─── Live Preview ────────────────────────────────────────────────── -->
      {#if livePreviewZone && liveRows.length > 0}
        <div class="live-preview">
          <div class="lp-head">
            <div class="lp-left">
              <span class="lp-pre">Live Preview:</span>
              <span class="lp-name">{liveFile || "Correction Set"}</span>
              <span class="lp-badge rows">{liveRows.length} ROWS</span>
              {#if liveMatched === liveRows.length}
                <span class="lp-badge ok">VALIDATED</span>
              {:else}
                <span class="lp-badge warn">{liveMatched} / {liveRows.length} MATCHED</span>
              {/if}
            </div>
            <div class="lp-right">
              <button class="lp-discard" on:click={() => { if (livePreviewZone) resetZone(livePreviewZone); }}>Discard</button>
              <button class="lp-commit" on:click={() => { if (livePreviewZone) confirmImport(livePreviewZone); }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/></svg>
                Mark Verified &amp; Commit
              </button>
            </div>
          </div>
          <div class="lp-scroll">
            <table class="lp-table">
              <thead>
                <tr><th>SOURCE ID</th><th>DOCUMENT</th><th>FIELD PATH</th><th>ORIGINAL (OCR)</th><th>CORRECTION</th><th>CONFIDENCE</th></tr>
              </thead>
              <tbody>
                {#each liveRows.slice(0, 20) as row}
                  <tr class:dim={row["matchStatus"] === "unmatched"}>
                    <td class="mono">#{String(row["rowIndex"]).padStart(4, "0")}</td>
                    <td class="mono small">{(row["fileName"] as string | null)?.slice(0, 28) ?? (row["fileHash"] as string | null)?.slice(0, 12) ?? "—"}</td>
                    <td class="mono small">{row["documentType"] ? "document_type" : row["manualDate"] ? "manual_date" : "document_scope"}</td>
                    <td><span class="strike">{row["matchStatus"] === "unmatched" ? "—" : row["documentType"] ? "UNKNOWN" : row["manualDate"] ? "unset" : "—"}</span></td>
                    <td class="corr">{(row["documentType"] ?? row["manualDate"] ?? row["documentScope"] ?? "—") as string}</td>
                    <td>
                      <div class="conf-row">
                        <div class="conf-bar" style="width:{row['matchStatus']==='hash_match'?98:row['matchStatus']==='name_match'?75:0}%"></div>
                        <span class="conf-n">{row["matchStatus"]==="hash_match"?"98%":row["matchStatus"]==="name_match"?"75%":"0%"}</span>
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

    <!-- ─── Right panel ──────────────────────────────────────────────────── -->
    <aside class="rp">
      <div class="rp-section">INGESTION STATUS</div>
      <div class="rp-subsection">EXTRACTION QUALITY</div>

      <div class="eq-block">
        <div class="eq-top">
          <span class="eq-val">{ingestion?.extractionQuality ?? "—"}%</span>
          {#if ingestion?.extractionQualityDelta != null && ingestion.extractionQualityDelta !== 0}
            <span class="eq-delta" class:pos={ingestion.extractionQualityDelta > 0}>
              {ingestion.extractionQualityDelta > 0 ? "+" : ""}{ingestion.extractionQualityDelta}%
            </span>
          {/if}
        </div>
        <div class="eq-track"><div class="eq-fill" style="width:{ingestion?.extractionQuality ?? 0}%"></div></div>
      </div>

      <div class="rp-section">PROCESSING QUEUES</div>
      <div class="queue-list">
        <div class="queue-row">
          <div class="qr-top">
            <span class="qr-name">Text Extraction</span>
            <span class="qr-status" class:active={ingestion?.activeJobStatus === "running"}>
              {ingestion?.activeJobStatus === "running" ? "Active" : "Idle"}
            </span>
          </div>
          <div class="qr-track"><div class="qr-bar blue" style="width:{ingestion?.activeJobProgress ?? 0}%"></div></div>
        </div>
        <div class="queue-row">
          <div class="qr-top">
            <span class="qr-name">Entity Resolution</span>
            <span class="qr-status">Pending</span>
          </div>
          <div class="qr-track"><div class="qr-bar purple" style="width:30%"></div></div>
        </div>
      </div>

      <div class="rp-section">RECENT ALERTS</div>
      <div class="alerts">
        {#if !(ingestion?.recentAlerts?.length)}
          <span class="no-alerts">No open alerts</span>
        {:else}
          {#each ingestion.recentAlerts as a}
            <div class="alert-row" class:err={a.severity === "high"} class:warn={a.severity !== "high"}>
              <span class="a-icon">{a.severity === "high" ? "⊗" : "△"}</span>
              <span class="a-msg">{a.message}</span>
            </div>
          {/each}
        {/if}
      </div>

      {#if ingestion}
        <div class="rp-stats">
          <div class="rs"><span class="rs-n">{ingestion.totalDocuments.toLocaleString()}</span><span class="rs-l">Total docs</span></div>
          <div class="rs"><span class="rs-n">{ingestion.processedToday}</span><span class="rs-l">Today</span></div>
        </div>
      {/if}

      <button class="goto-review">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>
        Go to Review Queue
      </button>
    </aside>
  </div>
</div>

<style>
  /* ── Shell ── */
  .shell { display:flex; flex-direction:column; height:100%; overflow:hidden; background:#0f1117; color:#e2e8f0; font-size:13px; }

  /* ── Topbar ── */
  .topbar { display:flex; align-items:center; gap:12px; padding:0 20px; height:44px; min-height:44px; background:#0a0d14; border-bottom:1px solid #1e2433; flex-shrink:0; }
  .tb-left { display:flex; align-items:center; gap:6px; flex:1; min-width:0; }
  .tb-company { font-weight:700; color:#f1f5f9; font-size:14px; white-space:nowrap; }
  .tb-sep { color:#334155; }
  .tb-path { font-size:11px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tb-mid { display:flex; align-items:center; gap:8px; }
  .tb-btn { display:flex; align-items:center; gap:5px; background:#1e2433; border:1px solid #2d3748; color:#94a3b8; border-radius:5px; padding:4px 10px; font-size:11px; cursor:pointer; white-space:nowrap; }
  .tb-btn:hover { background:#263248; color:#e2e8f0; }
  .tb-pill { display:flex; align-items:center; gap:5px; font-size:11px; color:#64748b; background:#1e2433; border:1px solid #1e2433; border-radius:5px; padding:3px 9px; white-space:nowrap; }
  .tb-pill.active { color:#94a3b8; }
  .dot { width:6px; height:6px; border-radius:50%; background:#334155; flex-shrink:0; }
  .dot.pulsing { background:#f59e0b; animation:pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .tb-right { display:flex; align-items:center; gap:5px; }
  .icon-btn { background:transparent; border:none; color:#475569; cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; position:relative; }
  .icon-btn:hover { color:#94a3b8; background:#1e2433; }
  .alert-dot { position:absolute; top:2px; right:2px; width:6px; height:6px; background:#ef4444; border-radius:50%; border:1px solid #0a0d14; }

  /* ── Content layout ── */
  .content { display:flex; flex:1; overflow:hidden; }
  .cards-col { flex:1; overflow-y:auto; padding:18px 18px 28px; display:flex; flex-direction:column; gap:16px; min-width:0; }

  /* ── Page head ── */
  .page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .ph-left { display:flex; flex-direction:column; gap:4px; }
  .ph-left h1 { font-size:18px; font-weight:700; color:#f1f5f9; margin:0; }
  .ph-left p { font-size:11px; color:#475569; margin:0; line-height:1.5; max-width:400px; }
  .ph-caps { font-size:9px; color:#334155; letter-spacing:.4px; line-height:1.6; text-align:right; max-width:260px; }

  /* ── Grid ── */
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }

  /* ── Card ── */
  .card { background:#141820; border:1px solid #1e2433; border-radius:9px; display:flex; flex-direction:column; overflow:hidden; transition:border-color .15s; }
  .card.dragging { border-color:#3b82f6; }

  .card-head { display:flex; align-items:flex-start; gap:9px; padding:11px 11px 0; }
  .card-icon { width:34px; height:34px; background:#1e2433; border-radius:7px; display:flex; align-items:center; justify-content:center; color:#64748b; flex-shrink:0; }
  .card-meta { flex:1; display:flex; flex-direction:column; gap:2px; min-width:0; }
  .card-title { font-size:12px; font-weight:600; color:#e2e8f0; }
  .card-sub { font-size:10px; color:#475569; }
  .badge { font-size:9px; font-weight:700; padding:2px 6px; border-radius:8px; letter-spacing:.4px; white-space:nowrap; flex-shrink:0; margin-top:2px; }

  /* ── Card body ── */
  .card-body { flex:1; margin:8px 10px; border:1.5px dashed #1e2433; border-radius:6px; min-height:80px; display:flex; flex-direction:column; overflow:hidden; transition:border-color .15s, background .15s; }
  .dragging .card-body { border-color:#3b82f6; background:#1a2035; }
  .card-body.has-content { border-style:solid; border-color:#1e2433; }

  /* Resting */
  .resting-body { flex:1; display:flex; flex-direction:column; gap:6px; padding:10px; }
  .resting-main { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .body-icon { color:#2d3748; flex-shrink:0; }
  .path-input { flex:1; min-width:80px; background:#0f1117; border:1px solid #2d3748; color:#94a3b8; border-radius:4px; padding:4px 6px; font-size:11px; font-family:monospace; }
  .path-input:focus { outline:none; border-color:#3b82f6; }
  .sm-btn { background:#1e2433; border:1px solid #2d3748; color:#94a3b8; border-radius:4px; padding:3px 9px; font-size:10px; cursor:pointer; white-space:nowrap; }
  .sm-btn:hover { background:#263248; color:#e2e8f0; }
  .mode-pills { display:flex; gap:3px; }
  .pill { background:transparent; border:1px solid #2d3748; color:#475569; border-radius:9px; padding:2px 7px; font-size:9px; cursor:pointer; }
  .pill.on { background:#1e2433; color:#94a3b8; border-color:#3b82f6; }
  .drop-label-wrap { display:flex; align-items:center; gap:6px; cursor:pointer; }
  .resting-info { display:flex; flex-direction:column; gap:2px; }
  .ri-line1 { font-size:12px; font-weight:500; color:#94a3b8; }
  .ri-line2 { font-size:10px; color:#475569; }

  /* Active states */
  .center-body { flex:1; display:flex; align-items:center; justify-content:center; gap:8px; font-size:11px; color:#64748b; padding:14px; }
  .spinner { width:13px; height:13px; border:2px solid #1e2433; border-top-color:#3b82f6; border-radius:50%; animation:spin .7s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .preview-body { flex:1; display:flex; flex-direction:column; gap:4px; padding:10px; }
  .prev-count { font-size:13px; font-weight:600; color:#e2e8f0; }
  .prev-warn { font-size:10px; color:#f59e0b; }
  .inline-err { font-size:10px; color:#ef4444; }
  .done-body { flex:1; display:flex; align-items:center; gap:7px; padding:10px; font-size:11px; color:#86efac; }
  .err-body { flex:1; display:flex; align-items:center; gap:8px; padding:10px; font-size:10px; color:#ef4444; flex-wrap:wrap; }

  /* ── Card footer ── */
  .card-foot { display:flex; align-items:center; justify-content:space-between; padding:7px 11px; border-top:1px solid #1e2433; }
  .cf-status { display:flex; align-items:center; gap:5px; }
  .cf-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
  .cf-label { font-size:10px; color:#64748b; }
  .cf-actions { display:flex; align-items:center; gap:8px; }
  .act { font-size:10px; font-weight:700; color:#475569; cursor:pointer; background:none; border:none; padding:0; }
  .act:hover { color:#94a3b8; }
  .act.passive { cursor:default; }
  .act.confirm { color:#22c55e; }
  .act.confirm:hover { color:#4ade80; }

  /* ── Live preview ── */
  .live-preview { background:#141820; border:1px solid #1e2433; border-radius:9px; overflow:hidden; }
  .lp-head { display:flex; align-items:center; justify-content:space-between; padding:11px 14px; border-bottom:1px solid #1e2433; gap:10px; flex-wrap:wrap; }
  .lp-left { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .lp-pre { font-size:11px; color:#64748b; }
  .lp-name { font-size:12px; font-weight:600; color:#e2e8f0; }
  .lp-badge { font-size:9px; font-weight:700; padding:2px 7px; border-radius:7px; letter-spacing:.3px; }
  .lp-badge.rows { background:#1e3a5f; color:#60a5fa; }
  .lp-badge.ok   { background:#14291f; color:#22c55e; }
  .lp-badge.warn { background:#2a1f0f; color:#f59e0b; }
  .lp-right { display:flex; gap:7px; }
  .lp-discard { background:transparent; border:1px solid #2d3748; color:#64748b; border-radius:5px; padding:5px 11px; font-size:11px; cursor:pointer; }
  .lp-discard:hover { color:#94a3b8; }
  .lp-commit { display:flex; align-items:center; gap:5px; background:#1e2433; border:1px solid #334155; color:#e2e8f0; border-radius:5px; padding:5px 12px; font-size:11px; font-weight:600; cursor:pointer; }
  .lp-commit:hover { background:#263248; }
  .lp-scroll { overflow-x:auto; }
  .lp-table { width:100%; border-collapse:collapse; font-size:11px; }
  .lp-table th { text-align:left; padding:7px 13px; color:#334155; font-size:9px; font-weight:700; letter-spacing:.5px; border-bottom:1px solid #1e2433; white-space:nowrap; }
  .lp-table td { padding:7px 13px; color:#94a3b8; border-bottom:1px solid #1a1f2e; vertical-align:middle; }
  .lp-table tr.dim td { color:#334155; }
  .lp-table tr:last-child td { border-bottom:none; }
  .mono { font-family:monospace; }
  .small { font-size:10px; }
  .strike { text-decoration:line-through; color:#475569; }
  .corr { color:#e2e8f0; font-weight:500; }
  .conf-row { display:flex; align-items:center; gap:5px; }
  .conf-bar { height:4px; background:#22c55e; border-radius:2px; min-width:3px; max-width:70px; }
  .conf-n { font-size:10px; color:#64748b; }

  /* ── Right panel ── */
  .rp { width:210px; min-width:210px; background:#0a0d14; border-left:1px solid #1e2433; padding:14px 12px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
  .rp-section { font-size:9px; font-weight:700; letter-spacing:.8px; color:#334155; text-transform:uppercase; margin-top:4px; }
  .rp-subsection { font-size:9px; letter-spacing:.4px; color:#475569; margin-top:-4px; text-transform:uppercase; }

  .eq-block { display:flex; flex-direction:column; gap:5px; }
  .eq-top { display:flex; align-items:baseline; gap:5px; }
  .eq-val { font-size:24px; font-weight:700; color:#e2e8f0; line-height:1; }
  .eq-delta { font-size:11px; font-weight:600; color:#475569; }
  .eq-delta.pos { color:#22c55e; }
  .eq-track { height:4px; background:#1e2433; border-radius:2px; overflow:hidden; }
  .eq-fill { height:100%; background:linear-gradient(90deg,#3b82f6,#22c55e); border-radius:2px; transition:width .6s; }

  .queue-list { display:flex; flex-direction:column; gap:7px; }
  .queue-row { display:flex; flex-direction:column; gap:3px; }
  .qr-top { display:flex; justify-content:space-between; }
  .qr-name { font-size:10px; color:#94a3b8; }
  .qr-status { font-size:9px; color:#475569; }
  .qr-status.active { color:#22c55e; }
  .qr-track { height:3px; background:#1e2433; border-radius:2px; overflow:hidden; }
  .qr-bar { height:100%; border-radius:2px; transition:width .5s; }
  .qr-bar.blue   { background:#3b82f6; }
  .qr-bar.purple { background:#a855f7; }

  .alerts { display:flex; flex-direction:column; gap:5px; }
  .no-alerts { font-size:10px; color:#334155; }
  .alert-row { display:flex; gap:5px; font-size:10px; padding:5px 7px; border-radius:4px; line-height:1.4; }
  .alert-row.err  { background:#2a0f0f; color:#fca5a5; }
  .alert-row.warn { background:#2a1f0f; color:#fcd34d; }
  .a-icon { flex-shrink:0; }
  .a-msg { flex:1; word-break:break-word; }

  .rp-stats { display:flex; gap:10px; padding:8px 0; border-top:1px solid #1e2433; margin-top:2px; }
  .rs { display:flex; flex-direction:column; gap:2px; }
  .rs-n { font-size:15px; font-weight:700; color:#e2e8f0; }
  .rs-l { font-size:9px; color:#475569; text-transform:uppercase; letter-spacing:.4px; }

  .goto-review { display:flex; align-items:center; justify-content:center; gap:5px; background:#1e2433; border:1px solid #2d3748; color:#64748b; border-radius:6px; padding:8px; font-size:10px; cursor:pointer; margin-top:auto; }
  .goto-review:hover { background:#263248; color:#94a3b8; }
</style>
