(function ($, api) {
  'use strict';
  const content = $('#admin-content'), feedback = $('#admin-feedback');
  const disclosures = new Map();
  let authorized = false, identity = null, authorization = 0, request = 0;
  let snapshot = null, loading = false, failure = null, accessFailure = null;
  const t = (key, args, fallback) => window.I18n.t(key, args, fallback);
  const message = (key, fallback, args) => t('adminSystem.' + key, args || null, fallback);
  const text = (tag, value, style) => $('<' + tag + '>').addClass(style || '').text(value == null || value === '' ? '—' : String(value));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const number = value => numeric(value) ? window.I18n.formatNumber(value) : '—';
  const time = value => value && Number.isFinite(Date.parse(value)) ? window.I18n.formatDateTime(value) : '—';
  function button(id, label, callback, style) {
    return $('<button type="button">').attr('id', id).addClass('btn ' + (style || 'btn-outline-primary')).text(label).on('click', callback);
  }
  function errorText(error) { return error?.messageKey ? t(error.messageKey, null, error.messageFallback) : window.I18n.error(error); }
  function bool(value) { return typeof value === 'boolean' ? value ? message('yes', 'Yes') : message('no', 'No') : '—'; }
  function status(value) {
    if (value === 'UP' || value === 'OK') return message('statusUp', 'Available');
    if (value === 'DOWN' || value === 'UNAVAILABLE') return message('statusUnavailable', 'Unavailable');
    return message('statusUnknown', 'Unknown');
  }
  function statusBadge(value, id) {
    return text('span', status(value), 'admin-system-status').attr({ id, 'data-state': ['UP', 'OK'].includes(value) ? 'ok' : ['DOWN', 'UNAVAILABLE'].includes(value) ? 'error' : 'unknown' });
  }
  function bytes(value) {
    if (!numeric(value)) return '—';
    const scale = value >= 1024 ** 3 ? 1024 ** 3 : value >= 1024 ** 2 ? 1024 ** 2 : value >= 1024 ? 1024 : 1;
    return number(Math.round(value / scale * 10) / 10) + ' ' + ({ 1: 'B', 1024: 'KiB', 1048576: 'MiB', 1073741824: 'GiB' })[scale];
  }
  function uptime(value) {
    if (!numeric(value)) return '—';
    const seconds = Math.floor(value), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    if (days) return message('uptimeDays', '{days}d {hours}h', { days: number(days), hours: number(hours % 24) });
    if (hours) return message('uptimeHours', '{hours}h {minutes}m', { hours: number(hours), minutes: number(minutes % 60) });
    if (minutes) return message('uptimeMinutes', '{minutes}m {seconds}s', { minutes: number(minutes), seconds: number(seconds % 60) });
    return message('uptimeSeconds', '{seconds}s', { seconds: number(seconds) });
  }
  function source(value) {
    const keys = { ENVIRONMENT: ['sourceEnvironment', 'Environment variables'], JVM_PROPERTY: ['sourceJvm', 'JVM property'], EXTERNAL_FILE: ['sourceExternal', 'External configuration'], DEFAULTS: ['sourceDefaults', 'Defaults'],
      configuration: ['sourceServer', 'Server configuration'], 'local-settings': ['sourceAdmin', 'Admin selection'] };
    return keys[value] ? message(...keys[value]) : '—';
  }
  function facts(rows) {
    const list = $('<dl class="admin-system-facts">');
    rows.forEach(([label, value, id]) => list.append($('<div>').append(text('dt', label),
      typeof value === 'object' && value?.jquery ? $('<dd>').append(value) : text('dd', value).attr(id ? { id } : {}))));
    return list;
  }
  function disclosure(id, title, body) {
    return $('<details class="admin-system-card admin-system-details">').attr('id', id).prop('open', disclosures.get(id) === true)
      .append(text('summary', title).attr('id', id + '-summary'), $('<div class="admin-system-details-body">').append(body))
      .on('toggle', function () { if (this.isConnected) disclosures.set(id, this.open); });
  }
  function showAccess() {
    feedback.empty().addClass('d-none'); content.empty().attr('aria-busy', 'false');
    if (!accessFailure) content.append(text('p', t('admin.checkingAdministratorAccess', null, 'Checking administrator access…')).attr('role', 'status'));
    else {
      content.append(text('p', errorText(accessFailure), 'alert alert-danger').attr('role', 'alert'));
      if (accessFailure.status !== 403) content.append(button('system-access-retry', t('common.retry', null, 'Retry'), checkAuthorization));
    }
  }
  function stopForAccess(error) {
    if (error?.status !== 401 && error?.status !== 403) return false;
    authorized = false; authorization++; request++; loading = false; snapshot = null;
    accessFailure = error; showAccess(); return true;
  }
  function overview(data) {
    const card = $('<section class="admin-system-card">').attr({ id: 'system-overview', 'aria-labelledby': 'system-overview-title' });
    const heading = $('<div class="admin-system-heading">').append($('<div>').append(text('h2', message('release', 'Current build')).attr('id', 'system-overview-title'),
      text('p', data.veriqraVersion, 'admin-system-version').attr('id', 'system-version')),
      $('<div class="admin-system-refresh">').append(button('system-refresh', loading ? message('refreshing', 'Refreshing…') : message('refresh', 'Refresh information'), refresh).prop('disabled', loading),
        text('p', message('readAt', 'Read at: {time}', { time: time(data.serverTime) })).attr('id', 'system-read-at')));
    const metrics = $('<dl class="admin-system-metrics">');
    [[message('applicationStatus', 'Application'), statusBadge(data.applicationStatus, 'system-application-status')],
      [message('databaseStatus', 'Database'), statusBadge(data.databaseStatus, 'system-database-status')],
      [message('uptime', 'Process uptime'), text('span', uptime(data.uptimeSeconds)).attr('id', 'system-uptime')]]
      .forEach(([label, value]) => metrics.append($('<div class="admin-system-metric">').append(text('dt', label), $('<dd>').append(value))));
    const commit = text('span', data.buildCommit, 'admin-system-commit').attr('id', 'system-commit');
    card.append(heading, metrics, facts([[message('buildCommit', 'Build base commit'), commit], [message('buildTime', 'Build time'), time(data.buildTime), 'system-build-time'],
      [message('databaseVersion', 'Database version'), data.databaseVersion], [message('tableCount', 'Database tables'), number(data.databaseTableCount)]]));
    return card;
  }
  function runtime(data) {
    const value = data.runtime || {};
    return disclosure('system-runtime', message('runtime', 'Runtime environment'), facts([
      [message('javaVersion', 'Java version'), data.javaVersion], [message('javaVendor', 'Java vendor'), value.javaVendor],
      [message('tomcatVersion', 'Servlet container'), data.tomcatVersion], [message('osName', 'Operating system'), value.osName],
      [message('osVersion', 'OS version'), value.osVersion], [message('osArch', 'Architecture'), value.osArch],
      [message('processors', 'Available processors'), number(value.availableProcessors)], [message('encoding', 'File encoding'), value.fileEncoding],
      [message('jvmTimeZone', 'JVM time zone'), value.jvmTimeZone], [message('applicationTimeZone', 'Application time zone'), data.applicationTimeZone],
      [message('heapUsed', 'JVM heap used'), bytes(value.heapUsedBytes)], [message('heapCommitted', 'JVM heap committed'), bytes(value.heapCommittedBytes)],
      [message('heapMax', 'JVM heap maximum'), bytes(value.heapMaxBytes)]]));
  }
  function configuration(data) {
    const value = data.configuration || {}, database = value.database || {};
    return disclosure('system-configuration', message('parameters', 'Application parameters'), $('<div>').append(facts([
      [message('contextPath', 'Application context'), value.contextPath === '' ? '/' : value.contextPath],
      [message('sessionTimeout', 'Session timeout (minutes)'), number(value.sessionTimeoutMinutes)],
      [message('secureCookie', 'HTTPS-only session cookie'), bool(value.sessionCookieSecure)],
      [message('publicOrigin', 'Public origin configured'), bool(value.publicOriginConfigured)]]),
      text('h3', message('connectionPool', 'Database connection pool'), 'admin-system-section-label'), facts([
        [message('initialPool', 'Initial connections'), number(database.initialPoolSize)], [message('maxPool', 'Maximum connections'), number(database.maxPoolSize)],
        [message('acquireTimeout', 'Connection wait timeout (ms)'), number(database.acquireTimeoutMillis)], [message('configSource', 'Configuration source'), source(database.source)]])));
  }
  function ai(data) {
    const value = data.ai || {};
    return disclosure('system-ai', message('ai', 'AI connection configuration'), $('<div>').append(facts([
      [message('provider', 'Provider'), value.provider], [message('configured', 'Connection configured'), bool(value.configured)],
      [message('project', 'Google Cloud project'), value.project], [message('location', 'Location'), value.location],
      [message('model', 'Effective model'), value.model, 'system-ai-model'], [message('modelWritable', 'Model selection can be saved'), bool(value.settingsWritable)],
      [message('modelSource', 'Model source'), source(value.settingsSource)]]),
      $('<div class="admin-system-links">').append($('<a class="btn btn-outline-primary" href="admin/ai.html">').text(message('openAi', 'Open AI settings')))));
  }
  function render() {
    if (!authorized) { showAccess(); return; }
    const focus = document.activeElement?.id;
    feedback.empty().toggleClass('d-none', !failure).toggleClass('alert-danger', !!failure).attr('role', failure ? 'alert' : 'status');
    if (failure) {
      feedback.append(text('p', errorText(failure), 'mb-1'));
      if (snapshot) feedback.append(text('p', message('previousSnapshot', 'Refresh failed. The information below is the previously retrieved snapshot.'), 'mb-0'));
    }
    content.empty().attr('aria-busy', String(loading));
    if (snapshot) content.append($('<div class="admin-system-layout">').append(overview(snapshot), runtime(snapshot), configuration(snapshot), ai(snapshot)));
    else {
      content.append(text('p', loading ? t('common.loading', null, 'Loading…') : message('unavailable', 'System information could not be loaded.')).attr('role', 'status'));
      if (!loading) content.append(button('system-retry', t('common.retry', null, 'Retry'), refresh));
    }
    if (focus && document.activeElement === document.body) { const target = document.getElementById(focus); if (target && !target.disabled) target.focus(); }
  }
  async function refresh() {
    if (!authorized || loading) return;
    const token = ++request, auth = authorization;
    loading = true; failure = null; render();
    try {
      const value = await api.get('admin/system');
      if (!authorized || token !== request || auth !== authorization) return;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw { messageKey: 'adminSystem.unavailable', messageFallback: 'System information could not be loaded.' };
      snapshot = value;
    } catch (error) {
      if (token !== request || auth !== authorization) return;
      if (!stopForAccess(error)) failure = error;
    } finally { if (token === request && auth === authorization) { loading = false; render(); } }
  }
  async function checkAuthorization() {
    const token = ++authorization; request++; authorized = false; loading = false; snapshot = null; failure = null; accessFailure = null; showAccess();
    try {
      await window.I18n.init(); if (token !== authorization) return;
      const user = await api.get('auth/me'); if (token !== authorization) return;
      if (identity != null && String(identity) !== String(user.id)) disclosures.clear();
      identity = user.id; $('#admin-user').text(user.username);
      if (user.systemRole !== 'ADMIN' || user.status !== 'ACTIVE') {
        accessFailure = { status: 403, messageKey: 'admin.forbiddenPlatformAdministratorAccessIsRequired', messageFallback: 'Forbidden: platform administrator access is required.' }; showAccess(); return;
      }
      authorized = true;
      if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('veriqra:identity', { detail: { user } }));
      await refresh();
    } catch (error) { if (token === authorization) { accessFailure = error; showAccess(); } }
  }
  $('#admin-menu').on('click', function () { const open = $('#admin-sidebar').toggleClass('open').hasClass('open'); $(this).attr('aria-expanded', String(open)); });
  $('#admin-logout').on('click', async function () {
    if (window.VeriqraDraftGuard && !window.VeriqraDraftGuard.allowLeave()) return;
    $(this).prop('disabled', true);
    try { await api.post('auth/logout'); location.replace(new URL('login.html', document.baseURI).href); }
    catch (error) { if (!stopForAccess(error)) { failure = error; render(); } }
    finally { $(this).prop('disabled', false); }
  });
  document.addEventListener('veriqra:reauthenticated', checkAuthorization);
  document.addEventListener('veriqra:localechange', render);
  checkAuthorization();
})(jQuery, window.VeriqraApi);
