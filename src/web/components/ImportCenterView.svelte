<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Company } from "$lib/types.ts";
  import { api } from "$lib/api.ts";

  export let company: Company | null;

  // ─── Types ───────────────────────────────────────────────────────────────────

  type ZoneId = "hr_kronos" | "company_resolver" | "archive_folder" | "worker_list" | "classification_seed" | "template_library" | "verified_corrections";
  type BadgeVariant = "orange" | "teal" | "blue" | "green" | "grayblue" | "gray" | "black";

  type ZoneDef = {
    id: ZoneId;
    title: string;
    subtitle: string;
    badge: string;
    badgeVariant: BadgeVariant;
    accept: string;
    acceptFolder: boolean;
    idleAction: string;
  };

  type Phase = "resting" | "parsing" | "preview" | "confirming" | "done" | "error";

  type ZoneState = {
    phase: Phase;
    filePath: string;
    preview: Record<string, unknown> | null;
    result: Record<string, unknown> | null;
    error: string | null;
    dragging: boolean;
  };

  type ImportProfile = { id: string; name: string; sourceType: string; columnMappings: Record<string, string> };
  type SummaryData = Record<string, Record<string, unknown>>;

  const KRONOS_FIELDS: Array<{ key: string; label: string }> = [
    { key: "external_worker_id", label: "Employee ID" },
    { key: "worker_name",        label: "Worker Name" },
    { key: "tckn",               label: "TCKN" },
    { key: "company_name",       label: "Company Name" },
    { key: "sgk_registration_no",label: "SGK Registration No" },
    { key: "department",         label: "Department" },
    { key: "job_title",          label: "Job Title" },
    { key: "start_date",         label: "Start Date" },
    { key: "end_date",           label: "End Date" },
    { key: "employment_status",  label: "Employment Status" },
  ];

  // ─── Zone defs ────────────────────────────────────────────────────────────────

  const zoneDefs: ZoneDef[] = [
    { id: "hr_kronos",          title: "HR / Kronos Import",     subtitle: "Excel, CSV, XLS",        badge: "NEEDS MAPPING",   badgeVariant: "orange",   accept: ".xlsx,.xls,.csv",            acceptFolder: false, idleAction: "Preview Mapping"    },
    { id: "company_resolver",   title: "Company Resolver",       subtitle: "From HR staging data",   badge: "CANDIDATES",      badgeVariant: "teal",     accept: "",                           acceptFolder: false, idleAction: "Review Candidates"  },
    { id: "archive_folder",     title: "Archive Folders",        subtitle: "Full Directories",       badge: "READY TO INDEX",  badgeVariant: "blue",     accept: "",                           acceptFolder: true,  idleAction: "Preview Scan"       },
    { id: "worker_list",        title: "Worker Lists",           subtitle: "Rosters, Vaccination",   badge: "LOCAL ONLY / KVKK",badgeVariant: "green",   accept: ".xlsx,.xls,.csv",            acceptFolder: false, idleAction: "Compare Snapshots"  },
    { id: "classification_seed",title: "Classification Rules",   subtitle: "JSON, YAML, Excel",      badge: "RULE SEEDS",      badgeVariant: "grayblue", accept: ".json,.xlsx,.xls,.yaml,.yml",acceptFolder: false, idleAction: "Edit Rules"         },
    { id: "template_library",   title: "Template Library",       subtitle: "Blank Forms, PDFs",      badge: "CORE FORM",       badgeVariant: "gray",     accept: ".pdf,.docx,.doc,.xlsx",      acceptFolder: true,  idleAction: "Browse"             },
    { id: "verified_corrections",title: "Verified Corrections",  subtitle: "JSON, CSV",              badge: "PRIORITY",        badgeVariant: "black",    accept: ".json,.csv,.xlsx",           acceptFolder: false, idleAction: "Debug Log"          },
  ];

  const badgeColors: Record<BadgeVariant, { bg: string; text: string }> = {
    orange:   { bg: "#f97316", text: "#fff" },
    teal:     { bg: "#0d9488", text: "#fff" },
    blue:     { bg: "#3b82f6", text: "#fff" },
    green:    { bg: "#22c55e", text: "#fff" },
    grayblue: { bg: "#334155", text: "#94a3b8" },
    gray:     { bg: "#1e2433", text: "#64748b" },
    black:    { bg: "#0f172a", text: "#e2e8f0" },
  };

  // ─── State ────────────────────────────────────────────────────────────────────

  let zones: Record<ZoneId, ZoneState> = Object.fromEntries(
    zoneDefs.map((z) => [z.id, { phase: "resting" as Phase, filePath: "", preview: null, result: null, error: null, dragging: false }])
  ) as Record<ZoneId, ZoneState>;

  let folderInputs: Record<ZoneId, string> = Object.fromEntries(zoneDefs.map((z) => [z.id, ""])) as Record<ZoneId, string>;
  let archiveMode: "single_company" | "multi_company_root" = "single_company";

  let summary: SummaryData | null = null;
  let ingestion: Record<string, unknown> | null = null;
  let profiles: ImportProfile[] = [];

  // Kronos mapping editor state
  let kronosMapping: Record<string, string> = {};
  let kronosHeaders: string[] = [];
  let saveProfileName = "";
  let selectedProfileId = "";

  // Bottom panel
  type BottomMode = "none" | "kronos_mapping" | "company_resolver" | "corrections";
  let bottomMode: BottomMode = "none";

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  onMount(() => { refresh(); pollInterval = setInterval(refresh, 9000); });
  onDestroy(() => { if (pollInterval) clearInterval(pollInterval); });

  async function refresh() {
    if (!company) return;
    try {
      [summary, ingestion, profiles] = await Promise.all([
        api.call<SummaryData>("getImportCenterSummary", { companyId: company.id }),
        api.call<Record<string, unknown>>("getIngestionStatus", { companyId: company.id }),
        api.call<ImportProfile[]>("listImportProfiles"),
      ]);
    } catch { /* silent */ }
  }

  // ─── Drag/drop ────────────────────────────────────────────────────────────────

  function onDragOver(id: ZoneId, e: DragEvent) { e.preventDefault(); zones[id].dragging = true; zones = { ...zones }; }
  function onDragLeave(id: ZoneId) { zones[id].dragging = false; zones = { ...zones }; }
  function onDrop(id: ZoneId, e: DragEvent) {
    e.preventDefault(); zones[id].dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) triggerPreview(id, (file as unknown as { path?: string }).path ?? file.name);
    zones = { ...zones };
  }
  function onFileInput(id: ZoneId, e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) triggerPreview(id, (file as unknown as { path?: string }).path ?? file.name);
  }

  // ─── Preview ─────────────────────────────────────────────────────────────────

  function triggerPreview(id: ZoneId, filePath: string) {
    zones[id] = { ...zones[id], phase: "parsing", filePath, error: null, preview: null, result: null };
    zones = { ...zones };
    runPreview(id, filePath);
  }

  async function runPreview(id: ZoneId, filePath: string) {
    try {
      let preview: unknown;
      switch (id) {
        case "hr_kronos":
          preview = await api.call("previewKronosImport", {
            filePath,
            profileId: selectedProfileId || undefined,
            overrideMapping: Object.keys(kronosMapping).length > 0 ? kronosMapping : undefined,
          });
          kronosHeaders = (preview as Record<string, unknown>)["detectedHeaders"] as string[] ?? [];
          kronosMapping = (preview as Record<string, unknown>)["mapping"] as Record<string, string> ?? {};
          bottomMode = "kronos_mapping";
          break;
        case "company_resolver":
          preview = await api.call("previewCompanyResolverImport", {});
          bottomMode = "company_resolver";
          break;
        case "archive_folder":
          preview = await api.call("previewArchiveFolderImport", { folderPath: filePath, mode: archiveMode, companyId: company?.id });
          break;
        case "worker_list":
          preview = await api.call("previewWorkerListImport", { filePath, companyId: company?.id ?? "" });
          break;
        case "classification_seed":
          preview = await api.call("previewClassificationSeedImport", { filePath });
          break;
        case "template_library":
          preview = await api.call("previewTemplateLibraryImport", { inputPath: filePath });
          break;
        case "verified_corrections":
          preview = await api.call("previewVerifiedCorrectionsImport", { filePath });
          bottomMode = "corrections";
          break;
      }
      zones[id] = { ...zones[id], phase: "preview", preview: preview as Record<string, unknown> };
    } catch (e) {
      zones[id] = { ...zones[id], phase: "error", error: String(e) };
    }
    zones = { ...zones };
  }

  // ─── Confirm ─────────────────────────────────────────────────────────────────

  async function confirmImport(id: ZoneId) {
    const state = zones[id];
    if (!state.preview) return;
    zones[id] = { ...zones[id], phase: "confirming" };
    zones = { ...zones };
    try {
      const p = state.preview;
      let result: unknown;
      switch (id) {
        case "hr_kronos":
          result = await api.call("confirmKronosImport", {
            companyId: company?.id ?? "",
            filePath: state.filePath,
            rows: p["rows"],
            mapping: kronosMapping,
            saveProfileAs: saveProfileName.trim() || undefined,
          });
          break;
        case "company_resolver": {
          const rows = (p["rows"] as Array<Record<string, unknown>>) ?? [];
          const actions = rows.map((r) => ({
            candidateId: r["id"],
            action: r["matchedCompanyId"] ? "merge_existing" : "confirm_new",
            mergeIntoCompanyId: r["matchedCompanyId"] ?? undefined,
          }));
          result = await api.call("confirmCompanyResolverImport", { actions });
          break;
        }
        case "archive_folder":
          result = await api.call("confirmArchiveFolderImport", {
            mode: (p["mode"] as string) ?? archiveMode, folderPath: p["sourcePath"], companyId: company?.id,
            subfolderMappings: (p["subfolders"] as Array<{ folderPath: string; matchedCompanyId: string | null }> | undefined)
              ?.filter((s) => s.matchedCompanyId)
              .map((s) => ({ folderPath: s.folderPath, companyId: s.matchedCompanyId! })),
          });
          break;
        case "worker_list":
          result = await api.call("confirmWorkerListImport", {
            companyId: company?.id ?? "", documentId: "",
            listType: (p["detectedListType"] as string) ?? "unknown",
            snapshotDate: p["detectedSnapshotDate"] ?? null,
            snapshotDatePrecision: "day", snapshotDateSource: "filename", rows: p["rows"],
          });
          break;
        case "classification_seed":
          result = await api.call("confirmClassificationSeedImport", { rows: p["rows"] }); break;
        case "template_library":
          result = await api.call("confirmTemplateLibraryImport", { rows: p["rows"] }); break;
        case "verified_corrections":
          result = await api.call("confirmVerifiedCorrectionsImport", { rows: p["rows"] }); break;
      }
      zones[id] = { ...zones[id], phase: "done", result: result as Record<string, unknown> };
      if (id === "hr_kronos") saveProfileName = "";
      refresh();
    } catch (e) {
      zones[id] = { ...zones[id], phase: "error", error: String(e) };
    }
    zones = { ...zones };
  }

  async function rePreviewWithMapping() {
    const state = zones.hr_kronos;
    if (!state.filePath) return;
    zones.hr_kronos = { ...state, phase: "parsing" };
    zones = { ...zones };
    await runPreview("hr_kronos", state.filePath);
  }

  function loadProfile(profileId: string) {
    selectedProfileId = profileId;
    const state = zones.hr_kronos;
    if (state.filePath) {
      zones.hr_kronos = { ...state, phase: "parsing" };
      zones = { ...zones };
      runPreview("hr_kronos", state.filePath);
    }
  }

  function resetZone(id: ZoneId) {
    zones[id] = { phase: "resting", filePath: "", preview: null, result: null, error: null, dragging: false };
    zones = { ...zones };
    if (id === "hr_kronos") { kronosMapping = {}; kronosHeaders = []; saveProfileName = ""; selectedProfileId = ""; }
    if (bottomMode === (id === "hr_kronos" ? "kronos_mapping" : id === "company_resolver" ? "company_resolver" : "corrections")) {
      bottomMode = "none";
    }
  }

  function launchCompanyResolver() {
    if (zones.company_resolver.phase === "resting" || zones.company_resolver.phase === "error") {
      zones.company_resolver = { ...zones.company_resolver, phase: "parsing", filePath: "db://company_candidates" };
      zones = { ...zones };
      runPreview("company_resolver", "db://company_candidates");
    }
  }

  // ─── Persistent card status ───────────────────────────────────────────────────

  function restingDot(id: ZoneId): string {
    if (!summary) return "#334155";
    const s = summary[id] ?? {};
    switch (id) {
      case "hr_kronos":      return (s["stagingRowCount"] as number) > 0 ? "#f59e0b" : "#334155";
      case "company_resolver": return (s["pendingCount"] as number) > 0 ? "#f59e0b" : (s["totalCompanies"] as number) > 0 ? "#22c55e" : "#334155";
      case "archive_folder": return (s["lastJobStatus"] as string) === "done" ? "#3b82f6" : (s["lastJobStatus"] as string) === "running" ? "#f59e0b" : "#334155";
      case "worker_list":    return (s["snapshotCount"] as number) > 0 ? "#22c55e" : "#334155";
      case "classification_seed": return (s["ruleCount"] as number) > 0 ? "#64748b" : "#334155";
      case "template_library":    return (s["templateCount"] as number) > 0 ? "#22c55e" : "#334155";
      case "verified_corrections":(s["lastImportStatus"] as string) === "done" ? "#22c55e" : (s["lastImportAt"] as string | null) ? "#ef4444" : "#334155";
        return (s["lastImportStatus"] as string) === "done" ? "#22c55e" : (s["lastImportAt"] as string | null) ? "#ef4444" : "#334155";
    }
  }

  function restingLabel(id: ZoneId): string {
    if (!summary) return "Not configured";
    const s = summary[id] ?? {};
    switch (id) {
      case "hr_kronos":
        return (s["stagingRowCount"] as number) > 0
          ? `${(s["stagingRowCount"] as number).toLocaleString()} rows staged · ${(s["savedProfileCount"] as number)} profile${(s["savedProfileCount"] as number) !== 1 ? "s" : ""}`
          : (s["savedProfileCount"] as number) > 0 ? `${(s["savedProfileCount"] as number)} saved profile${(s["savedProfileCount"] as number) !== 1 ? "s" : ""}` : "Not configured";
      case "company_resolver":
        return (s["pendingCount"] as number) > 0
          ? `${(s["pendingCount"] as number)} candidate${(s["pendingCount"] as number) !== 1 ? "s" : ""} pending`
          : `${(s["totalCompanies"] as number)} ${(s["totalCompanies"] as number) === 1 ? "company" : "companies"} registered`;
      case "archive_folder":
        return (s["fileCount"] as number) > 0 ? `${(s["fileCount"] as number).toLocaleString()} files found` : "Not configured";
      case "worker_list":
        return (s["snapshotCount"] as number) > 0 ? `Imported · ${(s["snapshotCount"] as number)} snapshot${(s["snapshotCount"] as number) !== 1 ? "s" : ""}` : "Not configured";
      case "classification_seed":
        return (s["ruleCount"] as number) > 0 ? `Stable · ${(s["ruleCount"] as number)} rules loaded` : "Not configured";
      case "template_library":
        return (s["templateCount"] as number) > 0 ? `${(s["templateCount"] as number)} templates active` : "Not configured";
      case "verified_corrections":
        return (s["lastImportAt"] as string | null) ? ((s["lastImportStatus"] as string) === "done" ? "Last import: OK" : "Last import: Failed") : "Not configured";
    }
  }

  function restingLine1(id: ZoneId): string {
    if (!summary) return "";
    const s = summary[id] ?? {};
    switch (id) {
      case "hr_kronos":        return (s["stagingRowCount"] as number) > 0 ? `${(s["stagingRowCount"] as number).toLocaleString()} raw rows in staging` : "Drop Kronos / HR export to begin";
      case "company_resolver": return (s["pendingCount"] as number) > 0 ? `${(s["pendingCount"] as number)} company candidate${(s["pendingCount"] as number) !== 1 ? "s" : ""} detected` : (s["totalCompanies"] as number) > 0 ? `${(s["totalCompanies"] as number)} companies in registry` : "No candidates yet — import HR data first";
      case "archive_folder":   return (s["fileCount"] as number) > 0 ? `${(s["fileCount"] as number).toLocaleString()} files found` : "Enter folder path to scan";
      case "worker_list":      return (s["lastRowCount"] as number) > 0 ? `${(s["lastRowCount"] as number).toLocaleString()} rows` : "Drop roster or vaccination log";
      case "classification_seed": return (s["ruleCount"] as number) > 0 ? `${(s["ruleCount"] as number)} classification rules loaded` : "Drop classification map";
      case "template_library": return (s["templateCount"] as number) > 0 ? `${(s["templateCount"] as number)} templates fingerprinted` : "Upload blank form";
      case "verified_corrections": return (s["lastImportAt"] as string | null) ? "Import Correction Set" : "Drop correction file";
    }
  }

  function restingLine2(id: ZoneId): string {
    if (!summary) return "";
    const s = summary[id] ?? {};
    switch (id) {
      case "hr_kronos":        return profiles.length > 0 ? `${profiles.length} saved mapping profile${profiles.length !== 1 ? "s" : ""}` : "Column mapping is auto-detected";
      case "company_resolver": return (s["pendingCount"] as number) > 0 ? "Awaiting confirmation before writing to companies" : "Raw data staged · matched by SGK or name";
      case "archive_folder":   return (s["lastJobAt"] as string | null) ? `Last scan: ${fmtDate(s["lastJobAt"] as string)}` : "Supports full directories";
      case "worker_list":      return (s["lastSnapshotDate"] as string | null) ? `Last snapshot: ${(s["lastSnapshotDate"] as string).slice(0,7).replace("-"," ")}` : "TCKN masked · hash only";
      case "classification_seed": return (s["ruleCount"] as number) > 0 ? "Updates heuristic rule set" : "Updates global classification mapping";
      case "template_library": return (s["templateCount"] as number) > 0 ? "Used for anchor point detection" : "For anchor point detection";
      case "verified_corrections": return (s["lastImportAt"] as string | null) ? `Last: ${fmtDate(s["lastImportAt"] as string)} · ${(s["lastImportStatus"] as string) === "done" ? "OK" : "FAILED"}` : "Overwrites unverified OCR data";
    }
  }

  function fmtDate(iso: string): string {
    try { return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }); }
    catch { return iso.slice(0, 10); }
  }

  function summarize(id: ZoneId, p: Record<string, unknown>): string {
    const s = p["summary"] as Record<string, unknown>;
    const rows = (p["rows"] as unknown[])?.length ?? 0;
    if (id === "hr_kronos") {
      const cands = (p["companyCandidates"] as unknown[] | undefined)?.length ?? 0;
      return `${s["totalRows"] ?? rows} workers · ${cands} company${cands !== 1 ? " candidates" : " candidate"} detected`;
    }
    if (id === "company_resolver") return `${rows} pending candidate${rows !== 1 ? "s" : ""}`;
    if (id === "archive_folder") {
      const files = s["supportedFiles"] ?? s["totalFiles"] ?? 0;
      const yr = s["detectedYearRange"] as { from?: string; to?: string } | undefined;
      return `${files} files${yr?.from ? " · " + yr.from + "–" + (yr.to ?? yr.from) : ""}`;
    }
    return `${s["totalRows"] ?? rows} rows${s["needsReviewCount"] ? " · " + s["needsReviewCount"] + " need review" : ""}`;
  }

  function resultText(id: ZoneId, r: Record<string, unknown>): string {
    switch (id) {
      case "hr_kronos":           return `${r["stagingRows"]} rows staged · ${r["candidatesCreated"]} candidates${r["profileSaved"] ? " · profile saved" : ""}`;
      case "company_resolver":    return `${r["created"]} created · ${r["merged"]} merged · ${r["rejected"]} rejected`;
      case "archive_folder":      return `Indexing started for ${r["started"]} folder(s)`;
      case "worker_list":         return `${r["rowsCreated"]} snapshot rows created`;
      case "classification_seed": return `${r["imported"]} rules imported`;
      case "template_library":    return `${r["imported"]} templates fingerprinted`;
      case "verified_corrections":return `${r["applied"]} corrections applied`;
    }
  }

  function activeDotColor(phase: Phase): string {
    switch (phase) {
      case "done":  return "#22c55e";
      case "error": return "#ef4444";
      case "preview": return "#3b82f6";
      case "parsing": case "confirming": return "#f59e0b";
      default: return "";
    }
  }

  function activeLabel(state: ZoneState): string {
    switch (state.phase) {
      case "parsing":    return "Parsing…";
      case "preview": {
        const st = state.preview?.["status"] as string;
        return st === "needs_mapping" ? "Needs Mapping" : st === "has_errors" ? "Has Errors" : "Ready to Import";
      }
      case "confirming": return "Importing…";
      case "done":       return "Imported";
      case "error":      return "Error";
      default: return "";
    }
  }

  // Bottom panel data
  $: kronosPreview  = zones.hr_kronos.preview;
  $: resolverRows   = (zones.company_resolver.preview?.["rows"] as Array<Record<string, unknown>>) ?? [];
  $: corrRows       = (zones.verified_corrections.preview?.["rows"] as Array<Record<string, unknown>>) ?? [];
  $: corrFile       = (zones.verified_corrections.preview?.["sourcePath"] as string)?.split("/").pop() ?? "";
  $: corrMatched    = corrRows.filter((r) => r["matchStatus"] !== "unmatched").length;
