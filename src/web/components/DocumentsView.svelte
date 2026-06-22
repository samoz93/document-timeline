<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company, Document } from "$lib/types.ts";

  export let company: Company | null;

  let documents: Document[] = [];
  let query = "";
  let filterYear = "";
  let filterScope = "";
  let filterNeedsReview = false;
  let filterDateMismatch = false;
  let loading = false;

  $: if (company) load();

  async function load() {
    if (!company) return;
    loading = true;
    try {
      documents = await api.searchDocuments({
        companyId: company.id,
        query: query || undefined,
        year: filterYear || undefined,
        documentScope: filterScope ? [filterScope] : undefined,
        needsReview: filterNeedsReview || undefined,
        dateMismatch: filterDateMismatch || undefined,
        limit: 100,
      });
    } finally {
      loading = false;
    }
  }

  async function openDoc(doc: Document) {
    try { await api.openDocument(doc.id); }
    catch (e) { alert(String(e)); }
  }

  function confidenceColor(c: number) {
    if (c >= 0.8) return "#22c55e";
    if (c >= 0.5) return "#f59e0b";
    return "#ef4444";
  }
</script>

<div class="docs-view">
  <div class="view-header">
    <h1>Documents</h1>
    <div class="filters">
      <input class="filter-input" placeholder="Search..." bind:value={query} on:input={load} />
      <input class="filter-input small" placeholder="Year" bind:value={filterYear} on:change={load} />
      <select class="filter-input small" bind:value={filterScope} on:change={load}>
        <option value="">All Scopes</option>
        <option value="single_worker">Single Worker</option>
        <option value="worker_list">Worker List</option>
        <option value="company_level">Company Level</option>
        <option value="department_level">Department Level</option>
        <option value="unknown">Unknown</option>
      </select>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={filterNeedsReview} on:change={load} />
        Needs Review
      </label>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={filterDateMismatch} on:change={load} />
        Date Mismatch
      </label>
    </div>
  </div>

  <div class="table-wrapper">
    {#if loading}
      <div class="loading">Loading...</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>File Name</th>
            <th>Best Date</th>
            <th>Category</th>
            <th>Document Type</th>
            <th>Scope</th>
            <th>Confidence</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each documents as doc}
            <tr class:needs-review={doc.needs_review}>
              <td class="filename">{doc.file_name}</td>
              <td>{doc.best_date?.slice(0, 10) ?? "--"}</td>
              <td><span class="badge cat-{doc.category}">{doc.category}</span></td>
              <td class="doctype">{doc.document_type.replace(/_/g, " ")}</td>
              <td><span class="badge scope-badge">{doc.document_scope.replace(/_/g, " ")}</span></td>
              <td style="color: {confidenceColor(doc.classification_confidence)}">
                {(doc.classification_confidence * 100).toFixed(0)}%
              </td>
              <td>
                {#if doc.needs_review}
                  <span class="badge badge-review">REVIEW</span>
                {:else if doc.verified_at}
                  <span class="badge badge-verified">✓ Verified</span>
                {:else if doc.date_mismatch}
                  <span class="badge badge-mismatch">⚠ DATE</span>
                {:else}
                  <span class="badge badge-ok">OK</span>
                {/if}
              </td>
              <td>
                <button class="open-btn" on:click={() => openDoc(doc)}>↗</button>
              </td>
            </tr>
          {/each}
          {#if documents.length === 0}
            <tr><td colspan="8" class="empty">No documents found.</td></tr>
          {/if}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .docs-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .view-header {
    padding: 14px 20px; border-bottom: 1px solid #1e2433;
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  }
  h1 { font-size: 16px; font-weight: 600; color: #e2e8f0; white-space: nowrap; }
  .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; }
  .filter-input {
    background: #1e2433; border: 1px solid #2d3748; color: #cbd5e1;
    padding: 5px 10px; border-radius: 5px; font-size: 12px;
  }
  .filter-input.small { width: 80px; }
  .checkbox-label { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; cursor: pointer; }

  .table-wrapper { flex: 1; overflow-y: auto; }
  .loading, .empty { color: #475569; text-align: center; padding: 40px; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    position: sticky; top: 0; background: #0a0d14;
    padding: 8px 12px; text-align: left; font-size: 10px; color: #475569;
    border-bottom: 1px solid #1e2433; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;
  }
  tbody tr { border-bottom: 1px solid #1a1f2e; }
  tbody tr:hover { background: #131929; }
  tbody tr.needs-review { border-left: 2px solid #f59e0b; }
  td { padding: 7px 12px; font-size: 12px; color: #94a3b8; }
  td.filename { color: #cbd5e1; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.doctype { font-size: 11px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  td.empty { text-align: center; }

  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .badge-review { background: #451a03; color: #fb923c; }
  .badge-verified { background: #052e16; color: #4ade80; }
  .badge-mismatch { background: #2d1a0a; color: #fb923c; }
  .badge-ok { background: #1e2433; color: #64748b; }
  .cat-medical { background: #1e3a5f; color: #93c5fd; }
  .cat-safety { background: #2d1a0a; color: #fb923c; }
  .cat-education { background: #1a2e1a; color: #86efac; }
  .cat-unknown { background: #1e2433; color: #64748b; }
  .scope-badge { background: #1e2433; color: #94a3b8; }
  .open-btn {
    background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 14px; padding: 2px 6px;
  }
</style>
