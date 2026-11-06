(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  let projectId = null;
  let view = 'dashboard';
  let generation = 0;
  let detail = null;
  let actionMode = null;
  let launch = null;
  let createMode = 'create';
  let routeContext = {};
  let mutating = false;
  let linkableDefects = [];
  let evidenceValues = null;
  let evidenceGeneration = 0;
  let evidenceLoading = false;
  const memberPickers = {};
  let projectMembers = [];
  let accessGeneration = 0;
  let actor = null;
  let projectArchived = false;
  let closureEligibility = null;
  let closureLoading = false;
  let closureFailure = null;
  let closureGeneration = 0;
  let closureNeedsAccessRefresh = false;
  let retestEditor = null;
  let retestHandoff = null;
  const candidatePages = new Map();
  let retestPending = null;
  let editBlocked = false;
  let actionFeedback = null;
  let listLoaded = false;
  let listRows = [];
  const listPositions = new Map();
  let generatedDraft = null;
  let pendingAiDraft = null;
  const expandedSections = new Map();
  const pickerData = { 'defect-create': {}, 'defect-action': {} };
  const pickerGeneration = { 'defect-create': 0, 'defect-action': 0 };
  const pickerFailures = { 'defect-create': {}, 'defect-action': {} };
  const active = function () { return view === 'defects' && !!projectId; };
  const valid = function (token) { return active() && token === generation; };
  const base = function (resource) { return 'projects/' + encodeURIComponent(projectId) + '/' + resource; };
  const defectPath = function (id) { return base('defects') + '/' + encodeURIComponent(id); };
  const runPath = function (id) { return base('runs') + '/' + encodeURIComponent(id); };
  const label = function (value) { return window.I18n.enumLabel(value); };
  const date = function (value) { return window.I18n.formatDateTime(value); };
  const sameId = function (left, right) { return left != null && right != null && String(left) === String(right); };
  const navigation = function () { return window.VeriqraQaNavigation; };
  function selectContext(context) {
    routeContext = Object.assign({ projectId: projectId }, context);
    if (routeContext.attemptId) routeContext.failureAttemptId = String(routeContext.attemptId);
    if (navigation()) navigation().select('defects', routeContext);
  }
  function routeLink(text, next, context) {
    const nav = navigation();
    return $('<a class="btn btn-outline-primary btn-sm">').text(text)
      .attr('href', nav ? nav.href(next, Object.assign({ projectId: projectId }, context)) : '#' + next)
      .on('click', function (event) {
        if (!nav || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.button != null && event.button !== 0)) return;
        event.preventDefault(); nav.open(next, Object.assign({ projectId: projectId }, context));
      });
  }
  function listKey() { return projectId + '/' + (actor && actor.id != null ? actor.id : 'unverified'); }
  function listState() {
    const key = listKey();
    if (!listPositions.has(key)) listPositions.set(key, { scroll: 0, search: '', status: '', quick: 'ALL', sort: 'UPDATED' });
    return listPositions.get(key);
  }
  function rememberList(id) {
    if (!active() || !listLoaded || $('#defect-list-panel').hasClass('d-none')) return;
    const position = listState();
    position.remembered = true;
    if (Number.isFinite(window.scrollY)) position.scroll = window.scrollY;
    if (id != null) position.id = String(id);
  }
  function restoreList(token) {
    const position = listPositions.get(listKey());
    if (!position || !position.remembered || typeof window.scrollTo !== 'function') return;
    const restore = function () { if (valid(token) && !$('#defect-list-panel').hasClass('d-none')) window.scrollTo(0, position.scroll); };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore); else restore();
  }
  function disclosure(name, title, content) {
    const sectionKey = projectId + '/' + (detail ? detail.defect.id : '') + '/' + name;
    const section = $('<details class="workflow-details">').attr('data-section', name).prop('open', expandedSections.get(sectionKey) === true)
      .append($('<summary>').text(title), content);
    section.on('toggle', function () { expandedSections.set(sectionKey, this.open === true); });
    return section;
  }
  function mutationState(value) {
    mutating = value;
    $('#defect-detail-panel button, #defect-action-form select, #defect-action-form input, #defect-action-form textarea').prop('disabled', value);
    $('#defect-evidence-retry').prop('disabled', value || evidenceLoading);
    refreshMemberControls();
    if (value) $('#defect-closure button, #defect-retest-form input, #defect-retest-form textarea, #defect-retest-form button').prop('disabled', true);
    else { updatePickerSubmit('defect-action'); renderClosure(); if (detail) { renderActions(detail.defect); renderDefect(detail.defect); if (evidenceValues) renderEvidence(detail); if (actionMode) actionLabels(actionMode); } }
    if (window.VeriqraAiDefectAnalysis) window.VeriqraAiDefectAnalysis.setBlocked(value);
  }
  function failureContext(prefix) {
    return { runId: String($('#' + prefix + '-run').val() || ''), runCaseId: String($('#' + prefix + '-case').val() || ''),
      attemptId: String($('#' + prefix + '-attempt').val() || '') };
  }
  function announceLinked(defectId, context, sourceProjectId) {
    document.dispatchEvent(new CustomEvent('veriqra:defect-linked', { detail: Object.assign({ projectId: sourceProjectId, defectId: String(defectId) }, context) }));
  }
  const field = function (name, value, wide) {
    return $('<div class="asset-field">').toggleClass('asset-field-wide', !!wide).append($('<dt>').text(name),
      $('<dd>').text(value == null || value === '' ? '—' : String(value)));
  };
  const badge = function (value) {
    const colors = { OPEN: 'danger', IN_PROGRESS: 'primary', RESOLVED: 'info', CLOSED: 'success', REOPENED: 'warning', FAIL: 'danger', PASS: 'success', BLOCKED: 'warning', SKIPPED: 'info' };
    return $('<span>').addClass('badge text-bg-' + (colors[value] || 'secondary')).attr('data-vq-state', value).text(label(value));
  };
  function notice(message, error) {
    $('#defect-notice').text(message || '').toggleClass('d-none', !message)
      .toggleClass('alert-danger', !!error).toggleClass('alert-success', !!message && !error);
  }
  function actionStatus(message, error) {
    actionFeedback = { message: message, error: error };
    renderActionStatus();
  }
  function renderActionStatus() {
    if (!actionFeedback) return;
    const message = typeof actionFeedback.message === 'function' ? actionFeedback.message() : actionFeedback.message;
    const error = actionFeedback.error;
    $('#defect-action-status').text(message || '').toggleClass('d-none', !message)
      .toggleClass('alert-danger', !!error).toggleClass('alert-success', !!message && !error)
      .attr('role', error ? 'alert' : 'status').attr('aria-live', error ? 'assertive' : 'polite');
  }
  function formError(id, message) { $(id).text(message || '').toggleClass('d-none', !message); }
  function focusHeading(selector) { $(selector).attr('tabindex', '-1').trigger('focus'); }
  function conflict(error, action) {
    if (error.status !== 409) return error.message;
    return action === 'close'
      ? t('defects.closeRejected', null, 'Close was rejected. Each linked FAIL needs a later current PASS; the defect must also remain RESOLVED and unchanged. Reload the latest detail before trying again.')
      : t('defects.conflict', null, 'The record changed or this action is not allowed in its current state. Reload the latest detail before trying again.');
  }
  function reset() {
    if (window.VeriqraAiDefectAnalysis) window.VeriqraAiDefectAnalysis.clear();
    if (window.VeriqraDefectComments) window.VeriqraDefectComments.clear();
    generation++;
    listLoaded = false;
    listRows = []; generatedDraft = null; pendingAiDraft = null;
    $('#defect-list-toolbar').remove();
    pickerGeneration['defect-create']++;
    pickerGeneration['defect-action']++;
    detail = null; actionMode = null; mutating = false; evidenceValues = null; evidenceLoading = false; linkableDefects = [];
    editBlocked = false;
    projectMembers = []; accessGeneration++; Object.keys(memberPickers).forEach(function (key) { delete memberPickers[key]; });
    closureEligibility = null; closureLoading = false; closureFailure = null; closureGeneration++; closureNeedsAccessRefresh = false; retestEditor = null; retestHandoff = null; candidatePages.clear(); retestPending = null;
    pickerData['defect-create'] = {}; pickerData['defect-action'] = {};
    clearPickerFailures('defect-create'); clearPickerFailures('defect-action');
    $('#defect-list, #defect-detail, #defect-evidence, #defect-actions, #defect-closure').empty();
    $('#defect-list-status, #defect-evidence-status').text('');
    $('#defect-list-panel, #defect-detail-panel, #defect-create-form, #defect-action-form').addClass('d-none');
    $('#defect-create-submit, #defect-action-submit').prop('disabled', false);
    notice(''); actionStatus(''); formError('#defect-create-error', ''); formError('#defect-action-error', '');
  }
  function panels(which) {
    if (which !== 'detail' && window.VeriqraAiDefectAnalysis) window.VeriqraAiDefectAnalysis.clear();
    if (which !== 'detail' && window.VeriqraDefectComments) window.VeriqraDefectComments.clear();
    $('#defect-list-panel').toggleClass('d-none', which !== 'list');
    $('#defect-detail-panel').toggleClass('d-none', which !== 'detail');
    $('#defect-create-form').toggleClass('d-none', which !== 'create');
  }
  async function list() {
    if (!active()) return;
    const token = ++generation;
    listLoaded = false;
    detail = null; actionMode = null; mutating = false;
    $('#defect-list-toolbar').remove();
    panels('list'); notice('');
    $('#defect-list').empty(); $('#defect-list-status').text(t("defects.loadingDefects", null, 'Loading defects…'));
    focusHeading('#defect-list-panel h2');
    try {
      const rows = await api.get(base('defects'));
      if (!valid(token)) return;
      listRows = rows; listLoaded = true;
      renderListToolbar(); renderListRows(); restoreList(token);
    } catch (error) { if (valid(token)) {
      $('#defect-list-status').text(t('common.unavailable', null, 'Unavailable')); notice(error.message, true);
      $('#defect-list').append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('common.retry', null, 'Retry')).on('click', function () { if (valid(token)) return list(); }));
    } }
  }
  function quickMatch(row, quick) {
    return quick === 'UNCLOSED' ? row.status !== 'CLOSED'
      : quick === 'RETEST' ? row.status === 'RESOLVED'
      : quick === 'MINE' ? !!actor && sameId(row.assigneeId, actor.id) : true;
  }
  function renderListToolbar() {
    $('#defect-list-toolbar').remove();
    const state = listState(), toolbar = $('<div id="defect-list-toolbar" class="workflow-list-toolbar">');
    const quick = $('<div class="workflow-list-quickviews" role="group">').attr('aria-label', t('zentaoDefects.quickViews', null, 'Defect views'));
    [['ALL', 'all', 'All'], ['UNCLOSED', 'unclosed', 'Unclosed'], ['RETEST', 'awaitingRetest', 'Awaiting retest'], ['MINE', 'assignedToMe', 'Assigned to me']].forEach(function (entry) {
      const count = listRows.filter(function (row) { return quickMatch(row, entry[0]); }).length;
      quick.append($('<button type="button" class="btn btn-sm btn-outline-secondary">').attr('data-defect-view', entry[0])
        .attr('aria-pressed', state.quick === entry[0] ? 'true' : 'false').prop('disabled', entry[0] === 'MINE' && !actor)
        .text(t('zentaoDefects.' + entry[1], null, entry[2]) + ' ' + (entry[0] === 'MINE' && !actor ? '—' : window.I18n.formatNumber(count)))
        .on('click', function () {
          if (entry[0] === 'MINE' && !actor) return;
          state.quick = entry[0]; state.status = ''; state.scroll = 0;
          renderListToolbar(); renderListRows();
        }));
    });
    const filters = $('<div class="workflow-list-filters">');
    function filter(id, text, control) {
      filters.append($('<div class="workflow-list-filter">').append($('<label>').attr('for', id).text(text), control.attr('id', id)));
    }
    filter('defect-list-search', t('zentaoDefects.search', null, 'Search title, ID or description'),
      $('<input type="search" class="form-control">').val(state.search).on('input', function () { state.search = String($(this).val() || ''); state.scroll = 0; renderListRows(); }));
    const status = $('<select class="form-select">').append(option('', t('zentaoDefects.allStatuses', null, 'All statuses')));
    ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'].forEach(function (value) { status.append(option(value, label(value))); });
    status.val(state.status).on('change', function () { state.status = String($(this).val() || ''); state.scroll = 0; renderListRows(); });
    filter('defect-list-status-filter', t('common.status', null, 'Status'), status);
    const sort = $('<select class="form-select">');
    [['UPDATED', 'recentlyUpdated', 'Recently updated'], ['NEWEST', 'newest', 'Newest first'], ['PRIORITY', 'highestPriority', 'Highest priority']].forEach(function (entry) { sort.append(option(entry[0], t('zentaoDefects.' + entry[1], null, entry[2]))); });
    sort.val(state.sort).on('change', function () { state.sort = String($(this).val() || 'UPDATED'); state.scroll = 0; renderListRows(); });
    filter('defect-list-sort', t('zentaoDefects.sort', null, 'Sort'), sort);
    filters.append($('<button type="button" id="defect-list-clear" class="btn btn-outline-secondary">').text(t('zentaoDefects.clear', null, 'Clear filters'))
      .on('click', function () { state.search = ''; state.status = ''; state.quick = 'ALL'; state.sort = 'UPDATED'; state.scroll = 0; renderListToolbar(); renderListRows(); }));
    toolbar.append(quick, filters);
    $('#defect-list').before(toolbar);
  }
  function renderListRows() {
    if (!active() || !listLoaded || $('#defect-list-panel').hasClass('d-none')) return;
    const state = listState(), search = state.search.trim().toLocaleLowerCase();
    const visible = listRows.filter(function (row) {
      return quickMatch(row, state.quick) && (!state.status || row.status === state.status) && (!search ||
        ['BUG-' + String(row.keyNo).padStart(3, '0'), row.title, row.description].join(' ').toLocaleLowerCase().includes(search));
    });
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    visible.sort(function (left, right) {
      if (state.sort === 'PRIORITY' && rank[left.priority] !== rank[right.priority]) return (rank[right.priority] || 0) - (rank[left.priority] || 0);
      if (state.sort === 'NEWEST') return Number(right.id) - Number(left.id);
      return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) || Number(right.id) - Number(left.id);
    });
    $('#defect-list').empty();
    $('#defect-list-status').addClass('workflow-list-count').text(listRows.length
      ? t('zentaoDefects.filteredCount', { shown: window.I18n.formatNumber(visible.length), total: window.I18n.formatNumber(listRows.length) }, 'Showing {shown} of {total} loaded defects')
      : t('defects.noDefectsInThisProject', null, 'No defects in this project.'));
    if (listRows.length && !visible.length) $('#defect-list').append($('<p class="text-secondary mb-0">').text(t('zentaoDefects.noMatches', null, 'No matching defects. Change the search or filters.')));
    visible.forEach(function (row) {
      const title = 'BUG-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title;
      $('#defect-list').append($('<div class="asset-list-row workflow-list-row">').attr('data-defect-id', row.id).toggleClass('is-recently-viewed', sameId(state.id, row.id)).append(
        $('<div class="asset-list-summary">').append(routeLink(title, 'defects', { defectId: String(row.id) }).removeClass('btn btn-outline-primary btn-sm').addClass('asset-title-link'),
          $('<p class="mb-1 text-secondary">').text(row.description || t('common.noDescription', null, 'No description'))),
        $('<div class="asset-list-meta">').append(badge(row.status),
          $('<span>').text(t('defects.severityPriority', { severity: label(row.severity), priority: label(row.priority) }, 'Severity {severity} · Priority {priority}')),
          $('<small>').text(t('zentaoDefects.recordRevision', { version: row.version }, 'Record revision {version}')),
          $('<small>').text(t('defects.updatedAt', { date: date(row.updatedAt) }, 'Updated {date}')))));
    });
  }
  async function loadEvidence(current, token) {
    const evidenceToken = ++evidenceGeneration;
    evidenceLoading = true;
    const requests = new Map();
    function shared(path) {
      if (!requests.has(path)) requests.set(path, Promise.resolve(api.get(path)));
      return requests.get(path);
    }
    $('#defect-evidence-status').text(t('defects.loadingLinkedEvidence', null, 'Loading linked evidence…'));
    $('#defect-evidence-retry').prop('disabled', true);
    const values = await Promise.all(current.evidence.map(async function (row) {
      const sourceRun = runPath(row.runId);
      const results = await Promise.allSettled([shared(sourceRun), shared(sourceRun + '/cases/' + encodeURIComponent(row.runCaseId) + '/attempts')]);
      const run = results[0].status === 'fulfilled' ? results[0].value : null;
      const history = results[1].status === 'fulfilled' ? results[1].value : null;
      const runCase = run && run.cases.find(function (item) { return sameId(item.runCaseId, row.runCaseId); });
      return { link: row, run: run && run.run, runCase: runCase, history: history,
        unavailable: !runCase || !history || !history.some(function (attempt) { return sameId(attempt.id, row.attemptId); }) };
    }));
    if (!valid(token) || detail !== current || evidenceToken !== evidenceGeneration) return;
    evidenceValues = values;
    evidenceLoading = false;
    renderDefect(current.defect);
    renderEvidence(current);
  }
  function renderEvidence(current) {
    if (!evidenceValues) { $('#defect-evidence-status').text(t('defects.loadingLinkedEvidence', null, 'Loading linked evidence…')); return; }
    $('#defect-evidence').empty();
    $('#defect-evidence-status').text(evidenceValues.length ? t('defects.evidenceCount', { count: window.I18n.formatNumber(evidenceValues.length) }, '{count} linked FAIL attempt(s)') : t('defects.noLinkedFailureEvidence', null, 'No linked failure evidence.'));
    evidenceValues.forEach(function (value) { $('#defect-evidence').append(evidenceCard(value, current.defect)); });
    if (evidenceValues.some(function (value) { return value.unavailable; })) $('#defect-evidence').append(
      $('<button type="button" id="defect-evidence-retry" class="btn btn-outline-primary btn-sm">').text(t('defects.retryEvidence', null, 'Retry evidence'))
        .prop('disabled', mutating || evidenceLoading).on('click', function () { if (!mutating && !evidenceLoading) return loadEvidence(current, generation); }));
  }
  function evidenceCard(value, defect) {
    const link = value.link;
    const source = value.history && value.history.find(function (attempt) { return sameId(attempt.id, link.attemptId); });
    const card = $('<div class="execution-attempt">').append(
      $('<div class="asset-panel-heading mb-1">').append(
        $('<strong>').text(t('defects.linkedFailAttempt', { number: link.attemptNo, id: link.attemptId }, 'Linked FAIL attempt #{number} · ID {id}')), badge(link.outcome)),
      $('<dl class="asset-fields mb-2">').append(
        field(t('defects.run', null, 'Run'), value.run ? value.run.name : t('common.unavailable', null, 'Unavailable')),
        field(t('zentaoDefects.testedBuild', null, 'Tested build'), value.run ? value.run.buildVersion : null),
        field(t('zentaoDefects.environment', null, 'Environment'), value.run ? value.run.environment : null),
        field(t("defects.runCaseSnapshot", null, 'Run Case snapshot'), value.runCase ? value.runCase.snapshotTitle : t('common.unavailable', null, 'Unavailable')),
        field(t("defects.executed", null, 'Executed'), source ? date(source.executedAt) : null), field(t('defects.actor', null, 'Executed by'), source ? projectUserName(source.executedBy) : null),
        field(t("defects.actualResultComment", null, 'Actual result / comment'), source ? source.comment : null, true),
        field(t("defects.failureMessage", null, 'Failure message'), source ? source.failureMessage : link.failureMessage, true),
        field(t('defects.linked', null, 'Linked'), date(link.linkedAt))));
    const later = (value.history || []).filter(function (attempt) { return attempt.attemptNo > link.attemptNo; });
    if (value.unavailable) card.append($('<p class="small text-danger" role="status">').text(t('defects.evidenceUnavailable', null, 'Run or attempt history could not be loaded. Retest status is unavailable.')));
    else if (!later.length) card.append($('<p class="small text-secondary">').text(t("defects.noLaterAttemptRecorded", null, 'No later attempt recorded.')));
    const laterHistory = $('<div>');
    later.forEach(function (attempt) {
      laterHistory.append($('<div class="defect-retest">').append(
        $('<span>').text(t('defects.attemptAt', { number: attempt.attemptNo, date: date(attempt.executedAt) }, 'Attempt #{number} · {date} · ')), badge(attempt.outcome),
        $('<span>').text(' ' + (attempt.comment || attempt.failureMessage || t("defects.noComment", null, 'No comment')))));
    });
    if (later.length) card.append(disclosure('later-attempts-' + link.attemptId, t('defects.laterHistory', { count: later.length }, 'Later attempts ({count})'), laterHistory));
    const context = { runId: String(link.runId), runCaseId: String(link.runCaseId), attemptId: String(link.attemptId), defectId: String(defect.id) };
    card.append(routeLink(t('defects.openSourceAttempt', null, 'Open source attempt'), 'runs', context));
    if (value.runCase && value.runCase.testCaseId != null) card.append(routeLink(t('defects.openOriginalCase', null, 'Open original Test Case'), 'test-cases', Object.assign({}, context, { testCaseId: String(value.runCase.testCaseId) })).addClass('ms-2'));
    if (canManage() && defect.status !== 'CLOSED') card.append($('<button type="button" class="btn btn-outline-danger btn-sm ms-2">')
      .text(t("defects.removeLinkCorrection", null, 'Remove link (correction)')).prop('disabled', mutating).on('click', function () { return removeEvidence(link, defect); }));
    return card;
  }
  async function openDetail(id, feedback, handoff) {
    if (!active()) return;
    if (window.VeriqraAiDefectAnalysis) window.VeriqraAiDefectAnalysis.clear();
    if (window.VeriqraDefectComments && (!detail || !sameId(detail.defect.id, id))) window.VeriqraDefectComments.clear();
    rememberList(id);
    const token = ++generation;
    actionMode = null; detail = null; mutating = false; evidenceValues = null; evidenceLoading = false; panels('detail'); notice(''); actionStatus('');
    closureEligibility = null; closureLoading = true; closureFailure = null; closureGeneration++; closureNeedsAccessRefresh = false; retestEditor = null; candidatePages.clear(); retestPending = null;
    retestHandoff = handoff || null;
    // The URL opens this confirmation once. Refreshes and ordinary defect links use the usual detail.
    selectContext(Object.assign({}, routeContext, { defectId: String(id), action: undefined, retestRunId: undefined, retestRunCaseId: undefined, retestPassAttemptId: undefined }));
    $('#defect-detail-panel button').prop('disabled', false);
    $('#defect-action-form').addClass('d-none');
    $('#defect-detail-title').text(t("defects.loadingDefect", null, 'Loading defect…'));
    focusHeading('#defect-detail-title');
    $('#defect-detail, #defect-evidence, #defect-actions, #defect-closure').empty();
    $('#defect-evidence-status').text(t("defects.loadingLinkedEvidence", null, 'Loading linked evidence…'));
    try {
      const current = await api.get(defectPath(id));
      if (!valid(token)) return;
      detail = current;
      const defect = current.defect;
      renderDefect(defect);
      renderActions(defect);
      loadMembers('defect-detail', defect.assigneeId);
      loadEligibility(current, token);
      if (feedback) actionStatus(feedback, false);
      await loadEvidence(current, token);
    } catch (error) { if (valid(token)) {
      $('#defect-detail-title').text(t('common.unavailable', null, 'Unavailable'));
      $('#defect-evidence-status').text(''); notice(error.message, true);
      $('#defect-actions').append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('common.retry', null, 'Retry')).on('click', function () { if (valid(token) && !mutating) return openDetail(id, feedback); }));
    } }
  }
  function renderDefect(defect) {
    $('#defect-detail-title').text('BUG-' + String(defect.keyNo).padStart(3, '0') + ' · ' + defect.title);
    const target = $('#defect-detail').empty();
    const sources = [...new Map((evidenceValues || []).filter(function (value) { return value.run; }).map(function (value) { return [String(value.run.id), value.run]; })).values()];
    if (sources.length === 1) target.append(sourceContext(sources[0]));
    else if (sources.length > 1) target.append($('<p class="workflow-context-strip">').text(t('zentaoDefects.multipleSources', { count: sources.length }, '{count} source runs. Each failure below shows its tested build and environment.')));
    target.append($('<dl class="asset-fields">').append(
        field(t("common.status", null, 'Status'), label(defect.status)), field(t("common.severity", null, 'Severity'), label(defect.severity)),
        field(t("common.priority", null, 'Priority'), label(defect.priority)), field(t('zentaoDefects.revisionLabel', null, 'Record revision'), defect.version),
        field(t("common.description", null, 'Description'), defect.description, true), field(t('defects.reporter', null, 'Reported by'), projectUserName(defect.reporterId)),
        field(t('defects.assignee', null, 'Assignee'), assigneeName(defect.assigneeId)), field(t("defects.resolutionNote", null, 'Resolution note'), defect.resolutionNote, true),
        field(t("common.created", null, 'Created'), date(defect.createdAt)), field(t("common.updated", null, 'Updated'), date(defect.updatedAt))));
    syncAiAnalysis();
    syncDiscussion();
  }
  function syncDiscussion() {
    if (!window.VeriqraDefectComments || !detail || !actor || !active()) return;
    window.VeriqraDefectComments.mount({ projectId: projectId, defectId: detail.defect.id, actorId: actor.id,
      writable: actor.status === 'ACTIVE' && !projectArchived });
  }
  function syncAiAnalysis() {
    if (!window.VeriqraAiDefectAnalysis) return;
    if (!detail || !active() || $('#defect-detail-panel').hasClass('d-none')) { window.VeriqraAiDefectAnalysis.clear(); return; }
    const owner = detail, token = generation;
    window.VeriqraAiDefectAnalysis.mount({ projectId: projectId, defect: owner.defect, actorId: actor && actor.id,
      isCurrent: function () { return valid(token) && detail === owner && !$('#defect-detail-panel').hasClass('d-none'); } });
    window.VeriqraAiDefectAnalysis.setBlocked(mutating);
  }
  function renderActions(defect) {
    const actions = $('#defect-actions').empty().addClass('workflow-next');
    const controls = $('<div class="workflow-next-actions">');
    const tester = canManage();
    const processor = tester || canProcess(defect);
    const closeReady = !!(tester && !retestPending && !closureLoading && closureEligibility && closureEligibility.canClose && closureEligibility.defectVersion === defect.version);
    const hint = defect.status === 'CLOSED' ? ['defects.nextClosed', 'Closed. Review the original failure and retest results below.']
      : ['OPEN', 'REOPENED'].includes(defect.status) ? (processor ? ['defects.nextStart', 'Next: start work on this defect.'] : ['defects.nextWaitStart', 'Waiting for the assignee to start work.'])
      : defect.status === 'IN_PROGRESS' ? (processor ? ['defects.nextResolve', 'Next: enter the fix details and mark the defect resolved.'] : ['defects.nextWaitResolve', 'Waiting for the assignee to record the fix.'])
      : closeReady ? ['defects.nextClose', 'Retest passed. Next: close the defect.'] : ['defects.nextRetest', 'Next: retest the original failure and link its passing result.'];
    actions.append($('<p class="w-100 fw-semibold mb-1" role="status">').text(t(hint[0], null, hint[1])));
    if (defect.status === 'RESOLVED' && !closeReady && closureEligibility && closureEligibility.defectVersion === defect.version) {
      const pending = (closureEligibility.failures || []).filter(function (failure) { return !failure.eligible; });
      const reasons = (closureEligibility.reasons || []).concat(pending.flatMap(function (failure) { return failure.reasons || []; }));
      if (pending.length) actions.append($('<p class="mb-2">').text(t('defects.pendingRetests', { count: pending.length }, '{count} failure(s) still need valid retest evidence.')));
      if (reasons.length) actions.append($('<p class="mb-2">').text(reasonText(reasons[0])));
    }
    actions.append(controls);
    if (processor && ['OPEN', 'REOPENED'].includes(defect.status)) controls.append(actionButton(t("defects.startWork", null, 'Start work'), function () { return transition('start'); }, true));
    if (processor && defect.status === 'IN_PROGRESS') controls.append(actionButton(t("defects.resolve", null, 'Resolve'), function () { showAction('resolve'); }, true));
    if (tester && defect.status === 'RESOLVED') {
      if (!closeReady) controls.append(actionButton(t('defects.enterRetest', null, 'Review retest results'), function () { focusHeading('#defect-closure-heading'); }, true));
      controls.append(actionButton(t("common.close", null, 'Close'), function () { return transition('close'); }, closeReady)
        .prop('disabled', mutating || !!retestPending || editorActive() || !closeReady));
    }
    if (tester && defect.status !== 'CLOSED') controls.append(actionButton(t('defects.editDefect', null, 'Edit and reassign'), function () { showAction('edit'); }));
    if (tester && ['RESOLVED', 'CLOSED'].includes(defect.status)) controls.append(actionButton(t("defects.reopenWithNewFAIL", null, 'Reopen with new FAIL'), function () { showAction('reopen'); }));
    if (tester && defect.status !== 'CLOSED') controls.append(actionButton(t("defects.addFailureEvidence", null, 'Add failure evidence'), function () { showAction('add'); }));
    const members = detailMemberState();
    if (members && (members.loading || members.failed)) {
      const status = $('<div class="small text-secondary" role="status">').attr('id', 'defect-detail-members-status')
        .text(members.loading ? t('defects.loadingMembers', null, 'Loading project members…') : t('defects.membersUnavailable', null, 'Project members are unavailable. Retry before changing the assignment.'));
      if (members.failed) status.append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">')
        .attr('id', 'defect-detail-members-retry').text(t('common.retry', null, 'Retry')).prop('disabled', mutating)
        .on('click', function () { if (!mutating && detailMemberState() === members && !members.loading) return loadMembers('defect-detail', members.retained); }));
      actions.append(status);
    }
    $('#defect-closure .defect-retest-open').prop('disabled', mutating || !!retestPending || editorActive());
  }
  function detailMemberState() { const state = memberPickers['defect-detail']; return state && valid(state.generation) && state.accessGeneration === accessGeneration && state.owner === detail ? state : null; }
  function activeActorMember() { return actor && projectMembers.find(function (row) { return sameId(row.userId, actor.id) && row.status === 'ACTIVE' && row.userStatus === 'ACTIVE'; }); }
  function canManage() { const member = activeActorMember(); return !projectArchived && actor && actor.status !== 'DISABLED' && (actor.systemRole === 'ADMIN' || member && member.projectRole === 'TESTER'); }
  function canProcess(defect) { const member = activeActorMember(); return !projectArchived && member && member.projectRole === 'DEVELOPER' && sameId(actor.id, defect.assigneeId); }
  async function loadActor(token) {
    const accessToken = accessGeneration;
    try {
      const value = await api.get('auth/me');
      if (!valid(token) || accessToken !== accessGeneration) return;
      actor = value;
      syncAiAnalysis();
      syncDiscussion();
      if (detail) { renderActions(detail.defect); renderClosure(); if (evidenceValues) renderEvidence(detail); recoverStoredOperation(); openRetestHandoff(); }
      if (listLoaded && !$('#defect-list-panel').hasClass('d-none')) { renderListToolbar(); renderListRows(); restoreList(token); }
    } catch (error) {
      if (valid(token) && accessToken === accessGeneration) {
        actor = null; syncAiAnalysis();
        if (window.VeriqraDefectComments) window.VeriqraDefectComments.clear();
        if (retestHandoff) { retestHandoff = null; retestHandoffUnavailable(); }
        if (detail) { renderActions(detail.defect); renderClosure(); }
      }
    }
  }
  function editorActive() { return !!actionMode || !!retestEditor; }
  function actionButton(text, callback, primary) { return $('<button type="button" class="btn ' + (primary && !editorActive() ? 'btn-primary' : 'btn-outline-primary') + '">').text(text).prop('disabled', mutating || editorActive()).on('click', function () { if (!mutating && !editorActive()) return callback(); }); }
  async function transition(mode) {
    const defect = detail && detail.defect;
    if (mode === 'close' && (retestPending || closureLoading || !canManage() || !closureEligibility || !closureEligibility.canClose || closureEligibility.defectVersion !== defect.version)) return;
    if (mutating || !defect || !window.confirm(t(mode === 'close' ? 'defects.closeConfirm' : 'defects.startConfirm',
      { key: 'BUG-' + defect.keyNo }, mode === 'close' ? 'Close {key}?' : 'Start {key}?'))) return;
    const token = generation;
    const operation = mode === 'close' ? { action: 'CLOSE', body: { expectedVersion: defect.version }, defectId: String(defect.id), projectId: projectId, actorId: String(actor.id) } : null;
    if (operation) { retestPending = operation; persistOperation(operation); operation.submitting = true; }
    mutationState(true);
    try {
      await api.post(defectPath(defect.id) + '/' + mode, { expectedVersion: defect.version });
      if (valid(token) && operation) { persistOperation(null); retestPending = null; }
      if (valid(token)) await openDetail(defect.id, mode === 'close' ? t("defects.defectClosed", null, 'Defect closed.') : t("defects.workStarted", null, 'Work started.'));
    } catch (error) { if (valid(token)) {
      if (operation && [400, 403, 404, 409].includes(error.status)) { persistOperation(null); retestPending = null; }
      actionStatus(function () { return error.reasonCode ? reasonText(error.reasonCode) : conflict(error, mode); }, true);
      if (operation && retestPending) renderOperationRecovery();
      if (mode === 'close') loadEligibility(detail, token, true);
    } }
    finally { if (operation) operation.submitting = false; if (valid(token)) mutationState(false); }
  }
  async function removeEvidence(link, defect) {
    if (mutating || !detail || !sameId(detail.defect.id, defect.id) || !window.confirm(t('defects.removeEvidenceConfirm', { number: link.attemptNo },
      'Remove the evidence link for FAIL attempt #{number}? The Attempt itself remains in Run history.'))) return;
    const token = generation;
    const removed = { projectId: projectId, defectId: String(defect.id), attemptId: String(link.attemptId), runId: String(link.runId), runCaseId: String(link.runCaseId) };
    mutationState(true);
    try {
      await api.post(defectPath(defect.id) + '/evidence/' + link.attemptId + '/remove', { expectedVersion: defect.version });
      document.dispatchEvent(new CustomEvent('veriqra:defect-unlinked', { detail: removed }));
      if (valid(token)) await openDetail(defect.id);
    } catch (error) { if (valid(token)) notice(error.reasonCode ? reasonText(error.reasonCode) : conflict(error), true); }
    finally { if (valid(token)) mutationState(false); }
  }
  function reasonText(code) { return t('defects.reason.' + code, null, t('defects.workflowRecovery', null, 'This workflow could not be completed. Review the latest facts and the original request before retrying. Check the submitted operation first if its outcome is uncertain.')); }
  function executionTitle(execution) {
    if (!execution) return '—';
    return execution.run.name + ' · ' + execution.runCase.snapshotTitle + ' · ' + t('defects.attemptNumber', { number: execution.attempt.attemptNo }, 'Attempt #{number}');
  }
  function executionContext(execution) { return { runId: String(execution.run.id), runCaseId: String(execution.runCase.id), attemptId: String(execution.attempt.id), defectId: detail && String(detail.defect.id) }; }
  function executionSummary(execution) {
    const attempt = execution.attempt;
    const facts = $('<div>').append(
      $('<p class="small mb-1">').text(t('defects.executionOrigin', { source: attempt.importId == null ? t('defects.manualSource', null, 'Manual execution') : t('defects.importSource', null, 'JUnit import'), recorded: date(attempt.recordedAt) }, '{source} · recorded {recorded}')),
      $('<p class="small mb-1">').text(attempt.executedAt ? t('defects.actualExecutionTime', { time: date(attempt.executedAt) }, 'Actual execution time: {time}') : t('defects.externalTimingUnverified', null, 'The imported report does not provide verified actual execution time.')),
      $('<p class="small mb-1">').text(t('defects.buildEnvironment', { build: execution.run.buildVersion || '—', environment: execution.run.environment || '—' }, 'Build: {build} · environment: {environment}')));
    return $('<div>').append($('<p class="mb-1 fw-semibold">').text(executionTitle(execution)),
      disclosure('execution-' + attempt.id, t('defects.executionDetails', null, 'Execution source and timing'), facts),
      routeLink(t('defects.openSourceAttempt', null, 'Open source attempt'), 'runs', executionContext(execution)));
  }
  async function loadEligibility(current, token, refreshAccess) {
    const request = ++closureGeneration;
    const accessToken = refreshAccess ? ++accessGeneration : accessGeneration;
    const stillCurrent = function () { return valid(token) && detail === current && request === closureGeneration; };
    closureEligibility = null; closureFailure = null; closureLoading = true; closureNeedsAccessRefresh = !!refreshAccess;
    renderClosure(); renderActions(current.defect);
    try {
      const reads = [api.get(defectPath(current.defect.id) + '/closure-eligibility')];
      if (refreshAccess) reads.push(api.get('auth/me'), api.get('projects/' + encodeURIComponent(projectId)), api.get(base('members')));
      const results = await Promise.all(reads);
      if (!stillCurrent() || accessToken !== accessGeneration) return;
      const value = results[0];
      if (refreshAccess) { actor = results[1]; projectArchived = results[2].status === 'ARCHIVED'; projectMembers = results[3]; }
      closureEligibility = value; closureLoading = false;
      renderClosure(); renderActions(current.defect); recoverStoredOperation(); openRetestHandoff();
    } catch (error) {
      if (!stillCurrent()) return;
      closureLoading = false; closureEligibility = null; closureFailure = error;
      renderClosure(); renderActions(current.defect);
      if (retestHandoff) { retestHandoff = null; retestHandoffUnavailable(); }
    }
  }
  function renderClosure() {
    if (!detail) return;
    captureRetestDraft();
    const target = $('#defect-closure').empty();
    if (!['RESOLVED', 'CLOSED'].includes(detail.defect.status)) {
      target.append($('<p class="small text-secondary">').text(t('defects.retestAfterResolution', null, 'Record the fix first. Retest and closure actions will appear when the defect is resolved.')),
        $('<div class="mt-3" role="status">').attr('id', 'defect-operation-status'));
      renderOperationRecovery(); return;
    }
    if (closureLoading || !closureEligibility) {
      if (closureLoading) target.text(t('defects.checkingEligibility', null, 'Checking closure eligibility…'));
      else if (closureFailure) {
        const owner = detail, token = generation, request = closureGeneration;
        target.append($('<p class="text-danger" role="status">').text(t('defects.eligibilityUnavailable', null, 'Closure eligibility is unavailable. No close permission can be inferred.')),
          $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('common.retry', null, 'Retry')).on('click', function () {
            if (valid(token) && detail === owner && request === closureGeneration && !closureLoading && !mutating) return loadEligibility(owner, token, closureNeedsAccessRefresh);
          }));
      }
      target.append($('<div class="mt-3" role="status">').attr('id', 'defect-operation-status')); renderOperationRecovery(); return;
    }
    const eligibility = closureEligibility;
    const versionChanged = eligibility.defectVersion !== detail.defect.version;
    const readyToClose = eligibility.canClose && !versionChanged && !!canManage();
    if (versionChanged) target.append($('<p class="small text-danger">').text(t('defects.eligibilityVersionChanged', null, 'The defect changed while evidence was loading. Reload the latest detail before making changes.')),
      $('<button type="button" class="btn btn-outline-secondary btn-sm mb-2">').text(t('defects.reviewLatest', null, 'Review latest details')).prop('disabled', mutating).on('click', function () { if (!mutating) return openDetail(detail.defect.id); }));
    target.append($('<p class="fw-semibold">').text(detail.defect.status === 'CLOSED' ? t('defects.closedEvidenceHistory', null, 'This defect is closed. The receipt records the evidence accepted then; current results may differ without changing that decision.') : readyToClose ? t('defects.readyToClose', null, 'Every retained FAIL has a valid current PASS. Closing will verify this again.') : t('defects.closureBlocked', null, 'Closure is currently blocked.')));
    const conditions = $('<div>');
    if (detail.defect.status !== 'CLOSED') (eligibility.reasons || []).forEach(function (code) { conditions.append($('<p class="small text-secondary">').text(reasonText(code))); });
    const members = detailMemberState();
    if (!canManage() && !(members && (members.loading || members.failed)) && detail.defect.status !== 'CLOSED') conditions.append($('<p class="small text-secondary">').text(t('defects.retestPermission', null, 'An active project Tester or platform Admin must review retest evidence and close the defect.')));
    if (detail.defect.status === 'RESOLVED' && !versionChanged && canManage()) conditions.append($('<p class="small">').text(readyToClose
      ? t('defects.resolvedReadyToClose', null, 'Retest evidence is complete. Next, close the defect; the server will verify eligibility again when you submit.')
      : t('defects.resolvedNextStep', null, 'Next: perform the retest, link its PASS for each original FAIL, check eligibility, then close the defect.')));
    if (detail.defect.status !== 'CLOSED') target.append(disclosure('closure-conditions', t('defects.closureConditions', null, 'Closure condition details'), conditions));
    (eligibility.failures || []).forEach(function (failure) {
      const source = failure.source, id = String(source.attempt.id);
      const card = $('<div class="execution-attempt mt-3">').attr('id', 'defect-closure-failure-' + id).append(
        $('<div class="asset-panel-heading">').append($('<strong>').text(executionTitle(source)), badge(failure.eligible ? 'PASS' : 'BLOCKED')),
        $('<p class="small mb-1">').text(t('defects.originalFailure', null, 'Original FAIL — retained in its original Run and snapshot.')),
        executionSummary(source));
      if (detail.defect.status === 'CLOSED') card.append($('<p class="small text-secondary">').text(t('defects.currentEvidenceCheck', null, 'Current evidence check; the historical closure receipt remains unchanged.')));
      (failure.reasons || []).forEach(function (code) { card.append($('<p class="small text-danger mb-1">').text(reasonText(code))); });
      if (failure.selectedPass) {
        card.append($('<p class="fw-semibold small mt-2 mb-1">').text(t('defects.selectedRetest', null, 'Selected retest PASS')), executionSummary(failure.selectedPass));
        if (failure.selection) card.append($('<p class="small">').text(t('defects.reviewedSelection', { note: failure.selection.reviewNote, basis: timingText(failure.selection.timingBasis), time: date(failure.selection.linkedAt) }, 'Reviewed {time} · {basis} · {note}')));
        else card.append($('<p class="small">').text(t('defects.sameRunAutomatic', null, 'A later current PASS on the original Run Case satisfies the existing same-run rule.')));
      }
      if (canManage() && detail.defect.status !== 'CLOSED') {
        if (failure.currentCaseCompatible && source.currentCase && source.currentCase.status === 'READY') card.append(routeLink(t('defects.retestInNewRun', null, 'Retest in a new run'), 'runs', {
          action: 'create', sourceTestCaseId: String(source.currentCase.id), runId: String(source.run.id), runCaseId: String(source.runCase.id), failureAttemptId: id, defectId: String(detail.defect.id)
        }).addClass('mt-2'));
        else {
          card.append($('<p class="small text-secondary mt-2">').text(source.currentCase && source.currentCase.status !== 'READY' ? t('defects.currentCaseNotReady', null, 'The current Test Case must be READY before creating a new retest run.') : t('defects.currentDefinitionChanged', null, 'The current Test Case definition differs from this frozen failure. A new run from it cannot be used to close this failure.')));
          if (source.currentCase && !failure.currentCaseCompatible) {
            const differences = ['title', 'description', 'preconditions'].filter(function (name) { return source.currentCase[name] !== source.runCase['snapshot' + name[0].toUpperCase() + name.slice(1)]; });
            (differences.length ? differences.map(function (name) { return t('execution.' + name, null, name); }) : [t('defects.orderedSteps', null, 'ordered steps')])
              .forEach(function (name) { card.append($('<p class="small text-danger">').text(t('defects.definitionDifference', { field: name }, 'Frozen definition differs: {field}'))); });
          }
          if (source.currentCase) card.append(routeLink(t('defects.openCurrentCase', null, 'Open current test case'), 'test-cases',
            { testCaseId: String(source.currentCase.id), runId: String(source.run.id), runCaseId: String(source.runCase.id), defectId: String(detail.defect.id) }).addClass('mt-2'));
        }
        if (failure.canRetestOriginal) card.append(routeLink(t('defects.goRetest', null, 'Go to retest'), 'runs', executionContext(source)).addClass('mt-2 ms-2'));
        card.append($('<button type="button" class="btn btn-outline-primary btn-sm mt-2 ms-2">').text(t('defects.findRetestPass', null, 'Find retest PASS'))
          .prop('disabled', mutating || !!retestPending).on('click', function () { if (!mutating && !retestPending) return loadCandidates(failure); }));
        if (failure.selection && !failure.selection.revocation) card.append($('<button type="button" class="btn btn-outline-danger btn-sm mt-2 ms-2 defect-retest-open">').text(t('defects.revokeRetest', null, 'Revoke selected PASS'))
          .prop('disabled', mutating || !!retestPending || editorActive()).on('click', function () { if (!mutating && !retestPending) showRetestEditor(failure, null, 'REVOKE'); }));
      }
      card.append($('<div class="mt-3">').attr('id', 'defect-candidates-' + id)); target.append(card);
      renderCandidates(failure);
    });
    if (eligibility.legacyClosed) target.append($('<p class="small text-secondary">').text(t('defects.legacyClosure', null, 'Legacy closure used the earlier same-run rule. No immutable closure receipt was saved.')));
    const closureHistory = $('<div>');
    (eligibility.history || []).forEach(function (history) {
      const receipt = history.receipt;
      const card = $('<div class="execution-attempt mt-3">').append($('<h4 class="fs-6">').text(t('defects.closureReceipt', { time: date(receipt.closedAt) }, 'Closure receipt · {time}')),
        $('<p class="small">').text(t('defects.receiptFacts', { version: receipt.closedDefectVersion, count: receipt.evidenceCount, note: receipt.resolutionNote }, 'Closed at version {version} · {count} original FAIL(s) · {note}')),
        $('<p class="small text-secondary">').text(t('defects.immutableReceipt', null, 'These are the facts accepted at closure. Later results do not change this receipt.')));
      (history.items || []).forEach(function (item) { card.append($('<p class="fw-semibold small mt-2">').text(t('defects.receiptPair', { failure: executionTitle(item.failure), pass: executionTitle(item.pass) }, '{failure} → {pass}')),
        $('<p class="small text-secondary">').text(item.policy === 'SAME_RUN_CASE_V1' ? t('defects.receiptSameRunPolicy', null, 'Accepted under the later current PASS on the original Run Case rule.') : t('defects.receiptExplicitPolicy', null, 'Accepted through the explicit PASS relationship and exact frozen-definition compatibility rule.')),
        routeLink(t('defects.viewOriginalFail', null, 'View original FAIL'), 'runs', executionContext(item.failure)),
        routeLink(t('defects.viewAcceptedPass', null, 'View accepted PASS'), 'runs', executionContext(item.pass)).addClass('ms-2'));
      });
      closureHistory.append(card);
    });
    if ((eligibility.history || []).length) target.append(disclosure('closure-history', t('defects.closureHistory', { count: eligibility.history.length }, 'Closure history ({count})'), closureHistory));
    target.append($('<div class="mt-3">').attr('id', 'defect-retest-editor'), $('<div class="mt-3" role="status">').attr('id', 'defect-operation-status'));
    renderRetestEditor(); renderOperationRecovery();
  }
  function timingText(basis) { return t(basis === 'IMPORT_REVIEW_ATTESTATION' ? 'defects.importAttestation' : 'defects.manualTiming', null, basis === 'IMPORT_REVIEW_ATTESTATION' ? 'Operator attestation of external execution timing' : 'Manual server-recorded execution timing'); }
  const maxAttemptId = 9223372036854775807n;
  function retestHandoffFromRoute(context) {
    const ids = [context.failureAttemptId, context.retestRunId, context.retestRunCaseId, context.retestPassAttemptId].map(String);
    if (!ids.every(function (id) { return /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= maxAttemptId; })) return null;
    return { failureAttemptId: ids[0], runId: ids[1], runCaseId: ids[2], passAttemptId: ids[3] };
  }
  function retestHandoffUnavailable(reason) {
    const message = t('defects.retestHandoffUnavailable', null, 'This retest PASS could not be used. Review the latest defect and available retest evidence.');
    actionStatus(reason ? message + ' ' + reasonText(reason) : message, true);
  }
  async function openRetestHandoff() {
    if (!retestHandoff || !detail || closureLoading || !actor) return;
    const memberState = detailMemberState();
    if (!canManage() && memberState && memberState.loading) return;
    const handoff = retestHandoff;
    retestHandoff = null;
    if (mutating || retestPending || editorActive()) return;
    const current = detail, eligibility = closureEligibility;
    if (!canManage() || current.defect.status !== 'RESOLVED' || !eligibility || eligibility.defectVersion !== current.defect.version) {
      retestHandoffUnavailable();
      return;
    }
    const failure = (eligibility.failures || []).find(function (row) { return sameId(row.source.attempt.id, handoff.failureAttemptId); });
    if (!failure || failure.source.attempt.status !== 'FAIL') { retestHandoffUnavailable(); return; }
    const selected = failure.selection && !failure.selection.revocation && sameId(failure.selection.passAttemptId, handoff.passAttemptId);
    const accepted = failure.eligible && failure.selectedPass && sameId(failure.selectedPass.attempt.id, handoff.passAttemptId);
    if (selected || accepted) {
      actionStatus(t('defects.retestHandoffAlreadyLinked', null, 'This PASS is already selected or satisfies the current retest rule. Review closure eligibility.'));
      return;
    }
    const token = generation, actorId = actor.id;
    const stillCurrent = function () {
      return valid(token) && detail === current && closureEligibility === eligibility && sameId(actor && actor.id, actorId)
        && canManage() && !mutating && !retestPending && !editorActive();
    };
    // Candidate pages are descending by attempt ID and the cursor is exclusive.
    const passId = BigInt(handoff.passAttemptId);
    const cursor = passId === maxAttemptId ? '' : '&cursor=' + String(passId + 1n);
    actionStatus(t('defects.retestHandoffChecking', null, 'Checking this retest PASS…'));
    try {
      const response = await api.get(defectPath(current.defect.id) + '/retest-candidates?failureAttemptId=' + handoff.failureAttemptId + '&pageSize=1' + cursor);
      if (!stillCurrent()) return;
      const candidate = response && sameId(response.failureAttemptId, handoff.failureAttemptId) && (response.candidates || [])[0];
      const execution = candidate && candidate.execution;
      const matches = execution && sameId(execution.run.id, handoff.runId) && sameId(execution.runCase.id, handoff.runCaseId)
        && sameId(execution.attempt.id, handoff.passAttemptId) && execution.attempt.status === 'PASS';
      if (!matches || candidate.eligible !== true) {
        retestHandoffUnavailable(matches && candidate.reasons && candidate.reasons[0]);
        return;
      }
      actionStatus('');
      showRetestEditor(failure, candidate, 'LINK');
    } catch (error) { if (stillCurrent()) retestHandoffUnavailable(); }
  }
  async function loadCandidates(failure, cursor) {
    const token = generation, id = String(failure.source.attempt.id), previous = candidatePages.get(id);
    const state = { rows: cursor && previous ? previous.rows.slice() : [], loading: true, nextCursor: null };
    candidatePages.set(id, state); renderCandidates(failure);
    try {
      const response = await api.get(defectPath(detail.defect.id) + '/retest-candidates?failureAttemptId=' + encodeURIComponent(id) + '&pageSize=25' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (!valid(token) || candidatePages.get(id) !== state) return;
      state.rows = state.rows.concat(response.candidates); state.nextCursor = response.nextCursor; state.loading = false; renderCandidates(failure);
    } catch (error) { if (valid(token) && candidatePages.get(id) === state) { state.loading = false; state.error = error; renderCandidates(failure); } }
  }
  function renderCandidates(failure) {
    const state = candidatePages.get(String(failure.source.attempt.id));
    if (!state) return;
    const target = $('#defect-candidates-' + failure.source.attempt.id).empty();
    if (state.loading) target.append($('<p class="small" role="status">').text(t('defects.loadingCandidates', null, 'Loading retest PASS candidates…')));
    if (state.error) target.append($('<p class="small text-danger">').text(state.error.message), $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('common.retry', null, 'Retry')).on('click', function () { if (!mutating) return loadCandidates(failure); }));
    if (!state.loading && !state.error && !state.rows.length) target.append($('<p class="small">').text(t('defects.noCandidates', null, 'No PASS candidates are available for this Test Case. Perform a retest first.')));
    state.rows.forEach(function (candidate) {
      const selected = !!failure.selection && sameId(failure.selection.passAttemptId, candidate.execution.attempt.id);
      const card = $('<div class="border rounded p-3 mb-2">').append(executionSummary(candidate.execution));
      (candidate.reasons || []).forEach(function (code) { card.append($('<p class="small text-danger mb-1">').text(reasonText(code))); });
      semanticDifferences(failure.source, candidate.execution).forEach(function (name) { card.append($('<p class="small text-danger">').text(t('defects.definitionDifference', { field: name }, 'Frozen definition differs: {field}'))); });
      if (failure.source.runCase.snapshotPriority !== candidate.execution.runCase.snapshotPriority) card.append($('<p class="small text-secondary">').text(t('defects.priorityDifference', null, 'Priority differs; priority is not part of semantic compatibility.')));
      if (candidate.requiresImportConfirmation) card.append($('<p class="small text-secondary">').text(t('defects.importReviewRequired', null, 'Confirm that the external test actually ran after the failure. Upload time alone does not prove this.')));
      card.append($('<button type="button" class="btn btn-outline-primary btn-sm mt-2">').text(selected ? t('defects.alreadySelected', null, 'Currently selected') : t('defects.useThisPass', null, 'Use this PASS'))
        .toggleClass('defect-retest-open', candidate.eligible && !selected)
        .prop('disabled', mutating || !!retestPending || editorActive() || !candidate.eligible || selected).on('click', function () { if (!mutating && !retestPending && candidate.eligible && !selected) showRetestEditor(failure, candidate, 'LINK'); }));
      target.append(card);
    });
    if (state.nextCursor && !state.loading) target.append($('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('defects.moreCandidates', null, 'Load more PASS candidates')).prop('disabled', mutating).on('click', function () { if (!mutating) return loadCandidates(failure, state.nextCursor); }));
  }
  function semanticDifferences(left, right) {
    const fields = [];
    ['Title', 'Description', 'Preconditions'].forEach(function (name) { if (left.runCase['snapshot' + name] !== right.runCase['snapshot' + name]) fields.push(t('execution.' + name.toLowerCase(), null, name)); });
    const steps = function (execution) { return (execution.steps || []).slice().sort(function (a, b) { return a.stepOrder - b.stepOrder; }).map(function (row) { return [row.stepOrder, row.action, row.expectedResult]; }); };
    if (JSON.stringify(steps(left)) !== JSON.stringify(steps(right))) fields.push(t('defects.orderedSteps', null, 'ordered steps'));
    return fields;
  }
  function captureRetestDraft() {
    if (!retestEditor || !$('#defect-retest-form').length) return;
    retestEditor.note = String($('#defect-retest-note').val() || '');
    retestEditor.reason = String($('#defect-retest-reason').val() || '');
    retestEditor.confirmed = !!$('#defect-retest-confirm').prop('checked');
  }
  function showRetestEditor(failure, candidate, mode) {
    if (editorActive()) return;
    retestEditor = { failure: failure, candidate: candidate, mode: mode, note: '', reason: '', confirmed: false };
    renderActions(detail.defect);
    renderRetestEditor(); $('#defect-retest-' + (mode === 'REVOKE' ? 'reason' : 'note')).trigger('focus');
  }
  function renderRetestEditor() {
    const target = $('#defect-retest-editor').empty();
    if (!retestEditor || !canManage() || detail.defect.status === 'CLOSED') return;
    const editor = retestEditor, token = generation, replacing = editor.mode === 'LINK' && editor.failure.selection && !editor.failure.selection.revocation;
    const form = $('<form class="border rounded p-3" novalidate>').attr('id', 'defect-retest-form');
    form.append($('<h4 class="fs-6">').text(editor.mode === 'REVOKE' ? t('defects.revokeRetest', null, 'Revoke selected PASS') : replacing ? t('defects.replaceRetest', null, 'Replace selected retest PASS') : t('defects.linkRetest', null, 'Link retest PASS')),
      $('<p class="small">').text(executionTitle(editor.failure.source) + (editor.candidate ? ' → ' + executionTitle(editor.candidate.execution) : '')));
    if (editor.mode === 'LINK') {
      form.append($('<p class="small text-secondary">').text(editor.candidate.requiresImportConfirmation ? t('defects.importReviewRequired', null, 'Confirm that the external test actually ran after the failure. Upload time alone does not prove this.') : t('defects.retestReviewHelp', null, 'Explain why this actual PASS is the subsequent retest of the original failure. Frozen semantic compatibility cannot be overridden.')),
        $('<label class="form-label">').attr('for', 'defect-retest-note').text(t('defects.reviewNote', null, 'Retest review note')),
        $('<textarea class="form-control mb-3" rows="3" maxlength="2000">').attr('id', 'defect-retest-note').val(editor.note),
        $('<div class="form-check mb-3">').append($('<input type="checkbox" class="form-check-input">').attr('id', 'defect-retest-confirm').prop('checked', editor.confirmed),
          $('<label class="form-check-label">').attr('for', 'defect-retest-confirm').text(t('defects.confirmRetestTiming', null, 'I confirm this test actually ran after the original failure and is its retest.'))));
    }
    if (editor.mode === 'REVOKE' || replacing) form.append($('<label class="form-label">').attr('for', 'defect-retest-reason').text(t('defects.revocationReason', null, 'Reason for revoking the prior selection')),
      $('<textarea class="form-control mb-3" rows="2" maxlength="2000">').attr('id', 'defect-retest-reason').val(editor.reason),
      $('<p class="small text-secondary">').text(t('defects.revocationHistory', null, 'The prior relationship stays in history. Revocation cannot erase it; a later selection creates a new relationship.')));
    form.append($('<button type="submit" class="btn btn-primary">').text(editor.mode === 'REVOKE' ? t('defects.confirmRevocation', null, 'Confirm revocation') : t('defects.confirmRetestLink', null, 'Confirm retest link')).prop('disabled', mutating || !!retestPending),
      $('<button type="button" class="btn btn-outline-secondary ms-2">').text(t('common.cancel', null, 'Cancel')).prop('disabled', mutating).on('click', function () { retestEditor = null; renderRetestEditor(); renderActions(detail.defect); focusHeading('#defect-closure-heading'); }));
    form.on('submit', async function (event) {
      event.preventDefault();
      if (!valid(token) || mutating || retestPending || retestEditor !== editor || !canManage()) return;
      captureRetestDraft();
      if (editor.mode === 'LINK' && (!editor.note.trim() || !editor.confirmed)) { actionStatus(t('defects.reviewRequired', null, 'Add a review note and confirm actual retest timing.'), true); return; }
      if ((editor.mode === 'REVOKE' || replacing) && !editor.reason.trim()) { actionStatus(t('defects.reasonRequired', null, 'Add the reason for revoking the prior selection.'), true); return; }
      const key = crypto.randomUUID();
      const body = editor.mode === 'REVOKE' ? { expectedVersion: detail.defect.version, requestKey: key, reason: editor.reason.trim() }
        : { failureAttemptId: editor.failure.source.attempt.id, passAttemptId: editor.candidate.execution.attempt.id, expectedVersion: detail.defect.version,
          requestKey: key, reviewNote: editor.note.trim(), timingBasis: editor.candidate.execution.attempt.importId == null ? 'MANUAL_SERVER_RECORD' : 'IMPORT_REVIEW_ATTESTATION' };
      if (replacing) { body.oldLinkId = editor.failure.selection.id; body.revokeReason = editor.reason.trim(); }
      const operation = { action: editor.mode, requestKey: key, body: body, path: defectPath(detail.defect.id) + (editor.mode === 'REVOKE' ? '/retests/' + editor.failure.selection.id + '/revoke' : '/retests'), defectId: String(detail.defect.id), projectId: projectId, actorId: String(actor.id) };
      retestPending = operation; persistOperation(operation); await submitRetestOperation(operation, token);
    });
    target.append(form);
  }
  function operationStorageKey(operation) { return operation ? 'veriqra.r1.retest.' + operation.projectId + '.' + operation.defectId + '.' + operation.actorId
    : actor && detail ? 'veriqra.r1.retest.' + projectId + '.' + detail.defect.id + '.' + actor.id : null; }
  function persistOperation(operation) {
    const key = operationStorageKey(operation || retestPending);
    if (!key) return;
    try { if (operation) window.localStorage.setItem(key, JSON.stringify(operation)); else window.localStorage.removeItem(key); } catch (error) { /* In-memory recovery still uses the original key and exact payload. */ }
  }
  function recoverStoredOperation() {
    if (!detail || !actor || !closureEligibility || retestPending) return;
    try {
      const raw = window.localStorage.getItem(operationStorageKey());
      if (!raw) return;
      const operation = JSON.parse(raw);
      if (!sameId(operation.projectId, projectId) || !sameId(operation.defectId, detail.defect.id) || !sameId(operation.actorId, actor.id) || !['LINK', 'REVOKE', 'CLOSE'].includes(operation.action)) return;
      if (!operation.body || !Number.isSafeInteger(operation.body.expectedVersion) || operation.body.expectedVersion < 0) return;
      if (operation.action !== 'CLOSE') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.requestKey) || operation.body.requestKey !== operation.requestKey) return;
        const root = defectPath(detail.defect.id);
        if (operation.action === 'LINK' ? operation.path !== root + '/retests' : !operation.path.startsWith(root + '/retests/') || !/\/retests\/[1-9][0-9]*\/revoke$/.test(operation.path)) return;
      }
      retestPending = operation; renderOperationRecovery(); renderActions(detail.defect); recoverOperation(operation, generation);
    } catch (error) { /* Invalid browser state never authorizes a mutation. */ }
  }
  async function submitRetestOperation(operation, token) {
    if (!valid(token) || retestPending !== operation) return;
    operation.checking = false; operation.notFound = false; operation.submitting = true;
    mutationState(true); actionStatus(''); renderOperationRecovery();
    try {
      await api.post(operation.path, operation.body);
      if (!valid(token) || retestPending !== operation) return;
      persistOperation(null); retestPending = null;
      await openDetail(operation.defectId, t('defects.retestSaved', null, 'Retest selection saved. Eligibility has been rechecked.'));
    } catch (error) {
      if (!valid(token) || retestPending !== operation) return;
      if ([400, 403, 404, 409].includes(error.status) && error.reasonCode !== 'CONCURRENT_CHANGE') { persistOperation(null); retestPending = null; }
      actionStatus(function () { return error.reasonCode ? reasonText(error.reasonCode) : conflict(error); }, true);
      if (retestPending) { operation.submitting = false; operation.failed = true; operation.rolledBack = error.reasonCode === 'CONCURRENT_CHANGE'; persistOperation(operation); renderOperationRecovery(); }
    } finally { operation.submitting = false; if (valid(token)) { mutationState(false); renderActions(detail.defect); renderRetestEditor(); } }
  }
  async function recoverOperation(operation, token) {
    if (!valid(token) || retestPending !== operation || operation.checking) return;
    operation.checking = true; operation.notFound = false; renderOperationRecovery();
    try {
      const result = await api.get(operation.action === 'CLOSE' ? defectPath(operation.defectId) + '/closure-eligibility'
        : defectPath(operation.defectId) + '/retest-operations/' + encodeURIComponent(operation.requestKey) + '?action=' + operation.action);
      if (!valid(token) || retestPending !== operation) return;
      if (operation.action === 'CLOSE' && result.defect.status !== 'CLOSED') {
        operation.reviewed = true; actionStatus(function () { return t('defects.closeNotConfirmed', null, 'Closure is not confirmed by the current record. Review the latest detail before another close request.'); }, true);
      } else {
        persistOperation(null); retestPending = null;
        await openDetail(operation.defectId, t('defects.operationRecovered', null, 'The submitted operation was found. Its result is shown below.'));
      }
    } catch (error) {
      if (!valid(token) || retestPending !== operation) return;
      operation.notFound = error.status === 404 && operation.action !== 'CLOSE';
      operation.failed = true;
      actionStatus(function () { return operation.notFound ? t('defects.operationNotFound', null, 'No committed operation was found. You may replay the original request with the same key and unchanged payload.') : error.reasonCode ? reasonText(error.reasonCode) : error.message; }, true);
    } finally { if (valid(token) && retestPending === operation) { operation.checking = false; renderOperationRecovery(); } }
  }
  function renderOperationRecovery() {
    const target = $('#defect-operation-status').empty();
    if (!retestPending) return;
    const operation = retestPending, token = generation;
    if (operation.submitting) { target.append($('<p class="small" role="status">').text(t('defects.savingOperation', null, 'Saving the result…'))); return; }
    target.append($('<p class="small fw-semibold">').text(operation.checking ? t('defects.checkingOperation', null, 'Checking the submitted operation…') : operation.rolledBack ? reasonText('CONCURRENT_CHANGE') : t('defects.uncertainOperation', null, 'A submitted operation has an uncertain response. Check its result before starting another operation.')),
      $('<button type="button" class="btn btn-outline-primary btn-sm">').text(t('defects.checkOperation', null, 'Check submitted operation')).prop('disabled', mutating || !!operation.checking).on('click', function () { return recoverOperation(operation, token); }));
    if (operation.notFound && operation.action !== 'CLOSE') target.append($('<button type="button" class="btn btn-outline-primary btn-sm ms-2">').text(t('defects.replayOperation', null, 'Replay original request')).prop('disabled', mutating || !!operation.checking).on('click', function () { return submitRetestOperation(operation, token); }));
    if (operation.reviewed && operation.action === 'CLOSE') target.append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">').text(t('defects.reviewLatest', null, 'Review latest details')).on('click', function () {
      if (!valid(token) || mutating || retestPending !== operation) return;
      persistOperation(null); retestPending = null; return openDetail(operation.defectId);
    }));
  }
  function pickerValid(prefix, token, pickerToken) {
    return valid(token) && pickerGeneration[prefix] === pickerToken;
  }
  function option(value, text) { return $('<option>').val(String(value)).text(text); }
  function pickerError(prefix, message) { formError(prefix === 'defect-create' ? '#defect-create-error' : '#defect-action-error', message); }
  function clearPickerFailures(prefix, fields) {
    (fields || ['run', 'case', 'attempt', 'target']).forEach(function (field) {
      $('#' + prefix + '-' + field + '-retry').remove(); delete pickerFailures[prefix][field];
    });
  }
  function pickerReadFailed(prefix, field, error, retry, current) {
    if (!current()) return;
    pickerFailures[prefix][field] = error;
    const select = $('#' + prefix + '-' + field);
    select.empty().append(option('', t('common.unavailable', null, 'Unavailable'))).prop('disabled', true);
    pickerError(prefix, error.message);
    select.after($('<button type="button" class="btn btn-outline-secondary btn-sm mt-2">')
      .attr('id', prefix + '-' + field + '-retry').text(t('common.retry', null, 'Retry')).on('click', function () {
        if (!current() || mutating) return;
        pickerError(prefix, ''); return retry();
      }));
    updatePickerSubmit(prefix);
  }
  function sourceUnavailable(prefix) { pickerError(prefix, t('defects.sourceUnavailable', null, 'The source Run, Run Case, or FAIL attempt is no longer available. Select existing evidence.')); }
  function updatePickerSubmit(prefix) {
    const ready = !!selectedFailure(prefix);
    const members = memberPickers[prefix];
    const membersRequired = prefix === 'defect-create' ? createMode !== 'link' : ['edit', 'reopen'].includes(actionMode);
    const membersUnavailable = membersRequired && (!members || members.loading || members.failed);
    if (prefix === 'defect-create') $('#defect-create-submit').prop('disabled', mutating || !ready || membersUnavailable || (createMode === 'link' && !linkableDefects.some(function (item) { return sameId(item.id, $('#defect-create-target').val()); })));
    else $('#defect-action-submit').prop('disabled', mutating || membersUnavailable || (actionMode === 'reopen' && !assignee('#defect-action-assignee', true)) || (actionMode === 'edit' && editBlocked) || (!['resolve', 'edit'].includes(actionMode) && !ready));
  }
  function renderCreateContext(sync) {
    const context = failureContext('defect-create');
    if (sync !== false) selectContext(Object.assign({}, routeContext, context, { action: createMode, failureAttemptId: context.attemptId || undefined }));
    const target = $('#defect-create-context').empty();
    const data = pickerData['defect-create'];
    if (data.run && sameId(data.run.id, context.runId)) target.append(sourceContext(data.run));
    if (createMode !== 'link' && selectedFailure('defect-create')) {
      populateFailureDraft();
      target.append($('<p class="small text-secondary mb-2">').text(t('zentaoDefects.draftHint', null, 'Title and description are prepared from this frozen failure. Review or edit them before saving. Your edits are retained when the source changes.')));
    }
    if (context.runId && context.runCaseId && context.attemptId) target.append(routeLink(t('defects.openSourceAttempt', null, 'Open source attempt'), 'runs', context));
  }
  function sourceContext(run) {
    return $('<dl class="workflow-context-strip">').append(field(t('defects.run', null, 'Run'), run.name),
      field(t('zentaoDefects.testedBuild', null, 'Tested build'), run.buildVersion),
      field(t('zentaoDefects.environment', null, 'Environment'), run.environment));
  }
  function boundedDraftText(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, '').trimEnd() : '';
  }
  function stageAiDraft(value) {
    pendingAiDraft = null;
    if (!value || !sameId(value.projectId, projectId) || projectArchived) return;
    const ids = [value.projectId, value.runId, value.runCaseId, value.attemptId].map(String);
    if (!ids.every(function (id) { return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)); })) return;
    const draftTitle = boundedDraftText(value.draftTitle, 240);
    // Reserve room below the TEXT column limit for AI wording without trimming frozen evidence further.
    const suggestion = boundedDraftText(value.suggestion, 1200);
    if (!draftTitle && !suggestion) return;
    const draft = { projectId: ids[0], runId: ids[1], runCaseId: ids[2], attemptId: ids[3], draftTitle: draftTitle, suggestion: suggestion };
    pendingAiDraft = draft;
    const discard = function () { if (pendingAiDraft === draft) pendingAiDraft = null; };
    // A same-project navigation dispatches its view event synchronously.
    Promise.resolve().then(discard);
    return discard;
  }
  function matchesAiDraft(draft, source) {
    return draft && source && sameId(draft.projectId, source.projectId) && sameId(draft.runId, source.runId)
      && sameId(draft.runCaseId, source.runCaseId) && sameId(draft.attemptId, source.attemptId || source.failureAttemptId);
  }
  function takeAiDraft(next, context) {
    const draft = pendingAiDraft;
    pendingAiDraft = null;
    return next === 'defects' && context && context.action === 'create' && !context.defectId && matchesAiDraft(draft, context) ? draft : null;
  }
  function discardAiOnSourceChange() {
    if (!generatedDraft || !generatedDraft.ai || matchesAiDraft(generatedDraft.ai, Object.assign({ projectId: projectId }, failureContext('defect-create')))) return;
    generatedDraft.ai = null;
    ['title', 'description'].forEach(function (name) {
      const field = $('#defect-create-' + name);
      if (!generatedDraft.edited[name] && field.val() === generatedDraft[name]) field.val('');
      generatedDraft[name] = null;
    });
  }
  function populateFailureDraft() {
    if (!generatedDraft || createMode === 'link') return;
    const data = pickerData['defect-create'], selected = selectedFailure('defect-create');
    const runCase = (data.cases || []).find(function (row) { return sameId(row.runCaseId, $('#defect-create-case').val()); });
    const attempt = (data.attempts || []).find(function (row) { return sameId(row.id, selected); });
    if (!runCase || !attempt || !data.run || !sameId(data.run.id, data.runId)) return;
    const missing = t('zentaoDefects.notRecorded', null, 'Not recorded');
    const actual = [attempt.failureMessage, attempt.comment].filter(function (value, index, values) { return value && values.indexOf(value) === index; }).join('\n') || missing;
    const title = (runCase.snapshotTitle + ' — ' + (attempt.failureMessage || attempt.comment || t('zentaoDefects.failed', null, 'Test failed')).split(/\r?\n/)[0]).slice(0, 240).replace(/[\uD800-\uDBFF]$/, '');
    const sections = [t('defects.run', null, 'Run') + ': ' + data.run.name,
      t('zentaoDefects.testedBuild', null, 'Tested build') + ': ' + (data.run.buildVersion || missing),
      t('zentaoDefects.environment', null, 'Environment') + ': ' + (data.run.environment || missing),
      t('defects.runCaseSnapshot', null, 'Run Case snapshot') + ': ' + runCase.snapshotTitle,
      t('defects.linkedFailAttempt', { number: attempt.attemptNo, id: attempt.id }, 'Linked FAIL attempt #{number} · ID {id}'),
      t('zentaoDefects.actual', null, 'Actual result') + ':\n' + actual];
    if (runCase.snapshotPreconditions) sections.push(t('zentaoDefects.preconditions', null, 'Preconditions') + ':\n' + runCase.snapshotPreconditions);
    const steps = (runCase.steps || []).map(function (step, index) {
      return (step.stepOrder || index + 1) + '. ' + step.action + '\n' + t('zentaoDefects.expected', null, 'Expected') + ': ' + step.expectedResult;
    });
    sections.push(t('zentaoDefects.reproduction', null, 'Reproduction steps') + ':\n' + (steps.join('\n\n') || missing));
    const proposed = { title: title, description: limitDraftDescription(sections.join('\n\n')) };
    const aiDraft = generatedDraft.ai;
    if (sameId(attempt.runCaseId, runCase.runCaseId) && matchesAiDraft(aiDraft, { projectId: projectId, runId: data.runId, runCaseId: runCase.runCaseId, attemptId: attempt.id })) {
      if (aiDraft.draftTitle) proposed.title = aiDraft.draftTitle;
      if (aiDraft.suggestion) proposed.description += '\n\n' + t('defects.aiDraftSuggestion', null, 'AI suggestion (review before saving)') + ':\n' + aiDraft.suggestion;
    }
    ['title', 'description'].forEach(function (name) {
      const field = $('#defect-create-' + name), previous = generatedDraft[name];
      if (!generatedDraft.edited[name] && (!field.val() || field.val() === previous)) { field.val(proposed[name]); generatedDraft[name] = proposed[name]; }
    });
  }
  function limitDraftDescription(value) {
    // A defect description is MySQL TEXT (65,535 UTF-8 bytes). Leave room for the source-reference note.
    let bytes = 0, result = '';
    for (const character of value) {
      const point = character.codePointAt(0), length = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes + length > 60000) return result + '\n\n' + t('zentaoDefects.detailsOmitted', null, 'Additional details omitted. Open the source attempt for the complete frozen evidence.');
      result += character; bytes += length;
    }
    return value;
  }
  async function loadRuns(prefix, prefill) {
    const token = generation, pickerToken = ++pickerGeneration[prefix];
    clearPickerFailures(prefix, ['run', 'case', 'attempt']);
    pickerData[prefix] = {};
    const run = $('#' + prefix + '-run').empty().append(option('', t('defects.loadingRuns', null, 'Loading runs…'))).prop('disabled', true);
    $('#' + prefix + '-case, #' + prefix + '-attempt').empty().prop('disabled', true);
    updatePickerSubmit(prefix);
    try {
      const rows = await api.get(base('runs'));
      if (!pickerValid(prefix, token, pickerToken)) return;
      pickerData[prefix].runs = rows;
      run.prop('disabled', !rows.length);
      run.empty().append(option('', rows.length ? t("defects.selectARun", null, 'Select a Run') : t('defects.noRuns', null, 'No Runs in this project.')));
      rows.forEach(function (item) { run.append(option(item.id, item.name + ' · #' + item.id)); });
      if (prefill && rows.some(function (item) { return sameId(item.id, prefill.runId); })) {
        run.val(String(prefill.runId)); await loadCases(prefix, prefill);
      } else if (prefill && prefill.runId) sourceUnavailable(prefix);
    } catch (error) { pickerReadFailed(prefix, 'run', error, function () { return loadRuns(prefix, prefill); }, function () { return pickerValid(prefix, token, pickerToken); }); }
  }
  async function loadCases(prefix, prefill) {
    const token = generation, pickerToken = ++pickerGeneration[prefix];
    clearPickerFailures(prefix, ['case', 'attempt']);
    const runId = $('#' + prefix + '-run').val();
    pickerData[prefix].cases = []; pickerData[prefix].attempts = []; pickerData[prefix].run = null;
    const select = $('#' + prefix + '-case').empty().append(option('', runId ? t('defects.loadingRunCases', null, 'Loading Run Cases…') : t("defects.selectARunFirst", null, 'Select a Run first'))).prop('disabled', true);
    $('#' + prefix + '-attempt').empty().prop('disabled', true);
    updatePickerSubmit(prefix);
    if (!runId) return;
    try {
      const result = await api.get(runPath(runId));
      if (!pickerValid(prefix, token, pickerToken)) return;
      pickerData[prefix].cases = result.cases;
      pickerData[prefix].run = result.run;
      select.prop('disabled', !result.cases.length);
      select.empty().append(option('', result.cases.length ? t("defects.selectARunCase", null, 'Select a Run Case') : t('defects.noRunCases', null, 'No Run Cases in this Run.')));
      result.cases.forEach(function (item) { select.append(option(item.runCaseId, item.snapshotTitle + ' · #' + item.runCaseId)); });
      if (prefill && result.cases.some(function (item) { return sameId(item.runCaseId, prefill.runCaseId); })) {
        select.val(String(prefill.runCaseId)); await loadAttempts(prefix, prefill);
      } else if (prefill && prefill.runCaseId) sourceUnavailable(prefix);
    } catch (error) { pickerReadFailed(prefix, 'case', error, function () { return loadCases(prefix, prefill); }, function () { return pickerValid(prefix, token, pickerToken); }); }
  }
  async function loadAttempts(prefix, prefill) {
    const token = generation, pickerToken = ++pickerGeneration[prefix];
    clearPickerFailures(prefix, ['attempt']);
    const runId = $('#' + prefix + '-run').val(), caseId = $('#' + prefix + '-case').val();
    pickerData[prefix].attempts = [];
    const select = $('#' + prefix + '-attempt').empty().append(option('', caseId ? t('defects.loadingFailAttempts', null, 'Loading FAIL attempts…') : t("defects.selectARunCaseFirst", null, 'Select a Run Case first'))).prop('disabled', true);
    updatePickerSubmit(prefix);
    if (!runId || !caseId) return;
    try {
      const history = await api.get(runPath(runId) + '/cases/' + encodeURIComponent(caseId) + '/attempts');
      if (!pickerValid(prefix, token, pickerToken)) return;
      const eligible = history.filter(function (item) { return item.outcome === 'FAIL' &&
        !(prefix === 'defect-action' && actionMode === 'reopen' && detail &&
          detail.evidence.some(function (link) { return sameId(link.attemptId, item.id); })); });
      pickerData[prefix].attempts = eligible;
      pickerData[prefix].runId = String(runId); pickerData[prefix].caseId = String(caseId);
      select.empty().append(option('', eligible.length ? t("defects.selectAFAILAttempt", null, 'Select a FAIL attempt') : t('defects.noFailAttempts', null, 'No eligible FAIL attempts on this Run Case.'))).prop('disabled', !eligible.length);
      eligible.forEach(function (item) {
        select.append(option(item.id, 'FAIL #' + item.attemptNo + ' · ' + date(item.executedAt) + ' · ID ' + item.id));
      });
      if (prefill && eligible.some(function (item) { return sameId(item.id, prefill.attemptId || prefill.failureAttemptId); })) select.val(String(prefill.attemptId || prefill.failureAttemptId));
      else if (prefill && (prefill.attemptId || prefill.failureAttemptId)) sourceUnavailable(prefix);
      updatePickerSubmit(prefix);
      if (prefix === 'defect-create') renderCreateContext();
    } catch (error) { pickerReadFailed(prefix, 'attempt', error, function () { return loadAttempts(prefix, prefill); }, function () { return pickerValid(prefix, token, pickerToken); }); }
  }
  function selectedFailure(prefix) {
    const id = Number($('#' + prefix + '-attempt').val());
    const data = pickerData[prefix];
    return Number.isSafeInteger(id) && id > 0 && sameId(data.runId, $('#' + prefix + '-run').val()) && sameId(data.caseId, $('#' + prefix + '-case').val()) &&
      (data.attempts || []).some(function (attempt) { return sameId(attempt.id, id); }) ? id : null;
  }
  function assignee(selector, required) {
    const raw = String($(selector).val() || '').trim();
    if (!raw && !required) return null;
    const id = Number(raw);
    const prefix = selector.replace(/^#/, '').replace(/-assignee$/, '');
    const state = memberPickers[prefix];
    return Number.isSafeInteger(id) && id > 0 && state && !state.loading && !state.failed &&
      (state.rows.some(function (row) { return sameId(row.userId, id); }) || state.allowRetained && sameId(state.retained, id)) ? id : null;
  }
  function memberName(row) { return (row.displayName || row.username) + (row.displayName && row.username ? ' (@' + row.username + ')' : '') + ' · ' + t('projectSettings.role.' + row.projectRole.toLowerCase(), null, label(row.projectRole)); }
  function projectUserName(id) {
    const row = projectMembers.find(function (member) { return sameId(member.userId, id); });
    if (!row && actor && sameId(actor.id, id) && (actor.displayName || actor.username)) return actor.displayName || actor.username;
    return row ? memberName(row) : t('defects.projectIdentityUnavailable', null, 'Identity unavailable in the current project members');
  }
  function assigneeName(id) {
    if (id == null) return t('defects.unassigned', null, 'Unassigned');
    const row = projectMembers.find(function (member) { return sameId(member.userId, id); });
    return row ? memberName(row) : t('defects.retainedAssignee', null, 'Current assignee (outside the available project members)');
  }
  function refreshMemberControls() {
    ['defect-create', 'defect-action'].forEach(function (prefix) {
      const state = memberPickers[prefix];
      $('#' + prefix + '-assignee, #' + prefix + '-assignee-search').prop('disabled', mutating || !state || state.loading || state.failed);
    });
  }
  function renderMembers(prefix) {
    const state = memberPickers[prefix];
    if (!state || prefix === 'defect-detail') return;
    let selected = state.rendered ? String($('#' + prefix + '-assignee').val() || '') : String(state.selected || '');
    if (!state.allowRetained && !state.rows.some(function (row) { return sameId(row.userId, selected); })) selected = '';
    const search = String($('#' + prefix + '-assignee-search').val() || '').toLocaleLowerCase();
    const select = $('#' + prefix + '-assignee').empty().append(option('', t('defects.unassigned', null, 'Unassigned')));
    state.rows.filter(function (row) { return sameId(row.userId, selected) || memberName(row).toLocaleLowerCase().includes(search); })
      .forEach(function (row) { select.append(option(row.userId, memberName(row))); });
    if (state.allowRetained && state.retained != null && !state.rows.some(function (row) { return sameId(row.userId, state.retained); }))
      select.append(option(state.retained, t('defects.currentAssigneeOption', { name: assigneeName(state.retained) }, 'Keep current assignee: {name} (not available for new assignment)')));
    select.val(selected);
    state.rendered = true;
    $('#' + prefix + '-assignee-status').text(state.loading ? t('defects.loadingMembers', null, 'Loading project members…') : state.failed
      ? t('defects.membersUnavailable', null, 'Project members are unavailable. Retry before changing the assignment.') : t('defects.memberChoiceHelp', null, 'Select an active project Developer by name. No one is assigned automatically.'));
    refreshMemberControls(); updatePickerSubmit(prefix);
  }
  async function loadMembers(prefix, retained) {
    const token = generation, accessToken = accessGeneration;
    const prior = memberPickers[prefix];
    const state = { rows: [], retained: retained, allowRetained: prefix === 'defect-action' && actionMode === 'edit', selected: prior ? String($('#' + prefix + '-assignee').val() || '') : retained == null ? '' : String(retained), loading: true, failed: false };
    state.generation = token; state.accessGeneration = accessToken; state.owner = detail;
    memberPickers[prefix] = state;
    $('#' + prefix + '-assignee-retry').remove();
    renderMembers(prefix);
    if (prefix === 'defect-detail' && detail) { renderActions(detail.defect); renderClosure(); }
    try {
      const rows = await api.get(base('members'));
      if (!valid(token) || accessToken !== accessGeneration || memberPickers[prefix] !== state) return;
      if (accessToken === accessGeneration) projectMembers = rows;
      state.rows = rows.filter(function (row) { return row.status === 'ACTIVE' && row.userStatus === 'ACTIVE' && row.projectRole === 'DEVELOPER'; });
      state.rendered = false;
      state.loading = false;
      renderMembers(prefix);
      if (detail) { renderDefect(detail.defect); renderActions(detail.defect); renderClosure(); if (evidenceValues) renderEvidence(detail); }
      if (prefix === 'defect-detail') openRetestHandoff();
    } catch (error) {
      if (!valid(token) || accessToken !== accessGeneration || memberPickers[prefix] !== state) return;
      state.loading = false; state.failed = true; renderMembers(prefix);
      if (prefix === 'defect-detail' && detail) { renderActions(detail.defect); renderClosure(); openRetestHandoff(); }
      if (prefix !== 'defect-detail') $('#' + prefix + '-assignee-status').append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">')
        .attr('id', prefix + '-assignee-retry').text(t('common.retry', null, 'Retry')).on('click', function () { if (valid(token) && !mutating && memberPickers[prefix] === state) return loadMembers(prefix, state.retained); }));
    }
  }
  function createLabels() {
    $('#defect-create-heading').text(createMode === 'link' ? t('defects.linkExisting', null, 'Link to existing defect') : t('shell.createDefect', null, 'Create defect'));
    $('#defect-create-submit').text(createMode === 'link' ? t('defects.linkExisting', null, 'Link to existing defect') : t('shell.createDefect', null, 'Create defect'));
    $('#defect-create-fields').toggleClass('d-none', createMode === 'link');
    $('#defect-create-fields input, #defect-create-fields select, #defect-create-fields textarea').prop('disabled', createMode === 'link');
    $('#defect-create-target-wrap').toggleClass('d-none', createMode !== 'link');
    $('#defect-create-target').prop('disabled', createMode !== 'link' || !linkableDefects.length);
  }
  async function loadLinkableDefects(token) {
    clearPickerFailures('defect-create', ['target']); linkableDefects = [];
    const target = $('#defect-create-target').empty().append(option('', t('defects.loadingDefects', null, 'Loading defects…'))).prop('disabled', true);
    try {
      const rows = await api.get(base('defects'));
      if (!valid(token) || createMode !== 'link') return;
      linkableDefects = rows.filter(function (item) { return item.status !== 'CLOSED'; });
      target.empty().append(option('', linkableDefects.length ? t('defects.selectDefect', null, 'Select a defect') : t('defects.noLinkableDefects', null, 'No open defects available for linking.'))).prop('disabled', !linkableDefects.length);
      linkableDefects.forEach(function (item) { target.append(option(item.id, 'BUG-' + String(item.keyNo).padStart(3, '0') + ' · ' + item.title + ' · ' + label(item.status))); });
      updatePickerSubmit('defect-create');
    } catch (error) { pickerReadFailed('defect-create', 'target', error, function () { return loadLinkableDefects(token); }, function () { return valid(token) && createMode === 'link'; }); }
  }
  function showCreate(prefill, aiDraft) {
    if (!active()) return;
    const token = ++generation; detail = null; actionMode = null; mutating = false; linkableDefects = [];
    createMode = prefill && prefill.action === 'link' ? 'link' : 'create';
    selectContext(Object.assign({}, prefill || {}, { action: createMode, defectId: undefined }));
    panels('create'); notice(''); formError('#defect-create-error', '');
    $('#defect-create-form')[0].reset();
    generatedDraft = { title: null, description: null, ai: aiDraft || null, edited: { title: false, description: false } };
    $('#defect-create-form input, #defect-create-form select, #defect-create-form textarea, #defect-create-form button').prop('disabled', false);
    $('#defect-create-context').empty();
    createLabels();
    loadRuns('defect-create', prefill);
    if (createMode !== 'link') { delete memberPickers['defect-create']; loadMembers('defect-create', null); }
    if (createMode === 'link') loadLinkableDefects(token);
    if (createMode === 'link') focusHeading('#defect-create-heading');
    else $('#defect-create-title').trigger('focus');
  }
  function showAction(mode) {
    if (!detail || mutating || editorActive()) return;
    pickerGeneration['defect-action']++;
    actionMode = mode;
    editBlocked = false;
    $('#defect-action-form')[0].reset(); formError('#defect-action-error', '');
    $('#defect-action-form input, #defect-action-form select, #defect-action-form textarea, #defect-action-submit').prop('disabled', false);
    $('#defect-action-form').removeClass('d-none');
    actionLabels(mode);
    $('#defect-action-assignee').val(['reopen', 'edit'].includes(mode) && detail.defect.assigneeId ? detail.defect.assigneeId : '');
    $('#defect-action-submit').prop('disabled', false);
    if (['edit', 'reopen'].includes(mode)) { delete memberPickers['defect-action']; loadMembers('defect-action', detail.defect.assigneeId); }
    if (mode === 'edit') {
      $('#defect-edit-title').val(detail.defect.title); $('#defect-edit-description').val(detail.defect.description || '');
      $('#defect-edit-severity').val(detail.defect.severity); $('#defect-edit-priority').val(detail.defect.priority);
    }
    if (!['resolve', 'edit'].includes(mode)) loadRuns('defect-action');
    if (mode === 'resolve') $('#defect-resolution').trigger('focus');
    else focusHeading('#defect-action-title');
    renderActions(detail.defect);
  }
  function actionLabels(mode) {
    $('#defect-action-title').text({ edit: t('defects.editDefect', null, 'Edit and reassign'), resolve: t("defects.resolveDefect", null, 'Resolve defect'), reopen: t("defects.reopenWithANewFAIL", null, 'Reopen with a new FAIL'), add: t("defects.addFailureEvidence", null, 'Add failure evidence') }[mode]);
    $('#defect-action-help').text(mode === 'edit' ? t('defects.editHelp', null, 'Save defect details and assignment together. Your input is kept if the record changes.') : mode === 'reopen' ? t('defects.reopenHelp', null, 'Choose a new, unlinked FAIL attempt and an active project Developer assignee.')
      : mode === 'resolve' ? t('defects.resolveHelp', null, 'A resolution note is required. Closing later still requires a current PASS for every linked FAIL.')
        : t('defects.addEvidenceHelp', null, 'Only an existing FAIL attempt can be linked; removing a mistaken link never removes its history.'));
    $('#defect-resolution-wrap').toggleClass('d-none', mode !== 'resolve');
    $('#defect-edit-fields').toggleClass('d-none', mode !== 'edit');
    $('#defect-action-assignee-wrap').toggleClass('d-none', !['edit', 'reopen'].includes(mode));
    $('#defect-action-evidence').toggleClass('d-none', ['resolve', 'edit'].includes(mode));
  }
  function offerVersionReview(defect, token) {
    $('#defect-action-error').append($('<button type="button" class="btn btn-outline-secondary btn-sm mt-2">')
      .text(t('defects.reviewLatest', null, 'Review latest details')).on('click', async function () {
        if (!valid(token) || mutating || actionMode !== 'edit') return;
        try {
          const latest = await api.get(defectPath(defect.id));
          if (!valid(token) || actionMode !== 'edit') return;
          const fresh = latest.defect;
          const panel = $('#defect-action-error').empty().append($('<p>').text(t('defects.latestReview',
            { title: fresh.title, status: label(fresh.status), assignee: assigneeName(fresh.assigneeId), version: fresh.version }, 'Latest: {title} · {status} · {assignee} · version {version}. Your draft remains below.')));
          if (fresh.status === 'CLOSED') { editBlocked = true; updatePickerSubmit('defect-action'); panel.append($('<p>').text(t('defects.closedCannotEdit', null, 'This defect is now closed and cannot be edited.'))); }
          else panel.append($('<button type="button" class="btn btn-outline-primary btn-sm">').text(t('defects.adoptVersion', null, 'Use this reviewed version')).on('click', function () {
            if (!valid(token) || mutating || actionMode !== 'edit') return;
            detail = latest; memberPickers['defect-action'].retained = fresh.assigneeId;
            renderDefect(fresh); renderActions(fresh); renderClosure(); formError('#defect-action-error', ''); renderMembers('defect-action');
          }));
        } catch (failure) { if (valid(token)) formError('#defect-action-error', failure.message); }
      }));
  }
  function consumeRoute(context, aiDraft) {
    if (!active()) return;
    const value = context || {};
    if (value.projectId && !sameId(value.projectId, projectId)) return;
    routeContext = Object.assign({}, value);
    if (value.defectId) { launch = null; openDetail(value.defectId, null, retestHandoffFromRoute(value)); }
    else if (value.action === 'create' || value.action === 'link') { launch = null; showCreate(value, aiDraft); }
    else if (launch && sameId(launch.projectId, projectId)) { const prefill = launch; launch = null; showCreate(prefill); }
    else list();
  }
  $(document).on('veriqra:failure-evidence', function (event) {
    const value = event.originalEvent.detail;
    if (projectId && String(value.projectId) === projectId) launch = value;
  });
  $(document).on('veriqra:project', function (event) {
    rememberList();
    const next = event.originalEvent.detail.project;
    if (!next || (projectId && String(next.id) !== projectId)) launch = null;
    reset(); projectId = next ? String(next.id) : null;
    projectArchived = !!next && next.status === 'ARCHIVED'; actor = null;
    const context = navigation() && navigation().read();
    if (context) view = context.view;
    if (active()) { consumeRoute(context); loadActor(generation); }
  });
  $(document).on('veriqra:view', function (event) {
    const payload = event.originalEvent.detail, next = payload.view;
    const context = payload.context || (navigation() && navigation().read());
    const aiDraft = takeAiDraft(next, context);
    rememberList();
    if (next !== view) { reset(); view = next; }
    if (!active()) return;
    consumeRoute(context, aiDraft);
    if (!actor) loadActor(generation);
  });
  document.addEventListener('veriqra:reauthenticated', function () {
    if (!active()) return;
    actor = null; syncAiAnalysis();
    if (window.VeriqraDefectComments) window.VeriqraDefectComments.reauthenticate();
    if (detail) { renderActions(detail.defect); renderClosure(); }
    loadActor(generation);
  });
  document.addEventListener('veriqra:localechange', function () {
    if (!active() || mutating) return;
    renderActionStatus();
    for (const prefix of ['defect-create', 'defect-action']) {
      const run = $('#' + prefix + '-run'), runCase = $('#' + prefix + '-case'), attempt = $('#' + prefix + '-attempt');
      const data = pickerData[prefix];
      if (run.find('option[value=""]').length) run.find('option[value=""]').text(t(!data.runs ? 'defects.loadingRuns' : data.runs.length ? 'defects.selectARun' : 'defects.noRuns'));
      if (runCase.find('option[value=""]').length) runCase.find('option[value=""]').text(t(!run.val() ? 'defects.selectARunFirst' : !data.cases ? 'defects.loadingRunCases' : data.cases.length ? 'defects.selectARunCase' : 'defects.noRunCases'));
      if (attempt.find('option[value=""]').length) attempt.find('option[value=""]').text(t(!runCase.val() ? 'defects.selectARunCaseFirst' : !sameId(data.caseId, runCase.val()) ? 'defects.loadingFailAttempts' : data.attempts.length ? 'defects.selectAFAILAttempt' : 'defects.noFailAttempts'));
      Object.keys(pickerFailures[prefix]).forEach(function (field) {
        $('#' + prefix + '-' + field + ' option[value=""]').text(t('common.unavailable', null, 'Unavailable'));
        $('#' + prefix + '-' + field + '-retry').text(t('common.retry', null, 'Retry'));
      });
    }
    for (const prefix of ['defect-create', 'defect-action']) {
      renderMembers(prefix);
      const selected = $('#' + prefix + '-attempt').val();
      (pickerData[prefix].attempts || []).forEach(function (item) { $('#' + prefix + '-attempt option[value="' + item.id + '"]').text('FAIL #' + item.attemptNo + ' · ' + date(item.executedAt) + ' · ID ' + item.id); });
      $('#' + prefix + '-attempt').val(selected);
    }
    if (!$('#defect-create-form').hasClass('d-none')) { createLabels(); renderCreateContext(false); return; }
    if (detail && !$('#defect-detail-panel').hasClass('d-none')) {
      renderDefect(detail.defect); renderActions(detail.defect); renderEvidence(detail); renderClosure();
      if (actionMode) actionLabels(actionMode);
    }
    else {
      const context = navigation() && navigation().read();
      if (!$('#defect-detail-panel').hasClass('d-none') && context && context.defectId && sameId(context.projectId, projectId)) openDetail(context.defectId);
      else if (listLoaded && !$('#defect-list-panel').hasClass('d-none')) { renderListToolbar(); renderListRows(); }
      else { list(); if (!actor) loadActor(generation); }
    }
  });
  $('#defect-new').on('click', function () { if (navigation()) navigation().open('defects', { projectId: projectId, action: 'create' }); else showCreate(null); });
  $('#defect-back, #defect-create-cancel, #defect-create-cancel-bottom').on('click', function () { if (navigation()) navigation().open('defects', { projectId: projectId }); else list(); });
  $('#defect-action-cancel').on('click', function () { actionMode = null; pickerGeneration['defect-action']++; clearPickerFailures('defect-action'); $('#defect-action-form').addClass('d-none'); if (detail) renderActions(detail.defect); focusHeading('#defect-detail-title'); });
  ['defect-create', 'defect-action'].forEach(function (prefix) {
    $('#' + prefix + '-assignee-search').on('input', function () { renderMembers(prefix); });
    $('#' + prefix + '-assignee').on('change', function () { if (memberPickers[prefix]) memberPickers[prefix].selected = String($(this).val() || ''); updatePickerSubmit(prefix); });
    $('#' + prefix + '-run').on('change', function () { if (prefix === 'defect-create') discardAiOnSourceChange(); pickerError(prefix, ''); loadCases(prefix); if (prefix === 'defect-create') renderCreateContext(); });
    $('#' + prefix + '-case').on('change', function () { if (prefix === 'defect-create') discardAiOnSourceChange(); pickerError(prefix, ''); loadAttempts(prefix); if (prefix === 'defect-create') renderCreateContext(); });
    $('#' + prefix + '-attempt').on('change', function () { if (prefix === 'defect-create') discardAiOnSourceChange(); updatePickerSubmit(prefix); if (prefix === 'defect-create') renderCreateContext(); });
  });
  $('#defect-create-target').on('change', function () { updatePickerSubmit('defect-create'); });
  ['title', 'description'].forEach(function (name) {
    $('#defect-create-' + name).on('input', function () { if (generatedDraft) generatedDraft.edited[name] = true; });
  });
  $('#defect-create-form').on('submit', async function (event) {
    event.preventDefault();
    if (!active() || mutating || $('#defect-create-submit').prop('disabled') || !this.reportValidity()) return;
    const failureAttemptId = selectedFailure('defect-create');
    if (!failureAttemptId) { formError('#defect-create-error', t("defects.selectAnExistingFAILAttempt", null, 'Select an existing FAIL attempt.')); return; }
    const target = createMode === 'link' && linkableDefects.find(function (item) { return sameId(item.id, $('#defect-create-target').val()); });
    if (createMode === 'link' && !target) { formError('#defect-create-error', t('defects.selectDefect', null, 'Select a defect')); return; }
    const rawAssignee = String($('#defect-create-assignee').val() || '').trim(), assigneeId = assignee('#defect-create-assignee', false);
    if (createMode !== 'link' && rawAssignee && !assigneeId) { formError('#defect-create-error', t('defects.invalidAssignee', null, 'Select an available project member.')); return; }
    const token = generation;
    const context = failureContext('defect-create');
    const sourceProjectId = projectId;
    const body = createMode === 'link' ? { failureAttemptId: failureAttemptId, expectedVersion: target.version } : { failureAttemptId: failureAttemptId, title: $('#defect-create-title').val().trim(),
      description: $('#defect-create-description').val().trim() || null, severity: $('#defect-create-severity').val(),
      priority: $('#defect-create-priority').val(), assigneeId: assigneeId };
    mutating = true;
    $('#defect-create-form input, #defect-create-form select, #defect-create-form textarea, #defect-create-form button').prop('disabled', true);
    formError('#defect-create-error', '');
    try {
      const created = await api.post(target ? defectPath(target.id) + '/evidence' : base('defects'), body);
      const id = target ? target.id : created.id;
      announceLinked(id, context, sourceProjectId);
      if (valid(token)) {
        selectContext(Object.assign({}, routeContext, context, { defectId: String(id), action: undefined }));
        await openDetail(id, target ? t('defects.evidenceLinked', null, 'Failure evidence linked.') : null);
      }
    } catch (error) { if (valid(token)) formError('#defect-create-error', error.reasonCode ? reasonText(error.reasonCode) : conflict(error)); }
    finally { if (valid(token)) {
      mutating = false;
      $('#defect-create-form input, #defect-create-form select, #defect-create-form textarea, #defect-create-form button').prop('disabled', false);
      createLabels(); refreshMemberControls(); updatePickerSubmit('defect-create');
    } }
  });
  $('#defect-action-form').on('submit', async function (event) {
    event.preventDefault();
    if (!active() || mutating || $('#defect-action-submit').prop('disabled') || !detail) return;
    const mode = actionMode, defect = detail.defect, token = generation;
    let body;
    if (mode === 'edit') {
      const title = String($('#defect-edit-title').val() || '').trim();
      const raw = String($('#defect-action-assignee').val() || ''), selected = assignee('#defect-action-assignee', false);
      if (!title) { formError('#defect-action-error', t('defects.titleRequired', null, 'Enter a defect title.')); return; }
      if (raw && !selected) { formError('#defect-action-error', t('defects.invalidAssignee', null, 'Select an available project member.')); return; }
      body = { expectedVersion: defect.version, title: title, description: String($('#defect-edit-description').val() || '').trim() || null,
        severity: $('#defect-edit-severity').val(), priority: $('#defect-edit-priority').val(), assigneeId: selected };
    } else if (mode === 'resolve') {
      const resolutionNote = $('#defect-resolution').val().trim();
      if (!resolutionNote) { formError('#defect-action-error', t("defects.enterAResolutionNote", null, 'Enter a resolution note.')); return; }
      body = { expectedVersion: defect.version, resolutionNote: resolutionNote };
    } else if (mode === 'reopen' || mode === 'add') {
      const failureAttemptId = selectedFailure('defect-action');
      if (!failureAttemptId) { formError('#defect-action-error', t("defects.selectAFAILAttemptMessage", null, 'Select a FAIL attempt.')); return; }
      body = mode === 'reopen' ? { expectedVersion: defect.version, failureAttemptId: failureAttemptId,
        assigneeId: assignee('#defect-action-assignee', true) } : { failureAttemptId: failureAttemptId, expectedVersion: defect.version };
      if (mode === 'reopen' && !body.assigneeId) { formError('#defect-action-error', t('defects.invalidActiveAssignee', null, 'Select an active project Developer.')); return; }
    } else return;
    const context = mode === 'add' || mode === 'reopen' ? failureContext('defect-action') : null;
    const sourceProjectId = projectId;
    mutationState(true);
    formError('#defect-action-error', '');
    try {
      if (mode === 'edit') await api.put(defectPath(defect.id), body);
      else await api.post(defectPath(defect.id) + (mode === 'add' ? '/evidence' : '/' + mode), body);
      if (context) announceLinked(defect.id, context, sourceProjectId);
      if (valid(token)) {
        await openDetail(defect.id, mode === 'resolve' ? t("defects.defectResolved", null, 'Defect resolved.') : null);
      }
    } catch (error) { if (valid(token)) {
      formError('#defect-action-error', mode === 'edit' && error.status === 409 ? t('defects.editConflict', null, 'This defect changed. Your draft is kept. Review the latest details and explicitly adopt its version before saving again.') + (error.reasonCode ? ' ' + reasonText(error.reasonCode) : '') : error.reasonCode ? reasonText(error.reasonCode) : conflict(error, mode));
      if (mode === 'edit' && error.status === 409) offerVersionReview(defect, token);
    } }
    finally { if (valid(token)) mutationState(false); }
  });
  window.VeriqraDefects = Object.freeze({ stageAiDraft: stageAiDraft });
})(jQuery, window.VeriqraApi);
