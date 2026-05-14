'use strict';

// Background service worker handles long-running job chains
// that survive page navigation.
// API calls are proxied through content scripts (they have session cookies).

var tasks = {};

// =========================================================================
// First install — set smart defaults
// =========================================================================

chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    // Enable useful buttons by default for new users
    var smartDefaults = {
      btn_rebase_automerge: true,
      btn_pipeline_restart: true,
      btn_pipeline_cancel: true,
      btn_draft_toggle: true,
      btn_retry_failed: true,
      sound_enabled: true,
    };
    chrome.storage.sync.set(smartDefaults);

    // Open welcome page
    chrome.tabs.create({ url: 'welcome.html' });
  }
});

// =========================================================================
// API proxy — relay calls through content script on a GitLab tab
// =========================================================================

function api(task, method, path, body) {
  var msg = { type: 'api-proxy', method: method, path: path, body: body };

  // Try tabs one by one — content script only exists on MR pages
  return chrome.tabs.query({ url: task.gitlabUrl + '/*' }).then(function(tabs) {
    if (!tabs.length) throw new Error('No GitLab tab open — keep at least one GitLab tab open.');

    function tryTab(i) {
      if (i >= tabs.length) throw new Error('No GitLab tab with content script found. Open any MR page.');
      return chrome.tabs.sendMessage(tabs[i].id, msg).then(function(resp) {
        if (resp && resp._error) throw new Error(resp._error);
        return resp;
      }).catch(function(err) {
        // "Could not establish connection" = no content script in this tab
        if (err.message && err.message.indexOf('establish connection') !== -1) {
          return tryTab(i + 1);
        }
        throw err;
      });
    }

    return tryTab(0);
  });
}

// =========================================================================
// Job helpers
// =========================================================================

function findJobByName(task, jobName) {
  return api(task, 'GET', '/projects/' + task.projectId + '/merge_requests/' + task.mrIid + '/pipelines')
    .then(function(pipelines) {
      if (!pipelines.length) return null;
      return api(task, 'GET', '/projects/' + task.projectId + '/pipelines/' + pipelines[0].id + '/jobs?per_page=100');
    })
    .then(function(jobs) {
      if (!jobs) return null;
      // Pick the job with the highest ID (most recent, handles retries)
      var found = null;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].name === jobName) {
          if (!found || jobs[i].id > found.id) found = jobs[i];
        }
      }
      return found;
    });
}

function startJobByName(task, jobName) {
  return findJobByName(task, jobName).then(function(job) {
    if (!job) throw new Error('Job "' + jobName + '" not found in pipeline');

    if (job.status === 'success') {
      return { id: job.id, name: jobName, skipped: true };
    } else if (job.status === 'manual' || job.status === 'skipped') {
      return api(task, 'POST', '/projects/' + task.projectId + '/jobs/' + job.id + '/play')
        .then(function(resp) { return { id: resp.id || job.id, name: jobName }; });
    } else if (job.status === 'failed' || job.status === 'canceled') {
      return api(task, 'POST', '/projects/' + task.projectId + '/jobs/' + job.id + '/retry')
        .then(function(resp) { return { id: resp.id || job.id, name: jobName }; })
        .catch(function(err) {
          // 403 = already retried, refetch to find the new job
          if (err.message && err.message.indexOf('403') !== -1) {
            return findJobByName(task, jobName).then(function(fresh) {
              if (!fresh) throw new Error('Job "' + jobName + '" not found after refetch');
              if (fresh.id !== job.id) return startJobByName(task, jobName);
              throw err;
            });
          }
          throw err;
        });
    } else if (job.status === 'running' || job.status === 'pending' || job.status === 'created') {
      return { id: job.id, name: jobName };
    } else {
      throw new Error('Job "' + jobName + '" has unexpected status: ' + job.status);
    }
  });
}

