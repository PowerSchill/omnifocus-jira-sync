/* global PlugIn Version Preferences Credentials Task Tag URL Project flattenedProjects folderNamed */
(() => {
  const jiraCommon = new PlugIn.Library(new Version('1.0'));

  // Constants
  jiraCommon.CREDENTIAL_SERVICE = 'com.omnifocus.plugin.jira-sync';
  jiraCommon.SETTINGS_KEY = 'jiraSync.settings';
  jiraCommon.COMPLETED_STATUSES = ['Done', 'Closed', 'Resolved'];
  jiraCommon.DROPPED_STATUSES = ['Withdrawn'];
  jiraCommon.JIRA_API_VERSION = 3;
  jiraCommon.MAX_RESULTS_PER_PAGE = 100;
  jiraCommon.JIRA_FIELDS = ['summary', 'description', 'status', 'duedate', 'updated', 'parent'];
  jiraCommon.INITIAL_START_AT = 0;
  jiraCommon.HTTP_STATUS_OK = 200;
  jiraCommon.HTTP_STATUS_BAD_REQUEST = 400;
  jiraCommon.HTTP_STATUS_UNAUTHORIZED = 401;
  jiraCommon.HTTP_STATUS_FORBIDDEN = 403;
  jiraCommon.HTTP_STATUS_NOT_FOUND = 404;
  jiraCommon.HTTP_STATUS_TOO_MANY_REQUESTS = 429;

  // API instances
  const preferences = new Preferences();
  const credentials = new Credentials();

  // Base64 encoding function
  jiraCommon.base64Encode = (str) => {
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
  };

  // Create actionable error message
  jiraCommon.createJiraErrorMessage = (statusCode, responseBody) => {
    let errorMessage = '';
    let jiraErrorDetails = '';

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
      case jiraCommon.HTTP_STATUS_BAD_REQUEST:
        errorMessage = 'Invalid request to Jira API. This usually means there is a problem with your JQL query.';
        errorMessage += jiraErrorDetails || '\n\nPlease check your JQL query in "Configure JIRA Sync".';
        break;
      case jiraCommon.HTTP_STATUS_UNAUTHORIZED:
        errorMessage = 'Authentication failed. Your Jira API token may be invalid or expired.\n\nPlease run "Configure JIRA Sync" to regenerate your API token.';
        break;
      case jiraCommon.HTTP_STATUS_FORBIDDEN:
        errorMessage = 'Access denied. Your Jira account does not have permission to access this resource.\n\nPlease check your Jira permissions or contact your Jira administrator.';
        break;
      case jiraCommon.HTTP_STATUS_NOT_FOUND:
        errorMessage = 'Jira instance not found. The Jira URL may be incorrect.\n\nPlease verify your Jira URL in "Configure JIRA Sync".';
        break;
      case jiraCommon.HTTP_STATUS_TOO_MANY_REQUESTS:
        errorMessage = 'Rate limited by Jira. Too many requests have been made in a short period.\n\nPlease wait a few minutes and try again.';
        break;
      default:
        errorMessage = `Jira API returned status ${statusCode}.${jiraErrorDetails}`;
        if (!jiraErrorDetails) {
          errorMessage += '\n\nPlease check your Jira configuration and try again.';
        }
    }

    return errorMessage;
  };

  // Settings management
  jiraCommon.getSettings = () => {
    const settingsString = preferences.read(jiraCommon.SETTINGS_KEY);
    if (settingsString) {
      try {
        return JSON.parse(settingsString);
      } catch (e) {
        console.error('Failed to parse settings:', e);
        return null;
      }
    }
    return null;
  };

  jiraCommon.saveSettings = (settings) => {
    preferences.write(jiraCommon.SETTINGS_KEY, JSON.stringify(settings));
  };

  // Credentials management
  jiraCommon.getCredentials = () => {
    const credential = credentials.read(jiraCommon.CREDENTIAL_SERVICE);
    if (credential) {
      return {
        accountId: credential.user,
        apiToken: credential.password
      };
    }
    return null;
  };

  jiraCommon.saveCredentials = (accountId, apiToken) => {
    credentials.write(jiraCommon.CREDENTIAL_SERVICE, accountId, apiToken);
  };

  // Fetch issues from Jira
  jiraCommon.fetchJiraIssues = async (jiraUrl, accountId, apiToken, jql, fullRefresh = false, lastSyncTime = null) => {
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

    const searchUrl = `${baseUrl}/rest/api/${jiraCommon.JIRA_API_VERSION}/search/jql`;
    const params = {
      jql: finalJql,
      maxResults: jiraCommon.MAX_RESULTS_PER_PAGE,
      fields: jiraCommon.JIRA_FIELDS
    };

    const allIssues = [];
    let nextPageToken = null;
    const auth = jiraCommon.base64Encode(`${accountId}:${apiToken}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    do {
      // Add nextPageToken to params if it exists
      if (nextPageToken) {
        params.nextPageToken = nextPageToken;
      }

      const url = `${searchUrl}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
      const request = URL.FetchRequest.fromString(url);
      request.method = 'GET';
      request.headers = headers;
      request.allowsCellularAccess = true;
      const response = await request.fetch();

      if (response.statusCode !== jiraCommon.HTTP_STATUS_OK) {
        const errorMessage = jiraCommon.createJiraErrorMessage(response.statusCode, response.bodyString);
        throw new Error(errorMessage);
      }

      const data = JSON.parse(response.bodyString);
      allIssues.push(...data.issues);

      console.log(`Pagination: fetched ${data.issues.length} issues, isLast=${data.isLast}, accumulated=${allIssues.length}`);

      // Token-based pagination
      if (!data.isLast && data.nextPageToken) {
        nextPageToken = data.nextPageToken;
        console.log(`Fetching next page with token: ${nextPageToken.substring(0, 20)}...`);
      } else {
        nextPageToken = null;
        console.log(`Pagination complete: fetched all ${allIssues.length} issues`);
      }
    } while (nextPageToken);

    return allIssues;
  };

  // Convert ADF to plain text
  jiraCommon.convertAdfToPlainText = (adf) => {
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

      if (node.type === 'paragraph' || node.type === 'heading') {
        text += '\n';
      }
    }

    extractText(adf);
    return text.trim();
  };

  // Find task by Jira key
  jiraCommon.findTaskByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const tasks = flattenedTasks.filter(task => task.name.startsWith(prefix));
    return tasks.length > 0 ? tasks[0] : null;
  };

  // Find project by Jira key
  jiraCommon.findProjectByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const projects = flattenedProjects.filter(project => project.name.startsWith(prefix));
    return projects.length > 0 ? projects[0] : null;
  };

  // Find nested folder by path (supports "Parent:Child" notation)
  jiraCommon.findNestedFolder = (folderPath) => {
    if (!folderPath) return null;

    const parts = folderPath.split(':').map(p => p.trim());
    let currentFolder = null;

    // Find the top-level folder
    currentFolder = folderNamed(parts[0]);
    if (!currentFolder) {
      return null;
    }

    // Navigate through nested folders
    for (let i = 1; i < parts.length; i++) {
      const childFolders = currentFolder.folders;
      const foundChild = childFolders.find(f => f.name === parts[i]);
      if (!foundChild) {
        return null;
      }
      currentFolder = foundChild;
    }

    return currentFolder;
  };

  // Find or create project for parent issue
  jiraCommon.findOrCreateProject = (parentKey, parentSummary, tagName, defaultFolder) => {
    // Try to find existing project
    let project = jiraCommon.findProjectByJiraKey(parentKey);

    if (!project) {
      // Create new project
      const projectName = `[${parentKey}] ${parentSummary}`;

      // Find or create in the specified folder
      if (defaultFolder) {
        const folder = jiraCommon.findNestedFolder(defaultFolder);
        if (folder) {
          project = new Project(projectName, folder);
          console.log(`Created project in folder "${defaultFolder}": ${projectName}`);
        } else {
          console.log(`Folder "${defaultFolder}" not found, creating project at root level`);
          project = new Project(projectName);
        }
      } else {
        // Create at root level
        project = new Project(projectName);
        console.log(`Created project at root level: ${projectName}`);
      }

      // Set as active
      project.status = Project.Status.Active;

      // Add tag
      const tag = tagNamed(tagName) || new Tag(tagName);
      project.addTag(tag);
    }

    return project;
  };

  // Create task from Jira issue
  jiraCommon.createTaskFromJiraIssue = (issue, jiraUrl, tagName, settings = {}) => {
    const jiraKey = issue.key;
    const fields = issue.fields;
    const taskName = `[${jiraKey}] ${fields.summary}`;

    // Determine project assignment
    let project = null;
    if (settings.enableProjectOrganization && fields.parent) {
      const parentKey = fields.parent.key;
      const parentSummary = fields.parent.fields && fields.parent.fields.summary
        ? fields.parent.fields.summary
        : parentKey;

      project = jiraCommon.findOrCreateProject(
        parentKey,
        parentSummary,
        tagName,
        settings.defaultProjectFolder
      );
    }

    // Create task in project or at root
    const task = project ? new Task(taskName, project) : new Task(taskName);

    if (fields.duedate) {
      try {
        task.dueDate = new Date(fields.duedate);
      } catch (e) {
        console.error(`Failed to set due date for ${jiraKey}:`, e);
      }
    }

    const baseUrl = jiraUrl.replace(/\/$/, '');
    const issueUrl = `${baseUrl}/browse/${jiraKey}`;
    const description = jiraCommon.convertAdfToPlainText(fields.description);
    const notes = `---\nURL: ${issueUrl}\nStatus: ${fields.status.name}\n---\n\n${description}`;
    task.note = notes;

    const tag = tagNamed(tagName) || new Tag(tagName);
    task.addTag(tag);
    return task;
  };

  // Update task from Jira issue
  jiraCommon.updateTaskFromJiraIssue = (task, issue, jiraUrl, tagName, settings = {}) => {
    const jiraKey = issue.key;
    const fields = issue.fields;
    const expectedName = `[${jiraKey}] ${fields.summary}`;
    let updated = false;

    if (task.name !== expectedName) {
      task.name = expectedName;
      updated = true;
    }

    // Handle project changes if organization is enabled
    if (settings.enableProjectOrganization) {
      let targetProject = null;

      if (fields.parent) {
        const parentKey = fields.parent.key;
        const parentSummary = fields.parent.fields && fields.parent.fields.summary
          ? fields.parent.fields.summary
          : parentKey;

        targetProject = jiraCommon.findOrCreateProject(
          parentKey,
          parentSummary,
          tagName,
          settings.defaultProjectFolder
        );
      }

      // Move task if project changed
      const currentProject = task.containingProject;
      if (targetProject && currentProject !== targetProject) {
        task.project = targetProject;
        updated = true;
        console.log(`Moved task ${jiraKey} to project ${targetProject.name}`);
      } else if (!targetProject && currentProject) {
        // Parent removed, move to inbox
        task.project = null;
        updated = true;
        console.log(`Moved task ${jiraKey} to inbox (parent removed)`);
      }
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
    const description = jiraCommon.convertAdfToPlainText(fields.description);
    const notes = `---\nURL: ${issueUrl}\nStatus: ${fields.status.name}\n---\n\n${description}`;

    if (task.note !== notes) {
      task.note = notes;
      updated = true;
    }

    const statusName = fields.status.name;
    const shouldBeCompleted = jiraCommon.COMPLETED_STATUSES.includes(statusName);
    const shouldBeDropped = jiraCommon.DROPPED_STATUSES.includes(statusName);

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
  };

  // Test connection
  jiraCommon.testConnection = async (jiraUrl, accountId, apiToken, jqlQuery) => {
    const baseUrl = jiraUrl.replace(/\/$/, '');
    const searchUrl = `${baseUrl}/rest/api/${jiraCommon.JIRA_API_VERSION}/search/jql`;

    const params = {
      jql: jqlQuery,
      maxResults: 1,
      startAt: 0,
      fields: ['key']
    };

    const url = `${searchUrl}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const auth = jiraCommon.base64Encode(`${accountId}:${apiToken}`);
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

      if (response.statusCode !== jiraCommon.HTTP_STATUS_OK) {
        const errorMessage = jiraCommon.createJiraErrorMessage(response.statusCode, response.bodyString);
        throw new Error(errorMessage);
      }

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
  };

  return jiraCommon;
})();
