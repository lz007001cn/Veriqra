(function ($, api) {
  'use strict';
  const tr = function (key, fallback) { return window.I18n.t('ai.' + key, null, fallback); };
  let context = null, preview = null, busy = false, uncertain = false, epoch = 0, statusKey = null;
  const panel = $('<section id="ai-cases-panel" class="asset-panel mt-3 d-none">');
  $('#asset-detail').after(panel);
  function text(tag, key, fallback) { return $(tag).attr('data-ai-text', key).attr('data-ai-fallback', fallback || '').text(tr(key, fallback)); }
  function clear() { ++epoch; context = null; preview = null; busy = false; uncertain = false; statusKey = null; panel.empty().addClass('d-none'); }
  function hasDraft() { return busy || !!preview || uncertain; }
  function message(key, error) { statusKey = key; panel.find('.ai-status').text(tr(key)).toggleClass('text-danger', !!error); }
  function path(action) { return 'projects/' + context.projectId + '/requirements/' + context.requirement.id + '/ai-cases/' + action; }
  function controls() {
    panel.find('input,textarea,select,button').prop('disabled', busy || uncertain);
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
    preview.candidates.forEach(function (item) {
      const card = $('<article class="ai-candidate border rounded p-3 my-3">');
      card.append(text('<label class="form-check-label d-block">', 'select').prepend('<input type="checkbox" class="ai-select form-check-input me-2" checked>'),
        editor('title', item.title, false, 240), editor('description', item.description, true), editor('preconditions', item.preconditions, true));
      const priority = $('<select class="ai-priority form-select">');
      ['LOW', 'MEDIUM', 'HIGH'].forEach(function (value) { priority.append($('<option>').val(value).text(window.I18n.enumLabel(value))); });
      card.append(text('<label class="form-label d-block mt-2">', 'priority').append(priority.val(item.priority)));
      const steps = $('<div class="ai-steps">'); item.steps.forEach(function (step) { steps.append(stepEditor(step)); });
      card.append(steps, text('<button type="button" class="btn btn-outline-secondary btn-sm me-2">', 'addStep').on('click', function () {
        if (steps.children().length < 30) steps.append(stepEditor({}));
      }), text('<button type="button" class="btn btn-outline-danger btn-sm">', 'reject').on('click', function () {
        card.remove(); if (!target.children().length) { preview = null; panel.find('.ai-save,.ai-discard').addClass('d-none'); }
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
      text('<p class="small mb-2">', 'savedNext', 'Open each case, review its content and mark it Ready before adding it to a test plan. Requirement links still need review.'));
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
      preview = value; renderCandidates(); message('review');
    } catch (error) { if (token === epoch) message(error.code && /^AI_/.test(error.code) ? error.code : 'failed', true); }
    finally { if (token === epoch) { busy = false; controls(); } }
  }
  async function save() {
    if (busy || uncertain || !preview) return;
    const rows = selected();
    if (!validCandidates(rows)) { message('incomplete', true); return; }
    const token = epoch; busy = true; controls(); message('saving');
    try {
      const saved = await api.post(path('accept'), { expectedVersion: preview.expectedVersion, candidates: rows });
      if (token !== epoch) return;
      preview = null; panel.find('.ai-candidates').empty(); panel.find('.ai-save,.ai-discard').addClass('d-none');
      message('saved');
      renderSaved(saved);
      document.dispatchEvent(new CustomEvent('veriqra:ai-saved', { detail: { projectId: context.projectId, requirementId: context.requirement.id } }));
    } catch (error) {
      if (token !== epoch) return;
      if (!error.status || error.status >= 500) { uncertain = true; message('unknownSave', true); }
      else if (error.status === 409) message('stale', true);
      else message('saveFailed', true);
    } finally { if (token === epoch) { busy = false; controls(); } }
  }
  function mount(next) {
    if (!next || !next.writable) { clear(); return; }
    if (context && String(context.projectId) === String(next.projectId) && context.requirement.id === next.requirement.id && context.requirement.version === next.requirement.version) return;
    clear(); context = next;
    panel.removeClass('d-none').append(text('<h3 class="fs-5">', 'heading'), text('<p class="small text-secondary">', 'help'),
      editor('instruction', '', true, 2000), text('<button type="button" class="ai-generate btn btn-outline-primary">', 'generate').on('click', generate),
      $('<p class="ai-status mt-2" role="status" aria-live="polite">'), $('<div class="ai-candidates">'),
      text('<button type="button" class="ai-save btn btn-primary d-none me-2">', 'save').on('click', save),
      text('<button type="button" class="ai-discard btn btn-outline-secondary d-none">', 'discard').on('click', function () {
        preview = null; panel.find('.ai-candidates').empty(); panel.find('.ai-save,.ai-discard').addClass('d-none'); message('discarded');
      }), $('<div class="ai-saved alert alert-success mt-3 d-none">'));
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
  });
  window.VeriqraAiCases = Object.freeze({ mount: mount, clear: clear, hasDraft: hasDraft, validCandidates: validCandidates });
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('ai-cases', { dirty: hasDraft, clear: clear });
})(jQuery, window.VeriqraApi);
