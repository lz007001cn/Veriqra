(function ($, api) {
  'use strict';
  const tr = function (key, args, fallback) { return window.I18n.t('aiDefect.' + key, args || null, fallback); };
  const panel = $('<section id="ai-defect-analysis-panel" class="ai-assist-panel d-none" aria-labelledby="ai-defect-analysis-title">');
  $('#defect-actions').after(panel);
  let context = null, result = null, resultLanguage = null, busy = false, blocked = false, denied = false, epoch = 0;
  let statusKey = null, statusError = false;
  const same = function (a, b) { return a != null && b != null && String(a) === String(b); };
  const positive = function (value) { return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0; };
  const current = function (token) { return token === epoch && context && (!context.isCurrent || context.isCurrent()); };
  function clear() {
    ++epoch; context = null; result = null; resultLanguage = null; busy = false; blocked = false; denied = false;
    statusKey = null; statusError = false; panel.empty().addClass('d-none');
  }
  function controls() {
    panel.find('.ai-defect-generate').prop('disabled', busy || blocked || denied || !context || !positive(context.actorId))
      .text(tr(busy ? 'generating' : result ? 'regenerate' : 'generate'));
    panel.find('.ai-defect-copy').prop('disabled', busy || blocked || !result).toggleClass('d-none', !result);
  }
  function status(key, error) {
    statusKey = key; statusError = !!error;
    panel.find('.ai-assist-status').text(key ? tr(key) : '').toggleClass('text-danger', statusError)
      .attr('role', statusError ? 'alert' : 'status');
  }
  function validStrings(values) {
    return Array.isArray(values) && values.length <= 12 && values.every(function (value) {
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
    });
  }
  function valid(value) {
    const analysis = value && value.analysis;
    return value && context && same(value.defectId, context.defect.id)
      && Number.isSafeInteger(value.expectedVersion) && value.expectedVersion >= 0 && value.expectedVersion === context.defect.version
      && typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt))
      && typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt))
      && Number.isSafeInteger(value.evidenceCount) && value.evidenceCount >= 0
      && Number.isSafeInteger(value.includedEvidenceCount) && value.includedEvidenceCount >= 0
      && value.includedEvidenceCount <= value.evidenceCount && typeof value.truncated === 'boolean'
      && analysis && typeof analysis.overview === 'string' && analysis.overview.trim().length > 0 && analysis.overview.length <= 6000
      && ['observations', 'possibleCauses', 'missingInformation', 'retestSuggestions'].every(function (key) { return validStrings(analysis[key]); });
  }
  function section(key, items, collapsed) {
    const target = $(collapsed ? '<details class="ai-assist-section">' : '<section class="ai-assist-section">');
    target.append($(collapsed ? '<summary>' : '<h4>').text(tr(key)));
    if (!items.length) target.append($('<p class="text-secondary mb-0">').text(tr('noItems')));
    else {
      const list = $('<ul class="ai-assist-items">');
      items.forEach(function (item) { list.append($('<li>').text(item)); });
      target.append(list);
    }
    return target;
  }
  function renderResult() {
    const target = panel.find('.ai-assist-result').empty().toggleClass('d-none', !result);
    if (!result) return;
    target.append($('<p class="ai-assist-overview">').text(result.analysis.overview),
      section('retestSuggestions', result.analysis.retestSuggestions, false),
      section('observations', result.analysis.observations, true),
      section('possibleCauses', result.analysis.possibleCauses, true),
      section('missingInformation', result.analysis.missingInformation, true));
    const basis = $('<details class="ai-assist-basis">').append($('<summary>').text(tr('basisDetails')),
      $('<p>').text(tr('basisVersion', { version: result.expectedVersion }, 'Record revision {version}')),
      $('<p>').text(tr('basisEvidence', { included: result.includedEvidenceCount, total: result.evidenceCount }, '{included} of {total} failure sources included')),
      $('<p>').text(tr('capturedAt') + ' ' + window.I18n.formatDateTime(result.capturedAt)),
      $('<p>').text(tr('generatedAt') + ' ' + window.I18n.formatDateTime(result.generatedAt)),
      $('<p>').text(tr('generatedLanguage') + ' ' + (resultLanguage === 'en' ? 'English' : '简体中文')));
    target.append(basis);
    if (result.truncated) target.prepend($('<p class="ai-assist-note">').text(tr('truncated')));
  }
  function render() {
    if (!context) return;
    panel.empty().removeClass('d-none').append(
      $('<div class="ai-assist-heading">').append($('<div>').append(
        $('<h3 id="ai-defect-analysis-title">').text(tr('title'))),
      $('<div class="ai-assist-actions">').append(
        $('<button type="button" class="btn btn-outline-primary ai-defect-generate">').on('click', generate),
        $('<button type="button" class="btn btn-outline-secondary ai-defect-copy d-none">').text(tr('copy')).on('click', copy))),
      $('<p class="ai-assist-status" role="status" aria-live="polite">'),
      $('<div class="ai-assist-result d-none">'),
      $('<div class="ai-assist-copy-fallback d-none">').append(
        $('<label for="ai-defect-copy-text" class="form-label">').text(tr('copyText')),
        $('<textarea id="ai-defect-copy-text" class="form-control" rows="8" readonly>')));
    renderResult(); status(statusKey, statusError); controls();
  }
  async function generate() {
    if (!context || busy || blocked || denied || !positive(context.actorId)) return;
    const token = epoch, language = window.I18n.getLocale();
    busy = true; controls(); status('generating');
    try {
      const value = await api.post('projects/' + encodeURIComponent(context.projectId) + '/defects/'
        + encodeURIComponent(context.defect.id) + '/ai-analysis', { language: language });
      if (!current(token)) return;
      if (!valid(value)) throw { code: 'AI_INVALID_RESPONSE' };
      result = value; resultLanguage = language;
      renderResult(); panel.find('.ai-assist-copy-fallback').addClass('d-none'); status('ready');
    } catch (error) {
      if (!current(token)) return;
      if (error && (error.status === 401 || error.status === 403)) {
        result = null; resultLanguage = null; denied = true; renderResult();
        panel.find('.ai-assist-copy-fallback').addClass('d-none'); status('accessChanged', true);
      } else {
        const known = ['AI_NOT_CONFIGURED', 'AI_AUTH_ERROR', 'AI_RATE_LIMITED', 'AI_UPSTREAM_ERROR', 'AI_TIMEOUT', 'AI_INVALID_RESPONSE'];
        const key = error && known.includes(error.code) ? error.code : 'failed';
        status(key, true);
        if (result) panel.find('.ai-assist-status').append($('<span>').text(' ' + tr('previousRetained')));
      }
    } finally { if (current(token)) { busy = false; controls(); } }
  }
  function plainText() {
    const lines = [tr('title'), 'BUG-' + String(context.defect.keyNo).padStart(3, '0') + ' · ' + context.defect.title,
      tr('basisVersion', { version: result.expectedVersion }, 'Record revision {version}'),
      tr('capturedAt') + ' ' + window.I18n.formatDateTime(result.capturedAt),
      tr('generatedAt') + ' ' + window.I18n.formatDateTime(result.generatedAt), '', result.analysis.overview];
    ['observations', 'possibleCauses', 'missingInformation', 'retestSuggestions'].forEach(function (key) {
      lines.push('', tr(key)); result.analysis[key].forEach(function (item) { lines.push('- ' + item); });
    });
    if (result.truncated) lines.push('', tr('truncated'));
    return lines.join('\n');
  }
  async function copy() {
    if (!result || busy || blocked || !context) return;
    const token = epoch, value = plainText();
    try {
      if (!window.navigator || !window.navigator.clipboard || !window.navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await window.navigator.clipboard.writeText(value);
      if (current(token)) { panel.find('.ai-assist-copy-fallback').addClass('d-none'); status('copied'); }
    } catch (_) {
      if (!current(token)) return;
      panel.find('#ai-defect-copy-text').val(value); panel.find('.ai-assist-copy-fallback').removeClass('d-none');
      panel.find('#ai-defect-copy-text').trigger('focus'); status('copyManual');
    }
  }
  function mount(next) {
    if (!next || !positive(next.projectId) || !next.defect || !positive(next.defect.id)) { clear(); return; }
    if (context && same(context.projectId, next.projectId) && same(context.defect.id, next.defect.id)
        && context.defect.version === next.defect.version && same(context.actorId, next.actorId)) { context = next; controls(); return; }
    clear(); context = next; statusKey = positive(next.actorId) ? null : 'checkingAccess'; render();
  }
  function setBlocked(value) {
    if (blocked !== !!value && value) { ++epoch; busy = false; if (context) status('refreshAfterChange'); }
    blocked = !!value; controls();
  }
  ['veriqra:project', 'veriqra:view', 'veriqra:reauthenticated'].forEach(function (name) { document.addEventListener(name, clear); });
  document.addEventListener('veriqra:localechange', function () {
    if (!context) return;
    ++epoch; busy = false;
    statusKey = result ? 'languageChanged' : positive(context.actorId) ? null : 'checkingAccess'; statusError = false;
    render();
  });
  window.addEventListener('pagehide', clear);
  window.VeriqraAiDefectAnalysis = Object.freeze({ mount: mount, clear: clear, setBlocked: setBlocked });
})(jQuery, window.VeriqraApi);
