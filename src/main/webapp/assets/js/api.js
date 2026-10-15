(function (global, $) {
  'use strict';
  const t = window.I18n.t;
  const messages = {
    400: ['http.pleaseCheckTheInformationYouEntered', 'Please check the information you entered.'],
    401: ['http.yourSessionHasExpiredPleaseSignInAgain', 'Your session has expired. Please sign in again.'],
    403: ['http.youDoNotHaveAccessToThisAction', 'You do not have access to this action.'],
    404: ['http.theRequestedItemIsNoLongerAvailable', 'The requested item is no longer available.'],
    409: ['http.thisItemHasChangedRefreshAndTryAgain', 'This item has changed. Refresh and try again.'],
    413: ['http.theXMLFileExceedsThe5MiBUploadLimit', 'The XML file exceeds the 5 MiB upload limit.'],
    415: ['http.theServerRequiresApplicationXmlForThisUpload', 'The server requires application/xml for this upload.'],
    429: ['http.tooManyRequestsPleaseTryAgainShortly', 'Too many requests. Please try again shortly.']
  };

  function onLoginPage() { return global.location.pathname.endsWith('/login.html'); }
  let authPaused = false;
  function signIn() {
    const target = global.VeriqraSessionRecovery ? global.VeriqraSessionRecovery.loginUrl() : new URL('login.html', document.baseURI).href;
    global.location.replace(target);
  }
  function unauthorized() {
    authPaused = true;
    if (global.VeriqraSessionRecovery && global.VeriqraSessionRecovery.unauthorized()) return;
    signIn();
  }
  function errorFrom(xhr, loginAttempt) {
    const status = xhr.status || 0;
    const retryHeader = xhr.getResponseHeader('Retry-After');
    const seconds = retryHeader == null ? NaN : Number(retryHeader);
    const entry = messages[status] || (status >= 500
      ? ['http.theServerIsUnavailablePleaseTryAgainLater', 'The server is unavailable. Please try again later.']
      : ['http.theRequestCouldNotBeCompleted', 'The request could not be completed.']);
    let messageKey = entry[0];
    let messageArgs = null;
    let messageFallback = entry[1];
    let message = t(messageKey, messageArgs, messageFallback);
    if (status === 429 && loginAttempt) {
      const delay = global.I18n.formatRetryDelay(seconds);
      messageKey = delay ? 'auth.loginRateLimited' : 'auth.loginRateLimitedGeneric';
      messageFallback = delay ? 'Too many login attempts. Please try again in {time}.' : 'Too many login attempts. Please try again later.';
      message = t(messageKey, delay ? { time: delay } : null, messageFallback);
    } else if (status === 429 && Number.isFinite(seconds) && seconds > 0) {
      messageKey = 'http.retryAfterSeconds';
      messageArgs = { seconds: Math.ceil(seconds) };
      messageFallback = 'Too many requests. Try again in {seconds} seconds.';
      message = t(messageKey, messageArgs, messageFallback);
    }
    const code = xhr.responseJSON && xhr.responseJSON.error && xhr.responseJSON.error.code;
    const reasonCode = xhr.responseJSON && xhr.responseJSON.error && xhr.responseJSON.error.reasonCode;
    const field = xhr.responseJSON && xhr.responseJSON.error && xhr.responseJSON.error.field;
    const qaReasons = ['QA_FIELD_REQUIRED','QA_FIELD_TOO_LONG','QA_STEPS_INVALID','QA_CASE_STEPS_REQUIRED','QA_CASE_NOT_READY',
      'QA_PLAN_NOT_READY','QA_PLAN_EMPTY','QA_SCOPE_CHANGED','QA_ARCHIVED_READ_ONLY','QA_STALE_VERSION','QA_INVALID_RELATION',
      'QA_FORBIDDEN','QA_INVALID_INPUT','QA_STATE_CONFLICT'];
    if (qaReasons.includes(reasonCode)) {
      messageKey = 'r2Error.' + reasonCode; messageArgs = null; message = t(messageKey, null, messageFallback);
    }
    // UI descriptors let visible failures follow a locale change without another request.
    return { status: status, message: qaReasons.includes(reasonCode) ? message : global.I18n.error({ code: code, message: message }), code: code, reasonCode: reasonCode, field: field,
      messageKey: messageKey, messageArgs: messageArgs, messageFallback: messageFallback,
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  }
  function request(method, path, body, options) {
    const settings = options || {};
    const url = new URL('api/' + path.replace(/^\/+/, ''), document.baseURI);
    const isWrite = !['GET', 'HEAD'].includes(method);
    if (isWrite && authPaused && !['auth/login', 'auth/logout'].includes(path)) {
      const paused = $.Deferred();
      paused.reject({ status: 401, message: t('r2.sessionExpired'), code: 'UNAUTHENTICATED', messageKey: 'r2.sessionExpired' });
      return paused.promise();
    }
    const call = $.ajax({
      url: url.href, method: method, dataType: 'json',
      contentType: isWrite ? 'application/json; charset=UTF-8' : undefined,
      data: body === undefined ? undefined : JSON.stringify(body),
      headers: isWrite ? { 'X-Veriqra-Request': '1' } : {},
      // The browser supplies the same-origin session cookie and Origin header.
    });
    const result = $.Deferred();
    call.done(function (data) { result.resolve(data); });
    call.fail(function (xhr) {
      const error = errorFrom(xhr, method === 'POST' && path === 'auth/login');
      if (error.status === 401 && settings.authRequired !== false && !onLoginPage()) unauthorized();
      result.reject(error);
    });
    return result.promise();
  }
  function xml(path, file) {
    if (authPaused) {
      const paused = $.Deferred(); paused.reject({ status: 401, message: t('r2.sessionExpired'), code: 'UNAUTHENTICATED' });
      return paused.promise();
    }
    const url = new URL('api/' + path.replace(/^\/+/, ''), document.baseURI);
    const result = $.Deferred();
    $.ajax({ url: url.href, method: 'POST', data: file, processData: false,
      contentType: 'application/xml', dataType: 'json', headers: { 'X-Veriqra-Request': '1' } })
      .done(function (data) { result.resolve(data); })
      .fail(function (xhr) {
        const error = errorFrom(xhr, false);
        if (error.status === 401 && !onLoginPage()) unauthorized();
        result.reject(error);
      });
    return result.promise();
  }
  global.VeriqraApi = Object.freeze({
    get: function (path, options) { return request('GET', path, undefined, options); },
    post: function (path, body, options) { return request('POST', path, body, options); },
    put: function (path, body, options) { return request('PUT', path, body, options); },
    delete: function (path, options) { return request('DELETE', path, undefined, options); },
    action: request,
    xml: xml,
    signIn: signIn,
    resumeSession: function () { authPaused = false; }
  });
})(window, jQuery);
