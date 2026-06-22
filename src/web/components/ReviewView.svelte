<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company, ReviewItem } from "$lib/types.ts";

  export let company: Company | null;

  let items: ReviewItem[] = [];
  let loading = false;

  $: if (company) load();

  async function load() {
    if (!company) return;
    loading = true;
    try {
      items = await api.listReviewItems(company.id);
    } finally {
      loading = false;
    }
  }

  async function resolve(id: string) {
    await api.resolveReviewItem(id, "resolved");
    items = items.filter((i) => i.id !== id);
  }

  async function ignore(id: string) {
    await api.resolveReviewItem(id, "ignored");
    items = items.filter((i) => i.id !== id);
  }

  const GROUPS: { key: string; label: string }[] = [
    { key: "DATE_MISMATCH", label: "Date Mismatch" },
    { key: "LOW_CLASSIFICATION_CONFIDENCE", label: "Low Classification Confidence" },
    { key: "UNKNOWN_DOCUMENT_TYPE", label: "Unknown Document Type" },
    { key: "UNLINKED_WORKER_DOCUMENT", label: "Unlinked Single-Worker Document" },
    { key: "POSSIBLE_DUPLICATE_WORKER", label: "Possible Duplicate Worker" },
    { key: "OCR_FAILED", label: "OCR Failed" },
    { key: "OCR_PENDING", label: "OCR Pending" },
    { key: "SCOPE_UNCERTAIN", label: "Scope Uncertain" },
    { key: "WORKER_LIST_EXTRACTION_REVIEW", label: "Worker List Needs Review" },
    { key: "EXTRACTION_FAILED", label: "Extraction Failed" },
    { key: "LOW_DATE_CONFIDENCE", label: "Low Date Confidence" },
  ];

  function severityColor(s: string) {
    if (s === "high") return "#ef4444";
    if (s === "medium") return "#f59e0b";
    return "#64748b";
  }

  function groupItems(issueType: string) {
    return items.filter((i) => i.issue_type === issueType);
  }
</script>

<div class="review-view">
  <div class="view-header">
    <h1>Quality Control Queue</h1>
    <span class="badge-count">{items.length} open issues</span>
  </div>

  <div class="review-body">
    {#if loading}
      <div class="loading">Loading...</div>
    {:else}
      {#each GROUPS as group}
        {@const groupItems_ = groupItems(group.key)}
        {#if groupItems_.length > 0}
          <div class="issue-group">
            <div class="group-header">
              <span class="group-label">{group.label}</span>
              <span class="group-count">{groupItems_.length}</span>
            </div>
            {#each groupItems_ as item}
              <div class="issue-card">
                <div class="issue-left">
                  <span class="severity-dot" style="background: {severityColor(item.severity)}"></span>
                  <div class="issue-info">
                    <div class="issue-type">{item.issue_type.replace(/_/g, " ")}</div>
                    <div class="issue-msg">{item.message}</div>
                    <div class="issue-doc">Document: <code>{item.document_id.slice(0, 8)}…</code></div>
                  </div>
                </div>
                <div class="issue-actions">
                  <button class="btn-resolve" on:click={() => resolve(item.id)}>Resolve</button>
                  <button class="btn-ignore" on:click={() => ignore(item.id)}>Ignore</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/each}
      {#if items.length === 0}
        <div class="empty">No open review items. All clear!</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .review-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .view-header {
    padding: 14px 20px; border-bottom: 1px solid #1e2433;
    display: flex; align-items: center; gap: 12px;
  }
  h1 { font-size: 16px; font-weight: 600; color: #e2e8f0; }
  .badge-count { background: #451a03; color: #fb923c; padding: 2px 8px; border-radius: 10px; font-size: 12px; }

  .review-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .loading, .empty { color: #475569; text-align: center; padding: 40px; }

  .issue-group { margin-bottom: 24px; }
  .group-header {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #1e2433;
  }
  .group-label { font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .group-count { background: #1e2433; color: #64748b; padding: 1px 7px; border-radius: 10px; font-size: 11px; }

  .issue-card {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 10px 12px; background: #0a0d14; border: 1px solid #1e2433;
    border-radius: 6px; margin-bottom: 6px;
  }
  .issue-left { display: flex; gap: 10px; align-items: flex-start; }
  .severity-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .issue-info { display: flex; flex-direction: column; gap: 3px; }
  .issue-type { font-size: 12px; font-weight: 600; color: #cbd5e1; }
  .issue-msg { font-size: 12px; color: #64748b; }
  .issue-doc { font-size: 11px; color: #475569; }
  .issue-doc code { color: #94a3b8; font-family: monospace; }

  .issue-actions { display: flex; gap: 6px; flex-shrink: 0; margin-left: 12px; }
  .btn-resolve {
    padding: 4px 10px; background: #052e16; border: 1px solid #166534;
    color: #4ade80; border-radius: 4px; cursor: pointer; font-size: 11px;
  }
  .btn-ignore {
    padding: 4px 10px; background: #1e2433; border: 1px solid #334155;
    color: #64748b; border-radius: 4px; cursor: pointer; font-size: 11px;
  }
</style>
