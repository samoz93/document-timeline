<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company, Document, WorkspaceStats } from "$lib/types.ts";
  import DocumentInspector from "./DocumentInspector.svelte";

  export let company: Company | null;

  let stats: WorkspaceStats | null = null;
  let documents: Document[] = [];
  let selectedDoc: Document | null = null;
  let searchQuery = "";
  let indexingStatus: any = null;
  let indexing = false;

  $: if (company) loadData();

  async function loadData() {
    if (!company) return;
    [stats, documents] = await Promise.all([
      api.getWorkspaceStats(company.id),
      api.searchDocuments({ companyId: company.id, limit: 50 }),
    ]);
    indexingStatus = await api.getIndexingStatus(company.id);
  }

  async function search() {
    if (!company) return;
    documents = await api.searchDocuments({
      companyId: company.id,
      query: searchQuery || undefined,
      limit: 50,
    });
  }

  async function reindex() {
    if (!company) return;
    indexing = true;
    try {
      await api.startReindex(company.id);
      setTimeout(loadData, 3000);
    } finally {
      indexing = false;
    }
  }

  async function selectDoc(doc: Document) {
    selectedDoc = (await api.getDocumentDetails(doc.id)) as Document;
  }

  function confidenceColor(c: number): string {
    if (c >= 0.8) return "#22c55e";
    if (c >= 0.5) return "#f59e0b";
    return "#ef4444";
  }

  function formatDate(d: string | null): string {
    if (!d) return "--";
    return d.slice(0, 10);
  }
</script>

