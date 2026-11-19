(function ($, api) {
  'use strict';
  const tr = function (key) { return window.I18n.t('imports.' + key); };
  let projectId = null, actorId = null, view = '', epoch = 0, recoveryRequest = 0;
  const inFlight = new Map();
  const panel = $('<section id="import-history" class="asset-panel">');
  const heading = $('<h2 class="fs-5">'), status = $('<p role="status" aria-live="polite">'), rows = $('<div>'), detail = $('<div>'), recovery = $('<div>');
  const refresh = $('<button type="button" class="btn btn-outline-secondary mb-2">').on('click', load);
  panel.append(heading, refresh, status, recovery, rows, detail); $('#automation-workspace').append(panel);
  function base() { return 'projects/' + encodeURIComponent(projectId) + '/imports'; }
  function storageKey() { return actorId && projectId ? 'veriqra.import.' + actorId + '.' + projectId : null; }
  function pending(key = storageKey()) {
    if (!key) return null;
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function store(key, value) {
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); }
    catch (_) { throw new Error(tr('storageFailed')); }
  }
  function linkRun(runId) {
    const destination = { projectId: String(projectId), runId: String(runId) };
    return $('<a class="btn btn-outline-primary btn-sm">').text(tr('openRun'))
      .attr('href', window.VeriqraQaNavigation.href('runs', destination)).on('click', function (event) {
        event.preventDefault(); window.VeriqraQaNavigation.open('runs', destination);
      });
  }
  function renderDetail(result) {
    detail.empty().append($('<h3 class="fs-6 mt-3">').text('#' + result.testImport.id + ' · ' + result.run.name),
      $('<p>').text(result.testImport.originalFilename + ' · ' + result.testImport.sourceNamespace),
      $('<p class="small text-break">').text('SHA-256: ' + result.testImport.reportSha256),
      $('<p class="small">').text(tr('requestKey') + ': ' + result.testImport.requestKey), linkRun(result.run.id));
    result.attempts.forEach(function (attempt) {
      const snapshot = result.runCases.find(function (row) { return row.id === attempt.runCaseId; });
      detail.append($('<p>').text((snapshot ? snapshot.title : '#' + attempt.runCaseId) + ' · ' + window.I18n.enumLabel(attempt.outcome)
        + (attempt.failureMessage ? ' · ' + attempt.failureMessage : '')));
    });
  }
  async function queryPending() {
    const scope = storageKey(), intent = pending(scope), token = epoch;
    if (view !== 'automation' || !intent || inFlight.has(scope)) return;
    const request = ++recoveryRequest;
    const current = () => request === recoveryRequest && token === epoch && scope === storageKey() && !inFlight.has(scope)
      && pending(scope)?.requestKey === intent.requestKey;
    recovery.text(tr('checking'));
    try {
      const result = await api.get(base() + '/requests/' + encodeURIComponent(intent.requestKey));
      if (!current()) return;
      store(scope, null); recovery.text(tr('recovered')); renderDetail(result);
      document.dispatchEvent(new CustomEvent('veriqra:import-recovered', { detail: { projectId: projectId, result: result } }));
    } catch (error) {
      if (!current()) return;
      const missing = error.status === 404;
      const actions = $('<div class="d-flex flex-wrap gap-2 mb-2">').append(
        $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(tr('checkAgain')).on('click', queryPending));
      if (missing) actions.append($('<button type="button" class="btn btn-outline-primary btn-sm">')
        .text(tr('discardPending')).on('click', function () {
          if (!current() || !window.confirm(tr('discardConfirm'))) return;
          try {
            store(scope, null);
            recovery.text(tr('discarded'));
            document.dispatchEvent(new CustomEvent('veriqra:import-discarded', { detail: { projectId: projectId } }));
          } catch (failure) { recovery.text(failure.message); }
        }));
      recovery.empty().append($('<p>').text(tr(missing ? 'notFound' : 'queryFailed')),
        $('<p class="small text-break">').text(intent.filename + ' · ' + intent.requestKey), actions);
    }
  }
  async function load() {
    if (view !== 'automation' || !projectId) return;
    const token = epoch; heading.text(tr('heading')); refresh.text(tr('refresh')); status.text(tr('loading')); rows.empty();
    try {
      const route = window.VeriqraQaNavigation.read();
      const imports = await api.get(base() + (route.runId ? '?runId=' + encodeURIComponent(route.runId) : '')); if (token !== epoch) return;
      status.text(imports.length ? '' : tr('empty'));
      imports.forEach(function (item) {
        rows.append($('<div class="asset-list-row">').append($('<span>').text('#' + item.id + ' · ' + item.originalFilename + ' · '
          + item.sourceNamespace + ' · ' + window.I18n.formatDateTime(item.importedAt)),
        $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(tr('detail')).on('click', async function () {
          try { const result = await api.get(base() + '/' + item.id); if (token === epoch) renderDetail(result); }
          catch (_) { if (token === epoch) status.text(tr('queryFailed')); }
        }), linkRun(item.testRunId)));
      });
      if (route.importId) { const result = await api.get(base() + '/' + encodeURIComponent(route.importId)); if (token === epoch) renderDetail(result); }
    } catch (_) { if (token === epoch) status.text(tr('queryFailed')); }
  }
  async function begin(file, signature) {
    const token = epoch, scope = storageKey();
    if (!scope || inFlight.has(scope)) throw new Error(tr('notReady'));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
      .map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    if (token !== epoch || scope !== storageKey() || inFlight.has(scope)) throw new Error(tr('notReady'));
    const previous = pending(scope);
    if (previous && (previous.signature !== signature || previous.hash !== hash)) {
      queryPending();
      throw new Error(tr('pendingMismatch'));
    }
    const requestKey = previous ? previous.requestKey : crypto.randomUUID();
    if (!previous) store(scope, { requestKey: requestKey, signature: signature, hash: hash, filename: file.name });
    const intent = { scope: scope, requestKey: requestKey, reused: !!previous };
    inFlight.set(scope, intent);
    ++recoveryRequest;
    recovery.empty();
    return intent;
  }
  function finish(intent, outcome) {
    const { scope, requestKey, reused } = intent;
    if (inFlight.get(scope) !== intent) return;
    inFlight.delete(scope);
    if (pending(scope)?.requestKey !== requestKey) return;
    const current = view === 'automation' && scope === storageKey();
    if (outcome === 'saved' || (!reused && (outcome === 'rejected' || outcome === 'unsent'))) {
      try { store(scope, null); }
      catch (failure) { if (current) recovery.text(failure.message); return; }
      if (current) {
        recovery.empty();
        if (outcome === 'saved') load();
      }
    } else if (current) {
      queryPending();
    }
  }
  async function identify() {
    const token = epoch;
    try { const actor = await api.get('auth/me'); if (token === epoch) { actorId = actor.id; await queryPending(); } }
    catch (_) { if (token === epoch) recovery.text(tr('notReady')); }
  }
  $(document).on('veriqra:project', function (event) {
    ++epoch; projectId = event.originalEvent.detail.project ? String(event.originalEvent.detail.project.id) : null;
    actorId = null; rows.empty(); detail.empty(); recovery.empty(); if (projectId && view === 'automation') { identify(); load(); }
  });
  $(document).on('veriqra:view', function (event) {
    const next = event.originalEvent.detail.view;
    if (next !== view) { ++epoch; detail.empty(); recovery.empty(); } view = next;
    if (view === 'automation' && projectId) { identify(); load(); }
  });
  document.addEventListener('veriqra:localechange', function () { if (view === 'automation') { load(); queryPending(); } });
  window.VeriqraImportHistory = Object.freeze({ begin: begin, finish: finish });
})(jQuery, window.VeriqraApi);
