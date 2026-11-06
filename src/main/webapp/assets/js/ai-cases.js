(function ($, api) {
  'use strict';
  const tr = function (key, fallback) { return window.I18n.t('ai.' + key, null, fallback); };
  let context = null, preview = null, busy = false, uncertain = false, epoch = 0, statusKey = null, returnFocus = null;
  let previewValidator = null;
  let importedCoverage = false, coverageSourceCount = null;
  const panel = $('<section id="ai-cases-panel" class="asset-panel mt-3 d-none" aria-labelledby="ai-cases-title">');
  $('#asset-primary-actions').after(panel);
  function text(tag, key, fallback) { return $(tag).attr('data-ai-text', key).attr('data-ai-fallback', fallback || '').text(tr(key, fallback)); }
  function visibility(opened, owner) {
    if (owner) document.dispatchEvent(new CustomEvent('veriqra:ai-cases-visibility', {
      detail: { projectId: owner.projectId, requirementId: owner.requirement.id, open: opened }
    }));
  }
  function clear() {
    const owner = context;
    ++epoch; context = null; preview = null; previewValidator = null; importedCoverage = false; coverageSourceCount = null; busy = false; uncertain = false; statusKey = null; returnFocus = null;
    panel.empty().addClass('d-none'); visibility(false, owner);
  }
  function open() {
    if (!context) return;
    if (panel.hasClass('d-none')) returnFocus = document.activeElement;
    panel.removeClass('d-none'); visibility(true, context); panel.find('.ai-instruction').trigger('focus');
  }
  function collapse() {
    panel.addClass('d-none'); visibility(false, context);
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  }
  function hasDraft() { return busy || !!preview || uncertain; }
  function message(key, error) { statusKey = key; panel.find('.ai-status').text(key ? tr(key) : '').toggleClass('text-danger', !!error); }
  function path(action) { return 'projects/' + context.projectId + '/requirements/' + context.requirement.id + '/ai-cases/' + action; }
  function controls() {
    panel.find('input,textarea,select,button').prop('disabled', busy || uncertain);
    panel.find('.ai-collapse').prop('disabled', false);
    panel.find('.ai-save').prop('disabled', busy || uncertain || !preview || !panel.find('.ai-select:checked').length);
  }
  function editor(key, value, multiline, max) {
    const label = text('<label class="form-label d-block mt-2">', key);
    const input = $(multiline ? '<textarea class="form-control" rows="2">' : '<input class="form-control">')
      .addClass('ai-' + key).val(value || '').attr('maxlength', max || 16000);
    return label.append(input);
  }
  function stepEditor(step) {
    const row = $('<div class="ai-step border rounded p-2 my-2">');
    row.append(editor('action', step.action, true, 8000), editor('expectedResult', step.expectedResult, true, 8000),
      text('<button type="button" class="btn btn-outline-secondary btn-sm mt-2">', 'removeStep').on('click', function () { row.remove(); }));
    return row;
  }
  function renderCandidates() {
    const target = panel.find('.ai-candidates').empty();
    preview.candidates.forEach(function (item, index) {
      const card = $('<article class="ai-candidate border rounded p-3 my-3">');
      card.append(text('<label class="form-check-label d-block">', 'select').prepend('<input type="checkbox" class="ai-select form-check-input me-2" checked>'),
        editor('title', item.title, false, 240));
      const details = $('<details class="ai-candidate-details mt-2">').prop('open', index === 0).append(
        text('<summary class="text-primary">', 'candidateDetails', 'Review steps and details'),
        editor('description', item.description, true), editor('preconditions', item.preconditions, true));
      const priority = $('<select class="ai-priority form-select">');
      ['LOW', 'MEDIUM', 'HIGH'].forEach(function (value) { priority.append($('<option>').val(value).text(window.I18n.enumLabel(value))); });
      details.append(text('<label class="form-label d-block mt-2">', 'priority').append(priority.val(item.priority)));
      const steps = $('<div class="ai-steps">'); item.steps.forEach(function (step) { steps.append(stepEditor(step)); });
      details.append(steps, text('<button type="button" class="btn btn-outline-secondary btn-sm me-2">', 'addStep').on('click', function () {
        if (steps.children().length < 30) steps.append(stepEditor({}));
      }));
      card.append(details, text('<button type="button" class="btn btn-outline-danger btn-sm mt-2">', 'reject').on('click', function () {
        card.remove(); if (!target.children().length) { preview = null; previewValidator = null; importedCoverage = false; coverageSourceCount = null; renderBasis(); panel.find('.ai-save,.ai-discard').addClass('d-none'); }
        controls();
      }));
      target.append(card);
    });
    panel.find('.ai-save,.ai-discard').removeClass('d-none');
    controls();
  }
  function selected() {
    return panel.find('.ai-candidate').filter(function () { return $(this).find('.ai-select').prop('checked'); }).map(function () {
      const row = $(this);
      return { title: row.find('.ai-title').val(), description: row.find('.ai-description').val(), preconditions: row.find('.ai-preconditions').val(),
        priority: row.find('.ai-priority').val(), steps: row.find('.ai-step').map(function (i) {
          return { stepOrder: i + 1, action: $(this).find('.ai-action').val(), expectedResult: $(this).find('.ai-expectedResult').val() };
        }).get() };
    }).get();
  }
  function validCandidates(rows) { return rows.length && rows.every(function (row) {
    return row.title.trim() && row.steps.length && row.steps.every(function (step) { return step.action.trim() && step.expectedResult.trim(); });
  }); }
  function navigationLink(tag, view, destination, key, fallback) {
    return text(tag, key, fallback).attr('href', window.VeriqraQaNavigation.href(view, destination)).on('click', function (event) {
      if (event.button && event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); window.VeriqraQaNavigation.open(view, destination);
    });
  }
  function renderSaved(saved) {
    const target = panel.find('.ai-saved').empty().removeClass('d-none');
    target.append(text('<h4 class="fs-6">', 'savedHeading', 'Saved test cases'),
      text('<p class="small mb-2">', 'savedNext', 'Saved as drafts. Requirement links await review.'));
    const list = $('<ul class="list-unstyled mb-2">');
    saved.forEach(function (row) {
      const destination = { projectId: String(context.projectId), testCaseId: String(row.id), sourceRequirementId: String(context.requirement.id) };
      list.append($('<li class="d-flex flex-wrap align-items-center gap-2 my-2">').append(
        $('<span class="me-auto">').text('TC-' + String(row.keyNo).padStart(3, '0') + ' · ' + row.title),
        navigationLink('<a class="btn btn-outline-primary btn-sm">', 'test-cases', destination, 'openSavedCase', 'Open and review case')));
    });
    target.append(list, navigationLink('<a class="btn btn-outline-secondary btn-sm">', 'test-plans',
      { projectId: String(context.projectId) }, 'viewPlans', 'Go to test plans'));
  }
  async function generate() {
    if (busy || uncertain) return;
    if (preview && !window.confirm(tr('replace'))) return;
    const token = epoch; busy = true; controls(); message('generating');
    try {
      const value = await api.post(path('preview'), { instruction: panel.find('.ai-instruction').val() });
      if (token !== epoch) return;
      panel.find('.ai-saved').empty().addClass('d-none');
      preview = value; previewValidator = null; importedCoverage = false; coverageSourceCount = null; renderBasis(); renderCandidates(); message('review');
    } catch (error) { if (token === epoch) { if (error.status === 401 || error.status === 403) clear(); else message(error.code && /^AI_/.test(error.code) ? error.code : 'failed', true); } }
    finally { if (token === epoch) { busy = false; controls(); } }
  }
  async function save() {
    if (busy || uncertain || !preview) return;
    const rows = selected();
    if (!validCandidates(rows)) { message('incomplete', true); return; }
    const token = epoch; busy = true; controls(); message('saving');
    try {
      if (previewValidator) await previewValidator();
      if (token !== epoch) return;
      const saved = await api.post(path('accept'), { expectedVersion: preview.expectedVersion, candidates: rows });
      if (token !== epoch) return;
      preview = null; previewValidator = null; panel.find('.ai-candidates').empty(); panel.find('.ai-save,.ai-discard').addClass('d-none');
      message(null);
      renderSaved(saved);
      document.dispatchEvent(new CustomEvent('veriqra:ai-saved', { detail: { projectId: context.projectId, requirementId: context.requirement.id } }));
    } catch (error) {
      if (token !== epoch) return;
      if (error.status === 401 || error.status === 403) { clear(); return; }
      if (!error.status || error.status >= 500) { uncertain = true; message('unknownSave', true); }
      else if (error.status === 409) message('stale', true);
      else message('saveFailed', true);
    } finally { if (token === epoch) { busy = false; controls(); } }
  }
  function mount(next) {
    if (!next || !next.writable) { clear(); return; }
    if (context && String(context.projectId) === String(next.projectId) && String(context.actorId) === String(next.actorId) && context.requirement.id === next.requirement.id && context.requirement.version === next.requirement.version) return;
    clear(); context = next;
    const requirement = context.requirement;
    const identity = (requirement.keyNo == null ? '' : 'REQ-' + String(requirement.keyNo).padStart(3, '0') + ' · ') + (requirement.title || '');
    const basis = $('<div class="ai-basis small border-start ps-3 mb-3">').append(
      text('<strong>', 'basisLabel', 'Generation basis'), $('<p class="ai-basis-requirement mb-1">').text(identity),
      $('<p class="ai-basis-description mb-0 text-secondary">'),
      $('<p class="ai-basis-source-count mb-0 text-secondary d-none">'));
    panel.append($('<div class="asset-panel-heading">').append(
      text('<h3 id="ai-cases-title" class="fs-5">', 'heading'),
      text('<button type="button" class="ai-collapse btn btn-outline-secondary btn-sm">', 'collapse', 'Collapse').on('click', collapse)), basis,
      editor('instruction', '', true, 2000), text('<button type="button" class="ai-generate btn btn-outline-primary">', 'generate').on('click', generate),
      $('<p class="ai-status mt-2" role="status" aria-live="polite">'), $('<div class="ai-candidates">'),
      text('<button type="button" class="ai-save btn btn-primary d-none me-2">', 'save').on('click', save),
      text('<button type="button" class="ai-discard btn btn-outline-secondary d-none">', 'discard').on('click', function () {
        preview = null; previewValidator = null; importedCoverage = false; coverageSourceCount = null; renderBasis(); panel.find('.ai-candidates').empty(); panel.find('.ai-save,.ai-discard').addClass('d-none'); message('discarded');
      }), $('<div class="ai-saved alert alert-success mt-3 d-none" role="status" aria-live="polite">'));
    renderBasis();
  }
  function importPreview(value, owner) {
    if (!context || context.actorId == null || busy || uncertain || !owner || typeof owner.validateFresh !== 'function' || String(owner.projectId) !== String(context.projectId)
      || String(owner.requirementId) !== String(context.requirement.id) || String(owner.actorId) !== String(context.actorId)
      || !value || String(value.requirementId) !== String(context.requirement.id) || value.expectedVersion !== context.requirement.version
      || !Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > 5
      || !value.candidates.every(function (row) { return row && typeof row.title === 'string' && row.title.length <= 240 && ['LOW', 'MEDIUM', 'HIGH'].includes(row.priority)
        && (row.description == null || typeof row.description === 'string') && (row.preconditions == null || typeof row.preconditions === 'string')
        && Array.isArray(row.steps) && row.steps.length <= 30 && row.steps.every(function (step) { return step && typeof step.action === 'string' && typeof step.expectedResult === 'string'; }); })
      || !validCandidates(value.candidates)) return false;
    if (preview && !window.confirm(tr('replace'))) return false;
    preview = { expectedVersion: value.expectedVersion, candidates: JSON.parse(JSON.stringify(value.candidates)) };
    previewValidator = owner.validateFresh;
    importedCoverage = true; coverageSourceCount = Number.isSafeInteger(value.sourceCaseCount) && value.sourceCaseCount >= 0 ? value.sourceCaseCount : null;
    renderBasis(); panel.find('.ai-saved').empty().addClass('d-none'); renderCandidates(); message('review'); open(); return true;
  }
  function renderBasis() {
    const key = importedCoverage ? 'coverageBasisDescription' : 'basisDescription';
    const fallback = importedCoverage ? 'Coverage review of this requirement and its linked cases' : 'Requirement, acceptance criteria and instructions';
    panel.find('.ai-basis-description').attr('data-ai-text', key).attr('data-ai-fallback', fallback).text(tr(key, fallback));
    panel.find('.ai-basis-source-count').toggleClass('d-none', !importedCoverage || coverageSourceCount == null)
      .text(importedCoverage && coverageSourceCount != null ? window.I18n.t('ai.coverageBasisCount', { count: coverageSourceCount }, 'Linked cases in source scope: {count}') : '');
  }
  panel.on('change', '.ai-select', controls);
  document.addEventListener('veriqra:localechange', function () {
    panel.find('[data-ai-text]').each(function () {
      // Update the label text node without replacing its input or edited content.
      const key = $(this).attr('data-ai-text');
      const fallback = $(this).attr('data-ai-fallback');
      Array.from(this.childNodes).filter(function (node) { return node.nodeType === 3; }).forEach(function (node) { node.nodeValue = tr(key, fallback); });
    });
    panel.find('.ai-priority option').each(function () { $(this).text(window.I18n.enumLabel(this.value)); });
    if (statusKey) panel.find('.ai-status').text(tr(statusKey));
    renderBasis();
  });
  window.VeriqraAiCases = Object.freeze({ mount: mount, open: open, clear: clear, hasDraft: hasDraft, validCandidates: validCandidates, importPreview: importPreview, loadPreview: importPreview });
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('ai-cases', { dirty: hasDraft, clear: clear });
})(jQuery, window.VeriqraApi);
