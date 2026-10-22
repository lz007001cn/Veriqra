(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  const projectStorageKey = 'veriqra.selectedProjectId';
  const shell = $('#app-shell');
  const splash = $('#bootstrap-screen');
  const picker = $('#project-select');
  const alert = $('#page-alert');
  let loading = false;
  let loadingProjects = false;
  let selecting = false;
  let currentUser = null;
  let projects = [];
  let activeProject = null;
  let selectedId = null;
  let creatingProject = false;
  let createdProjectId = null;
  let currentView = 'dashboard';
  let projectRequest = 0;
  let desiredProject = null;
  let handledRoute = null;
  let workflowRequest = 0;
  let workflowSummary = null;
  function mayLeave() { return !window.VeriqraDraftGuard || window.VeriqraDraftGuard.allowLeave(); }
  const routeIds = ['projectId', 'requirementId', 'testCaseId', 'planId', 'runId', 'runCaseId', 'attemptId', 'defectId',
    'sourceRequirementId', 'sourceTestCaseId', 'sourcePlanId', 'failureAttemptId', 'importId'];
  const routeFields = {
    requirements: ['requirementId', 'sourceTestCaseId', 'sourcePlanId', 'runId', 'runCaseId', 'attemptId'],
    'test-cases': ['testCaseId', 'sourceRequirementId', 'sourcePlanId', 'runId', 'runCaseId', 'attemptId'],
    'test-plans': ['planId', 'sourceTestCaseId'],
    runs: ['runId', 'runCaseId', 'attemptId', 'sourcePlanId', 'sourceTestCaseId', 'defectId', 'failureAttemptId'],
    defects: ['defectId', 'runId', 'runCaseId', 'failureAttemptId'],
    automation: ['importId', 'runId']
  };
  function routeUrl() {
    // The fallback keeps source-only previews and simple test harnesses usable.
    return typeof URL === 'function' && location.href ? new URL(location.href) : null;
  }
  function positiveId(value) { return /^[1-9][0-9]{0,18}$/.test(String(value || '')) ? String(value) : null; }
  function routeContext(view, input) {
    const context = { view: view };
    const allowed = ['projectId'].concat(routeFields[view] || []);
    allowed.forEach(function (key) { const id = positiveId(input[key]); if (id) context[key] = id; });
    if (['create', 'link'].includes(input.action) && routeFields[view]) context.action = input.action;
    return context;
  }
  function readRoute() {
    const url = routeUrl();
    const view = location.hash.slice(1) || 'dashboard';
    return routeContext(view, url ? Object.fromEntries(url.searchParams) : {});
  }
  function makeRoute(view, input) {
    const url = routeUrl();
    if (!url) return '#' + view;
    url.pathname = new URL('index.html', document.baseURI).pathname;
    routeIds.concat(['action']).forEach(function (key) { url.searchParams.delete(key); });
    const requested = Object.assign({ projectId: selectedId || desiredProject }, input);
    if (requested.projectId == null) requested.projectId = selectedId || desiredProject;
    const context = routeContext(view, requested);
    Object.keys(context).filter(function (key) { return key !== 'view'; }).forEach(function (key) { url.searchParams.set(key, context[key]); });
    url.hash = view;
    return url;
  }
  function writeRoute(view, context, replace) {
    const url = makeRoute(view, context || {});
    if (routeUrl() && window.history) window.history[replace ? 'replaceState' : 'pushState'](null, '', String(url));
    else location.hash = '#' + view;
  }
  function applyRoute(approved) {
    if (approved !== true && handledRoute && location.href !== handledRoute && !mayLeave()) {
      if (window.history) window.history.pushState(null, '', handledRoute);
      return;
    }
    const context = readRoute();
    handledRoute = location.href || null;
    setView(context.view, true);
    if (!projects.length) return;
    const id = context.projectId || selectedId || savedProject();
    if (!projects.some(function (project) { return String(project.id) === String(id); })) {
      projectRequest++; desiredProject = null; selectedId = null; activeProject = null; selecting = false;
      announce('project', { project: null }); picker.val('');
      picker.prop('disabled', false);
      setView(context.view, true); feedback(t('qa.projectUnavailable'));
      return;
    }
    if (String(id) !== selectedId || selecting) chooseProject(id);
    else setView(context.view);
  }
  window.VeriqraQaNavigation = Object.freeze({
    read: readRoute,
    href: function (view, context) { return String(makeRoute(view, context || {})); },
    select: function (view, context) { writeRoute(view, context, true); },
    open: function (view, context) {
      if (String(makeRoute(view, context || {})) !== location.href && !mayLeave()) return;
      writeRoute(view, context, false); applyRoute(true);
    }
  });

  function announce(name, detail) { document.dispatchEvent(new CustomEvent('veriqra:' + name, { detail: detail })); }
  function setView(view, silent) {
    currentView = ['dashboard', 'requirements', 'test-cases', 'test-plans', 'runs', 'defects', 'automation', 'collaboration'].includes(view) ? view : 'dashboard';
    $('[data-view]').removeClass('active').removeAttr('aria-current');
    $('[data-view="' + currentView + '"]').addClass('active').attr('aria-current', 'page');
    const labels = { dashboard: [t("shell.overview", null, 'OVERVIEW'), t("shell.projectDashboard", null, 'Project dashboard'), t("shell.yourCurrentQualityWorkspace", null, 'Your current quality workspace.')], requirements: [t("shell.testASSETS", null, 'TEST ASSETS'), t("common.requirements", null, 'Requirements'), t("shell.manageRequirementsAndTheirTestCoverage", null, 'Manage requirements and their test coverage.')], 'test-cases': [t("shell.testASSETS", null, 'TEST ASSETS'), t("common.testCases", null, 'Test cases'), t("shell.maintainCurrentTestDefinitionsAndSteps", null, 'Maintain current test definitions and steps.')], 'test-plans': [t("shell.planning", null, 'PLANNING'), t("common.testPlans", null, 'Test plans'), t("shell.defineTheCasesToExecute", null, 'Define the cases to execute.')], runs: [t("shell.execution", null, 'EXECUTION'), t("common.testRuns", null, 'Test runs'), t("shell.inspectFrozenSnapshotsAndRecordAttempts", null, 'Inspect frozen snapshots and record attempts.')], defects: [t("shell.quality", null, 'QUALITY'), t("common.defects", null, 'Defects'), t("shell.trackFailuresRetestsAndClosureEvidence", null, 'Track failures, retests and closure evidence.')], automation: [t("shell.automation", null, 'AUTOMATION'), t("common.automationImports", null, 'Automation & imports'), t("shell.confirmMappingsAndImportJUnitResults", null, 'Confirm mappings and import JUnit results.')], collaboration: [t('collab.eyebrow', null, 'COLLABORATION'), t('collab.navigation', null, 'Teams & tasks'), t('collab.description', null, 'Organize project teams and review assigned work.')] };
    $('#view-eyebrow').text(labels[currentView][0]);
    $('#view-title').text(labels[currentView][1]);
    $('#view-description').text(labels[currentView][2]);
    document.title = labels[currentView][1] + ' · Veriqra';
    $('#project-dashboard').toggleClass('d-none', currentView !== 'dashboard' || !selectedId);
    $('#asset-workspace').toggleClass('d-none', !['requirements', 'test-cases'].includes(currentView) || !selectedId);
    $('#execution-workspace').toggleClass('d-none', !['test-plans', 'runs'].includes(currentView) || !selectedId);
    $('#defect-workspace').toggleClass('d-none', currentView !== 'defects' || !selectedId);
    $('#automation-workspace').toggleClass('d-none', currentView !== 'automation' || !selectedId);
    $('#collaboration-workspace').toggleClass('d-none', currentView !== 'collaboration' || !selectedId);
    $('#sidebar').removeClass('open');
    $('#sidebar-toggle').attr('aria-expanded', 'false');
    if (!silent) {
      announce('view', { view: currentView, projectId: selectedId, context: readRoute() });
      if (currentView === 'dashboard' && selectedId && activeProject && window.VeriqraQaContext) loadWorkflowSummary();
    }
  }

  function savedProject() { try { return sessionStorage.getItem(projectStorageKey); } catch (_) { return null; } }
  function rememberProject(id) { try { if (id) sessionStorage.setItem(projectStorageKey, id); else sessionStorage.removeItem(projectStorageKey); } catch (_) { /* Optional UI preference. */ } }
  function feedback(message, retry) {
    alert.text(message || '').toggleClass('d-none', !message);
    if (!message || !retry) return;
    let retrying = false;
    const button = $('<button type="button" class="btn btn-outline-danger btn-sm ms-2">')
      .attr('data-i18n', 'common.retry').text(t('common.retry', null, 'Retry')).on('click', function () {
        if (retrying) return;
        retrying = true; button.prop('disabled', true); retry();
      });
    alert.append(button);
  }
  function showShell() { splash.addClass('d-none'); shell.removeClass('d-none'); }
  function clearProjectContext() {
    projectRequest++; selecting = false; desiredProject = null;
    announce('project', { project: null });
    projects = [];
    activeProject = null;
    selectedId = null;
    picker.empty().append($('<option>').val('').attr('data-i18n', 'shell.loadingProjects').text(t("shell.loadingProjects", null, 'Loading projects…'))).prop('disabled', true);
    $('#project-dashboard, #empty-projects, #asset-workspace, #execution-workspace, #defect-workspace, #automation-workspace, #collaboration-workspace').addClass('d-none');
    $('#project-key, #project-title, #project-description, #project-status, #account-name').text('');
  }
  function showProject(project) {
    activeProject = project;
    $('#empty-projects').addClass('d-none');
    $('#project-dashboard').toggleClass('d-none', currentView !== 'dashboard');
    $('#asset-workspace').toggleClass('d-none', !['requirements', 'test-cases'].includes(currentView));
    $('#execution-workspace').toggleClass('d-none', !['test-plans', 'runs'].includes(currentView));
    $('#defect-workspace').toggleClass('d-none', currentView !== 'defects');
    $('#automation-workspace').toggleClass('d-none', currentView !== 'automation');
    $('#collaboration-workspace').toggleClass('d-none', currentView !== 'collaboration');
    $('#project-title').text(project.name);
    $('#project-key').text(project.projectKey);
    $('#project-description').text(project.description || t("shell.noProjectDescriptionHasBeenAdded", null, 'No project description has been added.'));
    $('#project-status').text(window.I18n.enumLabel(project.status));
    $('#project-hero').toggleClass('is-archived', project.status !== 'ACTIVE');
    $('.project-monogram').text((project.name || 'V').trim().charAt(0).toUpperCase());
    $('#account-name').text(currentUser.username);
    renderAccess();
  }
  function chooseProject(id) {
    if (!projects.some(function (p) { return String(p.id) === String(id); })) return;
    if (creatingProject) return;
    const request = ++projectRequest;
    desiredProject = String(id);
    renderProjectLinks();
    selecting = true;
    selectedId = null;
    activeProject = null;
    $('#project-created').addClass('d-none');
    announce('project', { project: null });
    $('#project-dashboard, #asset-workspace, #execution-workspace, #defect-workspace, #automation-workspace, #collaboration-workspace').addClass('d-none');
    // Set the module view while no project is selected; verified project delivery then loads it once.
    setView(currentView);
    picker.prop('disabled', true);
    feedback('');
    api.get('projects/' + encodeURIComponent(id))
      .done(function (project) {
        if (request !== projectRequest || desiredProject !== String(project.id)) return;
        selectedId = String(project.id);
        picker.val(selectedId);
        rememberProject(selectedId);
        writeRoute(currentView, Object.assign({}, readRoute(), { projectId: selectedId }), true);
        showProject(project);
        renderWorkflow();
        announce('project', { project: project });
        if (String(project.id) === String(createdProjectId)) $('#project-created').removeClass('d-none');
      })
      .fail(function (failure) {
        if (request !== projectRequest) return;
        picker.val('');
        feedback(failure.message, failure.status === 401 ? null : function () { chooseProject(id); });
        if ([403, 404].includes(failure.status)) {
          rememberProject(null);
          // A changed membership or deleted project must be revalidated against the list.
          loadProjects();
        }
      })
      .always(function () { if (request === projectRequest) { selecting = false; picker.prop('disabled', loadingProjects); } });
  }
  function loadProjects(preferredId) {
    let failed = false;
    loadingProjects = true;
    picker.prop('disabled', true);
    feedback('');
    if (!projects.length) picker.empty().append($('<option>').val('').attr('data-i18n', 'shell.loadingProjects').text(t('shell.loadingProjects', null, 'Loading projects…')));
    api.get('projects')
      .done(function (rows) {
        projects = rows;
        picker.empty();
        if (!rows.length) {
          selectedId = null;
          announce('project', { project: null });
          rememberProject(null);
          picker.append($('<option>').val('').attr('data-i18n', 'shell.noProjectsAvailable').text(t("shell.noProjectsAvailable", null, 'No projects available')));
          $('#project-dashboard, #asset-workspace, #execution-workspace, #defect-workspace, #automation-workspace, #collaboration-workspace').addClass('d-none');
          $('#empty-projects').removeClass('d-none');
          return;
        }
        rows.forEach(function (project) {
          picker.append($('<option>').val(String(project.id)).text(project.projectKey + ' · ' + project.name));
        });
        const linkedProject = readRoute().projectId;
        if (preferredId == null && linkedProject && !rows.some(function (project) { return String(project.id) === linkedProject; })) {
          feedback(t('qa.projectUnavailable')); picker.val(''); return;
        }
        const stored = preferredId == null ? (linkedProject || savedProject()) : String(preferredId);
        const next = rows.some(function (p) { return String(p.id) === stored; }) ? stored : String(rows[0].id);
        chooseProject(next);
      })
      .fail(function (failure) {
        failed = true;
        if (!projects.length) picker.empty().append($('<option>').val('').attr('data-i18n', 'shell.projectsUnavailable').text(t('shell.projectsUnavailable', null, 'Projects could not be loaded')));
        feedback(failure.message, failure.status === 401 ? null : function () { loadProjects(preferredId); });
      })
      .always(function () { loadingProjects = false; if (!selecting) picker.prop('disabled', failed && !projects.length); });
  }
  function bootstrap() {
    if (loading) return;
    loading = true;
    shell.addClass('d-none');
    splash.removeClass('d-none');
    clearProjectContext();
    feedback('');
    setView(location.hash.slice(1));
    api.get('auth/me')
      .done(function (user) {
        currentUser = user;
        announce('identity', { user: user });
        $('#current-user').text(user.username);
        $('#admin-entry, #project-create-open').toggleClass('d-none', user.systemRole !== 'ADMIN');
        $('#project-create-form').addClass('d-none');
        $('#project-create-open').attr('aria-expanded', 'false');
        showShell();
        loadProjects();
      })
      .fail(function (failure) {
        if (failure.status !== 401) {
          splash.empty().append($('<span>').text(failure.message));
          splash.append($('<button type="button" class="btn btn-outline-primary btn-sm">').text(t("common.retry", null, 'Retry')).on('click', bootstrap));
        }
      })
      .always(function () { loading = false; });
  }

  function projectCreationError(message) {
    $('#project-create-error').text(message || '').toggleClass('d-none', !message);
  }
  function closeProjectCreation() {
    $('#project-create-form').addClass('d-none');
    $('#project-create-open').attr('aria-expanded', 'false').trigger('focus');
  }
  $('#project-create-open').on('click', function () {
    if (!currentUser || currentUser.systemRole !== 'ADMIN' || creatingProject) return;
    $('#project-create-form').removeClass('d-none');
    $(this).attr('aria-expanded', 'true');
    projectCreationError('');
    $('#project-create-key').trigger('focus');
  });
  $('#project-create-cancel').on('click', closeProjectCreation);
  $('#project-create-form').on('submit', function (event) {
    event.preventDefault();
    if (!currentUser || currentUser.systemRole !== 'ADMIN' || creatingProject) return;
    if (selecting) { projectCreationError(t('project.waitForSelection')); return; }
    const key = $('#project-create-key').val().trim();
    const name = $('#project-create-name').val().trim();
    if (!/^[A-Z][A-Z0-9]{0,15}$/.test(key) || !name || name.length > 160) {
      projectCreationError(t('project.invalid')); return;
    }
    creatingProject = true;
    $('#project-create-form button, #project-create-open, #project-select').prop('disabled', true);
    projectCreationError('');
    const form = this;
    api.post('projects', { projectKey: key, name: name, description: $('#project-create-description').val().trim() || null })
      .done(function (project) {
        creatingProject = false;
        createdProjectId = project.id;
        form.reset(); closeProjectCreation();
        location.hash = '#dashboard'; setView('dashboard');
        // Only expose setup after the returned project has been loaded and selected.
        $('#project-created').addClass('d-none');
        loadProjects(project.id);
      })
      .fail(function (failure) { projectCreationError(failure.status === 409 ? t('project.keyConflict') : failure.message); })
      .always(function () {
        creatingProject = false;
        $('#project-create-form button, #project-create-open').prop('disabled', false);
        if (!selecting) picker.prop('disabled', false);
      });
  });
  $('#project-setup-link').on('click', function () {
    announce('collaboration-area', { area: 'people' });
  });

  picker.on('change', function () {
    if (!mayLeave()) { picker.val(selectedId); return; }
    writeRoute(currentView, { projectId: this.value }, false); chooseProject(this.value);
  });
  $('a[data-view]').on('click', function (event) {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0)) return;
    if (event) event.preventDefault();
    window.VeriqraQaNavigation.open(this.hash.slice(1), { projectId: selectedId });
  });
  $(window).on('hashchange', function () {
    // Fragment history traversal fires popstate followed by hashchange for the same URL.
    if (location.href && handledRoute === location.href) return;
    writeRoute(location.hash.slice(1), readRoute(), true); applyRoute();
  });
  $(window).on('popstate', applyRoute);
  $('#logout-button').on('click', function () {
    if (!mayLeave()) return;
    const button = $(this);
    if (button.prop('disabled')) return;
    button.prop('disabled', true);
    api.post('auth/logout')
      .done(function () {
        currentUser = null;
        projects = [];
        selectedId = null;
        rememberProject(null);
        announce('project', { project: null });
        shell.addClass('d-none');
        api.signIn();
      })
      .fail(function (failure) { feedback(failure.message); })
      .always(function () { button.prop('disabled', false); });
  });
  $('#sidebar-toggle').on('click', function () {
    const opened = $('#sidebar').toggleClass('open').hasClass('open');
    $(this).attr('aria-expanded', String(opened));
  });
  function renderWorkflow() {
    renderProjectLinks();
    $('#workflow').empty();
    const views = ['requirements', 'test-cases', 'test-plans', 'runs', 'defects', 'automation', 'collaboration'];
    [t('common.requirements'), t('common.testCases'), t('common.testPlans'), t('common.runs'),
      t('common.defects'), t('common.automationImports'), t('collab.navigation', null, 'Teams & tasks')].forEach(function (name, index) {
      const card = $('<a class="workflow-card">').attr('href', window.VeriqraQaNavigation.href(views[index], {})).on('click', function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
        event.preventDefault(); window.VeriqraQaNavigation.open(views[index], {});
      });
      card.append($('<span class="workflow-number">').text(String(index + 1).padStart(2, '0')));
      card.append($('<strong>').text(name));
      card.append($('<span class="workflow-later">').text(t('qa.openArea')));
      $('#workflow').append(card);
    });
    if (activeProject && window.VeriqraQaContext) loadWorkflowSummary();
  }
  function renderAccess() {
    const context = workflowSummary && String(workflowSummary.projectId) === String(selectedId) ? workflowSummary : null;
    $('#access-summary').text(context ? t('r2.role.' + (context.systemRole === 'ADMIN' ? 'ADMIN' : context.projectRole || 'READER')) : t('r2.loadingRole'));
    $('#access-help').text(context ? t(context.canWriteAssets ? 'r2.testerHelp' : 'r2.readerHelp') : t('r2.roleReadRequired'));
  }
  function loadWorkflowSummary() {
    const token = ++workflowRequest;
    const projectId = selectedId;
    if (!projectId) return;
    workflowSummary = null; renderAccess();
    const panel = $('#qa-next-step').empty().append($('<p>').text(t('r2.loadingNext')));
    function current() { return token === workflowRequest && String(selectedId) === String(projectId); }
    function failed() {
      if (!current()) return;
      workflowSummary = null; renderAccess();
      panel.empty().append($('<p role="status">').text(t('r2.nextUnavailable')))
        .append($('<button type="button" class="btn btn-outline-secondary">').text(t('common.retry')).on('click', loadWorkflowSummary));
    }
    window.VeriqraQaContext.load(projectId).done(async function (context) {
      if (!current()) return;
      workflowSummary = context; renderAccess();
      try {
        const paths = ['requirements', 'test-cases', 'test-plans', 'runs', 'defects'];
        const data = await Promise.all(paths.map(function (path) { return api.get('projects/' + projectId + '/' + path); }));
        if (!current()) return;
        if (!data.every(Array.isArray)) { failed(); return; }
        const requirements = data[0], cases = data[1], plans = data[2], runs = data[3], defects = data[4];
        const usableRequirements = requirements.filter(function (row) { return row.status !== 'ARCHIVED'; });
        const usableCases = cases.filter(function (row) { return row.status !== 'ARCHIVED'; });
        const usablePlans = plans.filter(function (row) { return row.status !== 'ARCHIVED'; });
        let next;
        const draftCase = cases.find(function (row) { return row.status === 'DRAFT'; });
        const draftPlan = plans.find(function (row) { return row.status === 'DRAFT'; });
        const activeRun = runs.find(function (row) { return row.status === 'IN_PROGRESS'; });
        const resolved = defects.find(function (row) { return row.status === 'RESOLVED'; });
        const assigned = defects.find(function (row) { return String(row.assigneeId) === String(context.actorId) && ['OPEN','IN_PROGRESS'].includes(row.status); });
        if (context.projectStatus !== 'ACTIVE') next = ['r2.projectReadOnly', 'requirements', {}];
        else if (!context.canWriteAssets) next = assigned ? ['r2.handleAssigned', 'defects', { defectId: assigned.id }] : ['r2.inspectResults', 'runs', {}];
        else if (resolved) next = ['r2.reviewRetest', 'defects', { defectId: resolved.id }];
        else if (activeRun) next = ['r2.continueRun', 'runs', { runId: activeRun.id }];
        else if (!usableRequirements.length) next = ['r2.createRequirement', 'requirements', { action: 'create' }];
        else if (!usableCases.length) next = ['r2.createCoveredCase', 'test-cases', { action: 'create', sourceRequirementId: usableRequirements[0].id }];
        else if (draftCase) next = ['r2.reviewCase', 'test-cases', { testCaseId: draftCase.id }];
        else if (!usablePlans.length) next = ['r2.createPlan', 'test-plans', { action: 'create', sourceTestCaseId: (usableCases.find(function (row) { return row.status === 'READY'; }) || usableCases[0]).id }];
        else if (draftPlan) next = ['r2.reviewPlan', 'test-plans', { planId: draftPlan.id }];
        else next = ['r2.checkPlan', 'test-plans', { planId: usablePlans[0].id }];
        panel.empty().append($('<h3 class="fs-5">').text(t('r2.nextStep')))
          .append($('<p>').text(t('r2.loadedCounts', { requirements: requirements.length, cases: cases.length, plans: plans.length, runs: runs.length, defects: defects.length })))
          .append($('<a class="btn btn-primary">').attr('href', window.VeriqraQaNavigation.href(next[1], next[2])).text(t(next[0])).on('click', function (event) {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
            event.preventDefault(); window.VeriqraQaNavigation.open(next[1], next[2]);
          }))
          .append($('<p class="text-secondary small mt-2 mb-0">').text(t('r2.workflowHelp')));
      } catch (_) { failed(); }
    }).fail(failed);
  }
  document.addEventListener('veriqra:reauthenticated', function () {
    if (activeProject && window.VeriqraQaContext) loadWorkflowSummary();
  });
  function renderProjectLinks() {
    ['dashboard', 'requirements', 'test-cases', 'test-plans', 'runs', 'defects', 'automation', 'collaboration'].forEach(function (view) {
      $('[data-view="' + view + '"]').attr('href', window.VeriqraQaNavigation.href(view, { projectId: selectedId || desiredProject }));
    });
  }
  document.addEventListener('veriqra:localechange', function () {
    renderWorkflow(); setView(currentView, true);
    if (activeProject) showProject(activeProject);
    projectCreationError('');
  });
  // pageshow also runs when navigating Back to a page restored from the back/forward cache.
  $(window).on('pageshow', function (event) {
    if (!currentUser || (event.originalEvent && event.originalEvent.persisted)) {
      window.I18n.init().then(function () { renderWorkflow(); bootstrap(); });
    }
  });
  $(window).on('pagehide', function () {
    // Prevent a back/forward cache snapshot from displaying old project data before revalidation.
    shell.addClass('d-none');
    splash.removeClass('d-none');
    announce('project', { project: null });
  });
})(jQuery, window.VeriqraApi);
