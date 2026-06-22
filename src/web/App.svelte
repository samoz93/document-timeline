<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company } from "$lib/types.ts";
  import Sidebar from "./components/Sidebar.svelte";
  import WorkspaceView from "./components/WorkspaceView.svelte";
  import TimelineView from "./components/TimelineView.svelte";
  import DocumentsView from "./components/DocumentsView.svelte";
  import ReviewView from "./components/ReviewView.svelte";
  import ListsView from "./components/ListsView.svelte";
  import WorkersView from "./components/WorkersView.svelte";
  import SettingsView from "./components/SettingsView.svelte";

  let activeView = "workspace";
  let companies: Company[] = [];
  let selectedCompany: Company | null = null;
  let loading = true;

  onMount(async () => {
    try {
      companies = await api.listCompanies();
      if (companies.length > 0) selectedCompany = companies[0]!;
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  });

  function handleCompanyChange(event: CustomEvent<Company>) {
    selectedCompany = event.detail;
  }

  function handleCompanyCreated(event: CustomEvent<Company>) {
    companies = [...companies, event.detail];
    selectedCompany = event.detail;
  }

  function handleCompaniesUpdated(event: CustomEvent<Company[]>) {
    companies = event.detail;
    if (companies.length > 0 && !selectedCompany) selectedCompany = companies[0]!;
  }
</script>

<div class="app-shell">
  <Sidebar
    {activeView}
    {companies}
    {selectedCompany}
    on:navigate={(e) => (activeView = e.detail)}
    on:companyChange={handleCompanyChange}
  />

  <main class="main-content">
    {#if loading}
      <div class="loading">Yükleniyor...</div>
    {:else if !selectedCompany && activeView !== "settings"}
      <div class="empty-state">
        <p>Henüz şirket eklenmedi.</p>
        <button on:click={() => (activeView = "settings")}>Şirket Ekle</button>
      </div>
    {:else if activeView === "workspace"}
      <WorkspaceView company={selectedCompany} />
    {:else if activeView === "timeline"}
      <TimelineView company={selectedCompany} />
    {:else if activeView === "documents"}
      <DocumentsView company={selectedCompany} />
    {:else if activeView === "review"}
      <ReviewView company={selectedCompany} />
    {:else if activeView === "lists"}
      <ListsView company={selectedCompany} />
    {:else if activeView === "workers"}
      <WorkersView company={selectedCompany} />
    {:else if activeView === "settings"}
      <SettingsView
        {companies}
        on:companyCreated={handleCompanyCreated}
        on:companiesUpdated={handleCompaniesUpdated}
      />
    {/if}
  </main>
</div>

<style>
  .app-shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: #0f1117;
  }
  .main-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .loading, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 16px;
    color: #64748b;
  }
  .empty-state button {
    padding: 8px 20px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
</style>
