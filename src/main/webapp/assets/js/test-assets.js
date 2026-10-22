(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  // Project and view ownership stay in app.js. This module only renders current test assets.
  let projectId = null;
  let view = 'dashboard';
  let generation = 0;
  let rows = [];
  let detail = null;
  let detailId = null;
  let currentLinks = [];
  let editing = false;
  let projectArchived = false;
  let traceState = 'idle';
  let writing = false;
  let formContext = {};
  let pendingLink = null;
  let tracePickerGeneration = 0;
  let qaContext = null;
  let permissionState = 'loading';
  let formBaseline = null;
  let searchText = '';
  let statusFilter = '';
  let traceCandidates = [];
  let traceTargetType = '';
  let formNeedsReview = false;
  let latestFormValue = null;
  let formCheckLoading = false;
  let formErrorDescriptor = null;
  let recoveryDescriptor = null;
  let sourceRequirement = null;
  let sourceRequirementState = 'none';
  let sourceFailure = null;
  let sourceRequest = 0;
  const uncertainWrites = new Map();
  const draftOwner = 'test-assets';
  const root = $('#asset-workspace');
  const active = function () { return view === 'requirements' || view === 'test-cases'; };
  const kind = function () { return view === 'requirements' ? 'requirements' : 'test-cases'; };
  const base = function (type) { return 'projects/' + encodeURIComponent(projectId) + '/' + type; };
  const valid = function (token) { return token === generation && projectId && active(); };
  const label = function (value) { return window.I18n.enumLabel(value); };
  const navigation = function () { return window.VeriqraQaNavigation; };
  const sameId = function (left, right) { return String(left) === String(right); };
  const canWrite = function () { return permissionState === 'loaded' && qaContext && qaContext.canWriteAssets === true && !projectArchived; };
  const writable = function () { return detail && canWrite() && detail.row.status !== 'ARCHIVED'; };
  function scopeKey(type, id) { return [projectId, qaContext && qaContext.actorId, type, id || 'create'].join(':'); }
  function unknown(failure) { return !failure.status || failure.status >= 500; }
  function reconcileSavedUpdate(value) {
    const lockKey = scopeKey(kind(), value.row.id), intent = uncertainWrites.get(lockKey);
    if (!intent || !intent.body || value.row.version <= intent.body.expectedVersion || value.row.status !== intent.expectedStatus) return false;
    const body = intent.body;
    const nullable = function (field) { return value.row[field] == null ? null : value.row[field]; };
    if (value.row.title !== body.title || value.row.priority !== body.priority || nullable('description') !== body.description) return false;
    if (view === 'test-cases' && (nullable('preconditions') !== body.preconditions || JSON.stringify(readyBody(value).steps) !== JSON.stringify(body.steps))) return false;
    uncertainWrites.delete(lockKey); return true;
  }
  function mutationError(failure) {
    if (failure.status === 401 || failure.status === 403) { permissionState = 'error'; qaContext = null; updateControls(); }
    return conflict(failure);
  }
  function draftValue() {
    if ($('#asset-form').hasClass('d-none')) return null;
    return JSON.stringify({ title: $('#asset-title').val(), description: $('#asset-description').val(),
      priority: $('#asset-priority').val(), status: $('#asset-status').val(), preconditions: $('#asset-preconditions').val(),
      steps: $('#step-editor .step-editor-row').map(function () { return { action: $(this).find('.step-action').val(), expected: $(this).find('.step-expected').val() }; }).get() });
  }
  function dirty() { return !!(window.VeriqraAiCases && window.VeriqraAiCases.hasDraft()) || writing || uncertainWrites.size > 0 || !!(pendingLink && pendingLink.uncertain) || (formBaseline !== null && draftValue() !== null && formBaseline !== draftValue()); }
  function confirmDiscard() { return !dirty() || window.confirm(t('r2Assets.discardDraft', null, 'Discard the unsaved draft?')); }
  function guard() {
    if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register(draftOwner, { dirty: dirty, clear: function () { formBaseline = null; pendingLink = null; uncertainWrites.clear(); } });
  }
  function ensureExtras() {
    root.prepend($('<p id="asset-permission-note" class="text-secondary small" role="status">'));
    const filters = $('<div id="asset-list-filters" class="d-flex flex-wrap gap-2 mb-2">');
    filters.append($('<label for="asset-search" id="asset-search-label" class="form-label">'),
      $('<input id="asset-search" type="search" class="form-control" style="max-width:26rem">'),
      $('<label for="asset-status-filter" id="asset-status-filter-label" class="form-label">'),
      $('<select id="asset-status-filter" class="form-select" style="max-width:13rem">'));
    $('#asset-list').before(filters, $('<p id="asset-filter-count" class="text-secondary small" role="status">'));
    $('#asset-description').after($('<div id="asset-description-tools" class="mb-3">').append(
      $('<p id="asset-description-help" class="text-secondary small">'),
      $('<button id="asset-description-template" type="button" class="btn btn-outline-secondary btn-sm">')));
    $('#asset-form-error').after($('<section id="asset-form-recovery" class="alert alert-warning d-none" aria-live="polite">').append(
      $('<p id="asset-form-recovery-message">'),
      $('<button id="asset-form-check-read" class="btn btn-outline-secondary btn-sm me-2" type="button">'),
      $('<div id="asset-form-latest" class="my-2">'),
      $('<button id="asset-use-latest-version" class="btn btn-outline-primary btn-sm d-none" type="button">')));
    $('#asset-form-context').after($('<button id="asset-source-retry" class="btn btn-outline-secondary btn-sm mb-2 d-none" type="button">'));
    $('#asset-primary-actions').before($('<div id="asset-ready-panel" class="alert alert-info d-none" role="status">').append(
      $('<p id="asset-ready-checks" class="mb-2">'),
      $('<button id="asset-ready" type="button" class="btn btn-primary btn-sm">')));
    $('#trace-form').append($('<label id="trace-search-label" for="trace-search" class="form-label mt-2">'),
      $('<input id="trace-search" type="search" class="form-control">'));
    translateExtras();
    $('#asset-search').on('input', function () { searchText = $(this).val(); renderList(); });
    $('#asset-status-filter').on('change', function () { statusFilter = $(this).val(); renderList(); });
    $('#trace-search').on('input', renderTraceCandidates);
    $('#asset-description-template').on('click', function () {
      if (!canWrite() || writing || view !== 'requirements') return;
      const field = $('#asset-description');
      if (field.val().trim() && !window.confirm(t('r2Assets.replaceTemplate', null, 'Replace this description with an editable template?'))) return;
      field.val(t('r2Assets.requirementTemplate', null, 'User need:\nAs a …, I want to …, so that …\n\nAcceptance criteria:\n1. Given …, when …, then …\n2. Boundary / error case: …')).trigger('focus');
    });
    $('#asset-ready').on('click', checkAndReady);
    $('#asset-form-check-read').on('click', checkFormLatest);
    $('#asset-use-latest-version').on('click', function () {
      if (!editing || !latestFormValue || !canWrite() || writing || formCheckLoading || latestFormValue.row.status === 'ARCHIVED') return;
      if (!window.confirm(t('r2Assets.reviewedLatestConfirm', null, 'I reviewed the latest saved definition. Use its current version and submit my retained draft as an explicit replacement?'))) return;
      detail = latestFormValue; latestFormValue = null; formNeedsReview = false;
      $('#asset-use-latest-version').addClass('d-none');
      recoveryMessage(translated('r2Assets.versionReviewed', null, 'Your retained draft now targets the reviewed version. Check your changes, then save once. Nothing has been resubmitted.'));
      formError(''); updateControls();
    });
    $('#asset-source-retry').on('click', function () { return verifySourceRequirement(generation); });
    guard();
  }
  function translateExtras() {
    $('#asset-search-label').text(t('r2Assets.search', null, 'Search title, key or description'));
    $('#asset-status-filter-label').text(t('common.status', null, 'Status'));
    $('#asset-description-help').text(t('r2Assets.descriptionHelp', null, 'Describe the user need and acceptance criteria. The template is optional and fully editable.'));
    $('#asset-description-template').text(t('r2Assets.useTemplate', null, 'Use acceptance criteria template'));
    $('#asset-ready').text(t('r2Assets.checkReady', null, 'Check and mark Ready'));
    $('#asset-trace-load').text(t('r2Assets.viewCoverage', null, 'View requirement coverage'));
    $('#trace-search-label').text(t('r2Assets.searchCandidates', null, 'Search link candidates'));
    $('#asset-form-check-read').text(t('r2Assets.checkLatest', null, 'Read latest saved definition'));
    $('#asset-use-latest-version').text(t('r2Assets.useLatestVersion', null, 'I reviewed it — keep my draft with this version'));
    $('#asset-source-retry').text(t('r2Assets.retrySourceRead', null, 'Read source requirement again'));
    renderSourceContext(); renderFormFeedback();
    if (latestFormValue) renderLatestSummary(latestFormValue);
    if (!$('#asset-form').hasClass('d-none')) $('#asset-save').text(view === 'test-cases' ? t('r2Assets.saveDraft', null, 'Save definition') : t('common.save', null, 'Save'));
    const statuses = view === 'requirements' ? ['DRAFT', 'ACTIVE', 'ARCHIVED'] : ['DRAFT', 'READY', 'ARCHIVED'];
    $('#asset-status-filter').empty().append($('<option>').val('').text(t('r2Assets.allStates', null, 'All states')));
    statuses.forEach(function (value) { $('#asset-status-filter').append($('<option>').val(value).text(label(value))); });
    $('#asset-status-filter').val(statusFilter);
  }
  function loadPermissions(force) {
    const selected = projectId;
    permissionState = 'loading'; qaContext = null; updateControls();
    if (!selected || !window.VeriqraQaContext) { permissionState = 'error'; updateControls(); return; }
    return window.VeriqraQaContext.load(selected, !!force).done(function (context) {
      if (!sameId(projectId, selected)) return;
      qaContext = context; permissionState = 'loaded'; updateControls();
      if (detail) { renderPrimaryActions(); renderReady(); if (traceState === 'loaded') renderLinks(currentLinks); }
      const current = routeContext();
      if (current.action === 'create' && $('#asset-form').hasClass('d-none')) showForm(false, current);
    }).fail(function () { if (sameId(projectId, selected)) { permissionState = 'error'; qaContext = null; updateControls(); } });
  }
  async function checkFormLatest() {
    if (!editing || !detail || !projectId || !active() || writing || formCheckLoading || $('#asset-form').hasClass('d-none')) return;
    const token = generation, id = detail.row.id, selectedProject = projectId;
    formCheckLoading = true; latestFormValue = null; updateControls();
    $('#asset-form-recovery').removeClass('d-none'); $('#asset-use-latest-version').addClass('d-none'); $('#asset-form-latest').empty();
    recoveryMessage(translated('common.loading', null, 'Loading…'));
    try {
      const response = await api.get(base(kind()) + '/' + encodeURIComponent(id));
      if (!valid(token) || $('#asset-form').hasClass('d-none')) return;
      const current = { row: view === 'requirements' ? response : response.testCase, steps: view === 'requirements' ? [] : response.steps };
      if (!sameId(current.row.id, id) || !sameId(current.row.projectId, selectedProject)) throw { status: 409 };
      reconcileSavedUpdate(current);
      if (current.row.version === detail.row.version && !formNeedsReview) {
        recoveryMessage(translated('r2Assets.versionUnchanged', null, 'Session and saved version verified. Your draft is preserved; nothing was submitted.'));
        return;
      }
      formNeedsReview = true; latestFormValue = current;
      recoveryMessage(translated('r2Assets.latestReview', null, 'The saved definition changed. Compare it below with your retained draft. Saving stays paused until you explicitly review the new version.'));
      renderLatestSummary(current);
      $('#asset-use-latest-version').toggleClass('d-none', !canWrite() || current.row.status === 'ARCHIVED');
    } catch (failure) { if (valid(token)) {
      formNeedsReview = true;
      mutationError(failure); recoveryMessage(failure);
    } } finally { if (valid(token)) { formCheckLoading = false; updateControls(); } }
  }
  function renderLatestSummary(current) {
    const summary = $('<dl class="asset-fields">').append(statusField(current.row.status), field(t('common.version', null, 'Version'), current.row.version),
      field(t('common.title', null, 'Title'), current.row.title), field(t('common.description', null, 'Description'), current.row.description), field(t('common.priority', null, 'Priority'), label(current.row.priority)));
    if (view === 'test-cases') {
      summary.append(field(t('assets.preconditions', null, 'Preconditions'), current.row.preconditions));
      current.steps.forEach(function (step) { summary.append(field(t('assets.stepNumber', { number: step.stepOrder }, 'Step {number}'), step.action + '\n' + step.expectedResult)); });
    }
    $('#asset-form-latest').empty().append(summary);
  }
  function renderSourceContext() {
    const hasSource = !editing && view === 'test-cases' && !!formContext.sourceRequirementId;
    $('#asset-source-retry').toggleClass('d-none', !hasSource || sourceRequirementState !== 'error').prop('disabled', writing || sourceRequirementState === 'loading');
    if (!hasSource) { $('#asset-form-context').text(''); return; }
    const target = $('#asset-form-context').empty();
    if (sourceRequirementState === 'ready' && sourceRequirement) target.text(t('r2Assets.namedRequirementContext',
      { name: 'REQ-' + String(sourceRequirement.keyNo).padStart(3, '0') + ' · ' + sourceRequirement.title },
      'Source requirement: {name}. Saving this case will then create its coverage link as a separate operation. Review that link explicitly afterwards.'));
    else target.text(t(sourceRequirementState === 'loading' ? 'r2Assets.loadingSource' : 'r2Assets.sourceUnavailable', null,
      sourceRequirementState === 'loading' ? 'Checking the source requirement before creating a linked case…' : 'The source requirement could not be verified. No case has been created. Read it again or return to a valid requirement.')
      + (sourceFailure ? ' ' + feedbackText(sourceFailure) : ''));
  }
  async function verifySourceRequirement(token) {
    const selectedProject = projectId, id = formContext.sourceRequirementId;
    const request = ++sourceRequest;
    const current = function () { return request === sourceRequest && valid(token) && view === 'test-cases' && !editing && !$('#asset-form').hasClass('d-none') && sameId(formContext.sourceRequirementId, id) && sameId(projectId, selectedProject); };
    if (!id || !current()) return false;
    sourceRequirement = null; sourceRequirementState = 'loading'; sourceFailure = null; renderSourceContext(); updateControls();
    try {
      const row = await api.get(base('requirements') + '/' + encodeURIComponent(id));
      if (!current()) return false;
      if (!sameId(row.id, id) || !sameId(row.projectId, selectedProject) || !['DRAFT', 'ACTIVE'].includes(row.status)) throw translated('r2Assets.sourceInvalid', null, 'This source requirement is archived or does not belong to the selected project. Choose a valid requirement before creating this case.');
      sourceRequirement = row; sourceRequirementState = 'ready'; renderSourceContext(); return true;
    } catch (failure) { if (current()) { sourceRequirementState = 'error'; sourceFailure = descriptor(failure); if (failure.status === 401 || failure.status === 403) mutationError(failure); renderSourceContext(); } return false; }
    finally { if (current()) updateControls(); }
  }
  function routeContext() {
    const nav = navigation();
    const context = nav ? nav.read() : {};
    return !context.projectId || sameId(context.projectId, projectId) ? context : {};
  }
  function selectedContext(id) {
    const context = { projectId: projectId };
    context[view === 'requirements' ? 'requirementId' : 'testCaseId'] = String(id);
    const current = routeContext();
    ['sourceRequirementId', 'sourceTestCaseId', 'sourcePlanId', 'runId', 'runCaseId', 'attemptId'].forEach(function (name) {
      if (current[name]) context[name] = String(current[name]);
    });
    return context;
  }
  function originContext() {
    const context = { projectId: projectId };
    const current = routeContext();
    ['sourcePlanId', 'runId', 'runCaseId', 'attemptId'].forEach(function (name) {
      if (current[name]) context[name] = String(current[name]);
    });
    return context;
  }
  function selectContext(context) { const nav = navigation(); if (nav) nav.select(view, context); }
  function linkTo(nextView, context, text, primary) {
    const nav = navigation();
    const link = $('<a>').addClass('btn btn-' + (primary ? 'primary' : 'outline-secondary') + ' btn-sm')
      .attr('href', nav ? nav.href(nextView, context) : '#' + nextView).text(text);
    link.on('click', function (event) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.button != null && event.button !== 0)) return;
      if (nav) { event.preventDefault(); nav.open(nextView, context); }
      else if (nextView === view && (context.requirementId || context.testCaseId)) {
        event.preventDefault(); openDetail(context.requirementId || context.testCaseId);
      }
    });
    return link;
  }
  function updateControls() {
    $('#asset-new').prop('disabled', !canWrite() || writing);
    $('#asset-edit').prop('disabled', !writable() || writing);
    $('#asset-save').prop('disabled', !canWrite() || writing || formNeedsReview || formCheckLoading || (!editing && view === 'test-cases' && formContext.sourceRequirementId && sourceRequirementState !== 'ready') || uncertainWrites.has(scopeKey(kind(), editing && detail ? detail.row.id : null)));
    $('#asset-form-check-read').prop('disabled', writing || formCheckLoading);
    $('#asset-use-latest-version').prop('disabled', writing || formCheckLoading || !canWrite());
    $('#asset-source-retry').prop('disabled', writing || sourceRequirementState === 'loading');
    $('#asset-ready').prop('disabled', !writable() || writing || (detail && detail.row.status === 'READY') || uncertainWrites.has(scopeKey('ready', detail && detail.row.id)));
    $('#trace-add-button').prop('disabled', !writable() || writing || traceState !== 'loaded');
    $('#trace-submit').prop('disabled', !writable() || writing || traceState !== 'loaded' || !$('#trace-target').val());
    $('#asset-traces button, #asset-primary-actions a').attr('aria-disabled', writing ? 'true' : 'false');
    $('#asset-traces button, #asset-primary-actions button').prop('disabled', writing);
    $('#asset-partial-link-retry').prop('disabled', writing || !canWrite());
    $('#asset-permission-note').text(permissionState === 'loading' ? t('r2Assets.permissionsLoading', null, 'Checking project permissions…')
      : permissionState !== 'loaded' ? t('r2Assets.permissionsUnknown', null, 'Permissions could not be verified. Reopen the project after signing in; changes are disabled.')
      : canWrite() ? t('r2Assets.writerRole', { role: label(qaContext.systemRole === 'ADMIN' ? 'ADMIN' : qaContext.projectRole || qaContext.systemRole) }, 'Your role: {role}. You can maintain QA assets; review links and Ready states explicitly.')
      : t('r2Assets.readerRole', { role: label(qaContext.projectRole || qaContext.systemRole) }, 'Your role: {role}. QA assets are read-only. Ask a project TESTER or platform ADMIN to maintain them; a PM title alone does not grant this permission.'));
  }
  function conflict(failure) { return failure.status === 409 ? t('assets.conflict', null,
    'This item changed or cannot be edited in its current state. Reload its latest details before trying again.') : failure.message || t('r2Assets.requestFailed', null, 'The request could not be completed. Check your session and reload the saved state.'); }

  function notice(message, error) {
    $('#asset-notice').text(message || '').toggleClass('d-none', !message)
      .toggleClass('alert-danger', !!error).toggleClass('alert-success', !!message && !error);
  }
  function translated(key, args, fallback) { return { messageKey: key, messageArgs: args, messageFallback: fallback }; }
  function descriptor(value) {
    if (!value) return null;
    if (typeof value === 'string') return { text: value };
    if (value.messageKey) return { messageKey: value.messageKey, messageArgs: value.messageArgs, messageFallback: value.messageFallback };
    if (value.status === 409) return translated('assets.conflict', null, 'This item changed or cannot be edited in its current state. Reload its latest details before trying again.');
    return { text: value.message || t('r2Assets.requestFailed', null, 'The request could not be completed. Check your session and reload the saved state.') };
  }
  function feedbackText(value) { return value ? value.messageKey ? t(value.messageKey, value.messageArgs, value.messageFallback) : value.text : ''; }
  function renderFormFeedback() {
    const message = feedbackText(formErrorDescriptor);
    $('#asset-form-error').text(message).toggleClass('d-none', !message);
    $('#asset-form-recovery-message').text(feedbackText(recoveryDescriptor));
  }
  function formError(message) { formErrorDescriptor = descriptor(message); renderFormFeedback(); }
  function recoveryMessage(message) { recoveryDescriptor = descriptor(message); renderFormFeedback(); }
  function focusHeading(selector) { $(selector).attr('tabindex', '-1').trigger('focus'); }
  function reset() {
    if (window.VeriqraAiCases) window.VeriqraAiCases.clear();
    generation++;
    rows = [];
    detail = null;
    detailId = null;
    currentLinks = [];
    editing = false;
    traceState = 'idle'; writing = false; formContext = {}; pendingLink = null; formBaseline = null; traceCandidates = []; formNeedsReview = false; latestFormValue = null; formCheckLoading = false;
    recoveryDescriptor = null; sourceRequirement = null; sourceRequirementState = 'none'; sourceFailure = null; sourceRequest++;
    root.find('#asset-list, #asset-detail, #asset-steps, #asset-traces, #step-editor').empty();
    $('#asset-save, #trace-add-button, #trace-submit').prop('disabled', false);
    root.find('#asset-list-panel, #asset-detail-panel, #asset-form, #trace-form').addClass('d-none');
    $('#asset-list-status').text('');
    $('#asset-primary-actions').empty();
    $('#asset-ready-panel').addClass('d-none');
    $('#asset-form-recovery').addClass('d-none');
    $('#asset-source-retry').addClass('d-none');
    $('#asset-readonly-note, #asset-trace-load, #asset-trace-retry, #asset-partial-link-panel').addClass('d-none');
    $('#asset-trace-status, #asset-form-context, #asset-form-guidance').text('');
    notice(''); formError('');
  }
  function panels(which) {
    $('#asset-list-panel').toggleClass('d-none', which !== 'list');
    $('#asset-detail-panel').toggleClass('d-none', which !== 'detail');
    $('#asset-form').toggleClass('d-none', which !== 'form');
    $('#trace-form').addClass('d-none');
  }
  function badge(status) {
    const colors = { DRAFT: 'secondary', ACTIVE: 'success', READY: 'success', ARCHIVED: 'secondary', CONFIRMED: 'success', NEEDS_REVIEW: 'warning', REMOVED: 'secondary' };
    return $('<span class="badge text-bg-' + (colors[status] || 'secondary') + '">').attr('data-vq-state', status).text(label(status));
  }
  function field(term, value) {
    return $('<div class="asset-field">').append($('<dt>').text(term), $('<dd>').text(value == null || value === '' ? '—' : String(value)));
  }
  function statusField(status) {
    return $('<div class="asset-field">').append($('<dt>').text(t("common.status", null, 'Status')), $('<dd>').append(badge(status)));
  }
  function key(row) { return (view === 'requirements' ? 'REQ-' : 'TC-') + String(row.keyNo).padStart(3, '0'); }

  async function list() {
    if (!projectId || !active()) return;
    if (window.VeriqraAiCases) window.VeriqraAiCases.clear();
    const token = ++generation;
    detail = null; detailId = null; writing = false; formBaseline = null;
    pendingLink = null;
    selectContext({ projectId: projectId });
    panels('list'); notice('');
    $('#asset-list-title').text(view === 'requirements' ? t("common.requirements", null, 'Requirements') : t("common.testCases", null, 'Test cases'));
    $('#asset-new').text(view === 'requirements' ? t("assets.createRequirement", null, 'Create requirement') : t("assets.createTestCase", null, 'Create test case'));
    $('#asset-list').empty();
    $('#asset-list-status').text(t("common.loading", null, 'Loading…'));
    focusHeading('#asset-list-title');
    try {
      const result = await api.get(base(kind()));
      if (!valid(token)) return;
      rows = result;
      $('#asset-list-status').text(result.length ? t('assets.itemCount', { count: window.I18n.formatNumber(result.length) }, '{count} item(s)')
        : t("assets.noItemsYetCreateTheFirstOne", null, 'No items yet. Create the first one.'));
      translateExtras(); renderList();
    } catch (failure) { if (valid(token)) {
      rows = [];
      $('#asset-list-status').text(t('common.unavailable', null, 'Unavailable')); notice(failure.message, true);
      $('#asset-list').append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('common.retry', null, 'Retry')).on('click', function () { if (valid(token)) return list(); }));
    } }
  }
  function renderList() {
    const query = searchText.trim().toLocaleLowerCase();
    const filtered = rows.filter(function (item) { return (!statusFilter || item.status === statusFilter)
      && (!query || [key(item), item.title, item.description || ''].join(' ').toLocaleLowerCase().includes(query)); });
    $('#asset-search').val(searchText); $('#asset-status-filter').val(statusFilter);
    $('#asset-list').empty();
    $('#asset-filter-count').text(t('r2Assets.filterCount', { shown: filtered.length, total: rows.length }, 'Showing {shown} of {total} loaded items. Search applies to this loaded project list.'));
    if (rows.length && !filtered.length) $('#asset-list').append($('<p class="text-secondary">').text(t('r2Assets.noMatches', null, 'No matching items. Clear the search or change the state filter.')));
      filtered.forEach(function (item) {
        const card = $('<div class="asset-list-row">');
        const summary = $('<div class="asset-list-summary">').append(
          $('<strong>').text(key(item) + ' · ' + item.title),
          $('<p class="mb-1 text-secondary">').text(item.description || t("common.noDescription", null, 'No description')));
        const meta = $('<div class="asset-list-meta">').append(badge(item.status),
          $('<span>').text(label(item.priority)), $('<small>').text('v' + item.version));
        const context = { projectId: projectId };
        context[view === 'requirements' ? 'requirementId' : 'testCaseId'] = String(item.id);
        const open = linkTo(view, context, t('assets.viewItem', { key: key(item) }, 'View {key}'));
        card.append(summary, meta, open);
        $('#asset-list').append(card);
      });
  }

  async function linksForCase(caseId, token) {
    const links = await api.get(base('test-cases') + '/' + encodeURIComponent(caseId) + '/requirements');
    if (!valid(token)) return [];
    return links.map(function (entry) { return { requirement: entry.requirement, link: { status: entry.status } }; });
  }

  async function openDetail(id, message) {
    const token = ++generation;
    detail = null;
    detailId = String(id);
    currentLinks = [];
    traceState = 'idle'; writing = false;
    selectContext(selectedContext(id));
    editing = false;
    panels('detail'); notice('');
    $('#asset-detail-title').text(t("common.loading", null, 'Loading…'));
    focusHeading('#asset-detail-title');
    $('#asset-detail, #asset-steps, #asset-traces').empty();
    $('#asset-primary-actions').empty();
    $('#asset-ready-panel').addClass('d-none');
    $('#asset-readonly-note, #asset-trace-load, #asset-trace-retry, #asset-partial-link-panel').addClass('d-none');
    $('#asset-trace-status').text(''); updateControls();
    if (pendingLink && sameId(pendingLink.caseId, id)) showPendingLink();
    try {
      const current = await api.get(base(kind()) + '/' + encodeURIComponent(id));
      if (!valid(token)) return;
      const row = view === 'requirements' ? current : current.testCase;
      detail = { row: row, steps: view === 'test-cases' ? current.steps : [] };
      const reconciled = reconcileSavedUpdate(detail);
      $('#asset-detail-title').text(key(row) + ' · ' + row.title);
      $('#asset-detail').append($('<dl class="asset-fields">').append(
        statusField(row.status), field(t("common.priority", null, 'Priority'), label(row.priority)),
        field(t("common.description", null, 'Description'), row.description), field(t("common.version", null, 'Version'), row.version), field(t("common.updated", null, 'Updated'), window.I18n.formatDateTime(row.updatedAt))));
      $('#asset-steps-section').toggleClass('d-none', view !== 'test-cases');
      if (view === 'test-cases') {
        $('#asset-detail dl').append(field(t("assets.preconditions", null, 'Preconditions'), row.preconditions));
        renderSteps(current.steps);
      }
      $('#asset-readonly-note').text(t(projectArchived ? 'assets.projectReadOnly' : 'assets.readOnly'))
        .toggleClass('d-none', !projectArchived && row.status !== 'ARCHIVED');
      renderPrimaryActions(); renderReady(); updateControls();
      $('#trace-help').text(view === 'requirements' ? t("assets.linkedTestCasesIncludingRemovedHistory", null, 'Linked test cases, including removed history.') : t("assets.linkedRequirementsIncludingRemovedHistory", null, 'Linked requirements, including removed history.'));
      $('#trace-help').append(document.createTextNode(' ' + t('assets.traceMeaning', null, 'Link status describes coverage review, not an execution result.')));
      if (message) notice(message);
      else if (reconciled) notice(t('r2Assets.saveObserved', null, 'The previously uncertain save is now visible in the saved definition. No request was repeated.'));
      if (pendingLink && sameId(pendingLink.caseId, row.id)) showPendingLink();
      if (view === 'requirements') await loadTraceability();
      else {
        $('#asset-trace-status').text(t('assets.traceNotLoaded', null, 'Load linked requirements before changing links.'));
        $('#asset-trace-load').removeClass('d-none');
      }
      return valid(token) && detail && sameId(detail.row.id, id);
    } catch (failure) { if (valid(token)) {
      $('#asset-detail-title').text(t('common.unavailable', null, 'Unavailable')); notice(failure.message, true); updateControls();
      $('#asset-primary-actions').append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('common.retry', null, 'Retry')).on('click', function () {
          if (valid(token) && !writing && sameId(detailId, id)) return openDetail(id, message);
        }));
    } }
  }
  function renderPrimaryActions() {
    if (window.VeriqraAiCases) window.VeriqraAiCases.mount(view === 'requirements' && detail ? { projectId: projectId, requirement: detail.row, writable: writable() } : null);
    const current = routeContext();
    const target = $('#asset-primary-actions').empty();
    if (current.sourceRequirementId && view === 'test-cases') target.append(linkTo('requirements',
      Object.assign(originContext(), { requirementId: current.sourceRequirementId, sourceTestCaseId: String(detail.row.id) }), t('assets.backToRequirement')));
    if (current.sourceTestCaseId && view === 'requirements') target.append(linkTo('test-cases',
      Object.assign(originContext(), { testCaseId: current.sourceTestCaseId }), t('assets.backToTestCase')));
    if (current.sourcePlanId) target.append(linkTo('test-plans', { projectId: projectId, planId: current.sourcePlanId }, t('assets.backToPlan')));
    if (current.runId && current.runCaseId) target.append(linkTo('runs',
      { projectId: projectId, runId: current.runId, runCaseId: current.runCaseId, attemptId: current.attemptId }, t('shell.backToRun')));
    if (!writable()) return;
    target.append(view === 'requirements' ? linkTo('test-cases',
      { projectId: projectId, action: 'create', sourceRequirementId: String(detail.row.id) }, t('assets.createLinkedTestCase'), true)
      : linkTo('test-plans', { projectId: projectId, action: 'create', sourceTestCaseId: String(detail.row.id) }, t('assets.createPlanWithCase'), true));
  }
  function readyProblems(value) {
    const result = [];
    if (!value.row.title || !value.row.title.trim()) result.push(t('assets.titleIsRequired', null, 'Title is required.'));
    if (!value.steps.length) result.push(t('assets.readyNeedsStep', null, 'Add at least one complete step before marking the case Ready.'));
    value.steps.forEach(function (step, index) {
      if (!step.action || !step.action.trim() || !step.expectedResult || !step.expectedResult.trim()) result.push(t('r2Assets.incompleteStep', { number: index + 1 }, 'Step {number} needs both an action and expected result.'));
    });
    if (value.row.status === 'ARCHIVED') result.push(t('assets.readOnly', null, 'This asset is archived and read-only.'));
    return result;
  }
  function readyBody(value) {
    // Preserve semantic bytes; Ready is an explicit state review, never a definition rewrite.
    return { title: value.row.title, description: value.row.description, preconditions: value.row.preconditions,
      priority: value.row.priority, status: 'READY', expectedVersion: value.row.version,
      steps: value.steps.map(function (step) { return { stepOrder: step.stepOrder, action: step.action, expectedResult: step.expectedResult }; }) };
  }
  function sameReadyDefinition(current, body) {
    const next = readyBody(current);
    return ['title', 'description', 'preconditions', 'priority', 'steps'].every(function (name) { return JSON.stringify(next[name]) === JSON.stringify(body[name]); });
  }
  function renderReady() {
    $('#asset-ready-panel').toggleClass('d-none', !detail || view !== 'test-cases');
    if (!detail || view !== 'test-cases') return;
    const problems = readyProblems(detail);
    $('#asset-ready-checks').text(detail.row.status === 'READY'
      ? t('r2Assets.alreadyReady', null, 'This case is Ready. Changing its title, description, preconditions or steps will require review again; execution history stays frozen.')
      : (problems.length ? problems.join(' ') : t('r2Assets.readyComplete', null, 'The saved steps are complete. Check the saved definition, then explicitly mark it Ready. Coverage links still require a separate human review.')));
    const lock = uncertainWrites.get(scopeKey('ready', detail.row.id));
    if (lock && detail.row.status === 'READY' && sameReadyDefinition(detail, lock.body) && detail.row.version > lock.body.expectedVersion) uncertainWrites.delete(scopeKey('ready', detail.row.id));
    $('#asset-ready').toggleClass('d-none', detail.row.status === 'ARCHIVED' || detail.row.status === 'READY');
  }
  async function checkAndReady() {
    if (view !== 'test-cases' || !writable() || writing || detail.row.status === 'READY') return;
    const token = generation, id = detail.row.id, selectedProject = projectId;
    const lockKey = scopeKey('ready', id);
    if (uncertainWrites.has(lockKey)) { notice(t('r2Assets.unknownWrite', null, 'The previous result is uncertain. Check the saved object using read-only reload; do not submit the change again.'), true); return; }
    writing = true; updateControls(); notice('');
    let sent = false, body;
    try {
      const permissions = await window.VeriqraQaContext.load(selectedProject, true);
      if (!valid(token)) return;
      qaContext = permissions; permissionState = 'loaded';
      if (!canWrite()) { notice(t('r2Assets.readyForbidden', null, 'Your current role cannot mark QA assets Ready. Ask a project TESTER or platform ADMIN.'), true); return; }
      const current = await api.get(base('test-cases') + '/' + encodeURIComponent(id));
      if (!valid(token)) return;
      if (!sameId(current.testCase.id, id) || !sameId(current.testCase.projectId, selectedProject)) throw { status: 409 };
      const checked = { row: current.testCase, steps: current.steps };
      const problems = readyProblems(checked);
      if (problems.length) { notice(problems.join(' '), true); return; }
      if (checked.row.status === 'READY') { await openDetail(id, t('r2Assets.alreadyReadyShort', null, 'The saved case is already Ready.')); return; }
      if (checked.row.version !== detail.row.version) {
        await openDetail(id, t('r2Assets.readyVersionChanged', null, 'The saved case changed since you opened it. Review the latest definition shown here, then choose Check and mark Ready again. No update was sent.'));
        return;
      }
      body = readyBody(checked); sent = true;
      await api.put(base('test-cases') + '/' + encodeURIComponent(id), body);
      if (valid(token)) await openDetail(id, t('r2Assets.readySaved', null, 'Case marked Ready. Next, review requirement coverage, or create a plan with this case.'));
    } catch (failure) { if (valid(token)) {
      if (sent && unknown(failure)) uncertainWrites.set(lockKey, { body: body });
      notice(sent && unknown(failure) ? t('r2Assets.unknownWrite', null, 'The previous result is uncertain. Check the saved object using read-only reload; do not submit the change again.') : mutationError(failure), true);
      if (sent && unknown(failure)) $('#asset-primary-actions').append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('r2Assets.reconcile', null, 'Check saved state (read only)')).on('click', function () { if (valid(token)) return openDetail(id); }));
    } } finally { if (valid(token)) { writing = false; updateControls(); } }
  }
  async function loadTraceability() {
    if (!detail || traceState === 'loading' || writing) return;
    const id = detail.row.id;
    const token = generation;
    traceState = 'loading'; currentLinks = [];
    $('#asset-traces').empty(); $('#trace-form').addClass('d-none');
    $('#asset-trace-load, #asset-trace-retry').addClass('d-none');
    $('#asset-trace-status').text(t('assets.loadingTraceability', null, 'Loading traceability…')); updateControls();
    try {
      const links = view === 'requirements' ? await api.get(base('requirements') + '/' + id + '/test-cases') : await linksForCase(id, token);
      if (!valid(token) || !detail || !sameId(detail.row.id, id)) return;
      traceState = 'loaded'; $('#asset-trace-status').text(''); renderLinks(links); updateControls();
    } catch (failure) { if (valid(token) && detail && sameId(detail.row.id, id)) {
      traceState = 'error';
      $('#asset-trace-status').text(t('assets.traceLoadFailed', null, 'Traceability could not be loaded. Retry before changing links.') + ' ' + failure.message);
      $('#asset-trace-retry').removeClass('d-none'); updateControls();
    } }
  }
  function renderSteps(steps) {
    const target = $('#asset-steps').empty();
    if (!steps.length) { target.append($('<p class="text-secondary">').text(t("assets.noStepsYet", null, 'No steps yet.'))); return; }
    steps.forEach(function (step) {
      target.append($('<div class="asset-step">').append(
        $('<strong>').text(t('assets.stepNumber', { number: step.stepOrder }, 'Step {number}')),
        $('<div>').append($('<span class="text-secondary">').text(t("assets.action", null, 'Action: ')), document.createTextNode(step.action)),
        $('<div>').append($('<span class="text-secondary">').text(t("assets.expected", null, 'Expected: ')), document.createTextNode(step.expectedResult))));
    });
  }
  function renderLinks(links) {
    currentLinks = links;
    const target = $('#asset-traces').empty();
    if (!links.length) { target.append($('<p class="text-secondary">').text(t("assets.noTraceabilityRecordsYet", null, 'No traceability records yet.'))); return; }
    links.forEach(function (entry) {
      const row = view === 'requirements' ? entry.testCase : entry.requirement;
      const status = view === 'requirements' ? entry.status : entry.link.status;
      const requirementId = view === 'requirements' ? detail.row.id : row.id;
      const caseId = view === 'requirements' ? row.id : detail.row.id;
      ['', 'confirm', 'remove'].forEach(function (action) {
        if ((action === 'confirm' && status === 'CONFIRMED') || (action === 'remove' && status === 'REMOVED') || (!action && status !== 'REMOVED')) uncertainWrites.delete(scopeKey('trace-' + action, requirementId + '/' + caseId));
      });
      const item = $('<div class="asset-link-row">').append(
        $('<span>').text((view === 'requirements' ? 'TC-' : 'REQ-') + String(row.keyNo).padStart(3, '0') + ' · ' + row.title), badge(status), badge(row.status));
      item.append(view === 'requirements' ? linkTo('test-cases', Object.assign(originContext(), { testCaseId: String(caseId), sourceRequirementId: String(requirementId) }), t('assets.openTestCase'))
        : linkTo('requirements', Object.assign(originContext(), { requirementId: String(requirementId), sourceTestCaseId: String(caseId) }), t('assets.openRequirement')));
      if (writable() && row.status !== 'ARCHIVED') {
        if (status === 'NEEDS_REVIEW') item.append(actionButton(t("common.confirm", null, 'Confirm'), 'confirm', requirementId, caseId, row.title));
        if (status !== 'REMOVED') item.append(actionButton(t("assets.markRemoved", null, 'Mark removed'), 'remove', requirementId, caseId, row.title));
        if (status === 'REMOVED') item.append(actionButton(t("assets.reattach", null, 'Reattach'), '', requirementId, caseId, row.title));
      }
      target.append(item);
    });
  }
  function actionButton(text, action, reqId, caseId, name) {
    return $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(text).on('click', async function () {
      if (!writable() || writing || traceState !== 'loaded') return;
      const lockKey = scopeKey('trace-' + action, reqId + '/' + caseId);
      if (uncertainWrites.has(lockKey)) { notice(t('r2Assets.unknownWrite', null, 'The previous result is uncertain. Check the saved object using read-only reload; do not submit the change again.'), true); return; }
      if (action === 'remove' && !window.confirm(t('assets.removeLinkConfirm', { name: name },
        'Mark the link to "{name}" as REMOVED? The history will remain.'))) return;
      const token = generation;
      const id = detail.row.id;
      writing = true; updateControls();
      try {
        const path = base('requirements') + '/' + reqId + '/test-cases/' + caseId + (action ? '/' + action : '');
        await api.post(path, {});
        if (valid(token)) { const opened = await openDetail(id); if (opened && view === 'test-cases') await loadTraceability(); }
      } catch (failure) { if (valid(token)) {
        if (unknown(failure)) uncertainWrites.set(lockKey, true);
        notice(unknown(failure) ? t('r2Assets.unknownTrace', null, 'The link result is uncertain. Reload coverage to inspect the saved state before any further action.') : mutationError(failure), true);
        $('#asset-trace-retry').removeClass('d-none');
      } }
      finally { if (valid(token)) { writing = false; updateControls(); } }
    });
  }

  function stepRow(step) {
    const row = $('<div class="step-editor-row">');
    const actionId = 'step-action-' + Math.random().toString(36).slice(2);
    const expectedId = 'step-expected-' + Math.random().toString(36).slice(2);
    row.append($('<strong class="step-number">').text(t("assets.step", null, 'Step')),
      $('<label class="form-label">').attr('for', actionId).text(t("assets.actionMessage", null, 'Action *')),
      $('<textarea class="form-control step-action" rows="2" required>').attr('id', actionId).val(step.action || ''),
      $('<label class="form-label mt-2">').attr('for', expectedId).text(t("assets.expectedResult", null, 'Expected result *')),
      $('<textarea class="form-control step-expected" rows="2" required>').attr('id', expectedId).val(step.expectedResult || ''));
    const controls = $('<div class="step-actions">');
    [[t("assets.moveUp", null, 'Move up'), -1], [t("assets.moveDown", null, 'Move down'), 1]].forEach(function (entry) {
      controls.append($('<button type="button" class="btn btn-outline-secondary btn-sm">').text(entry[0]).on('click', function () {
        const sibling = entry[1] < 0 ? row.prev('.step-editor-row') : row.next('.step-editor-row');
        if (sibling.length) { if (entry[1] < 0) row.insertBefore(sibling); else row.insertAfter(sibling); renumberSteps(); }
      }));
    });
    controls.append($('<button type="button" class="btn btn-outline-danger btn-sm">').text(t("assets.removeStep", null, 'Remove step')).on('click', function () {
      if (window.confirm(t("assets.removeThisStepFromTheTestCaseDefinition", null, 'Remove this step from the test case definition?'))) { row.remove(); renumberSteps(); }
    }));
    row.append(controls);
    $('#step-editor').append(row);
    renumberSteps();
  }
  function renumberSteps() {
    $('#step-editor .step-number').each(function (index) { $(this).text(t('assets.stepNumber', { number: index + 1 }, 'Step {number}')); });
  }
  function showForm(update, context) {
    if (!projectId || !active() || !canWrite() || writing || (update && !writable())) return;
    generation++;
    editing = update;
    formNeedsReview = false; latestFormValue = null; formCheckLoading = false;
    recoveryDescriptor = null; sourceRequirement = null; sourceRequirementState = 'none'; sourceFailure = null; sourceRequest++;
    $('#asset-form-recovery').addClass('d-none');
    formContext = update ? {} : (context || {});
    $('#asset-save').prop('disabled', false);
    formError(''); notice('');
    const row = update ? detail.row : null;
    $('#asset-form')[0].reset();
    $('#asset-form-title').text(t(update ? (view === 'requirements' ? 'assets.editRequirement' : 'assets.editTestCase')
      : (view === 'requirements' ? 'assets.createRequirement' : 'assets.createTestCase')));
    renderSourceContext();
    $('#asset-form-guidance').text(t(view === 'test-cases' ? 'assets.definitionChangeHint' : 'assets.requirementChangeHint'));
    $('#asset-title').val(row ? row.title : '');
    $('#asset-description').val(row ? row.description || '' : '');
    $('#asset-priority').val(row ? row.priority : 'MEDIUM');
    $('#asset-status-wrap').toggleClass('d-none', !update);
    $('#asset-status').empty();
    (view === 'requirements' ? ['DRAFT', 'ACTIVE', 'ARCHIVED'] : ['DRAFT', 'READY', 'ARCHIVED']).forEach(function (status) {
      $('#asset-status').append($('<option>').val(status).text(label(status)));
    });
    if (row) $('#asset-status').val(row.status);
    $('#asset-case-fields').toggleClass('d-none', view !== 'test-cases');
    $('#asset-preconditions').val(row ? row.preconditions || '' : '');
    $('#step-editor').empty();
    if (view === 'test-cases' && update) detail.steps.forEach(stepRow);
    panels('form');
    $('#asset-description-tools').toggleClass('d-none', view !== 'requirements');
    $('#asset-save').text(view === 'test-cases' ? t('r2Assets.saveDraft', null, 'Save definition') : t('common.save', null, 'Save'));
    formBaseline = draftValue(); updateControls();
    $('#asset-title').trigger('focus');
    if (!update && view === 'test-cases' && formContext.sourceRequirementId) verifySourceRequirement(generation);
  }

  function showPendingLink() {
    $('#asset-partial-link-status').text(t('assets.caseCreatedLinkPendingWithId',
      { id: pendingLink.caseId, requirementId: pendingLink.requirementId },
      'Test case #{id} was created, but its link to requirement #{requirementId} could not be saved. Retry linking this saved case.')
      + (pendingLink.failureMessage ? ' ' + pendingLink.failureMessage : '')
      + (pendingLink.uncertain ? ' ' + t('r2Assets.unknownTrace', null, 'The link result is uncertain. Reload coverage to inspect the saved state before any further action.') : ''));
    $('#asset-partial-link-panel').removeClass('d-none');
    $('#asset-partial-link-retry').prop('disabled', writing || projectArchived);
  }
  async function attachCreatedCase(token, link) {
    // Case creation and traceability are separate existing API writes. Never repeat creation on link failure.
    try {
      if (link.uncertain) {
        const observed = await api.get(base('requirements') + '/' + link.requirementId + '/test-cases');
        if (!valid(token)) return;
        if (observed.some(function (entry) { return sameId(entry.testCase.id, link.caseId) && entry.status !== 'REMOVED'; })) {
          uncertainWrites.delete(scopeKey('trace-', link.requirementId + '/' + link.caseId));
          pendingLink = null;
          await openDetail(link.caseId, t('assets.caseLinked', null, 'Test case created and linked. Review the link to confirm coverage.'));
        } else notice(t('r2Assets.linkStillUncertain', null, 'No applied link was observed. The original request may still be in flight; no duplicate request was sent.'), true);
        return;
      }
      await api.post(base('requirements') + '/' + link.requirementId + '/test-cases/' + link.caseId, {});
      if (!valid(token)) return;
      pendingLink = null;
      await openDetail(link.caseId, t('assets.caseLinked', null, 'Test case created and linked. Review the link to confirm coverage.'));
    } catch (failure) {
      if (!valid(token)) return;
      if (failure.status === 409) {
        // An earlier response may have been lost after attach succeeded. Verify that specific relationship only.
        try {
          const existing = await api.get(base('requirements') + '/' + link.requirementId + '/test-cases');
          if (!valid(token)) return;
          if (existing.some(function (entry) { return sameId(entry.testCase.id, link.caseId) && entry.status !== 'REMOVED'; })) {
            pendingLink = null;
            await openDetail(link.caseId, t('assets.caseLinked', null, 'Test case created and linked. Review the link to confirm coverage.'));
            return;
          }
        } catch (_) { if (!valid(token)) return; }
      }
      if (unknown(failure)) uncertainWrites.set(scopeKey('trace-', link.requirementId + '/' + link.caseId), true);
      pendingLink = Object.assign({}, link, { failureMessage: mutationError(failure), uncertain: link.uncertain || unknown(failure) });
      await openDetail(link.caseId);
    }
  }
  function applyRoute(context) {
    const current = context || routeContext();
    if (current.projectId && !sameId(current.projectId, projectId)) return;
    const id = view === 'requirements' ? current.requirementId : current.testCaseId;
    if (current.action === 'create' && projectArchived) {
      list(); notice(t('assets.projectReadOnly', null, 'This project is archived and read-only.'), true);
    } else if (current.action === 'create') { showForm(false, current); updateControls(); }
    else if (id) openDetail(id);
    else list();
  }

  ensureExtras();
  $(document).on('veriqra:project', function (event) {
    reset();
    const project = event.originalEvent.detail.project;
    projectId = project ? String(project.id) : null;
    projectArchived = !!project && project.status === 'ARCHIVED';
    qaContext = null; permissionState = 'loading';
    searchText = ''; statusFilter = '';
    const current = routeContext();
    if (current.view) view = current.view;
    if (projectId && active()) applyRoute();
    loadPermissions();
  });
  $(document).on('veriqra:view', function (event) {
    const next = event.originalEvent.detail.view;
    reset(); view = next; searchText = ''; statusFilter = ''; translateExtras(); updateControls();
    if (projectId && active()) applyRoute(event.originalEvent.detail.context);
  });
  document.addEventListener('veriqra:localechange', function () {
    if (!projectId || !active()) return;
    translateExtras(); updateControls();
    if (!$('#asset-form').hasClass('d-none')) {
      $('#asset-form-title').text(t(editing ? (view === 'requirements' ? 'assets.editRequirement' : 'assets.editTestCase')
        : (view === 'requirements' ? 'assets.createRequirement' : 'assets.createTestCase')));
      $('#asset-status option').each(function () { $(this).text(label(this.value)); });
      renderSourceContext();
      $('#asset-form-guidance').text(t(view === 'test-cases' ? 'assets.definitionChangeHint' : 'assets.requirementChangeHint'));
      $('#step-editor .step-editor-row').each(function () {
        $(this).find('.step-action').prev('label').text(t('assets.actionMessage'));
        $(this).find('.step-expected').prev('label').text(t('assets.expectedResult'));
        $(this).find('.step-actions button').eq(0).text(t('assets.moveUp'));
        $(this).find('.step-actions button').eq(1).text(t('assets.moveDown'));
        $(this).find('.step-actions button').eq(2).text(t('assets.removeStep'));
      });
      renumberSteps();
    } else if (!$('#asset-detail-panel').hasClass('d-none')) {
      const current = routeContext();
      const id = current[view === 'requirements' ? 'requirementId' : 'testCaseId'] || (!navigation() && detailId);
      if (!id) return list();
      const loaded = detail && sameId(detail.row.id, id) && traceState === 'loaded';
      const loading = openDetail(id);
      const token = generation;
      loading.then(function (opened) { if (opened && valid(token) && loaded && view === 'test-cases') loadTraceability(); });
    }
    else list();
  });
  document.addEventListener('veriqra:reauthenticated', function () {
    if (!projectId || !active()) return;
    const token = generation;
    const permissions = loadPermissions(true);
    if (permissions) permissions.done(function () {
      if (!valid(token)) return;
      if (!$('#asset-form').hasClass('d-none')) { if (editing && detail) checkFormLatest(); else if (view === 'test-cases' && formContext.sourceRequirementId) verifySourceRequirement(token); }
      else if (detail) openDetail(detail.row.id);
    });
  });
  $('#asset-back').on('click', function () { if (!writing && confirmDiscard()) return list(); });
  $('#asset-new').on('click', function () {
    if (!canWrite() || writing || !confirmDiscard()) return;
    selectContext({ projectId: projectId, action: 'create' }); showForm(false);
  });
  $('#asset-edit').on('click', function () { if (detail) showForm(true); });
  $('#asset-form-cancel').on('click', function () { if (writing || !confirmDiscard()) return; if (editing && detail) openDetail(detail.row.id); else list(); });
  $('#step-add').on('click', function () { stepRow({}); });
  $('#asset-trace-load, #asset-trace-retry').on('click', loadTraceability);
  $('#asset-partial-link-retry').on('click', async function () {
    if (!pendingLink || writing || !canWrite() || view !== 'test-cases' || !sameId(pendingLink.caseId, detailId)) return;
    const token = generation;
    writing = true; updateControls();
    await attachCreatedCase(token, pendingLink);
    if (valid(token)) { writing = false; updateControls(); }
  });
  $('#asset-form').on('submit', async function (event) {
    event.preventDefault();
    if (writing || !canWrite() || $('#asset-save').prop('disabled') || uncertainWrites.has(scopeKey(kind(), editing && detail ? detail.row.id : null)) || !this.reportValidity()) return;
    const token = generation;
    const button = $('#asset-save').prop('disabled', true);
    formError('');
    const body = { title: $('#asset-title').val().trim(), description: $('#asset-description').val().trim() || null,
      priority: $('#asset-priority').val() };
    if (view === 'test-cases') {
      body.preconditions = $('#asset-preconditions').val().trim() || null;
      body.steps = $('#step-editor .step-editor-row').map(function (index) {
        return { stepOrder: index + 1, action: $(this).find('.step-action').val().trim(),
          expectedResult: $(this).find('.step-expected').val().trim() };
      }).get();
      if (body.steps.some(function (step) { return !step.action || !step.expectedResult; })) {
        formError(translated("assets.everyStepNeedsAnActionAndExpectedResult", null, 'Every step needs an action and expected result.')); button.prop('disabled', false); return;
      }
    }
    if (!body.title) { formError(translated("assets.titleIsRequired", null, 'Title is required.')); button.prop('disabled', false); return; }
    if (editing) {
      body.status = $('#asset-status').val();
      body.expectedVersion = detail.row.version;
      if (view === 'test-cases' && body.status === 'READY' && !body.steps.length) {
        formError(translated('assets.readyNeedsStep', null, 'Add at least one complete step before marking the case Ready.'));
        button.prop('disabled', false); return;
      }
      if (body.status === 'ARCHIVED' && detail.row.status !== 'ARCHIVED' && !window.confirm(t('assets.archiveConfirm',
        { title: detail.row.title }, 'Archive "{title}"?'))) {
        button.prop('disabled', false); return;
      }
    }
    const update = editing;
    const lockKey = scopeKey(kind(), update ? detail.row.id : null);
    const previousStatus = update ? detail.row.status : null;
    const semanticChange = update && view === 'test-cases' && ['title', 'description', 'preconditions', 'steps'].some(function (field) {
      return JSON.stringify(readyBody(detail)[field]) !== JSON.stringify(body[field]);
    });
    const expectedStatus = semanticChange && body.status !== 'ARCHIVED' ? 'DRAFT' : body.status;
    const linkRequirementId = !update && view === 'test-cases' ? formContext.sourceRequirementId : null;
    writing = true;
    try {
      if (linkRequirementId && !await verifySourceRequirement(token)) return;
      if (!valid(token)) return;
      const saved = update
        ? await api.put(base(kind()) + '/' + detail.row.id, body)
        : await api.post(base(kind()), body);
      if (!valid(token)) return;
      formBaseline = null;
      if (linkRequirementId) await attachCreatedCase(token, { requirementId: String(linkRequirementId), caseId: String(saved.id) });
      else await openDetail(saved.id, update && view === 'test-cases' && saved.status === 'DRAFT' && (body.status === 'READY' || previousStatus === 'READY')
        ? t('assets.savedDraft', null, 'Saved as Draft because the definition changed. Review affected links before marking Ready.')
        : t(view === 'requirements' ? 'r2Assets.requirementSaved' : 'r2Assets.caseSaved', null,
          view === 'requirements' ? 'Requirement saved. Next, create a linked test case.' : 'Case definition saved. Next, check and mark it Ready, then review requirement coverage.'));
    } catch (failure) {
      if (valid(token)) {
        if (unknown(failure)) uncertainWrites.set(lockKey, { body: body, expectedStatus: expectedStatus });
        if (update && failure.status === 409) {
          formNeedsReview = true; latestFormValue = null;
          $('#asset-form-recovery').removeClass('d-none'); $('#asset-use-latest-version').addClass('d-none'); $('#asset-form-latest').empty();
          recoveryMessage(translated('r2Assets.conflictDraft', null, 'Your draft is retained. Read the latest saved definition and compare it before using a newer version. Nothing was retried.'));
        }
        mutationError(failure);
        formError(unknown(failure) ? translated('r2Assets.unknownSave', null, 'Save result is uncertain. Your draft is retained. Do not save again; inspect the project list or saved object first. No automatic retry will be sent.') : failure);
      }
    } finally { if (token === generation) { writing = false; button.prop('disabled', false); updateControls(); } }
  });
  async function loadTraceTargets() {
    if (!writable() || writing || traceState !== 'loaded') return;
    const token = generation;
    const selection = ++tracePickerGeneration;
    const current = function () { return valid(token) && selection === tracePickerGeneration; };
    $('#trace-add-button, #trace-submit').prop('disabled', true); notice('');
    const target = $('#trace-target').empty().prop('disabled', true)
      .append($('<option>').val('').text(t('common.loading', null, 'Loading…')));
    $('#trace-form').removeClass('d-none');
    $('#trace-search').val(''); traceCandidates = [];
    focusHeading('#trace-target-label');
    try {
      const type = view === 'requirements' ? 'test-cases' : 'requirements';
      const options = await api.get(base(type));
      if (!current()) return;
      const linkedIds = currentLinks.map(function (link) {
        return String(view === 'requirements' ? link.testCase.id : link.requirement.id);
      });
      const eligible = options.filter(function (row) { return row.status !== 'ARCHIVED' && !linkedIds.includes(String(row.id)); });
      traceCandidates = eligible; traceTargetType = type; renderTraceCandidates();
      if (!target.children().length) target.append($('<option>').val('').text(t(!options.length
        ? (view === 'requirements' ? 'assets.noCasesForLink' : 'assets.noRequirementsForLink') : 'assets.noEligibleLinks')));
      $('#trace-target-label').text(view === 'requirements' ? t("assets.testCase", null, 'Test case') : t("assets.requirement", null, 'Requirement'));
      $('#trace-submit').prop('disabled', !eligible.length);
      $('#trace-form').removeClass('d-none');
      target.trigger('focus');
    } catch (failure) { if (current()) {
      target.empty().append($('<option>').val('').text(t('common.unavailable', null, 'Unavailable'))).prop('disabled', true);
      notice(failure.message, true);
      $('#asset-notice').append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">')
        .text(t('common.retry', null, 'Retry')).on('click', function () { if (current()) return loadTraceTargets(); }));
    } }
    finally { if (current()) updateControls(); }
  }
  function renderTraceCandidates() {
    const query = $('#trace-search').val().trim().toLocaleLowerCase();
    const selected = $('#trace-target').val();
    const candidates = traceCandidates.filter(function (row) { return !query || [(traceTargetType === 'test-cases' ? 'TC-' : 'REQ-') + String(row.keyNo).padStart(3, '0'), row.title].join(' ').toLocaleLowerCase().includes(query); });
    const target = $('#trace-target').empty().prop('disabled', !candidates.length);
    candidates.forEach(function (row) { target.append($('<option>').val(row.id).text((traceTargetType === 'test-cases' ? 'TC-' : 'REQ-') + String(row.keyNo).padStart(3, '0') + ' · ' + row.title + ' · ' + label(row.status))); });
    if (candidates.some(function (row) { return sameId(row.id, selected); })) target.val(selected);
    if (!candidates.length) target.append($('<option>').val('').text(t('r2Assets.noMatches', null, 'No matching items. Clear the search or change the state filter.')));
    updateControls();
  }
  $('#trace-add-button').on('click', loadTraceTargets);
  $('#trace-cancel').on('click', function () { ++tracePickerGeneration; $('#trace-form').addClass('d-none'); notice(''); updateControls(); $('#trace-add-button').trigger('focus'); });
  $('#trace-form').on('submit', async function (event) {
    event.preventDefault();
    if (!writable() || writing || traceState !== 'loaded' || !$('#trace-target').val()) return;
    const token = generation;
    const button = $('#trace-submit').prop('disabled', true);
    const reqId = view === 'requirements' ? detail.row.id : $('#trace-target').val();
    const caseId = view === 'requirements' ? $('#trace-target').val() : detail.row.id;
    const id = detail.row.id;
    const lockKey = scopeKey('trace-', reqId + '/' + caseId);
    if (uncertainWrites.has(lockKey)) { notice(t('r2Assets.unknownTrace', null, 'The link result is uncertain. Reload coverage to inspect the saved state before any further action.'), true); return; }
    writing = true; updateControls();
    try {
      await api.post(base('requirements') + '/' + reqId + '/test-cases/' + caseId, {});
      if (valid(token)) { const opened = await openDetail(id); if (opened && view === 'test-cases') await loadTraceability(); }
    } catch (failure) { if (valid(token)) {
      if (unknown(failure)) uncertainWrites.set(lockKey, true);
      notice(unknown(failure) ? t('r2Assets.unknownTrace', null, 'The link result is uncertain. Reload coverage to inspect the saved state before any further action.') : mutationError(failure), true);
      $('#asset-trace-retry').removeClass('d-none');
    } }
    finally { if (token === generation) { writing = false; button.prop('disabled', false); updateControls(); } }
  });
})(jQuery, window.VeriqraApi);
