<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company, Patient, TimelineEvent } from "$lib/types.ts";

  export let company: Company | null;

  let workers: Patient[] = [];
  let selectedWorker: Patient | null = null;
  let workerTimeline: TimelineEvent[] = [];
  let loading = false;

  $: if (company) load();

  async function load() {
    if (!company) return;
    loading = true;
    try {
      workers = await api.listWorkers(company.id);
    } finally {
      loading = false;
    }
  }

  async function selectWorker(w: Patient) {
    selectedWorker = w;
    const result = await api.getWorkerTimeline(w.id);
    workerTimeline = result?.timeline ?? [];
  }
</script>

<div class="workers-view">
  <div class="view-header">
    <h1>Workers</h1>
    <span class="count">{workers.length} workers</span>
  </div>
  <div class="content">
    <div class="worker-list" class:with-detail={!!selectedWorker}>
      {#if loading}
        <div class="empty">Loading...</div>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>TCKN</th>
              <th>Department</th>
              <th>Job Title</th>
              <th>First Seen</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {#each workers as w}
              <tr
                class:selected={selectedWorker?.id === w.id}
                on:click={() => selectWorker(w)}
              >
                <td class="name">{w.name}</td>
                <td class="dim">{w.tckn_masked ?? "—"}</td>
                <td>{w.department ?? "—"}</td>
                <td>{w.job_title ?? "—"}</td>
                <td class="dim">{w.first_seen_date?.slice(0, 10) ?? "—"}</td>
                <td class="dim">{w.last_seen_date?.slice(0, 10) ?? "—"}</td>
              </tr>
            {/each}
            {#if workers.length === 0}
              <tr><td colspan="6" class="empty">No workers found.</td></tr>
            {/if}
          </tbody>
        </table>
      {/if}
    </div>

    {#if selectedWorker}
      <div class="worker-detail">
        <div class="detail-header">
          <span class="detail-name">{selectedWorker.name}</span>
          <button on:click={() => { selectedWorker = null; workerTimeline = []; }}>✕</button>
        </div>
        <div class="detail-meta">
          {#if selectedWorker.tckn_masked}<div><span class="lbl">TCKN</span> {selectedWorker.tckn_masked}</div>{/if}
          {#if selectedWorker.department}<div><span class="lbl">Department</span> {selectedWorker.department}</div>{/if}
          {#if selectedWorker.job_title}<div><span class="lbl">Title</span> {selectedWorker.job_title}</div>{/if}
        </div>
        <div class="detail-timeline-title">Timeline ({workerTimeline.length} events)</div>
        <div class="detail-timeline">
          {#each workerTimeline as e}
            <div class="tl-event">
              <span class="tl-date">{e.event_date?.slice(0, 10) ?? "--"}</span>
              <span class="tl-title">{e.title}</span>
              {#if e.needs_review}<span class="badge-r">R</span>{/if}
            </div>
          {/each}
          {#if workerTimeline.length === 0}
            <div class="empty">No events.</div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .workers-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .view-header {
    padding: 14px 20px; border-bottom: 1px solid #1e2433;
    display: flex; align-items: center; gap: 12px;
  }
  h1 { font-size: 16px; font-weight: 600; color: #e2e8f0; }
  .count { color: #64748b; font-size: 13px; }

  .content { flex: 1; display: flex; overflow: hidden; }
  .worker-list { flex: 1; overflow-y: auto; }
  .worker-list.with-detail { max-width: 60%; }
  .empty { text-align: center; color: #475569; padding: 30px; }

  table { width: 100%; border-collapse: collapse; }
  thead th {
    position: sticky; top: 0; background: #0a0d14;
    padding: 7px 12px; text-align: left; font-size: 10px; color: #475569;
    border-bottom: 1px solid #1e2433; text-transform: uppercase; letter-spacing: 0.5px;
  }
  tbody tr { border-bottom: 1px solid #1a1f2e; cursor: pointer; }
  tbody tr:hover { background: #131929; }
  tbody tr.selected { background: #1e2d45; }
  td { padding: 7px 12px; font-size: 12px; color: #94a3b8; }
  td.name { color: #cbd5e1; font-weight: 500; }
  .dim { color: #475569; }

  .worker-detail {
    width: 320px; border-left: 1px solid #1e2433; background: #0a0d14;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .detail-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 14px; border-bottom: 1px solid #1e2433;
  }
  .detail-header button { background: none; border: none; color: #475569; cursor: pointer; }
  .detail-name { font-size: 14px; font-weight: 600; color: #e2e8f0; }
  .detail-meta { padding: 10px 14px; font-size: 12px; color: #64748b; display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid #1e2433; }
  .lbl { color: #475569; margin-right: 6px; font-size: 11px; }
  .detail-timeline-title { padding: 8px 14px; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
  .detail-timeline { flex: 1; overflow-y: auto; padding: 0 14px 14px; }
  .tl-event { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #1a1f2e; font-size: 12px; }
  .tl-date { color: #475569; min-width: 80px; }
  .tl-title { color: #94a3b8; flex: 1; }
  .badge-r { background: #451a03; color: #fb923c; padding: 1px 5px; border-radius: 3px; font-size: 10px; }
</style>
