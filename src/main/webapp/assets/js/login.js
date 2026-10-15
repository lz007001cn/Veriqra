(function ($, api) {
  'use strict';
  const t = window.I18n.t;
  const form = $('#login-form');
  const submit = $('#login-submit');
  const error = $('#login-error');
  let busy = false;
  let feedbackDescriptor = null;
  function returnTarget() {
    const value = typeof URL === 'function' && window.location.href ? new URL(window.location.href).searchParams.get('returnTo') : null;
    return window.VeriqraSessionRecovery ? window.VeriqraSessionRecovery.safeReturnTarget(value) : new URL('index.html', document.baseURI).href;
  }

  function renderFeedback() {
    const descriptor = feedbackDescriptor;
    let message = '';
    if (descriptor) {
      const args = descriptor.messageKey === 'auth.loginRateLimited'
        ? { time: window.I18n.formatRetryDelay(descriptor.retryAfterSeconds) } : descriptor.messageArgs;
      message = t(descriptor.messageKey, args, descriptor.messageFallback);
      if (descriptor.code) message = window.I18n.error({ code: descriptor.code, message: message });
    }
    error.text(message).toggleClass('d-none', !message);
  }
  function feedback(descriptor) {
    feedbackDescriptor = descriptor ? { messageKey: descriptor.messageKey, messageArgs: descriptor.messageArgs,
      messageFallback: descriptor.messageFallback, retryAfterSeconds: descriptor.retryAfterSeconds, code: descriptor.code } : null;
    renderFeedback();
  }
  function setBusy(value) {
    busy = value;
    submit.prop('disabled', value);
    submit.find('.button-label').text(value ? t("auth.signingIn", null, 'Signing in…') : t("common.signIn", null, 'Sign in'));
    submit.find('.spinner-border').toggleClass('d-none', !value);
  }
  form.on('submit', function (event) {
    event.preventDefault();
    if (busy) return;
    feedback(null);
    const username = $('#username').val().trim();
    const password = $('#password').val();
    if (!username || !password) {
      feedback({ messageKey: 'auth.enterYourUsernameAndPassword', messageFallback: 'Enter your username and password.' }); return;
    }
    setBusy(true);
    api.post('auth/login', { username: username, password: password }, { authRequired: false })
      .done(function () { window.location.replace(returnTarget()); })
      .fail(function (failure) {
        feedback(failure.status === 401
          ? { messageKey: 'auth.invalidUsernameOrPassword', messageFallback: 'Invalid username or password.' } : failure);
      })
      .always(function () { setBusy(false); });
  });
  // A server session, never a browser flag, decides whether this page is needed.
  window.I18n.init().then(function () {
    api.get('auth/me', { authRequired: false }).done(function () {
      window.location.replace(returnTarget());
    }).fail(function (failure) {
      // A missing session is the normal login-page state, not a retryable error.
      if (failure.status !== 401) feedback(failure);
    });
  });
  document.addEventListener('veriqra:localechange', function () { setBusy(busy); renderFeedback(); });
})(jQuery, window.VeriqraApi);
