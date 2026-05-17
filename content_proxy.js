'use strict';

// Proxy + tracker script — injected on ALL https pages.
// Handles: API proxy for background worker, background jobs tracker panel.
// Full UI (buttons, actions) lives in content.js (MR pages only).

(function() {
  var _isMrDetailPage = !!window.__glMrActionsLoaded;

  function isGitLab() {
    return !!document.querySelector('meta[content="GitLab"]') || !!document.querySelector('body[data-page]');
  }

  if (!isGitLab()) return;

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getPriorityHtml(name, iconUrl) {
    if (!name) return '';
    var icon = iconUrl ? '<img class="gl-jira-priority-icon" src="' + escHtml(iconUrl) + '" alt="">' : '';
    return '<span class="gl-jira-priority">' + icon + escHtml(name) + '</span>';
  }

  var GITLAB_URL = window.location.origin;

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function api(method, path, body) {
    var url = GITLAB_URL + '/api/v4' + path;
    var headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') {
      headers['X-CSRF-Token'] = getCsrfToken();
    }
    var opts = {
      method: method,
      headers: headers,
      credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function(r) {
      if (r.status === 204) return {};
      return r.text().then(function(text) {
        var data;
        try { data = JSON.parse(text); } catch(e) { data = null; }
        if (!r.ok) {
          var msg = (data && (data.message || data.error)) || (r.status + ' ' + r.statusText);
          if (typeof msg === 'object') msg = JSON.stringify(msg);
          throw new Error(msg);
        }
        return data || {};
      });
    });
  }

  // =========================================================================
  // Background jobs tracker panel (same as in content.js)
  // =========================================================================

  function getTrackerFab() {
    var fab = document.querySelector('.gl-mr-actions-fab');
    if (fab) return fab;

    fab = document.createElement('button');
    fab.className = 'gl-mr-actions-fab';
    fab.textContent = 'Jobs';
    fab.addEventListener('click', function() {
      var panel = document.querySelector('.gl-mr-actions-tracker');
      if (panel) {
        panel.classList.remove('tracker-collapsed');
        fab.classList.remove('fab-visible');
      }
    });
    document.body.appendChild(fab);
    return fab;
  }

  function getTrackerPanel() {
    var panel = document.querySelector('.gl-mr-actions-tracker');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.className = 'gl-mr-actions-tracker';

    var header = document.createElement('div');
    header.className = 'tracker-header';
    header.innerHTML = '<span class="tracker-title">Background Jobs</span><div class="tracker-header-actions"><button class="tracker-clear">Clear</button><button class="tracker-close" aria-label="Close">&times;</button></div>';
    header.querySelector('.tracker-close').addEventListener('click', function() {
      panel.classList.add('tracker-collapsed');
      getTrackerFab().classList.add('fab-visible');
    });
    header.querySelector('.tracker-clear').addEventListener('click', function() {
      var items = panel.querySelectorAll('.tracker-item.done, .tracker-item.failed');
      items.forEach(function(el) { el.remove(); });
      if (!panel.querySelector('.tracker-item')) {
        panel.classList.add('tracker-collapsed');
      }
    });
    panel.appendChild(header);

    var list = document.createElement('div');
    list.className = 'tracker-list';
    panel.appendChild(list);

    document.body.appendChild(panel);
    getTrackerFab(); // ensure fab exists
    return panel;
  }

  function cancelTask(taskId) {
    chrome.runtime.sendMessage({ type: 'cancel-task', taskId: taskId }, function() {});
  }

  function updateTrackerItem(taskId, jobNames, currentStatus, error, mrTitle) {
    var panel = getTrackerPanel();
    panel.classList.remove('tracker-collapsed');
    getTrackerFab().classList.remove('fab-visible');
    var list = panel.querySelector('.tracker-list');

    var item = list.querySelector('[data-task-id="' + taskId + '"]');
    if (!item) {
      item = document.createElement('div');
      item.className = 'tracker-item';
      item.setAttribute('data-task-id', taskId);
      list.appendChild(item);
    }

    var currentJob = '';
    var statusMatch = currentStatus.match(/^running:\s*(.+)$/);
    if (statusMatch) currentJob = statusMatch[1];

    var isDone = currentStatus === 'done';
    var isError = currentStatus === 'error';
    var isRunning = !isDone && !isError;

    var stepsHtml = jobNames.map(function(name, i) {
      var cls = 'step';
      if (isDone) {
        cls += ' step-done';
      } else if (isError && name === currentJob) {
        cls += ' step-error';
      } else if (name === currentJob) {
        cls += ' step-active';
      } else {
        var currentIdx = jobNames.indexOf(currentJob);
        if (currentIdx >= 0 && i < currentIdx) {
          cls += ' step-done';
        }
      }
      return '<span class="' + cls + '">' + escHtml(name) + '</span>';
    }).join('<span class="step-arrow">\u2192</span>');

    var statusIcon = isDone ? '\u2713' : isError ? '\u2717' : '<span class="tracker-spinner"></span>';
    var statusCls = isDone ? 'tracker-success' : isError ? 'tracker-error' : 'tracker-running';

    var cancelHtml = isRunning ? '<button class="tracker-cancel" aria-label="Cancel" data-cancel-id="' + taskId + '">&times;</button>' : '';

    var titleHtml = mrTitle ? '<div class="tracker-mr-title">' + escHtml(mrTitle) + '</div>' : '';

    item.innerHTML = titleHtml + '<div class="tracker-row"><span class="tracker-icon ' + statusCls + '">' + statusIcon + '</span><div class="tracker-steps">' + stepsHtml + '</div>' + cancelHtml + '</div>' +
      (isError && error ? '<div class="tracker-error-msg">' + escHtml(error) + '</div>' : '');

    if (isDone || isError) {
      item.className = 'tracker-item ' + (isDone ? 'done' : 'failed');
    }

    var cancelBtn = item.querySelector('.tracker-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        cancelTask(cancelBtn.getAttribute('data-cancel-id'));
      });
    }
  }

  // =========================================================================
  // Restore active tasks on page load
  // =========================================================================

  function restoreActiveTasks() {
    chrome.runtime.sendMessage({ type: 'get-active-tasks' }, function(tasks) {
      if (chrome.runtime.lastError || !tasks || !tasks.length) return;
      tasks.forEach(function(t) {
        updateTrackerItem(t.taskId, t.jobs, t.status, null, t.mrTitle);
        pollTaskStatus(t.taskId, t.jobs, t.mrTitle);
      });
    });
  }

  function pollTaskStatus(taskId, jobNames, mrTitle) {
    var interval = setInterval(function() {
      chrome.runtime.sendMessage({ type: 'get-task-status', taskId: taskId }, function(resp) {
        if (chrome.runtime.lastError || !resp || resp.status === 'not_found') {
          clearInterval(interval);
          return;
        }
        updateTrackerItem(taskId, jobNames, resp.status, resp.error, mrTitle);
        if (resp.status === 'done' || resp.status === 'error') {
          clearInterval(interval);
        }
      });
    }, 10000);
  }

  // =========================================================================
  // Message listener
  // =========================================================================

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    // Skip api-proxy if full content.js loaded (it handles this)
    if (msg.type === 'api-proxy' && !window.__glMrActionsLoaded) {
      api(msg.method, msg.path, msg.body)
        .then(function(data) { sendResponse(data); })
        .catch(function(err) { sendResponse({ _error: err.message }); });
      return true;
    }
    // Skip tracker updates if full content.js handles them
    if (window.__glMrActionsLoaded) return;
    if (msg.type === 'task-result') {
      if (msg.success) {
        updateTrackerItem(msg.taskId, msg.jobs || [], 'done', null, msg.mrTitle);
      } else {
        updateTrackerItem(msg.taskId, msg.jobs || [], 'error', msg.message, msg.mrTitle);
      }
    }
    if (msg.type === 'task-progress') {
      updateTrackerItem(msg.taskId, msg.jobs, msg.status, null, msg.mrTitle);
    }
  });

  // Only restore if full content.js isn't loaded (it does its own restore)
  if (!window.__glMrActionsLoaded) {
    restoreActiveTasks();
  }

  // =========================================================================
  // MR list page enhancements: dim drafts, highlight own MRs
  // =========================================================================

  function isMrListPage() {
    return /\/-\/merge_requests\/?(\?|$)/.test(window.location.pathname + window.location.search);
  }

  function getCurrentUsername() {
    var cacheKey = '_gl_mr_ext_username_' + GITLAB_URL;
    return new Promise(function(resolve) {
      // Check cache first
      chrome.storage.local.get(cacheKey, function(data) {
        if (chrome.runtime.lastError) { /* ignore */ }
        if (data && data[cacheKey]) { resolve(data[cacheKey]); return; }
        // Fetch from API
        api('GET', '/user').then(function(user) {
          if (user && user.username) {
            var toStore = {};
            toStore[cacheKey] = user.username;
            chrome.storage.local.set(toStore);
            resolve(user.username);
          } else {
            resolve(null);
          }
        }).catch(function() { resolve(null); });
      });
    });
  }

  function applyMrListEnhancements(settings, username) {
    var mrItems = document.querySelectorAll('.merge-request, li.issue, [data-testid="issuable-container"] > li, .issuable-list > li');
    if (!mrItems.length) return;

    mrItems.forEach(function(item) {
      if (item.dataset.glMrEnhanced) return;
      item.dataset.glMrEnhanced = '1';

      // Dim drafts
      if (settings.dim_drafts) {
        var titleEl = item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
        if (titleEl) {
          var title = titleEl.textContent.trim();
          if (/^(\[Draft\]|Draft:|WIP:)/i.test(title)) {
            item.classList.add('gl-mr-ext-dimmed');
          }
        }
      }

      // Highlight own MRs
      if (settings.highlight_own_mrs && username) {
        var authorLink = item.querySelector('.issuable-authored a.author-link, .author a, [data-testid="issuable-author"] a');
        if (authorLink) {
          var href = authorLink.getAttribute('href') || '';
          if (href.endsWith('/' + username)) {
            item.classList.add('gl-mr-ext-own');
          }
        }
      }

      // Copy MR button in controls bar
      if (settings.show_copy_mr) {
        var copyTitleEl = item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
        var controlsUl = item.querySelector('ul.controls');
        if (copyTitleEl && controlsUl) {
          var li = document.createElement('li');
          li.className = 'gl-block has-tooltip !gl-mr-0 gl-mr-ext-copy-li';
          li.title = msg('btnCopyMr');
          li.innerHTML = '<svg class="gl-align-middle gl-mr-ext-copy-icon" width="22" height="22" viewBox="0 0 16 16"><path fill="currentColor" d="M10.5 2H5.5A1.5 1.5 0 004 3.5V4H3.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h5a1.5 1.5 0 001.5-1.5V12h.5a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0010.5 2zM9 12.5a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5H4v5.5A1.5 1.5 0 005.5 12H9v.5zm2-2a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5h5a.5.5 0 01.5.5v7z"/></svg>';
          li.style.cursor = 'pointer';
          li.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var mrTitle = copyTitleEl.textContent.trim();
            var mrUrl = copyTitleEl.href;
            navigator.clipboard.writeText(mrTitle + '\n' + mrUrl).then(function() {
              li.querySelector('svg').style.color = '#108548';
              setTimeout(function() {
                li.querySelector('svg').style.color = '';
              }, 1500);
            });
          });
          var lastLi = controlsUl.lastElementChild;
          controlsUl.appendChild(li);
          if (lastLi) lastLi.style.marginRight = '0';
        }
      }
    });
  }

  // =========================================================================
  // MR list toolbar: "Only mine" toggle
  // =========================================================================

  function msg(key) {
    try { return chrome.i18n.getMessage(key) || key; } catch(e) { return key; }
  }

  function isFilteredBy(param, value) {
    return new URL(window.location.href).searchParams.get(param) === value;
  }

  function toggleUrlParam(param, value) {
    var url = new URL(window.location.href);
    if (url.searchParams.get(param) === value) {
      url.searchParams.delete(param);
    } else {
      url.searchParams.set(param, value);
      url.searchParams.delete('page');
    }
    window.location.href = url.toString();
  }

  function injectListToggles(username, settings) {
    if (document.querySelector('.gl-mr-ext-toolbar')) return;

    var container = document.querySelector('.filter-dropdown-container');
    if (!container) return;

    if (settings.show_only_mine && username) {
      var btnMine = document.createElement('button');
      btnMine.className = 'gl-mr-ext-toggle btn btn-md btn-default gl-button';
      btnMine.textContent = msg('toggleOnlyMine');
      if (isFilteredBy('author_username', username)) {
        btnMine.classList.add('active');
      }
      btnMine.addEventListener('click', function() {
        toggleUrlParam('author_username', username);
      });
      container.appendChild(btnMine);
    }

    if (settings.show_needs_review && username) {
      var btnReview = document.createElement('button');
      btnReview.className = 'gl-mr-ext-toggle btn btn-md btn-default gl-button';
      btnReview.textContent = msg('toggleNeedsReview');
      if (isFilteredBy('reviewer_username', username)) {
        btnReview.classList.add('active');
      }
      btnReview.addEventListener('click', function() {
        toggleUrlParam('reviewer_username', username);
      });
      container.appendChild(btnReview);
    }
  }

  // =========================================================================
  // Jira ticket status badges on MR list
  // =========================================================================

  var _jiraCache = {}; // { ticket: { name, categoryKey, ts } }
  var JIRA_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
  var _jiraFetching = false;
  var _jiraRenderingBadges = false;
  var _jiraUrlStored = '';
  var _skipConfirmations = false;

  var _jiraTicketRegex = /[A-Z][A-Z0-9]+-\d+/g;

  function setJiraTicketRegex(pattern) {
    if (pattern) {
      try { _jiraTicketRegex = new RegExp(pattern, 'g'); } catch(e) { /* keep default */ }
    }
  }

  function parseTickets(title) {
    _jiraTicketRegex.lastIndex = 0;
    var m = title.match(_jiraTicketRegex);
    return m ? m : [];
  }

  function getJiraCategoryClass(categoryKey, name) {
    var lower = name.toLowerCase();
    if (lower.includes('qa')) return 'jira-qa';
    if (lower.includes('in review')) return 'jira-default';
    if (categoryKey === 'done') return 'jira-done';
    if (categoryKey === 'new') return 'jira-new';
    if (categoryKey === 'indeterminate' || lower.includes('in ')) return 'jira-progress';

    return 'jira-new';
  }

  function renderJiraLoaders(itemTicketMap) {
    itemTicketMap.forEach(function(entry) {
      if (entry.item.querySelector('.gl-jira-badge')) return; // already has badges
      var titleEl = entry.item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
      if (!titleEl) return;
      var titleContainer = titleEl.closest('.merge-request-title-text, .issue-title-text, [data-testid="issuable-title"]') || titleEl.parentNode;
      if (titleContainer.querySelector('.gl-jira-loader')) return; // already has loader
      var loader = document.createElement('span');
      loader.className = 'gl-jira-loader';
      titleContainer.appendChild(loader);
    });
  }

  function removeJiraLoaders() {
    var loaders = document.querySelectorAll('.gl-jira-loader');
    loaders.forEach(function(el) { el.remove(); });
  }

  function renderJiraBadges(mrItem, statuses) {
    var titleEl = mrItem.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
    if (!titleEl) return;

    var title = titleEl.textContent.trim();
    var tickets = parseTickets(title);
    if (!tickets.length) return;

    var titleContainer = titleEl.closest('.merge-request-title-text, .issue-title-text, [data-testid="issuable-title"]') || titleEl.parentNode;

    // Build expected badge key to avoid redundant re-renders
    var badgeKey = tickets.map(function(t) {
      var s = statuses[t];
      return s ? t + ':' + s.name + ':' + (s.type || '') + ':' + (s.priority || '') + ':' + (_showJiraDetails ? '1' : '0') : '';
    }).join(',');

    if (mrItem.dataset.glJiraBadges === badgeKey) return;
    mrItem.dataset.glJiraBadges = badgeKey;

    // Remove old badges and icons
    var old = mrItem.querySelectorAll('.gl-jira-badge, .gl-jira-list-icon, .gl-jira-ticket-group, .gl-jira-ticket-sep');
    old.forEach(function(el) { el.remove(); });

    tickets.forEach(function(ticket, idx) {
      var status = statuses[ticket];
      if (!status) return;

      // Separator between ticket groups
      if (idx > 0) {
        var sep = document.createElement('span');
        sep.className = 'gl-jira-ticket-sep';
        titleContainer.appendChild(sep);
      }

      // Group wrapper for this ticket
      var group = document.createElement('span');
      group.className = 'gl-jira-ticket-group';

      // Type & priority icons (before status badge)
      if (_showJiraDetails) {
        if (status.typeIcon) {
          var typeEl = document.createElement('img');
          typeEl.className = 'gl-jira-list-icon';
          typeEl.src = status.typeIcon;
          typeEl.title = status.type || '';
          group.appendChild(typeEl);
        }
        if (status.priorityIcon) {
          var prioEl = document.createElement('img');
          prioEl.className = 'gl-jira-list-icon';
          prioEl.src = status.priorityIcon;
          prioEl.title = status.priority || '';
          group.appendChild(prioEl);
        }
      }

      var badge = document.createElement('span');
      badge.className = 'gl-jira-badge ' + getJiraCategoryClass(status.categoryKey, status.name);
      badge.textContent = status.name;
      badge.title = ticket + ': ' + status.name;
      badge.style.cursor = 'pointer';
      badge.dataset.jiraTicket = ticket;
      badge.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openJiraSidebar(ticket, _jiraUrlStored);
      });
      group.appendChild(badge);

      titleContainer.appendChild(group);
    });
  }

  // ── Jira sidebar ──────────────────────────────────────────────────
  function openJiraSidebar(ticket, jiraUrl) {
    // Remove existing sidebar
    var existing = document.querySelector('.gl-jira-sidebar');
    var reuse = false;
    if (existing) {
      if (existing.dataset.ticket === ticket) {
        existing.classList.add('gl-jira-sidebar-closing');
        existing.addEventListener('animationend', function() { existing.remove(); });
        return;
      }
      // Reuse existing sidebar — just swap content, no animation
      reuse = true;
      existing.dataset.ticket = ticket;
      var ticketLink = existing.querySelector('.gl-jira-sidebar-header .gfm-issue');
      if (ticketLink) {
        ticketLink.textContent = ticket;
        ticketLink.href = _jiraUrlStored + '/browse/' + ticket;
      }
      existing.querySelector('.gl-jira-sidebar-body').innerHTML =
        '<div class="gl-jira-sidebar-loading"><div class="gl-jira-sidebar-spinner"></div></div>';
    }

    var sidebar = reuse ? existing : document.createElement('div');
    if (!reuse) {
      sidebar.className = 'gl-jira-sidebar';
      sidebar.dataset.ticket = ticket;
      sidebar.innerHTML =
        '<div class="gl-jira-sidebar-header">' +
          '<a href="' + escHtml(jiraUrl + '/browse/' + ticket) + '" target="_blank" class="gfm gfm-issue">' + escHtml(ticket) + '</a>' +
          '<button class="gl-jira-sidebar-close" title="Close">&times;</button>' +
        '</div>' +
        '<div class="gl-jira-sidebar-body">' +
          '<div class="gl-jira-sidebar-loading"><div class="gl-jira-sidebar-spinner"></div></div>' +
        '</div>';
      document.body.appendChild(sidebar);
    }

    function closeSidebar() {
      sidebar.classList.add('gl-jira-sidebar-closing');
      sidebar.addEventListener('animationend', function() { sidebar.remove(); });
      document.removeEventListener('keydown', onEsc);
    }

    // Close button
    sidebar.querySelector('.gl-jira-sidebar-close').addEventListener('click', closeSidebar);

    // Close on Escape — lightbox first, then sidebar
    function onEsc(e) {
      if (e.key === 'Escape') {
        var lightbox = document.querySelector('.gl-jira-lightbox');
        if (lightbox) {
          closeLightbox(lightbox);
          return;
        }
        closeSidebar();
      }
    }
    document.addEventListener('keydown', onEsc);

    // Delegate click on images to open lightbox
    sidebar.addEventListener('click', function(e) {
      var img = e.target.closest('.gl-jira-sidebar-img');
      if (img) {
        openJiraLightbox(img.src, 'image');
        return;
      }
      var media = e.target.closest('.gl-jira-sidebar-attach-media');
      if (media) {
        e.preventDefault();
        openJiraLightbox(media.dataset.url, media.dataset.type);
      }
    });

    // Fetch full issue data
    chrome.runtime.sendMessage({
      type: 'fetch-jira-issue',
      jiraUrl: jiraUrl,
      ticket: ticket
    }, function(resp) {
      if (!resp || resp._error) {
        sidebar.querySelector('.gl-jira-sidebar-body').innerHTML =
          '<div class="gl-jira-sidebar-error">' + escHtml(resp ? resp._error : 'No response') + '</div>';
        return;
      }
      renderJiraSidebarContent(sidebar, resp, jiraUrl);
      chrome.storage.sync.get({ jiraQuickActions: [] }, function(s) {
        loadJiraTransitions(sidebar, resp.key, jiraUrl, s.jiraQuickActions || []);
      });
      initAssigneeEditor(sidebar, resp.key, jiraUrl);
    });
  }

  function loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions) {
    chrome.runtime.sendMessage({
      type: 'fetch-jira-transitions',
      jiraUrl: jiraUrl,
      ticket: ticket
    }, function(resp) {
      var container = sidebar.querySelector('#gl-jira-sidebar-transitions');
      if (!container || !resp || resp._error) return;

      var transitions = resp.transitions || [];
      var transitionMap = {};
      transitions.forEach(function(t) {
        transitionMap[(t.statusName || t.name).toLowerCase()] = t;
      });

      // Render individual transition buttons
      var html = transitions.map(function(t) {
        var cls = getJiraCategoryClass(t.statusCategoryKey, t.statusName || t.name);
        return '<button class="gl-jira-sidebar-transition gl-jira-badge ' + cls + '" data-id="' + escHtml(t.id) + '" data-name="' + escHtml(t.statusName || t.name) + '" data-category="' + escHtml(t.statusCategoryKey) + '">' +
          '&#8594; ' + escHtml(t.statusName || t.name) +
        '</button>';
      }).join('');

      // Render quick action buttons (only if matching transition is available)
      if (quickActions && quickActions.length) {
        var qaHtml = '';
        quickActions.forEach(function(qa) {
          var matchedTransition = qa.status ? transitionMap[qa.status.toLowerCase()] : null;
          // Show quick action if: has matching transition OR only has assignee (no status change needed)
          if (matchedTransition || (!qa.status && qa.assignee)) {
            qaHtml += '<button class="gl-jira-sidebar-quick-action" ' +
              'data-transition-id="' + (matchedTransition ? escHtml(matchedTransition.id) : '') + '" ' +
              'data-status-name="' + (matchedTransition ? escHtml(matchedTransition.statusName || matchedTransition.name) : '') + '" ' +
              'data-status-category="' + (matchedTransition ? escHtml(matchedTransition.statusCategoryKey) : '') + '" ' +
              'data-assignee="' + escHtml(qa.assignee || '') + '">' +
              '&#9889; ' + escHtml(qa.label) +
            '</button>';
          }
        });
        if (qaHtml) {
          html += '<div class="gl-jira-sidebar-qa-sep"></div>' + qaHtml;
        }
      }

      container.innerHTML = html;

      // Transition click handler
      container.addEventListener('click', function(e) {
        var quickBtn = e.target.closest('.gl-jira-sidebar-quick-action');
        if (quickBtn && !quickBtn.disabled) {
          executeQuickAction(sidebar, quickBtn, ticket, jiraUrl, quickActions);
          return;
        }

        var btn = e.target.closest('.gl-jira-sidebar-transition');
        if (!btn || btn.disabled) return;

        if (!_skipConfirmations && !confirm(btn.dataset.name + '?')) return;

        disableAllTransitionBtns(container);
        btn.style.opacity = '1';
        btn.textContent = '...';

        doTransition(sidebar, ticket, jiraUrl, btn.dataset.id, btn.dataset.name, btn.dataset.category, quickActions);
      });
    });
  }

  function disableAllTransitionBtns(container) {
    container.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });
  }

  function updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey) {
    var statusBadge = sidebar.querySelector('#gl-jira-sidebar-status');
    if (statusBadge) {
      var cls = getJiraCategoryClass(categoryKey, statusName);
      statusBadge.className = 'gl-jira-badge ' + cls;
      statusBadge.textContent = statusName;
    }
    delete _jiraCache[ticket];
    var cls2 = getJiraCategoryClass(categoryKey, statusName);
    document.querySelectorAll('.gl-jira-badge[data-jira-ticket="' + ticket + '"]').forEach(function(b) {
      b.className = 'gl-jira-badge ' + cls2;
      b.textContent = statusName;
      b.title = ticket + ': ' + statusName;
    });
  }

  function doTransition(sidebar, ticket, jiraUrl, transitionId, statusName, categoryKey, quickActions) {
    chrome.runtime.sendMessage({
      type: 'do-jira-transition',
      jiraUrl: jiraUrl,
      ticket: ticket,
      transitionId: transitionId
    }, function(result) {
      if (result && result.success) {
        updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey);
        loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
      } else {
        var container = sidebar.querySelector('#gl-jira-sidebar-transitions');
        if (container) container.querySelectorAll('button').forEach(function(b) { b.disabled = false; b.style.opacity = '1'; });
      }
    });
  }

  function executeQuickAction(sidebar, btn, ticket, jiraUrl, quickActions) {
    var transitionId = btn.dataset.transitionId;
    var statusName = btn.dataset.statusName;
    var categoryKey = btn.dataset.statusCategory;
    var assignee = btn.dataset.assignee;

    var container = sidebar.querySelector('#gl-jira-sidebar-transitions');
    disableAllTransitionBtns(container);
    btn.style.opacity = '1';
    btn.textContent = '...';

    var steps = [];
    if (transitionId) {
      steps.push(function(cb) {
        chrome.runtime.sendMessage({
          type: 'do-jira-transition', jiraUrl: jiraUrl, ticket: ticket, transitionId: transitionId
        }, function(r) { cb(r && r.success); });
      });
    }
    if (assignee) {
      steps.push(function(cb) {
        chrome.runtime.sendMessage({
          type: 'set-jira-assignee', jiraUrl: jiraUrl, ticket: ticket, username: assignee
        }, function(r) { cb(r && r.success); });
      });
    }

    function runStep(i) {
      if (i >= steps.length) {
        // All done — update UI
        if (statusName) updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey);
        if (assignee) {
          var assigneeEl = sidebar.querySelector('#gl-jira-sidebar-assignee');
          if (assigneeEl) assigneeEl.innerHTML = escHtml(assignee) + ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
        }
        loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
        return;
      }
      steps[i](function(ok) {
        if (ok) { runStep(i + 1); }
        else { container.querySelectorAll('button').forEach(function(b) { b.disabled = false; b.style.opacity = '1'; }); }
      });
    }
    runStep(0);
  }

  function initAssigneeEditor(sidebar, ticket, jiraUrl) {
    var assigneeEl = sidebar.querySelector('#gl-jira-sidebar-assignee');
    var searchBox = sidebar.querySelector('#gl-jira-sidebar-assignee-search');
    var input = searchBox.querySelector('.gl-jira-sidebar-assignee-input');
    var resultsEl = searchBox.querySelector('.gl-jira-sidebar-assignee-results');
    var searchTimer = null;

    assigneeEl.addEventListener('click', function() {
      var isOpen = searchBox.style.display !== 'none';
      searchBox.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        input.value = '';
        resultsEl.innerHTML = '';
        input.focus();
      }
    });

    // Unassign button
    searchBox.querySelector('.gl-jira-sidebar-unassign').addEventListener('click', function(e) {
      e.stopPropagation();
      chrome.runtime.sendMessage({
        type: 'set-jira-assignee',
        jiraUrl: jiraUrl,
        ticket: ticket,
        username: null
      }, function(result) {
        if (result && result.success) {
          assigneeEl.innerHTML = '<span style="opacity:0.5">' + escHtml(chrome.i18n.getMessage('jiraSidebarUnassigned') || 'Unassigned') + '</span>' +
            ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
          searchBox.style.display = 'none';
        }
      });
    });

    input.addEventListener('input', function() {
      var query = input.value.trim();
      clearTimeout(searchTimer);
      if (query.length < 2) { resultsEl.innerHTML = ''; return; }
      searchTimer = setTimeout(function() {
        resultsEl.innerHTML = '<div class="gl-jira-sidebar-assignee-loading">...</div>';
        chrome.runtime.sendMessage({
          type: 'search-jira-assignable',
          jiraUrl: jiraUrl,
          ticket: ticket,
          query: query
        }, function(resp) {
          if (!resp || resp._error || !resp.users) {
            resultsEl.innerHTML = '';
            return;
          }
          if (!resp.users.length) {
            resultsEl.innerHTML = '<div class="gl-jira-sidebar-assignee-empty">' +
              escHtml(chrome.i18n.getMessage('jiraSidebarNoUsers') || 'No users found') + '</div>';
            return;
          }
          resultsEl.innerHTML = resp.users.map(function(u) {
            return '<div class="gl-jira-sidebar-assignee-item" data-key="' + escHtml(u.key) + '" data-name="' + escHtml(u.name) + '">' +
              (u.avatar ? '<img src="' + escHtml(u.avatar) + '" class="gl-jira-sidebar-assignee-avatar">' : '') +
              '<span>' + escHtml(u.name) + '</span>' +
            '</div>';
          }).join('');
        });
      }, 300);
    });

    // Prevent click inside search from closing it
    searchBox.addEventListener('click', function(e) { e.stopPropagation(); });

    resultsEl.addEventListener('click', function(e) {
      var item = e.target.closest('.gl-jira-sidebar-assignee-item');
      if (!item) return;

      var username = item.dataset.key;
      var displayName = item.dataset.name;

      input.disabled = true;
      resultsEl.innerHTML = '<div class="gl-jira-sidebar-assignee-loading">...</div>';

      chrome.runtime.sendMessage({
        type: 'set-jira-assignee',
        jiraUrl: jiraUrl,
        ticket: ticket,
        username: username
      }, function(result) {
        if (result && result.success) {
          assigneeEl.innerHTML = escHtml(displayName) + ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
          searchBox.style.display = 'none';
        }
        input.disabled = false;
      });
    });
  }

  function closeLightbox(el) {
    el.classList.add('gl-jira-lightbox-closing');
    el.addEventListener('animationend', function() { el.remove(); });
  }

  function openJiraLightbox(src, type) {
    var existing = document.querySelector('.gl-jira-lightbox');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'gl-jira-lightbox';
    if (type === 'video') {
      overlay.innerHTML = '<video src="' + escHtml(src) + '" controls autoplay class="gl-jira-lightbox-video"></video>';
    } else {
      overlay.innerHTML = '<img src="' + escHtml(src) + '" class="gl-jira-lightbox-img">';
    }
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeLightbox(overlay);
    });
    document.body.appendChild(overlay);
  }

  function formatJiraDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var now = new Date();
    var diff = now - d;
    var mins = Math.floor(diff / 60000);
    var hours = Math.floor(diff / 3600000);
    var days = Math.floor(diff / 86400000);
    if (mins < 60) return mins + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days < 30) return days + 'd ago';
    return d.toLocaleDateString();
  }

  function renderJiraSidebarContent(sidebar, data, jiraUrl) {
    var statusClass = getJiraCategoryClass(data.statusCategoryKey, data.status);
    var desc = data.description || '';
    var attachments = data.attachments || {};
    // Truncate long descriptions (but keep image markup intact)
    if (desc.length > 3000) desc = desc.substring(0, 3000) + '...';
    // Simple formatting: escape HTML first, then replace wiki markup
    var descHtml = escHtml(desc).replace(/\n/g, '<br>');
    // Replace Jira wiki image markup: !filename|params! or !filename!
    descHtml = descHtml.replace(/!([^|!]+?)(?:\|[^!]*)?\!/g, function(match, filename) {
      var url = attachments[filename];
      if (!url) return match;
      var ext = filename.split('.').pop().toLowerCase();
      if (ext === 'mp4' || ext === 'webm' || ext === 'ogg' || ext === 'mov') {
        return '<video src="' + escHtml(url) + '" controls class="gl-jira-sidebar-video"></video>';
      }
      return '<img src="' + escHtml(url) + '" alt="' + escHtml(filename) + '" class="gl-jira-sidebar-img">';
    });
    // Replace Jira wiki links: [text|url] or [url]
    descHtml = descHtml.replace(/\[([^|\]\n]+)\|([^\]\n]+?)(?:\|[^\]\n]*)?\]/g, function(m, text, url) {
      return '<a href="' + escHtml(url) + '" target="_blank" class="gl-jira-sidebar-inline-link">' + text + '</a>';
    });
    descHtml = descHtml.replace(/\[(https?:\/\/[^\]\n]+)\]/g, function(m, url) {
      return '<a href="' + escHtml(url) + '" target="_blank" class="gl-jira-sidebar-inline-link">' + url + '</a>';
    });
    // Auto-link bare URLs not already inside href or <a> tags
    descHtml = descHtml.replace(/(^|[^"=])(https?:\/\/[^\s<]+)/g, function(m, prefix, url) {
      return prefix + '<a href="' + url + '" target="_blank" class="gl-jira-sidebar-inline-link">' + url + '</a>';
    });

    var rows = '';

    // Status
    rows += '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarStatus') || 'Status') + '</span>' +
      '<span class="gl-jira-badge ' + statusClass + '" id="gl-jira-sidebar-status">' + escHtml(data.status) + '</span>' +
    '</div>' +
    '<div class="gl-jira-sidebar-transitions" id="gl-jira-sidebar-transitions"></div>';

    // Resolution
    if (data.resolution) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarResolution') || 'Resolution') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(data.resolution) + '</span>' +
      '</div>';
    }

    // Type
    if (data.type) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarType') || 'Type') + '</span>' +
        '<span class="gl-jira-sidebar-value"><span class="gl-jira-priority">' + (data.typeIcon ? '<img class="gl-jira-priority-icon" src="' + escHtml(data.typeIcon) + '" alt="">' : '') + escHtml(data.type) + '</span></span>' +
      '</div>';
    }

    // Priority
    if (data.priority) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarPriority') || 'Priority') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + getPriorityHtml(data.priority, data.priorityIcon) + '</span>' +
      '</div>';
    }

    // Assignee (editable)
    rows += '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarAssignee') || 'Assignee') + '</span>' +
      '<span class="gl-jira-sidebar-value gl-jira-sidebar-assignee" id="gl-jira-sidebar-assignee" data-ticket="' + escHtml(data.key) + '">' +
        (data.assignee ? escHtml(data.assignee) : '<span style="opacity:0.5">' + escHtml(chrome.i18n.getMessage('jiraSidebarUnassigned') || 'Unassigned') + '</span>') +
        ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>' +
      '</span>' +
    '</div>' +
    '<div class="gl-jira-sidebar-assignee-search" id="gl-jira-sidebar-assignee-search" style="display:none">' +
      '<div style="display:flex;gap:6px">' +
        '<input type="text" class="gl-jira-sidebar-assignee-input" placeholder="' + escHtml(chrome.i18n.getMessage('jiraSidebarSearchUser') || 'Search user...') + '" style="flex:1">' +
        '<button class="gl-jira-sidebar-unassign" title="' + escHtml(chrome.i18n.getMessage('jiraSidebarUnassign') || 'Unassign') + '">&times;</button>' +
      '</div>' +
      '<div class="gl-jira-sidebar-assignee-results"></div>' +
    '</div>';

    // Reporter
    if (data.reporter) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarReporter') || 'Reporter') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(data.reporter) + '</span>' +
      '</div>';
    }

    // Labels
    if (data.labels && data.labels.length) {
      var labelsHtml = data.labels.map(function(l) {
        return '<span class="gl-jira-sidebar-label-tag">' + escHtml(l) + '</span>';
      }).join(' ');
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarLabels') || 'Labels') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + labelsHtml + '</span>' +
      '</div>';
    }

    // Epic Link
    if (data.epicLink) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarEpic') || 'Epic') + '</span>' +
        '<span class="gl-jira-sidebar-value"><a href="' + escHtml(jiraUrl) + '/browse/' + escHtml(data.epicLink) + '" target="_blank" class="gl-jira-sidebar-inline-link">' + escHtml(data.epicLink) + '</a></span>' +
      '</div>';
    }

    // Sprint
    if (data.sprint) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarSprint') || 'Sprint') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(data.sprint) + '</span>' +
      '</div>';
    }

    // Components
    if (data.components && data.components.length) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarComponents') || 'Components') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + data.components.map(function(c) {
          return '<span class="gl-jira-sidebar-label-tag">' + escHtml(c) + '</span>';
        }).join(' ') + '</span>' +
      '</div>';
    }

    // Affects Versions
    if (data.versions && data.versions.length) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarAffectsVersions') || 'Affects') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + data.versions.map(function(v) {
          return '<span class="gl-jira-sidebar-label-tag">' + escHtml(v) + '</span>';
        }).join(' ') + '</span>' +
      '</div>';
    }

    // Fix Versions
    if (data.fixVersions && data.fixVersions.length) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarFixVersions') || 'Fix ver.') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + data.fixVersions.map(function(v) {
          return '<span class="gl-jira-sidebar-label-tag">' + escHtml(v) + '</span>';
        }).join(' ') + '</span>' +
      '</div>';
    }

    // Created / Updated
    if (data.created) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarCreated') || 'Created') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(formatJiraDate(data.created)) + '</span>' +
      '</div>';
    }
    if (data.updated) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarUpdated') || 'Updated') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(formatJiraDate(data.updated)) + '</span>' +
      '</div>';
    }

    var bodyHtml =
      '<h3 class="gl-jira-sidebar-title">' + escHtml(data.summary) + '</h3>' +
      '<div class="gl-jira-sidebar-fields">' + rows + '</div>';

    // Description
    if (desc) {
      bodyHtml += '<div class="gl-jira-sidebar-sep"></div>' +
        '<div class="gl-jira-sidebar-desc-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarDescription') || 'Description') + '</div>' +
        '<div class="gl-jira-sidebar-desc">' + descHtml + '</div>';
    }

    // Attachments list
    if (data.attachmentList && data.attachmentList.length) {
      bodyHtml += '<div class="gl-jira-sidebar-sep"></div>' +
        '<div class="gl-jira-sidebar-desc-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarAttachments') || 'Attachments') + ' (' + data.attachmentList.length + ')</div>' +
        '<div class="gl-jira-sidebar-attachments">';
      data.attachmentList.forEach(function(a) {
        var ext = a.filename.split('.').pop().toLowerCase();
        var isImage = ['png','jpg','jpeg','gif','bmp','svg','webp'].indexOf(ext) !== -1;
        var isVideo = ['mp4','webm','ogg','mov'].indexOf(ext) !== -1;
        var sizeStr = a.size < 1024 ? a.size + ' B'
          : a.size < 1048576 ? Math.round(a.size / 1024) + ' KB'
          : (a.size / 1048576).toFixed(1) + ' MB';
        if (isImage) {
          bodyHtml += '<div class="gl-jira-sidebar-attach-item gl-jira-sidebar-attach-media" data-url="' + escHtml(a.url) + '" data-type="image">' +
            '<img src="' + escHtml(a.url) + '" class="gl-jira-sidebar-attach-thumb">' +
            '<span class="gl-jira-sidebar-attach-name">' + escHtml(a.filename) + '</span>' +
            '<span class="gl-jira-sidebar-attach-size">' + sizeStr + '</span>' +
          '</div>';
        } else if (isVideo) {
          bodyHtml += '<div class="gl-jira-sidebar-attach-item gl-jira-sidebar-attach-media" data-url="' + escHtml(a.url) + '" data-type="video">' +
            '<span class="gl-jira-sidebar-attach-icon">&#9654;</span>' +
            '<span class="gl-jira-sidebar-attach-name">' + escHtml(a.filename) + '</span>' +
            '<span class="gl-jira-sidebar-attach-size">' + sizeStr + '</span>' +
          '</div>';
        } else {
          bodyHtml += '<a href="' + escHtml(a.url) + '" target="_blank" class="gl-jira-sidebar-attach-item">' +
            '<span class="gl-jira-sidebar-attach-icon">&#128196;</span>' +
            '<span class="gl-jira-sidebar-attach-name">' + escHtml(a.filename) + '</span>' +
            '<span class="gl-jira-sidebar-attach-size">' + sizeStr + '</span>' +
          '</a>';
        }
      });
      bodyHtml += '</div>';
    }


    sidebar.querySelector('.gl-jira-sidebar-body').innerHTML = bodyHtml;
  }
  // ── End Jira sidebar ────────────────────────────────────────────

  var _showJiraDetails = false;

  function fetchAndRenderJiraStatuses(jiraUrl, showDetails) {
    _showJiraDetails = !!showDetails;
    if (_jiraFetching) return;
    _jiraUrlStored = jiraUrl;

    var mrItems = document.querySelectorAll('.merge-request, li.issue, [data-testid="issuable-container"] > li, .issuable-list > li');
    if (!mrItems.length) return;

    // Collect all tickets from all MR titles
    var allTickets = [];
    var itemTicketMap = [];
    mrItems.forEach(function(item) {
      var titleEl = item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
      if (!titleEl) return;
      var tickets = parseTickets(titleEl.textContent.trim());
      if (tickets.length) {
        itemTicketMap.push({ item: item, tickets: tickets });
        tickets.forEach(function(t) {
          if (allTickets.indexOf(t) === -1) allTickets.push(t);
        });
      }
    });

    if (!allTickets.length) return;

    // Check cache, find tickets that need fetching
    var now = Date.now();
    var cachedStatuses = {};
    var ticketsToFetch = [];

    allTickets.forEach(function(t) {
      if (_jiraCache[t] && (now - _jiraCache[t].ts) < JIRA_CACHE_TTL) {
        cachedStatuses[t] = _jiraCache[t];
      } else {
        ticketsToFetch.push(t);
      }
    });

    // Render cached ones immediately (inside flag to suppress observer)
    if (Object.keys(cachedStatuses).length) {
      _jiraRenderingBadges = true;
      itemTicketMap.forEach(function(entry) {
        renderJiraBadges(entry.item, cachedStatuses);
      });
      _jiraRenderingBadges = false;
    }

    if (!ticketsToFetch.length) return;

    // Show loaders for items that don't have badges yet
    _jiraRenderingBadges = true;
    renderJiraLoaders(itemTicketMap);
    _jiraRenderingBadges = false;

    // Fetch remaining from Jira via background
    _jiraFetching = true;
    chrome.runtime.sendMessage({
      type: 'fetch-jira-statuses',
      jiraUrl: jiraUrl,
      tickets: ticketsToFetch,
      showDetails: _showJiraDetails,
    }, function(resp) {
      _jiraFetching = false;
      _jiraRenderingBadges = true;
      removeJiraLoaders();
      _jiraRenderingBadges = false;
      if (chrome.runtime.lastError || !resp || resp._error) return;
      var statuses = resp.statuses || {};

      // Update cache
      var fetchedNow = Date.now();
      for (var t in statuses) {
        _jiraCache[t] = { name: statuses[t].name, categoryKey: statuses[t].categoryKey, priority: statuses[t].priority, priorityIcon: statuses[t].priorityIcon, type: statuses[t].type, typeIcon: statuses[t].typeIcon, ts: fetchedNow };
      }

      // Merge with cached
      var merged = {};
      for (var k in cachedStatuses) merged[k] = cachedStatuses[k];
      for (var k2 in statuses) merged[k2] = statuses[k2];

      _jiraRenderingBadges = true;
      itemTicketMap.forEach(function(entry) {
        renderJiraBadges(entry.item, merged);
      });
      _jiraRenderingBadges = false;
    });
  }

  // =========================================================================
  // Reviewer badge from comments
  // =========================================================================

  var _reviewerCache = {}; // { mrUrl: { isReviewer: bool, ts: number } }
  var REVIEWER_CACHE_TTL = 5 * 60 * 1000;
  var _reviewerFetching = false;

  function parseMrPath(href) {
    var m = href.match(/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
    if (!m) return null;
    return { projectPath: m[1], iid: m[2] };
  }

  function fetchMrNotes(projectPath, iid) {
    var encodedProject = encodeURIComponent(projectPath);
    return api('GET', '/projects/' + encodedProject + '/merge_requests/' + iid + '/notes?per_page=10&sort=asc');
  }

  function checkReviewerInNotes(notes, username) {
    for (var i = 0; i < notes.length; i++) {
      var body = notes[i].body || '';
      if (/reviewers?\s*:/i.test(body) && body.indexOf('@' + username) !== -1) {
        return true;
      }
    }
    return false;
  }

  function renderReviewerBadge(mrItem, isReviewer) {
    if (mrItem.querySelector('.gl-reviewer-badge')) return;
    if (!isReviewer) return;

    var titleEl = mrItem.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
    if (!titleEl) return;
    var titleContainer = titleEl.closest('.merge-request-title-text, .issue-title-text, [data-testid="issuable-title"]') || titleEl.parentNode;

    var badge = document.createElement('span');
    badge.className = 'gl-reviewer-badge';
    badge.textContent = msg('badgeYourReview');
    badge.title = msg('badgeYourReviewHint');
    titleContainer.appendChild(badge);
  }

  function fetchAndRenderReviewerBadges(username) {
    if (_reviewerFetching) return;

    var mrItems = document.querySelectorAll('.merge-request, li.issue, [data-testid="issuable-container"] > li, .issuable-list > li');
    if (!mrItems.length) return;

    var toFetch = [];
    var now = Date.now();

    mrItems.forEach(function(item) {
      var titleEl = item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
      if (!titleEl) return;
      var href = titleEl.href;
      var cached = _reviewerCache[href];
      if (cached && (now - cached.ts) < REVIEWER_CACHE_TTL) {
        _jiraRenderingBadges = true;
        renderReviewerBadge(item, cached.isReviewer);
        _jiraRenderingBadges = false;
        return;
      }
      var parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({ item: item, href: href, projectPath: parsed.projectPath, iid: parsed.iid });
      }
    });

    if (!toFetch.length) return;

    // Show loaders
    _jiraRenderingBadges = true;
    toFetch.forEach(function(entry) {
      if (entry.item.querySelector('.gl-reviewer-badge, .gl-reviewer-loader')) return;
      var titleEl = entry.item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
      if (!titleEl) return;
      var titleContainer = titleEl.closest('.merge-request-title-text, .issue-title-text, [data-testid="issuable-title"]') || titleEl.parentNode;
      var loader = document.createElement('span');
      loader.className = 'gl-reviewer-loader gl-jira-loader';
      titleContainer.appendChild(loader);
    });
    _jiraRenderingBadges = false;

    _reviewerFetching = true;

    function fetchOne(i) {
      if (i >= toFetch.length) {
        _reviewerFetching = false;
        _jiraRenderingBadges = true;
        var loaders = document.querySelectorAll('.gl-reviewer-loader');
        loaders.forEach(function(el) { el.remove(); });
        _jiraRenderingBadges = false;
        return;
      }
      var entry = toFetch[i];
      fetchMrNotes(entry.projectPath, entry.iid)
        .then(function(notes) {
          var isReviewer = checkReviewerInNotes(notes || [], username);
          _reviewerCache[entry.href] = { isReviewer: isReviewer, ts: Date.now() };
          _jiraRenderingBadges = true;
          renderReviewerBadge(entry.item, isReviewer);
          _jiraRenderingBadges = false;
        })
        .catch(function() {})
        .then(function() { fetchOne(i + 1); });
    }

    fetchOne(0);
  }

  // =========================================================================
  // Unresolved threads count (#26) + MR size labels (#27)
  // =========================================================================

  var _mrMetaCache = {}; // { href: { threads, changes, ts } }
  var MR_META_CACHE_TTL = 5 * 60 * 1000;
  var _mrMetaFetching = false;

  function renderThreadsBadge(mrItem, count) {
    if (mrItem.querySelector('.gl-mr-ext-threads-badge')) return;
    if (count === 0) return;

    var controlsUl = mrItem.querySelector('ul.controls');
    if (!controlsUl) return;

    var li = document.createElement('li');
    li.className = 'gl-mr-ext-threads-badge';
    li.title = count + ' unresolved thread' + (count === 1 ? '' : 's');
    li.innerHTML = '<svg viewBox="0 0 16 16" class="s16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.75 1.75h10.5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H8.56l-3.4 3.4a.25.25 0 0 1-.43-.18V10.75H2.75c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1Z"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="7.5" x2="9" y2="7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
      '<span>' + count + '</span>';

    // Insert after comments icon if found, otherwise prepend to controls
    var commentsEl = mrItem.querySelector('[data-testid="issuable-comments"]');
    var commentsLi = commentsEl ? commentsEl.closest('li') : null;
    if (commentsLi && commentsLi.nextSibling) {
      controlsUl.insertBefore(li, commentsLi.nextSibling);
    } else if (commentsLi) {
      controlsUl.appendChild(li);
    } else {
      controlsUl.insertBefore(li, controlsUl.firstChild);
    }
  }

  function renderSizeBadge(mrItem, changesLines, changesFiles) {
    if (mrItem.querySelector('.gl-mr-ext-size-badge')) return;
    var titleEl = mrItem.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
    if (!titleEl) return;
    var titleContainer = titleEl.closest('.merge-request-title-text, .issue-title-text, [data-testid="issuable-title"]') || titleEl.parentNode;

    var label, cls, tooltip;
    if (changesLines > 0) {
      // Size by lines changed
      if (changesLines <= 50) { label = 'S'; cls = 'size-s'; }
      else if (changesLines <= 200) { label = 'M'; cls = 'size-m'; }
      else if (changesLines <= 500) { label = 'L'; cls = 'size-l'; }
      else { label = 'XL'; cls = 'size-xl'; }
      tooltip = changesLines + ' lines, ' + changesFiles + ' files';
    } else {
      // Fallback: size by files changed
      if (changesFiles <= 5) { label = 'S'; cls = 'size-s'; }
      else if (changesFiles <= 15) { label = 'M'; cls = 'size-m'; }
      else if (changesFiles <= 30) { label = 'L'; cls = 'size-l'; }
      else { label = 'XL'; cls = 'size-xl'; }
      tooltip = changesFiles + ' files changed';
    }

    var badge = document.createElement('span');
    badge.className = 'gl-mr-ext-size-badge ' + cls;
    badge.textContent = label;
    badge.title = tooltip;
    // Always insert right after the title link, before Jira badges
    var firstAfterTitle = titleEl.nextSibling;
    if (firstAfterTitle) {
      titleContainer.insertBefore(badge, firstAfterTitle);
    } else {
      titleContainer.appendChild(badge);
    }
  }

  function renderConflictBadge(mrItem) {
    if (mrItem.querySelector('.gl-mr-ext-conflict-badge')) return;
    var titleEl = mrItem.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
    if (!titleEl) return;
    var titleContainer = titleEl.closest('.merge-request-title-text, .issue-title-text, [data-testid="issuable-title"]') || titleEl.parentNode;
    var badge = document.createElement('span');
    badge.className = 'gl-mr-ext-conflict-badge';
    badge.title = msg('conflictsBadgeHint') || 'This merge request has conflicts';
    badge.textContent = msg('conflictsBadge') || 'CONFLICTS';
    // Insert right after size badge, or after title link
    var sizeBadge = mrItem.querySelector('.gl-mr-ext-size-badge');
    var insertAfter = sizeBadge || titleEl;
    if (insertAfter.nextSibling) {
      titleContainer.insertBefore(badge, insertAfter.nextSibling);
    } else {
      titleContainer.appendChild(badge);
    }
  }

  function fetchAndRenderMrMeta(showThreads, showSize, showConflicts) {
    if (_mrMetaFetching) return;

    var mrItems = document.querySelectorAll('.merge-request, li.issue, [data-testid="issuable-container"] > li, .issuable-list > li');
    if (!mrItems.length) return;

    var toFetch = [];
    var now = Date.now();

    mrItems.forEach(function(item) {
      var titleEl = item.querySelector('.merge-request-title-text a, .issue-title-text a, [data-testid="issuable-title"] a');
      if (!titleEl) return;
      var href = titleEl.href;
      var cached = _mrMetaCache[href];
      if (cached && (now - cached.ts) < MR_META_CACHE_TTL) {
        _jiraRenderingBadges = true;
        if (showThreads) renderThreadsBadge(item, cached.threads);
        if (showSize) renderSizeBadge(item, cached.changesLines, cached.changesFiles);
        if (showConflicts && cached.conflicts) renderConflictBadge(item);
        _jiraRenderingBadges = false;
        return;
      }
      var parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({ item: item, href: href, projectPath: parsed.projectPath, iid: parsed.iid });
      }
    });

    if (!toFetch.length) return;
    _mrMetaFetching = true;

    var BATCH_SIZE = 5;

    function fetchOneEntry(entry) {
      var encodedPath = encodeURIComponent(entry.projectPath);
      return api('GET', '/projects/' + encodedPath + '/merge_requests/' + entry.iid + '?include_rebase_in_progress=false')
        .then(function(mr) {
          var changesLines = (mr.additions !== undefined && mr.deletions !== undefined)
            ? (parseInt(mr.additions) || 0) + (parseInt(mr.deletions) || 0)
            : 0;
          var changesFiles = mr.changes_count ? parseInt(mr.changes_count) : 0;
          var conflicts = !!mr.has_conflicts;
          if (showThreads) {
            return api('GET', '/projects/' + encodedPath + '/merge_requests/' + entry.iid + '/discussions?per_page=100')
              .then(function(discussions) {
                var unresolvedCount = 0;
                (discussions || []).forEach(function(d) {
                  if (d.notes && d.notes.length && d.notes[0].resolvable && !d.notes[0].resolved) {
                    unresolvedCount++;
                  }
                });
                return { threads: unresolvedCount, changesLines: changesLines, changesFiles: changesFiles, conflicts: conflicts };
              });
          }
          return { threads: 0, changesLines: changesLines, changesFiles: changesFiles, conflicts: conflicts };
        })
        .then(function(meta) {
          _mrMetaCache[entry.href] = { threads: meta.threads, changesLines: meta.changesLines, changesFiles: meta.changesFiles, conflicts: meta.conflicts, ts: Date.now() };
          _jiraRenderingBadges = true;
          if (showThreads) renderThreadsBadge(entry.item, meta.threads);
          if (showSize) renderSizeBadge(entry.item, meta.changesLines, meta.changesFiles);
          if (showConflicts && meta.conflicts) renderConflictBadge(entry.item);
          _jiraRenderingBadges = false;
        })
        .catch(function() {});
    }

    function fetchBatch(start) {
      if (start >= toFetch.length) {
        _mrMetaFetching = false;
        return;
      }
      var batch = toFetch.slice(start, start + BATCH_SIZE);
      Promise.all(batch.map(fetchOneEntry)).then(function() {
        fetchBatch(start + BATCH_SIZE);
      });
    }

    fetchBatch(0);
  }

  // =========================================================================
  // Init MR list features
  // =========================================================================

  if (isMrListPage()) {
    var listDefaults = { dim_drafts: false, highlight_own_mrs: false, show_only_mine: false, show_needs_review: false, show_copy_mr: false, show_reviewer_badge: false, show_threads_badge: false, show_size_badge: false, show_conflicts_badge: false, show_jira_details: false, skip_confirmations: false, jira_url: '', jira_ticket_regex: '' };
    try {
      chrome.storage.sync.get(listDefaults, function(s) {
        if (chrome.runtime.lastError) return;
        _skipConfirmations = !!s.skip_confirmations;

        var needsUsername = s.highlight_own_mrs || s.show_only_mine || s.show_needs_review || s.show_reviewer_badge;
        var usernamePromise = needsUsername ? getCurrentUsername() : Promise.resolve(null);

        usernamePromise.then(function(username) {
          if (s.dim_drafts || s.highlight_own_mrs || s.show_copy_mr) {
            applyMrListEnhancements(s, username);
          }

          if (s.show_only_mine || s.show_needs_review) {
            injectListToggles(username, s);
          }

          // Reviewer badge from comments
          if (s.show_reviewer_badge && username) {
            fetchAndRenderReviewerBadges(username);
          }

          // Unresolved threads + MR size + conflict badges
          if (s.show_threads_badge || s.show_size_badge || s.show_conflicts_badge) {
            fetchAndRenderMrMeta(s.show_threads_badge, s.show_size_badge, s.show_conflicts_badge);
          }

          // Jira statuses
          if (s.jira_url) {
            setJiraTicketRegex(s.jira_ticket_regex);
            fetchAndRenderJiraStatuses(s.jira_url, s.show_jira_details);
          }

          // Re-run on dynamic content (Vue list updates)
          var _observerTimer = null;
          var _enhanceTimer = null;
          var listObserver = new MutationObserver(function() {
            if (_jiraRenderingBadges) return;

            if (s.dim_drafts || s.highlight_own_mrs || s.show_copy_mr) {
              clearTimeout(_enhanceTimer);
              _enhanceTimer = setTimeout(function() {
                applyMrListEnhancements(s, username);
              }, 200);
            }
            clearTimeout(_observerTimer);
            _observerTimer = setTimeout(function() {
              if (s.jira_url) fetchAndRenderJiraStatuses(s.jira_url, s.show_jira_details);
              if (s.show_reviewer_badge && username) fetchAndRenderReviewerBadges(username);
              if (s.show_threads_badge || s.show_size_badge || s.show_conflicts_badge) fetchAndRenderMrMeta(s.show_threads_badge, s.show_size_badge, s.show_conflicts_badge);
            }, 1000);
          });
          var listContainer = document.querySelector('.issuable-list, .merge-requests-holder, [data-testid="issuable-list"], .content-list');
          if (listContainer) {
            listObserver.observe(listContainer, { childList: true, subtree: true });
          }
          window.addEventListener('beforeunload', function() { listObserver.disconnect(); });
        });
      });
    } catch(e) {}
  }

  // =========================================================================
  // MR detail page: Jira badges in title
  // =========================================================================

  if (_isMrDetailPage) {
    try {
      chrome.storage.sync.get({ jira_url: '', jira_ticket_regex: '', show_jira_details: false, skip_confirmations: false }, function(s) {
        if (chrome.runtime.lastError || !s.jira_url) return;
        _jiraUrlStored = s.jira_url;
        _showJiraDetails = !!s.show_jira_details;
        _skipConfirmations = !!s.skip_confirmations;
        setJiraTicketRegex(s.jira_ticket_regex);
        injectMrDetailJiraBadges(s.jira_url);
      });
    } catch(e) {}
  }

  function injectMrDetailJiraBadges(jiraUrl) {
    var titleEl = document.querySelector('.title-container .title, .detail-page-header .title, [data-testid="title-content"]');
    if (!titleEl) {
      // SPA — retry after short delay
      setTimeout(function() { injectMrDetailJiraBadges(jiraUrl); }, 1000);
      return;
    }
    if (titleEl.querySelector('.gl-jira-badge')) return;

    var text = titleEl.textContent.trim();
    _jiraTicketRegex.lastIndex = 0;
    var tickets = text.match(_jiraTicketRegex);
    if (!tickets || !tickets.length) return;

    // Fetch statuses and render badges
    chrome.runtime.sendMessage({
      type: 'fetch-jira-statuses',
      jiraUrl: jiraUrl,
      tickets: tickets,
      showDetails: _showJiraDetails,
    }, function(resp) {
      if (!resp || resp._error || !resp.statuses) return;
      var statuses = resp.statuses;
      tickets.forEach(function(ticket) {
        var status = statuses[ticket];
        if (!status) return;

        if (_showJiraDetails) {
          if (status.typeIcon) {
            var typeEl = document.createElement('img');
            typeEl.className = 'gl-jira-list-icon';
            typeEl.src = status.typeIcon;
            typeEl.title = status.type || '';
            titleEl.appendChild(typeEl);
          }
          if (status.priorityIcon) {
            var prioEl = document.createElement('img');
            prioEl.className = 'gl-jira-list-icon';
            prioEl.src = status.priorityIcon;
            prioEl.title = status.priority || '';
            titleEl.appendChild(prioEl);
          }
        }

        var badge = document.createElement('span');
        badge.className = 'gl-jira-badge ' + getJiraCategoryClass(status.categoryKey, status.name);
        badge.textContent = status.name;
        badge.title = ticket + ': ' + status.name;
        badge.style.cursor = 'pointer';
        badge.dataset.jiraTicket = ticket;
        badge.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          openJiraSidebar(ticket, jiraUrl);
        });
        titleEl.appendChild(badge);
      });
    });
  }

  // =========================================================================
  // Collapse top bars (#63)
  // =========================================================================

  try {
    chrome.storage.sync.get({ collapse_bars: false }, function(s) {
      if (chrome.runtime.lastError || !s.collapse_bars) return;

      var collapsed = sessionStorage.getItem('gl_mr_ext_bars_collapsed') === '1';

      function applyCollapse(state) {
        document.body.classList.toggle('gl-mr-ext-bars-collapsed', state);
        sessionStorage.setItem('gl_mr_ext_bars_collapsed', state ? '1' : '0');
      }

      function injectCollapseBtn() {
        if (document.querySelector('.gl-mr-ext-collapse-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'gl-mr-ext-collapse-btn';
        btn.title = msg('collapseTopBars');
        btn.innerHTML = '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 10l5-5 5 5"/></svg>';
        btn.addEventListener('click', function() {
          collapsed = !collapsed;
          btn.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : '';
          applyCollapse(collapsed);
        });
        document.body.appendChild(btn);
        applyCollapse(collapsed);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectCollapseBtn);
      } else {
        injectCollapseBtn();
      }
    });
  } catch(e) {}

  // =========================================================================
  // Hide UI sections (#62)
  // =========================================================================

  try {
    chrome.storage.sync.get({ hide_right_sidebar: false }, function(s) {
      if (chrome.runtime.lastError) return;
      if (s.hide_right_sidebar) document.body.classList.add('gl-mr-ext-hide-right-sidebar');
    });
  } catch(e) {}

})();
