<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company, TimelineEvent } from "$lib/types.ts";

  export let company: Company | null;

  let events: TimelineEvent[] = [];
  let mode: "company" | "worker" = "company";
  let filterYear = "";
  let loading = false;

  $: if (company) load();

  async function load() {
    if (!company) return;
    loading = true;
    try {
      events = await api.listTimeline({
        companyId: company.id,
        year: filterYear || undefined,
        limit: 200,
      });
    } finally {
      loading = false;
    }
  }

  // Group events by year
  type YearGroup = { year: string; events: TimelineEvent[] };
  $: groups = (() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const year = e.event_date?.slice(0, 4) ?? "Unknown";
      if (!map.has(year)) map.set(year, []);
      map.get(year)!.push(e);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, evts]) => ({ year, events: evts }));
  })();

  function monthLabel(date: string | null): string {
    if (!date) return "";
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const m = parseInt(date.slice(5, 7), 10) - 1;
    return months[m] ?? "";
  }

  function eventTypeBadge(type: string): string {
    if (type.includes("exam")) return "badge-exam";
    if (type.includes("list") || type.includes("snapshot")) return "badge-list";
    if (type.includes("risk") || type.includes("incident") || type.includes("near_miss")) return "badge-safety";
    if (type.includes("referral")) return "badge-referral";
    return "badge-default";
  }
</script>

<div class="timeline-view">
  <div class="view-header">
    <div>
      <h1>Clinical Archive Timeline</h1>
      <p>Reviewing chronologically organized clinical data across the workspace.</p>
    </div>
    <div class="mode-toggle">
      <button class:active={mode === "worker"} on:click={() => (mode = "worker")}>Worker Timeline</button>
      <button class:active={mode === "company"} on:click={() => (mode = "company")}>Company Timeline</button>
    </div>
  </div>

  <div class="timeline-body">
    <div class="events-section">
      {#if loading}
        <div class="loading">Loading...</div>
      {:else}
        {#each groups as group}
          <div class="year-group">
            <div class="year-label">{group.year}</div>
            {#each group.events as event}
              <div class="event-card" class:needs-review={event.needs_review}>
                <div class="event-icon">📄</div>
                <div class="event-body">
                  <div class="event-top">
                    <span class="event-month">{monthLabel(event.event_date)}</span>
                    <span class="event-title">{event.title}</span>
                    <span class="badge {eventTypeBadge(event.event_type)}">
                      {event.event_type.replace(/_/g, " ").toUpperCase()}
                    </span>
                    {#if event.needs_review}
                      <span class="badge badge-review">REVIEW</span>
                    {/if}
                  </div>
                  <div class="event-meta">
                    {#if event.patient_id}
                      <span>⚇ Worker linked</span>
                    {:else}
                      <span>🏢 Company</span>
                    {/if}
                    <span>• Source: {event.event_date_source}</span>
                  </div>
                  <a href="#" on:click|preventDefault class="view-link">View Document ↗</a>
                </div>
              </div>
            {/each}
          </div>
        {/each}
        {#if groups.length === 0}
          <div class="empty">No timeline events found.</div>
        {/if}
      {/if}
    </div>

    <aside class="filters">
      <div class="filters-title">TIMELINE FILTERS <button class="reset-btn">Reset</button></div>

      <div class="filter-group">
        <label>Date Range</label>
        <div class="filter-row"><span class="filter-lbl">FROM</span>
          <input type="month" class="filter-input" /></div>
        <div class="filter-row"><span class="filter-lbl">TO</span>
          <input type="month" class="filter-input" /></div>
      </div>

      <div class="filter-group">
        <label>Year</label>
        <input class="filter-input" placeholder="e.g. 2023" bind:value={filterYear} on:change={load} />
      </div>

      <div class="filter-group">
        <label>Scope</label>
        <select class="filter-input">
          <option>All Scopes</option>
          <option>Single Worker</option>
          <option>Worker List</option>
          <option>Company Level</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Data Source</label>
        <div class="chip-group">
          <span class="chip active">Content</span>
          <span class="chip active">Filename</span>
          <span class="chip active">Folder Name</span>
          <span class="chip">OCR Header</span>
        </div>
      </div>

      <button class="btn-apply">Apply All Filters</button>
    </aside>
  </div>
</div>

<style>
  .timeline-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #0f1117; }
  .view-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 18px 24px; border-bottom: 1px solid #1e2433;
  }
  h1 { font-size: 18px; font-weight: 600; color: #e2e8f0; }
  p { font-size: 12px; color: #64748b; margin-top: 3px; }
  .mode-toggle { display: flex; background: #1e2433; border-radius: 6px; padding: 2px; }
  .mode-toggle button {
    padding: 6px 14px; border: none; background: transparent; color: #64748b;
    cursor: pointer; border-radius: 4px; font-size: 12px;
  }
  .mode-toggle button.active { background: #334155; color: #e2e8f0; }

  .timeline-body { flex: 1; display: flex; overflow: hidden; }
  .events-section { flex: 1; overflow-y: auto; padding: 20px 24px; }
  .loading, .empty { color: #475569; text-align: center; padding: 40px; }

  .year-group { margin-bottom: 24px; }
  .year-label { font-size: 22px; font-weight: 700; color: #e2e8f0; margin-bottom: 14px; border-bottom: 1px solid #1e2433; padding-bottom: 8px; }

  .event-card {
    display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #1a1f2e;
  }
  .event-card.needs-review { border-left: 2px solid #f59e0b; padding-left: 8px; }
  .event-icon { font-size: 20px; color: #475569; margin-top: 2px; }
  .event-body { flex: 1; }
  .event-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .event-month { font-size: 11px; color: #475569; font-weight: 600; min-width: 28px; }
  .event-title { font-size: 13px; color: #e2e8f0; font-weight: 500; }
  .event-meta { font-size: 11px; color: #475569; margin-top: 3px; display: flex; gap: 4px; }
  .view-link { font-size: 11px; color: #3b82f6; text-decoration: none; margin-top: 4px; display: inline-block; }

  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .badge-exam { background: #1e3a5f; color: #93c5fd; }
  .badge-list { background: #3b1f5e; color: #c084fc; }
  .badge-safety { background: #2d1a0a; color: #fb923c; }
  .badge-referral { background: #1a2e1a; color: #86efac; }
  .badge-default { background: #1e2433; color: #64748b; }
  .badge-review { background: #451a03; color: #fb923c; }

  .filters {
    width: 280px; border-left: 1px solid #1e2433; padding: 16px;
    overflow-y: auto; background: #0a0d14;
  }
  .filters-title {
    font-size: 11px; color: #475569; letter-spacing: 0.8px; text-transform: uppercase;
    margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;
  }
  .reset-btn { background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 11px; }
  .filter-group { margin-bottom: 16px; }
  .filter-group label { display: block; font-size: 11px; color: #64748b; margin-bottom: 6px; }
  .filter-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .filter-lbl { font-size: 10px; color: #475569; width: 32px; }
  .filter-input {
    width: 100%; background: #1e2433; border: 1px solid #2d3748; color: #cbd5e1;
    padding: 5px 8px; border-radius: 5px; font-size: 12px;
  }
  .chip-group { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    padding: 3px 8px; border-radius: 12px; background: #1e2433;
    border: 1px solid #2d3748; color: #64748b; font-size: 11px; cursor: pointer;
  }
  .chip.active { background: #1e3a5f; border-color: #3b82f6; color: #93c5fd; }
  .btn-apply {
    width: 100%; padding: 9px; background: #e2e8f0; color: #0f1117;
    border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; margin-top: 8px;
  }
</style>
