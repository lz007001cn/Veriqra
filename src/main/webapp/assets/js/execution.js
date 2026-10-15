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
  let qaContext = null;
  let caseFilter = '';
  let runFilter = 'ALL';
  let formBaseline = null;
  let currentFormDraftKey = null;
  const formIntents = new Map();
  const planIntents = new Map();
  const retainedDrafts = new Map();
  const retainedAttemptDrafts = new Map();
  const submissions = new Map();
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
  const submissionContext = function (runId, caseId) { return projectId + '/' + runId + '/' + caseId + '/' + (qaContext ? qaContext.actorId : 'unknown'); };
  const canWrite = function () { return !!qaContext && qaContext.canWriteAssets === true && qaContext.projectStatus === 'ACTIVE'; };
  async function loadContext(force) {
    if (!window.VeriqraQaContext) throw { status: 403, message: t('r2Exec.permissionsUnavailable', null, 'Permissions could not be verified. Reload your project before editing.') };
    const value = await window.VeriqraQaContext.load(projectId, !!force);
    return value;
  }
  async function requireWrite(token) {
    const value = await loadContext(true);
    if (!valid(token)) return false;
    if (!qaContext || !sameId(value.actorId, qaContext.actorId)) throw { status: 403, message: t('r2Exec.actorChanged', null, 'Your signed-in identity changed. Reload the project before editing.') };
    qaContext = value;
    if (!canWrite()) throw { status: 403, message: t('r2Exec.readOnly', null, 'This action requires an active project and ADMIN or active TESTER permission. Contact your project PM or ADMIN.') };
    return true;
  }
  function intentKey(id) { return projectId + '/' + view + '/' + (id || 'create') + '/' + (qaContext ? qaContext.actorId : 'unknown'); }
  function draftKey(id, context) { return intentKey(id) + '/' + (context.sourceTestCaseId || '') + '/' + (context.sourcePlanId || '') + '/' + (context.failureAttemptId || ''); }
  function uncertain(failure) { return !failure || !failure.status || failure.status >= 500; }
  function permissionNote(target) {
    if (!canWrite()) $(target).append($('<p class="text-secondary small w-100">').text(t('r2Exec.readOnly', null,
      'This action requires an active project and ADMIN or active TESTER permission. Contact your project PM or ADMIN.')));
  }
  function checklist(current, cases, target, requireReady) {
    const byId = new Map(cases.map(function (row) { return [idText(row.id), row]; }));
    const blockers = current.testCaseIds.filter(function (id) { const row = byId.get(idText(id)); return !row || row.status !== 'READY'; });
    const ready = !!current.testCaseIds.length && !blockers.length && current.plan.status !== 'ARCHIVED' && (!requireReady || current.plan.status === 'READY');
    const region = $(target).append($('<h3 class="fs-6">').text(t('r2Exec.planChecklist', null, 'Current run preparation checklist')));
    region.append($('<p class="small mb-1">').text(t('r2Exec.planStateSeparate', { status: label(current.plan.status) },
      'Saved plan status: {status}. Current case readiness is checked separately; later case edits may block a READY plan.')));
    if (!current.testCaseIds.length) region.append($('<p class="text-danger">').text(t('r2Exec.emptyPlan', null, 'Add at least one test case before marking this plan READY.')));
    blockers.forEach(function (id) {
      const row = byId.get(idText(id));
      region.append($('<div class="asset-link-row">').append(row ? routeLink('TC-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title, 'test-cases', { testCaseId: idText(id), sourcePlanId: idText(current.plan.id) }, '') : $('<span>').text(t('r2Exec.missingCase', null, 'A plan member is unavailable. Reload or remove it from this plan.')),
        $('<span class="text-danger small">').text(row ? t('r2Exec.blockedCase', { status: label(row.status) }, '{status} — review this case and mark it READY before creating a run.') : '')));
    });
    if (current.testCaseIds.length && !blockers.length) region.append($('<p class="text-success small">').text(t('r2Exec.allCasesReady', null, 'All current member cases are READY. The server validates them again when creating the run.')));
    return { ready: ready, blockers: blockers, cases: byId };
  }
  function preserveDraft() {
    if (!qaContext || !projectId) return;
    if (!$('#execution-form').hasClass('d-none') && currentFormDraftKey && formBaseline && JSON.stringify(capturePlanDraft()) !== formBaseline)
      retainedDrafts.set(currentFormDraftKey, capturePlanDraft());
    if (!$('#execution-attempt-form').hasClass('d-none') && renderedAttemptOwner && draftDirty()) {
      const submission = submissions.get(renderedAttemptOwner) || pendingAttempt, signature = JSON.stringify(attemptBody());
      if (submission && submission.accepted && submission.signature === signature) retainedAttemptDrafts.delete(renderedAttemptOwner);
      else retainedAttemptDrafts.set(renderedAttemptOwner, { owner: renderedAttemptOwner, values: $('#execution-attempt-form').find('input,select,textarea').map(function () { return { id: this.id, value: this.value }; }).get(), retryAttempt: submission, signature: signature });
    }
  }
  function draftDirty() {
    if (!active()) return false;
    if (!$('#execution-form').hasClass('d-none')) return !!formBaseline && JSON.stringify(capturePlanDraft()) !== formBaseline;
    const accepted = renderedAttemptOwner && submissions.get(renderedAttemptOwner);
    // A saved result is no longer a draft. New input typed while its POST was in flight still is.
    if (accepted && accepted.accepted && accepted.signature === JSON.stringify(attemptBody())) return false;
    return !$('#execution-attempt-form').hasClass('d-none') && !!renderedAttemptOwner && !!($('#execution-outcome').val() || $('#execution-comment').val() || $('#execution-failure').val() || $('#execution-duration').val());
  }
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('execution', { dirty: draftDirty, clear: function () {
    retainedDrafts.clear(); retainedAttemptDrafts.clear(); submissions.clear(); formIntents.clear(); planIntents.clear(); localeAttemptDraft = null; pendingAttempt = null;
    $('#execution-name, #execution-description, #execution-environment, #execution-build, #execution-comment, #execution-failure, #execution-duration, #execution-outcome').val(''); formBaseline = null;
  } });
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
    $('#execution-save').prop('disabled', !canWrite() || formLoading || formWriting || sourceCaseMissing || formIntents.has(intentKey(editing && detail ? detail.plan.id : null)) || (editing && detail && planIntents.has(intentKey(detail.plan.id))) || (fromPlan && !previewReady));
  }
  function renderPlanPreview(current, cases) {
    const plan = current.plan;
    const target = $('#execution-plan-preview').empty();
    target.append($('<p class="mb-1">').text(t('execution.sourcePlanContext', { title: planKey(plan) + ' · ' + plan.name }, 'Source plan: {title}')),
      $('<p class="mb-1">').text(t('execution.planCaseCount', { count: window.I18n.formatNumber(current.testCaseIds.length) }, '{count} included case(s) will be captured.')),
      $('<p class="text-secondary small">').text(t('execution.runSnapshotNotice', null,
        'Creating this run freezes the included test cases and steps. Later plan or test case changes do not change this run.')),
      routeLink(t('execution.viewSourcePlan', null, 'View source plan'), 'test-plans', { planId: idText(plan.id) }));
    if (cases) {
      const check = checklist(current, cases, target, true);
      current.testCaseIds.forEach(function (id) { const row = check.cases.get(idText(id)); if (row) target.append($('<p class="small mb-1">').text('TC-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title + ' · ' + label(row.status))); });
      return check;
    }
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
      const cases = await api.get(base('test-cases'));
      if (!current()) return;
      const check = renderPlanPreview(value, cases);
      planPreview = { id: selected, detail: value, cases: cases, ready: check.ready };
      if (!$('#execution-name').val()) $('#execution-name').val(t('r2Exec.suggestedRunName', { title: value.plan.name }, '{title} · test run'));
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
    preserveDraft();
    generation++;
    detail = null; qaContext = null; formBaseline = null; currentFormDraftKey = null; caseFilter = ''; runFilter = 'ALL';
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
    const search = $('<input type="search" class="form-control mb-2">').attr('id', 'execution-case-search').attr('aria-label', t('r2Exec.searchCases', null, 'Search these project cases')).attr('placeholder', t('r2Exec.searchCases', null, 'Search these project cases')).val(caseFilter);
    target.append(search);
    search.on('input', function () {
      caseFilter = this.value;
      target.find('[data-case-search]').each(function () { $(this).toggleClass('d-none', !$(this).attr('data-case-search').includes(caseFilter.trim().toLocaleLowerCase())); });
    });
    if (!rows.length) { target.append($('<p class="text-secondary">').text(t("execution.noEligibleTestCasesInThisProject", null, 'No eligible test cases in this project.'))); return; }
    rows.slice().sort(function (a, b) { return Number(b.status === 'READY') - Number(a.status === 'READY') || a.keyNo - b.keyNo; }).forEach(function (row) {
      const id = 'execution-select-case-' + row.id;
      const text = 'TC-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title + ' · ' + label(row.status);
      target.append($('<div class="form-check">').attr('data-case-search', text.toLocaleLowerCase()).toggleClass('d-none', !text.toLocaleLowerCase().includes(caseFilter.trim().toLocaleLowerCase())).append(
        $('<input type="checkbox" class="form-check-input">').attr('id', id).val(String(row.id)).prop('checked', chosen.includes(String(row.id)) || (view === 'runs' && sameId(row.id, formContext.sourceTestCaseId)))
          .prop('disabled', view === 'runs' && sameId(row.id, formContext.sourceTestCaseId)),
        $('<label class="form-check-label">').attr('for', id).text(text)));
    });
  }
  function selectedCases() {
    return $('#execution-case-selector input:checked').map(function () { return Number(this.value); }).get();
  }

  async function list() {
    if (!projectId || !active()) return;
    preserveDraft();
    const token = ++generation;
    detail = null; runCaseId = null; pendingAttempt = null;
    selectRoute({});
    panels('list'); notice('');
    $('#execution-list-title').text(view === 'test-plans' ? t("common.testPlans", null, 'Test plans') : t("common.testRuns", null, 'Test runs'));
    $('#execution-new').text(view === 'test-plans' ? t("execution.createPlan", null, 'Create plan') : t("execution.createRun", null, 'Create run'));
    $('#execution-list').empty(); $('#execution-list-status').text(t("common.loading", null, 'Loading…'));
    try {
      const context = await loadContext(false); if (!valid(token)) return; qaContext = context;
      $('#execution-new').prop('disabled', !canWrite()); permissionNote('#execution-list');
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
    preserveDraft();
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
      const context = await loadContext(false); if (!valid(token)) return; qaContext = context;
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
    const prep = checklist(current, cases, '#execution-progress', false);
    permissionNote('#execution-actions');
    if (!current.testCaseIds.length) $('#execution-items').append($('<p class="text-secondary">').text(t("execution.noCasesInThisPlanYet", null, 'No cases in this plan yet.')));
    current.testCaseIds.forEach(function (id) {
      const item = byId.get(String(id));
      const title = item ? 'TC-' + String(item.keyNo).padStart(3, '0') + ' · ' + item.title
        : t('execution.caseNumber', { id: id }, 'Case #{id}');
      const row = $('<div class="asset-link-row">').append(item ? routeLink(title, 'test-cases', { testCaseId: idText(id), sourcePlanId: idText(plan.id) }, '') : $('<span>').text(title), item ? badge(item.status) : $('<span>').text(t("common.unavailable", null, 'Unavailable')));
      if (plan.status !== 'ARCHIVED' && canWrite() && !planIntents.has(intentKey(plan.id))) row.append($('<button type="button" class="btn btn-outline-danger btn-sm">').text(t("execution.removeFromPlan", null, 'Remove from plan'))
        .on('click', function () { changeMember(plan, id, title, 'remove'); }));
      $('#execution-items').append(row);
    });
    if (plan.status === 'READY' && prep.ready && canWrite()) $('#execution-actions').append(routeLink(t('execution.createRunFromPlan', null, 'Create run from this plan'), 'runs',
      { action: 'create', sourcePlanId: idText(plan.id) }, 'btn btn-primary'));
    if (plan.status === 'READY' && !prep.ready) $('#execution-progress').append($('<p class="alert alert-warning">').text(t('r2Exec.readyButBlocked', null, 'This plan is saved as READY, but it is currently blocked. Open the listed cases, review them and mark them READY.')));
    if (plan.status === 'ARCHIVED' || !canWrite()) return;
    if (planIntents.has(intentKey(plan.id))) {
      $('#execution-actions').append($('<p class="text-danger">').text(t('r2Exec.planWriteUnknown', null, 'A previous plan change has an unconfirmed result. Review the latest scope; this page will not resend it automatically.'))); return;
    }
    if (plan.status === 'DRAFT') $('#execution-actions').append($('<button type="button" class="btn btn-primary">').attr('id', 'execution-plan-ready').text(t('r2Exec.markPlanReady', null, 'Check and mark plan READY')).prop('disabled', !prep.ready)
      .on('click', function () { markPlanReady(plan); }));
    $('#execution-actions').append($('<p class="text-secondary small w-100 mb-0">').text(t('execution.planMembershipDraftHint', null,
      'Adding or removing cases returns this plan to Draft. Mark it Ready again to create a run.')));
    $('#execution-actions').append($('<button type="button" class="btn btn-outline-primary">').text(t("execution.editPlan", null, 'Edit plan'))
      .on('click', function () { showForm(true); }));
    $('#execution-actions').append($('<button type="button" class="btn btn-outline-danger">').text(t("execution.archivePlan", null, 'Archive plan'))
      .on('click', function () { archivePlan(plan); }));
    const available = cases.filter(function (item) { return item.status !== 'ARCHIVED' && !current.testCaseIds.some(function (id) { return sameId(id, item.id); }); });
    if (available.length) {
      const chooser = $('<fieldset class="w-100 mt-3">').append($('<legend class="fs-6">').text(t('r2Exec.addSelectedCases', null, 'Add selected cases')));
      const search = $('<input type="search" class="form-control mb-2">').attr('id', 'execution-plan-case-search').attr('aria-label', t('r2Exec.searchCases', null, 'Search these project cases')).attr('placeholder', t('r2Exec.searchCases', null, 'Search these project cases'));
      const selections = [];
      available.sort(function (a, b) { return Number(b.status === 'READY') - Number(a.status === 'READY') || a.keyNo - b.keyNo; }).forEach(function (item) {
        const title = 'TC-' + String(item.keyNo).padStart(3, '0') + ' · ' + item.title + ' · ' + label(item.status);
        const checkbox = $('<input type="checkbox" class="form-check-input">').attr('id', 'execution-add-case-' + item.id).val(item.id);
        const row = $('<div class="form-check">').attr('data-case-search', title.toLocaleLowerCase()).append(checkbox, $('<label class="form-check-label">').attr('for', 'execution-add-case-' + item.id).text(title));
        selections.push({ id: item.id, checkbox: checkbox, row: row, title: title }); chooser.append(row);
      });
      search.on('input', function () { const term = this.value.trim().toLocaleLowerCase(); selections.forEach(function (item) { item.row.toggleClass('d-none', !item.title.toLocaleLowerCase().includes(term)); }); });
      chooser.append($('<p class="small text-secondary">').text(t('r2Exec.sequentialAdds', null, 'Each selected case is added separately, in order. Successful additions remain if a later item fails. No cases are selected automatically.')),
        $('<button type="button" class="btn btn-outline-primary">').attr('id', 'execution-add-selected').text(t('r2Exec.addSelectedCases', null, 'Add selected cases')).on('click', function () { addMembers(plan, selections.filter(function (item) { return item.checkbox.prop('checked'); }).map(function (item) { return item.id; })); }));
      $('#execution-actions').append(search, chooser);
    }
  }
  async function markPlanReady(plan) {
    const token = generation; $('#execution-actions button').prop('disabled', true);
    try {
      if (!await requireWrite(token)) return;
      const current = await api.get(path(plan.id));
      const cases = await api.get(base('test-cases'));
      if (!valid(token)) return;
      const check = checklist(current, cases, $('#execution-progress').empty(), false);
      if (!check.ready || current.plan.status !== 'DRAFT') { notice(t('r2Exec.changedPlan', null, 'The plan or its cases changed. Review the latest preparation checklist before continuing.'), true); return; }
      await writePlan(current.plan, '', { name: current.plan.name, description: current.plan.description || null, status: 'READY', expectedVersion: current.plan.version }, { status: 'READY' }, true);
      if (valid(token)) await openDetail(plan.id);
    } catch (failure) { if (valid(token)) { notice(conflict(failure), true); retry('#execution-notice', function () { openDetail(plan.id); }); } }
    finally { if (valid(token)) $('#execution-actions button').prop('disabled', false); }
  }
  async function addMembers(plan, ids) {
    if (!ids.length) { notice(t('r2Exec.selectCases', null, 'Select at least one case. No case has been added.'), true); return; }
    const token = generation, key = intentKey(plan.id), results = [], planPath = path(plan.id);
    if (planIntents.has(key)) return;
    $('#execution-actions button, #execution-items button').prop('disabled', true);
    try {
      for (const id of ids) {
        if (!await requireWrite(token)) return;
        const current = await api.get(planPath);
        if (!valid(token)) return;
        if (current.plan.status === 'ARCHIVED') throw { status: 409, message: t('r2Exec.changedPlan', null, 'The plan or its cases changed. Review the latest preparation checklist before continuing.') };
        if (current.testCaseIds.some(function (value) { return sameId(value, id); })) { results.push(id); continue; }
        const intent = { caseId: id, action: 'add', expectedVersion: current.plan.version };
        planIntents.set(key, intent);
        try { await api.post(planPath + '/test-cases/' + encodeURIComponent(id), { expectedVersion: current.plan.version }); }
        catch (failure) {
          if (!uncertain(failure)) planIntents.delete(key);
          // Reconcile once by GET, then stop this batch even when the addition is observed.
          try { const observed = await api.get(planPath); if (observed.testCaseIds.some(function (value) { return sameId(value, id); })) { results.push(id); planIntents.delete(key); } } catch (ignored) { /* unknown remains locked */ }
          throw failure;
        }
        const observed = await api.get(planPath);
        if (!observed.testCaseIds.some(function (value) { return sameId(value, id); })) throw { status: 0, message: t('r2Exec.planWriteUnknown', null, 'A previous plan change has an unconfirmed result. Review the latest scope; this page will not resend it automatically.') };
        planIntents.delete(key); results.push(id);
        if (!valid(token)) return;
      }
      if (valid(token)) { await openDetail(plan.id); notice(t('r2Exec.batchAdded', { count: results.length }, '{count} selected case(s) are confirmed in the plan. The plan is DRAFT; review and mark it READY.')); }
    } catch (failure) {
      if (valid(token)) {
        await openDetail(plan.id);
        notice(t('r2Exec.batchStopped', { count: results.length }, 'Stopped after {count} confirmed case(s). Remaining cases were not sent. Review the current scope before continuing.') + ' ' + conflict(failure), true);
      }
    }
  }
  function observedPlanIntent(current, intent) {
    if (intent.status) return current.plan.status === intent.status;
    const contains = current.testCaseIds.some(function (id) { return sameId(id, intent.caseId); });
    return intent.action === 'remove' ? !contains : contains;
  }
  async function writePlan(plan, suffix, body, intent, put) {
    const key = intentKey(plan.id), planPath = base('test-plans') + '/' + encodeURIComponent(plan.id);
    if (planIntents.has(key)) throw { status: 0, message: t('r2Exec.planWriteUnknown', null, 'A previous plan change has an unconfirmed result. Review the latest scope; this page will not resend it automatically.') };
    planIntents.set(key, intent);
    try {
      if (put) await api.put(planPath + suffix, body); else await api.post(planPath + suffix, body);
      const current = await api.get(planPath);
      if (!observedPlanIntent(current, intent)) throw { status: 0, message: t('r2Exec.planWriteUnknown', null, 'A previous plan change has an unconfirmed result. Review the latest scope; this page will not resend it automatically.') };
      planIntents.delete(key); return current;
    } catch (failure) {
      if (!uncertain(failure)) planIntents.delete(key);
      else try { const current = await api.get(planPath); if (observedPlanIntent(current, intent)) planIntents.delete(key); } catch (ignored) { /* retain unknown */ }
      throw failure;
    }
  }
  async function changeMember(plan, caseId, title, action) {
    if (action === 'remove' && !window.confirm(t('execution.removeFromPlanConfirm',
      { title: title, plan: plan.name }, 'Remove "{title}" from plan "{plan}"?'))) return;
    const token = generation;
    $('#execution-actions button, #execution-items button').prop('disabled', true);
    try {
      if (!await requireWrite(token)) return;
      await writePlan(plan, '/test-cases/' + caseId + (action === 'remove' ? '/remove' : ''), { expectedVersion: plan.version }, { action: action, caseId: caseId });
      if (valid(token)) await openDetail(plan.id);
    } catch (failure) { if (valid(token)) { notice(conflict(failure), true); if (failure.status === 409) reloadConflict('#execution-notice', failure, function () { openDetail(plan.id); }); else retry('#execution-notice', function () { openDetail(plan.id); }); } }
    finally { if (valid(token)) $('#execution-actions button, #execution-items button').prop('disabled', false); }
  }
  async function archivePlan(plan) {
    if (!window.confirm(t('execution.archivePlanConfirm', { plan: plan.name },
      'Archive plan "{plan}"? It will become read-only.'))) return;
    const token = generation;
    $('#execution-actions button').prop('disabled', true);
    try { if (!await requireWrite(token)) return; await writePlan(plan, '/archive', { expectedVersion: plan.version }, { status: 'ARCHIVED' }); if (valid(token)) await openDetail(plan.id); }
    catch (failure) { if (valid(token)) { notice(conflict(failure), true); if (failure.status === 409) reloadConflict('#execution-notice', failure, function () { openDetail(plan.id); }); else retry('#execution-notice', function () { openDetail(plan.id); }); } }
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
    const filter = $('<select class="form-select mb-2">').attr('aria-label', t('r2Exec.filterResults', null, 'Filter frozen run cases'));
    ['ALL', 'NOT_RUN', 'FAIL', 'BLOCKED', 'PASS', 'SKIPPED'].forEach(function (value) { filter.append($('<option>').val(value).text(value === 'ALL' ? t('r2Exec.allOutcomes', null, 'All outcomes') : label(value))); });
    filter.val(runFilter);
    const filtered = [];
    filter.on('change', function () { runFilter = this.value; filtered.forEach(function (entry) { entry.row.toggleClass('d-none', runFilter !== 'ALL' && entry.outcome !== runFilter); }); });
    $('#execution-items').append(filter);
    current.cases.forEach(function (item) {
      const row = $('<div class="asset-list-row">').toggleClass('d-none', runFilter !== 'ALL' && item.currentOutcome !== runFilter).append(
        $('<div class="asset-list-summary">').append($('<strong>').text(item.snapshotTitle),
          $('<p class="mb-1 text-secondary">').text(t('execution.frozenCaseCaptured',
            { id: item.testCaseId, date: date(item.capturedAt) }, 'Frozen case #{id} · captured {date}'))),
        badge(item.currentOutcome), routeLink(t("execution.viewSnapshotAndAttempts", null, 'View snapshot and attempts'), 'runs',
          { runId: idText(run.id), runCaseId: idText(item.runCaseId) }));
      filtered.push({ row: row, outcome: item.currentOutcome }); $('#execution-items').append(row);
    });
    permissionNote('#execution-actions');
    if (run.status === 'IN_PROGRESS' && canWrite()) {
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
    } else if (run.status !== 'IN_PROGRESS') $('#execution-progress').append($('<p class="small text-secondary">').text(t('execution.terminalRetestPath', null, 'This run is read-only. Its history is retained. For unresolved defects, execute a compatible READY Test Case in a new run and explicitly link its PASS from the defect page.')));
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
    if (finishBusy || !canWrite() || !detail || !sameId(detail.run.id, run.id)) return;
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
    try { if (!await requireWrite(token)) return; await api.post(path(run.id) + '/' + action, { expectedVersion: run.version }); if (valid(token)) await openDetail(run.id); }
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
  async function loadAttemptDefects(target, runId, caseId, attempt, token) {
    const requestPath = base('runs') + '/' + encodeURIComponent(runId) + '/cases/' + encodeURIComponent(caseId) + '/attempts/' + encodeURIComponent(attempt.id) + '/defects';
    const current = function () { return valid(token) && detail && sameId(detail.run.id, runId) && sameId(runCaseId, caseId); };
    $(target).empty().text(t('r2Exec.loadingDefects', null, 'Loading linked defects…'));
    try {
      const defects = await api.get(requestPath);
      if (!current()) return;
      $(target).empty().append($('<p class="small text-secondary">').text(defects.length ? t('r2Exec.linkedDefects', null, 'Linked defects for this exact historical FAIL') : t('r2Exec.noLinkedDefects', null, 'No defects are linked to this FAIL.')));
      defects.forEach(function (defect) { $(target).append(routeLink((defect.keyNo ? 'BUG-' + String(defect.keyNo).padStart(3, '0') : t('execution.viewDefect', { id: defect.id }, 'View defect #{id}')) + ' · ' + defect.title + ' · ' + label(defect.status), 'defects', { defectId: idText(defect.id), runId: idText(runId), runCaseId: idText(caseId), attemptId: idText(attempt.id), failureAttemptId: idText(attempt.id) })); });
    } catch (failure) {
      if (!current()) return;
      $(target).empty().append($('<p class="small text-danger">').text(t('r2Exec.defectsUnavailable', null, 'Linked defects could not be loaded. This does not mean there are none.')));
      retry(target, function () { if (current()) return loadAttemptDefects(target, runId, caseId, attempt, token); });
    }
  }
  async function openCase(id, attemptId, loaded) {
    if (!detail || view !== 'runs') return;
    preserveDraft();
    const runId = detail.run.id;
    let owner = submissionContext(runId, id);
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
      const context = await loadContext(false); if (!valid(token)) return; qaContext = context;
      owner = submissionContext(runId, id); pendingAttempt = submissions.get(owner) || null;
      if (localeAttemptDraft && localeAttemptDraft.owner !== owner) localeAttemptDraft = null;
      if (!localeAttemptDraft && retainedAttemptDrafts.has(owner)) localeAttemptDraft = retainedAttemptDrafts.get(owner);
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
        if (attempt.outcome === 'FAIL' && canWrite()) card.append(routeLink(t("execution.createDefectFromThisFAIL", null, 'Create defect from this FAIL'), 'defects',
          { action: 'create', runId: idText(runId), runCaseId: idText(id), attemptId: idText(attempt.id), failureAttemptId: idText(attempt.id) }, 'btn btn-outline-danger btn-sm mt-2'));
        if (attempt.outcome === 'FAIL' && canWrite()) card.append(routeLink(t('execution.linkExistingDefect', null, 'Link to existing defect'), 'defects',
          { action: 'link', runId: idText(runId), runCaseId: idText(id), attemptId: idText(attempt.id), failureAttemptId: idText(attempt.id) }, 'btn btn-outline-danger btn-sm mt-2'));
        if (attempt.outcome === 'FAIL') { const associations = $('<div class="mt-2">'); card.append(associations); loadAttemptDefects(associations, runId, id, attempt, token); }
      });
      if (selectedAttemptId && !history.some(function (attempt) { return sameId(attempt.id, selectedAttemptId); })) notice(t('execution.sourceAttemptUnavailable', null, 'The referenced attempt is unavailable in this run case.'), true);
      $('#execution-attempt-form').toggleClass('d-none', current.run.status !== 'IN_PROGRESS' || !canWrite());
      $('#execution-attempt-form')[0].reset();
      $('#execution-outcome').val('');
      renderedAttemptOwner = current.run.status === 'IN_PROGRESS' && canWrite() ? submissionContext(runId, id) : null;
      $('#execution-failure-wrap').addClass('d-none');
      $('#execution-submit').prop('disabled', !!(pendingAttempt && pendingAttempt.busy)).text(history.length ? t("execution.recordRetestAsNewAttempt", null, 'Record retest as new attempt') : t("execution.recordNewAttempt", null, 'Record new attempt'));
      $('#execution-record-next').remove();
      if (current.run.status === 'IN_PROGRESS' && canWrite() && current.cases[position + 1]) $('#execution-attempt-form').append($('<button id="execution-record-next" type="submit" class="btn btn-outline-primary ms-2">')
        .prop('disabled', !!(pendingAttempt && pendingAttempt.busy)).text(t('execution.recordAndNext', null, 'Record attempt and next case')));
      if (current.run.status !== 'IN_PROGRESS') $('#execution-case-context').append($('<p class="text-secondary mt-2">').text(t('execution.runReadOnly', null, 'This run is read-only. Earlier attempts remain available.')));
      permissionNote('#execution-case-context');
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
        retainedAttemptDrafts.delete(owner);
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
    $('#execution-environment').attr('placeholder', t('r2Exec.environmentExample', null, 'Optional, e.g. isolated QA · browser/version'));
    $('#execution-build').attr('placeholder', t('r2Exec.buildExample', null, 'Optional, e.g. build tag or commit under test'));
    restorePlanDraft(draft);
    try {
      const contextValue = await loadContext(false); if (!valid(token)) return; qaContext = contextValue;
      permissionNote('#execution-form-context');
      if (!canWrite()) { formLoading = false; refreshFormSave(); return; }
      currentFormDraftKey = draftKey(update && detail ? detail.plan.id : null, formContext);
      const retained = retainedDrafts.get(currentFormDraftKey);
      if (!draft && retained) { draft = retained; restorePlanDraft(draft); $('#execution-form-context').append($('<p class="small text-secondary">').text(t('r2Exec.draftRestored', null, 'Your unsaved inputs for this project and source were restored from this tab’s memory. They are not saved to the server.'))); }
      if (formIntents.has(intentKey(update && detail ? detail.plan.id : null))) showUnconfirmedForm(token, update && detail ? detail.plan.id : null);
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
              if (!$('#execution-name').val()) $('#execution-name').val(t('r2Exec.suggestedPlanName', { title: source.title }, '{title} · test plan'));
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
        if (valid(token)) { formBaseline = draft ? '__restored__' : JSON.stringify(capturePlanDraft()); $('#execution-name').trigger('focus'); }
      }
    } catch (failure) { if (valid(token)) { formError(failure.message); retry('#execution-form-context', function () { showForm(update, formContext, capturePlanDraft()); }); } }
  }
  function showUnconfirmedForm(token, id) {
    formError(t('r2Exec.createUnknown', null, 'The previous save has no confirmed result. Your inputs are retained. Do not submit again; inspect the latest records first.'));
    $('#execution-form-context').append($('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('r2Exec.reconcileSave', null, 'Inspect saved records (read only)')).on('click', async function () {
      if (!valid(token)) return;
      const resource = base(view === 'test-plans' ? 'test-plans' : 'runs');
      try {
        const rows = await api.get(resource); if (!valid(token)) return;
        $('#execution-form-context').append($('<p class="small">').text(t('r2Exec.reconcileWarning', null, 'These are current records, not proof that an unconfirmed request failed. Open the matching record; no request will be resent.')));
        rows.filter(function (row) { return row.name === $('#execution-name').val().trim() || (id && sameId(row.id, id)); }).forEach(function (row) {
          $('#execution-form-context').append(routeLink(row.name + ' · ' + label(row.status), view, view === 'test-plans' ? { planId: idText(row.id) } : { runId: idText(row.id) }));
        });
      } catch (failure) { if (valid(token)) formError(conflict(failure)); }
    }));
  }
  function offerConflictReview(token) {
    if (!editing || !detail || !detail.plan) return;
    const planId = detail.plan.id, planPath = path(planId);
    $('#execution-form-context').append($('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('r2Exec.reviewLatest', null, 'Review latest saved version; keep my draft')).on('click', async function () {
      try {
        const latest = await api.get(planPath); if (!valid(token)) return;
        const panel = $('<div class="alert alert-info mt-2">').append($('<p>').text(t('r2Exec.savedVersion', { version: latest.plan.version, name: latest.plan.name, description: latest.plan.description || '—', status: label(latest.plan.status) },
          'Saved version {version}: {name} · {status}. Description: {description}')));
        $('#execution-form-context').append(panel);
        if (latest.plan.status === 'ARCHIVED') { formError(t('r2Exec.archivedDraft', null, 'This plan is now archived. Your draft is retained but cannot be applied to this plan.')); return; }
        panel.append($('<button type="button" class="btn btn-outline-primary btn-sm">').text(t('r2Exec.useReviewedVersion', null, 'I reviewed this version; keep my inputs for a new save')).on('click', function () {
          if (!valid(token)) return; detail = latest; formError(''); panel.empty().text(t('r2Exec.draftRebased', null, 'Your inputs are retained. Review them and press Save to apply them to the version you reviewed.')); refreshFormSave();
        }));
      } catch (failure) { if (valid(token)) formError(conflict(failure)); }
    }));
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
      if (view === 'runs' && planPreview && planPreview.detail && sameId(planPreview.id, $('#execution-plan').val())) renderPlanPreview(planPreview.detail, planPreview.cases);
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
  document.addEventListener('veriqra:reauthenticated', async function () {
    if (!projectId || !active()) return;
    const token = generation, actorId = qaContext && qaContext.actorId;
    $('#execution-save, #execution-submit, #execution-record-next, #execution-new').prop('disabled', true);
    try {
      const value = await loadContext(true); if (!valid(token)) return;
      if (actorId != null && !sameId(value.actorId, actorId)) return;
      qaContext = value; refreshFormSave();
      $('#execution-new').prop('disabled', !canWrite());
      $('#execution-submit, #execution-record-next').prop('disabled', !canWrite() || !!(pendingAttempt && pendingAttempt.busy));
      if (!canWrite()) notice(t('r2Exec.readOnly', null, 'This action requires an active project and ADMIN or active TESTER permission. Contact your project PM or ADMIN.'), true);
    } catch (failure) { if (valid(token)) { qaContext = null; notice(conflict(failure), true); } }
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
    const button = $(this).prop('disabled', true); formError(''); formWriting = true; $('#execution-save').prop('disabled', true);
    try { await addMembers(plan, [Number(formContext.sourceTestCaseId)]); }
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
      if (!await requireWrite(token)) return;
      if (view === 'test-plans' && editing && body.status === 'READY') {
        const latest = await api.get(path(detail.plan.id)), cases = await api.get(base('test-cases'));
        if (!valid(token)) return;
        if (latest.plan.version !== detail.plan.version) throw { status: 409, message: t('r2Exec.changedPlan', null, 'The plan or its cases changed. Review the latest preparation checklist before continuing.') };
        const preparation = checklist(latest, cases, $('#execution-form-context').empty(), false);
        if (!preparation.ready) { formError(t('r2Exec.changedPlan', null, 'The plan or its cases changed. Review the latest preparation checklist before continuing.')); return; }
      }
      if (view === 'runs' && body.testPlanId) {
        await updatePlanPreview();
        if (!valid(token)) return;
        if (!planPreview || !planPreview.ready || !sameId(planPreview.id, body.testPlanId)) { formError(t('r2Exec.changedPlan', null, 'The plan or its cases changed. Review the latest preparation checklist before continuing.')); return; }
      }
      if (view === 'runs' && formContext.failureAttemptId) {
        const source = caseOptions.find(function (row) { return sameId(row.id, formContext.sourceTestCaseId); });
        if (!source || !selectedCases().some(function (id) { return sameId(id, source.id); })) { sourceCaseMissing = true; formError(t('execution.retestSourceUnavailable', null, 'The original failure context is incomplete. Return to the defect page and start the retest there.')); return; }
        await validateRetestSource(source, token);
        if (!valid(token) || sourceCaseMissing) return;
      }
      const key = intentKey(editing && detail ? detail.plan.id : null);
      if (formIntents.has(key)) return;
      formIntents.set(key, { body: body });
      const saved = editing ? await api.put(path(detail.plan.id), body)
        : await api.post(base(view === 'test-plans' ? 'test-plans' : 'runs'), body);
      formIntents.delete(key); retainedDrafts.delete(currentFormDraftKey);
      if (valid(token)) { formBaseline = null; await openDetail(saved.id); }
    } catch (failure) { if (valid(token)) {
      const key = intentKey(editing && detail ? detail.plan.id : null);
      if (!uncertain(failure)) formIntents.delete(key);
      formError(conflict(failure));
      if (formIntents.has(key)) showUnconfirmedForm(token, editing && detail ? detail.plan.id : null);
      if (failure.status === 409) { $('#execution-form-context').append($('<p class="small">').text(t('r2Exec.conflictDraft', null, 'Your draft is retained. Review the latest saved version before deciding to submit your changes again.'))); offerConflictReview(token); }
    } }
    finally { if (valid(token)) { formWriting = false; refreshFormSave(); $('#execution-add-existing').prop('disabled', false); } }
  });
  $('#execution-attempt-form').on('submit', async function (event) {
    event.preventDefault();
    if ($('#execution-submit').prop('disabled') || !canWrite() || !this.reportValidity() || view !== 'runs' || !detail || detail.run.status !== 'IN_PROGRESS' || runCaseId == null) return;
    const token = generation;
    const runId = detail.run.id;
    const caseId = runCaseId;
    const retainedRoute = runDestination({ runId: idText(runId), runCaseId: idText(caseId) });
    const owner = submissionContext(runId, caseId);
    const previous = submissions.get(owner);
    if (previous && previous.busy) { attemptError(t('execution.attemptInProgress', null, 'This attempt is being recorded. Please wait before submitting it again.')); return; }
    const body = attemptBody();
    if (!['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(body.outcome)) { attemptError(t('r2Exec.chooseOutcome', null, 'Choose the actual outcome before recording this attempt.')); return; }
    if (body.durationMs != null && (!Number.isSafeInteger(body.durationMs) || body.durationMs < 0)) { attemptError(t("execution.durationMustBeANonNegativeWholeNumber", null, 'Duration must be a non-negative whole number.')); return; }
    const signature = JSON.stringify(body);
    if (previous && previous.resultUnknown && previous.signature !== signature) {
      attemptError(t('r2Exec.pendingAttemptChanged', null, 'A previous attempt has an unconfirmed result. Do not send changed values with a new key. Read the current history, or restore the previous values and explicitly retry with the same key.'));
      $('#execution-attempt-error').append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">').text(t('r2Exec.inspectUncertainAttempt', null, 'Read current attempt history')).on('click', function () { preserveDraft(); openCase(caseId); }));
      $('#execution-attempt-error').append($('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">').text(t('r2Exec.restorePendingAttempt', null, 'Restore pending values')).on('click', function () {
        $('#execution-outcome').val(previous.body.outcome); $('#execution-duration').val(previous.body.durationMs == null ? '' : previous.body.durationMs);
        $('#execution-comment').val(previous.body.comment || ''); $('#execution-failure').val(previous.body.failureMessage || ''); $('#execution-outcome').trigger('change'); attemptError('');
      }));
      return;
    }
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
      if (!await requireWrite(token)) return;
      const saved = await api.post(requestPath, submission.body);
      submission.accepted = true; submission.resultUnknown = false; submission.busy = false;
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
    } catch (failure) { submission.resultUnknown = uncertain(failure); if (valid(token)) { attemptError(conflict(failure) + ' ' + t('execution.retryAttemptKey', null, 'Retrying unchanged values reuses this attempt key.')); reloadConflict('#execution-attempt-error', failure, function () { preserveDraft(); openCase(caseId); }); } }
    finally {
      submission.busy = false;
      if (detail && view === 'runs' && sameId(detail.run.id, runId) && sameId(runCaseId, caseId) && submissionContext(runId, caseId) === owner) {
        button.prop('disabled', false); $('#execution-record-next').prop('disabled', false);
      }
    }
  });
})(jQuery, window.VeriqraApi);
