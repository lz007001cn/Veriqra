(function (global, $, api) {
  'use strict';
  const t = function (key, args, fallback) { return global.I18n.t(key, args, fallback); };
  const number = function (value) { return global.I18n.formatNumber(value); };
  const label = function (value) { return global.I18n.enumLabel(value); };
  const outcomes = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT_RUN'];
  const runChoices = new Map();
  let state = null;
  let chart = null;
  let chartData = null;
  let chartObserver = null;
  function current(value) { return state === value && value.isCurrent(); }
  function routeLink(text, view, context, classes) {
    const target = Object.assign({ projectId: state.projectId }, context);
    return $('<a>').addClass(classes || 'dashboard-issue-link').text(text)
      .attr('href', global.VeriqraQaNavigation.href(view, target))
      .on('click', function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
        event.preventDefault(); global.VeriqraQaNavigation.open(view, target);
      });
  }
  function disposeChart() {
    if (chart) chart.dispose();
    chart = null; chartData = null;
    if (chartObserver) chartObserver.disconnect();
    chartObserver = null;
  }
  function status(value) {
    const errors = [value.baseError, value.runError, value.coverageError].filter(Boolean);
    $('#dashboard-summary-status').text(errors.join(' ')).toggleClass('d-none', !errors.length);
    $('#dashboard-summary-retry').toggleClass('d-none', !errors.length).prop('disabled', false);
  }
  function reset() {
    disposeChart();
    $('#dashboard-requirements-count, #dashboard-cases-count, #dashboard-progress-count, #dashboard-attention-count, #dashboard-defects-count, #dashboard-coverage-count').text('—');
    $('#dashboard-progress-detail, #dashboard-attention-detail, #dashboard-defects-detail, #dashboard-coverage-detail').text(t('common.loading', null, 'Loading…'));
    $('#dashboard-run-select').empty().prop('disabled', true);
    $('#dashboard-run-label, #dashboard-summary-status').text('');
    $('#dashboard-summary-status').addClass('d-none');
    $('#dashboard-summary-retry').addClass('d-none').prop('disabled', false);
    $('#dashboard-attention-list').empty();
    $('#dashboard-results-chart').empty().attr('aria-label', t('common.loading', null, 'Loading…'));
    $('#qa-next-step').empty().append($('<p>').text(t('r2.loadingNext')));
  }
  function recommendation(value) {
    const data = value.data, context = value.context;
    const requirements = data.requirements.filter(function (row) { return row.status !== 'ARCHIVED'; });
    const cases = data.cases.filter(function (row) { return row.status !== 'ARCHIVED'; });
    const plans = data.plans.filter(function (row) { return row.status !== 'ARCHIVED'; });
    const draftCase = data.cases.find(function (row) { return row.status === 'DRAFT'; });
    const draftPlan = data.plans.find(function (row) { return row.status === 'DRAFT'; });
    const activeRun = data.runs.find(function (row) { return String(row.id) === value.runId && row.status === 'IN_PROGRESS'; });
    const resolved = data.defects.find(function (row) { return row.status === 'RESOLVED'; });
    const assigned = data.defects.find(function (row) { return String(row.assigneeId) === String(context.actorId) && ['OPEN', 'IN_PROGRESS'].includes(row.status); });
    let next;
    if (context.projectStatus !== 'ACTIVE') next = ['r2.projectReadOnly', 'requirements', {}];
    else if (!context.canWriteAssets) next = assigned ? ['r2.handleAssigned', 'defects', { defectId: assigned.id }] : ['r2.inspectResults', 'runs', {}];
    else if (resolved) next = ['r2.reviewRetest', 'defects', { defectId: resolved.id }];
    else if (activeRun) next = ['r2.continueRun', 'runs', { runId: activeRun.id }];
    else if (!requirements.length) next = ['r2.createRequirement', 'requirements', { action: 'create' }];
    else if (!cases.length) next = ['r2.createCoveredCase', 'test-cases', { action: 'create', sourceRequirementId: requirements[0].id }];
    else if (draftCase) next = ['r2.reviewCase', 'test-cases', { testCaseId: draftCase.id }];
    else if (!plans.length) next = ['r2.createPlan', 'test-plans', { action: 'create', sourceTestCaseId: (cases.find(function (row) { return row.status === 'READY'; }) || cases[0]).id }];
    else if (draftPlan) next = ['r2.reviewPlan', 'test-plans', { planId: draftPlan.id }];
    else next = ['r2.checkPlan', 'test-plans', { planId: plans[0].id }];
    $('#qa-next-step').empty().append($('<h3 class="fs-5">').text(t('r2.nextStep')))
      .append(routeLink(t(next[0]), next[1], next[2], 'btn btn-primary'))
      .append($('<p class="text-secondary small mt-2 mb-0">').text(t('r2.workflowHelp')));
  }
  function projectCounts(value) {
    $('#dashboard-requirements-count').text(number(value.data.requirements.length));
    $('#dashboard-cases-count').text(number(value.data.cases.length));
    const open = value.data.defects.filter(function (row) { return row.status !== 'CLOSED'; });
    $('#dashboard-defects-count').text(number(open.length));
    $('#dashboard-defects-detail').text(t('dashboard.openDefectsDetail', { resolved: number(open.filter(function (row) { return row.status === 'RESOLVED'; }).length) }, '{resolved} resolved, awaiting retest'));
  }
  async function coverage(value) {
    const requirements = value.data.requirements.filter(function (row) { return row.status === 'ACTIVE'; });
    if (!requirements.length) {
      $('#dashboard-coverage-count').text('—');
      $('#dashboard-coverage-detail').text(t('dashboard.noRequirements', null, 'No active requirements.'));
      return;
    }
    try {
      const rows = await api.get('projects/' + value.projectId + '/requirements/coverage');
      if (!current(value)) return;
      if (!Array.isArray(rows)) throw new Error('Invalid coverage');
      const byId = new Map();
      rows.forEach(function (row) {
        if (!row || byId.has(String(row.requirementId)) || !Number.isSafeInteger(row.confirmedCaseCount) || row.confirmedCaseCount < 0) throw new Error('Invalid coverage');
        byId.set(String(row.requirementId), row.confirmedCaseCount);
      });
      if (requirements.some(function (row) { return !byId.has(String(row.id)); })) throw new Error('Incomplete coverage');
      const covered = requirements.filter(function (row) { return byId.get(String(row.id)) > 0; }).length;
      $('#dashboard-coverage-count').text(t('dashboard.coverageProgress', { covered: number(covered), total: number(requirements.length) }, '{covered}/{total}'));
      $('#dashboard-coverage-detail').text(t('dashboard.coverageDetail', null, 'Active requirements covered by confirmed, Ready cases'));
      value.coverageError = null;
    } catch (_) {
      if (!current(value)) return;
      $('#dashboard-coverage-count').text('—');
      value.coverageError = t('dashboard.coverageUnavailable', null, 'Requirement coverage could not be loaded.');
      $('#dashboard-coverage-detail').text(value.coverageError);
    }
    if (current(value)) status(value);
  }
  function colors() {
    const styles = global.getComputedStyle && global.getComputedStyle(document.documentElement);
    const read = function (key, fallback) { return styles && styles.getPropertyValue(key).trim() || fallback; };
    return { results: [read('--vq-success', '#24633f'), read('--vq-danger', '#a03238'), read('--vq-warning', '#805508'), read('--vq-info', '#285b8b'), read('--vq-border-strong', '#b7c2cb')],
      text: read('--vq-text', '#202b36'), muted: read('--vq-text-secondary', '#536170') };
  }
  function drawChart() {
    if (!chartData || !state || !current(state)) return;
    const element = $('#dashboard-results-chart')[0];
    const value = chartData, palette = colors();
    const summary = t('dashboard.resultsSummary', { results: outcomes.map(function (outcome) { return label(outcome) + ' ' + number(value.counts[outcome]); }).join(' · '), recorded: number(value.recorded), total: number(value.total) }, '{results}; results recorded {recorded}/{total}');
    const target = $('#dashboard-results-chart').attr('aria-label', summary);
    if (!global.echarts || !element) { target.text(summary); return; }
    try {
      if (!chart) {
        target.empty(); chart = global.echarts.init(element);
        if (global.ResizeObserver) { chartObserver = new global.ResizeObserver(function () { if (chart) { chart.resize(); drawChart(); } }); chartObserver.observe(element); }
      }
      const reducedMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      chart.setOption({ backgroundColor: 'transparent', animation: !reducedMotion, animationDuration: 0, animationDurationUpdate: 180,
        color: palette.results, textStyle: { fontFamily: 'system-ui, Microsoft YaHei, sans-serif' }, aria: { enabled: true, label: { description: summary } },
        tooltip: { trigger: 'item', renderMode: 'richText', valueFormatter: function (count) { return number(count); } },
        legend: { left: 'center', bottom: 0, itemWidth: 8, itemHeight: 8, itemGap: 12, icon: 'circle', textStyle: { color: palette.muted, fontSize: 11 },
          formatter: function (name) { const index = outcomes.findIndex(function (outcome) { return label(outcome) === name; }); return name + ' ' + number(value.counts[outcomes[index]] || 0); } },
        graphic: [{ type: 'group', left: 'center', top: '32%', children: [
          { type: 'text', left: 'center', top: 0, style: { text: value.total ? number(Math.round(value.recorded / value.total * 100)) + '%' : '—', fill: palette.text, fontSize: 29, fontWeight: 500, textAlign: 'center' } },
          { type: 'text', left: 'center', top: 38, style: { text: value.total ? t('dashboard.resultRecorded', null, 'Results recorded') : t('dashboard.noRunCases', null, 'No cases in this run.'), fill: palette.muted, fontSize: 11, textAlign: 'center' } }
        ] }],
        series: [{ type: 'pie', center: ['50%', '43%'], radius: ['45%', '66%'], padAngle: 2, stillShowZeroSum: false, label: { show: false }, emphasis: { scaleSize: 3 },
          data: outcomes.map(function (outcome, index) { return { name: label(outcome), value: value.counts[outcome], itemStyle: { color: palette.results[index] } }; }) }]
      }, true);
      chart.resize();
    } catch (_) {
      disposeChart(); target.text(summary);
    }
  }
  function issue(title, code, outcome, note, action) {
    return $('<div class="dashboard-issue">').append(
      $('<div class="dashboard-issue-head">').append($('<span>').text(code), $('<span class="dashboard-outcome">').attr('data-outcome', outcome).text(label(outcome))),
      $('<p class="dashboard-issue-title">').text(title), $('<p class="dashboard-issue-note">').text(note || ''), action);
  }
  function attention(value, details) {
    const target = $('#dashboard-attention-list').empty();
    const cases = details ? details.cases.filter(function (row) { return ['FAIL', 'BLOCKED'].includes(row.currentOutcome); }) : [];
    if (cases.length) {
      $('#dashboard-attention-title').text(t('dashboard.runAttentionTitle', null, 'Cases needing attention'));
      cases.slice(0, 3).forEach(function (row) {
        const source = value.data.cases.find(function (item) { return String(item.id) === String(row.testCaseId); });
        const code = source && source.keyNo != null ? 'TC-' + String(source.keyNo).padStart(3, '0') : '';
        const attempt = row.latestAttempt;
        const context = { runId: details.run.id, runCaseId: row.runCaseId };
        if (attempt && attempt.id) context.attemptId = attempt.id;
        target.append(issue(row.snapshotTitle, code, row.currentOutcome, attempt && (attempt.failureMessage || attempt.comment),
          routeLink(t('dashboard.viewAttempt', null, 'View execution record'), 'runs', context)));
      });
      if (cases.length > 3) target.append(routeLink(t('dashboard.moreAttention', { count: number(cases.length - 3) }, 'View {count} more cases'), 'runs', { runId: details.run.id }));
      return;
    }
    const defects = value.data.defects.filter(function (row) { return row.status !== 'CLOSED'; });
    $('#dashboard-attention-title').text(t('dashboard.defectAttentionTitle', null, 'Project defects needing attention'));
    if (defects.length) {
      defects.slice(0, 3).forEach(function (row) {
        target.append(issue(row.title, row.keyNo != null ? 'BUG-' + String(row.keyNo).padStart(3, '0') : '', row.status, row.resolutionNote || '',
          routeLink(t('dashboard.viewDefect', null, 'View defect'), 'defects', { defectId: row.id })));
      });
      if (defects.length > 3) target.append(routeLink(t('dashboard.moreDefects', { count: number(defects.length - 3) }, 'View {count} more defects'), 'defects', {}));
    } else target.append($('<p class="text-secondary">').text(value.runError ? value.runError : t('dashboard.noAttention', null, 'No items need attention.')));
  }
  function noRun(value) {
    const message = t('dashboard.noRuns', null, 'No test runs yet.');
    $('#dashboard-run-select').empty().append($('<option>').val('').text(message)).prop('disabled', true);
    $('#dashboard-progress-count, #dashboard-attention-count').text('—');
    $('#dashboard-progress-detail, #dashboard-attention-detail, #dashboard-run-label').text(message);
    $('#dashboard-results-chart').text(message).attr('aria-label', message);
    attention(value, null);
  }
  async function run(value, id) {
    const request = ++value.runRequest;
    const selected = value.data.runs.find(function (row) { return String(row.id) === String(id); });
    if (!selected) return;
    value.runId = String(id); runChoices.set(String(value.projectId), value.runId);
    recommendation(value);
    value.runError = null;
    disposeChart();
    $('#dashboard-progress-count, #dashboard-attention-count').text('—');
    $('#dashboard-progress-detail, #dashboard-attention-detail').text(t('common.loading', null, 'Loading…'));
    $('#dashboard-run-label').text(t('dashboard.runOption', { name: selected.name, status: label(selected.status) }, '{name} · {status}'));
    $('#dashboard-results-chart').empty().attr('aria-label', t('common.loading', null, 'Loading…'));
    $('#dashboard-attention-list').empty();
    status(value);
    try {
      const details = await api.get('projects/' + value.projectId + '/runs/' + encodeURIComponent(id));
      if (!current(value) || request !== value.runRequest) return;
      if (!details || !details.run || String(details.run.id) !== String(id) || !Array.isArray(details.cases)) throw new Error('Invalid run');
      const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 0 };
      details.cases.forEach(function (row) {
        if (!outcomes.includes(row.currentOutcome)) throw new Error('Invalid outcome');
        counts[row.currentOutcome]++;
      });
      const total = details.cases.length, recorded = total - counts.NOT_RUN;
      $('#dashboard-progress-count').text(total ? t('dashboard.runProgress', { recorded: number(recorded), total: number(total) }, '{recorded}/{total}') : '—');
      $('#dashboard-progress-detail').text(!total ? t('dashboard.noRunCases', null, 'No cases in this run.') : counts.NOT_RUN ? t('dashboard.remaining', { count: number(counts.NOT_RUN) }, '{count} cases not run') : t('dashboard.allRecorded', null, 'Every case has a recorded result.'));
      $('#dashboard-attention-count').text(number(counts.FAIL + counts.BLOCKED));
      $('#dashboard-attention-detail').text(t('dashboard.attentionBreakdown', { fail: number(counts.FAIL), blocked: number(counts.BLOCKED) }, 'FAIL {fail} · BLOCKED {blocked}'));
      chartData = { counts: counts, total: total, recorded: recorded }; drawChart(); attention(value, details);
    } catch (_) {
      if (!current(value) || request !== value.runRequest) return;
      value.runError = t('dashboard.runUnavailable', null, 'This run could not be loaded.');
      $('#dashboard-progress-detail, #dashboard-attention-detail').text(value.runError);
      $('#dashboard-results-chart').text(value.runError).attr('aria-label', value.runError);
      attention(value, null);
    }
    if (current(value) && request === value.runRequest) status(value);
  }
  function chooseRuns(value) {
    const runs = value.data.runs.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id).length - String(a.id).length || String(b.id).localeCompare(String(a.id));
    });
    if (!runs.length) { recommendation(value); noRun(value); return; }
    const preferred = runChoices.get(String(value.projectId));
    const selected = runs.find(function (row) { return String(row.id) === preferred; }) || runs.find(function (row) { return row.status === 'IN_PROGRESS'; }) || runs[0];
    const select = $('#dashboard-run-select').empty();
    runs.forEach(function (row) { select.append($('<option>').val(String(row.id)).text(t('dashboard.runOption', { name: row.name, status: label(row.status) }, '{name} · {status}'))); });
    select.val(String(selected.id)).prop('disabled', false);
    run(value, selected.id);
  }
  function failed(value) {
    if (!current(value)) return;
    reset(); value.baseError = t('dashboard.summaryUnavailable', null, 'Project summary could not be loaded.');
    $('#dashboard-progress-detail, #dashboard-attention-detail, #dashboard-defects-detail, #dashboard-coverage-detail').text(value.baseError);
    $('#qa-next-step').empty().append($('<p role="status">').text(t('r2.nextUnavailable')))
      .append($('<button type="button" class="btn btn-outline-secondary">').text(t('common.retry')).on('click', function () { load(value.options); }));
    status(value);
  }
  function load(options) {
    const value = { projectId: String(options.projectId), isCurrent: options.isCurrent || function () { return true; }, options: options, runRequest: 0 };
    state = value; reset();
    try {
      global.VeriqraQaContext.load(value.projectId).done(async function (context) {
        if (!current(value)) return;
        try {
          value.context = context;
          if (!context || String(context.projectId) !== value.projectId) throw new Error('Invalid project context');
          const lists = await Promise.all(['requirements', 'test-cases', 'test-plans', 'runs', 'defects'].map(function (path) { return api.get('projects/' + value.projectId + '/' + path); }));
          if (!current(value)) return;
          if (!lists.every(Array.isArray)) throw new Error('Invalid lists');
          value.data = { requirements: lists[0], cases: lists[1], plans: lists[2], runs: lists[3], defects: lists[4] };
          projectCounts(value); coverage(value); chooseRuns(value);
        } catch (_) { failed(value); }
      }).fail(function () { failed(value); });
    } catch (_) { failed(value); }
  }
  $('#dashboard-run-select').on('change', function () { if (state && current(state) && state.data) run(state, $(this).val()); });
  $('#dashboard-summary-retry').on('click', function () { if (state && current(state)) load(state.options); });
  $(global).on('resize', function () { if (chart) { chart.resize(); drawChart(); } });
  if (global.matchMedia) {
    const media = global.matchMedia('(prefers-color-scheme: dark)');
    if (media.addEventListener) media.addEventListener('change', drawChart);
  }
  if (global.MutationObserver && document.documentElement) new global.MutationObserver(drawChart).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  global.VeriqraDashboard = Object.freeze({ load: load, deactivate: function () { state = null; disposeChart(); } });
})(window, jQuery, window.VeriqraApi);
