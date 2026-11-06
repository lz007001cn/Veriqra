(function ($, api) {
  'use strict';
  const t = function (key, args, fallback) { return window.I18n.t('aiSummary.' + key, args, fallback); };
  const panel = $('<section id="ai-run-summary-panel" class="ai-run-summary d-none" aria-labelledby="ai-run-summary-title">');
  $('#execution-actions').after(panel);
  let context = null, result = null, busy = false, epoch = 0;
  function current(token) { return token === epoch && context && (!context.isCurrent || context.isCurrent()); }
  function clear() { ++epoch; context = null; result = null; busy = false; panel.empty().addClass('d-none').attr('aria-busy', 'false'); }
  function message(text, error) { panel.find('.ai-summary-status').text(text || '').toggleClass('text-danger', !!error); }
  function controls() {
    panel.attr('aria-busy', String(busy));
    panel.find('.ai-summary-generate').prop('disabled', busy).text(t(busy ? 'generatingButton' : result ? 'regenerate' : 'generate'));
    panel.find('.ai-summary-copy').prop('disabled', busy || !result).toggleClass('d-none', !result);
  }
  function valid(value) {
    const input = value && value.input, analysis = value && value.analysis, counts = input && input.counts;
    const keys = ['total', 'recorded', 'passed', 'failed', 'blocked', 'skipped', 'notRun'];
    return input && String(input.projectId) === String(context.projectId) && String(input.runId) === String(context.run.id)
      && counts && keys.every(function (key) { return Number.isSafeInteger(counts[key]) && counts[key] >= 0; })
      && counts.total === counts.passed + counts.failed + counts.blocked + counts.skipped + counts.notRun
      && counts.recorded === counts.total - counts.notRun && analysis && typeof analysis.overview === 'string' && analysis.overview.trim()
      && ['findings', 'recommendations'].every(function (key) { return Array.isArray(analysis[key]) && analysis[key].every(function (text) { return typeof text === 'string'; }); });
  }
  function textCounts(counts) {
    return t('counts', { total: counts.total, recorded: counts.recorded, passed: counts.passed, failed: counts.failed,
      blocked: counts.blocked, skipped: counts.skipped, notRun: counts.notRun });
  }
  function section(target, title, rows) {
    target.append($('<h4>').text(t(title)));
    if (!rows.length) target.append($('<p class="text-secondary">').text(t('noItems')));
    else {
      const list = $('<ul>'); rows.forEach(function (row) { list.append($('<li>').text(row)); }); target.append(list);
    }
  }
  function validId(id) { return Number.isSafeInteger(id) && id > 0; }
  function renderFailureActions(target) {
    const navigation = window.VeriqraQaNavigation;
    if (!navigation || !Array.isArray(result.failureActions)) return;
    const token = epoch, projectId = context.projectId, runId = context.run.id;
    const list = $('<ul class="list-group ai-summary-failure-actions">');
    result.failureActions.forEach(function (item) {
      if (!item || !validId(item.runCaseId) || !validId(item.attemptId) || typeof item.title !== 'string'
          || !Array.isArray(item.linkedDefects)) return;
      const row = $('<li class="list-group-item">').append($('<h5 class="fs-6 mb-1">').text(item.title));
      if (typeof item.suggestion === 'string' && item.suggestion.trim()) row.append($('<p class="mb-2">').text(item.suggestion));
      const actions = $('<div class="d-flex flex-wrap gap-2">');
      if (item.linkedDefects.length) {
        item.linkedDefects.forEach(function (defect) {
          if (!defect || !validId(defect.id)) return;
          const destination = { projectId: projectId, defectId: defect.id };
          actions.append($('<a class="btn btn-outline-primary btn-sm">')
            .attr('href', navigation.href('defects', destination))
            .text(t('openLinkedDefect', { key: 'BUG-' + String(defect.keyNo).padStart(3, '0') }))
            .on('click', function (event) {
              if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (current(token)) navigation.open('defects', destination);
            }));
        });
      } else if (context.canWrite && context.canWrite()) {
        const source = { projectId: projectId, runId: runId, runCaseId: item.runCaseId, attemptId: item.attemptId };
        actions.append($('<button type="button" class="btn btn-outline-primary btn-sm ai-summary-create-defect">')
          .text(t('createDefectDraft')).on('click', function () {
            if (!current(token) || !context.canWrite()) return;
            const discard = window.VeriqraDefects?.stageAiDraft?.({ ...source, draftTitle: item.draftTitle, suggestion: item.suggestion });
            try { navigation.open('defects', { ...source, action: 'create', failureAttemptId: item.attemptId }); }
            finally { if (discard) discard(); }
          }));
      }
      if (actions.children().length) row.append(actions);
      list.append(row);
    });
    if (list.children().length) target.append($('<h4>').text(t('failureActions')), list);
  }
  function renderResult() {
    const target = panel.find('.ai-summary-result').empty().removeClass('d-none');
    const input = result.input;
    target.append($('<p class="text-secondary small">').text(t('snapshot', { capturedAt: window.I18n.formatDateTime(input.capturedAt), generatedAt: window.I18n.formatDateTime(result.generatedAt), defects: input.linkedDefectCount || 0 })),
      $('<details class="workflow-details ai-summary-statistics">').append($('<summary>').text(t('snapshotCounts', null, 'Counts captured for this summary')),
        $('<p class="ai-summary-facts">').text(textCounts(input.counts))));
    if (input.runStatus !== 'COMPLETED') target.append($('<p class="small text-secondary">').text(t('interim', { status: window.I18n.enumLabel(input.runStatus) })));
    if (input.detailsTruncated || input.omittedCaseCount || input.omittedDefectCount)
      target.append($('<p class="small text-secondary">').text(t('excerpt')));
    target.append($('<h4>').text(t('overview')), $('<p class="ai-summary-overview">').text(result.analysis.overview));
    section(target, 'findings', result.analysis.findings);
    renderFailureActions(target);
    section(target, 'recommendations', result.analysis.recommendations);
  }
  function plainText() {
    if (!result) return '';
    const input = result.input, lines = [t('heading'), input.runName,
      t('runMetadata', { status: window.I18n.enumLabel(input.runStatus), environment: input.environment || '—', build: input.buildVersion || '—' }),
      textCounts(input.counts), t('snapshot', { capturedAt: window.I18n.formatDateTime(input.capturedAt), generatedAt: window.I18n.formatDateTime(result.generatedAt), defects: input.linkedDefectCount || 0 })];
    if (input.runStatus !== 'COMPLETED') lines.push(t('interim', { status: window.I18n.enumLabel(input.runStatus) }));
    if (input.detailsTruncated || input.omittedCaseCount || input.omittedDefectCount) lines.push(t('excerpt'));
    lines.push('', t('overview'), result.analysis.overview, '', t('findings'));
    lines.push(...(result.analysis.findings.length ? result.analysis.findings.map(function (row) { return '- ' + row; }) : [t('noItems')]));
    lines.push('', t('recommendations'));
    lines.push(...(result.analysis.recommendations.length ? result.analysis.recommendations.map(function (row) { return '- ' + row; }) : [t('noItems')]));
    return lines.join('\n');
  }
  async function copy() {
    if (busy || !result) return;
    const token = epoch, text = plainText();
    try {
      if (!window.navigator || !window.navigator.clipboard || !window.navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await window.navigator.clipboard.writeText(text);
      if (current(token)) { panel.find('.ai-summary-copy-fallback').addClass('d-none'); message(t('copied')); }
    } catch (_) {
      if (!current(token)) return;
      panel.find('.ai-summary-copy-text').val(text);
      panel.find('.ai-summary-copy-fallback').removeClass('d-none');
      panel.find('.ai-summary-copy-text').trigger('focus');
      const field = panel.find('.ai-summary-copy-text')[0]; if (field && field.select) field.select();
      message(t('copyManual'));
    }
  }
  async function generate() {
    if (busy || !context) return;
    const token = epoch; busy = true; controls(); message(t('generating'));
    try {
      const value = await api.post('projects/' + encodeURIComponent(context.projectId) + '/runs/' + encodeURIComponent(context.run.id) + '/ai-summary', { language: window.I18n.getLocale() });
      if (!current(token)) return;
      if (!valid(value)) throw { code: 'AI_INVALID_RESPONSE' };
      result = value; renderResult(); panel.find('.ai-summary-copy-fallback').addClass('d-none'); message(t('ready'));
    } catch (error) {
      if (!current(token)) return;
      const code = error && error.code;
      const known = ['AI_NOT_CONFIGURED', 'AI_AUTH_ERROR', 'AI_RATE_LIMITED', 'AI_UPSTREAM_ERROR', 'AI_TIMEOUT', 'AI_INVALID_RESPONSE'];
      message(known.includes(code) ? t(code) : t('failed'), true);
    } finally { if (current(token)) { busy = false; controls(); } }
  }
  function mount(next) {
    clear(); if (!next || !next.projectId || !next.run || !next.run.id) return;
    context = next;
    const heading = $('<div class="ai-summary-heading">').append($('<div>').append(
      $('<h3 id="ai-run-summary-title">').text(t('heading'))),
      $('<div class="ai-summary-actions">').append(
        $('<button type="button" class="btn btn-outline-primary ai-summary-generate">').on('click', generate),
        $('<button type="button" class="btn btn-outline-secondary ai-summary-copy d-none">').text(t('copy')).on('click', copy)));
    panel.removeClass('d-none').append(heading, $('<p class="ai-summary-status small mt-2 mb-0" role="status" aria-live="polite">'),
      $('<div class="ai-summary-result d-none">'),
      $('<div class="ai-summary-copy-fallback mt-3 d-none">').append(
        $('<label for="ai-summary-copy-text" class="form-label">').text(t('copyText')),
        $('<textarea id="ai-summary-copy-text" class="form-control ai-summary-copy-text" rows="8" readonly>')));
    controls();
  }
  ['veriqra:project', 'veriqra:view', 'veriqra:localechange'].forEach(function (name) { document.addEventListener(name, clear); });
  window.addEventListener('pagehide', clear);
  window.VeriqraAiRunSummary = Object.freeze({ mount: mount, clear: clear });
})(jQuery, window.VeriqraApi);
