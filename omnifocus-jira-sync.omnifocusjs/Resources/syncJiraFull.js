(() => {
  const CREDENTIAL_SERVICE = 'com.omnifocus.plugin.jira-sync';
  const SETTINGS_KEY = 'jiraSync.settings';
  const COMPLETED_STATUSES = ['Done', 'Closed', 'Resolved'];
  const DROPPED_STATUSES = ['Withdrawn'];
  // JIRA API Configuration
  const JIRA_API_VERSION = 3;
  const MAX_RESULTS_PER_PAGE = 100;
  const JIRA_FIELDS = ['summary', 'description', 'status', 'duedate', 'updated'];
  const HTTP_STATUS_OK = 200;
  const INITIAL_START_AT = 0;

  // Create API instances
  const preferences = new Preferences();
  const credentials = new Credentials();

  // Base64 encoding function (btoa not available in OmniFocus)
  function base64Encode(str) {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;

    while (i < str.length) {
      const a = str.charCodeAt(i++);
      const b = i < str.length ? str.charCodeAt(i++) : 0;
      const c = i < str.length ? str.charCodeAt(i++) : 0;

      const bitmap = (a << 16) | (b << 8) | c;

      result += base64Chars.charAt((bitmap >> 18) & 63);
      result += base64Chars.charAt((bitmap >> 12) & 63);
      result += i - 2 < str.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
      result += i - 1 < str.length ? base64Chars.charAt(bitmap & 63) : '=';
    }

    return result;
  }

  function getSettings() {
    const settingsString = preferences.read(SETTINGS_KEY);
    if (settingsString) {
      try {
        return JSON.parse(settingsString);
      } catch (e) {
        console.error('Failed to parse settings:', e);
        return null;
      }
    }
    return null;
  }

  function saveSettings(settings) {
    preferences.write(SETTINGS_KEY, JSON.stringify(settings));
  }

  function getCredentials() {
    const credential = credentials.read(CREDENTIAL_SERVICE);
    if (credential) {
      return {
        accountId: credential.user,
        apiToken: credential.password
      };
    }
    return null;
  }

  async function fetchJiraIssues(jiraUrl, accountId, apiToken, jql, fullRefresh = false, lastSyncTime = null) {
    const baseUrl = jiraUrl.replace(/\/$/, '');
    let finalJql = jql;
    if (!fullRefresh && lastSyncTime) {
      const date = new Date(lastSyncTime);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
      finalJql = `(${jql}) AND updated >= "${formattedTime}"`;
    }

    console.log('Final JQL Query:', finalJql);

    const searchUrl = `${baseUrl}/rest/api/${JIRA_API_VERSION}/search/jql`;
    const params = {
      jql: finalJql,
      maxResults: MAX_RESULTS_PER_PAGE,
      startAt: INITIAL_START_AT,
      fields: JIRA_FIELDS
    };

    const allIssues = [];
    let hasMore = true;
    const auth = base64Encode(`${accountId}:${apiToken}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    while (hasMore) {
      const url = `${searchUrl}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
      const request = URL.FetchRequest.fromString(url);
      request.method = 'GET';
      request.headers = headers;
      request.allowsCellularAccess = true;
      const response = await request.fetch();

      if (response.statusCode !== HTTP_STATUS_OK) {
        throw new Error(`JIRA API returned status ${response.statusCode}: ${response.bodyString}`);
      }

      const data = JSON.parse(response.bodyString);
      allIssues.push(...data.issues);

      if (data.startAt + data.maxResults < data.total) {
        params.startAt += params.maxResults;
      } else {
        hasMore = false;
      }
    }

    return allIssues;
  }

  function convertAdfToPlainText(adf) {
    if (!adf || typeof adf !== 'object') {
      return '';
    }

    let text = '';

    function extractText(node) {
      if (!node) return;

      if (node.type === 'text') {
        text += node.text;
      } else if (node.content && Array.isArray(node.content)) {
        node.content.forEach(child => extractText(child));
      }

      // Add line breaks after paragraphs and headings
      if (node.type === 'paragraph' || node.type === 'heading') {
        text += '\n';
      }
    }

    extractText(adf);
    return text.trim();
  }

  function findTaskByJiraKey(jiraKey) {
    const prefix = `[${jiraKey}]`;
    const tasks = flattenedTasks.filter(task => task.name.startsWith(prefix));
    return tasks.length > 0 ? tasks[0] : null;
  }

  function createTaskFromJiraIssue(issue, jiraUrl, tagName) {
    const jiraKey = issue.key;
    const fields = issue.fields;
    const taskName = `[${jiraKey}] ${fields.summary}`;
    const task = new Task(taskName);

    if (fields.duedate) {
      try {
        task.dueDate = new Date(fields.duedate);
      } catch (e) {
        console.error(`Failed to set due date for ${jiraKey}:`, e);
      }
    }

    const baseUrl = jiraUrl.replace(/\/$/, '');
    const issueUrl = `${baseUrl}/browse/${jiraKey}`;
    const description = convertAdfToPlainText(fields.description);
    const notes = `---\nURL: ${issueUrl}\nStatus: ${fields.status.name}\n---\n\n${description}`;
    task.note = notes;

    const tag = tagNamed(tagName) || new Tag(tagName);
    task.addTag(tag);
    return task;
  }

  function updateTaskFromJiraIssue(task, issue, jiraUrl) {
    const jiraKey = issue.key;
    const fields = issue.fields;
    const expectedName = `[${jiraKey}] ${fields.summary}`;
    let updated = false;

    if (task.name !== expectedName) {
      task.name = expectedName;
      updated = true;
    }

    const newDueDate = fields.duedate ? new Date(fields.duedate) : null;
    const currentDueDate = task.dueDate;

    if (newDueDate && (!currentDueDate || newDueDate.getTime() !== currentDueDate.getTime())) {
      task.dueDate = newDueDate;
      updated = true;
    } else if (!newDueDate && currentDueDate) {
      task.dueDate = null;
      updated = true;
    }

    const baseUrl = jiraUrl.replace(/\/$/, '');
    const issueUrl = `${baseUrl}/browse/${jiraKey}`;
    const description = convertAdfToPlainText(fields.description);
    const notes = `---\nURL: ${issueUrl}\nStatus: ${fields.status.name}\n---\n\n${description}`;

    if (task.note !== notes) {
      task.note = notes;
      updated = true;
    }

    const statusName = fields.status.name;
    const shouldBeCompleted = COMPLETED_STATUSES.includes(statusName);
    const shouldBeDropped = DROPPED_STATUSES.includes(statusName);

    if (shouldBeCompleted && task.taskStatus !== Task.Status.Completed) {
      task.markComplete();
      updated = true;
    } else if (shouldBeDropped && task.taskStatus !== Task.Status.Dropped) {
      task.drop();
      updated = true;
    } else if (!shouldBeCompleted && !shouldBeDropped) {
      if (task.taskStatus === Task.Status.Completed || task.taskStatus === Task.Status.Dropped) {
        task.markIncomplete();
        updated = true;
      }
    }

    return updated;
  }

  async function performSync(fullRefresh) {
    const settings = getSettings();
    if (!settings) {
      throw new Error('JIRA sync is not configured. Please run "Configure JIRA Sync" first.');
    }

    const { jiraUrl, jqlQuery, tagName, lastSyncTime } = settings;
    if (!jiraUrl || !jqlQuery || !tagName) {
      throw new Error('JIRA sync configuration is incomplete. Please run "Configure JIRA Sync".');
    }

    const credentials = getCredentials();
    if (!credentials) {
      throw new Error('JIRA credentials not found. Please run "Configure JIRA Sync" to set up authentication.');
    }

    const { accountId, apiToken } = credentials;
    console.log(`Starting ${fullRefresh ? 'full' : 'incremental'} JIRA sync...`);
    
    const issues = await fetchJiraIssues(jiraUrl, accountId, apiToken, jqlQuery, fullRefresh, lastSyncTime);
    console.log(`Fetched ${issues.length} issues from JIRA`);

    const stats = { created: 0, updated: 0, reopened: 0, completed: 0, skipped: 0 };

    for (const issue of issues) {
      const jiraKey = issue.key;
      const fields = issue.fields;
      const statusName = fields.status.name;
      const shouldSkipCreation = COMPLETED_STATUSES.includes(statusName) || DROPPED_STATUSES.includes(statusName);
      const existingTask = findTaskByJiraKey(jiraKey);

      if (existingTask) {
        const wasCompleted = existingTask.taskStatus === Task.Status.Completed;
        const wasDropped = existingTask.taskStatus === Task.Status.Dropped;
        const wasUpdated = updateTaskFromJiraIssue(existingTask, issue, jiraUrl);

        if (wasUpdated) {
          const isNowCompleted = existingTask.taskStatus === Task.Status.Completed;
          const isNowDropped = existingTask.taskStatus === Task.Status.Dropped;

          if ((wasCompleted || wasDropped) && !isNowCompleted && !isNowDropped) {
            stats.reopened++;
          } else if (!wasCompleted && isNowCompleted) {
            stats.completed++;
          } else {
            stats.updated++;
          }
        }
      } else if (!shouldSkipCreation) {
        createTaskFromJiraIssue(issue, jiraUrl, tagName);
        stats.created++;
      } else {
        stats.skipped++;
      }
    }

    if (fullRefresh) {
      const tag = tagNamed(tagName);
      const existingTasks = tag ? tag.tasks : [];
      const issueKeysFromJira = new Set(issues.map(i => i.key));

      for (const task of existingTasks) {
        const match = task.name.match(/^\[([^\]]+)\]/);
        if (match) {
          const taskJiraKey = match[1];
          if (!issueKeysFromJira.has(taskJiraKey) &&
              task.taskStatus !== Task.Status.Completed &&
              task.taskStatus !== Task.Status.Dropped) {
            task.markComplete();
            stats.completed++;
            console.log(`Completed (no longer in JIRA): ${taskJiraKey}`);
          }
        }
      }
    }

    const newSyncTime = new Date().toISOString();
    saveSettings({ ...settings, lastSyncTime: newSyncTime });
    return stats;
  }

  const action = new PlugIn.Action(async function(selection, sender) {
    try {
      const stats = await performSync(true);
      const message = `Full sync completed successfully!\n\nCreated: ${stats.created}\nUpdated: ${stats.updated}\nReopened: ${stats.reopened}\nCompleted: ${stats.completed}\nSkipped: ${stats.skipped}`;
      console.log(message);
      new Alert('JIRA Full Sync Complete', message).show();
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      console.error('Full sync failed:', errorMessage);
      new Alert('JIRA Full Sync Failed', errorMessage).show();
    }
  });

  action.validate = function(selection, sender) {
    return true;
  };

  return action;
})();
