(function ($, api) {
  'use strict';
  const t = function (key, args, fallback) { return window.I18n.t('aiRequirementAssist.' + key, args, fallback); };
  let context = null, epoch = 0, busy = false, mode = 'review', opened = false, status = null;
  let results = {}, selections = new Set();
  const panel = $('<section id="ai-requirement-assist-panel" class="asset-panel ai-assist-panel d-none" aria-labelledby="ai-requirement-assist-title">');
  $('#ai-cases-panel').after(panel);
  const same = function (a, b) { return a != null && b != null && String(a) === String(b); };
  const integer = function (value, minimum) { return Number.isSafeInteger(value) && value >= minimum; };
  const textValue = function (value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; };
  const strings = function (values) { return Array.isArray(values) && values.length <= 50 && values.every(function (value) { return textValue(value, 8000); }); };
  function path(owner) { return 'projects/' + encodeURIComponent(owner.projectId) + '/requirements/' + encodeURIComponent(owner.requirement.id); }
  function valid(token, owner) { return token === epoch && context === owner && context.writable; }
  function visibility(owner, visible) {
    owner = owner || context;
    if (owner) document.dispatchEvent(new CustomEvent('veriqra:ai-requirement-visibility', { detail: { projectId: owner.projectId, requirementId: owner.requirement.id, open: visible == null ? opened : visible } }));
  }
  function clear() {
    const owner = context;
    ++epoch; context = null; opened = false; results = {}; selections = new Set(); busy = false; status = null; panel.empty().addClass('d-none'); visibility(owner, false);
  }
  function collapse() { opened = false; panel.addClass('d-none'); visibility(); }
  function hasDraft() { return busy || selections.size > 0; }
  function message(key, args, fallback, error) { status = { key: key, args: args, fallback: fallback, error: error }; renderStatus(); }
  function renderStatus() { panel.find('.ai-assist-status').text(status ? t(status.key, status.args, status.fallback) : '').toggleClass('text-danger', !!status && !!status.error); }
  function fail(error) {
    if (error && (error.status === 401 || error.status === 403)) {
      const owner = context; clear();
      if (window.VeriqraAiCases) window.VeriqraAiCases.clear();
      if (owner) document.dispatchEvent(new CustomEvent('veriqra:ai-assist-permission-lost', { detail: { projectId: owner.projectId, requirementId: owner.requirement.id, actorId: owner.actorId } }));
      return;
    }
    message(error && error.code === 'INCOMPLETE_SCOPE' ? 'incompleteScope' : error && error.status === 409 ? 'stale' : 'failed', null,
      error && error.code === 'INCOMPLETE_SCOPE' ? 'Some source versions could not be verified. Review the suggestions manually; this batch cannot be imported.'
        : error && error.status === 409 ? 'The saved requirement or linked cases changed. Generate a fresh analysis before adopting suggestions.'
          : 'The analysis could not be completed. The previous result, if any, is retained. Try again.', true);
  }
  function validCandidate(row) {
    return row && textValue(row.title, 240) && ['LOW', 'MEDIUM', 'HIGH'].includes(row.priority)
      && (row.description == null || typeof row.description === 'string' && row.description.length <= 16000)
      && (row.preconditions == null || typeof row.preconditions === 'string' && row.preconditions.length <= 16000)
      && Array.isArray(row.steps) && row.steps.length >= 1 && row.steps.length <= 30
      && row.steps.every(function (step) { return step && textValue(step.action, 8000) && textValue(step.expectedResult, 8000); });
  }
  function validate(value, kind, owner) {
    if (!value || !same(value.requirementId, owner.requirement.id) || !integer(value.expectedVersion, 0) || value.expectedVersion !== owner.requirement.version
      || !Number.isFinite(Date.parse(value.capturedAt)) || !Number.isFinite(Date.parse(value.generatedAt)) || !value.analysis || !textValue(value.analysis.overview, 16000)) return false;
    if (kind === 'review') return strings(value.analysis.issues) && strings(value.analysis.questions) && strings(value.analysis.acceptanceCriteria);
    if (!integer(value.totalLinkedCases, 0) || !integer(value.includedCases, 0) || value.includedCases > 30 || value.includedCases > value.totalLinkedCases
      || typeof value.truncated !== 'boolean' || !Array.isArray(value.sourceCases) || value.sourceCases.length > 100 || value.sourceCases.length > value.totalLinkedCases
      || !strings(value.analysis.gaps) || !strings(value.analysis.duplicates) || !Array.isArray(value.analysis.candidates) || value.analysis.candidates.length > 5
      || !value.analysis.candidates.every(validCandidate)) return false;
    const ids = new Set();
    return value.sourceCases.every(function (row) {
      if (!row || !integer(row.id, 1) || !integer(row.version, 0) || !['DRAFT', 'READY', 'ARCHIVED'].includes(row.status)
        || !['CONFIRMED', 'NEEDS_REVIEW'].includes(row.linkStatus) || ids.has(row.id)) return false;
      ids.add(row.id); return true;
    });
  }
  function controls() {
    panel.find('.ai-assist-generate').prop('disabled', busy);
    panel.find('.ai-assist-adopt').prop('disabled', busy || !selections.size);
    panel.find('.ai-assist-handoff').prop('disabled', busy || !results.coverage || !results.coverage.analysis.candidates.length);
    panel.find('.ai-assist-criterion').prop('disabled', busy);
  }
  function section(target, key, fallback, values) {
    const block = $('<details class="ai-assist-section">').append($('<summary>').text(t(key, null, fallback) + ' (' + window.I18n.formatNumber(values.length) + ')'));
    const list = $('<ul>'); values.forEach(function (value) { list.append($('<li class="ai-assist-item">').text(value)); });
    block.append(values.length ? list : $('<p class="text-secondary">').text(t('none', null, 'None reported.'))); target.append(block);
  }
  function renderResult() {
    const target = panel.find('.ai-assist-result').empty(), value = results[mode];
    if (!value) return;
    target.append($('<p class="ai-assist-basis">').text(t('basis', { version: value.expectedVersion, captured: window.I18n.formatDateTime(value.capturedAt), generated: window.I18n.formatDateTime(value.generatedAt) },
      'Requirement revision {version} · Captured {captured} · Generated {generated}')), $('<p>').text(value.analysis.overview));
    if (mode === 'review') {
      section(target, 'issues', 'Issues', value.analysis.issues); section(target, 'questions', 'Questions to clarify', value.analysis.questions);
      const criteria = $('<details class="ai-assist-section">').append($('<summary>').text(t('criteria', null, 'Suggested acceptance criteria') + ' (' + window.I18n.formatNumber(value.analysis.acceptanceCriteria.length) + ')'));
      const choices = $('<div class="ai-assist-criteria">');
      value.analysis.acceptanceCriteria.forEach(function (criterion, index) {
        choices.append($('<label class="ai-assist-item">').append($('<input type="checkbox" class="form-check-input ai-assist-criterion">').prop('checked', selections.has(index))
          .on('change', function () { if (this.checked) selections.add(index); else selections.delete(index); controls(); }), $('<span>').text(criterion)));
      });
      criteria.append(choices); target.append(criteria);
      if (value.analysis.acceptanceCriteria.length) target.append($('<button type="button" class="btn btn-outline-primary ai-assist-adopt">').text(t('adopt', null, 'Append selected criteria to an edit draft')).on('click', adopt));
    } else {
      target.append($('<p class="ai-assist-basis">').text(t('coverageScope', { total: value.totalLinkedCases, included: value.includedCases }, 'Linked cases {total} · Detailed cases included {included}')));
      if (value.truncated) target.append($('<p class="ai-assist-basis">').text(t('truncated', null, 'Some linked-case content was omitted from this analysis. Suggestions may not cover the full scope.')));
      section(target, 'gaps', 'Coverage gaps', value.analysis.gaps); section(target, 'duplicates', 'Possible duplication', value.analysis.duplicates);
      section(target, 'candidates', 'Suggested cases', value.analysis.candidates.map(function (row) { return row.title; }));
      if (value.analysis.candidates.length) target.append($('<button type="button" class="btn btn-outline-primary ai-assist-handoff">').text(t('handoff', null, 'Review suggested cases')).on('click', handoff));
    }
    controls();
  }
  function render() {
    if (!context) return;
    panel.empty().toggleClass('d-none', !opened).append($('<div class="ai-assist-heading">').append(
      $('<h3 id="ai-requirement-assist-title" class="fs-5">').text(t(mode === 'review' ? 'reviewTitle' : 'coverageTitle', null, mode === 'review' ? 'Check requirement' : 'Find coverage gaps')),
      $('<div class="ai-assist-actions">').append($('<button type="button" class="btn btn-outline-primary ai-assist-generate">').text(t(results[mode] ? 'regenerate' : 'generate', null, results[mode] ? 'Generate again' : 'Generate analysis')).on('click', generate),
        $('<button type="button" class="btn btn-outline-secondary">').text(t('collapse', null, 'Collapse')).on('click', collapse))),
      $('<p class="ai-assist-status" role="status" aria-live="polite">'), $('<div class="ai-assist-result">'));
    renderResult(); renderStatus(); controls();
  }
  function mount(next) {
    if (!next || !next.writable || next.actorId == null) { clear(); return; }
    if (context && same(context.projectId, next.projectId) && same(context.actorId, next.actorId) && same(context.requirement.id, next.requirement.id) && context.requirement.version === next.requirement.version) {
      context.onAdoptCriteria = next.onAdoptCriteria; return;
    }
    clear(); context = next; render();
  }
  function open(kind) {
    if (!context || !['review', 'coverage'].includes(kind)) return;
    if (kind !== mode && busy) { ++epoch; busy = false; }
    mode = kind; opened = true; render(); visibility();
    if (!results[kind] && !busy) generate();
  }
  async function verifyFresh(value, owner, token, coverage) {
    if (!valid(token, owner)) throw { status: 409 };
    if (!window.VeriqraQaContext) throw { status: 403 };
    const permissions = await window.VeriqraQaContext.load(owner.projectId, true);
    if (!valid(token, owner)) throw { status: 409 };
    if (!permissions || !permissions.canWriteAssets || !same(permissions.actorId, owner.actorId)) throw { status: 403 };
    const current = await api.get(path(owner));
    if (!valid(token, owner)) throw { status: 409 };
    if (!current || !same(current.id, value.requirementId) || current.version !== value.expectedVersion || current.status === 'ARCHIVED') throw { status: 409 };
    if (coverage) {
      if (value.sourceCases.length !== value.totalLinkedCases) throw { status: 409, code: 'INCOMPLETE_SCOPE' };
      const links = await api.get(path(owner) + '/test-cases');
      if (!valid(token, owner)) throw { status: 409 };
      if (!Array.isArray(links)) throw { status: 502 };
      const active = links.filter(function (row) { return row.status !== 'REMOVED'; });
      if (active.length !== value.totalLinkedCases || value.sourceCases.some(function (source) {
        return !active.some(function (link) { return link.testCase && same(link.testCase.id, source.id) && link.testCase.version === source.version && link.testCase.status === source.status && link.status === source.linkStatus; });
      })) throw { status: 409 };
    }
    return current;
  }
  async function generate() {
    if (!context || busy) return;
    const owner = context, kind = mode, token = ++epoch; busy = true; controls(); message('generating', null, 'Generating analysis…');
    try {
      const value = await api.post(path(owner) + (kind === 'review' ? '/ai-review' : '/ai-coverage'), { language: window.I18n.getLocale ? window.I18n.getLocale() : document.documentElement.lang || 'zh-CN' });
      if (!valid(token, owner)) return;
      if (!validate(value, kind, owner)) throw { status: 502 };
      results[kind] = value; if (kind === 'review') selections = new Set(); status = null; renderResult(); renderStatus();
    } catch (error) { if (valid(token, owner)) fail(error); }
    finally { if (valid(token, owner)) { busy = false; controls(); } }
  }
  async function adopt() {
    if (!context || busy || !results.review || !selections.size) return;
    const owner = context, value = results.review, selected = [...selections].map(function (index) { return value.analysis.acceptanceCriteria[index]; }), token = epoch;
    busy = true; controls(); message('checkingSources', null, 'Checking the current requirement and source cases…');
    try {
      await verifyFresh(value, owner, token, false);
      if (!valid(token, owner)) return;
      if (typeof owner.onAdoptCriteria !== 'function') throw { status: 409 };
      await owner.onAdoptCriteria({ requirementId: value.requirementId, expectedVersion: value.expectedVersion, criteria: selected });
      if (!valid(token, owner)) return;
      selections = new Set(); status = null; renderStatus(); collapse();
    } catch (error) { if (valid(token, owner)) fail(error); }
    finally { if (valid(token, owner)) { busy = false; controls(); } }
  }
  async function handoff() {
    if (!context || busy || !results.coverage || !results.coverage.analysis.candidates.length) return;
    const owner = context, value = results.coverage, token = epoch; busy = true; controls(); message('checkingSources', null, 'Checking the current requirement and source cases…');
    try {
      await verifyFresh(value, owner, token, true);
      if (!valid(token, owner)) return;
      const editor = window.VeriqraAiCases;
      if (!editor || !editor.importPreview({ requirementId: value.requirementId, expectedVersion: value.expectedVersion, candidates: value.analysis.candidates, sourceCaseCount: value.totalLinkedCases }, {
        projectId: owner.projectId, requirementId: value.requirementId, actorId: owner.actorId,
        validateFresh: async function () {
          const check = epoch;
          try { return await verifyFresh(value, owner, check, true); }
          catch (error) { if (valid(check, owner)) fail(error); throw error; }
        }
      })) { message('editorBusy', null, 'Existing case candidates were retained. Finish or discard that draft before importing these suggestions.', true); return; }
      status = null; renderStatus(); collapse();
    } catch (error) { if (valid(token, owner)) fail(error); }
    finally { if (valid(token, owner)) { busy = false; controls(); } }
  }
  document.addEventListener('veriqra:localechange', function () {
    if (!context) return;
    ++epoch; const wasBusy = busy; busy = false;
    if (wasBusy) status = { key: 'interrupted', fallback: 'Language changed. The previous request result will be ignored; generate again when ready.', error: false };
    render();
  });
  document.addEventListener('veriqra:reauthenticated', clear);
  window.VeriqraRequirementAssist = Object.freeze({ mount: mount, open: open, clear: clear, hasDraft: hasDraft, validate: validate });
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('ai-requirement-assist', { dirty: hasDraft, clear: clear });
})(jQuery, window.VeriqraApi);