function waitForJobComplete(task, jobName, maxAttempts) {
  maxAttempts = maxAttempts || 120;
  var attempt = 0;
  function check() {
    attempt++;
    if (task._cancelled) throw new Error('Cancelled by user');
    if (attempt > maxAttempts) throw new Error('Timeout waiting for "' + jobName + '"');
    return new Promise(function(resolve) { setTimeout(resolve, 20000); })
      .then(function() { return findJobByName(task, jobName); })
      .then(function(job) {
        if (!job) throw new Error('Job "' + jobName + '" not found');
        if (job.status === 'success') return job;
        if (job.status === 'failed') throw new Error('Job "' + jobName + '" failed');
        if (job.status === 'canceled') throw new Error('Job "' + jobName + '" canceled');
        return check();
      });
  }
  return check();
}

// =========================================================================
// Job chain runner
// =========================================================================

function runJobChain(taskId) {
  var task = tasks[taskId];
  if (!task || task.currentIndex >= task.jobs.length) {
    if (task) {
      task.status = 'done';
      notifyResult(taskId, true, 'All jobs completed: ' + task.jobs.join(' → '));
    }
    return;
  }

  if (task._cancelled) return;

  var jobName = task.jobs[task.currentIndex];
  task.status = 'running: ' + jobName;
  broadcastProgress(taskId);

  startJobByName(task, jobName)
    .then(function(result) {
      if (result && result.skipped) return;
      return waitForJobComplete(task, jobName);
    })
    .then(function() {
      task.currentIndex++;
      runJobChain(taskId);
    })
    .catch(function(err) {
      task.status = 'error';
      task.error = err.message;
      notifyResult(taskId, false, 'Job chain failed at "' + jobName + '": ' + err.message);
    });
}

// =========================================================================
// Notifications
// =========================================================================

function broadcastToTabs(gitlabUrl, message) {
  chrome.tabs.query({ url: gitlabUrl + '/*' }).then(function(tabs) {
    tabs.forEach(function(tab) {
      chrome.tabs.sendMessage(tab.id, message).catch(function() {});
    });
  }).catch(function() {});
}

function broadcastProgress(taskId) {
  var task = tasks[taskId];
  if (!task) return;
  broadcastToTabs(task.gitlabUrl, {
    type: 'task-progress',
    taskId: taskId,
    jobs: task.jobs,
    status: task.status,
    mrTitle: task.mrTitle,
  });
}

function notifyResult(taskId, success, message) {
  var task = tasks[taskId];
  if (task) {
    broadcastToTabs(task.gitlabUrl, {
      type: 'task-result',
      taskId: taskId,
      success: success,
      message: message,
      jobs: task.jobs,
      mrTitle: task.mrTitle,
    });
  }

  chrome.storage.sync.get({ notifications_enabled: true }, function(s) {
    if (s.notifications_enabled !== false) {
      chrome.notifications.create('task-' + taskId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: success ? 'Job Chain Completed' : 'Job Chain Failed',
        message: message,
      });
    }
  });
}

// =========================================================================
// Message listener
// =========================================================================

// =========================================================================
// Jira API proxy — relay calls through a content script on a Jira tab
// =========================================================================

function jiraApi(jiraUrl, path) {
  var url = jiraUrl + path;
  return chrome.cookies.getAll({ url: jiraUrl }).then(function(cookies) {
    var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
    return fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
      },
    });
  }).then(function(r) {
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    return r.json();
  });
}

function fetchJiraStatuses(jiraUrl, tickets, showDetails) {
  var results = {};
  var fields = showDetails ? 'status,priority,issuetype' : 'status';

  function fetchOne(i) {
    if (i >= tickets.length) return Promise.resolve(results);
    var ticket = tickets[i];
    return jiraApi(jiraUrl, '/rest/api/2/issue/' + ticket + '?fields=' + fields)
      .then(function(data) {
        if (data && data.fields && data.fields.status) {
          var r = {
            name: data.fields.status.name,
            categoryKey: data.fields.status.statusCategory
              ? data.fields.status.statusCategory.key : 'undefined',
          };
          if (showDetails) {
            r.priority = data.fields.priority ? data.fields.priority.name : '';
            r.priorityIcon = data.fields.priority ? data.fields.priority.iconUrl : '';
            r.type = data.fields.issuetype ? data.fields.issuetype.name : '';
            r.typeIcon = data.fields.issuetype ? data.fields.issuetype.iconUrl : '';
          }
          results[ticket] = r;
        }
      })
      .catch(function() {})
      .then(function() { return fetchOne(i + 1); });
  }

  return fetchOne(0);
}

