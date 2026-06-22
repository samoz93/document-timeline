<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company, WorkerListSnapshot, WorkerListRow, WorkerSnapshotDiff } from "$lib/types.ts";

  export let company: Company | null;

  let snapshots: WorkerListSnapshot[] = [];
  let selectedSnapshot: WorkerListSnapshot | null = null;
  let snapshotRows: WorkerListRow[] = [];
  let comparingId: string | null = null;
  let diff: WorkerSnapshotDiff | null = null;
  let loading = false;

  $: if (company) load();

  async function load() {
    if (!company) return;
    loading = true;
    try {
      snapshots = await api.listWorkerListSnapshots(company.id);
    } finally {
      loading = false;
    }
  }

  async function selectSnapshot(s: WorkerListSnapshot) {
    selectedSnapshot = s;
    const res = await api.getWorkerListSnapshot(s.id);
    snapshotRows = res.rows;
    diff = null;
    comparingId = null;
  }

  async function startCompare(id: string) {
    comparingId = id;
    if (selectedSnapshot) {
      diff = await api.compareWorkerListSnapshots(id, selectedSnapshot.id);
    }
  }

  function confidenceColor(c: number) {
    if (c >= 0.8) return "#22c55e";
    if (c >= 0.5) return "#f59e0b";
    return "#ef4444";
  }
</script>

<div class="lists-view">
  <div class="view-header">
    <div>
      <h1>Multi-worker Snapshots</h1>
      <p>Aggregate views and archival tracking across organizational datasets.</p>
    </div>
    <button class="btn-new">+ New Snapshot</button>
  </div>

  <div class="content">
    <div class="snapshot-section">
      <table>
        <thead>
          <tr>
            <th>Snapshot Date</th>
            <th>List Type</th>
            <th>Company</th>
            <th>Rows</th>
            <th>Date Source</th>
            <th>Confidence</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each snapshots as snap}
            <tr class:selected={selectedSnapshot?.id === snap.id} on:click={() => selectSnapshot(snap)}>
              <td>{snap.snapshot_date?.slice(0, 10) ?? "--"}</td>
              <td><span class="badge list-type">{snap.list_type.replace(/_/g, " ")}</span></td>
              <td>{company?.name}</td>
              <td>{snap.row_count.toLocaleString()}</td>
              <td class="dim">{snap.snapshot_date_source}</td>
              <td style="color: {confidenceColor(snap.confidence)}">{(snap.confidence * 100).toFixed(1)}%</td>
              <td>
                <button class="compare-btn" on:click|stopPropagation={() => startCompare(snap.id)}>
                  ⇌
                </button>
              </td>
            </tr>
          {/each}
          {#if snapshots.length === 0}
            <tr><td colspan="7" class="empty">No snapshots found.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>

    {#if diff}
      <div class="diff-section">
        <div class="diff-header">Comparison Tool Preview</div>

        <div class="diff-cards">
          <div class="diff-card green">
            <div class="diff-count">+{diff.joined.length}</div>
            <div class="diff-label">Joined Workers</div>
            <div class="diff-desc">New entries detected in current snapshot.</div>
            <div class="diff-list">
              {#each diff.joined.slice(0, 5) as r}
                <div class="diff-row">{r.worker_name ?? "—"} <span class="dim">{r.department ?? ""}</span></div>
              {/each}
            </div>
          </div>

          <div class="diff-card red">
            <div class="diff-count">-{diff.left.length}</div>
            <div class="diff-label">Left Workers</div>
            <div class="diff-desc">Records present in baseline but missing from current.</div>
            <div class="diff-list">
              {#each diff.left.slice(0, 5) as r}
                <div class="diff-row strikethrough">{r.worker_name ?? "—"} <span class="dim">{r.department ?? ""}</span></div>
              {/each}
            </div>
          </div>

          <div class="diff-card blue">
            <div class="diff-count">{diff.departmentChanged.length + diff.jobTitleChanged.length}</div>
            <div class="diff-label">Department Changes</div>
            <table class="inner-table">
              <thead><tr><th>Worker</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {#each diff.departmentChanged.slice(0, 5) as c}
                  <tr>
                    <td>{c.worker.worker_name ?? "—"}</td>
                    <td class="dim">{c.fromDepartment ?? "—"}</td>
                    <td><strong>{c.toDepartment ?? "—"}</strong></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    {/if}

    {#if selectedSnapshot && !diff}
      <div class="rows-section">
        <div class="rows-header">Snapshot Rows ({snapshotRows.length})</div>
        <div class="rows-scroll">
          <table>
            <thead><tr><th>Name</th><th>TCKN</th><th>Department</th><th>Job Title</th></tr></thead>
            <tbody>
              {#each snapshotRows as row}
                <tr>
                  <td>{row.worker_name ?? "—"}</td>
                  <td class="dim">{row.tckn_masked ?? "—"}</td>
                  <td>{row.department ?? "—"}</td>
                  <td>{row.job_title ?? "—"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .lists-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .view-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 14px 20px; border-bottom: 1px solid #1e2433;
  }
  h1 { font-size: 16px; font-weight: 600; color: #e2e8f0; }
  p { font-size: 12px; color: #64748b; margin-top: 2px; }
  .btn-new {
    background: #1e2433; border: 1px solid #334155; color: #e2e8f0;
    padding: 7px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
  }

  .content { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .snapshot-section { margin-bottom: 20px; }
  .empty { text-align: center; color: #475569; padding: 30px; }

  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #0a0d14; padding: 7px 10px; text-align: left;
    font-size: 10px; color: #475569; border-bottom: 1px solid #1e2433;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  tbody tr { border-bottom: 1px solid #1a1f2e; cursor: pointer; }
  tbody tr:hover { background: #131929; }
  tbody tr.selected { background: #1e2d45; }
  td { padding: 7px 10px; font-size: 12px; color: #94a3b8; }
  .dim { color: #475569; font-style: italic; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .list-type { background: #3b1f5e; color: #c084fc; }
  .compare-btn {
    background: #1e2433; border: 1px solid #334155; color: #94a3b8;
    padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 13px;
  }

  .diff-section { background: #0a0d14; border: 1px solid #1e2433; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  .diff-header { font-size: 14px; font-weight: 600; color: #e2e8f0; margin-bottom: 12px; }
  .diff-cards { display: flex; gap: 12px; }
  .diff-card { flex: 1; background: #111827; border-radius: 6px; padding: 14px; }
  .diff-count { font-size: 28px; font-weight: 700; }
  .diff-label { font-size: 13px; font-weight: 600; color: #e2e8f0; margin-top: 4px; }
  .diff-desc { font-size: 11px; color: #64748b; margin-top: 4px; margin-bottom: 10px; }
  .diff-card.green .diff-count { color: #22c55e; }
  .diff-card.red .diff-count { color: #ef4444; }
  .diff-card.blue .diff-count { color: #93c5fd; }
  .diff-row { font-size: 12px; color: #94a3b8; padding: 2px 0; }
  .strikethrough { text-decoration: line-through; color: #64748b; }

  .inner-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .inner-table th { font-size: 10px; color: #475569; text-align: left; padding: 3px 6px; }
  .inner-table td { font-size: 11px; color: #94a3b8; padding: 3px 6px; }

  .rows-section { background: #0a0d14; border: 1px solid #1e2433; border-radius: 6px; overflow: hidden; }
  .rows-header { padding: 10px 14px; font-size: 13px; font-weight: 600; color: #94a3b8; border-bottom: 1px solid #1e2433; }
  .rows-scroll { max-height: 300px; overflow-y: auto; }
</style>
