// Shared library for Jira sync plugin
// This file is loaded globally and provides common functions and constants

// Constants
const CREDENTIAL_SERVICE = 'com.omnifocus.plugin.jira-sync';
const SETTINGS_KEY = 'jiraSync.settings';

// Status mappings
const COMPLETED_STATUSES = ['Done', 'Closed', 'Resolved'];
const DROPPED_STATUSES = ['Withdrawn'];

// JIRA API Configuration
const JIRA_API_VERSION = 3;
const MAX_RESULTS_PER_PAGE = 100;
const JIRA_FIELDS = ['summary', 'description', 'status', 'duedate', 'updated'];
const INITIAL_START_AT = 0;

// HTTP Status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

// Create API instances (globally available)
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

// Create actionable error message based on HTTP status code
function createJiraErrorMessage(statusCode, responseBody) {
  let errorMessage = '';
  let jiraErrorDetails = '';

  // Try to parse Jira's error response
  try {
    const errorData = JSON.parse(responseBody);
    if (errorData.errorMessages && errorData.errorMessages.length > 0) {
      jiraErrorDetails = `\n\nJira says: ${errorData.errorMessages.join('; ')}`;
    } else if (errorData.errors) {
      const errors = Object.entries(errorData.errors).map(([key, value]) => `${key}: ${value}`);
      jiraErrorDetails = `\n\nJira says: ${errors.join('; ')}`;
    }
  } catch (e) {
    // Response body is not valid JSON or doesn't match expected format
  }

  switch (statusCode) {
    case HTTP_STATUS_BAD_REQUEST:
      errorMessage = 'Invalid request to Jira API. This usually means there is a problem with your JQL query.';
      if (jiraErrorDetails) {
        errorMessage += jiraErrorDetails;
      } else {
        errorMessage += '\n\nPlease check your JQL query in "Configure JIRA Sync".';
      }
      break;
    case HTTP_STATUS_UNAUTHORIZED:
      errorMessage = 'Authentication failed. Your Jira API token may be invalid or expired.\n\nPlease run "Configure JIRA Sync" to regenerate your API token.';
      break;
    case HTTP_STATUS_FORBIDDEN:
      errorMessage = 'Access denied. Your Jira account does not have permission to access this resource.\n\nPlease check your Jira permissions or contact your Jira administrator.';
      break;
    case HTTP_STATUS_NOT_FOUND:
      errorMessage = 'Jira instance not found. The Jira URL may be incorrect.\n\nPlease verify your Jira URL in "Configure JIRA Sync".';
      break;
    case HTTP_STATUS_TOO_MANY_REQUESTS:
      errorMessage = 'Rate limited by Jira. Too many requests have been made in a short period.\n\nPlease wait a few minutes and try again.';
      break;
    default:
      errorMessage = `Jira API returned status ${statusCode}.${jiraErrorDetails}`;
      if (!jiraErrorDetails) {
        errorMessage += '\n\nPlease check your Jira configuration and try again.';
      }
  }

  return errorMessage;
}

// Settings management
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

// Credentials management
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

function saveCredentials(accountId, apiToken) {
  credentials.write(CREDENTIAL_SERVICE, accountId, apiToken);
}

// Fetch issues from Jira API
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
      const errorMessage = createJiraErrorMessage(response.statusCode, response.bodyString);
      throw new Error(errorMessage);
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

// Convert Atlassian Document Format to plain text
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

// Find existing task by Jira key
function findTaskByJiraKey(jiraKey) {
  const prefix = `[${jiraKey}]`;
  const tasks = flattenedTasks.filter(task => task.name.startsWith(prefix));
  return tasks.length > 0 ? tasks[0] : null;
}

// Create new OmniFocus task from Jira issue
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

// Update existing OmniFocus task from Jira issue
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

// Test connection to Jira API (used in configuration)
async function testConnection(jiraUrl, accountId, apiToken, jqlQuery) {
  const baseUrl = jiraUrl.replace(/\/$/, '');
  const searchUrl = `${baseUrl}/rest/api/${JIRA_API_VERSION}/search/jql`;

  // Test with a minimal query to verify connection and credentials
  const params = {
    jql: jqlQuery,
    maxResults: 1,
    startAt: 0,
    fields: ['key']
  };

  const url = `${searchUrl}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const auth = base64Encode(`${accountId}:${apiToken}`);
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const request = URL.FetchRequest.fromString(url);
  request.method = 'GET';
  request.headers = headers;
  request.allowsCellularAccess = true;

  try {
    const response = await request.fetch();

    if (response.statusCode !== HTTP_STATUS_OK) {
      const errorMessage = createJiraErrorMessage(response.statusCode, response.bodyString);
      throw new Error(errorMessage);
    }

    // Parse response to verify it's valid
    const data = JSON.parse(response.bodyString);
    return {
      success: true,
      issueCount: data.total || 0
    };
  } catch (error) {
    if (error.message.includes('Jira')) {
      throw error;
    }
    throw new Error(`Failed to connect to Jira: ${error.message}\n\nPlease check your network connection and Jira URL.`);
  }
}
