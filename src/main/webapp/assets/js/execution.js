(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  // app.js owns the session, selected project and view. Every asynchronous render is scoped to its generation.
  let projectId = null;
  let view = 'dashboard';
  let generation = 0;
  let detail = null;
  let runCaseId = null;
  let editing = false;
  let pendingAttempt = null;
  let caseOptions = [];
  let formContext = {};
  let existingPlans = [];
  let selectedAttemptId = null;
  let recordedMessage = null;
  let renderedAttemptOwner = null;
  let localeAttemptDraft = null;
  let formLoading = false;
  let formWriting = false;
  let formCasesLoaded = false;
  let formPlansLoaded = false;
  let sourceCaseMissing = false;
  let planPreviewGeneration = 0;
  let planPreview = null;
  let completionImpact = null;
  let completionImpactGeneration = 0;
  let finishBusy = false;
  const submissions = new Map();
  const knownDefects = new Map();
  const active = function () { return view === 'test-plans' || view === 'runs'; };
  const valid = function (token) { return token === generation && !!projectId && active(); };
  const base = function (resource) { return 'projects/' + encodeURIComponent(projectId) + '/' + resource; };
  const path = function (id) { return base(view === 'test-plans' ? 'test-plans' : 'runs') + '/' + encodeURIComponent(id); };
  const label = function (value) { return window.I18n.enumLabel(value); };
  const date = function (value) { return window.I18n.formatDateTime(value); };
  const planKey = function (plan) { return 'TP-' + String(plan.keyNo).padStart(3, '0'); };
  const nav = function () { return window.VeriqraQaNavigation; };
  const idText = function (id) { return id == null ? null : String(id); };
  const sameId = function (a, b) { return idText(a) === idText(b); };
  const submissionContext = function (runId, caseId) { return projectId + '/' + runId + '/' + caseId; };
  function routeContext() {
    const current = nav() ? nav().read() : {};
    return current.projectId && !sameId(current.projectId, projectId) ? {} : current;
  }
  function runDestination(context) {
    const current = routeContext(), retained = {};
    // Retest identity follows navigation within the current Run. attemptId remains the viewed result,
    // while failureAttemptId always identifies the original FAIL chosen on the defect page.
    if (view === 'runs' && context.runId && sameId(context.runId, current.runId)) {
      ['sourceTestCaseId', 'defectId', 'failureAttemptId'].forEach(function (key) { if (current[key]) retained[key] = current[key]; });
    }
    return Object.assign({ projectId: projectId }, retained, context);
  }
  function selectRoute(context) { if (nav()) nav().select(view, view === 'runs' ? runDestination(context) : Object.assign({ projectId: projectId }, context)); }
  function routeLink(title, targetView, context, className) {
    const destination = targetView === 'runs' ? runDestination(context) : Object.assign({ projectId: projectId }, context);
    const link = $('<a>').addClass(className || 'btn btn-outline-primary btn-sm')
      .attr('href', nav() ? nav().href(targetView, destination) : '#' + targetView).text(title);
    link.on('click', function (event) {
      if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!nav()) return;
      event.preventDefault(); nav().open(targetView, destination);
    });
    return link;
  }
  function retry(target, callback) {
    $(target).append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
      .text(t('execution.retryLoad', null, 'Retry loading')).on('click', callback));
  }
  function reloadConflict(target, failure, callback) {
    if (failure.status === 409) $(target).append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">')
      .text(t('execution.reloadDetails', null, 'Reload latest details')).on('click', callback));
  }
  function progress(current, target) {
    const counts = { NOT_RUN: 0, PASS: 0, FAIL: 0, BLOCKED: 0, SKIPPED: 0 };
    current.cases.forEach(function (item) { counts[item.currentOutcome || 'NOT_RUN']++; });
    const total = current.cases.length, recorded = total - counts.NOT_RUN;
    const region = $(target).empty().append($('<p class="mb-2">').text(t('execution.recordedProgress',
      { recorded: window.I18n.formatNumber(recorded), total: window.I18n.formatNumber(total), remaining: window.I18n.formatNumber(counts.NOT_RUN) },
      '{recorded} of {total} cases recorded · {remaining} not run')));
    const outcomes = $('<div class="d-flex flex-wrap gap-2 mb-3">');
    Object.keys(counts).forEach(function (outcome) { outcomes.append($('<span>').text(t('execution.outcomeCount',
      { outcome: label(outcome), count: window.I18n.formatNumber(counts[outcome]) }, '{outcome}: {count}'))); });
    region.append(outcomes);
    return { remaining: counts.NOT_RUN, recorded: recorded, total: total };
  }
  function focusHeading(selector) { $(selector).attr('tabindex', '-1').trigger('focus'); }
  function attemptBody() {
    return { outcome: $('#execution-outcome').val(), durationMs: $('#execution-duration').val() === '' ? null : Number($('#execution-duration').val()),
      comment: $('#execution-comment').val().trim() || null,
      failureMessage: $('#execution-outcome').val() === 'FAIL' ? ($('#execution-failure').val().trim() || null) : null };
  }
  function capturePlanDraft() {
    const values = {};
    ['name', 'description', 'status', 'origin', 'plan', 'environment', 'build'].forEach(function (id) { values[id] = $('#execution-' + id).val(); });
    return { values: values, cases: selectedCases().map(String), casesLoaded: formCasesLoaded, plansLoaded: formPlansLoaded };
  }
  function restorePlanDraft(draft, selectorsOnly) {
    if (!draft) return;
    Object.keys(draft.values).filter(function (id) { return (!selectorsOnly || ['status', 'origin', 'plan'].includes(id)) && (id !== 'plan' || draft.plansLoaded); })
      .forEach(function (id) { $('#execution-' + id).val(draft.values[id]); });
  }
  function renderSourceCaseContext(source, target) {
    $(target).empty().append($('<p>').text(t('execution.sourceCaseContext',
      { title: 'TC-' + String(source.keyNo).padStart(3, '0') + ' · ' + source.title }, 'Source test case: {title}')),
      routeLink(t('execution.backToSourceCase', null, 'Back to source test case'), 'test-cases', { testCaseId: idText(source.id) }));
  }
  async function validateRetestSource(source, token) {
    if (!formContext.failureAttemptId) return;
    const context = Object.assign({}, formContext);
    if (!context.runId || !context.runCaseId || !context.defectId) { sourceCaseMissing = true; formError(t('execution.retestSourceUnavailable', null, 'The original failure context is incomplete. Return to the defect page and start the retest there.')); return; }
    const results = await Promise.all([api.get(base('runs') + '/' + encodeURIComponent(context.runId)),
      api.get(base('test-cases') + '/' + encodeURIComponent(source.id)),
      api.get(base('runs') + '/' + encodeURIComponent(context.runId) + '/cases/' + encodeURIComponent(context.runCaseId) + '/attempts')]);
    if (!valid(token)) return;
    const original = results[0].cases.find(function (item) { return sameId(item.runCaseId, context.runCaseId); });
    const current = results[1], failed = results[2].find(function (attempt) { return sameId(attempt.id, context.failureAttemptId) && attempt.outcome === 'FAIL'; });
    if (!original || !failed || !sameId(original.testCaseId, source.id) || !sameId(current.testCase.id, source.id) || current.testCase.status !== 'READY') {
      sourceCaseMissing = true; formError(t('execution.retestSourceUnavailable', null, 'The original failure context is incomplete. Return to the defect page and start the retest there.')); return;
    }
    const differences = [];
    ['title', 'description', 'preconditions'].forEach(function (name) {
      if (current.testCase[name] !== original['snapshot' + name[0].toUpperCase() + name.slice(1)]) differences.push(t('execution.' + name, null, name));
    });
    const steps = function (rows) { return rows.slice().sort(function (a, b) { return a.stepOrder - b.stepOrder; }).map(function (row) { return [row.stepOrder, row.action, row.expectedResult]; }); };
    const sourceSteps = steps(original.steps), currentSteps = steps(current.steps);
    if (!sourceSteps.length || !currentSteps.length || sourceSteps.some(function (row, index) { return row[0] !== index + 1; }) || currentSteps.some(function (row, index) { return row[0] !== index + 1; }) || JSON.stringify(sourceSteps) !== JSON.stringify(currentSteps)) differences.push(t('execution.orderedSteps', null, 'ordered steps'));
    if (differences.length) {
      sourceCaseMissing = true;
      formError(t('execution.retestDefinitionChanged', { fields: differences.join(', ') }, 'The current Test Case differs from the original frozen failure: {fields}. This run cannot provide compatible closure evidence.'));
    } else $('#execution-form-context').append($('<p class="small text-secondary">').text(t('execution.retestSourceCompatible', null, 'The current READY Test Case matches the original frozen definition. Its new run will preserve that definition. Linking and closure will verify compatibility again.')));
    $('#execution-form-context').append(routeLink(t('execution.backToDefect', null, 'Back to defect and link the retest PASS'), 'defects', { defectId: context.defectId }));
    if (!$('#execution-name').val()) $('#execution-name').val(t('execution.retestRunName', { title: source.title }, 'Retest · {title}'));
    if (!$('#execution-environment').val()) $('#execution-environment').val(results[0].run.environment || '');
  }
  function refreshFormSave() {
    const fromPlan = view === 'runs' && $('#execution-origin').val() === 'plan';
    const previewReady = planPreview && planPreview.ready && sameId(planPreview.id, $('#execution-plan').val());
    $('#execution-save').prop('disabled', formLoading || formWriting || sourceCaseMissing || (fromPlan && !previewReady));
  }
  function renderPlanPreview(current) {
    const plan = current.plan;
    const target = $('#execution-plan-preview').empty();
    target.append($('<p class="mb-1">').text(t('execution.sourcePlanContext', { title: planKey(plan) + ' · ' + plan.name }, 'Source plan: {title}')),
      $('<p class="mb-1">').text(t('execution.planCaseCount', { count: window.I18n.formatNumber(current.testCaseIds.length) }, '{count} included case(s) will be captured.')),
      $('<p class="text-secondary small">').text(t('execution.runSnapshotNotice', null,
        'Creating this run freezes the included test cases and steps. Later plan or test case changes do not change this run.')),
      routeLink(t('execution.viewSourcePlan', null, 'View source plan'), 'test-plans', { planId: idText(plan.id) }));
  }
  async function updatePlanPreview() {
    const token = ++planPreviewGeneration;
    const formToken = generation, ownerProject = projectId, selected = idText($('#execution-plan').val());
    planPreview = null;
    $('#execution-plan-preview').empty();
    if (!projectId || view !== 'runs' || $('#execution-form').hasClass('d-none') || $('#execution-origin').val() !== 'plan' || !selected) { refreshFormSave(); return; }
    const current = function () { return token === planPreviewGeneration && valid(formToken) && projectId === ownerProject && view === 'runs'
      && !$('#execution-form').hasClass('d-none') && $('#execution-origin').val() === 'plan' && sameId($('#execution-plan').val(), selected); };
    $('#execution-plan-preview').text(t('common.loading', null, 'Loading…')); refreshFormSave();
    try {
      const value = await api.get(base('test-plans') + '/' + encodeURIComponent(selected));
      if (!current()) return;
      planPreview = { id: selected, detail: value, ready: value.plan.status === 'READY' && value.testCaseIds.length > 0 };
      renderPlanPreview(value);
      if (!planPreview.ready) $('#execution-plan-preview').append($('<p class="text-danger">').text(t('execution.sourcePlanUnavailable', null, 'The source plan is unavailable or is no longer READY.')));
    } catch (failure) {
      if (!current()) return;
      $('#execution-plan-preview').text(failure.message); retry('#execution-plan-preview', updatePlanPreview);
    } finally { if (current()) refreshFormSave(); }
  }

  function notice(message, error) {
    $('#execution-notice').text(message || '').toggleClass('d-none', !message)
      .toggleClass('alert-danger', !!error).toggleClass('alert-success', !!message && !error);
  }
  function formError(message) { $('#execution-form-error').text(message || '').toggleClass('d-none', !message); }
  function attemptError(message) { $('#execution-attempt-error').text(message || '').toggleClass('d-none', !message); }
  function conflict(failure) {
    return failure.status === 409
      ? t('execution.conflict', null, 'This record changed or cannot enter the requested state. Reload its latest details before trying again.')
      : failure.message;
  }
  function badge(status) {
    const colors = { DRAFT: 'secondary', READY: 'success', ARCHIVED: 'secondary', IN_PROGRESS: 'primary', COMPLETED: 'success', CANCELLED: 'secondary', NOT_RUN: 'secondary', PASS: 'success', FAIL: 'danger', BLOCKED: 'warning', SKIPPED: 'info' };
    return $('<span>').addClass('badge text-bg-' + (colors[status] || 'secondary')).attr('data-vq-state', status).text(label(status));
  }
  function field(name, value) {
    return $('<div class="asset-field">').append($('<dt>').text(name), $('<dd>').text(value == null || value === '' ? '—' : String(value)));
  }
  function reset() {
    generation++;
    detail = null;
    runCaseId = null;
    editing = false;
    pendingAttempt = null;
    caseOptions = [];
    formContext = {}; existingPlans = []; selectedAttemptId = null; recordedMessage = null;
    renderedAttemptOwner = null; localeAttemptDraft = null; formLoading = false; formWriting = false; formCasesLoaded = false; formPlansLoaded = false; sourceCaseMissing = false; planPreview = null; planPreviewGeneration++;
    completionImpact = null; completionImpactGeneration++; finishBusy = false;
    $('#execution-list, #execution-detail, #execution-actions, #execution-items, #execution-case-selector, #execution-snapshot, #execution-history').empty();
    $('#execution-context, #execution-progress, #execution-case-context, #execution-case-progress, #execution-case-navigation, #execution-form-context').empty();
    $('#execution-plan-preview').empty();
    $('#execution-existing-plan-wrap').addClass('d-none');
    $('#execution-list-status, #execution-items-status, #execution-history-status').text('');
    $('#execution-list-panel, #execution-detail-panel, #execution-form, #execution-case-panel').addClass('d-none');
    $('#execution-save, #execution-submit').prop('disabled', false);
    notice(''); formError(''); attemptError('');
  }
  function panels(which) {
    if (which !== 'case') localeAttemptDraft = null;
    $('#execution-list-panel').toggleClass('d-none', which !== 'list');
    $('#execution-detail-panel').toggleClass('d-none', which !== 'detail');
    $('#execution-form').toggleClass('d-none', which !== 'form');
    $('#execution-case-panel').toggleClass('d-none', which !== 'case');
  }
  function caseSelector(rows, chosen) {
    const target = $('#execution-case-selector').empty();
    if (!rows.length) { target.append($('<p class="text-secondary">').text(t("execution.noEligibleTestCasesInThisProject", null, 'No eligible test cases in this project.'))); return; }
    rows.forEach(function (row) {
      const id = 'execution-select-case-' + row.id;
      target.append($('<div class="form-check">').append(
        $('<input type="checkbox" class="form-check-input">').attr('id', id).val(String(row.id)).prop('checked', chosen.includes(String(row.id)) || (view === 'runs' && sameId(row.id, formContext.sourceTestCaseId)))
          .prop('disabled', view === 'runs' && sameId(row.id, formContext.sourceTestCaseId)),
        $('<label class="form-check-label">').attr('for', id).text('TC-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title + ' · ' + label(row.status))));
    });
  }
  function selectedCases() {
    return $('#execution-case-selector input:checked').map(function () { return Number(this.value); }).get();
  }

  async function list() {
    if (!projectId || !active()) return;
    const token = ++generation;
    detail = null; runCaseId = null; pendingAttempt = null;
    selectRoute({});
    panels('list'); notice('');
    $('#execution-list-title').text(view === 'test-plans' ? t("common.testPlans", null, 'Test plans') : t("common.testRuns", null, 'Test runs'));
    $('#execution-new').text(view === 'test-plans' ? t("execution.createPlan", null, 'Create plan') : t("execution.createRun", null, 'Create run'));
    $('#execution-list').empty(); $('#execution-list-status').text(t("common.loading", null, 'Loading…'));
    try {
      const rows = await api.get(base(view === 'test-plans' ? 'test-plans' : 'runs'));
      if (!valid(token)) return;
      $('#execution-list-status').text(rows.length ? t('execution.itemCount', { count: window.I18n.formatNumber(rows.length) }, '{count} item(s)') : t("execution.noItemsYet", null, 'No items yet.'));
      rows.forEach(function (row) {
        const title = view === 'test-plans' ? planKey(row) + ' · ' + row.name : row.name;
        const meta = $('<div class="asset-list-meta">').append(badge(row.status),
          $('<span>').text(view === 'runs' ? (row.testPlanId == null ? t("execution.adHoc", null, 'Ad-hoc') : t("execution.planBased", null, 'Plan-based')) : 'v' + row.version),
          $('<small>').text(date(row.createdAt)));
        $('#execution-list').append($('<div class="asset-list-row">').append(
          $('<div class="asset-list-summary">').append($('<strong>').text(title),
            $('<p class="mb-1 text-secondary">').text(view === 'test-plans' ? (row.description || t("common.noDescription", null, 'No description')) : (row.environment || t("execution.noEnvironment", null, 'No environment')))),
          meta, $('<button type="button" class="btn btn-outline-primary btn-sm">').text(t('execution.viewItem', { title: title }, 'View {title}'))
            .on('click', function () { openDetail(row.id); })));
      });
    } catch (failure) { if (valid(token)) { $('#execution-list-status').text(t('common.unavailable', null, 'Unavailable')); notice(failure.message, true); retry('#execution-list', list); } }
  }

  async function openDetail(id, caseId, attemptId) {
    const token = ++generation;
    detail = null; runCaseId = null; pendingAttempt = null;
    completionImpact = null; completionImpactGeneration++; finishBusy = false;
    selectedAttemptId = idText(attemptId);
    selectRoute(view === 'test-plans' ? { planId: idText(id), sourceTestCaseId: routeContext().sourceTestCaseId }
      : { runId: idText(id), runCaseId: idText(caseId), attemptId: selectedAttemptId, defectId: routeContext().defectId,
        failureAttemptId: routeContext().failureAttemptId, sourceTestCaseId: routeContext().sourceTestCaseId });
    panels('detail'); notice('');
    $('#execution-detail-title').text(t("common.loading", null, 'Loading…'));
    $('#execution-detail, #execution-actions, #execution-items').empty();
    $('#execution-context, #execution-progress').empty();
    $('#execution-items-status').text('');
    try {
      const current = await api.get(path(id));
      if (!valid(token)) return;
      detail = current;
      if (view === 'test-plans') await renderPlan(current, token);
      else {
        renderRun(current);
        if (caseId != null) await openCase(caseId, attemptId, current);
      }
      if (valid(token)) focusHeading('#execution-detail-title');
    } catch (failure) { if (valid(token)) { if (!detail) $('#execution-detail-title').text(t('common.unavailable', null, 'Unavailable')); $('#execution-items-status').text(''); notice(failure.message, true); retry('#execution-actions', function () { openDetail(id, caseId, attemptId); }); } }
  }
  async function renderPlan(current, token) {
    const plan = current.plan;
    const sourceCase = routeContext().sourceTestCaseId;
    if (sourceCase) $('#execution-context').append(routeLink(t('execution.backToSourceCase', null, 'Back to source test case'), 'test-cases', { testCaseId: sourceCase }));
    $('#execution-detail-title').text(planKey(plan) + ' · ' + plan.name);
    $('#execution-detail').append($('<dl class="asset-fields">').append(
      field(t("common.description", null, 'Description'), plan.description), field(t("common.status", null, 'Status'), label(plan.status)),
      field(t("common.version", null, 'Version'), plan.version), field(t("common.created", null, 'Created'), date(plan.createdAt)), field(t("common.updated", null, 'Updated'), date(plan.updatedAt))));
    $('#execution-items-title').text(t('execution.includedCases', { count: window.I18n.formatNumber(current.testCaseIds.length) }, 'Included test cases ({count})'));
    $('#execution-items-status').text(t('execution.loadingCaseLabels', null, 'Loading current case labels…'));
    const cases = await api.get(base('test-cases'));
    if (!valid(token) || detail !== current) return;
    $('#execution-items-status').text('');
    const byId = new Map(cases.map(function (item) { return [String(item.id), item]; }));
    if (!current.testCaseIds.length) $('#execution-items').append($('<p class="text-secondary">').text(t("execution.noCasesInThisPlanYet", null, 'No cases in this plan yet.')));
    current.testCaseIds.forEach(function (id) {
      const item = byId.get(String(id));
      const title = item ? 'TC-' + String(item.keyNo).padStart(3, '0') + ' · ' + item.title
        : t('execution.caseNumber', { id: id }, 'Case #{id}');
      const row = $('<div class="asset-link-row">').append(item ? routeLink(title, 'test-cases', { testCaseId: idText(id), sourcePlanId: idText(plan.id) }, '') : $('<span>').text(title), item ? badge(item.status) : $('<span>').text(t("common.unavailable", null, 'Unavailable')));
      if (plan.status !== 'ARCHIVED') row.append($('<button type="button" class="btn btn-outline-danger btn-sm">').text(t("execution.removeFromPlan", null, 'Remove from plan'))
        .on('click', function () { changeMember(plan, id, title, 'remove'); }));
      $('#execution-items').append(row);
    });
    if (plan.status === 'READY') $('#execution-actions').append(routeLink(t('execution.createRunFromPlan', null, 'Create run from this plan'), 'runs',
      { action: 'create', sourcePlanId: idText(plan.id) }, 'btn btn-primary'));
    if (plan.status === 'ARCHIVED') return;
    $('#execution-actions').append($('<p class="text-secondary small w-100 mb-0">').text(t('execution.planMembershipDraftHint', null,
      'Adding or removing cases returns this plan to Draft. Mark it Ready again to create a run.')));
    $('#execution-actions').append($('<button type="button" class="btn btn-outline-primary">').text(t("execution.editPlan", null, 'Edit plan'))
      .on('click', function () { showForm(true); }));
    $('#execution-actions').append($('<button type="button" class="btn btn-outline-danger">').text(t("execution.archivePlan", null, 'Archive plan'))
      .on('click', function () { archivePlan(plan); }));
    const available = cases.filter(function (item) { return item.status !== 'ARCHIVED' && !current.testCaseIds.includes(item.id); });
    if (available.length) {
      const select = $('<select class="form-select execution-inline-select">').attr('aria-label', t('execution.testCaseToAdd', null, 'Test case to add'));
      available.forEach(function (item) { select.append($('<option>').val(item.id).text('TC-' + String(item.keyNo).padStart(3, '0') + ' · ' + item.title + ' · ' + label(item.status))); });
      $('#execution-actions').append(select, $('<button type="button" class="btn btn-outline-primary">').text(t("execution.addCaseToPlan", null, 'Add case to plan'))
        .on('click', function () { changeMember(plan, Number(select.val()), select.find(':selected').text(), 'add'); }));
    }
  }
  async function changeMember(plan, caseId, title, action) {
    if (action === 'remove' && !window.confirm(t('execution.removeFromPlanConfirm',
      { title: title, plan: plan.name }, 'Remove "{title}" from plan "{plan}"?'))) return;
    const token = generation;
    $('#execution-actions button, #execution-items button').prop('disabled', true);
    try {
      await api.post(path(plan.id) + '/test-cases/' + caseId + (action === 'remove' ? '/remove' : ''), { expectedVersion: plan.version });
      if (valid(token)) await openDetail(plan.id);
    } catch (failure) { if (valid(token)) { notice(conflict(failure), true); reloadConflict('#execution-notice', failure, function () { openDetail(plan.id); }); } }
    finally { if (valid(token)) $('#execution-actions button, #execution-items button').prop('disabled', false); }
  }
  async function archivePlan(plan) {
    if (!window.confirm(t('execution.archivePlanConfirm', { plan: plan.name },
      'Archive plan "{plan}"? It will become read-only.'))) return;
    const token = generation;
    $('#execution-actions button').prop('disabled', true);
    try { await api.post(path(plan.id) + '/archive', { expectedVersion: plan.version }); if (valid(token)) await openDetail(plan.id); }
    catch (failure) { if (valid(token)) { notice(conflict(failure), true); reloadConflict('#execution-notice', failure, function () { openDetail(plan.id); }); } }
    finally { if (valid(token)) $('#execution-actions button').prop('disabled', false); }
  }
  function renderRun(current) {
    const run = current.run;
    if (run.testPlanId != null) $('#execution-context').append(routeLink(t('execution.viewSourcePlan', null, 'View source plan'), 'test-plans',
      { planId: idText(run.testPlanId) }));
    const status = progress(current, '#execution-progress');
    $('#execution-progress').append($('<div class="mt-3">').attr('id', 'execution-completion-impact'), $('<div class="mt-3">').attr('id', 'execution-finish-panel'));
    loadCompletionImpact(current);
    if (routeContext().defectId) $('#execution-context').append(routeLink(t('execution.backToDefect', null, 'Back to defect and link the retest PASS'), 'defects', { defectId: routeContext().defectId }));
    $('#execution-detail-title').text(run.name);
    $('#execution-detail').append($('<dl class="asset-fields">').append(
      field(t("common.status", null, 'Status'), label(run.status)), field(t("execution.source", null, 'Source'), run.testPlanId == null ? t("execution.adHoc", null, 'Ad-hoc') : t('execution.planNumber', { number: run.testPlanId }, 'Plan #{number}')),
      field(t("execution.environment", null, 'Environment'), run.environment), field(t("execution.build", null, 'Build'), run.buildVersion),
      field(t("common.created", null, 'Created'), date(run.createdAt)), field(t("execution.ended", null, 'Ended'), date(run.endedAt))));
    $('#execution-items-title').text(t('execution.runCaseSnapshots', { count: window.I18n.formatNumber(current.cases.length) }, 'Run case snapshots ({count})'));
    current.cases.forEach(function (item) {
      $('#execution-items').append($('<div class="asset-list-row">').append(
        $('<div class="asset-list-summary">').append($('<strong>').text(item.snapshotTitle),
          $('<p class="mb-1 text-secondary">').text(t('execution.frozenCaseCaptured',
            { id: item.testCaseId, date: date(item.capturedAt) }, 'Frozen case #{id} · captured {date}'))),
        badge(item.currentOutcome), routeLink(t("execution.viewSnapshotAndAttempts", null, 'View snapshot and attempts'), 'runs',
          { runId: idText(run.id), runCaseId: idText(item.runCaseId) })));
    });
    if (run.status === 'IN_PROGRESS') {
      const next = current.cases.find(function (item) { return item.currentOutcome === 'NOT_RUN'; });
      if (next) $('#execution-actions').append(routeLink(t('execution.continueExecution', null, 'Continue execution'), 'runs',
        { runId: idText(run.id), runCaseId: idText(next.runCaseId) }, 'btn btn-primary'));
      else $('#execution-progress').append($('<p class="text-secondary">').text(t('execution.allCasesRecorded', null, 'Every case has an attempt.')));
      if (!status.total || status.remaining) $('#execution-progress').append($('<p class="text-secondary">').text(t('execution.completionRequiresAllCases', null,
        'Record at least one attempt for every case before completing this run.')));
      [[t("execution.completeRun", null, 'Complete run'), 'complete'], [t("execution.cancelRun", null, 'Cancel run'), 'cancel']].forEach(function (entry) {
        $('#execution-actions').append($('<button type="button" class="btn btn-outline-secondary">').text(entry[0])
          .attr('data-execution-action', entry[1])
          .prop('disabled', entry[1] === 'complete' && (!status.total || !!status.remaining))
          .on('click', function () { finishRun(run, entry[1]); }));
      });
    } else $('#execution-progress').append($('<p class="small text-secondary">').text(t('execution.terminalRetestPath', null, 'This run is read-only. Its history is retained. For unresolved defects, execute a compatible READY Test Case in a new run and explicitly link its PASS from the defect page.')));
  }
  function renderCompletionImpact() {
    const target = $('#execution-completion-impact').empty();
    if (!completionImpact) return;
    if (completionImpact.loading) { target.text(t('execution.loadingCompletionImpact', null, 'Loading completion impact…')); return; }
    if (completionImpact.error) {
      target.append($('<p class="small text-danger" role="status">').text(t('execution.completionImpactUnavailable', null, 'Defect and retest impact is unavailable. These counts cannot be assumed to be zero.')));
      retry(target, function () { if (detail && !finishBusy) return loadCompletionImpact(detail); }); return;
    }
    const value = completionImpact.value;
    const outcomes = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT_RUN'].map(function (name) { return t('execution.outcomeCount', { outcome: label(name), count: window.I18n.formatNumber(value.outcomes[name]) }, '{outcome}: {count}'); }).join(' · ');
    target.append($('<p class="small mb-1">').text(outcomes), $('<p class="small mb-1">').text(t('execution.defectCompletionImpact',
      { defects: window.I18n.formatNumber(value.openDefectCount), retests: window.I18n.formatNumber(value.pendingRetestDefectCount) }, 'Unclosed defects: {defects} · defects awaiting valid retest: {retests}')));
  }
  async function loadCompletionImpact(current) {
    const token = generation, request = ++completionImpactGeneration;
    completionImpact = { loading: true }; renderCompletionImpact();
    try {
      const value = await api.get(base('runs') + '/' + encodeURIComponent(current.run.id) + '/completion-impact');
      if (!valid(token) || detail !== current || request !== completionImpactGeneration) return;
      completionImpact = { value: value }; renderCompletionImpact(); return value;
    } catch (failure) {
      if (!valid(token) || detail !== current || request !== completionImpactGeneration) return;
      completionImpact = { error: failure }; renderCompletionImpact();
    }
  }
  async function finishRun(run, action, confirmed) {
    if (finishBusy || !detail || !sameId(detail.run.id, run.id)) return;
    if (action === 'complete' && (!detail || !detail.cases.length || detail.cases.some(function (item) { return !item.latestAttempt; }))) {
      notice(t('execution.completionRequiresAllCases', null, 'Record at least one attempt for every case before completing this run.'), true); return;
    }
    const token = generation;
    if (action === 'complete' && !confirmed) {
      const current = detail; finishBusy = true; $('#execution-actions button').prop('disabled', true);
      await loadCompletionImpact(current);
      if (!valid(token) || detail !== current) return;
      finishBusy = false;
      const panel = $('#execution-finish-panel').empty().append($('<h3 class="fs-6">').text(t('execution.completeRunConfirm', { name: run.name }, 'Complete run "{name}"?')),
        $('<p class="small">').text(t('execution.completionWarning', null, 'Completing a run does not mean all cases passed. After completion you cannot append attempts to these Run Cases. Original results stay in history. Later retests use a new run with a compatible READY Test Case and an explicit PASS link from the defect page.')));
      panel.append($('<button type="button" class="btn btn-primary">').text(t('execution.confirmCompletion', null, 'Confirm completion')).on('click', function () { if (valid(token) && detail === current) return finishRun(run, action, true); }),
        $('<button type="button" class="btn btn-outline-secondary ms-2">').text(t('common.cancel', null, 'Cancel')).on('click', function () { if (valid(token)) { panel.empty(); $('#execution-actions button').prop('disabled', false); } }));
      focusHeading('#execution-finish-panel h3'); return;
    }
    if (action === 'cancel' && !window.confirm(t('execution.cancelRunConfirm', { name: run.name }, 'Cancel run "{name}"?'))) return;
    finishBusy = true;
    $('#execution-actions button').prop('disabled', true);
    $('#execution-finish-panel button').prop('disabled', true);
    try { await api.post(path(run.id) + '/' + action, { expectedVersion: run.version }); if (valid(token)) await openDetail(run.id); }
    catch (failure) { if (valid(token)) { notice(conflict(failure), true); reloadConflict('#execution-notice', failure, function () { openDetail(run.id); }); } }
    finally {
      if (valid(token)) {
        finishBusy = false; $('#execution-finish-panel button').prop('disabled', false);
        const incomplete = !detail || !detail.cases.length || detail.cases.some(function (item) { return !item.latestAttempt; });
        $('#execution-actions button').each(function () { $(this).prop('disabled', $(this).attr('data-execution-action') === 'complete' && incomplete); });
      }
    }
  }
  function snapshot(item) {
    const target = $('#execution-snapshot').empty();
    target.append($('<dl class="asset-fields">').append(
      field(t("execution.titleAtCapture", null, 'Title at capture'), item.snapshotTitle), field(t("execution.priorityAtCapture", null, 'Priority at capture'), label(item.snapshotPriority)),
      field(t("execution.descriptionAtCapture", null, 'Description at capture'), item.snapshotDescription), field(t("execution.preconditionsAtCapture", null, 'Preconditions at capture'), item.snapshotPreconditions),
      field(t("execution.captured", null, 'Captured'), date(item.capturedAt)), field(t("execution.currentOutcome", null, 'Current outcome'), label(item.currentOutcome))));
    target.append($('<h3 class="fs-5 mt-3">').text(t("execution.snapshotSteps", null, 'Snapshot steps')));
    item.steps.forEach(function (step) {
      target.append($('<div class="asset-step">').append($('<strong>').text(t('assets.stepNumber', { number: step.stepOrder }, 'Step {number}')),
        $('<div>').append($('<span class="text-secondary">').text(t("execution.action", null, 'Action: ')), document.createTextNode(step.action)),
        $('<div>').append($('<span class="text-secondary">').text(t("execution.expected", null, 'Expected: ')), document.createTextNode(step.expectedResult))));
    });
  }
  async function openCase(id, attemptId, loaded) {
    if (!detail || view !== 'runs') return;
    const runId = detail.run.id;
    const owner = submissionContext(runId, id);
    if (localeAttemptDraft && localeAttemptDraft.owner !== owner) localeAttemptDraft = null;
    const token = ++generation;
    runCaseId = id; selectedAttemptId = idText(attemptId); pendingAttempt = submissions.get(submissionContext(runId, id)) || null;
    renderedAttemptOwner = null;
    selectRoute({ runId: idText(runId), runCaseId: idText(id), attemptId: selectedAttemptId, defectId: routeContext().defectId,
      failureAttemptId: routeContext().failureAttemptId, sourceTestCaseId: routeContext().sourceTestCaseId });
    panels('case'); notice(''); attemptError('');
    $('#execution-case-title').text(t('execution.loadingSnapshot', null, 'Loading snapshot…'));
    $('#execution-snapshot, #execution-history').empty();
    $('#execution-case-context, #execution-case-progress, #execution-case-navigation').empty();
    $('#execution-history-status').text(t('execution.loadingAttemptHistory', null, 'Loading attempt history…'));
    $('#execution-attempt-form').addClass('d-none');
    try {
      const current = loaded || await api.get(path(runId));
      if (!valid(token) || !sameId(runCaseId, id)) return;
      const item = current.cases.find(function (row) { return sameId(row.runCaseId, id); });
      if (!item) throw { message: t("execution.runCaseIsNoLongerAvailable", null, 'Run case is no longer available.') };
      const history = await api.get(path(runId) + '/cases/' + encodeURIComponent(id) + '/attempts');
      if (!valid(token) || !sameId(runCaseId, id)) return;
      const existing = submissions.get(submissionContext(runId, id));
      if (existing && !existing.busy && history.some(function (attempt) { return sameId(attempt.submissionKey, existing.body.submissionKey); })) {
        existing.accepted = true; submissions.delete(submissionContext(runId, id)); pendingAttempt = null;
      }
      detail = current;
      if (history.length) { item.latestAttempt = history[history.length - 1]; item.currentOutcome = item.latestAttempt.outcome; }
      $('#execution-case-title').text(t('execution.snapshotTitle', { title: item.snapshotTitle }, 'Snapshot · {title}'));
      $('#execution-case-context').append($('<p class="mb-2">').text(current.run.name),
        routeLink(t('execution.viewTestCase', null, 'View current test case'), 'test-cases', { testCaseId: idText(item.testCaseId), runId: idText(runId), runCaseId: idText(id), attemptId: selectedAttemptId }));
      if (current.run.testPlanId != null) $('#execution-case-context').append(routeLink(t('execution.viewSourcePlan', null, 'View source plan'), 'test-plans', { planId: idText(current.run.testPlanId) }));
      progress(current, '#execution-case-progress');
      const position = current.cases.indexOf(item);
      $('#execution-case-navigation').append($('<span class="align-self-center">').text(t('execution.casePosition',
        { position: window.I18n.formatNumber(position + 1), total: window.I18n.formatNumber(current.cases.length) }, 'Case {position} of {total}')));
      [['execution.previousCase', 'Previous case', position - 1], ['execution.nextCase', 'Next case', position + 1]].forEach(function (entry) {
        if (current.cases[entry[2]]) $('#execution-case-navigation').append(routeLink(t(entry[0], null, entry[1]), 'runs',
          { runId: idText(runId), runCaseId: idText(current.cases[entry[2]].runCaseId) }));
        else $('#execution-case-navigation').append($('<button type="button" class="btn btn-outline-primary btn-sm" disabled>').text(t(entry[0], null, entry[1])));
      });
      snapshot(item);
      const target = $('#execution-history').empty();
      if (routeContext().defectId) $('#execution-case-navigation').append(routeLink(t('execution.backToDefect', null, 'Back to defect and link the retest PASS'), 'defects', { defectId: routeContext().defectId }));
      $('#execution-history-status').text(history.length ? t('execution.attemptCount', { count: window.I18n.formatNumber(history.length) }, '{count} recorded attempt(s)') : t("execution.noAttemptsYet", null, 'No attempts yet.'));
      history.forEach(function (attempt, index) {
        const referenced = sameId(attempt.id, selectedAttemptId);
        const card = $('<div class="execution-attempt">').attr('id', 'execution-attempt-' + attempt.id).attr('tabindex', '-1')
          .toggleClass('border border-primary', referenced).append(
          $('<div class="asset-panel-heading mb-1">').append($('<strong>').text(t(index === history.length - 1 ? 'execution.latestAttempt' : 'execution.attemptNumber',
            { number: attempt.attemptNo }, index === history.length - 1 ? 'Attempt #{number} · latest' : 'Attempt #{number}')), badge(attempt.outcome)),
          $('<dl class="asset-fields mb-0">').append(field(t("execution.executed", null, 'Executed'), date(attempt.executedAt)), field(t("execution.actorID", null, 'Actor ID'), attempt.executedBy),
            field(t("execution.durationMs", null, 'Duration (ms)'), attempt.durationMs), field(t("execution.actualResultComment", null, 'Actual result / comment'), attempt.comment), field(t("execution.failureMessage", null, 'Failure message'), attempt.failureMessage)));
        target.append(card);
        if (referenced) card.attr('aria-current', 'true').append($('<p class="text-primary">').text(t('execution.referencedAttempt', { number: attempt.attemptNo }, 'Referenced attempt #{number}')));
        if (attempt.outcome === 'FAIL') card.append(routeLink(t("execution.createDefectFromThisFAIL", null, 'Create defect from this FAIL'), 'defects',
          { action: 'create', runId: idText(runId), runCaseId: idText(id), attemptId: idText(attempt.id), failureAttemptId: idText(attempt.id) }, 'btn btn-outline-danger btn-sm mt-2'));
        if (attempt.outcome === 'FAIL') card.append(routeLink(t('execution.linkExistingDefect', null, 'Link to existing defect'), 'defects',
          { action: 'link', runId: idText(runId), runCaseId: idText(id), attemptId: idText(attempt.id), failureAttemptId: idText(attempt.id) }, 'btn btn-outline-danger btn-sm mt-2'));
        const associations = knownDefects.get(projectId + '/' + attempt.id);
        if (associations && associations.size) {
          card.append($('<p class="text-secondary small mt-2">').text(t('execution.knownDefectLinks', null, 'Known linked defects in this session')));
          associations.forEach(function (defectId) { card.append(routeLink(t('execution.viewDefect', { id: defectId }, 'View defect #{id}'), 'defects', { defectId: defectId })); });
        }
        if (attempt.outcome === 'FAIL') card.append($('<p class="text-secondary small mt-2">').text(t('execution.associationsUnavailable', null, 'A complete linked-defect list is not available from this screen.')));
      });
      if (selectedAttemptId && !history.some(function (attempt) { return sameId(attempt.id, selectedAttemptId); })) notice(t('execution.sourceAttemptUnavailable', null, 'The referenced attempt is unavailable in this run case.'), true);
      $('#execution-attempt-form').toggleClass('d-none', current.run.status !== 'IN_PROGRESS');
      $('#execution-attempt-form')[0].reset();
      renderedAttemptOwner = current.run.status === 'IN_PROGRESS' ? submissionContext(runId, id) : null;
      $('#execution-failure-wrap').addClass('d-none');
      $('#execution-submit').prop('disabled', !!(pendingAttempt && pendingAttempt.busy)).text(history.length ? t("execution.recordRetestAsNewAttempt", null, 'Record retest as new attempt') : t("execution.recordNewAttempt", null, 'Record new attempt'));
      $('#execution-record-next').remove();
      if (current.run.status === 'IN_PROGRESS' && current.cases[position + 1]) $('#execution-attempt-form').append($('<button id="execution-record-next" type="submit" class="btn btn-outline-primary ms-2">')
        .prop('disabled', !!(pendingAttempt && pendingAttempt.busy)).text(t('execution.recordAndNext', null, 'Record attempt and next case')));
      if (current.run.status !== 'IN_PROGRESS') $('#execution-case-context').append($('<p class="text-secondary mt-2">').text(t('execution.runReadOnly', null, 'This run is read-only. Earlier attempts remain available.')));
      if (pendingAttempt) {
        $('#execution-outcome').val(pendingAttempt.body.outcome); $('#execution-duration').val(pendingAttempt.body.durationMs == null ? '' : pendingAttempt.body.durationMs);
        $('#execution-comment').val(pendingAttempt.body.comment || ''); $('#execution-failure').val(pendingAttempt.body.failureMessage || ''); $('#execution-outcome').trigger('change');
      }
      if (localeAttemptDraft && localeAttemptDraft.owner === owner) {
        const draft = localeAttemptDraft; localeAttemptDraft = null;
        const confirmed = draft.retryAttempt && draft.retryAttempt.accepted && draft.retryAttempt.signature === draft.signature;
        if (renderedAttemptOwner === owner && !confirmed) {
          draft.values.forEach(function (entry) { if (entry.id) $('#' + entry.id).val(entry.value); });
          $('#execution-outcome').trigger('change');
          pendingAttempt = submissions.get(owner) || (draft.retryAttempt && !draft.retryAttempt.accepted ? draft.retryAttempt : null);
        }
      }
      if (recordedMessage && recordedMessage.owner === submissionContext(runId, id)) { notice(recordedMessage.message); recordedMessage = null; }
      focusHeading(selectedAttemptId && history.some(function (attempt) { return sameId(attempt.id, selectedAttemptId); }) ? '#execution-attempt-' + selectedAttemptId : '#execution-case-title');
      return token;
    } catch (failure) { if (valid(token)) { $('#execution-case-title, #execution-history-status').text(t('common.unavailable', null, 'Unavailable')); notice(failure.message, true); retry('#execution-case-navigation', function () { openCase(id, attemptId); }); } }
  }

  async function showForm(update, context, draft) {
    if (!projectId || !active()) return;
    const token = ++generation;
    editing = update;
    formLoading = true; formWriting = false; formCasesLoaded = false; formPlansLoaded = false; sourceCaseMissing = false; planPreview = null; planPreviewGeneration++;
    formContext = context || routeContext();
    selectRoute(update ? { planId: idText(detail.plan.id), sourceTestCaseId: formContext.sourceTestCaseId }
      : { action: 'create', sourceTestCaseId: formContext.sourceTestCaseId,
        sourcePlanId: view === 'runs' ? formContext.sourcePlanId : null, runId: formContext.failureAttemptId ? formContext.runId : null,
        runCaseId: formContext.failureAttemptId ? formContext.runCaseId : null, defectId: formContext.defectId, failureAttemptId: formContext.failureAttemptId });
    panels('form'); notice(''); formError('');
    $('#execution-form')[0].reset();
    $('#execution-origin').prop('disabled', false);
    $('#execution-save').prop('disabled', true);
    $('#execution-form-title').text(view === 'test-plans' ? (update ? t("execution.editPlan", null, 'Edit plan') : t("execution.createPlan", null, 'Create plan')) : t("execution.createRun", null, 'Create run'));
    $('#execution-description-wrap').toggleClass('d-none', view !== 'test-plans');
    $('#execution-status-wrap').toggleClass('d-none', view !== 'test-plans' || !update);
    $('#execution-run-fields').toggleClass('d-none', view !== 'runs');
    $('#execution-cases-fieldset').toggleClass('d-none', !!update);
    $('#execution-case-selector, #execution-plan').empty();
    $('#execution-form-context').empty(); $('#execution-existing-plan-wrap').addClass('d-none'); existingPlans = [];
    $('#execution-plan-preview').empty();
    $('#execution-name').val(update ? detail.plan.name : '');
    $('#execution-description').val(update ? detail.plan.description || '' : '');
    if (update) $('#execution-status').val(detail.plan.status);
    restorePlanDraft(draft);
    try {
      if (!update) {
        const cases = await api.get(base('test-cases'));
        if (!valid(token)) return;
        caseOptions = cases.filter(function (item) { return view === 'test-plans' ? item.status !== 'ARCHIVED' : item.status === 'READY'; });
        formCasesLoaded = true;
        const sourceCase = formContext.sourceTestCaseId;
        const source = sourceCase && caseOptions.find(function (item) { return sameId(item.id, sourceCase); });
        caseSelector(caseOptions, draft && draft.casesLoaded ? draft.cases : source ? [idText(source.id)] : []);
        if (sourceCase) {
          if (!source) { sourceCaseMissing = true; formError(t('execution.sourceCaseUnavailable', null, 'The source test case is unavailable or archived.')); }
          else {
            const sourceContext = $('<div id="execution-source-case-context">');
            $('#execution-form-context').append(sourceContext); renderSourceCaseContext(source, sourceContext);
            if (view === 'runs') await validateRetestSource(source, token);
            if (!valid(token)) return;
            if (view === 'test-plans') {
              const plans = await api.get(base('test-plans'));
              if (!valid(token)) return;
              formPlansLoaded = true;
              existingPlans = plans.filter(function (plan) { return plan.status !== 'ARCHIVED'; });
              const selector = $('#execution-existing-plan').empty().append($('<option>').val('').text(t('execution.selectExistingPlan', null, 'Select an existing plan')));
              existingPlans.forEach(function (plan) { selector.append($('<option>').val(plan.id).text(planKey(plan) + ' · ' + plan.name)); });
              $('#execution-existing-plan-wrap').toggleClass('d-none', !existingPlans.length);
              $('#execution-add-existing').prop('disabled', false);
            }
          }
        }
        if (view === 'runs') {
          const plans = await api.get(base('test-plans'));
          if (!valid(token)) return;
          formPlansLoaded = true;
          plans.filter(function (plan) { return plan.status === 'READY'; }).forEach(function (plan) {
            $('#execution-plan').append($('<option>').val(plan.id).text(planKey(plan) + ' · ' + plan.name));
          });
          if (!$('#execution-plan option').length) $('#execution-plan').append($('<option>').val('').text(t("execution.noREADYPlanAvailable", null, 'No READY plan available')));
          $('#execution-origin').val($('#execution-plan option[value!=""]').length ? 'plan' : 'adhoc');
          if (sourceCase) $('#execution-origin').val('adhoc');
          $('#execution-origin').prop('disabled', !!sourceCase);
          if (formContext.sourcePlanId && !sourceCase) {
            const sourcePlan = plans.find(function (plan) { return sameId(plan.id, formContext.sourcePlanId) && plan.status === 'READY'; });
            $('#execution-origin').val('plan');
            if (sourcePlan) {
              $('#execution-plan').val(sourcePlan.id);
            } else { $('#execution-plan').val(''); formError(t('execution.sourcePlanUnavailable', null, 'The source plan is unavailable or is no longer READY.')); }
          }
        }
      }
      if (valid(token)) {
        restorePlanDraft(draft, true); formLoading = false;
        if (view === 'runs' && formContext.sourceTestCaseId) $('#execution-origin').val('adhoc').prop('disabled', true);
        if (view === 'runs') await updateRunOrigin(); else refreshFormSave();
        if (valid(token)) $('#execution-name').trigger('focus');
      }
    } catch (failure) { if (valid(token)) { formError(failure.message); retry('#execution-form-context', function () { showForm(update, formContext, capturePlanDraft()); }); } }
  }
  function updateRunOrigin() {
    const fromPlan = $('#execution-origin').val() === 'plan';
    $('#execution-plan-wrap').toggleClass('d-none', !fromPlan);
    $('#execution-cases-fieldset').toggleClass('d-none', fromPlan);
    return updatePlanPreview();
  }

  let requestedRun = null;
  function consumeContext(context) {
    const request = context || routeContext();
    if (request.projectId && !sameId(request.projectId, projectId)) return list();
    if (request.action === 'create') return showForm(false, request);
    if (view === 'test-plans' && request.planId) return openDetail(request.planId);
    if (view === 'runs' && request.runId) return openDetail(request.runId, request.runCaseId, request.attemptId);
    return list();
  }
  $(document).on('veriqra:project', function (event) {
    reset();
    projectId = event.originalEvent.detail.project ? String(event.originalEvent.detail.project.id) : null;
    requestedRun = null;
    if (projectId && nav()) view = routeContext().view || view;
    if (projectId && active()) consumeContext();
  });
  $(document).on('veriqra:view', function (event) {
    const next = event.originalEvent.detail.view;
    if (next !== view) { reset(); view = next; }
    if (projectId && active()) {
      const request = requestedRun || event.originalEvent.detail.context || routeContext(); requestedRun = null;
      consumeContext(request);
    }
  });
  document.addEventListener('veriqra:localechange', async function () {
    if (!projectId || !active()) return;
    if (!$('#execution-form').hasClass('d-none')) {
      $('#execution-form-title').text(view === 'test-plans'
        ? t(editing ? 'execution.editPlan' : 'execution.createPlan') : t('execution.createRun'));
      if (caseOptions.length) caseSelector(caseOptions, selectedCases().map(String));
      if (view === 'test-plans' && formCasesLoaded && formContext.sourceTestCaseId) {
        const source = caseOptions.find(function (item) { return sameId(item.id, formContext.sourceTestCaseId); });
        if (source) renderSourceCaseContext(source, '#execution-source-case-context');
        $('#execution-existing-plan').find('option').each(function () {
          if (this.value === '') $(this).text(t('execution.selectExistingPlan', null, 'Select an existing plan'));
        });
      }
      if (view === 'runs' && planPreview && planPreview.detail && sameId(planPreview.id, $('#execution-plan').val())) renderPlanPreview(planPreview.detail);
    } else if (!$('#execution-case-panel').hasClass('d-none') && runCaseId != null) {
      const id = runCaseId;
      const owner = detail && submissionContext(detail.run.id, id);
      const canRestore = !!owner && renderedAttemptOwner === owner && !$('#execution-attempt-form').hasClass('d-none');
      if (canRestore) localeAttemptDraft = {
        owner: owner,
        values: $('#execution-attempt-form').find('input,select,textarea').map(function () { return { id: this.id, value: this.value }; }).get(),
        retryAttempt: pendingAttempt, signature: JSON.stringify(attemptBody())
      };
      await openCase(id, selectedAttemptId);
    } else if (detail && !$('#execution-detail-panel').hasClass('d-none')) {
      await openDetail(view === 'test-plans' ? detail.plan.id : detail.run.id);
    } else await consumeContext(routeContext());
  });
  $(document).on('veriqra:open-run', function (event) {
    const request = event.originalEvent.detail;
    if (!projectId || !sameId(request.projectId, projectId)) return;
    if (view === 'runs') openDetail(request.runId, request.runCaseId, request.attemptId);
    else requestedRun = request;
  });
  document.addEventListener('veriqra:defect-linked', function (event) {
    const entry = event.detail;
    if (!entry || !entry.projectId || !entry.attemptId || !entry.defectId) return;
    const key = entry.projectId + '/' + entry.attemptId;
    if (!knownDefects.has(key)) knownDefects.set(key, new Set());
    knownDefects.get(key).add(idText(entry.defectId));
  });
  document.addEventListener('veriqra:defect-unlinked', function (event) {
    const entry = event.detail;
    if (!entry || !entry.projectId || !entry.attemptId || !entry.defectId) return;
    const key = entry.projectId + '/' + entry.attemptId;
    const associations = knownDefects.get(key);
    if (!associations) return;
    associations.delete(idText(entry.defectId));
    if (!associations.size) knownDefects.delete(key);
  });
  $('#execution-origin').on('change', updateRunOrigin);
  $('#execution-plan').on('change', updatePlanPreview);
  $('#execution-outcome').on('change', function () { $('#execution-failure-wrap').toggleClass('d-none', this.value !== 'FAIL'); });
  $('#execution-back').on('click', function () { if (nav()) nav().open(view, { projectId: projectId }); else list(); });
  $('#execution-case-back').on('click', function () { if (detail) { if (nav()) nav().open('runs', runDestination({ runId: idText(detail.run.id) })); else openDetail(detail.run.id); } });
  $('#execution-new').on('click', function () { showForm(false); });
  $('#execution-cancel').on('click', function () { if (editing && detail) openDetail(detail.plan.id); else list(); });
  $('#execution-add-existing').on('click', async function () {
    if ($(this).prop('disabled') || $('#execution-save').prop('disabled') || !formContext.sourceTestCaseId) return;
    const plan = existingPlans.find(function (row) { return sameId(row.id, $('#execution-existing-plan').val()); });
    if (!plan) { formError(t('execution.selectExistingPlan', null, 'Select an existing plan')); return; }
    const token = generation;
    const button = $(this).prop('disabled', true); formError('');
    formWriting = true;
    $('#execution-save').prop('disabled', true);
    try {
      await api.post(base('test-plans') + '/' + plan.id + '/test-cases/' + encodeURIComponent(formContext.sourceTestCaseId), { expectedVersion: plan.version });
      if (valid(token)) openDetail(plan.id);
    } catch (failure) { if (valid(token)) { formError(conflict(failure)); reloadConflict('#execution-form-error', failure, function () { showForm(false, formContext); }); } }
    finally { if (valid(token)) { formWriting = false; button.prop('disabled', false); refreshFormSave(); } }
  });
  $('#execution-form').on('submit', async function (event) {
    event.preventDefault();
    if ($('#execution-save').prop('disabled') || !this.reportValidity()) return;
    const token = generation;
    const button = $('#execution-save').prop('disabled', true);
    formWriting = true;
    $('#execution-add-existing').prop('disabled', true);
    formError('');
    const name = $('#execution-name').val().trim();
    if (!name) { formError(t("execution.nameIsRequired", null, 'Name is required.')); formWriting = false; refreshFormSave(); $('#execution-add-existing').prop('disabled', false); return; }
    let body;
    if (view === 'test-plans') {
      body = { name: name, description: $('#execution-description').val().trim() || null };
      if (editing) { body.status = $('#execution-status').val(); body.expectedVersion = detail.plan.version; }
      else body.testCaseIds = selectedCases();
    } else {
      body = { name: name, environment: $('#execution-environment').val().trim() || null,
        buildVersion: $('#execution-build').val().trim() || null };
      if ($('#execution-origin').val() === 'plan') {
        if (!$('#execution-plan').val()) { formError(t("execution.selectAREADYPlan", null, 'Select a READY plan.')); formWriting = false; refreshFormSave(); $('#execution-add-existing').prop('disabled', false); return; }
        body.testPlanId = Number($('#execution-plan').val());
      } else {
        body.testCaseIds = selectedCases();
        if (!body.testCaseIds.length) { formError(t("execution.selectAtLeastOneREADYTestCase", null, 'Select at least one READY test case.')); formWriting = false; refreshFormSave(); $('#execution-add-existing').prop('disabled', false); return; }
      }
    }
    try {
      if (view === 'runs' && formContext.failureAttemptId) {
        const source = caseOptions.find(function (row) { return sameId(row.id, formContext.sourceTestCaseId); });
        if (!source || !selectedCases().some(function (id) { return sameId(id, source.id); })) { sourceCaseMissing = true; formError(t('execution.retestSourceUnavailable', null, 'The original failure context is incomplete. Return to the defect page and start the retest there.')); return; }
        await validateRetestSource(source, token);
        if (!valid(token) || sourceCaseMissing) return;
      }
      const saved = editing ? await api.put(path(detail.plan.id), body)
        : await api.post(base(view === 'test-plans' ? 'test-plans' : 'runs'), body);
      if (valid(token)) await openDetail(saved.id);
    } catch (failure) { if (valid(token)) { formError(conflict(failure)); if (editing && detail) reloadConflict('#execution-form-error', failure, function () { openDetail(detail.plan.id); }); } }
    finally { if (valid(token)) { formWriting = false; refreshFormSave(); $('#execution-add-existing').prop('disabled', false); } }
  });
  $('#execution-attempt-form').on('submit', async function (event) {
    event.preventDefault();
    if ($('#execution-submit').prop('disabled') || !this.reportValidity() || view !== 'runs' || !detail || detail.run.status !== 'IN_PROGRESS' || runCaseId == null) return;
    const token = generation;
    const runId = detail.run.id;
    const caseId = runCaseId;
    const retainedRoute = runDestination({ runId: idText(runId), runCaseId: idText(caseId) });
    const owner = submissionContext(runId, caseId);
    const previous = submissions.get(owner);
    if (previous && previous.busy) { attemptError(t('execution.attemptInProgress', null, 'This attempt is being recorded. Please wait before submitting it again.')); return; }
    const body = attemptBody();
    if (body.durationMs != null && (!Number.isSafeInteger(body.durationMs) || body.durationMs < 0)) { attemptError(t("execution.durationMustBeANonNegativeWholeNumber", null, 'Duration must be a non-negative whole number.')); return; }
    const signature = JSON.stringify(body);
    if (previous && previous.signature === signature && previous.accepted) { await openCase(caseId); return; }
    pendingAttempt = previous && previous.signature === signature ? previous : { signature: signature, body: Object.assign({}, body, { submissionKey: crypto.randomUUID() }) };
    const submission = pendingAttempt;
    submissions.set(owner, submission); submission.busy = true;
    const submitter = event.originalEvent && event.originalEvent.submitter;
    const moveNext = submitter && submitter.id === 'execution-record-next';
    const position = detail.cases.findIndex(function (item) { return sameId(item.runCaseId, caseId); });
    const next = moveNext && detail.cases[position + 1];
    const requestPath = path(runId) + '/cases/' + encodeURIComponent(caseId) + '/attempts';
    const button = $('#execution-submit').prop('disabled', true);
    $('#execution-record-next').prop('disabled', true);
    attemptError('');
    try {
      const saved = await api.post(requestPath, submission.body);
      submission.accepted = true; submission.busy = false;
      if (valid(token)) {
        pendingAttempt = null;
        if (next && nav()) {
          recordedMessage = { owner: submissionContext(runId, next.runCaseId), message: t('execution.attemptRecorded', { number: saved.attemptNo }, 'Attempt #{number} recorded.') };
          nav().open('runs', Object.assign({}, retainedRoute, { runCaseId: idText(next.runCaseId) }));
        }
        else {
          const rendered = await openCase(next ? next.runCaseId : caseId, saved.id);
          if (rendered != null && valid(rendered)) notice(t('execution.attemptRecorded', { number: saved.attemptNo }, 'Attempt #{number} recorded.'));
        }
      }
    } catch (failure) { if (valid(token)) { attemptError(conflict(failure) + ' ' + t('execution.retryAttemptKey', null, 'Retrying unchanged values reuses this attempt key.')); reloadConflict('#execution-attempt-error', failure, function () { openCase(caseId); }); } }
    finally {
      submission.busy = false;
      if (detail && view === 'runs' && sameId(detail.run.id, runId) && sameId(runCaseId, caseId) && submissionContext(runId, caseId) === owner) {
        button.prop('disabled', false); $('#execution-record-next').prop('disabled', false);
      }
    }
  });
})(jQuery, window.VeriqraApi);
