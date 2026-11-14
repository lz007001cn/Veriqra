(function ($, api) {
  'use strict';
  const card = $('#project-chat');
  const question = $('#project-chat-question');
  const log = $('#project-chat-log');
  const status = $('#project-chat-status');
  const retry = $('#project-chat-retry');
  const navigation = window.VeriqraQaNavigation;
  const maxQuestion = 1500;
  const maxHistoryText = 6000;
  const maxRequestBytes = 60 * 1024;
  const routes = new Map([
    ['requirement', ['requirements', 'requirementId']], ['testcase', ['test-cases', 'testCaseId']],
    ['testplan', ['test-plans', 'planId']], ['run', ['runs', 'runId']], ['defect', ['defects', 'defectId']],
    ['import', ['automation', 'importId']], ['releaseacceptance', ['release-acceptance', 'acceptanceId']],
    ['project', ['dashboard']]
  ]);
  const errors = new Set(['AI_NOT_CONFIGURED', 'AI_AUTH_ERROR', 'AI_RATE_LIMITED', 'AI_UPSTREAM_ERROR',
    'AI_TIMEOUT', 'AI_INVALID_RESPONSE']);
  const tr = (key, args) => window.I18n.t('projectChat.' + key, args);
  const id = value => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    return /^[1-9][0-9]{0,18}$/.test(String(value)) ? String(value) : null;
  };
  let view = navigation?.read?.().view || 'dashboard';
  let actorId = null, projectId = null, projectName = '';
  let conversation = [], pending = null, failure = '', failedQuestion = '';

  function active() { return !!projectId && view === 'dashboard'; }
  function paused() { return window.VeriqraSessionRecovery?.paused?.() === true; }
  function canAsk() { return active() && !pending && !paused(); }
  function updateControls() {
    question.prop('disabled', !active() || paused());
    const text = String(question.val() || '').trim();
    $('#project-chat-send').prop('disabled', !canAsk() || !text || text.length > maxQuestion);
    retry.toggleClass('d-none', !failedQuestion || !failure).prop('disabled', !canAsk() || text !== failedQuestion);
    const hasConversation = !!(conversation.length || pending || failedQuestion);
    $('#project-chat-clear').toggleClass('d-none', !hasConversation).prop('disabled', !hasConversation || !active());
    $('#project-chat-form').attr('aria-busy', String(!!pending));
  }
  function renderStatus() {
    status.text(pending ? tr('pending') : failure ? tr(failure) : '')
      .toggleClass('text-danger', !!failure).toggleClass('text-secondary', !failure);
    updateControls();
  }

  function sourceDestination(row) {
    const key = typeof row?.type === 'string' ? row.type.toLowerCase().replaceAll('_', '') : '';
    const route = routes.get(key), sourceId = id(row?.id);
    if (!route || !sourceId || typeof row.label !== 'string' || !row.label.trim()) return null;
    const [target, field] = route;
    if (target === 'dashboard' && sourceId !== projectId) return null;
    return { key: target + ':' + sourceId, target, params: field ? { projectId, [field]: sourceId } : { projectId } };
  }
  function appendSources(message, sources) {
    if (!navigation) return;
    const seen = new Set();
    const list = $('<ul class="project-chat-sources">').attr('aria-label', tr('sources'));
    for (const row of sources) {
      const destination = sourceDestination(row);
      if (!destination || seen.has(destination.key)) continue;
      seen.add(destination.key);
      const { target, params } = destination;
      list.append($('<li>').append($('<a>').text(row.label).attr('href', navigation.href(target, params)).on('click', function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
        event.preventDefault();
        if (active() && params.projectId === projectId) navigation.open(target, params);
      })));
    }
    if (seen.size) message.append($('<p class="small fw-semibold mb-0 mt-2">').text(tr('sources')), list);
  }
  function appendMessage(role, text, response) {
    const message = $('<div class="project-chat-message">').addClass('project-chat-message-' + role)
      .append($('<p class="project-chat-speaker">').text(tr(role)), $('<p class="project-chat-text">').text(text));
    if (response?.truncated) message.append($('<p class="small text-secondary mb-0 mt-2">').text(tr('partialContext')));
    if (response) appendSources(message, response.sources);
    log.append(message);
  }
  function renderLog() {
    log.empty().toggleClass('d-none', !conversation.length && !pending && !failedQuestion);
    for (const pair of conversation) {
      appendMessage('user', pair.question);
      appendMessage('assistant', pair.answer, pair);
    }
    const nextQuestion = pending?.question || failedQuestion;
    if (nextQuestion) appendMessage('user', nextQuestion);
    const region = log[0];
    if (region) region.scrollTop = region.scrollHeight;
  }
  function render() {
    card.toggleClass('d-none', !active());
    $('#project-chat-scope').text(projectId ? tr('scope', { project: projectName }) : '');
    renderLog();
    renderStatus();
  }
  function reset() {
    conversation = [];
    pending = null;
    failure = '';
    failedQuestion = '';
    question.val('');
  }

  function requestBody(text) {
    const language = window.I18n.getLocale?.() === 'zh-CN' ? 'zh-CN' : 'en';
    const body = { question: text, history: [], language };
    const encoder = new TextEncoder();
    for (const pair of conversation.slice(-3).reverse()) {
      const history = [{ role: 'user', text: pair.question }, { role: 'assistant', text: pair.answer.slice(0, maxHistoryText) }, ...body.history];
      const bytes = encoder.encode(JSON.stringify({ ...body, history })).length;
      if (bytes > maxRequestBytes) break;
      body.history = history;
    }
    return body;
  }
  function errorKey(error) {
    if (errors.has(error?.code)) return error.code;
    if (error?.status === 401) return 'sessionExpired';
    if (error?.status === 403) return 'forbidden';
    if (error?.status === 429) return 'AI_RATE_LIMITED';
    return 'failed';
  }
  async function send() {
    if (!canAsk()) return;
    const text = String(question.val() || '').trim();
    if (!text || text.length > maxQuestion) return;
    const request = { projectId, question: text };
    pending = request;
    failedQuestion = '';
    failure = '';
    question.val('');
    render();
    try {
      const value = await api.post('projects/' + encodeURIComponent(request.projectId) + '/ai/chat', requestBody(text));
      if (pending !== request) return;
      if (typeof value?.answer !== 'string' || !value.answer.trim() || !Array.isArray(value.sources)) {
        throw { code: 'AI_INVALID_RESPONSE' };
      }
      conversation.push({ question: text, answer: value.answer, sources: value.sources, truncated: value.truncated === true });
    } catch (error) {
      if (pending !== request) return;
      failure = errorKey(error);
      failedQuestion = text;
      if (!String(question.val() || '').trim()) question.val(text);
    } finally {
      if (pending === request) {
        pending = null;
        if (active()) render();
      }
    }
  }

  question.on('input', updateControls);
  $('#project-chat-form').on('submit', function (event) { event.preventDefault(); return send(); });
  retry.on('click', function () { if (question.val() === failedQuestion) return send(); });
  $('#project-chat-clear').on('click', function () {
    if (!active()) return;
    reset(); render(); question[0]?.focus?.();
  });
  document.addEventListener('veriqra:project', function (event) {
    const project = event.detail.project;
    const nextId = id(project?.id);
    if (nextId !== projectId) reset();
    projectId = nextId;
    projectName = project?.name || project?.projectKey || (projectId ? '#' + projectId : '');
    render();
  });
  document.addEventListener('veriqra:view', function (event) {
    view = event.detail.view;
    if (active()) render(); else card.addClass('d-none');
  });
  function setActor(user) {
    const next = id(user?.id);
    if (actorId && next !== actorId) {
      reset(); projectId = null; projectName = ''; render();
    }
    actorId = next;
  }
  document.addEventListener('veriqra:identity', event => setActor(event.detail.user));
  document.addEventListener('veriqra:reauthenticated', function (event) {
    setActor(event.detail.user);
    if (active()) renderStatus();
  });
  document.addEventListener('veriqra:localechange', function () { if (active()) render(); });
})(jQuery, window.VeriqraApi);