// Cache for custom field ID mapping (per Jira instance)
var _fieldMapCache = {};

function getFieldMap(jiraUrl) {
  if (_fieldMapCache[jiraUrl]) return Promise.resolve(_fieldMapCache[jiraUrl]);
  return jiraApi(jiraUrl, '/rest/api/2/field')
    .then(function(fields) {
      var map = { epicField: '', sprintField: '' };
      if (Array.isArray(fields)) {
        fields.forEach(function(f) {
          var n = (f.name || '').toLowerCase();
          var id = (f.id || '').toLowerCase();
          if (n === 'epic link' || n === 'epic name' || n.indexOf('epic') !== -1 || id === 'customfield_10014' || id === 'customfield_10008') {
            if (!map.epicField) map.epicField = f.id;
          }
          if (n === 'sprint' || id === 'customfield_10007') {
            if (!map.sprintField) map.sprintField = f.id;
          }
        });
      }
      _fieldMapCache[jiraUrl] = map;
      return map;
    })
    .catch(function() { return { epicField: '', sprintField: '' }; });
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'fetch-jira-statuses') {
    fetchJiraStatuses(msg.jiraUrl, msg.tickets, msg.showDetails)
      .then(function(statuses) {
        sendResponse({ statuses: statuses });
      })
      .catch(function(err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }

  if (msg.type === 'fetch-jira-issue') {
    getFieldMap(msg.jiraUrl).then(function(fieldMap) {
      var extraFields = [fieldMap.epicField, fieldMap.sprintField].filter(Boolean).join(',');
      var fieldsParam = 'summary,status,description,assignee,reporter,priority,issuetype,created,updated,labels,attachment,components,versions,fixVersions,resolution';
      if (extraFields) fieldsParam += ',' + extraFields;
      return jiraApi(msg.jiraUrl, '/rest/api/2/issue/' + msg.ticket + '?fields=' + fieldsParam)
        .then(function(data) {
          var f = data.fields || {};
          var attachments = {};
          var attachmentList = [];
          if (f.attachment && f.attachment.length) {
            f.attachment.forEach(function(a) {
              attachments[a.filename] = a.content;
              attachmentList.push({
                filename: a.filename,
                url: a.content,
                size: a.size || 0,
                mimeType: a.mimeType || ''
              });
            });
          }
          // Epic link & Sprint via dynamic field IDs
          var epicLink = '';
          var epicVal = fieldMap.epicField ? f[fieldMap.epicField] : null;
          if (epicVal) {
            epicLink = typeof epicVal === 'string' ? epicVal : (epicVal.key || epicVal.name || epicVal.summary || '');
          }
          var sprint = '';
          var sprintVal = fieldMap.sprintField ? f[fieldMap.sprintField] : null;
          if (sprintVal) {
            if (Array.isArray(sprintVal) && sprintVal.length) {
              var last = sprintVal[sprintVal.length - 1];
              if (typeof last === 'object' && last.name) sprint = last.name;
              else if (typeof last === 'string') {
                var sm = last.match(/name=([^,\]]+)/);
                if (sm) sprint = sm[1];
              }
            } else if (typeof sprintVal === 'string') {
              sprint = sprintVal;
            }
          }
          sendResponse({
            key: data.key,
            summary: f.summary || '',
            status: f.status ? f.status.name : '',
            statusCategoryKey: f.status && f.status.statusCategory ? f.status.statusCategory.key : '',
            description: f.description || '',
            assignee: f.assignee ? f.assignee.displayName : '',
            reporter: f.reporter ? f.reporter.displayName : '',
            priority: f.priority ? f.priority.name : '',
            priorityIcon: f.priority ? f.priority.iconUrl : '',
            type: f.issuetype ? f.issuetype.name : '',
            typeIcon: f.issuetype ? f.issuetype.iconUrl : '',
            created: f.created || '',
            updated: f.updated || '',
            labels: f.labels || [],
            attachments: attachments,
            attachmentList: attachmentList,
            components: (f.components || []).map(function(c) { return c.name; }),
            versions: (f.versions || []).map(function(v) { return v.name; }),
            fixVersions: (f.fixVersions || []).map(function(v) { return v.name; }),
            resolution: f.resolution ? f.resolution.name : '',
            epicLink: epicLink,
            sprint: sprint
          });
        });
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'search-jira-assignable') {
    jiraApi(msg.jiraUrl, '/rest/api/2/user/assignable/search?issueKey=' + encodeURIComponent(msg.ticket) + '&username=' + encodeURIComponent(msg.query) + '&maxResults=10')
      .then(function(users) {
        sendResponse({
          users: users.map(function(u) {
            return { key: u.key || u.name, name: u.displayName, avatar: u.avatarUrls ? u.avatarUrls['24x24'] : '' };
          })
        });
      })
      .catch(function(err) { sendResponse({ _error: err.message }); });
    return true;
  }

  if (msg.type === 'set-jira-assignee') {
    var url = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket;
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieStr },
        body: JSON.stringify({ fields: { assignee: msg.username ? { name: msg.username } : null } })
      });
    }).then(function(r) {
      if (r.status === 204 || r.ok) {
        sendResponse({ success: true });
      } else {
        return r.text().then(function(text) { throw new Error(r.status + ' ' + text); });
      }
    }).catch(function(err) { sendResponse({ _error: err.message }); });
    return true;
  }

  if (msg.type === 'fetch-jira-transitions') {
    jiraApi(msg.jiraUrl, '/rest/api/2/issue/' + msg.ticket + '/transitions')
      .then(function(data) {
        var transitions = (data.transitions || []).map(function(t) {
          return {
            id: t.id,
            name: t.name,
            statusName: t.to ? t.to.name : '',
            statusCategoryKey: t.to && t.to.statusCategory ? t.to.statusCategory.key : ''
          };
        });
        sendResponse({ transitions: transitions });
      })
      .catch(function(err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }

  if (msg.type === 'do-jira-transition') {
    var url = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket + '/transitions';
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieStr },
        body: JSON.stringify({ transition: { id: msg.transitionId } })
      });
    }).then(function(r) {
      if (r.status === 204 || r.ok) {
        sendResponse({ success: true });
      } else {
        return r.text().then(function(text) {
          throw new Error(r.status + ' ' + text);
        });
      }
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'start-job-chain') {
    var taskId = 'task-' + Date.now();
    tasks[taskId] = {
      jobs: msg.jobs,
      currentIndex: 0,
      gitlabUrl: msg.gitlabUrl,
      projectId: msg.projectId,
      mrIid: msg.mrIid,
      mrTitle: msg.mrTitle || ('!' + msg.mrIid),
      status: 'starting',
      error: null,
      _tabId: sender.tab ? sender.tab.id : null,
    };
    runJobChain(taskId);
    sendResponse({ taskId: taskId });
    return true;
  }

  if (msg.type === 'get-task-status') {
    var task = tasks[msg.taskId];
    sendResponse(task ? { status: task.status, error: task.error } : { status: 'not_found' });
    return true;
  }

  if (msg.type === 'cancel-task') {
    var ct = tasks[msg.taskId];
    if (ct && ct.status !== 'done' && ct.status !== 'error') {
      ct.status = 'error';
      ct.error = 'Cancelled by user';
      ct._cancelled = true;
      broadcastProgress(msg.taskId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'get-active-tasks') {
    var active = [];
    for (var id in tasks) {
      var t = tasks[id];
      if (t.status !== 'done' && t.status !== 'error') {
        active.push({ taskId: id, jobs: t.jobs, status: t.status, mrTitle: t.mrTitle });
      }
    }
    sendResponse(active);
    return true;
  }
});
