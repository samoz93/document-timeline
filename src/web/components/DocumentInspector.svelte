<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { api } from "$lib/api.ts";
  import type { Document } from "$lib/types.ts";

  export let doc: Document;

  const dispatch = createEventDispatcher();

  let editDocType = doc.document_type;
  let editScope = doc.document_scope;
  let editManualDate = doc.manual_date ?? doc.best_date ?? "";
  let saving = false;
  let opening = false;

  const SCOPES = [
    "single_worker", "worker_list", "company_level", "department_level",
    "incident_level", "template", "media", "unknown",
  ];

  const DOC_TYPES = [
    "ISE_GIRIS_MUAYENE", "PERIYODIK_MUAYENE", "SAGLIK_RAPORU", "ODIOMETRI", "SFT",
    "AKCIGER_GRAFISI", "LAB_RESULT", "SEVK_FORMU", "SEVK_YANITI", "ASI_KAYDI",
    "RISK_DEGERLENDIRMESI", "ORTAM_OLCUM_RAPORU", "RAMAK_KALA", "IS_KAZASI_RAPORU",
    "EGITIM_DOKUMANI", "EGITIM_KATILIM_LISTESI", "KKD_TESLIM_LISTESI",
    "EMPLOYEE_ROSTER", "DEPARTMENT_ASSIGNMENT_LIST", "VACCINATION_LIST",
    "EXAM_TRACKING_LIST", "REFERRAL_TRACKING_LIST", "PPE_DELIVERY_LIST",
    "TEMPLATE", "MEDIA", "OTHER_MEDICAL", "OTHER_SAFETY", "OTHER_ADMINISTRATIVE", "UNKNOWN",
  ];

  async function openFile() {
    opening = true;
    try { await api.openDocument(doc.id); }
    catch (e) { alert(String(e)); }
    finally { opening = false; }
  }

  async function saveCorrections() {
    saving = true;
    try {
      await api.updateDocumentMetadata(doc.id, {
        document_type: editDocType as any,
        document_scope: editScope as any,
        manual_date: editManualDate || null,
      });
      dispatch("updated");
    } finally {
      saving = false;
    }
  }

  async function markVerified() {
    await api.markDocumentVerified(doc.id);
    dispatch("updated");
  }

  function confidenceColor(c: number) {
    if (c >= 0.8) return "#22c55e";
    if (c >= 0.5) return "#f59e0b";
    return "#ef4444";
  }

  $: warnings = doc.date_warnings_json ? JSON.parse(doc.date_warnings_json) : [];
  $: dateEvidence = (doc as any).dateEvidence ?? [];
</script>

