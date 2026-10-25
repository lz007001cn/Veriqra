(function (global, $, api) {
  'use strict';
  const t = function (key, args, fallback) { return global.I18n.t(key, args, fallback); };
  const drafts = new Map();
  let bypassUnload = false;
  let identity = null;
  let sessionExpired = false;
  function dirty() { return Array.from(drafts.values()).some(function (entry) { return entry.dirty && entry.dirty(); }); }
  function discard() {
    drafts.forEach(function (entry) { if (entry.clear) entry.clear(); });
    drafts.clear();
  }
  global.VeriqraDraftGuard = Object.freeze({
    register: function (owner, entry) { drafts.set(owner, entry); },
    unregister: function (owner) { drafts.delete(owner); },
    hasDirty: dirty,
    allowLeave: function () {
      if (!dirty()) return true;
      if (!global.confirm(t('r2.leaveDraft'))) return false;
      // Keep registrations: each module owns its scope reset and uncertain-request ledger.
      return true;
    },
    discardAll: discard
  });
  global.addEventListener('beforeunload', function (event) {
    if (!bypassUnload && dirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  function validId(id) { return /^[1-9][0-9]{0,18}$/.test(String(id || '')); }
  function load(projectId) {
    const result = $.Deferred();
    if (!validId(projectId)) { result.reject({ status: 404, message: t('qa.projectUnavailable') }); return result.promise(); }
    const base = 'projects/' + encodeURIComponent(projectId);
    // Never infer a capability from a cached role, a PM badge, or an unsuccessful read.
    api.get('auth/me').done(function (actor) {
      if (!actor || !validId(actor.id)) { result.reject({ status: 401, message: t('r2.sessionExpired') }); return; }
      if (identity != null && String(identity) !== String(actor.id)) {
        bypassUnload = true;
        try { discard(); } finally {
          result.reject({ status: 401, code: 'IDENTITY_CHANGED', message: t('r2.accountChanged') });
          global.location.replace(new URL('index.html', document.baseURI).href);
        }
        return;
      }
      identity = actor.id;
      api.get(base).done(function (project) {
        if (!project || String(project.id) !== String(projectId)) { result.reject({ status: 404, message: t('qa.projectUnavailable') }); return; }
        api.get(base + '/members').done(function (members) {
          if (!Array.isArray(members)) { result.reject({ status: 503, message: t('r2.roleReadRequired') }); return; }
          const member = members.find(function (row) {
            return String(row.userId) === String(actor.id) && row.status === 'ACTIVE' && row.userStatus === 'ACTIVE';
          });
          result.resolve({ actorId: actor.id, systemRole: actor.systemRole, projectRole: member ? member.projectRole : null,
            projectStatus: project.status, members: members, projectId: project.id,
            canWriteAssets: actor.status === 'ACTIVE' && project.status === 'ACTIVE' && (actor.systemRole === 'ADMIN' || !!member && member.projectRole === 'TESTER') });
        }).fail(function (failure) { result.reject(failure); });
      }).fail(function (failure) { result.reject(failure); });
    }).fail(function (failure) { result.reject(failure); });
    return result.promise();
  }
  global.VeriqraQaContext = Object.freeze({ load: load });
  function safeReturnTarget(candidate) {
    const fallback = new URL('index.html', document.baseURI);
    try {
      const input = new URL(candidate || '', document.baseURI);
      if (input.origin !== fallback.origin || input.pathname !== fallback.pathname || input.username || input.password) return fallback.href;
      const views = ['dashboard', 'requirements', 'test-cases', 'test-plans', 'runs', 'defects', 'automation', 'project-settings'];
      const requestedView = input.hash.slice(1) || 'dashboard';
      const view = requestedView === 'collaboration' ? 'project-settings' : requestedView;
      if (!views.includes(view)) return fallback.href;
      const keys = ['projectId','requirementId','testCaseId','planId','runId','runCaseId','attemptId','defectId',
        'sourceRequirementId','sourceTestCaseId','sourcePlanId','failureAttemptId'];
      keys.forEach(function (key) { const value = input.searchParams.get(key); if (validId(value)) fallback.searchParams.set(key, value); });
      if (['create', 'link'].includes(input.searchParams.get('action'))) fallback.searchParams.set('action', input.searchParams.get('action'));
      fallback.hash = view; return fallback.href;
    } catch (_) { return fallback.href; }
  }
  function loginUrl() {
    const url = new URL('login.html', document.baseURI);
    url.searchParams.set('returnTo', safeReturnTarget(global.location.href)); return url.href;
  }
  function banner(messageKey) {
    let target = $('#session-recovery');
    if (!target.length) {
      target = $('<section id="session-recovery" class="alert alert-warning m-3" role="alert" aria-live="assertive">');
      $('body').prepend(target);
    }
    target.empty().removeClass('d-none').append($('<p>').text(t(messageKey || 'r2.sessionExpired')));
    target.append($('<a class="btn btn-outline-primary me-2" target="_blank" rel="noopener">').attr('href', loginUrl()).text(t('r2.signInNewTab')));
    target.append($('<button type="button" class="btn btn-primary">').text(t('r2.verifySession')).on('click', function () {
      const button = $(this).prop('disabled', true);
      api.get('auth/me', { authRequired: false }).done(function (actor) {
        if (identity != null && String(identity) !== String(actor.id)) {
          // A different user must never see the old user's in-memory drafts.
          discard(); bypassUnload = true; global.location.replace(new URL('index.html', document.baseURI).href); return;
        }
        identity = actor.id; sessionExpired = false;
        if (api.resumeSession) api.resumeSession();
        target.empty().append($('<p class="mb-0">').text(t('r2.sessionRestored')));
        document.dispatchEvent(new CustomEvent('veriqra:reauthenticated', { detail: { user: actor } }));
      }).fail(function () { banner('r2.sessionStillExpired'); }).always(function () { button.prop('disabled', false); });
    }));
  }
  global.VeriqraSessionRecovery = Object.freeze({
    safeReturnTarget: safeReturnTarget,
    loginUrl: loginUrl,
    unauthorized: function () { sessionExpired = true; banner(); return true; },
    paused: function () { return sessionExpired; }
  });
  document.addEventListener('veriqra:identity', function (event) { identity = event.detail.user.id; });
  document.addEventListener('veriqra:localechange', function () { if (sessionExpired) banner(); });
})(window, jQuery, window.VeriqraApi);
