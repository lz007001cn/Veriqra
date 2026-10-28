(function ($, api) {
  'use strict';
  const root = $('#project-settings-workspace');
  const t = function (key, fallback) { return window.I18n.t('projectSettings.' + key, null, fallback); };
  let projectId = null, projectStatus = null, view = 'dashboard', actor = null;
  let members = [], managers = [], loading = false, loaded = false, busy = false, generation = 0;
  const active = function () { return view === 'project-settings' && !!projectId; };
  const same = function (left, right) { return String(left) === String(right); };
  const activeMember = function (row) { return row.status === 'ACTIVE' && row.userStatus === 'ACTIVE'; };
  const isAdmin = function () { return actor && actor.systemRole === 'ADMIN' && actor.status === 'ACTIVE'; };
  const canInvite = function () {
    return loaded && projectStatus === 'ACTIVE' && actor && actor.status === 'ACTIVE' && (isAdmin() || members.some(function (row) {
      return same(row.userId, actor.id) && activeMember(row) && managers.some(function (manager) {
        return same(manager.userId, actor.id) && manager.status === 'ACTIVE';
      });
    }));
  };
  const canAppoint = function () { return loaded && projectStatus === 'ACTIVE' && isAdmin(); };
  const base = function () { return 'projects/' + encodeURIComponent(projectId) + '/'; };
  function name(row) { return row.displayName && row.username ? row.displayName + ' (@' + row.username + ')' : row.displayName || row.username; }
  function role(value) { return t('role.' + value.toLowerCase(), { TESTER: 'Tester', DEVELOPER: 'Developer' }[value] || value); }
  function notice(message, error) { $('#project-settings-notice').text(message || '').toggleClass('d-none', !message).toggleClass('alert-danger', !!error).toggleClass('alert-success', !!message && !error); }
  function clearDrafts() { $('#project-settings-username').val(''); $('#project-settings-role').val('TESTER'); $('#project-settings-manager').val(''); }
  function dirty() { return busy || !!$('#project-settings-username').val() || $('#project-settings-role').val() !== 'TESTER' || !!$('#project-settings-manager').val(); }
  root.append($('<div id="project-settings-notice" class="alert d-none" role="status" aria-live="polite">'),
    $('<p id="project-settings-status" class="text-secondary" role="status">'),
    $('<button id="project-settings-retry" type="button" class="btn btn-outline-primary mb-3 d-none">').on('click', load),
    $('<section class="asset-panel">').append($('<h2 id="project-settings-members-heading" class="fs-5">'),
      $('<div id="project-settings-members">'),
      $('<form id="project-settings-member-form" class="mt-3 d-none">').append(
        $('<div class="row g-3 mb-3">').append(
          $('<div class="col-md-6">').append($('<label id="project-settings-username-label" for="project-settings-username" class="form-label">'), $('<input id="project-settings-username" class="form-control" maxlength="64" required>')),
          $('<div class="col-md-4">').append($('<label id="project-settings-role-label" for="project-settings-role" class="form-label">'), $('<select id="project-settings-role" class="form-select">'))),
        $('<button id="project-settings-add" type="submit" class="btn btn-primary">'))),
    $('<section class="asset-panel">').append($('<h2 id="project-settings-managers-heading" class="fs-5">'),
      $('<p id="project-settings-manager-help" class="text-secondary small">'), $('<div id="project-settings-managers">'),
      $('<form id="project-settings-manager-form" class="mt-3 d-none">').append(
        $('<label id="project-settings-manager-label" for="project-settings-manager" class="form-label">'),
        $('<select id="project-settings-manager" class="form-select mb-3" required>'),
        $('<button id="project-settings-appoint" type="submit" class="btn btn-primary">'))));
  function labels() {
    $('#project-settings-members-heading').text(t('members', 'Project members'));
    $('#project-settings-managers-heading').text(t('managers', 'Project managers'));
    $('#project-settings-manager-help').text(t('managerHelp', 'An administrator can appoint an active project member as manager.'));
    $('#project-settings-username-label').text(t('username', 'Existing username'));
    $('#project-settings-role-label').text(t('projectRole', 'Project role'));
    $('#project-settings-manager-label').text(t('chooseMember', 'Choose a project member'));
    $('#project-settings-add').text(t('addMember', 'Add member'));
    $('#project-settings-appoint').text(t('appoint', 'Appoint manager'));
    $('#project-settings-retry').text(window.I18n.t('common.retry', null, 'Retry'));
    const selected = $('#project-settings-role').val() || 'TESTER';
    $('#project-settings-role').empty();
    ['TESTER', 'DEVELOPER'].forEach(function (value) { $('#project-settings-role').append($('<option>').val(value).text(role(value))); });
    $('#project-settings-role').val(selected);
  }
  function controls() {
    $('#project-settings-member-form').toggleClass('d-none', !canInvite());
    $('#project-settings-manager-form').toggleClass('d-none', !canAppoint());
    root.find('input,select,button').prop('disabled', busy || loading);
    $('#project-settings-add').prop('disabled', busy || loading || !canInvite());
    $('#project-settings-appoint').prop('disabled', busy || loading || !canAppoint() || !$('#project-settings-manager').val());
    $('#project-settings-retry').prop('disabled', loading || busy);
  }
  function render() {
    labels();
    const memberBox = $('#project-settings-members').empty(), managerBox = $('#project-settings-managers').empty();
    if (loaded && !members.length) memberBox.append($('<p class="text-secondary">').text(t('noMembers', 'No project members yet.')));
    members.forEach(function (row) {
      memberBox.append($('<div class="asset-link-row">').append($('<span>').text(name(row)),
        $('<span class="badge text-bg-secondary">').text(role(row.projectRole)),
        $('<span class="small text-secondary">').text(activeMember(row) ? t('active', 'Active') : t('inactive', 'Inactive'))));
    });
    const activeManagers = managers.filter(function (row) { return row.status === 'ACTIVE'; });
    if (loaded && !activeManagers.length) managerBox.append($('<p class="text-secondary">').text(t('noManagers', 'No project manager appointed yet.')));
    activeManagers.forEach(function (manager) {
      const member = members.find(function (row) { return same(row.userId, manager.userId); });
      const row = $('<div class="asset-link-row">').append($('<span>').text(member ? name(member) : '#' + manager.userId));
      if (canAppoint()) row.append($('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('revoke', 'Remove manager role')).on('click', function () {
        if (!busy) mutate(function () { return api.delete(base() + 'managers/' + encodeURIComponent(manager.userId)); }, 'managerRemoved');
      }));
      managerBox.append(row);
    });
    const picker = $('#project-settings-manager'), selected = picker.val();
    picker.empty().append($('<option>').val('').text(t('chooseMember', 'Choose a project member')));
    members.filter(function (row) { return activeMember(row) && !activeManagers.some(function (manager) { return same(manager.userId, row.userId); }); })
      .forEach(function (row) { picker.append($('<option>').val(String(row.userId)).text(name(row))); });
    if (selected) picker.val(selected);
    controls();
  }
  async function load() {
    if (!active() || busy) return;
    const token = ++generation, project = projectId;
    loading = true; loaded = false; actor = null;
    $('#project-settings-status').text(t('loading', 'Loading project settings…'));
    $('#project-settings-retry').addClass('d-none'); controls();
    try {
      const values = await Promise.all([api.get('auth/me'), api.get(base() + 'members'), api.get(base() + 'managers')]);
      if (token !== generation || !active() || !same(projectId, project)) return;
      actor = values[0]; members = values[1]; managers = values[2]; loaded = true;
      $('#project-settings-status').text(projectStatus !== 'ACTIVE' ? t('archived', 'This project is archived.') : canInvite() ? '' : t('readOnly', 'Project members and managers are shown below.'));
      render();
    } catch (failure) {
      if (token !== generation || !active()) return;
      members = []; managers = [];
      $('#project-settings-status').text(failure.message || t('unavailable', 'Project settings could not be loaded.'));
      $('#project-settings-retry').removeClass('d-none'); render();
    } finally { if (token === generation) { loading = false; controls(); } }
  }
  async function mutate(request, successKey) {
    if (!active() || busy || !loaded) return;
    const token = generation;
    busy = true; notice(''); controls();
    try {
      await request();
      if (token !== generation || !active()) return;
      clearDrafts(); busy = false;
      notice(t(successKey, { memberAdded: 'Member added.', managerAdded: 'Manager appointed.', managerRemoved: 'Manager role removed.' }[successKey]));
      await load();
    } catch (failure) { if (token === generation && active()) notice(failure.message || t('saveFailed', 'The change could not be saved.'), true); }
    finally { if (token === generation) { busy = false; controls(); } }
  }
  $('#project-settings-member-form').on('submit', function (event) {
    event.preventDefault();
    if (!canInvite() || busy || !this.reportValidity()) return;
    const username = $('#project-settings-username').val().trim();
    if (!username) { $('#project-settings-username').trigger('focus'); return; }
    return mutate(function () { return api.post(base() + 'members', { username: username, projectRole: $('#project-settings-role').val() }); }, 'memberAdded');
  });
  $('#project-settings-manager-form').on('submit', function (event) {
    event.preventDefault();
    if (!canAppoint() || busy || !this.reportValidity()) return;
    const selected = $('#project-settings-manager').val();
    if (!members.some(function (row) { return same(row.userId, selected) && activeMember(row); })) return;
    return mutate(function () { return api.post(base() + 'managers', { userId: Number(selected) }); }, 'managerAdded');
  });
  $('#project-settings-manager').on('change', controls);
  $(document).on('veriqra:project', function (event) {
    const project = event.originalEvent.detail.project;
    generation++; busy = false; loading = false; loaded = false; actor = null; members = []; managers = [];
    projectId = project ? String(project.id) : null; projectStatus = project && project.status;
    const route = window.VeriqraQaNavigation && window.VeriqraQaNavigation.read();
    if (route) view = route.view;
    clearDrafts(); notice(''); render(); if (active()) load();
  });
  $(document).on('veriqra:view', function (event) {
    const next = event.originalEvent.detail.view;
    if (next !== view) { generation++; busy = false; loading = false; loaded = false; clearDrafts(); notice(''); }
    view = next; if (active()) load();
  });
  document.addEventListener('veriqra:localechange', render);
  document.addEventListener('veriqra:reauthenticated', function () { if (active()) load(); });
  render();
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('project-settings', { dirty: function () { return active() && dirty(); }, clear: clearDrafts });
})(jQuery, window.VeriqraApi);