<div class="workspace">
  <div class="topbar">
    <div class="topbar-left">
      <span class="company-name">{company?.name ?? "—"}</span>
      {#if company?.master_folder_path}
        <span class="folder-path">{company.master_folder_path}</span>
      {/if}
    </div>
    <div class="topbar-right">
      <input
        class="search-input"
        bind:value={searchQuery}
        placeholder="Search archive..."
        on:input={search}
      />
      <button class="btn-reindex" on:click={reindex} disabled={indexing}>
        {indexing ? "Indexing..." : "⟳ Reindex Folder"}
      </button>
      {#if indexingStatus}
        <span class="indexing-badge">
          {indexingStatus.processed_files ?? 0}/{indexingStatus.total_files ?? 0}
        </span>
      {/if}
    </div>
  </div>

  {#if stats}
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-label">TOTAL DOCUMENTS</div>
        <div class="stat-value">{stats.totalDocuments.toLocaleString()}</div>
      </div>
      <div class="stat-card warn">
        <div class="stat-label">NEEDS REVIEW</div>
        <div class="stat-value">{stats.needsReview}</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">DATE MISMATCHES</div>
        <div class="stat-value">{stats.dateMismatch}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">UNLINKED WORKERS</div>
        <div class="stat-value">{stats.unlinkedWorkerDocs}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">WORKER LISTS</div>
        <div class="stat-value">{stats.workerLists}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">TIMELINE EVENTS</div>
        <div class="stat-value">{stats.timelineEvents}</div>
      </div>
    </div>
  {/if}

  <div class="content-area">
    <div class="table-section" class:with-inspector={!!selectedDoc}>
      <div class="table-header">
        <span>Recent Ingestions</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>File Name</th>
              <th>Best Date</th>
              <th>Source</th>
              <th>Scope</th>
              <th>Doc Type</th>
              <th>Conf</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each documents as doc}
              <tr
                class:selected={selectedDoc?.id === doc.id}
                class:needs-review={doc.needs_review}
                on:click={() => selectDoc(doc)}
              >
                <td class="filename">{doc.file_name}</td>
                <td>{formatDate(doc.best_date)}</td>
                <td class="source">{doc.best_date_source}</td>
                <td>
                  <span class="badge scope-{doc.document_scope.replace('_', '-')}">
                    {doc.document_scope.replace(/_/g, " ").toUpperCase()}
                  </span>
                </td>
                <td class="doctype">{doc.document_type.replace(/_/g, " ")}</td>
                <td>
                  <span style="color: {confidenceColor(doc.classification_confidence)}">
                    {(doc.classification_confidence * 100).toFixed(0)}%
                  </span>
                </td>
                <td>
                  {#if doc.needs_review}
                    <span class="badge badge-review">REVIEW</span>
                  {:else if doc.verified_at}
                    <span class="badge badge-verified">✓</span>
                  {:else}
                    <span class="badge badge-ok">OK</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    {#if selectedDoc}
      <DocumentInspector
        doc={selectedDoc}
        on:close={() => (selectedDoc = null)}
        on:updated={loadData}
      />
    {/if}
  </div>
</div>

<style>
  .workspace { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; border-bottom: 1px solid #1e2433; background: #0a0d14;
  }
  .topbar-left { display: flex; flex-direction: column; gap: 2px; }
  .company-name { font-size: 14px; font-weight: 600; color: #e2e8f0; }
  .folder-path { font-size: 11px; color: #475569; font-family: monospace; }
  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .search-input {
    background: #1e2433; border: 1px solid #2d3748; color: #cbd5e1;
    padding: 6px 12px; border-radius: 6px; font-size: 12px; width: 220px;
  }
  .btn-reindex {
    background: #1e293b; border: 1px solid #334155; color: #94a3b8;
    padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
  }
  .btn-reindex:disabled { opacity: 0.5; cursor: not-allowed; }
  .indexing-badge { font-size: 11px; color: #64748b; }

  .stats-bar {
    display: flex; gap: 0; border-bottom: 1px solid #1e2433;
  }
  .stat-card {
    flex: 1; padding: 14px 18px; border-right: 1px solid #1e2433;
  }
  .stat-card:last-child { border-right: none; }
  .stat-label { font-size: 10px; color: #475569; letter-spacing: 0.5px; text-transform: uppercase; }
  .stat-value { font-size: 22px; font-weight: 700; color: #e2e8f0; margin-top: 4px; }
  .stat-card.warn .stat-value { color: #f59e0b; }
  .stat-card.danger .stat-value { color: #ef4444; }

  .content-area { flex: 1; display: flex; overflow: hidden; }
  .table-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .table-section.with-inspector { max-width: 55%; }
  .table-header { padding: 12px 20px; font-size: 13px; font-weight: 600; color: #94a3b8; border-bottom: 1px solid #1e2433; }
  .table-scroll { flex: 1; overflow-y: auto; }

  table { width: 100%; border-collapse: collapse; }
  thead th {
    position: sticky; top: 0; background: #0a0d14;
    padding: 8px 12px; text-align: left; font-size: 11px;
    color: #475569; border-bottom: 1px solid #1e2433; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  tbody tr { border-bottom: 1px solid #1a1f2e; cursor: pointer; transition: background 0.1s; }
  tbody tr:hover { background: #131929; }
  tbody tr.selected { background: #1e2d45; }
  tbody tr.needs-review { border-left: 2px solid #f59e0b; }
  td { padding: 8px 12px; font-size: 12px; color: #94a3b8; }
  td.filename { color: #cbd5e1; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.source { color: #64748b; font-style: italic; }
  td.doctype { font-size: 11px; color: #64748b; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }

  .badge {
    display: inline-block; padding: 2px 6px; border-radius: 3px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.3px;
  }
  .badge-review { background: #451a03; color: #fb923c; }
  .badge-verified { background: #052e16; color: #4ade80; }
  .badge-ok { background: #1e293b; color: #64748b; }
  .scope-single-worker { background: #1e3a5f; color: #93c5fd; }
  .scope-worker-list { background: #3b1f5e; color: #c084fc; }
  .scope-company-level { background: #1a2e1a; color: #86efac; }
  .scope-unknown { background: #1e2433; color: #64748b; }
</style>
