(function ($, api) {
  'use strict';
  const card = $('#project-chat');
  const question = $('#project-chat-question');
  const log = $('#project-chat-log');
  const status = $('#project-chat-status');
  const retry = $('#project-chat-retry');
  const starters = $('#project-chat-starters');
  const promptButtons = $('.project-chat-starter');
  const prompts = new Map([
    ['progress', 'promptProgress'], ['coverage', 'promptCoverage'], ['defects', 'promptDefects']
  ]);
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
    'AI_TIMEOUT', 'AI_INVALID_RESPONSE', 'GENERAL_CHAT_LOCKED', 'GENERAL_CHAT_DISABLED']);
  const tr = (key, args) => window.I18n.t('projectChat.' + key, args);
  const id = value => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    return /^[1-9][0-9]{0,18}$/.test(String(value)) ? String(value) : null;
  };
  let view = navigation?.read?.().view || 'dashboard';
  let actorId = null, projectId = null, projectName = '';
  let conversation = [], pending = null, failure = '', failedQuestion = '';
  let projectConversation = [], generalGrant = null;

  function active() { return !!projectId && view === 'dashboard'; }
  function paused() { return window.VeriqraSessionRecovery?.paused?.() === true; }
  function canAsk() { return active() && !pending && !paused(); }
  function updateControls() {
    question.prop('disabled', !active() || paused());
    const text = String(question.val() || '').trim();
    $('#project-chat-send').prop('disabled', !canAsk() || !text || text.length > maxQuestion);
    retry.toggleClass('d-none', !failedQuestion || !failure).prop('disabled', !canAsk() || text !== failedQuestion);
    const hasConversation = !!(conversation.length || pending || failedQuestion);
    starters.toggleClass('d-none', hasConversation || Boolean(generalGrant));
    promptButtons.prop('disabled', !canAsk() || Boolean(generalGrant));
    $('#project-chat-return').toggleClass('d-none', !generalGrant);
    $('#project-chat-clear').toggleClass('d-none', !hasConversation).prop('disabled', !hasConversation || !active());
    $('#project-chat-form').attr('aria-busy', String(!!pending));
  }
  function renderStatus() {
    status.text(pending ? tr(pending.unlock ? 'unlocking' : 'pending') : failure ? tr(failure) : '')
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
    if (seen.size) message.append($('<div class="project-chat-references">')
      .append($('<p>').text(tr('sources')), list));
  }
  function answerBody(text) {
    const body = $('<div class="project-chat-text">');
    let paragraph = [], list = null, listType = '';
    function flushParagraph() {
      if (paragraph.length) body.append($('<p>').text(paragraph.join('\n')));
      paragraph = [];
    }
    for (const raw of text.trim().split(/\r?\n/)) {
      const line = raw.trim();
      const bullet = /^(?:([-*•])|(\d{1,2})[.)、])\s+(.+)$/.exec(line);
      if (!bullet) {
        list = null;
        if (line) paragraph.push(line); else flushParagraph();
        continue;
      }
      flushParagraph();
      const type = bullet[2] ? 'ol' : 'ul';
      if (!list || listType !== type) {
        list = type === 'ol' ? $('<ol>').attr('start', bullet[2]) : $('<ul>');
        body.append(list);
        listType = type;
      }
      list.append($('<li>').text(bullet[3]));
    }
    flushParagraph();
    return body;
  }
  function appendMessage(role, text, response) {
    const message = $('<div class="project-chat-message">').addClass('project-chat-message-' + role)
      .append($('<p class="project-chat-speaker">').text(tr(response && generalGrant ? 'generalAssistant' : role)),
        response ? answerBody(text) : $('<p class="project-chat-text">').text(text));
    if (response && !generalGrant) {
      if (response.truncated) message.append($('<p class="project-chat-context-note">').text(tr('partialContext')));
      appendSources(message, response.sources);
    }
    log.append(message);
    return message[0];
  }
  function renderLog(scrollToLatest) {
    const region = log[0];
    const previousScroll = region?.scrollTop || 0;
    log.empty().toggleClass('d-none', !conversation.length && !pending?.question && !failedQuestion);
    let latest;
    for (const pair of conversation) {
      appendMessage('user', pair.question);
      latest = appendMessage('assistant', pair.answer, pair);
    }
    const nextQuestion = pending?.question || failedQuestion;
    if (nextQuestion) latest = appendMessage('user', nextQuestion);
    if (!region) return;
    region.scrollTop = previousScroll;
    if (scrollToLatest && latest?.getBoundingClientRect) {
      region.scrollTop += latest.getBoundingClientRect().top - region.getBoundingClientRect().top - region.clientTop;
    }
  }
  function render(scrollToLatest) {
    card.toggleClass('d-none', !active());
    const general = Boolean(generalGrant);
    const title = general ? 'generalTitle' : 'title';
    const placeholder = general ? 'generalPlaceholder' : 'placeholder';
    $('#project-chat-title').attr('data-i18n', 'projectChat.' + title).text(tr(title));
    question.attr('data-i18n-placeholder', 'projectChat.' + placeholder).attr('placeholder', tr(placeholder));
    $('#project-chat-scope').toggleClass('d-none', general).text(!general && projectId ? tr('scope', { project: projectName }) : '');
    renderLog(scrollToLatest);
    renderStatus();
  }
  function reset() {
    conversation = [];
    projectConversation = [];
    generalGrant = null;
    pending = null;
    failure = '';
    failedQuestion = '';
    question.val('');
  }
  function returnToProject() {
    const previous = projectConversation;
    reset();
    conversation = previous;
    render(); question[0]?.focus?.();
  }

  function requestBody(text) {
    const language = window.I18n.getLocale?.() === 'zh-CN' ? 'zh-CN' : 'en';
    const body = { question: text, history: [], language };
    if (generalGrant) Object.assign(body, { mode: 'general', grant: generalGrant });
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
    if (/^\/(?:project|项目)(?:\s|$)/i.test(text)) {
      question.val('');
      if (generalGrant) returnToProject(); else render();
      return;
    }
    const unlock = /^\/(?:general|通用)(?:\s+([\s\S]*))?$/i.exec(text);
    if (unlock && !unlock[1]) {
      question.val('');
      failure = 'unlockUsage';
      failedQuestion = '';
      render();
      return;
    }
    const request = unlock ? { projectId, unlock: true } : { projectId, question: text };
    const body = unlock ? { mode: 'unlock', passphrase: unlock[1] || '' } : requestBody(text);
    pending = request;
    failedQuestion = '';
    failure = '';
    question.val('');
    render(true);
    try {
      const value = await api.post('projects/' + encodeURIComponent(request.projectId) + '/ai/chat', body);
      if (pending !== request) return;
      if (unlock) {
        if (value?.unlocked !== true || typeof value.grant !== 'string' || !value.grant.trim()) throw { code: 'AI_INVALID_RESPONSE' };
        if (!generalGrant) {
          projectConversation = conversation;
          conversation = [];
        }
        generalGrant = value.grant;
        return;
      }
      if (typeof value?.answer !== 'string' || !value.answer.trim() || !Array.isArray(value.sources)) {
        throw { code: 'AI_INVALID_RESPONSE' };
      }
      conversation.push({ question: text, answer: value.answer, sources: value.sources, truncated: value.truncated === true });
    } catch (error) {
      if (pending !== request) return;
      if (generalGrant && ['GENERAL_CHAT_LOCKED', 'GENERAL_CHAT_DISABLED'].includes(error?.code)) {
        returnToProject();
        failure = errorKey(error);
        renderStatus();
        return;
      }
      failure = errorKey(error);
      if (!unlock) {
        failedQuestion = text;
        if (!String(question.val() || '').trim()) question.val(text);
      }
    } finally {
      if (pending === request) {
        pending = null;
        if (active()) render(true);
      }
    }
  }

  question.on('input', updateControls);
  promptButtons.on('click', function () {
    const key = prompts.get($(this).attr('data-prompt'));
    if (!canAsk() || !key || generalGrant) return;
    question.val(tr(key));
    updateControls();
    question[0]?.focus();
  });
  $('#project-chat-form').on('submit', function (event) { event.preventDefault(); return send(); });
  retry.on('click', function () { if (question.val() === failedQuestion) return send(); });
  $('#project-chat-return').on('click', function () { if (active() && generalGrant) returnToProject(); });
  $('#project-chat-clear').on('click', function () {
    if (!active()) return;
    if (generalGrant) returnToProject();
    else { reset(); render(); question[0]?.focus?.(); }
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