<div class="inspector">
  <div class="inspector-header">
    <span class="inspector-title">Document Inspector</span>
    <div class="header-badges">
      {#if doc.needs_review}
        <span class="badge badge-review">REVIEW REQUIRED</span>
      {/if}
      {#if doc.ocr_used}
        <span class="badge badge-ocr">OCR USED</span>
      {/if}
    </div>
    <button class="close-btn" on:click={() => dispatch("close")}>✕</button>
  </div>

  <div class="inspector-body">
    <!-- Preview placeholder -->
    <div class="preview-area">
      <div class="preview-placeholder">
        <span>📄</span>
        <span>{doc.file_name}</span>
      </div>
      <div class="preview-actions">
        <button on:click={openFile} disabled={opening}>
          {opening ? "Opening..." : "🔗 Open File"}
        </button>
        <button>⤢ Fullscreen</button>
      </div>
    </div>

    <!-- Evidence & Identification -->
    <section class="section">
      <div class="section-title">EVIDENCE &amp; IDENTIFICATION</div>
      <div class="field-row">
        <label>File Name</label>
        <span class="mono">{doc.file_name}</span>
      </div>
      <div class="field-row">
        <label>Category</label>
        <span>{doc.category}</span>
      </div>
      <div class="field-row">
        <label>Scope</label>
        <span class="badge scope-badge">{doc.document_scope.replace(/_/g, " ")}</span>
      </div>
      <div class="field-row">
        <label>Best Date</label>
        <span>{doc.best_date ?? "--"}</span>
      </div>
      <div class="field-row">
        <label>Date Source</label>
        <span class="dim">{doc.best_date_source}</span>
      </div>
      {#if doc.date_mismatch}
        <div class="mismatch-warning">
          ⚠ Date mismatch detected
          {#each warnings as w}<div class="warning-text">{w}</div>{/each}
        </div>
      {/if}
      {#if dateEvidence.length > 0}
        <div class="evidence-list">
          <div class="evidence-header">Date Evidence</div>
          {#each dateEvidence as e}
            <div class="evidence-row">
              <span class="evidence-source">{e.source}</span>
              <span class="evidence-date">{e.date}</span>
              <span class="evidence-prec dim">{e.precision}</span>
              <span style="color: {confidenceColor(e.confidence)}">{(e.confidence * 100).toFixed(0)}%</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Confidence -->
    <section class="section">
      <div class="field-row">
        <label>Confidence Score</label>
        <span>
          <span class="conf-score" style="color: {confidenceColor(doc.classification_confidence)}">
            {(doc.classification_confidence * 100).toFixed(0)}%
          </span>
          <span class="conf-bar">
            <span class="conf-fill" style="width: {doc.classification_confidence * 100}%; background: {confidenceColor(doc.classification_confidence)};"></span>
          </span>
        </span>
      </div>
      <div class="field-row">
        <label>Parsing Status</label>
        <span class:status-ok={doc.parsing_status === 'SUCCESS'} class:status-warn={doc.parsing_status !== 'SUCCESS'}>
          {doc.parsing_status}
        </span>
      </div>
    </section>

    <!-- Manual Correction -->
    <section class="section">
      <div class="section-title">MANUAL CORRECTION</div>
      <div class="field-col">
        <label>Classification Type</label>
        <select bind:value={editDocType}>
          {#each DOC_TYPES as t}
            <option value={t}>{t.replace(/_/g, " ")}</option>
          {/each}
        </select>
      </div>
      <div class="field-col">
        <label>Target Date</label>
        <input type="date" bind:value={editManualDate} />
      </div>
      <div class="field-col">
        <label>Document Scope</label>
        <div class="scope-toggle">
          {#each SCOPES.slice(0, 2) as s}
            <button
              class="scope-btn"
              class:active={editScope === s}
              on:click={() => { editScope = s; }}
            >{s.replace(/_/g, " ")}</button>
          {/each}
        </div>
      </div>
      <div class="action-row">
        <button class="btn-save" on:click={saveCorrections} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button class="btn-verify" on:click={markVerified}>Mark Verified</button>
      </div>
    </section>
  </div>
</div>

<style>
  .inspector {
    width: 320px; min-width: 300px; background: #0a0d14;
    border-left: 1px solid #1e2433; display: flex; flex-direction: column; overflow: hidden;
  }
  .inspector-header {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 14px; border-bottom: 1px solid #1e2433; flex-shrink: 0;
  }
  .inspector-title { font-size: 13px; font-weight: 600; color: #e2e8f0; flex: 1; }
  .close-btn { background: none; border: none; color: #475569; cursor: pointer; font-size: 14px; padding: 2px 4px; }
  .header-badges { display: flex; gap: 4px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .badge-review { background: #451a03; color: #fb923c; }
  .badge-ocr { background: #1e3a5f; color: #93c5fd; }

  .inspector-body { flex: 1; overflow-y: auto; padding: 0; }

  .preview-area {
    background: #111827; border-bottom: 1px solid #1e2433;
    min-height: 160px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 8px; padding: 16px;
  }
  .preview-placeholder { display: flex; flex-direction: column; align-items: center; gap: 6px; color: #475569; font-size: 12px; }
  .preview-placeholder span:first-child { font-size: 36px; }
  .preview-actions { display: flex; gap: 8px; }
  .preview-actions button {
    background: #1e2433; border: 1px solid #2d3748; color: #94a3b8;
    padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 11px;
  }

  .section { padding: 12px 14px; border-bottom: 1px solid #1a1f2e; }
  .section-title { font-size: 10px; color: #475569; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 10px; }
  .field-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; font-size: 12px; }
  .field-row label { color: #475569; min-width: 90px; font-size: 11px; }
  .field-col { margin-bottom: 8px; }
  .field-col label { display: block; font-size: 11px; color: #475569; margin-bottom: 4px; }
  .field-col select, .field-col input {
    width: 100%; background: #1e2433; border: 1px solid #2d3748; color: #cbd5e1;
    padding: 5px 8px; border-radius: 5px; font-size: 12px;
  }
  .mono { font-family: monospace; color: #94a3b8; font-size: 11px; word-break: break-all; }
  .dim { color: #475569; font-style: italic; }
  .scope-badge { background: #1e3a5f; color: #93c5fd; font-size: 11px; padding: 2px 6px; border-radius: 3px; }

  .mismatch-warning {
    background: #2d1a0a; border: 1px solid #78350f; border-radius: 5px;
    padding: 8px 10px; margin-top: 8px; font-size: 11px; color: #fb923c;
  }
  .warning-text { color: #fbbf24; margin-top: 3px; font-size: 11px; }

  .evidence-list { margin-top: 8px; }
  .evidence-header { font-size: 10px; color: #475569; margin-bottom: 4px; }
  .evidence-row { display: flex; gap: 6px; align-items: center; margin-bottom: 3px; font-size: 11px; }
  .evidence-source { color: #64748b; min-width: 60px; }
  .evidence-date { color: #94a3b8; }
  .evidence-prec { font-size: 10px; }

  .conf-score { font-size: 20px; font-weight: 700; margin-right: 8px; }
  .conf-bar { display: inline-block; width: 80px; height: 6px; background: #1e2433; border-radius: 3px; vertical-align: middle; overflow: hidden; }
  .conf-fill { display: block; height: 100%; border-radius: 3px; }

  .status-ok { color: #22c55e; }
  .status-warn { color: #f59e0b; }

  .scope-toggle { display: flex; gap: 4px; }
  .scope-btn {
    flex: 1; padding: 5px 8px; background: #1e2433; border: 1px solid #2d3748;
    color: #64748b; border-radius: 5px; cursor: pointer; font-size: 11px;
  }
  .scope-btn.active { background: #1e3a5f; border-color: #3b82f6; color: #93c5fd; }

  .action-row { display: flex; gap: 8px; margin-top: 10px; }
  .btn-save {
    flex: 1; padding: 7px; background: #1e2433; border: 1px solid #334155;
    color: #94a3b8; border-radius: 5px; cursor: pointer; font-size: 12px;
  }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-verify {
    flex: 1; padding: 7px; background: #052e16; border: 1px solid #166534;
    color: #4ade80; border-radius: 5px; cursor: pointer; font-size: 12px;
  }
</style>
