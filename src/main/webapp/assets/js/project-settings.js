(function ($, api) {
  'use strict';
  const root = $('#project-settings-workspace');
  const t = function (key, fallback) { return window.I18n.t('projectSettings.' + key, null, fallback); };
  let projectId = null, projectStatus = null, view = 'dashboard', actor = null;
  let members = [], managers = [], loading = false, loaded = false, busy = false, generation = 0;
  let memberDraft = null, memberError = null;
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
  function clearMemberEditor() {
    memberDraft = null;
    memberError = null;
  }
  function clearDrafts() {
    $('#project-settings-username').val(''); $('#project-settings-role').val('TESTER'); $('#project-settings-manager').val('');
    clearMemberEditor();
  }
  function membershipChanged() {
    return memberDraft && (memberDraft.projectRole !== memberDraft.member.projectRole || memberDraft.status !== memberDraft.member.status);
  }
  function dirty() { return busy || membershipChanged() || !!$('#project-settings-username').val() || $('#project-settings-role').val() !== 'TESTER' || !!$('#project-settings-manager').val(); }
  function endsDeveloperEligibility() {
    return memberDraft && memberDraft.member.projectRole === 'DEVELOPER' && (memberDraft.projectRole !== 'DEVELOPER' || memberDraft.status !== 'ACTIVE');
  }
  function replacementCandidates() {
    return memberDraft ? members.filter(function (row) {
      return activeMember(row) && row.projectRole === 'DEVELOPER' && !same(row.userId, memberDraft.member.userId);
    }) : [];
  }
  function isActiveManager(userId) {
    return managers.some(function (row) { return same(row.userId, userId) && row.status === 'ACTIVE'; });
  }
  function canEditMember(row) {
    return canInvite() && row.status === 'ACTIVE' && Number.isInteger(row.version) && row.version >= 0 && (isAdmin() || !same(row.userId, actor.id));
  }
  function currentEditedMember() {
    return memberDraft && members.find(function (row) { return same(row.userId, memberDraft.member.userId); });
  }
  function canChangeDraftRole() {
    const current = currentEditedMember();
    return current && current.userStatus === 'ACTIVE' && memberDraft.status === 'ACTIVE';
  }
  function staleMemberDraft() {
    if (!memberDraft || !loaded) return false;
    const current = currentEditedMember();
    return ['MEMBER_VERSION_CHANGED', 'MEMBER_INACTIVE'].includes(memberError && memberError.code)
      || !current || current.status !== 'ACTIVE' || current.version !== memberDraft.member.version;
  }
  function canSaveMemberDraft() {
    return canInvite() && membershipChanged() && !staleMemberDraft()
      && (memberDraft.projectRole === memberDraft.member.projectRole || canChangeDraftRole())
      && (memberDraft.status === 'ACTIVE' || !isActiveManager(memberDraft.member.userId));
  }
  function memberEditError(failure) {
    const messages = {
      MEMBER_VERSION_CHANGED: ['memberVersionChanged', 'This membership changed. Reload the project settings and open the member again.'],
      MEMBER_DEFECT_HANDOFF_REQUIRED: ['handoffRequired', 'Choose a replacement developer for this member’s unclosed defects.'],
      MEMBER_REPLACEMENT_INELIGIBLE: ['replacementIneligible', 'Choose another active developer in this project.'],
      MEMBER_MANAGER_APPOINTMENT_ACTIVE: ['managerDeactivation', 'An administrator must remove this member’s manager appointment before deactivation.'],
      MEMBER_SELF_ROLE_CHANGE: ['selfRoleChange', 'A project manager cannot change their own project role.'],
      MEMBER_ACCOUNT_DISABLED: ['accountDisabled', 'This account is disabled. You can deactivate its membership with the current role.'],
      MEMBER_INACTIVE: ['memberVersionChanged', 'This membership changed. Reload the project settings and open the member again.'],
      RUN_ASSIGNMENTS_EXIST: ['runAssignmentsExist', 'Reassign this member’s unfinished test runs before saving.']
    };
    const message = messages[failure.code];
    return message ? t(message[0], message[1]) : failure.message || t('saveFailed', 'The change could not be saved.');
  }
  root.append($('<div id="project-settings-notice" class="alert d-none" role="status" aria-live="polite">'),
    $('<p id="project-settings-status" class="text-secondary" role="status">'),
    $('<button id="project-settings-retry" type="button" class="btn btn-outline-primary mb-3 d-none">').on('click', load),
    $('<section class="asset-panel">').append($('<h2 id="project-settings-members-heading" class="fs-5">'),
      $('<div id="project-settings-members">'),
      $('<form id="project-settings-edit-form" class="asset-step mt-3 d-none" aria-labelledby="project-settings-edit-heading">').append(
        $('<h3 id="project-settings-edit-heading" class="fs-6" tabindex="-1">'),
        $('<div class="row g-3 mb-3">').append(
          $('<div class="col-md-6">').append($('<label id="project-settings-edit-role-label" for="project-settings-edit-role" class="form-label">'),
            $('<select id="project-settings-edit-role" class="form-select">')),
          $('<div class="col-md-6">').append($('<label id="project-settings-edit-status-label" for="project-settings-edit-status" class="form-label">'),
            $('<select id="project-settings-edit-status" class="form-select" aria-describedby="project-settings-edit-help">'))),
        $('<p id="project-settings-edit-help" class="small text-secondary">'),
        $('<div id="project-settings-handoff" class="mb-3 d-none">').append(
          $('<label id="project-settings-replacement-label" for="project-settings-replacement" class="form-label">'),
          $('<select id="project-settings-replacement" class="form-select" aria-describedby="project-settings-handoff-help">'),
          $('<p id="project-settings-handoff-help" class="small text-secondary mt-1 mb-0">')),
        $('<div id="project-settings-edit-error" class="alert alert-danger d-none" role="alert">'),
        $('<div class="d-flex flex-wrap gap-2">').append(
          $('<button id="project-settings-edit-save" type="submit" class="btn btn-primary">'),
          $('<button id="project-settings-edit-cancel" type="button" class="btn btn-outline-secondary">'),
          $('<button id="project-settings-edit-reload" type="button" class="btn btn-outline-secondary d-none">'))),
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
  function renderMemberEditor() {
    $('#project-settings-edit-form').toggleClass('d-none', !memberDraft || !canInvite());
    if (!memberDraft || !canInvite()) return;
    $('#project-settings-edit-heading').text(t('editMembership', 'Edit membership') + ' · ' + name(memberDraft.member));
    $('#project-settings-edit-role-label').text(t('projectRole', 'Project role'));
    $('#project-settings-edit-status-label').text(t('membershipStatus', 'Membership status'));
    const roleSelect = $('#project-settings-edit-role').empty();
    ['TESTER', 'DEVELOPER'].forEach(function (value) { roleSelect.append($('<option>').val(value).text(role(value))); });
    roleSelect.val(memberDraft.projectRole);
    $('#project-settings-edit-status').empty()
      .append($('<option>').val('ACTIVE').text(t('active', 'Active')), $('<option>').val('INACTIVE').text(t('inactive', 'Inactive')))
      .val(memberDraft.status);
    let help = t('deactivateHelp', 'Deactivation removes access granted by this membership and preserves the member’s history.');
    if (isActiveManager(memberDraft.member.userId)) help = t('managerDeactivation', 'An administrator must remove this member’s manager appointment before deactivation.');
    else if (currentEditedMember()?.userStatus === 'DISABLED') help = t('accountDisabled', 'This account is disabled. You can deactivate its membership with the current role.');
    $('#project-settings-edit-help').text(help);
    $('#project-settings-handoff').toggleClass('d-none', !endsDeveloperEligibility());
    $('#project-settings-replacement-label').text(t('replacementAssignee', 'Replacement for unclosed defects'));
    const replacement = $('#project-settings-replacement').empty().append($('<option>').val('').text(t('chooseReplacement', 'Choose a developer')));
    const candidates = replacementCandidates();
    candidates.forEach(function (row) { replacement.append($('<option>').val(String(row.userId)).text(name(row))); });
    replacement.val(memberDraft.replacementAssigneeId || '');
    $('#project-settings-handoff-help').text(candidates.length
      ? t('handoffHelp', 'If this member has defects that haven’t been closed, choose an active developer to take over all of them.')
      : t('noReplacement', 'No eligible developer is available. If this member has unclosed defects, add an active developer first.'));
    const stale = staleMemberDraft();
    const error = stale ? memberEditError({ code: 'MEMBER_VERSION_CHANGED' }) : memberError ? memberEditError(memberError) : '';
    $('#project-settings-edit-error').text(error).toggleClass('d-none', !error);
    $('#project-settings-edit-save').text(window.I18n.t('common.save', null, 'Save'));
    $('#project-settings-edit-cancel').text(window.I18n.t('common.cancel', null, 'Cancel'));
    $('#project-settings-edit-reload').text(t('discardAndReload', 'Discard draft and reload')).toggleClass('d-none', !stale);
  }
  function openMemberEditor(row) {
    if (busy || loading || memberDraft || !canEditMember(row)) return;
    memberDraft = { member: row, projectRole: row.projectRole, status: row.status, replacementAssigneeId: null };
    memberError = null;
    renderMemberEditor(); controls();
    $('#project-settings-edit-heading').trigger('focus');
  }
  function controls() {
    $('#project-settings-member-form').toggleClass('d-none', !canInvite());
    $('#project-settings-manager-form').toggleClass('d-none', !canAppoint());
    root.find('input,select,button').prop('disabled', busy || loading);
    $('#project-settings-members').find('button').prop('disabled', busy || loading || !!memberDraft || !canInvite());
    $('#project-settings-managers').find('button').prop('disabled', busy || loading || !!memberDraft);
    $('#project-settings-edit-form').toggleClass('d-none', !memberDraft || !canInvite());
    const stale = staleMemberDraft();
    $('#project-settings-edit-role').prop('disabled', busy || loading || stale || !canChangeDraftRole());
    $('#project-settings-edit-status').prop('disabled', busy || loading || stale || !memberDraft || isActiveManager(memberDraft.member.userId));
    $('#project-settings-replacement').prop('disabled', busy || loading || stale || !endsDeveloperEligibility());
    $('#project-settings-edit-save').prop('disabled', busy || loading || !canSaveMemberDraft());
    $('#project-settings-add').prop('disabled', busy || loading || !!memberDraft || !canInvite());
    $('#project-settings-appoint').prop('disabled', busy || loading || !!memberDraft || !canAppoint() || !$('#project-settings-manager').val());
    $('#project-settings-retry').prop('disabled', loading || busy);
  }
  function render() {
    labels();
    const memberBox = $('#project-settings-members').empty(), managerBox = $('#project-settings-managers').empty();
    if (loaded && !members.length) memberBox.append($('<p class="text-secondary">').text(t('noMembers', 'No project members yet.')));
    members.forEach(function (row) {
      const item = $('<div class="asset-link-row">').append($('<span>').text(name(row)),
        $('<span class="badge text-bg-secondary">').text(role(row.projectRole)),
        $('<span class="small text-secondary">').text(activeMember(row) ? t('active', 'Active') : t('inactive', 'Inactive')));
      if (canEditMember(row)) item.append($('<button type="button" class="btn btn-outline-secondary btn-sm">')
        .text(t('editMembership', 'Edit membership')).on('click', function () { openMemberEditor(row); }));
      memberBox.append(item);
    });
    const activeManagers = managers.filter(function (row) { return row.status === 'ACTIVE'; });
    if (loaded && !activeManagers.length) managerBox.append($('<p class="text-secondary">').text(t('noManagers', 'No project manager appointed yet.')));
    activeManagers.forEach(function (manager) {
      const member = members.find(function (row) { return same(row.userId, manager.userId); });
      const row = $('<div class="asset-link-row">').append($('<span>').text(member ? name(member) : '#' + manager.userId));
      if (canAppoint()) row.append($('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('revoke', 'Remove manager role')).on('click', function () {
        if (!busy && !memberDraft) mutate(function () { return api.delete(base() + 'managers/' + encodeURIComponent(manager.userId)); }, 'managerRemoved');
      }));
      managerBox.append(row);
    });
    const picker = $('#project-settings-manager'), selected = picker.val();
    picker.empty().append($('<option>').val('').text(t('chooseMember', 'Choose a project member')));
    members.filter(function (row) { return activeMember(row) && !activeManagers.some(function (manager) { return same(manager.userId, row.userId); }); })
      .forEach(function (row) { picker.append($('<option>').val(String(row.userId)).text(name(row))); });
    if (selected) picker.val(selected);
    renderMemberEditor();
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
  async function mutate(request, successKey, onFailure) {
    if (!active() || busy || !loaded) return;
    const token = generation;
    busy = true; notice(''); controls();
    try {
      await request();
      if (token !== generation || !active()) return;
      if (successKey === 'memberUpdated') clearMemberEditor();
      else clearDrafts();
      busy = false;
      notice(t(successKey, { memberAdded: 'Member added.', memberUpdated: 'Membership saved.', managerAdded: 'Manager appointed.', managerRemoved: 'Manager role removed.' }[successKey]));
      await load();
    } catch (failure) {
      if (token !== generation || !active()) return;
      if (onFailure) onFailure(failure);
      else notice(failure.message || t('saveFailed', 'The change could not be saved.'), true);
    }
    finally { if (token === generation) { busy = false; controls(); } }
  }
  $('#project-settings-member-form').on('submit', function (event) {
    event.preventDefault();
    if (!canInvite() || busy || memberDraft || !this.reportValidity()) return;
    const username = $('#project-settings-username').val().trim();
    if (!username) { $('#project-settings-username').trigger('focus'); return; }
    return mutate(function () { return api.post(base() + 'members', { username: username, projectRole: $('#project-settings-role').val() }); }, 'memberAdded');
  });
  $('#project-settings-manager-form').on('submit', function (event) {
    event.preventDefault();
    if (!canAppoint() || busy || memberDraft || !this.reportValidity()) return;
    const selected = $('#project-settings-manager').val();
    if (!members.some(function (row) { return same(row.userId, selected) && activeMember(row); })) return;
    return mutate(function () { return api.post(base() + 'managers', { userId: Number(selected) }); }, 'managerAdded');
  });
  function showMemberError(failure) {
    memberError = failure;
    if (failure.code === 'MEMBER_DEFECT_HANDOFF_REQUIRED') memberDraft.handoffRequired = true;
    renderMemberEditor(); controls();
  }
  $('#project-settings-edit-role, #project-settings-edit-status').on('change', function () {
    if (!memberDraft || busy || staleMemberDraft() || !canInvite()) return;
    const status = $('#project-settings-edit-status').val();
    if (['ACTIVE', 'INACTIVE'].includes(status) && !isActiveManager(memberDraft.member.userId)) memberDraft.status = status;
    const roleValue = $('#project-settings-edit-role').val();
    if (memberDraft.status === 'INACTIVE') memberDraft.projectRole = memberDraft.member.projectRole;
    else if (canChangeDraftRole() && ['TESTER', 'DEVELOPER'].includes(roleValue)) memberDraft.projectRole = roleValue;
    if (!endsDeveloperEligibility()) memberDraft.replacementAssigneeId = null;
    memberError = null; renderMemberEditor(); controls();
  });
  $('#project-settings-replacement').on('change', function () {
    if (!memberDraft || busy || staleMemberDraft() || !canInvite() || !endsDeveloperEligibility()) return;
    memberDraft.replacementAssigneeId = $(this).val() || null;
    memberError = null; renderMemberEditor(); controls();
  });
  $('#project-settings-edit-cancel').on('click', function () {
    if (busy || loading) return;
    clearMemberEditor();
    renderMemberEditor();
    controls();
  });
  $('#project-settings-edit-reload').on('click', function () {
    if (busy || loading || !staleMemberDraft()) return;
    clearMemberEditor();
    renderMemberEditor();
    return load();
  });
  $('#project-settings-edit-form').on('submit', function (event) {
    event.preventDefault();
    if (busy || loading || !canSaveMemberDraft() || !canEditMember(memberDraft.member) || !this.reportValidity()) return;
    const draft = memberDraft;
    const replacement = endsDeveloperEligibility() ? draft.replacementAssigneeId : null;
    if (replacement && !replacementCandidates().some(function (row) { return same(row.userId, replacement); })) {
      showMemberError({ code: 'MEMBER_REPLACEMENT_INELIGIBLE' }); return;
    }
    if (!replacement && endsDeveloperEligibility() && draft.handoffRequired) {
      showMemberError({ code: 'MEMBER_DEFECT_HANDOFF_REQUIRED' }); return;
    }
    const body = { expectedVersion: draft.member.version, projectRole: draft.projectRole, status: draft.status,
      replacementAssigneeId: replacement ? Number(replacement) : null };
    return mutate(function () { return api.put(base() + 'members/' + encodeURIComponent(draft.member.userId), body); }, 'memberUpdated', showMemberError);
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
