<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Company } from "$lib/types.ts";

  export let companies: Company[];

  const dispatch = createEventDispatcher();

  let newName = "";
  let newLegalName = "";
  let newShortName = "";
  let newHazardClass: Company["hazard_class"] = "UNKNOWN";
  let newFolderPath = "";
  let creating = false;
  let editingCompany: Company | null = null;
  let editFolderPath = "";

  async function createCompany() {
    if (!newName.trim()) return;
    creating = true;
    try {
      const company = await api.createCompany({
        name: newName.trim(),
        legal_name: newLegalName.trim() || null,
        short_name: newShortName.trim() || null,
        hazard_class: newHazardClass,
        master_folder_path: newFolderPath.trim() || null,
      });
      dispatch("companyCreated", company);
      newName = ""; newLegalName = ""; newShortName = ""; newFolderPath = "";
    } finally {
      creating = false;
    }
  }

  async function saveFolder() {
    if (!editingCompany) return;
    await api.updateCompanyFolder(editingCompany.id, editFolderPath);
    const updated = companies.map((c) =>
      c.id === editingCompany!.id ? { ...c, master_folder_path: editFolderPath } : c
    );
    dispatch("companiesUpdated", updated);
    editingCompany = null;
  }
</script>

<div class="settings-view">
  <div class="view-header">
    <h1>Settings</h1>
  </div>

  <div class="settings-body">
    <!-- Company Management -->
    <section class="settings-section">
      <div class="section-title">Company Management</div>

      {#if companies.length > 0}
        <div class="company-list">
          {#each companies as c}
            <div class="company-card">
              <div class="company-info">
                <span class="company-name">{c.name}</span>
                {#if c.short_name}<span class="dim">({c.short_name})</span>{/if}
                <span class="hazard-badge hazard-{c.hazard_class.toLowerCase()}">{c.hazard_class.replace(/_/g, " ")}</span>
              </div>
              <div class="company-folder">
                <span class="folder-lbl">Archive Folder:</span>
                {#if editingCompany?.id === c.id}
                  <input class="folder-input" bind:value={editFolderPath} placeholder="/path/to/archive" />
                  <button class="btn-save" on:click={saveFolder}>Save</button>
                  <button class="btn-cancel" on:click={() => (editingCompany = null)}>Cancel</button>
                {:else}
                  <span class="folder-path">{c.master_folder_path ?? "Not configured"}</span>
                  <button class="btn-edit" on:click={() => { editingCompany = c; editFolderPath = c.master_folder_path ?? ""; }}>Edit</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="new-company-form">
        <div class="form-title">Add New Company</div>
        <div class="form-row">
          <label>Company Name *</label>
          <input class="form-input" bind:value={newName} placeholder="Company Name" />
        </div>
        <div class="form-row">
          <label>Legal Name</label>
          <input class="form-input" bind:value={newLegalName} placeholder="Legal Name (optional)" />
        </div>
        <div class="form-row">
          <label>Short Name</label>
          <input class="form-input small" bind:value={newShortName} placeholder="Short name" />
        </div>
        <div class="form-row">
          <label>Hazard Class</label>
          <select class="form-input small" bind:value={newHazardClass}>
            <option value="UNKNOWN">Unknown</option>
            <option value="LESS_HAZARDOUS">Less Hazardous</option>
            <option value="HAZARDOUS">Hazardous</option>
            <option value="VERY_HAZARDOUS">Very Hazardous</option>
          </select>
        </div>
        <div class="form-row">
          <label>Archive Folder</label>
          <input class="form-input" bind:value={newFolderPath} placeholder="/path/to/archive/folder" />
        </div>
        <button class="btn-create" on:click={createCompany} disabled={creating || !newName.trim()}>
          {creating ? "Creating..." : "Create Company"}
        </button>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-title">About</div>
      <div class="about-info">
        <div>MedArchive MVP — Local-first occupational health archive tool</div>
        <div class="dim">Database: local SQLite • No cloud sync • No telemetry</div>
      </div>
    </section>
  </div>
</div>

<style>
  .settings-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .view-header { padding: 14px 20px; border-bottom: 1px solid #1e2433; }
  h1 { font-size: 16px; font-weight: 600; color: #e2e8f0; }

  .settings-body { flex: 1; overflow-y: auto; padding: 20px; max-width: 680px; }

  .settings-section { margin-bottom: 32px; background: #0a0d14; border: 1px solid #1e2433; border-radius: 8px; padding: 18px; }
  .section-title { font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 14px; }

  .company-list { margin-bottom: 16px; }
  .company-card { padding: 10px; background: #111827; border-radius: 6px; margin-bottom: 8px; }
  .company-info { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .company-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
  .dim { color: #475569; font-size: 12px; }
  .hazard-badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .hazard-unknown { background: #1e2433; color: #64748b; }
  .hazard-less_hazardous { background: #052e16; color: #4ade80; }
  .hazard-hazardous { background: #2d1a0a; color: #fb923c; }
  .hazard-very_hazardous { background: #3f0505; color: #f87171; }

  .company-folder { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .folder-lbl { color: #475569; }
  .folder-path { color: #64748b; font-family: monospace; font-size: 11px; flex: 1; }
  .folder-input { flex: 1; background: #1e2433; border: 1px solid #2d3748; color: #cbd5e1; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
  .btn-edit, .btn-save, .btn-cancel {
    padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; border: 1px solid;
  }
  .btn-edit { background: #1e2433; border-color: #334155; color: #94a3b8; }
  .btn-save { background: #052e16; border-color: #166534; color: #4ade80; }
  .btn-cancel { background: #1e2433; border-color: #334155; color: #64748b; }

  .new-company-form { border-top: 1px solid #1e2433; padding-top: 14px; margin-top: 4px; }
  .form-title { font-size: 12px; color: #64748b; margin-bottom: 12px; }
  .form-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .form-row label { font-size: 12px; color: #475569; min-width: 120px; }
  .form-input { background: #1e2433; border: 1px solid #2d3748; color: #cbd5e1; padding: 6px 10px; border-radius: 5px; font-size: 12px; flex: 1; }
  .form-input.small { max-width: 180px; }
  .btn-create {
    padding: 8px 20px; background: #1d4ed8; border: none; color: white;
    border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; margin-top: 4px;
  }
  .btn-create:disabled { opacity: 0.5; cursor: not-allowed; }

  .about-info { font-size: 12px; color: #64748b; display: flex; flex-direction: column; gap: 4px; }
</style>
