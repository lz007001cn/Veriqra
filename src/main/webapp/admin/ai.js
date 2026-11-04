(function ($, api) {
  'use strict';
  const t = (key, args, fallback) => window.I18n.t(key, args, fallback);
  const content = $('#admin-content');
  const feedback = $('#admin-feedback');
  const customChoice = '__custom_model__';
  const disclosureStates = new Map();
  let authorized = false, identity = null, authorization = 0, configurationRequest = 0, refreshRequest = 0, checkRequest = 0;
  let configuration = null, report = null, draft = '', choice = '', saving = false, refreshing = false, loading = false;
  let uncertain = false, needsReview = false, failure = null, notice = null, accessFailure = null;
  let checking = false, modelCheck = null;
  const hasDraft = () => saving || uncertain || !!configuration && draft.trim() !== String(configuration.model || '');
  const mayLeave = () => !window.VeriqraDraftGuard || window.VeriqraDraftGuard.allowLeave();
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? window.I18n.formatNumber(value) : '—';
  const time = value => value && Number.isFinite(Date.parse(value)) ? window.I18n.formatDateTime(value) : '—';
  const text = (tag, value, style) => $('<' + tag + '>').addClass(style || '').text(value == null || value === '' ? '—' : String(value));
  function button(id, label, callback, style) {
    return $('<button type="button">').attr('id', id).addClass('btn ' + (style || 'btn-outline-primary')).text(label).on('click', callback);
  }
  function message(key, fallback, args) { return t('adminAi.' + key, args || null, fallback); }
  function errorText(error) {
    if (error?.adminAiKey) return message(error.adminAiKey, error.messageFallback);
    if (error?.messageKey) return t(error.messageKey, error.messageArgs, error.messageFallback || error.message);
    return window.I18n.error(error);
  }
  function clearDraft() { draft = configuration ? String(configuration.model || '') : ''; uncertain = false; needsReview = false; choice = ''; }
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('admin-ai', { dirty: hasDraft, clear: clearDraft });
  function showFeedback() {
    const error = failure ? errorText(failure) : '';
    const value = error || (notice ? message(notice.key, notice.fallback) : '');
    feedback.text(value).toggleClass('d-none', !value).toggleClass('alert-danger', !!error)
      .toggleClass('alert-success', !!value && !error).attr('role', error ? 'alert' : 'status');
    if (authorized && (needsReview || uncertain)) feedback.append(button('ai-review-current',
      message('reviewCurrent', 'Load current settings; keep my selection'), () => loadConfiguration(true), 'btn-outline-secondary btn-sm ms-2').prop('disabled', loading));
  }
  function showAccess() {
    feedback.empty().addClass('d-none');
    content.empty().attr('aria-busy', 'false');
    if (!accessFailure) content.append(text('p', t('admin.checkingAdministratorAccess', null, 'Checking administrator access…')).attr('role', 'status'));
    else {
      content.append(text('p', errorText(accessFailure), 'alert alert-danger').attr('role', 'alert'));
      if (accessFailure.status !== 403) content.append(button('ai-access-retry', t('common.retry', null, 'Retry'), checkAuthorization));
    }
  }
  function stopForAccess(error) {
    if (error.status !== 401 && error.status !== 403) return false;
    authorized = false; authorization++; configurationRequest++; refreshRequest++; checkRequest++; saving = false; refreshing = false; loading = false; checking = false; modelCheck = null;
    accessFailure = error; report = null; showAccess(); return true;
  }
  function safeConsoleLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'console.cloud.google.com' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  function link(key, label) {
    const href = safeConsoleLink(configuration?.links?.[key]);
    return href ? $('<a target="_blank" rel="noopener noreferrer">').attr('href', href).text(label) : null;
  }
  function links(items) {
    const row = $('<div class="admin-ai-links">');
    items.forEach(([key, label]) => { const anchor = link(key, label); if (anchor) row.append(anchor); });
    return row;
  }
  function section(id, title) { return $('<section class="admin-ai-card">').attr({ id, 'aria-labelledby': id + '-title' }).append(text('h2', title).attr('id', id + '-title')); }
  function statusLabel(value) {
    switch (value) {
      case 'OK': return message('statusConnected', 'Available');
      case 'CONNECTED': return message('statusProjectConnected', 'Google project connection successful');
      case 'PARTIAL': return message('statusPartial', 'Some data retrieved');
      case 'NOT_CONFIGURED': return message('statusNotConfigured', 'Not configured');
      case 'NO_DATA': return message('statusNoData', 'No data returned');
      case 'PERMISSION_DENIED': return message('statusPermissionDenied', 'Permission required');
      case 'API_DISABLED': return message('statusApiDisabled', 'Google API is disabled');
      case 'UNAVAILABLE': return message('statusUnavailable', 'Temporarily unavailable');
      default: return message('statusNotChecked', 'Not refreshed yet');
    }
  }
  function isOk(data) { return !!data && ['OK', 'CONNECTED'].includes(data.status); }
  function appendStatus(target, data) {
    const status = data?.status;
    target.append(text('span', statusLabel(status), 'admin-ai-status')
      .attr('data-state', isOk(data) ? 'ok' : status && status !== 'NO_DATA' ? 'error' : 'pending'));
    if (data?.code && !isOk(data)) target.append(text('p', message('googleStatusCode', 'Google response: {code}', { code: data.code }), 'admin-ai-note mt-2'));
  }
  function disclosure(id, title, body, key = id) {
    const details = $('<details class="admin-ai-details">').attr('id', id).prop('open', disclosureStates.get(key) === true);
    details.append($('<summary>').attr('id', id + '-summary').append(...(Array.isArray(title) ? title : [title])));
    let populated = false;
    const populate = () => {
      if (populated) return;
      populated = true;
      details.append(typeof body === 'function' ? body() : body);
    };
    if (typeof body !== 'function' || details.prop('open')) populate();
    details.on('toggle', function () {
      if (!this.isConnected) return;
      disclosureStates.set(key, this.open);
      if (this.open) populate();
    });
    return details;
  }
  function snapshotFocus() {
    const active = document.activeElement;
    if (!active || !content[0]?.contains(active) || !active.id) return null;
    return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  }
  function restoreFocus(saved) {
    if (!saved || document.activeElement !== document.body && document.activeElement?.isConnected) return;
    const control = document.getElementById(saved.id);
    if (!control || control.disabled) return;
    control.focus();
    if (control.setSelectionRange && saved.start != null) { try { control.setSelectionRange(saved.start, saved.end); } catch (_) { /* Selects cannot restore a text range. */ } }
  }
  function updateModelControls() {
    const dirty = !!configuration && draft.trim() !== String(configuration.model || '');
    $('#ai-custom-field').toggleClass('d-none', choice !== customChoice);
    $('#ai-custom-model').prop('required', choice === customChoice).prop('disabled', saving || loading || !configuration?.writable);
    $('#ai-model').prop('disabled', saving || loading || !configuration?.writable);
    $('#ai-save').prop('disabled', !dirty || !draft.trim() || saving || loading || uncertain || needsReview || !configuration?.writable);
    $('#ai-reset').prop('disabled', !dirty || saving || loading || uncertain);
    $('#ai-draft-note').text(dirty ? message('unsavedModel', 'Unsaved selection. The current model stays active until you save.') : message('modelSaved', 'This model is currently active.'));
  }
  function sourceLabel(value) {
    if (value === 'configuration') return message('sourceServerConfiguration', 'Server configuration');
    if (value === 'local-settings') return message('sourceAdminSelection', 'Admin selection');
    return '—';
  }
  function renderModel() {
    const card = section('ai-model-card', message('modelTitle', 'Model configuration'));
    card.append($('<div class="admin-ai-current">').append(text('strong', message('effectiveModel', 'Current effective model')),
      text('code', configuration.model || message('statusNotConfigured', 'Not configured')).attr('id', 'ai-effective-model')));
    const metadata = $('<dl class="admin-ai-context">');
    [['project', message('project', 'Google Cloud project')], ['location', message('location', 'Location')], ['source', message('source', 'Configuration source')]]
      .forEach(([key, label]) => metadata.append($('<div>').append(text('dt', label), text('dd', key === 'source' ? sourceLabel(configuration.source) : configuration[key]))));
    card.append(metadata);
    const form = $('<form id="ai-model-form" novalidate>');
    const select = $('<select id="ai-model" class="form-select">').attr('aria-describedby', 'ai-model-help ai-draft-note');
    const candidates = Array.isArray(configuration.models) ? configuration.models.filter(item => item && typeof item.id === 'string' && item.id && item.id !== customChoice) : [];
    const seen = new Set();
    candidates.forEach(item => { if (!seen.has(item.id)) { const label = String(item.label || '').trim(); seen.add(item.id); select.append($('<option>').val(item.id).text(label && label !== item.id ? label + ' · ' + item.id : item.id)); } });
    select.append($('<option>').val(customChoice).text(message('customModel', 'Custom model ID')));
    if (!choice || choice !== customChoice && !seen.has(choice)) choice = seen.has(draft) ? draft : customChoice;
    select.val(choice).on('change', function () { choice = this.value; if (choice !== customChoice) draft = choice; else draft = $('#ai-custom-model').val(); failure = null; notice = null; showFeedback(); updateModelControls(); });
    const custom = $('<input id="ai-custom-model" class="form-control" type="text" maxlength="128" autocomplete="off" spellcheck="false">')
      .attr({ pattern: 'gemini-[a-z0-9][a-z0-9._-]*', 'aria-describedby': 'ai-model-help ai-draft-note' }).val(choice === customChoice ? draft : '')
      .on('input', function () { draft = this.value; failure = null; notice = null; showFeedback(); updateModelControls(); });
    const fields = $('<div class="admin-ai-model-fields">').append($('<div>').append($('<label for="ai-model" class="form-label">').text(message('selectModel', 'Select model')), select),
      $('<div id="ai-custom-field">').append($('<label for="ai-custom-model" class="form-label">').text(message('customModelId', 'Model ID')), custom));
    form.append(fields, text('p', message('modelHelp', 'Saving applies the model immediately to new AI requests. Selecting a model does not send a generation request.'), 'admin-ai-note mt-2').attr('id', 'ai-model-help'),
      text('p', '', 'small').attr({ id: 'ai-draft-note', role: 'status', 'aria-live': 'polite' }),
      $('<div class="admin-ai-actions">').append($('<button id="ai-save" type="submit" class="btn btn-primary">').text(saving ? message('saving', 'Saving…') : t('common.save', null, 'Save')),
        button('ai-reset', message('discardSelection', 'Reset selection'), () => { clearDraft(); failure = null; notice = null; render(); }, 'btn-outline-secondary')));
    form.on('submit', event => { event.preventDefault(); save(); }); card.append(form);
    if (!configuration.writable) card.append(text('p', message('readOnly', 'This server cannot persist model changes. Ask the server administrator to enable a writable settings file.'), 'admin-ai-note mt-3'));
    return card;
  }
  function renderConnection() {
    const card = section('ai-connection-card', message('connectionTitle', 'Google Cloud connection'));
    const heading = $('<div class="admin-ai-heading">').append($('<div>').append(text('p', message('refreshHelp', 'Refresh reads Google connection and monitoring data for the current effective configuration. It does not generate AI content.'), 'admin-ai-note')),
      $('<div class="admin-ai-actions mt-0">').append(button('ai-refresh', refreshing ? message('refreshing', 'Refreshing…') : message('refreshGoogle', 'Refresh Google data'), refreshGoogle)
        .prop('disabled', refreshing || saving || loading || !configuration.configured),
      button('ai-check-model', checking ? message('checkingModel', 'Checking model…') : message('checkModel', 'Check current model'), checkModel, 'btn-outline-secondary')
        .prop('disabled', checking || saving || loading || !configuration.configured)));
    card.append(heading); appendStatus(card, report?.connection);
    card.append(text('p', message('lastRefresh', 'Last refresh: {time}', { time: time(report?.checkedAt) }), 'admin-ai-note mt-2'));
    if (!configuration.configured) card.append(text('p', message('credentialsRequired', 'Configure the Google project and credentials on the server to read Google data.'), 'admin-ai-note'));
    card.append(disclosure('ai-model-check-help', message('modelCheckDetails', 'About the model check'),
      text('p', message('checkModelHelp', 'The separate model check calls Google countTokens for the current effective model. This free token-count check does not verify content generation.'), 'admin-ai-note')));
    if (hasDraft()) card.append(text('p', message('checkSavedModel', 'Your selection is unsaved. The check uses the current effective model shown above.'), 'admin-ai-note'));
    if (modelCheck) {
      const result = $('<div class="mt-3">');
      if (isOk(modelCheck)) result.append(text('p', message('modelCheckPassed', 'Model token-count check passed.'), 'mb-1'));
      else appendStatus(result, modelCheck);
      result.append(text('p', message('modelCheckResult', 'Checked model: {model} · {time}', { model: modelCheck.model || '—', time: time(modelCheck.checkedAt) }), 'admin-ai-note'));
      if (isOk(modelCheck) && typeof modelCheck.totalTokens === 'number') result.append(text('p', message('modelCheckTokens', 'Tokens in the check request: {tokens}', { tokens: number(modelCheck.totalTokens) }), 'admin-ai-note'));
      card.append(result);
    }
    if (report && reportModel !== configuration.model) card.append(text('p', message('refreshNewModel', 'The model changed. Refresh to read data for the current configuration.'), 'admin-ai-note'));
    card.append(links([['vertex', message('openVertex', 'Open Vertex AI console')]]));
    if (report && [report.connection, report.usage, report.quotas, report.billing].some(item => ['API_DISABLED', 'PERMISSION_DENIED'].includes(item?.status))) {
      const setup = $('<details class="workflow-details">').attr('id', 'ai-query-setup').append(
        text('summary', message('querySetup', 'Set up Google data access')),
        text('p', message('querySetupHelp', 'Enable the required read APIs in this Google project. Model calls and monitoring, quota, and billing reads use separate permissions.'), 'admin-ai-note'),
        text('p', message('querySetupRoles', 'Use project-read access, Monitoring Viewer, Service Usage Viewer, and billing-account viewer permissions as needed. The application does not change Google permissions.'), 'admin-ai-note'));
      const apiLinks = $('<div class="admin-ai-links">');
      [['cloudresourcemanager.googleapis.com', 'Cloud Resource Manager'], ['monitoring.googleapis.com', 'Cloud Monitoring'],
        ['serviceusage.googleapis.com', 'Service Usage'], ['cloudbilling.googleapis.com', 'Cloud Billing']].forEach(([service, label]) => {
        const href = 'https://console.cloud.google.com/apis/library/' + service + '?project=' + encodeURIComponent(configuration.project || '');
        apiLinks.append($('<a target="_blank" rel="noopener noreferrer">').attr('href', href).text(label));
      });
      setup.append(apiLinks); card.append(setup);
    }
    return card;
  }
  let reportModel = null;
  function renderUsage() {
    const card = section('ai-usage-card', message('usageTitle', 'Google usage · last 24 hours'));
    const data = report?.usage; appendStatus(card, data);
    const metrics = $('<dl class="admin-ai-metrics">');
    [['requests', message('requests', 'Requests')], ['inputTokens', message('inputTokens', 'Input tokens')], ['outputTokens', message('outputTokens', 'Output tokens')], ['totalTokens', message('totalTokens', 'Total tokens')]]
      .forEach(([key, label]) => metrics.append($('<div class="admin-ai-metric">').append(text('dt', label), text('dd', isOk(data) || data?.status === 'PARTIAL' ? number(data[key]) : '—').attr('id', 'ai-usage-' + key))));
    const help = $('<div>').append(text('p', message('usageHelp', 'Data covers this Google project and the current model across all locations, and may include other applications. Google Monitoring data may arrive late. Missing measurements are shown as —.'), 'admin-ai-note'));
    if (data?.windowStart || data?.windowEnd) help.append(text('p', message('usageWindow', 'Window: {start} – {end}', { start: time(data.windowStart), end: time(data.windowEnd) }), 'admin-ai-note'));
    card.append(metrics, disclosure('ai-usage-details', message('usageDetails', 'Measurement scope and timing'), help));
    return card;
  }
  function quotaValue(value) {
    if (value === -1 || value === '-1') return message('quotaUnlimited', 'No fixed limit');
    return typeof value === 'number' ? number(value) : typeof value === 'string' && value.trim() ? value : '—';
  }
  function dimensions(value) {
    if (!value) return '—';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
    return typeof value === 'object' ? Object.entries(value).map(([key, item]) => key + ': ' + String(item)).join(', ') : '—';
  }
  function renderQuotas() {
    const card = section('ai-quota-card', message('quotasTitle', 'Google quotas'));
    const data = report?.quotas; appendStatus(card, data);
    card.append(text('p', message('quotaSummaryHelp', 'Project quota settings, not remaining calls. Expand a metric to inspect its limits and scope.'), 'admin-ai-note mt-2'));
    if (data?.capacityMode) card.append(text('p', message('capacityMode', 'Capacity mode: {mode}', {
      mode: ['SHARED_PAYGO', 'DSQ'].includes(data.capacityMode) ? message('sharedCapacity', 'Shared capacity (Standard PayGo)') : data.capacityMode }), 'admin-ai-note'));
    const items = isOk(data) && Array.isArray(data.items) ? data.items : [];
    if (items.length) {
      const groups = new Map();
      items.forEach(item => {
        const key = JSON.stringify([item.quotaId || item.name || '', item.unit || '']);
        if (!groups.has(key)) groups.set(key, { key, first: item, items: [] });
        groups.get(key).items.push(item);
      });
      const scope = JSON.stringify([configuration.project, configuration.location, configuration.model]);
      const list = $('<div class="admin-ai-quota-groups">');
      Array.from(groups.values()).forEach((group, index) => {
        const title = [text('span', group.first.name || group.first.quotaId || '—', 'admin-ai-quota-name'),
          text('span', message('quotaScopeCount', '{count} scope entries', { count: number(group.items.length) }), 'admin-ai-quota-count')];
        list.append(disclosure('ai-quota-group-' + index, title, () => {
          const content = $('<div class="admin-ai-quota-content">');
          if (group.first.quotaId) content.append(text('p', group.first.quotaId, 'admin-ai-quota-id'));
          if (group.first.unit) content.append(text('p', message('quotaUnitValue', 'Unit: {unit}', { unit: group.first.unit }), 'admin-ai-note'));
          const table = $('<table class="table admin-ai-quota">').attr('aria-label', group.first.name || group.first.quotaId || message('quotasTitle', 'Google quotas'));
          const head = $('<tr>'); [message('quotaDimensions', 'Scope'), message('quotaLimit', 'Google limit')].forEach(label => head.append(text('th', label).attr('scope', 'col')));
          const body = $('<tbody>'); group.items.forEach(item => body.append($('<tr>').append(
            text('td', dimensions(item.dimensions) === '—' || dimensions(item.dimensions) === '' ? message('quotaDefaultScope', 'Default (no dimension override)') : dimensions(item.dimensions)),
            text('td', quotaValue(item.value)))));
          table.append($('<thead>').append(head), body);
          return content.append($('<div class="table-responsive">').append(table));
        }, scope + group.key).addClass('admin-ai-quota-group'));
      });
      card.append(disclosure('ai-quota-details', message('quotaDetails', 'Quota details · {groups} groups · {rows} scope entries', { groups: number(groups.size), rows: number(items.length) }),
        $('<div>').append(text('p', message('quotaHelp', 'Quota values are Google limits, not remaining calls. Dynamic shared quota (DSQ) has no fixed remaining request count.'), 'admin-ai-note'),
          text('p', message('quotaGroupingHelp', 'The same metric can have separate limits for each region or model. Entries are grouped without adding their limits together; default entries do not mean a global endpoint limit.'), 'admin-ai-note'), list), scope + ':quotas'));
    } else card.append(text('p', !report ? message('quotaRefreshFirst', 'Refresh Google data to load quota settings.') : message('noQuotaRows', 'No quota rows returned. Open the Google console to inspect limits for this project.'), 'admin-ai-note'));
    card.append(links([['quotas', message('openQuotas', 'Open Google quotas')]])); return card;
  }
  function renderBilling() {
    const card = section('ai-billing-card', message('billingTitle', 'Credits, balance and costs'));
    const data = report?.billing; appendStatus(card, data);
    const metadata = $('<dl class="admin-ai-context mt-3">');
    [[message('billingEnabled', 'Billing'), typeof data?.billingEnabled === 'boolean' ? data.billingEnabled ? message('enabled', 'Enabled') : message('disabled', 'Disabled') : '—'],
      [message('billingAccount', 'Billing account'), data?.displayName || data?.billingAccountName], [message('currency', 'Currency'), data?.currencyCode]]
      .forEach(([label, value]) => metadata.append($('<div>').append(text('dt', label), text('dd', value))));
    card.append(metadata, $('<div class="admin-ai-billing">').append($('<div>').append(text('h3', message('creditsTitle', 'Credits and balance')),
      links([['credits', message('openCredits', 'View Google credits')]])), $('<div>').append(text('h3', message('costsTitle', 'Costs')),
      links([['billing', message('openBilling', 'Open Google billing')]]))));
    card.append(disclosure('ai-billing-details', message('billingDetails', 'About credits and costs'), $('<div>').append(
      text('p', message('creditsUnavailable', 'Google public APIs do not return the remaining promotional credit or account balance. View the current amount on the Google credits page.'), 'admin-ai-note'),
      text('p', message('costsUnavailable', 'Billing export is not configured for this view. Costs are unavailable here; view charges in the Google billing console.'), 'admin-ai-note'))));
    return card;
  }
  function render() {
    if (!authorized) { showAccess(); return; }
    const focus = snapshotFocus(); showFeedback();
    content.empty().attr('aria-busy', String(loading));
    if (!configuration) {
      content.append(text('p', loading ? t('common.loading', null, 'Loading…') : message('configurationUnavailable', 'AI settings could not be loaded.')).attr('role', 'status'));
      if (!loading) content.append(button('ai-config-retry', t('common.retry', null, 'Retry'), () => loadConfiguration(false)));
    } else content.append($('<div class="admin-ai-layout">').append(renderModel(), renderConnection(), renderUsage(), renderQuotas(), renderBilling()));
    updateModelControls(); restoreFocus(focus);
  }
  async function loadConfiguration(preserve) {
    if (!authorized) return;
    const token = ++configurationRequest, auth = authorization;
    refreshRequest++; checkRequest++; refreshing = false; checking = false;
    loading = true; failure = null; render();
    try {
      const value = await api.get('admin/ai');
      if (!authorized || token !== configurationRequest || auth !== authorization) return;
      if (configuration && ['model', 'project', 'location'].some(key => configuration[key] !== value[key])) { report = null; reportModel = null; modelCheck = null; }
      configuration = value; if (!preserve) clearDraft();
      uncertain = false; needsReview = false; notice = preserve ? { key: 'settingsReviewed', fallback: 'Current settings loaded. Review your selection, then save to apply it.' } : null;
    } catch (error) {
      if (token !== configurationRequest || auth !== authorization) return;
      if (!stopForAccess(error)) failure = error;
    } finally { if (token === configurationRequest && auth === authorization) { loading = false; render(); } }
  }
  async function save() {
    if (!authorized || saving || loading || uncertain || needsReview || !configuration?.writable || !hasDraft()) return;
    const model = draft.trim();
    if (model.length > 128 || !/^gemini-[a-z0-9][a-z0-9._-]*$/.test(model)) {
      failure = { adminAiKey: 'invalidModel', messageFallback: 'Enter a model ID beginning with gemini-, up to 128 lowercase letters, numbers, dots, underscores or hyphens.' }; showFeedback(); $('#ai-custom-model')[0]?.focus(); return;
    }
    const token = ++configurationRequest, auth = authorization, submittedDraft = draft;
    refreshRequest++; checkRequest++; refreshing = false; checking = false; modelCheck = null; saving = true; failure = null; notice = null; render();
    try {
      const value = await api.put('admin/ai', { model, expectedRevision: configuration.revision });
      if (!authorized || token !== configurationRequest || auth !== authorization) return;
      configuration = value; if (draft === submittedDraft) { draft = String(value.model || ''); choice = ''; }
      report = null; reportModel = null; notice = { key: 'saved', fallback: 'Model saved and active for new AI requests.' };
    } catch (error) {
      if (token !== configurationRequest || auth !== authorization) return;
      if (stopForAccess(error)) return;
      if (error.status === 409) { needsReview = true; failure = { adminAiKey: 'saveConflict', messageFallback: 'The active configuration changed. Load current settings to compare them with your selection before saving again.' }; }
      else if (!error.status || error.status >= 500) { uncertain = true; failure = { adminAiKey: 'saveUncertain', messageFallback: 'The save result could not be confirmed. Load current settings to check which model is active before saving again.' }; }
      else failure = error;
    } finally { if (token === configurationRequest && auth === authorization) { saving = false; render(); } }
  }
  async function refreshGoogle() {
    if (!authorized || refreshing || saving || loading || !configuration?.configured) return;
    const token = ++refreshRequest, auth = authorization, model = configuration.model;
    refreshing = true; failure = null; notice = null; render();
    try {
      // The server reads its active configuration. Never send the unsaved model selection.
      const value = await api.post('admin/ai/refresh');
      if (!authorized || token !== refreshRequest || auth !== authorization) return;
      if (['model', 'project', 'location', 'revision'].some(key => value[key] != null && String(value[key]) !== String(configuration[key] ?? ''))) {
        report = null; reportModel = null; modelCheck = null; await loadConfiguration(true); return;
      }
      report = value; reportModel = model;
    } catch (error) {
      if (token !== refreshRequest || auth !== authorization) return;
      if (!stopForAccess(error)) failure = error;
    } finally { if (token === refreshRequest && auth === authorization) { refreshing = false; render(); } }
  }
  async function checkModel() {
    if (!authorized || checking || saving || loading || !configuration?.configured) return;
    const token = ++checkRequest, auth = authorization;
    checking = true; modelCheck = null; failure = null; notice = null; render();
    try {
      const value = await api.post('admin/ai/check-model');
      if (!authorized || token !== checkRequest || auth !== authorization) return;
      if (value.model && value.model !== configuration.model) { modelCheck = null; await loadConfiguration(true); return; }
      modelCheck = value;
    } catch (error) {
      if (token !== checkRequest || auth !== authorization) return;
      if (!stopForAccess(error)) failure = error;
    } finally { if (token === checkRequest && auth === authorization) { checking = false; render(); } }
  }
  async function checkAuthorization() {
    const token = ++authorization; configurationRequest++; refreshRequest++; checkRequest++;
    authorized = false; accessFailure = null; saving = false; refreshing = false; checking = false; loading = false; showAccess();
    try {
      await window.I18n.init(); if (token !== authorization) return;
      const user = await api.get('auth/me'); if (token !== authorization) return;
      $('#admin-user').text(user.username);
      if (identity != null && String(identity) !== String(user.id)) { configuration = null; report = null; modelCheck = null; clearDraft(); }
      identity = user.id;
      if (user.systemRole !== 'ADMIN') {
        configuration = null; report = null; modelCheck = null; clearDraft(); accessFailure = { status: 403, messageKey: 'admin.forbiddenPlatformAdministratorAccessIsRequired', messageFallback: 'Forbidden: platform administrator access is required.' }; showAccess(); return;
      }
      authorized = true;
      if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('veriqra:identity', { detail: { user } }));
      await loadConfiguration(!!configuration);
    } catch (error) { if (token === authorization) { accessFailure = error; showAccess(); } }
  }
  $('#admin-menu').on('click', function () { const open = $('#admin-sidebar').toggleClass('open').hasClass('open'); $(this).attr('aria-expanded', String(open)); });
  $('#admin-logout').on('click', async function () {
    if (!mayLeave() || saving) return;
    try { await api.post('auth/logout'); clearDraft(); location.replace(new URL('login.html', document.baseURI).href); }
    catch (error) { failure = error; showFeedback(); }
  });
  document.addEventListener('click', function (event) {
    const anchor = event.target.closest('a');
    if (anchor && anchor.getAttribute('target') !== '_blank' && !mayLeave()) event.preventDefault();
  });
  document.addEventListener('veriqra:reauthenticated', checkAuthorization);
  document.addEventListener('veriqra:localechange', render);
  checkAuthorization();
})(jQuery, window.VeriqraApi);
