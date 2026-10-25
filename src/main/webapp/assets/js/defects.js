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
  const candidatePages = new Map();
  let retestPending = null;
  let editBlocked = false;
  let actionFeedback = null;
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
        if (!nav || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); nav.open(next, Object.assign({ projectId: projectId }, context));
      });
  }
  function mutationState(value) {
    mutating = value;
    $('#defect-detail-panel button, #defect-action-form select, #defect-action-form input, #defect-action-form textarea').prop('disabled', value);
    $('#defect-evidence-retry').prop('disabled', value || evidenceLoading);
    refreshMemberControls();
    if (value) $('#defect-closure button, #defect-retest-form input, #defect-retest-form textarea, #defect-retest-form button').prop('disabled', true);
    else { updatePickerSubmit('defect-action'); renderClosure(); if (detail) { renderActions(detail.defect); renderDefect(detail.defect); if (evidenceValues) renderEvidence(detail); if (actionMode) actionLabels(actionMode); } }
  }
  function failureContext(prefix) {
    return { runId: String($('#' + prefix + '-run').val() || ''), runCaseId: String($('#' + prefix + '-case').val() || ''),
      attemptId: String($('#' + prefix + '-attempt').val() || '') };
  }
  function announceLinked(defectId, context, sourceProjectId) {
    document.dispatchEvent(new CustomEvent('veriqra:defect-linked', { detail: Object.assign({ projectId: sourceProjectId, defectId: String(defectId) }, context) }));
  }
  const field = function (name, value) {
    return $('<div class="asset-field">').append($('<dt>').text(name),
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
    generation++;
    pickerGeneration['defect-create']++;
    pickerGeneration['defect-action']++;
    detail = null; actionMode = null; mutating = false; evidenceValues = null; evidenceLoading = false; linkableDefects = [];
    editBlocked = false;
    projectMembers = []; accessGeneration++; Object.keys(memberPickers).forEach(function (key) { delete memberPickers[key]; });
    closureEligibility = null; closureLoading = false; closureFailure = null; closureGeneration++; closureNeedsAccessRefresh = false; retestEditor = null; candidatePages.clear(); retestPending = null;
    pickerData['defect-create'] = {}; pickerData['defect-action'] = {};
    clearPickerFailures('defect-create'); clearPickerFailures('defect-action');
    $('#defect-list, #defect-detail, #defect-evidence, #defect-actions, #defect-closure').empty();
    $('#defect-list-status, #defect-evidence-status').text('');
    $('#defect-list-panel, #defect-detail-panel, #defect-create-form, #defect-action-form').addClass('d-none');
    $('#defect-create-submit, #defect-action-submit').prop('disabled', false);
    notice(''); actionStatus(''); formError('#defect-create-error', ''); formError('#defect-action-error', '');
  }
  function panels(which) {
    $('#defect-list-panel').toggleClass('d-none', which !== 'list');
    $('#defect-detail-panel').toggleClass('d-none', which !== 'detail');
    $('#defect-create-form').toggleClass('d-none', which !== 'create');
  }
  async function list() {
    if (!active()) return;
    const token = ++generation;
    detail = null; actionMode = null; mutating = false;
    panels('list'); notice('');
    $('#defect-list').empty(); $('#defect-list-status').text(t("defects.loadingDefects", null, 'Loading defects…'));
    focusHeading('#defect-list-panel h2');
    try {
      const rows = await api.get(base('defects'));
      if (!valid(token)) return;
      $('#defect-list-status').text(rows.length ? t('defects.defectCount', { count: window.I18n.formatNumber(rows.length) }, '{count} defect(s)') : t("defects.noDefectsInThisProject", null, 'No defects in this project.'));
      rows.forEach(function (row) {
        const title = 'BUG-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title;
        $('#defect-list').append($('<div class="asset-list-row">').append(
          $('<div class="asset-list-summary">').append($('<strong>').text(title),
            $('<p class="mb-1 text-secondary">').text(row.description || t("common.noDescription", null, 'No description'))),
          $('<div class="asset-list-meta">').append(badge(row.status),
            $('<span>').text(t('defects.severityPriority', { severity: label(row.severity), priority: label(row.priority) }, 'Severity {severity} · Priority {priority}')),
            $('<span>').text('v' + row.version), $('<small>').text(t('defects.updatedAt', { date: date(row.updatedAt) }, 'Updated {date}'))),
          routeLink(t("defects.viewDefect", null, 'View defect'), 'defects', { defectId: String(row.id) })));
      });
    } catch (error) { if (valid(token)) {
      $('#defect-list-status').text(t('common.unavailable', null, 'Unavailable')); notice(error.message, true);
      $('#defect-list').append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('common.retry', null, 'Retry')).on('click', function () { if (valid(token)) return list(); }));
    } }
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
        field(t("defects.runCaseSnapshot", null, 'Run Case snapshot'), value.runCase ? value.runCase.snapshotTitle : t('common.unavailable', null, 'Unavailable')),
        field(t("defects.executed", null, 'Executed'), source ? date(source.executedAt) : null), field(t('defects.actor', null, 'Executed by'), source ? projectUserName(source.executedBy) : null),
        field(t("defects.actualResultComment", null, 'Actual result / comment'), source ? source.comment : null),
        field(t("defects.failureMessage", null, 'Failure message'), source ? source.failureMessage : link.failureMessage),
        field(t('defects.linked', null, 'Linked'), date(link.linkedAt))));
    const later = (value.history || []).filter(function (attempt) { return attempt.attemptNo > link.attemptNo; });
    card.append($('<p class="small fw-semibold mb-1">').text(t("defects.laterRetestsOnThisRunCase", null, 'Later retests on this Run Case')));
    if (value.unavailable) card.append($('<p class="small text-danger" role="status">').text(t('defects.evidenceUnavailable', null, 'Run or attempt history could not be loaded. Retest status is unavailable.')));
    else if (!later.length) card.append($('<p class="small text-secondary">').text(t("defects.noLaterAttemptRecorded", null, 'No later attempt recorded.')));
    later.forEach(function (attempt) {
      card.append($('<div class="defect-retest">').append(
        $('<span>').text(t('defects.attemptAt', { number: attempt.attemptNo, date: date(attempt.executedAt) }, 'Attempt #{number} · {date} · ')), badge(attempt.outcome),
        $('<span>').text(' ' + (attempt.comment || attempt.failureMessage || t("defects.noComment", null, 'No comment')))));
    });
    const context = { runId: String(link.runId), runCaseId: String(link.runCaseId), attemptId: String(link.attemptId), defectId: String(defect.id) };
    card.append(routeLink(t('defects.openSourceAttempt', null, 'Open source attempt'), 'runs', context));
    if (value.runCase && value.runCase.testCaseId != null) card.append(routeLink(t('defects.openOriginalCase', null, 'Open original Test Case'), 'test-cases', Object.assign({}, context, { testCaseId: String(value.runCase.testCaseId) })).addClass('ms-2'));
    if (canManage() && defect.status !== 'CLOSED') card.append($('<button type="button" class="btn btn-outline-danger btn-sm ms-2">')
      .text(t("defects.removeLinkCorrection", null, 'Remove link (correction)')).prop('disabled', mutating).on('click', function () { return removeEvidence(link, defect); }));
    return card;
  }
  async function openDetail(id, feedback) {
    if (!active()) return;
    const token = ++generation;
    actionMode = null; detail = null; mutating = false; evidenceValues = null; evidenceLoading = false; panels('detail'); notice(''); actionStatus('');
    closureEligibility = null; closureLoading = true; closureFailure = null; closureGeneration++; closureNeedsAccessRefresh = false; retestEditor = null; candidatePages.clear(); retestPending = null;
    selectContext(Object.assign({}, routeContext, { defectId: String(id), action: undefined }));
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
    $('#defect-detail').empty().append($('<dl class="asset-fields">').append(
        field(t("common.status", null, 'Status'), label(defect.status)), field(t("common.severity", null, 'Severity'), label(defect.severity)),
        field(t("common.priority", null, 'Priority'), label(defect.priority)), field(t("common.version", null, 'Version'), defect.version),
        field(t("common.description", null, 'Description'), defect.description), field(t('defects.reporter', null, 'Reported by'), projectUserName(defect.reporterId)),
        field(t('defects.assignee', null, 'Assignee'), assigneeName(defect.assigneeId)), field(t("defects.resolutionNote", null, 'Resolution note'), defect.resolutionNote),
        field(t("common.created", null, 'Created'), date(defect.createdAt)), field(t("common.updated", null, 'Updated'), date(defect.updatedAt))));
  }
  function renderActions(defect) {
    const actions = $('#defect-actions').empty();
    const tester = canManage();
    const processor = tester || canProcess(defect);
    const closeReady = !!(tester && !retestPending && !closureLoading && closureEligibility && closureEligibility.canClose && closureEligibility.defectVersion === defect.version);
    const hint = defect.status === 'CLOSED' ? ['defects.nextClosed', 'Closed. Review the original failure and retest results below.']
      : ['OPEN', 'REOPENED'].includes(defect.status) ? (processor ? ['defects.nextStart', 'Next: start work on this defect.'] : ['defects.nextWaitStart', 'Waiting for the assignee to start work.'])
      : defect.status === 'IN_PROGRESS' ? (processor ? ['defects.nextResolve', 'Next: enter the fix details and mark the defect resolved.'] : ['defects.nextWaitResolve', 'Waiting for the assignee to record the fix.'])
      : closeReady ? ['defects.nextClose', 'Retest passed. Next: close the defect.'] : ['defects.nextRetest', 'Next: retest the original failure and link its passing result.'];
    actions.append($('<p class="w-100 fw-semibold mb-1" role="status">').text(t(hint[0], null, hint[1])));
    if (processor && ['OPEN', 'REOPENED'].includes(defect.status)) actions.append(actionButton(t("defects.startWork", null, 'Start work'), function () { return transition('start'); }, true));
    if (processor && defect.status === 'IN_PROGRESS') actions.append(actionButton(t("defects.resolve", null, 'Resolve'), function () { showAction('resolve'); }, true));
    if (tester && defect.status === 'RESOLVED') {
      if (!closeReady) actions.append(actionButton(t('defects.enterRetest', null, 'Review retest results'), function () { focusHeading('#defect-closure-heading'); }, true));
      actions.append(actionButton(t("common.close", null, 'Close'), function () { return transition('close'); }, closeReady)
        .prop('disabled', mutating || !!retestPending || !closeReady));
    }
    if (tester && defect.status !== 'CLOSED') actions.append(actionButton(t('defects.editDefect', null, 'Edit and reassign'), function () { showAction('edit'); }));
    if (tester && ['RESOLVED', 'CLOSED'].includes(defect.status)) actions.append(actionButton(t("defects.reopenWithNewFAIL", null, 'Reopen with new FAIL'), function () { showAction('reopen'); }));
    if (tester && defect.status !== 'CLOSED') actions.append(actionButton(t("defects.addFailureEvidence", null, 'Add failure evidence'), function () { showAction('add'); }));
    const members = detailMemberState();
    if (members && (members.loading || members.failed)) {
      const status = $('<div class="small text-secondary" role="status">').attr('id', 'defect-detail-members-status')
        .text(members.loading ? t('defects.loadingMembers', null, 'Loading project members…') : t('defects.membersUnavailable', null, 'Project members are unavailable. Retry before changing the assignment.'));
      if (members.failed) status.append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">')
        .attr('id', 'defect-detail-members-retry').text(t('common.retry', null, 'Retry')).prop('disabled', mutating)
        .on('click', function () { if (!mutating && detailMemberState() === members && !members.loading) return loadMembers('defect-detail', members.retained); }));
      actions.append(status);
    }
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
      if (detail) { renderActions(detail.defect); renderClosure(); if (evidenceValues) renderEvidence(detail); recoverStoredOperation(); }
    } catch (error) { if (valid(token) && accessToken === accessGeneration) { actor = null; if (detail) { renderActions(detail.defect); renderClosure(); } } }
  }
  function actionButton(text, callback, primary) { return $('<button type="button" class="btn ' + (primary ? 'btn-primary' : 'btn-outline-primary') + '">').text(text).prop('disabled', mutating).on('click', function () { if (!mutating) return callback(); }); }
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
    return $('<div>').append($('<p class="mb-1 fw-semibold">').text(executionTitle(execution)),
      $('<p class="small mb-1">').text(t('defects.executionOrigin', { source: attempt.importId == null ? t('defects.manualSource', null, 'Manual execution') : t('defects.importSource', null, 'JUnit import'), recorded: date(attempt.recordedAt) }, '{source} · recorded {recorded}')),
      $('<p class="small mb-1">').text(attempt.executedAt ? t('defects.actualExecutionTime', { time: date(attempt.executedAt) }, 'Actual execution time: {time}') : t('defects.externalTimingUnverified', null, 'The imported report does not provide verified actual execution time.')),
      $('<p class="small mb-1">').text(t('defects.buildEnvironment', { build: execution.run.buildVersion || '—', environment: execution.run.environment || '—' }, 'Build: {build} · environment: {environment}')),
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
      renderClosure(); renderActions(current.defect); recoverStoredOperation();
    } catch (error) {
      if (!stillCurrent()) return;
      closureLoading = false; closureEligibility = null; closureFailure = error;
      renderClosure(); renderActions(current.defect);
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
    if (detail.defect.status !== 'CLOSED') (eligibility.reasons || []).forEach(function (code) { target.append($('<p class="small text-secondary">').text(reasonText(code))); });
    const members = detailMemberState();
    if (!canManage() && !(members && (members.loading || members.failed)) && detail.defect.status !== 'CLOSED') target.append($('<p class="small text-secondary">').text(t('defects.retestPermission', null, 'An active project Tester or platform Admin must review retest evidence and close the defect.')));
    if (detail.defect.status === 'RESOLVED' && !versionChanged && canManage()) target.append($('<p class="small">').text(readyToClose
      ? t('defects.resolvedReadyToClose', null, 'Retest evidence is complete. Next, close the defect; the server will verify eligibility again when you submit.')
      : t('defects.resolvedNextStep', null, 'Next: perform the retest, link its PASS for each original FAIL, check eligibility, then close the defect.')));
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
        }).removeClass('btn-outline-primary').addClass('btn-primary mt-2'));
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
        if (failure.selection && !failure.selection.revocation) card.append($('<button type="button" class="btn btn-outline-danger btn-sm mt-2 ms-2">').text(t('defects.revokeRetest', null, 'Revoke selected PASS'))
          .prop('disabled', mutating || !!retestPending).on('click', function () { if (!mutating && !retestPending) showRetestEditor(failure, null, 'REVOKE'); }));
      }
      card.append($('<div class="mt-3">').attr('id', 'defect-candidates-' + id)); target.append(card);
      renderCandidates(failure);
    });
    if (eligibility.legacyClosed) target.append($('<p class="small text-secondary">').text(t('defects.legacyClosure', null, 'Legacy closure used the earlier same-run rule. No immutable closure receipt was saved.')));
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
      target.append(card);
    });
    target.append($('<div class="mt-3">').attr('id', 'defect-retest-editor'), $('<div class="mt-3" role="status">').attr('id', 'defect-operation-status'));
    renderRetestEditor(); renderOperationRecovery();
  }
  function timingText(basis) { return t(basis === 'IMPORT_REVIEW_ATTESTATION' ? 'defects.importAttestation' : 'defects.manualTiming', null, basis === 'IMPORT_REVIEW_ATTESTATION' ? 'Operator attestation of external execution timing' : 'Manual server-recorded execution timing'); }
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
        .prop('disabled', mutating || !!retestPending || !candidate.eligible || selected).on('click', function () { if (!mutating && !retestPending && candidate.eligible && !selected) showRetestEditor(failure, candidate, 'LINK'); }));
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
    retestEditor = { failure: failure, candidate: candidate, mode: mode, note: '', reason: '', confirmed: false };
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
      $('<button type="button" class="btn btn-outline-secondary ms-2">').text(t('common.cancel', null, 'Cancel')).prop('disabled', mutating).on('click', function () { retestEditor = null; renderRetestEditor(); focusHeading('#defect-closure-heading'); }));
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
    if (context.runId && context.runCaseId && context.attemptId) target.append(routeLink(t('defects.openSourceAttempt', null, 'Open source attempt'), 'runs', context));
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
    pickerData[prefix].cases = []; pickerData[prefix].attempts = [];
    const select = $('#' + prefix + '-case').empty().append(option('', runId ? t('defects.loadingRunCases', null, 'Loading Run Cases…') : t("defects.selectARunFirst", null, 'Select a Run first'))).prop('disabled', true);
    $('#' + prefix + '-attempt').empty().prop('disabled', true);
    updatePickerSubmit(prefix);
    if (!runId) return;
    try {
      const result = await api.get(runPath(runId));
      if (!pickerValid(prefix, token, pickerToken)) return;
      pickerData[prefix].cases = result.cases;
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
    } catch (error) {
      if (!valid(token) || accessToken !== accessGeneration || memberPickers[prefix] !== state) return;
      state.loading = false; state.failed = true; renderMembers(prefix);
      if (prefix === 'defect-detail' && detail) { renderActions(detail.defect); renderClosure(); }
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
  function showCreate(prefill) {
    if (!active()) return;
    const token = ++generation; detail = null; actionMode = null; mutating = false; linkableDefects = [];
    createMode = prefill && prefill.action === 'link' ? 'link' : 'create';
    selectContext(Object.assign({}, prefill || {}, { action: createMode, defectId: undefined }));
    panels('create'); notice(''); formError('#defect-create-error', '');
    $('#defect-create-form')[0].reset();
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
    if (!detail || mutating) return;
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
  function consumeRoute(context) {
    if (!active()) return;
    const value = context || {};
    if (value.projectId && !sameId(value.projectId, projectId)) return;
    routeContext = Object.assign({}, value);
    if (value.defectId) { launch = null; openDetail(value.defectId); }
    else if (value.action === 'create' || value.action === 'link') { launch = null; showCreate(value); }
    else if (launch && sameId(launch.projectId, projectId)) { const prefill = launch; launch = null; showCreate(prefill); }
    else list();
  }
  $(document).on('veriqra:failure-evidence', function (event) {
    const value = event.originalEvent.detail;
    if (projectId && String(value.projectId) === projectId) launch = value;
  });
  $(document).on('veriqra:project', function (event) {
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
    if (next !== view) { reset(); view = next; }
    if (!active()) return;
    consumeRoute(payload.context || (navigation() && navigation().read()));
    if (!actor) loadActor(generation);
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
      else list();
    }
  });
  $('#defect-new').on('click', function () { if (navigation()) navigation().open('defects', { projectId: projectId, action: 'create' }); else showCreate(null); });
  $('#defect-back, #defect-create-cancel').on('click', function () { if (navigation()) navigation().open('defects', { projectId: projectId }); else list(); });
  $('#defect-action-cancel').on('click', function () { actionMode = null; pickerGeneration['defect-action']++; clearPickerFailures('defect-action'); $('#defect-action-form').addClass('d-none'); focusHeading('#defect-detail-title'); });
  ['defect-create', 'defect-action'].forEach(function (prefix) {
    $('#' + prefix + '-assignee-search').on('input', function () { renderMembers(prefix); });
    $('#' + prefix + '-assignee').on('change', function () { if (memberPickers[prefix]) memberPickers[prefix].selected = String($(this).val() || ''); updatePickerSubmit(prefix); });
    $('#' + prefix + '-run').on('change', function () { pickerError(prefix, ''); loadCases(prefix); if (prefix === 'defect-create') renderCreateContext(); });
    $('#' + prefix + '-case').on('change', function () { pickerError(prefix, ''); loadAttempts(prefix); if (prefix === 'defect-create') renderCreateContext(); });
    $('#' + prefix + '-attempt').on('change', function () { updatePickerSubmit(prefix); if (prefix === 'defect-create') renderCreateContext(); });
  });
  $('#defect-create-target').on('change', function () { updatePickerSubmit('defect-create'); });
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
})(jQuery, window.VeriqraApi);
