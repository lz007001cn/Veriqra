(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  const pageName = $('body').data('admin-page');
  const content = $('#admin-content');
  const feedbackBox = $('#admin-feedback');
  const state = { page: 1, pageSize: 25, generation: 0 };
  let renderFocus = null;
  let authorizationGeneration = 0;
  let modalSequence = 0;
  const pages = ['users'];
  let authorized = false;
  let forbidden = false;
  const fmt = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || ''))
    ? window.I18n.formatDateTime(value) : (value == null || value === '' ? '—' : String(value));
  const display = value => window.I18n.enumLabel(value);
  const status = value => $('<span class="status-badge">').attr({ 'data-status': value, 'data-vq-tone': value === 'ACTIVE' ? 'success' : 'neutral' }).text(display(value));
  const action = (label, callback, style) => $('<button type="button" class="btn btn-sm">')
    .addClass(style || 'btn-outline-primary').text(label).on('click', callback);
  const cell = value => $('<td>').text(fmt(value));
  function feedback(message, error, retry) {
    feedbackBox.text(message || '').toggleClass('d-none', !message)
      .toggleClass('alert-danger', !!error).toggleClass('alert-success', !!message && !error)
      .attr('role', error ? 'alert' : 'status');
    if (retry) feedbackBox.append(action(t('common.retry', null, 'Retry'), retry).addClass('ms-2'));
  }
  function errorMessage(error) { return window.I18n.error(error); }
  function captureFocus(scope) {
    const current = document.activeElement;
    if (!current || !scope[0]?.contains(current)) return null;
    const key = current.getAttribute('data-admin-focus');
    return key ? { key, start: current.selectionStart, end: current.selectionEnd } : null;
  }
  function restoreFocus(scope, saved) {
    if (!saved) return;
    if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
    if (!scope.length) return;
    let control = scope.find('[data-admin-focus="' + saved.key + '"]')[0];
    if (control?.disabled && saved.key.startsWith('page-')) {
      control = scope.find('[data-admin-focus="page-' + (saved.key === 'page-next' ? 'previous' : 'next') + '"]')[0];
    }
    if (!control || control.disabled) control = scope.find('[data-admin-focus="retry"]')[0];
    if (!control || control.disabled) control = scope.attr('tabindex', '-1')[0];
    control?.focus();
    if (control?.setSelectionRange && saved.start != null) {
      try { control.setSelectionRange(saved.start, saved.end); } catch (ignored) { /* Non-text inputs do not support selection. */ }
    }
  }
  function loadFailure(error, retry) {
    return $('<div class="empty-state">').append(
      $('<p role="alert">').text(errorMessage(error)),
      action(t('common.retry', null, 'Retry'), retry).attr('data-admin-focus', 'retry'));
  }
  function showForbidden() {
    content.empty().append($('<p class="alert alert-danger">').text(t('admin.forbiddenPlatformAdministratorAccessIsRequired', null,
      'Forbidden: platform administrator access is required.')));
  }
  async function load(path) {
    const token = state.generation;
    const result = await api.get('admin/' + path);
    if (token !== state.generation) throw { message: 'Superseded request' };
    return result;
  }
  async function post(path, body) { return api.post('admin/' + path, body); }
  function table(headers, rows, cells, columnTypes = []) {
    if (!rows.length) return $('<p class="empty-state">').text(t("admin.noMatchingRecords", null, 'No matching records.'));
    const table = $('<table class="admin-table">');
    const head = $('<tr>'); headers.forEach((h, index) => head.append($('<th scope="col">').attr('data-vq-type', columnTypes[index] || null).text(h)));
    table.append($('<thead>').append(head));
    const body = $('<tbody>');
    rows.forEach(row => {
      const tr = $('<tr>');
      cells(row).forEach((value, index) => tr.append((value && value.jquery ? $('<td>').append(value) : cell(value))
        .attr('data-vq-type', columnTypes[index] || null)));
      body.append(tr);
    });
    return $('<div class="admin-table-wrap">').append(table.append(body));
  }
  function paging(result, rerender, pageState = state) {
    const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
    return $('<div class="admin-pagination">').append(
      $('<span>').text(t('admin.pageCount', { page: window.I18n.formatNumber(result.page),
        totalPages: window.I18n.formatNumber(totalPages), total: window.I18n.formatNumber(result.total) },
      'Page {page} of {totalPages} · {total} record(s)')),
      $('<div class="d-flex gap-2">').append(
        action(t("common.previous", null, 'Previous'), () => { pageState.page--; rerender(); }).attr('data-admin-focus', 'page-previous').prop('disabled', pageState.page <= 1),
        action(t("common.next", null, 'Next'), () => { pageState.page++; rerender(); }).attr('data-admin-focus', 'page-next').prop('disabled', pageState.page >= totalPages)));
  }
  function query() {
    return '?' + new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  }
  function modal(title, fields, submitLabel, submit, opener = document.activeElement) {
    const titleId = 'admin-modal-title-' + ++modalSequence;
    const root = $('<div class="modal fade" tabindex="-1" aria-hidden="true">').attr('aria-labelledby', titleId);
    const box = $('<div class="modal-dialog modal-dialog-scrollable">');
    const form = $('<form class="modal-content" novalidate>');
    const header = $('<div class="modal-header">').append($('<h2 class="modal-title">').attr('id', titleId).text(title),
      $('<button type="button" class="btn-close" data-bs-dismiss="modal">').attr('aria-label', t('common.close')));
    const body = $('<div class="modal-body">');
    fields.forEach(field => {
      const wrap = $('<div class="mb-3">');
      const id = 'admin-field-' + field.name;
      wrap.append($('<label class="form-label">').attr('for', id).text(field.label));
      let input;
      if (field.options) {
        input = $('<select class="form-select">');
        field.options.forEach(option => input.append($('<option>').val(option).text(display(option))));
      } else if (field.type === 'textarea') input = $('<textarea class="form-control" rows="3">');
      else input = $('<input class="form-control">').attr('type', field.type || 'text');
      const initialValue = field.value == null ? (field.options?.[0] || '') : field.value;
      input.attr({ id: id, name: field.name }).val(initialValue);
      if (field.required) input.prop('required', true);
      if (field.readonly) input.prop('readOnly', true);
      if (field.min != null) input.attr('min', field.min);
      wrap.append(input); body.append(wrap);
    });
    const error = $('<div class="alert alert-danger d-none" role="alert" aria-live="assertive">');
    body.append(error);
    const send = $('<button type="submit" class="btn btn-primary">').text(submitLabel);
    const footer = $('<div class="modal-footer">').append($('<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">').text(t("common.cancel", null, 'Cancel')), send);
    form.append(header, body, footer); root.append(box.append(form)); $('body').append(root);
    const instance = new bootstrap.Modal(root[0]);
    let shown = false;
    root.on('shown.bs.modal', () => {
      shown = true;
      const first = form.find('[name]').filter(function () { return !this.disabled && !this.readOnly; })[0];
      (first || send[0]).focus();
    });
    root.on('hidden.bs.modal', () => {
      instance.dispose(); root.remove();
      const destination = opener?.isConnected && !opener.disabled ? opener : content.attr('tabindex', '-1')[0];
      destination?.focus();
    });
    form.on('submit', async event => {
      event.preventDefault(); if (send.prop('disabled')) return;
      if (!form[0].checkValidity()) {
        const invalid = form.find(':invalid')[0];
        error.removeClass('d-none').text(t('admin.completeRequiredFields', null, 'Complete the required fields.'));
        if (invalid) invalid.focus();
        return;
      }
      const values = {}; form.find('[name]').each(function () { values[this.name] = this.value; });
      send.prop('disabled', true); error.addClass('d-none').text('');
      let accepted = false;
      try { const result = await submit(values); if (result === false) return;
        accepted = true;
        if (shown) instance.hide(); else root.one('shown.bs.modal', () => instance.hide());
        if (result !== null) await refreshSavedChange(); }
      catch (failure) { error.removeClass('d-none').text(errorMessage(failure)); }
      finally { if (!accepted) send.prop('disabled', false); }
    });
    instance.show();
  }
  async function renderUsers() {
    const result = await load('users' + query());
    const top = $('<div class="d-flex justify-content-end mb-3">')
      .append(action(t("admin.createUser", null, 'Create user'), () => modal(t("admin.createUser", null, 'Create user'), [
          { name: 'username', label: t("common.username", null, 'Username'), required: true },
          { name: 'displayName', label: t("admin.displayName", null, 'Display name'), required: true },
          { name: 'password', label: t("admin.temporaryPassword12Characters", null, 'Temporary password (12+ characters)'), type: 'password', required: true },
          { name: 'systemRole', label: t("admin.systemRole", null, 'System role'), options: ['USER', 'ADMIN'] },
          { name: 'status', label: t("common.status", null, 'Status'), options: ['ACTIVE', 'DISABLED'] }
        ], t("admin.createUser", null, 'Create user'), values => post('users', values)), 'btn-primary'));
    content.empty().append(top, table([
      t('common.username', null, 'Username'), t('admin.displayName', null, 'Display name'),
      t('admin.role', null, 'Role'), t('common.status', null, 'Status'),
      t('common.created', null, 'Created'), t('common.actions', null, 'Actions')
    ], result.items, user => [user.username, user.displayName, display(user.systemRole), status(user.status), fmt(user.createdAt),
      $('<div class="actions">').append(
        action(t("common.edit", null, 'Edit'), () => modal(t('admin.editUser', { username: user.username }, 'Edit {username}'), [
          { name: 'displayName', label: t("admin.displayName", null, 'Display name'), value: user.displayName, required: true },
          { name: 'systemRole', label: t("admin.systemRole", null, 'System role'), options: ['USER', 'ADMIN'], value: user.systemRole },
          { name: 'status', label: t("common.status", null, 'Status'), options: ['ACTIVE', 'DISABLED'], value: user.status }
        ], t("common.save", null, 'Save'), values => api.action('PATCH', 'admin/users/' + user.id, { ...values, lockVersion: user.lockVersion }))),
        action(t("admin.resetPassword", null, 'Reset password'), () => modal(t('admin.resetPasswordFor', { username: user.username }, 'Reset password for {username}'),
          [{ name: 'password', label: t("admin.newPassword12Characters", null, 'New password (12+ characters)'), type: 'password', required: true }],
          t("admin.resetPassword", null, 'Reset password'), values => post('users/' + user.id + '/reset-password', values)), 'btn-outline-danger'))
    ], [null, null, null, 'status', 'timestamp', 'actions']), paging(result, render));
  }
  async function render() {
    const token = ++state.generation;
    renderFocus = captureFocus(content) || renderFocus;
    content.attr('aria-busy', 'true').empty().append($('<p role="status">').text(t('common.loading', null, 'Loading…'))); feedback('');
    try {
      await renderUsers();
      return token === state.generation ? true : null;
    } catch (error) {
      if (token !== state.generation) return null;
      content.empty().append(loadFailure(error, render));
      return false;
    } finally {
      if (token === state.generation) {
        content.attr('aria-busy', 'false');
        restoreFocus(content, renderFocus); renderFocus = null;
      }
    }
  }
  async function refreshSavedChange() {
    const refreshed = await render();
    if (refreshed === null) return;
    if (refreshed) feedback(t('admin.changeSaved', null, 'Change saved.'));
    else feedback(t('admin.changeSavedRefreshFailed', null,
      'Change saved, but the page could not be refreshed. Retry loading to see the latest data.'), true, refreshSavedChange);
  }
  async function checkAuthorization() {
    const token = ++authorizationGeneration;
    const savedFocus = captureFocus(content);
    content.attr('aria-busy', 'true').empty();
    feedback('');
    try {
      await window.I18n.init();
      if (token !== authorizationGeneration) return;
      content.append($('<p role="status">').text(t('admin.checkingAdministratorAccess', null,
        'Checking administrator access…')));
      const user = await api.get('auth/me');
      if (token !== authorizationGeneration) return;
      $('#admin-user').text(user.username);
      if (user.systemRole !== 'ADMIN') { forbidden = true; showForbidden(); return; }
      authorized = true;
      renderFocus = savedFocus || renderFocus;
      await render();
    } catch (error) {
      if (token !== authorizationGeneration) return;
      content.empty().append(loadFailure(error, checkAuthorization));
      restoreFocus(content, savedFocus);
    } finally {
      if (token === authorizationGeneration) content.attr('aria-busy', 'false');
    }
  }
  $('#admin-menu').on('click', function () {
    const opened = $('#admin-sidebar').toggleClass('open').hasClass('open'); $(this).attr('aria-expanded', String(opened));
  });
  $('#admin-logout').on('click', async function () {
    try { await api.post('auth/logout'); location.replace(new URL('login.html', document.baseURI).href); }
    catch (error) { feedback(errorMessage(error), true); }
  });
  if (!pages.includes(pageName)) { content.text(t("admin.unknownAdministrationPage", null, 'Unknown administration page.')); return; }
  $('[data-admin-nav="' + pageName + '"]').addClass('active').attr('aria-current', 'page');
  checkAuthorization();
  document.addEventListener('veriqra:localechange', function () {
    document.querySelectorAll('.modal.show').forEach(function (element) { bootstrap.Modal.getInstance(element)?.hide(); });
    if (authorized) render(); else if (forbidden) showForbidden();
  });
})(jQuery, window.VeriqraApi);
