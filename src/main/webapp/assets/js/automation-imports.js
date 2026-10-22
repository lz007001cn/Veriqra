(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  const limit = 5 * 1024 * 1024;
  let projectId = null;
  let view = 'dashboard';
  let generation = 0;
  let uploadGeneration = 0;
  let selectedFile = null;
  let preview = null;
  let pendingImport = null;
  let importBusy = false;
  let importResult = null;
  let identityRows = null;
  let identityReadState = 'idle';
  let identityFailure = null;
  let identitySavedKey = null;
  const active = function () { return view === 'automation' && !!projectId; };
  const valid = function (token) { return active() && token === generation; };
  const base = function (resource) { return 'projects/' + encodeURIComponent(projectId) + '/' + resource; };
  const identityPath = function (id) { return 'automation/identities/' + encodeURIComponent(id); };
  const option = function (value, text) { return $('<option>').val(String(value)).text(text); };
  const badge = function (state) {
    const colors = { ACTIVE: 'success', INACTIVE: 'secondary', PASS: 'success', FAIL: 'danger', BLOCKED: 'warning', SKIPPED: 'info' };
    return $('<span>').addClass('badge text-bg-' + (colors[state] || 'secondary')).attr('data-vq-state', state).text(state ? window.I18n.enumLabel(state) : t("automation.unmapped", null, 'Unmapped'));
  };
  function notice(message, error, partial) {
    $('#automation-notice').text(message || '').toggleClass('d-none', !message)
      .toggleClass('alert-danger', !!error && !partial).toggleClass('alert-warning', !!partial)
      .toggleClass('alert-success', !!message && !error && !partial);
  }
  function status(message, error) {
    $('#import-status').text(message || '').toggleClass('text-danger', !!error).toggleClass('text-success', !!message && !error);
  }
  function invalidatePreview(clearResult, newIntent) {
    ++uploadGeneration;
    preview = null;
    if (newIntent) pendingImport = null;
    $('#import-preview').empty();
    $('#import-submit').prop('disabled', true);
    if (!importBusy) $('#import-preview-button').prop('disabled', false);
    if (clearResult) { $('#import-result').empty(); importResult = null; }
    status('');
  }
  function reset() {
    ++generation;
    identityRows = null;
    identityReadState = 'idle'; identityFailure = null; identitySavedKey = null;
    selectedFile = null;
    importResult = null;
    importBusy = false;
    invalidatePreview(true, true);
    $('#automation-identities').empty(); $('#automation-status').text('');
    $('#automation-register')[0].reset(); $('#import-form')[0].reset();
    $('#import-file-status').text(t("automation.noXMLFileSelected", null, 'No XML file selected.'));
    $('#automation-register-submit, #import-preview-button').prop('disabled', false);
    $('#import-file, #import-namespace, #import-run-name, #import-environment, #import-build').prop('disabled', false);
    notice('');
  }
  function conflict(error, operation) {
    if (error.code && error.code.startsWith('IMPORT_')) return t('imports.' + error.code);
    return error.status === 409
      ? operation === 'import'
        ? t('automation.importConflict', null, 'Import conflicts with current mappings or this request key was used with different data. Review the preview and selected file; do not assume partial success.')
        : t('automation.mappingConflict', null, 'The mapping changed or this transition is not allowed. Refresh identities and mappings before trying again.')
      : error.message;
  }
  function renderIdentity(identity, mapping, cases) {
    const card = $('<div class="asset-step">');
    const mappedCase = mapping && cases.find(function (item) { return item.id === mapping.testCaseId; });
    card.append($('<div class="asset-panel-heading mb-1">').append(
      $('<strong>').text(identity.source + ' · ' + identity.namespace + ' · ' + identity.externalKey),
      badge(mapping ? mapping.status : null)));
    card.append($('<p class="small text-secondary mb-2">').text(t('automation.identityNumber', { id: identity.id }, 'Identity #{id}') + ' · ' + (mapping
      ? t('automation.mappedCase', { name: mappedCase ? 'TC-' + String(mappedCase.keyNo).padStart(3, '0') + ' · ' + mappedCase.title : '#' + mapping.testCaseId }, 'Mapped TestCase {name}')
        + ' · v' + mapping.version : t("automation.noMappingRecord", null, 'No mapping record'))));
    const actions = $('<div class="d-flex flex-wrap gap-2 align-items-center">');
    const query = $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t("automation.queryIdentity", null, 'Query identity'))
      .on('click', async function () {
        const token = generation;
        query.prop('disabled', true);
        try {
          const result = await api.get(identityPath(identity.id));
          if (valid(token)) notice(t('automation.identityDetails', { id: result.id, source: result.source,
            namespace: result.namespace, key: result.externalKey }, 'Identity #{id}: {source} / {namespace} / {key}'), false);
        } catch (error) { if (valid(token)) notice(error.message, true); }
        finally { if (valid(token)) query.prop('disabled', false); }
      });
    actions.append(query);
    if (!mapping || mapping.status === 'INACTIVE') {
      const select = $('<select class="form-select automation-case-select">').attr('aria-label', t('automation.caseForMapping', null, 'TestCase for identity mapping'))
        .append(option('', t("automation.selectCurrentProjectTestCase", null, 'Select current-project TestCase')));
      cases.forEach(function (item) {
        select.append(option(item.id, 'TC-' + String(item.keyNo).padStart(3, '0') + ' · ' + item.title + ' · ' + window.I18n.enumLabel(item.status)));
      });
      if (mapping) select.val(String(mapping.testCaseId));
      const confirm = $('<button type="button" class="btn btn-outline-primary btn-sm">')
        .text(mapping ? t("automation.confirmRebindReactivate", null, 'Confirm rebind / reactivate') : t("automation.confirmMapping", null, 'Confirm mapping'))
        .on('click', async function () {
          if (importBusy) { notice(t('automation.importBusy', null, 'Wait for the current import to finish before changing mappings.'), true); return; }
          const caseId = Number(select.val());
          if (!Number.isSafeInteger(caseId) || caseId <= 0) { notice(t("automation.chooseATestCaseInTheCurrentProject", null, 'Choose a TestCase in the current project.'), true); return; }
          const chosen = cases.find(function (item) { return item.id === caseId; });
          if (!window.confirm(t('automation.confirmMappingPrompt', { identity: identity.externalKey,
            testCase: chosen ? chosen.title : t('automation.testCaseNumber', { id: caseId }, 'TestCase #{id}') },
          'Confirm {identity} → {testCase}? This is an explicit human mapping.'))) return;
          const token = generation;
          confirm.prop('disabled', true); select.prop('disabled', true);
          try {
            await api.put(identityPath(identity.id) + '/mapping', { testCaseId: caseId,
              expectedVersion: mapping ? mapping.version : null });
            if (valid(token)) { invalidatePreview(true); await load('automation.mappingConfirmedPreviewTheXMLAgainBeforeImport'); }
          } catch (error) { if (valid(token)) notice(conflict(error), true); }
          finally { if (valid(token)) { confirm.prop('disabled', false); select.prop('disabled', false); } }
        });
      actions.append(select, confirm);
    } else {
      const deactivate = $('<button type="button" class="btn btn-outline-danger btn-sm">').text(t("automation.deactivateMapping", null, 'Deactivate mapping'))
        .on('click', async function () {
          if (importBusy) { notice(t('automation.importBusy', null, 'Wait for the current import to finish before changing mappings.'), true); return; }
          if (!window.confirm(t("automation.deactivateThisMappingExistingImportedHistoryRemainsUnchanged", null, 'Deactivate this mapping? Existing imported history remains unchanged.'))) return;
          const token = generation;
          deactivate.prop('disabled', true);
          try {
            await api.post(identityPath(identity.id) + '/mapping/deactivate', { expectedVersion: mapping.version });
            if (valid(token)) { invalidatePreview(true); await load('automation.mappingDeactivatedPreviewTheXMLAgainBeforeImport'); }
          } catch (error) { if (valid(token)) notice(conflict(error), true); }
          finally { if (valid(token)) deactivate.prop('disabled', false); }
        });
      actions.append(deactivate);
    }
    return card.append(actions);
  }
  function renderIdentityFailure() {
    const token = generation, savedKey = identitySavedKey;
    $('#automation-status').text(t('common.unavailable', null, 'Unavailable'));
    $('#automation-identities').empty().append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
      .text(t('common.retry', null, 'Retry')).on('click', function () {
        if (!valid(token) || identityReadState !== 'failed') return;
        return load(savedKey);
      }));
    notice((savedKey ? t('automation.savedRefreshFailed', null, 'Saved, but identities and mappings could not be refreshed. Retry loading; do not repeat the saved action.') + ' ' : '')
      + identityFailure.message, true, !!savedKey);
  }
  async function load(savedKey) {
    if (!active()) return;
    const token = ++generation;
    identityRows = null; identityReadState = 'loading'; identityFailure = null; identitySavedKey = savedKey || null;
    notice('');
    $('#automation-identities').empty(); $('#automation-status').text(t("automation.loadingIdentitiesAndMappings", null, 'Loading identities and mappings…'));
    try {
      const [identities, mappings, cases] = await Promise.all([
        api.get(base('automation/identities')), api.get(base('automation/mappings')), api.get(base('test-cases'))
      ]);
      if (!valid(token)) return;
      identityRows = { identities: identities, mappings: mappings, cases: cases };
      identityReadState = 'ready';
      renderIdentities();
      if (identitySavedKey) notice(t(identitySavedKey));
      return true;
    } catch (error) {
      if (valid(token)) { identityReadState = 'failed'; identityFailure = error; renderIdentityFailure(); }
      return false;
    }
  }
  function renderIdentities() {
    if (!identityRows) return;
    const { identities, mappings, cases } = identityRows;
    $('#automation-identities').empty();
    $('#automation-status').text(identities.length ? t('automation.identityCount', { count: window.I18n.formatNumber(identities.length) }, '{count} identity/identities') : t('automation.noAutomationIdentitiesRegistered', null, 'No automation identities registered.'));
    const byIdentity = new Map(mappings.map(function (item) { return [item.automationIdentityId, item]; }));
    identities.forEach(function (identity) {
      $('#automation-identities').append(renderIdentity(identity, byIdentity.get(identity.id), cases));
    });
  }
  function queryPath(previewOnly, requestKey) {
    const params = new URLSearchParams();
    params.set('sourceNamespace', $('#import-namespace').val().trim());
    if (!previewOnly) {
      params.set('requestKey', requestKey);
      params.set('originalFilename', selectedFile.name);
      params.set('runName', $('#import-run-name').val().trim());
      if ($('#import-environment').val().trim()) params.set('environment', $('#import-environment').val().trim());
      if ($('#import-build').val().trim()) params.set('buildVersion', $('#import-build').val().trim());
    }
    return base('imports') + (previewOnly ? '/preview?' : '?') + params.toString();
  }
  function fileReady() {
    if (!selectedFile) { status(t("automation.selectAJUnitXMLFile", null, 'Select a JUnit XML file.'), true); return false; }
    if (selectedFile.size > limit) { status(t("automation.theSelectedFileExceedsThe5MiBLimit", null, 'The selected file exceeds the 5 MiB limit.'), true); return false; }
    if (!$('#import-namespace').val().trim()) { status(t("automation.enterTheSourceNamespaceUsedByTheJUnitClassname", null, 'Enter the source namespace used by the JUnit classname.'), true); return false; }
    return true;
  }
  function renderPreview(value) {
    const target = $('#import-preview').empty();
    target.append($('<h3 class="fs-5">').text(t(value.readyToImport ? 'automation.previewReady' : 'automation.previewMappingNeeded',
      null, value.readyToImport ? 'Preview · ready to import' : 'Preview · mapping needed')));
    target.append($('<p class="small text-secondary">').text(t('automation.previewCounts', {
      mapped: window.I18n.formatNumber(value.mappedResults.length), unknown: window.I18n.formatNumber(value.unknownIdentities.length),
      invalid: window.I18n.formatNumber(value.invalidEntries.length)
    }, '{mapped} mapped result(s), {unknown} unknown/unmapped identity/identities, {invalid} invalid entry/entries.')));
    value.mappedResults.forEach(function (entry) {
      const result = entry.result;
      target.append($('<div class="asset-step">').append(
        $('<div class="asset-panel-heading mb-1">').append($('<strong>').text(result.namespace + ' · ' + result.externalKey), badge(result.outcome)),
        $('<p class="small mb-1">').text(t('automation.mappedToCase', { key: 'TC-' + String(entry.testCase.keyNo).padStart(3, '0'), title: entry.testCase.title }, 'Mapped to {key} · {title}')),
        $('<p class="small mb-1">').text(t('automation.duration', { value: result.durationMs == null ? '—' : window.I18n.formatNumber(result.durationMs) + ' ms' }, 'Duration: {value}')),
        $('<p class="small mb-1 defect-prewrap">').text(result.comment || ''),
        $('<p class="small mb-0 defect-prewrap">').text(result.failureMessage || '')));
    });
    value.unknownIdentities.forEach(function (entry) {
      const register = $('<button type="button" class="btn btn-outline-primary btn-sm">').text(t("automation.prepareRegistration", null, 'Prepare registration'))
        .on('click', function () {
          $('#automation-namespace').val(entry.namespace);
          $('#automation-key').val(entry.externalKey).trigger('focus');
          notice(t('automation.registerThenMap', null, 'Register this identity, then explicitly confirm a TestCase mapping and preview the XML again.'));
        });
      target.append($('<div class="asset-step">').append(
        $('<strong>').text(t('automation.unknownIdentity', { namespace: entry.namespace, key: entry.externalKey },
          'Unknown / unmapped · {namespace} · {key}')),
        $('<p class="small text-secondary">').text(t('automation.unknownPreviewDetail', null, 'No TestCase or result detail is assigned by the preview API for this identity.')), register));
    });
    value.invalidEntries.forEach(function (entry) {
      target.append($('<div class="alert alert-warning">').text(t('automation.invalidEntry',
        { index: entry.entryIndex, message: entry.message }, 'Entry #{index}: {message}')));
    });
  }
  function openRun(runId) {
    document.dispatchEvent(new CustomEvent('veriqra:open-run', { detail: { projectId: projectId, runId: runId } }));
    location.hash = '#runs';
  }
  function renderImport(result) {
    importResult = result;
    const target = $('#import-result').empty();
    target.append($('<h3 class="fs-5">').text(result.replayed ? t("automation.importReplayed", null, 'Import replayed') : t("automation.importCompleted", null, 'Import completed')));
    target.append($('<p>').text(t('automation.importSummary', { importId: result.testImport.id, run: result.run.name,
      runId: result.run.id, status: window.I18n.enumLabel(result.run.status), cases: window.I18n.formatNumber(result.runCases.length),
      attempts: window.I18n.formatNumber(result.attempts.length) },
    'Import #{importId} · Run "{run}" (#{runId}) · {status} · {cases} Run Case snapshot(s) · {attempts} Attempt(s).')));
    target.append($('<button type="button" class="btn btn-outline-primary">').text(t("automation.openImportedRunAndHistory", null, 'Open imported Run and history'))
      .on('click', function () { openRun(result.run.id); }));
  }
  $(document).on('veriqra:project', function (event) {
    reset();
    const project = event.originalEvent.detail.project;
    projectId = project ? String(project.id) : null;
    if (active()) load();
  });
  $(document).on('veriqra:view', function (event) {
    const next = event.originalEvent.detail.view;
    if (next !== view) { reset(); view = next; }
    if (active()) load();
  });
  document.addEventListener('veriqra:localechange', function () {
    if (!active()) return;
    if (identityReadState === 'failed') renderIdentityFailure();
    else {
      notice(''); renderIdentities();
      if (identityReadState === 'loading') $('#automation-status').text(t('automation.loadingIdentitiesAndMappings'));
      else if (identitySavedKey) notice(t(identitySavedKey));
    }
    if (preview) renderPreview(preview.response);
    if (importResult) renderImport(importResult);
    $('#import-file-status').text(selectedFile ? t('automation.selectedFile',
      { name: selectedFile.name, bytes: window.I18n.formatNumber(selectedFile.size) }, '{name} · {bytes} bytes')
      : t('automation.noXMLFileSelected'));
    if (importBusy) status(t('automation.importingMappedResultsAtomically'));
    else if (preview) status(preview.response.readyToImport ? t('automation.previewIsReadyConfirmTheImportDetailsBeforeSubmitting')
      : t('automation.previewIsReadOnlyRegisterAndMapUnknownIdentitiesThenPreviewAgain'), !preview.response.readyToImport);
    else status('');
  });
  $('#automation-refresh').on('click', function () { if (!importBusy) { invalidatePreview(true); load(); } });
  $('#automation-register').on('submit', async function (event) {
    event.preventDefault();
    if (importBusy || $('#automation-register-submit').prop('disabled') || !this.reportValidity()) return;
    const token = generation;
    const body = { source: 'JUNIT', namespace: $('#automation-namespace').val().trim(), externalKey: $('#automation-key').val().trim() };
    $('#automation-register-submit').prop('disabled', true); notice('');
    try {
      await api.post(base('automation/identities'), body);
      if (valid(token)) { invalidatePreview(true); $('#automation-register')[0].reset(); await load('automation.identityRegisteredConfirmItsMappingManually'); }
    } catch (error) { if (valid(token)) notice(error.message, true); }
    finally { if (active()) $('#automation-register-submit').prop('disabled', false); }
  });
  $('#import-file').on('change', function () {
    selectedFile = this.files && this.files[0] ? this.files[0] : null;
    invalidatePreview(true, true);
    $('#import-file-status').text(selectedFile ? t('automation.selectedFile',
      { name: selectedFile.name, bytes: window.I18n.formatNumber(selectedFile.size) }, '{name} · {bytes} bytes')
      : t("automation.noXMLFileSelected", null, 'No XML file selected.'));
    if (selectedFile && selectedFile.size > limit) status(t("automation.theSelectedFileExceedsThe5MiBLimit", null, 'The selected file exceeds the 5 MiB limit.'), true);
  });
  $('#import-namespace').on('input', function () { invalidatePreview(true, true); });
  $('#import-run-name, #import-environment, #import-build').on('input', function () { pendingImport = null; $('#import-result').empty(); });
  $('#import-preview-button').on('click', async function () {
    if (importBusy || !fileReady() || $('#import-preview-button').prop('disabled')) return;
    const token = generation, uploadToken = ++uploadGeneration;
    const file = selectedFile, namespace = $('#import-namespace').val().trim();
    preview = null;
    $('#import-preview, #import-result').empty();
    $('#import-submit, #import-preview-button').prop('disabled', true);
    status(t("automation.analyzingXMLWithoutImporting", null, 'Analyzing XML without importing…'));
    try {
      const result = await api.xml(queryPath(true), file);
      if (!valid(token) || uploadToken !== uploadGeneration || file !== selectedFile || namespace !== $('#import-namespace').val().trim()) return;
      preview = { file: file, namespace: namespace, response: result };
      renderPreview(result);
      $('#import-submit').prop('disabled', !result.readyToImport);
      status(result.readyToImport ? t("automation.previewIsReadyConfirmTheImportDetailsBeforeSubmitting", null, 'Preview is ready. Confirm the import details before submitting.')
        : t("automation.previewIsReadOnlyRegisterAndMapUnknownIdentitiesThenPreviewAgain", null, 'Preview is read-only. Register and map unknown identities, then preview again.'), !result.readyToImport);
    } catch (error) { if (valid(token) && uploadToken === uploadGeneration) status(conflict(error, 'import'), true); }
    finally { if (valid(token) && uploadToken === uploadGeneration) $('#import-preview-button').prop('disabled', false); }
  });
  $('#import-form').on('submit', async function (event) {
    event.preventDefault();
    if (importBusy || $('#import-submit').prop('disabled') || !this.reportValidity() || !fileReady()) return;
    const namespace = $('#import-namespace').val().trim();
    if (!preview || !preview.response.readyToImport || preview.file !== selectedFile || preview.namespace !== namespace) {
      status(t("automation.previewThisExactFileAndNamespaceBeforeImport", null, 'Preview this exact file and namespace before import.'), true); return;
    }
    const runName = $('#import-run-name').val().trim();
    if (!runName) { status(t("automation.enterARunName", null, 'Enter a Run name.'), true); return; }
    const signature = JSON.stringify([namespace, selectedFile.name, runName,
      $('#import-environment').val().trim(), $('#import-build').val().trim()]);
    if (!pendingImport || pendingImport.file !== selectedFile || pendingImport.signature !== signature) {
      pendingImport = { file: selectedFile, signature: signature, requestKey: crypto.randomUUID() };
    }
    if (!window.confirm(t("automation.importThisMappedJUnitReportAsOneCompletedRun", null, 'Import this mapped JUnit report as one completed Run?'))) return;
    const token = generation, uploadToken = uploadGeneration, file = selectedFile;
    importBusy = true;
    $('#import-submit, #import-preview-button').prop('disabled', true);
    $('#import-file, #import-namespace, #import-run-name, #import-environment, #import-build').prop('disabled', true);
    status(t("automation.importingMappedResultsAtomically", null, 'Importing mapped results atomically…'));
    try {
      if (window.VeriqraImportHistory) pendingImport.requestKey = await window.VeriqraImportHistory.begin(file, signature);
      if (!valid(token) || uploadToken !== uploadGeneration || file !== selectedFile) return;
      const result = await api.xml(queryPath(false, pendingImport.requestKey), file);
      if (valid(token) && window.VeriqraImportHistory) window.VeriqraImportHistory.complete();
      if (!valid(token) || uploadToken !== uploadGeneration || file !== selectedFile) return;
      pendingImport = null;
      renderImport(result);
      status(result.replayed ? t("automation.existingImportReturnedForThisRequestKey", null, 'Existing import returned for this request key.') : t("automation.importCompletedOpenTheRunToInspectSnapshotsAndAttemptHistory", null, 'Import completed. Open the Run to inspect snapshots and Attempt history.'));
      // The server has accepted the bytes; release the selected file from client state.
      preview = null;
      selectedFile = null;
      $('#import-file').val('');
      $('#import-file-status').text(t("automation.importCompleteSelectANewXMLFileForAnotherImport", null, 'Import complete. Select a new XML file for another import.'));
    } catch (error) {
      if (valid(token) && uploadToken === uploadGeneration) status(conflict(error, 'import') + ' '
        + t('automation.retrySameRequest', null, 'Check the Runs list after an uncertain response; retrying unchanged details reuses the same request key.'), true);
    } finally {
      if (valid(token) && uploadToken === uploadGeneration) {
        importBusy = false;
        $('#import-preview-button').prop('disabled', false);
        $('#import-submit').prop('disabled', !preview);
        $('#import-file, #import-namespace, #import-run-name, #import-environment, #import-build').prop('disabled', false);
      }
    }
  });
  document.addEventListener('veriqra:import-recovered', function (event) {
    if (active() && String(event.detail.projectId) === String(projectId)) {
      pendingImport = null; importBusy = false; selectedFile = null;
      invalidatePreview(false); $('#import-file').val('');
      $('#import-file, #import-namespace, #import-run-name, #import-environment, #import-build').prop('disabled', false);
      $('#import-file-status').text(t('automation.importCompleteSelectANewXMLFileForAnotherImport'));
      renderImport(event.detail.result);
    }
  });
})(jQuery, window.VeriqraApi);
