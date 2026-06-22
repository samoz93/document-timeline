<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Company } from "$lib/types.ts";

  export let activeView: string;
  export let companies: Company[];
  export let selectedCompany: Company | null;

  const dispatch = createEventDispatcher();

  const nav = [
    { id: "workspace", label: "Workspace", icon: "⊞" },
    { id: "timeline", label: "Timeline", icon: "◷" },
    { id: "workers", label: "Workers", icon: "⚇" },
    { id: "documents", label: "Documents", icon: "◻" },
    { id: "lists", label: "Lists", icon: "≡" },
    { id: "review", label: "Review", icon: "⚠" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];
</script>

<aside class="sidebar">
  <div class="brand">
    <span class="brand-name">MedArchive</span>
    <span class="brand-version">V1.0.4</span>
  </div>

  <div class="company-select">
    <select
      value={selectedCompany?.id ?? ""}
      on:change={(e) => {
        const c = companies.find((x) => x.id === e.currentTarget.value);
        if (c) dispatch("companyChange", c);
      }}
    >
      {#each companies as c}
        <option value={c.id}>{c.short_name ?? c.name}</option>
      {/each}
      {#if companies.length === 0}
        <option disabled>— Şirket yok —</option>
      {/if}
    </select>
  </div>

  <nav class="nav-list">
    {#each nav as item}
      <button
        class="nav-item"
        class:active={activeView === item.id}
        on:click={() => dispatch("navigate", item.id)}
      >
        <span class="nav-icon">{item.icon}</span>
        <span class="nav-label">{item.label}</span>
      </button>
    {/each}
  </nav>
</aside>

<style>
  .sidebar {
    width: 200px;
    min-width: 200px;
    background: #0a0d14;
    border-right: 1px solid #1e2433;
    display: flex;
    flex-direction: column;
    padding: 0;
  }
  .brand {
    padding: 16px 16px 8px;
    display: flex;
    flex-direction: column;
  }
  .brand-name {
    font-size: 15px;
    font-weight: 700;
    color: #e2e8f0;
    letter-spacing: -0.3px;
  }
  .brand-version {
    font-size: 10px;
    color: #475569;
    margin-top: 1px;
  }
  .company-select {
    padding: 8px 12px 12px;
    border-bottom: 1px solid #1e2433;
  }
  .company-select select {
    width: 100%;
    background: #1e2433;
    border: 1px solid #2d3748;
    color: #cbd5e1;
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .nav-list {
    flex: 1;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    text-align: left;
    font-size: 13px;
    border-radius: 0;
    transition: background 0.12s, color 0.12s;
  }
  .nav-item:hover {
    background: #1e2433;
    color: #94a3b8;
  }
  .nav-item.active {
    background: #1e2433;
    color: #e2e8f0;
    border-left: 2px solid #3b82f6;
    padding-left: 14px;
  }
  .nav-icon {
    font-size: 14px;
    width: 18px;
    text-align: center;
  }
</style>