</script>

<!-- ─── Top bar ─────────────────────────────────────────────────────────────── -->
<div class="shell">
  <div class="topbar">
    <div class="tb-l">
      <span class="tb-co">{company?.short_name ?? company?.name ?? "—"}</span>
      {#if zones.archive_folder.filePath}
        <span class="tb-sep">›</span>
        <span class="tb-path">{zones.archive_folder.filePath.split(/[\\/]/).slice(-2).join(" › ")}</span>
      {/if}
    </div>
    <div class="tb-m">
      <button class="tb-btn" on:click={() => { if (company) api.call("startReindex", { companyId: company.id }).then(refresh); }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
        Reindex Folder
      </button>
      {#if (ingestion?.["activeJobProgress"] as number | null) != null}
        <div class="tb-pill active"><span class="dot pulsing"></span>Processing: {ingestion?.["activeJobProgress"]}%</div>
      {:else if ingestion}
        <div class="tb-pill"><span class="dot"></span>{(ingestion["totalDocuments"] as number).toLocaleString()} docs indexed</div>
      {/if}
    </div>
    <div class="tb-r">
      <button class="icon-btn" on:click={refresh}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
      </button>
      <button class="icon-btn">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zm.995-14.901a1 1 0 1 0-1.99 0A5.002 5.002 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901z"/></svg>
        {#if (ingestion?.["recentAlerts"] as unknown[] | undefined)?.length}<span class="alert-dot"></span>{/if}
      </button>
    </div>
  </div>

  <!-- ─── Layout ──────────────────────────────────────────────────────────── -->
  <div class="layout">
    <div class="main">
      <!-- Page head -->
      <div class="ph">
        <div>
          <h1>Archive Import Center</h1>
          <p>Import company registries, archive folders, worker lists, templates, and verified corrections into the local timeline database.</p>
        </div>
        <div class="ph-cap">IMPORT COMPANY REGISTRIES, ARCHIVE FOLDERS, WORKER LISTS,<br>TEMPLATES, AND VERIFIED CORRECTIONS INTO THE LOCAL<br>TIMELINE DATABASE.</div>
      </div>

      <!-- Zone grid -->
      <div class="grid">
        {#each zoneDefs as def}
          {@const state = zones[def.id]}
          {@const badge = badgeColors[def.badgeVariant]}
          {@const isActive = state.phase !== "resting"}

          <div class="card" class:dragging={state.dragging}
            on:dragover={(e) => { if (def.accept || def.acceptFolder) onDragOver(def.id, e); }}
            on:dragleave={() => onDragLeave(def.id)}
            on:drop={(e) => { if (def.accept || def.acceptFolder) onDrop(def.id, e); }}
          >
            <div class="ch">
              <div class="ci">
                {#if def.id === "hr_kronos"}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8h4M7 12h8"/></svg>
                {:else if def.id === "company_resolver"}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/></svg>
                {:else if def.id === "archive_folder"}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                {:else if def.id === "worker_list"}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.85"/></svg>
                {:else if def.id === "classification_seed"}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                {:else if def.id === "template_library"}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                {:else}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                {/if}
              </div>
              <div class="cm">
                <span class="ct">{def.title}</span>
                <span class="cs">{def.subtitle}</span>
              </div>
              <span class="badge" style="background:{badge.bg};color:{badge.text}">{def.badge}</span>
            </div>

            <!-- Body -->
            <div class="cb" class:active={isActive}>
              {#if state.phase === "resting"}
                <div class="rb">
                  <div class="rb-top">
                    {#if def.id === "company_resolver"}
                      <!-- Special: button instead of file input -->
                      <button class="resolver-btn" on:click={launchCompanyResolver}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/></svg>
                        Review Candidates
                      </button>
                    {:else if def.acceptFolder}
                      <svg class="bi" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.41.59L11 7h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                      <input class="pi" type="text" placeholder="/path/to/folder" bind:value={folderInputs[def.id]}
                        on:keydown={(e) => { if (e.key === "Enter" && folderInputs[def.id].trim()) triggerPreview(def.id, folderInputs[def.id].trim()); }} />
                      <button class="smb" on:click={() => { if (folderInputs[def.id].trim()) triggerPreview(def.id, folderInputs[def.id].trim()); }}>Preview</button>
                      {#if def.id === "archive_folder"}
                        <div class="mpills">
                          <button class="pill" class:on={archiveMode==="single_company"} on:click={() => (archiveMode = "single_company")}>Single</button>
                          <button class="pill" class:on={archiveMode==="multi_company_root"} on:click={() => (archiveMode = "multi_company_root")}>Multi</button>
                        </div>
                      {/if}
                    {:else}
                      <label class="dropwrap">
                        <svg class="bi" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <input type="file" accept={def.accept} style="display:none" on:change={(e) => onFileInput(def.id, e)} />
                      </label>
                      {#if def.id === "hr_kronos" && profiles.length > 0}
                        <select class="psel" bind:value={selectedProfileId} on:change={(e) => loadProfile((e.currentTarget as HTMLSelectElement).value)}>
                          <option value="">Auto-detect columns</option>
                          {#each profiles as prof}<option value={prof.id}>{prof.name}</option>{/each}
                        </select>
                      {/if}
                    {/if}
                  </div>
                  <div class="rb-info">
                    <span class="rl1">{restingLine1(def.id)}</span>
                    {#if restingLine2(def.id)}<span class="rl2">{restingLine2(def.id)}</span>{/if}
                  </div>
                </div>
                {#if state.error}<div class="ie">{state.error}</div>{/if}

              {:else if state.phase === "parsing" || state.phase === "confirming"}
                <div class="center-body"><div class="spin"></div><span>{state.phase === "parsing" ? "Parsing…" : "Importing…"}</span></div>

              {:else if state.phase === "preview" && state.preview}
                <div class="prev-body">
                  <span class="pc">{summarize(def.id, state.preview)}</span>
                  {#if (state.preview["warnings"] as string[] | undefined)?.length}
                    <span class="pw">⚠ {(state.preview["warnings"] as string[])[0]}</span>
                  {/if}
                  {#if def.id === "hr_kronos"}
                    <button class="map-link" on:click={() => (bottomMode = "kronos_mapping")}>
                      {Object.keys(kronosMapping).length} columns mapped — Edit mapping ↓
                    </button>
                  {/if}
                  {#if def.id === "company_resolver"}
                    <button class="map-link" on:click={() => (bottomMode = "company_resolver")}>
                      Review candidate list ↓
                    </button>
                  {/if}
                </div>

              {:else if state.phase === "done" && state.result}
                <div class="done-body">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{resultText(def.id, state.result)}</span>
                </div>

              {:else if state.phase === "error"}
                <div class="err-body"><span>⊗ {state.error}</span><button class="smb" on:click={() => resetZone(def.id)}>Reset</button></div>
              {/if}
            </div>

            <!-- Footer -->
            <div class="cf">
              <div class="cf-s">
                <span class="cfdot" style="background:{isActive ? activeDotColor(state.phase) : restingDot(def.id)}"></span>
                <span class="cfl">{isActive ? activeLabel(state) : restingLabel(def.id)}</span>
              </div>
              <div class="cfa">
                {#if state.phase === "preview"}
                  <button class="act confirm" on:click={() => confirmImport(def.id)}>Confirm Import</button>
                  <button class="act" on:click={() => resetZone(def.id)}>Cancel</button>
                {:else if state.phase === "done"}
                  <button class="act" on:click={() => resetZone(def.id)}>Import Again</button>
                {:else if state.phase === "resting" || state.phase === "error"}
                  <span class="act passive">{def.idleAction}</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <!-- ─── Bottom panel ───────────────────────────────────────────────── -->
      {#if bottomMode === "kronos_mapping" && kronosPreview}
        <div class="bottom-panel">
          <div class="bp-head">
            <div class="bp-left">
              <span class="bp-title">Column Mapping</span>
              <span class="bp-sub">{kronosHeaders.length} source columns · {Object.keys(kronosMapping).filter(k => kronosMapping[k]).length} mapped</span>
              {#if (kronosPreview["companyCandidates"] as unknown[] | undefined)?.length}
                <span class="lp-badge rows">{(kronosPreview["companyCandidates"] as unknown[]).length} company candidate{(kronosPreview["companyCandidates"] as unknown[]).length !== 1 ? "s" : ""} detected</span>
              {/if}
            </div>
            <div class="bp-right">
              {#if zones.hr_kronos.phase === "preview"}
                <input class="pname-input" type="text" placeholder="Save as profile…" bind:value={saveProfileName} />
                <button class="lp-commit" on:click={() => confirmImport("hr_kronos")}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/></svg>
                  Stage Import
                </button>
                <button class="lp-discard" on:click={() => resetZone("hr_kronos")}>Discard</button>
              {/if}
              <button class="lp-discard" on:click={() => (bottomMode = "none")}>✕</button>
            </div>
          </div>
          <div class="map-table-wrap">
            <table class="map-table">
              <thead><tr><th>TARGET FIELD</th><th>SOURCE COLUMN</th><th>PREVIEW</th></tr></thead>
              <tbody>
                {#each KRONOS_FIELDS as field}
                  <tr>
                    <td class="ft">{field.label}</td>
                    <td>
                      <select class="col-sel" bind:value={kronosMapping[field.key]}>
                        <option value="">— not mapped —</option>
                        {#each kronosHeaders as h}<option value={h}>{h}</option>{/each}
                      </select>
                    </td>
                    <td class="fp mono small">
                      {#if kronosMapping[field.key] && (kronosPreview["rows"] as Array<Record<string, unknown>> | undefined)?.[0]}
                        {String((kronosPreview["rows"] as Array<Record<string, unknown>>)[0][kronosMapping[field.key]] ?? "").slice(0, 30)}
                      {:else}
                        <span class="dim">—</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="map-foot">
            <button class="smb" on:click={rePreviewWithMapping}>Re-preview with this mapping</button>
          </div>
        </div>

      {:else if bottomMode === "company_resolver" && resolverRows.length > 0}
        <div class="bottom-panel">
          <div class="bp-head">
            <div class="bp-left">
              <span class="bp-title">Company Candidates</span>
              <span class="bp-sub">{resolverRows.length} detected from HR import staging data</span>
              <span class="lp-badge rows">{resolverRows.filter((r) => r["matchedCompanyId"]).length} auto-matched</span>
              {#if resolverRows.filter((r) => !r["matchedCompanyId"]).length > 0}
                <span class="lp-badge warn">{resolverRows.filter((r) => !r["matchedCompanyId"]).length} new</span>
              {/if}
            </div>
            <div class="bp-right">
              {#if zones.company_resolver.phase === "preview"}
                <button class="lp-commit" on:click={() => confirmImport("company_resolver")}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/></svg>
                  Confirm All
                </button>
                <button class="lp-discard" on:click={() => resetZone("company_resolver")}>Discard</button>
              {/if}
              <button class="lp-discard" on:click={() => (bottomMode = "none")}>✕</button>
            </div>
          </div>
          <div class="lp-scroll">
            <table class="lp-table">
              <thead><tr><th>DETECTED NAME</th><th>SGK NO</th><th>WORKERS</th><th>MATCH</th><th>CONFIDENCE</th><th>ACTION</th></tr></thead>
              <tbody>
                {#each resolverRows as row}
                  <tr>
                    <td>{(row["detectedName"] as string | null) ?? "—"}</td>
                    <td class="mono small">{(row["detectedSgk"] as string | null) ?? "—"}</td>
                    <td>{(row["workerCount"] as number) ?? 0}</td>
                    <td class:matched={!!row["matchedCompanyId"]} class:unmatched={!row["matchedCompanyId"]}>
                      {(row["matchedCompanyName"] as string | null) ?? "→ Create new"}
                    </td>
                    <td>
                      <div class="conf-row">
                        <div class="conf-bar" style="width:{((row['confidence'] as number) ?? 0) * 70}px"></div>
                        <span class="conf-n">{Math.round(((row["confidence"] as number) ?? 0) * 100)}%</span>
                      </div>
                    </td>
                    <td class="act-cell">
                      <span class="chip confirm">Confirm</span>
                      <span class="chip reject">Reject</span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

      {:else if bottomMode === "corrections" && corrRows.length > 0}
        <div class="bottom-panel">
          <div class="bp-head">
            <div class="bp-left">
              <span class="bp-title">Live Preview:</span>
              <span class="bp-name">{corrFile || "Correction Set"}</span>
              <span class="lp-badge rows">{corrRows.length} ROWS</span>
              {#if corrMatched === corrRows.length}
                <span class="lp-badge ok">VALIDATED</span>
              {:else}
                <span class="lp-badge warn">{corrMatched} / {corrRows.length} MATCHED</span>
              {/if}
            </div>
            <div class="bp-right">
              {#if zones.verified_corrections.phase === "preview"}
                <button class="lp-commit" on:click={() => confirmImport("verified_corrections")}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/></svg>
                  Mark Verified &amp; Commit
                </button>
                <button class="lp-discard" on:click={() => resetZone("verified_corrections")}>Discard</button>
              {/if}
              <button class="lp-discard" on:click={() => (bottomMode = "none")}>✕</button>
            </div>
          </div>
          <div class="lp-scroll">
            <table class="lp-table">
              <thead><tr><th>SOURCE ID</th><th>DOCUMENT</th><th>FIELD PATH</th><th>ORIGINAL (OCR)</th><th>CORRECTION</th><th>CONFIDENCE</th></tr></thead>
              <tbody>
                {#each corrRows.slice(0, 20) as row}
                  <tr class:dim={row["matchStatus"] === "unmatched"}>
                    <td class="mono">#{String(row["rowIndex"]).padStart(4, "0")}</td>
                    <td class="mono small">{(row["fileName"] as string | null)?.slice(0, 28) ?? (row["fileHash"] as string | null)?.slice(0, 12) ?? "—"}</td>
                    <td class="mono small">{row["documentType"] ? "document_type" : row["manualDate"] ? "manual_date" : "document_scope"}</td>
                    <td><span class="strike">{row["matchStatus"] === "unmatched" ? "—" : row["documentType"] ? "UNKNOWN" : "unset"}</span></td>
                    <td class="corr">{(row["documentType"] ?? row["manualDate"] ?? row["documentScope"] ?? "—") as string}</td>
                    <td>
                      <div class="conf-row">
                        <div class="conf-bar" style="width:{row['matchStatus']==='hash_match'?68:row['matchStatus']==='name_match'?52:0}px"></div>
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
      <div class="rps">INGESTION STATUS</div>
      <div class="rpss">EXTRACTION QUALITY</div>
      <div class="eq">
        <div class="eq-top">
          <span class="eq-v">{ingestion?.["extractionQuality"] ?? "—"}%</span>
          {#if (ingestion?.["extractionQualityDelta"] as number | undefined) != null && (ingestion?.["extractionQualityDelta"] as number) !== 0}
            <span class="eq-d" class:pos={(ingestion?.["extractionQualityDelta"] as number) > 0}>
              {(ingestion?.["extractionQualityDelta"] as number) > 0 ? "+" : ""}{ingestion?.["extractionQualityDelta"]}%
            </span>
          {/if}
        </div>
        <div class="eq-track"><div class="eq-fill" style="width:{ingestion?.["extractionQuality"] ?? 0}%"></div></div>
      </div>

      <div class="rps">PROCESSING QUEUES</div>
      <div class="qlist">
        <div class="qrow">
          <div class="qt"><span class="qn">Text Extraction</span><span class="qs" class:on={(ingestion?.["activeJobStatus"] as string) === "running"}>{(ingestion?.["activeJobStatus"] as string) === "running" ? "Active" : "Idle"}</span></div>
          <div class="qtrack"><div class="qfill blue" style="width:{ingestion?.["activeJobProgress"] ?? 0}%"></div></div>
        </div>
        <div class="qrow">
          <div class="qt"><span class="qn">Entity Resolution</span><span class="qs">Pending</span></div>
          <div class="qtrack"><div class="qfill purple" style="width:30%"></div></div>
        </div>
        {#if (summary?.["company_resolver"]?.["pendingCount"] as number) > 0}
          <div class="qrow">
            <div class="qt"><span class="qn">Company Resolver</span><span class="qs amber">{(summary?.["company_resolver"]?.["pendingCount"] as number)} pending</span></div>
            <div class="qtrack"><div class="qfill amber" style="width:60%"></div></div>
          </div>
        {/if}
      </div>

      <div class="rps">RECENT ALERTS</div>
      <div class="alerts">
        {#if !(ingestion?.["recentAlerts"] as unknown[] | undefined)?.length}
          <span class="no-a">No open alerts</span>
        {:else}
          {#each (ingestion?.["recentAlerts"] as Array<{ id: string; severity: string; message: string }>) as a}
            <div class="ar" class:err={a.severity === "high"} class:warn={a.severity !== "high"}>
              <span>{a.severity === "high" ? "⊗" : "△"}</span>
              <span class="am">{a.message}</span>
            </div>
          {/each}
        {/if}
      </div>

      {#if ingestion}
        <div class="rpstats">
          <div class="rs"><span class="rsn">{(ingestion["totalDocuments"] as number).toLocaleString()}</span><span class="rsl">Total docs</span></div>
          <div class="rs"><span class="rsn">{ingestion["processedToday"]}</span><span class="rsl">Today</span></div>
        </div>
      {/if}

      <button class="goto-r">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>
        Go to Review Queue
      </button>
    </aside>
  </div>
</div>

<style>
  .shell{display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0f1117;color:#e2e8f0;font-size:13px;}
  .topbar{display:flex;align-items:center;gap:12px;padding:0 18px;height:44px;min-height:44px;background:#0a0d14;border-bottom:1px solid #1e2433;flex-shrink:0;}
  .tb-l{display:flex;align-items:center;gap:6px;flex:1;min-width:0;}
  .tb-co{font-weight:700;color:#f1f5f9;font-size:14px;white-space:nowrap;}
  .tb-sep{color:#334155;}
  .tb-path{font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .tb-m{display:flex;align-items:center;gap:8px;}
  .tb-btn{display:flex;align-items:center;gap:5px;background:#1e2433;border:1px solid #2d3748;color:#94a3b8;border-radius:5px;padding:4px 9px;font-size:11px;cursor:pointer;white-space:nowrap;}
  .tb-btn:hover{background:#263248;color:#e2e8f0;}
  .tb-pill{display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b;background:#1e2433;border:1px solid #1e2433;border-radius:5px;padding:3px 9px;white-space:nowrap;}
  .tb-pill.active{color:#94a3b8;}
  .dot{width:6px;height:6px;border-radius:50%;background:#334155;flex-shrink:0;}
  .dot.pulsing{background:#f59e0b;animation:pulse 1.2s ease-in-out infinite;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .tb-r{display:flex;align-items:center;gap:5px;}
  .icon-btn{background:transparent;border:none;color:#475569;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;position:relative;}
  .icon-btn:hover{color:#94a3b8;background:#1e2433;}
  .alert-dot{position:absolute;top:2px;right:2px;width:6px;height:6px;background:#ef4444;border-radius:50%;border:1px solid #0a0d14;}

  .layout{display:flex;flex:1;overflow:hidden;}
  .main{flex:1;overflow-y:auto;padding:16px 16px 28px;display:flex;flex-direction:column;gap:14px;min-width:0;}

  .ph{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
  .ph h1{font-size:18px;font-weight:700;color:#f1f5f9;margin:0;}
  .ph p{font-size:11px;color:#475569;margin:4px 0 0;line-height:1.5;max-width:380px;}
  .ph-cap{font-size:9px;color:#334155;letter-spacing:.4px;line-height:1.6;text-align:right;max-width:240px;}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:11px;}

  .card{background:#141820;border:1px solid #1e2433;border-radius:9px;display:flex;flex-direction:column;overflow:hidden;transition:border-color .15s;}
  .card.dragging{border-color:#3b82f6;}
  .ch{display:flex;align-items:flex-start;gap:8px;padding:10px 10px 0;}
  .ci{width:32px;height:32px;background:#1e2433;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#64748b;flex-shrink:0;}
  .cm{flex:1;display:flex;flex-direction:column;gap:1px;min-width:0;}
  .ct{font-size:12px;font-weight:600;color:#e2e8f0;}
  .cs{font-size:10px;color:#475569;}
  .badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:7px;letter-spacing:.4px;white-space:nowrap;flex-shrink:0;margin-top:2px;}

  .cb{flex:1;margin:7px 9px;border:1.5px dashed #1e2433;border-radius:6px;min-height:76px;display:flex;flex-direction:column;overflow:hidden;transition:border-color .15s;}
  .dragging .cb{border-color:#3b82f6;background:#1a2035;}
  .cb.active{border-style:solid;border-color:#1e2433;}

  .rb{flex:1;display:flex;flex-direction:column;gap:5px;padding:9px;}
  .rb-top{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
  .bi{color:#2d3748;flex-shrink:0;}
  .pi{flex:1;min-width:80px;background:#0f1117;border:1px solid #2d3748;color:#94a3b8;border-radius:4px;padding:3px 6px;font-size:11px;font-family:monospace;}
  .pi:focus{outline:none;border-color:#3b82f6;}
  .smb{background:#1e2433;border:1px solid #2d3748;color:#94a3b8;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;white-space:nowrap;}
  .smb:hover{background:#263248;color:#e2e8f0;}
  .mpills{display:flex;gap:3px;}
  .pill{background:transparent;border:1px solid #2d3748;color:#475569;border-radius:9px;padding:2px 6px;font-size:9px;cursor:pointer;}
  .pill.on{background:#1e2433;color:#94a3b8;border-color:#3b82f6;}
  .dropwrap{display:flex;align-items:center;gap:5px;cursor:pointer;}
  .psel{background:#1e2433;border:1px solid #2d3748;color:#94a3b8;border-radius:4px;padding:3px 5px;font-size:10px;cursor:pointer;max-width:130px;}
  .resolver-btn{display:flex;align-items:center;gap:5px;background:#0d9488;border:none;color:#fff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600;}
  .resolver-btn:hover{background:#0f766e;}
  .rb-info{display:flex;flex-direction:column;gap:2px;}
  .rl1{font-size:12px;font-weight:500;color:#94a3b8;}
  .rl2{font-size:10px;color:#475569;}
  .ie{font-size:10px;color:#ef4444;padding:4px 8px;background:#2a0f0f;border-radius:0 0 5px 5px;}

  .center-body{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px;color:#64748b;padding:12px;}
  .spin{width:12px;height:12px;border:2px solid #1e2433;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
  .prev-body{flex:1;display:flex;flex-direction:column;gap:4px;padding:9px;}
  .pc{font-size:13px;font-weight:600;color:#e2e8f0;}
  .pw{font-size:10px;color:#f59e0b;}
  .map-link{background:none;border:none;color:#3b82f6;font-size:10px;cursor:pointer;padding:0;text-align:left;text-decoration:underline;}
  .done-body{flex:1;display:flex;align-items:center;gap:6px;padding:9px;font-size:11px;color:#86efac;}
  .err-body{flex:1;display:flex;align-items:center;gap:7px;padding:9px;font-size:10px;color:#ef4444;flex-wrap:wrap;}

  .cf{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-top:1px solid #1e2433;}
  .cf-s{display:flex;align-items:center;gap:4px;}
  .cfdot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
  .cfl{font-size:10px;color:#64748b;}
  .cfa{display:flex;align-items:center;gap:7px;}
  .act{font-size:10px;font-weight:700;color:#475569;cursor:pointer;background:none;border:none;padding:0;}
  .act:hover{color:#94a3b8;}
  .act.passive{cursor:default;}
  .act.confirm{color:#22c55e;}
  .act.confirm:hover{color:#4ade80;}

  /* Bottom panel */
  .bottom-panel{background:#141820;border:1px solid #1e2433;border-radius:9px;overflow:hidden;}
  .bp-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #1e2433;gap:10px;flex-wrap:wrap;}
  .bp-left{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
  .bp-title{font-size:12px;font-weight:700;color:#e2e8f0;}
  .bp-name{font-size:12px;font-weight:600;color:#e2e8f0;}
  .bp-sub{font-size:10px;color:#64748b;}
  .bp-right{display:flex;align-items:center;gap:6px;}
  .pname-input{background:#0f1117;border:1px solid #2d3748;color:#94a3b8;border-radius:4px;padding:4px 8px;font-size:11px;width:160px;}
  .pname-input:focus{outline:none;border-color:#3b82f6;}
  .lp-badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:7px;letter-spacing:.3px;}
  .lp-badge.rows{background:#1e3a5f;color:#60a5fa;}
  .lp-badge.ok{background:#14291f;color:#22c55e;}
  .lp-badge.warn{background:#2a1f0f;color:#f59e0b;}
  .lp-discard{background:transparent;border:1px solid #2d3748;color:#64748b;border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer;}
  .lp-discard:hover{color:#94a3b8;}
  .lp-commit{display:flex;align-items:center;gap:5px;background:#1e2433;border:1px solid #334155;color:#e2e8f0;border-radius:5px;padding:4px 11px;font-size:11px;font-weight:600;cursor:pointer;}
  .lp-commit:hover{background:#263248;}

  .map-table-wrap{overflow-x:auto;max-height:260px;overflow-y:auto;}
  .map-table{width:100%;border-collapse:collapse;font-size:11px;}
  .map-table th{text-align:left;padding:6px 12px;color:#334155;font-size:9px;font-weight:700;letter-spacing:.5px;border-bottom:1px solid #1e2433;white-space:nowrap;position:sticky;top:0;background:#141820;}
  .map-table td{padding:5px 12px;color:#94a3b8;border-bottom:1px solid #1a1f2e;}
  .ft{color:#e2e8f0;font-weight:500;white-space:nowrap;}
  .fp{color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;}
  .col-sel{background:#1e2433;border:1px solid #2d3748;color:#94a3b8;border-radius:4px;padding:3px 6px;font-size:11px;width:100%;cursor:pointer;}
  .map-foot{padding:8px 14px;border-top:1px solid #1e2433;display:flex;gap:8px;}

  .lp-scroll{overflow-x:auto;max-height:220px;overflow-y:auto;}
  .lp-table{width:100%;border-collapse:collapse;font-size:11px;}
  .lp-table th{text-align:left;padding:6px 12px;color:#334155;font-size:9px;font-weight:700;letter-spacing:.5px;border-bottom:1px solid #1e2433;white-space:nowrap;background:#141820;position:sticky;top:0;}
  .lp-table td{padding:6px 12px;color:#94a3b8;border-bottom:1px solid #1a1f2e;vertical-align:middle;}
  .lp-table tr.dim td{color:#334155;}
  .lp-table tr:last-child td{border-bottom:none;}
  td.matched{color:#22c55e;}
  td.unmatched{color:#f59e0b;}
  .mono{font-family:monospace;}
  .small{font-size:10px;}
  .dim{color:#334155;}
  .strike{text-decoration:line-through;color:#475569;}
  .corr{color:#e2e8f0;font-weight:500;}
  .conf-row{display:flex;align-items:center;gap:5px;}
  .conf-bar{height:4px;background:#22c55e;border-radius:2px;min-width:3px;}
  .conf-n{font-size:10px;color:#64748b;}
  .act-cell{display:flex;gap:5px;}
  .chip{font-size:9px;font-weight:700;padding:2px 7px;border-radius:7px;cursor:pointer;}
  .chip.confirm{background:#14291f;color:#22c55e;}
  .chip.reject{background:#2a0f0f;color:#ef4444;}

  /* Right panel */
  .rp{width:205px;min-width:205px;background:#0a0d14;border-left:1px solid #1e2433;padding:14px 12px;display:flex;flex-direction:column;gap:7px;overflow-y:auto;}
  .rps{font-size:9px;font-weight:700;letter-spacing:.8px;color:#334155;text-transform:uppercase;margin-top:4px;}
  .rpss{font-size:9px;letter-spacing:.4px;color:#475569;margin-top:-3px;text-transform:uppercase;}
  .eq{display:flex;flex-direction:column;gap:5px;}
  .eq-top{display:flex;align-items:baseline;gap:5px;}
  .eq-v{font-size:24px;font-weight:700;color:#e2e8f0;line-height:1;}
  .eq-d{font-size:11px;font-weight:600;color:#475569;}
  .eq-d.pos{color:#22c55e;}
  .eq-track{height:4px;background:#1e2433;border-radius:2px;overflow:hidden;}
  .eq-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:2px;transition:width .6s;}
  .qlist{display:flex;flex-direction:column;gap:6px;}
  .qrow{display:flex;flex-direction:column;gap:3px;}
  .qt{display:flex;justify-content:space-between;}
  .qn{font-size:10px;color:#94a3b8;}
  .qs{font-size:9px;color:#475569;}
  .qs.on{color:#22c55e;}
  .qs.amber{color:#f59e0b;}
  .qtrack{height:3px;background:#1e2433;border-radius:2px;overflow:hidden;}
  .qfill{height:100%;border-radius:2px;transition:width .5s;}
  .qfill.blue{background:#3b82f6;}
  .qfill.purple{background:#a855f7;}
  .qfill.amber{background:#f59e0b;}
  .alerts{display:flex;flex-direction:column;gap:5px;}
  .no-a{font-size:10px;color:#334155;}
  .ar{display:flex;gap:5px;font-size:10px;padding:5px 7px;border-radius:4px;line-height:1.4;}
  .ar.err{background:#2a0f0f;color:#fca5a5;}
  .ar.warn{background:#2a1f0f;color:#fcd34d;}
  .am{flex:1;word-break:break-word;}
  .rpstats{display:flex;gap:10px;padding:7px 0;border-top:1px solid #1e2433;margin-top:2px;}
  .rs{display:flex;flex-direction:column;gap:2px;}
  .rsn{font-size:15px;font-weight:700;color:#e2e8f0;}
  .rsl{font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:.4px;}
  .goto-r{display:flex;align-items:center;justify-content:center;gap:5px;background:#1e2433;border:1px solid #2d3748;color:#64748b;border-radius:6px;padding:7px;font-size:10px;cursor:pointer;margin-top:auto;}
  .goto-r:hover{background:#263248;color:#94a3b8;}
</style>
