(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  const pageName = $('body').data('admin-page');
  const content = $('#admin-content');
  const feedbackBox = $('#admin-feedback');
  const state = { page: 1, pageSize: 25, search: '', systemRole: '', status: '', sort: 'id', order: 'desc', generation: 0 };
  let renderFocus = null;
  let authorizationGeneration = 0;
  let modalSequence = 0;
  let userTable = null;
  let userRequest = 0;
  const pages = ['users'];
  let authorized = false;
  let forbidden = false;
  const fmt = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || ''))
    ? window.I18n.formatDateTime(value) : (value == null || value === '' ? '—' : String(value));
  const display = value => window.I18n.enumLabel(value);
  const action = (label, callback, style) => $('<button type="button" class="btn btn-sm">')
    .addClass(style || 'btn-outline-primary').text(label).on('click', callback);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
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
  async function post(path, body) { return api.post('admin/' + path, body); }
  function destroyTable() {
    userRequest++;
    if (userTable) userTable.bootstrapTable('destroy');
    userTable = null;
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
      ['minlength', 'maxlength', 'pattern'].forEach(name => { if (field[name] != null) input.attr(name, field[name]); });
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
  function createUser() {
    modal(t('admin.createUser', null, 'Create user'), [
      { name: 'username', label: t('common.username', null, 'Username'), required: true, minlength: 3, maxlength: 64, pattern: '[A-Za-z0-9._-]{3,64}' },
      { name: 'displayName', label: t('admin.displayName', null, 'Display name'), required: true, maxlength: 80 },
      { name: 'password', label: t('admin.temporaryPassword12Characters', null, 'Temporary password (12+ characters)'), type: 'password', required: true, minlength: 12, maxlength: 1024 },
      { name: 'systemRole', label: t('admin.systemRole', null, 'System role'), options: ['USER', 'ADMIN'] },
      { name: 'status', label: t('common.status', null, 'Status'), options: ['ACTIVE', 'DISABLED'] }
    ], t('admin.createUser', null, 'Create user'), values => post('users', values));
  }
  function editUser(user, opener) {
    modal(t('admin.editUser', { username: user.username }, 'Edit {username}'), [
      { name: 'displayName', label: t('admin.displayName', null, 'Display name'), value: user.displayName, required: true, maxlength: 80 },
      { name: 'systemRole', label: t('admin.systemRole', null, 'System role'), options: ['USER', 'ADMIN'], value: user.systemRole },
      { name: 'status', label: t('common.status', null, 'Status'), options: ['ACTIVE', 'DISABLED'], value: user.status }
    ], t('common.save', null, 'Save'), values => api.action('PATCH', 'admin/users/' + user.id, { ...values, lockVersion: user.lockVersion }), opener);
  }
  function resetPassword(user, opener) {
    modal(t('admin.resetPasswordFor', { username: user.username }, 'Reset password for {username}'), [
      { name: 'password', label: t('admin.newPassword12Characters', null, 'New password (12+ characters)'), type: 'password', required: true, minlength: 12, maxlength: 1024 }
    ], t('admin.resetPassword', null, 'Reset password'), values => post('users/' + user.id + '/reset-password', values), opener);
  }
  function renderUsers() {
    const filters = $('<form class="admin-user-filters">');
    const search = $('<input id="admin-user-search" type="search" class="form-control" maxlength="160">')
      .attr('data-admin-focus', 'user-search').val(state.search);
    const role = $('<select id="admin-user-role" class="form-select">').attr('data-admin-focus', 'user-role')
      .append($('<option>').val('').text(t('admin.allRoles', null, 'All roles')));
    ['USER', 'ADMIN'].forEach(value => role.append($('<option>').val(value).text(display(value)))); role.val(state.systemRole);
    const status = $('<select id="admin-user-status" class="form-select">').attr('data-admin-focus', 'user-status')
      .append($('<option>').val('').text(t('admin.allStatuses', null, 'All statuses')));
    ['ACTIVE', 'DISABLED'].forEach(value => status.append($('<option>').val(value).text(display(value)))); status.val(state.status);
    function field(id, label, input, style) {
      return $('<div>').addClass(style || '').append($('<label class="form-label">').attr('for', id).text(label), input);
    }
    const apply = () => {
      state.search = search.val().trim(); state.systemRole = role.val(); state.status = status.val(); state.page = 1; render();
    };
    filters.on('submit', event => { event.preventDefault(); apply(); });
    role.on('change', apply); status.on('change', apply);
    filters.append(field('admin-user-search', t('admin.searchUsers', null, 'Search username or display name'), search, 'admin-user-search'),
      field('admin-user-role', t('admin.role', null, 'Role'), role), field('admin-user-status', t('common.status', null, 'Status'), status),
      $('<button type="submit" class="btn btn-outline-primary">').text(t('admin.search', null, 'Search')),
      action(t('admin.createUser', null, 'Create user'), createUser, 'btn-primary').addClass('admin-user-create'));
    const errors = $('<div id="admin-table-error" class="d-none" role="alert">');
    const table = $('<table id="admin-user-table" class="admin-table">').attr('aria-label', t('common.users', null, 'Users'));
    content.empty().append(filters, errors, table);
    userTable = table;
    let settle;
    const loaded = new Promise(resolve => { settle = resolve; });
    const generation = state.generation;
    table.bootstrapTable({
      locale: window.I18n.getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US',
      classes: 'table table-hover admin-table', escape: true, uniqueId: 'id',
      sidePagination: 'server', pagination: true, pageNumber: state.page, pageSize: state.pageSize,
      pageList: [10, 25, 50, 100], sortName: state.sort, sortOrder: state.order,
      search: false, showButtonIcons: false,
      formatNoMatches: () => t('admin.noMatchingRecords', null, 'No matching records.'),
      formatLoadingMessage: () => t('common.loading', null, 'Loading…'),
      formatShowingRows: (from, to, total) => t('admin.usersResultCount', { from: window.I18n.formatNumber(from), to: window.I18n.formatNumber(to), total: window.I18n.formatNumber(total) }, 'Showing {from}–{to} of {total} users'),
      formatRecordsPerPage: count => t('admin.recordsPerPage', { count: count }, '{count} per page'),
      queryParams: params => {
        state.pageSize = Number(params.limit) || state.pageSize;
        state.page = Math.floor((Number(params.offset) || 0) / state.pageSize) + 1;
        state.sort = params.sort || 'id'; state.order = params.order || 'desc';
        return { page: state.page, pageSize: state.pageSize, search: state.search, systemRole: state.systemRole,
          status: state.status, sort: state.sort, order: state.order };
      },
      ajax: async request => {
        const token = ++userRequest;
        content.attr('aria-busy', 'true'); errors.empty().addClass('d-none');
        try {
          const result = await api.get('admin/users?' + new URLSearchParams(request.data));
          if (generation !== state.generation || token !== userRequest) { settle(null); return; }
          request.success({ total: result.total, rows: result.items });
          settle(true);
        } catch (error) {
          if (generation !== state.generation || token !== userRequest) { settle(null); return; }
          request.error(error);
          errors.removeClass('d-none').append(loadFailure(error, render));
          settle(false);
        } finally {
          if (generation === state.generation && token === userRequest) content.attr('aria-busy', 'false');
        }
      },
      columns: [
        { field: 'username', title: t('common.username', null, 'Username'), sortable: true },
        { field: 'displayName', title: t('admin.displayName', null, 'Display name'), sortable: true },
        { field: 'systemRole', title: t('admin.role', null, 'Role'), sortable: true, formatter: value => escape(display(value)) },
        { field: 'status', title: t('common.status', null, 'Status'), sortable: true, formatter: value => escape(display(value)) },
        { field: 'createdAt', title: t('common.created', null, 'Created'), sortable: true, class: 'admin-user-timestamp', formatter: value => escape(fmt(value)) },
        { field: 'actions', title: t('common.actions', null, 'Actions'), escape: false,
          formatter: () => '<div class="actions"><button type="button" class="btn btn-sm btn-outline-primary admin-user-edit">' + escape(t('common.edit', null, 'Edit')) + '</button><button type="button" class="btn btn-sm btn-outline-danger admin-user-reset">' + escape(t('admin.resetPassword', null, 'Reset password')) + '</button></div>',
          events: {
            'click .admin-user-edit': (event, value, row) => editUser(row, event.currentTarget),
            'click .admin-user-reset': (event, value, row) => resetPassword(row, event.currentTarget)
          } }
      ]
    });
    return loaded;
  }
  async function render() {
    const token = ++state.generation;
    renderFocus = captureFocus(content) || renderFocus;
    destroyTable();
    content.attr('aria-busy', 'true').empty().append($('<p role="status">').text(t('common.loading', null, 'Loading…'))); feedback('');
    try {
      const loaded = await renderUsers();
      return token === state.generation ? loaded : null;
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
    authorized = false; forbidden = false;
    state.generation++; destroyTable();
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
      if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('veriqra:identity', { detail: { user: user } }));
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
  document.addEventListener('veriqra:reauthenticated', function () { checkAuthorization(); });
  document.addEventListener('veriqra:localechange', function () {
    document.querySelectorAll('.modal.show').forEach(function (element) { bootstrap.Modal.getInstance(element)?.hide(); });
    if (authorized) render(); else if (forbidden) showForbidden();
  });
})(jQuery, window.VeriqraApi);
