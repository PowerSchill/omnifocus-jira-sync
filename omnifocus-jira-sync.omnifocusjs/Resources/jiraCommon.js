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
  jiraCommon.HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
  jiraCommon.HTTP_STATUS_BAD_GATEWAY = 502;
  jiraCommon.HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
  jiraCommon.HTTP_STATUS_GATEWAY_TIMEOUT = 504;
  jiraCommon.RETRY_MAX_ATTEMPTS = 3;
  jiraCommon.RETRY_BASE_DELAY_MS = 1000;
  jiraCommon.RETRY_MAX_DELAY_MS = 60000;
  jiraCommon.RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
  jiraCommon.NON_RETRYABLE_STATUS_CODES = [400, 401, 403, 404];

  // API instances
  const preferences = new Preferences();
  const credentials = new Credentials();

  /**
   * Encodes a string to Base64 format using a custom implementation
   * @param {string} str - The string to encode
   * @returns {string} Base64-encoded string
   */
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

  /**
   * Performs an HTTP request with automatic retry logic and exponential backoff
   * @param {URL.FetchRequest} request - The configured fetch request to execute
   * @returns {Promise<Object>} The response object from the successful fetch
   * @throws {Error} If all retry attempts fail or a non-retryable error occurs
   */
  jiraCommon.fetchWithRetry = async (request) => {
    const delay = (ms) => new Promise(resolve => Timer.once(ms / 1000, resolve));

    let lastError = null;

    for (let attempt = 0; attempt <= jiraCommon.RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await request.fetch();

        if (response.statusCode === jiraCommon.HTTP_STATUS_OK) {
          return response;
        }

        if (jiraCommon.NON_RETRYABLE_STATUS_CODES.includes(response.statusCode)) {
          const errorMessage = jiraCommon.createJiraErrorMessage(response.statusCode, response.bodyString);
          throw new Error(errorMessage);
        }

        if (jiraCommon.RETRYABLE_STATUS_CODES.includes(response.statusCode)) {
          if (attempt === jiraCommon.RETRY_MAX_ATTEMPTS) {
            const errorMessage = jiraCommon.createJiraErrorMessage(response.statusCode, response.bodyString);
            throw new Error(errorMessage);
          }

          let delayMs = jiraCommon.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

          if (response.statusCode === jiraCommon.HTTP_STATUS_TOO_MANY_REQUESTS) {
            const retryAfter = response.headers['Retry-After'] || response.headers['retry-after'];
            if (retryAfter) {
              const retryAfterMs = parseInt(retryAfter, 10) * 1000;
              if (!isNaN(retryAfterMs) && retryAfterMs > 0) {
                delayMs = Math.min(retryAfterMs, jiraCommon.RETRY_MAX_DELAY_MS);
              }
            }
          }

          console.log(`Retryable error (HTTP ${response.statusCode}), attempt ${attempt + 1}/${jiraCommon.RETRY_MAX_ATTEMPTS}. Retrying in ${delayMs}ms...`);
          await delay(delayMs);
          continue;
        }

        // Unknown status code - treat as non-retryable
        const errorMessage = jiraCommon.createJiraErrorMessage(response.statusCode, response.bodyString);
        throw new Error(errorMessage);
      } catch (error) {
        // Re-throw errors from createJiraErrorMessage (already formatted)
        if (error.message.includes('Jira')) {
          throw error;
        }

        // Network/connection error - retry
        lastError = error;
        if (attempt === jiraCommon.RETRY_MAX_ATTEMPTS) {
          throw new Error(`Failed to connect to Jira after ${jiraCommon.RETRY_MAX_ATTEMPTS + 1} attempts: ${error.message}\n\nPlease check your network connection and Jira URL.`);
        }

        const delayMs = jiraCommon.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`Network error: ${error.message}. Attempt ${attempt + 1}/${jiraCommon.RETRY_MAX_ATTEMPTS}. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
      }
    }

    // Should not reach here, but just in case
    throw lastError || new Error('Request failed after retries');
  };

  /**
   * Creates a user-friendly error message based on Jira API status code and response
   * @param {number} statusCode - The HTTP status code from the Jira API response
   * @param {string} responseBody - The response body as a string
   * @returns {string} A formatted error message with actionable guidance
   */
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

  /**
   * Gets effective status mappings, using custom settings if provided or defaults
   * @param {Object} settings - The plugin settings object
   * @param {string[]} [settings.completedStatuses] - Custom completed status names
   * @param {string[]} [settings.droppedStatuses] - Custom dropped status names
   * @returns {{completed: string[], dropped: string[]}} Object with completed and dropped status arrays
   */
  jiraCommon.getStatusMappings = (settings) => {
    const completed = (settings && Array.isArray(settings.completedStatuses) && settings.completedStatuses.length > 0)
      ? settings.completedStatuses
      : jiraCommon.COMPLETED_STATUSES;
    const dropped = (settings && Array.isArray(settings.droppedStatuses) && settings.droppedStatuses.length > 0)
      ? settings.droppedStatuses
      : jiraCommon.DROPPED_STATUSES;
    return { completed, dropped };
  };

  /**
   * Retrieves stored plugin settings from OmniFocus Preferences
   * @returns {Object|null} The parsed settings object or null if not found or invalid
   */
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

  /**
   * Saves plugin settings to OmniFocus Preferences
   * @param {Object} settings - The settings object to save
   */
  jiraCommon.saveSettings = (settings) => {
    preferences.write(jiraCommon.SETTINGS_KEY, JSON.stringify(settings));
  };

  /**
   * Retrieves stored Jira credentials from OmniFocus Credentials (macOS Keychain)
   * @returns {{accountId: string, apiToken: string}|null} Object with accountId and apiToken or null if not found
   */
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

  /**
   * Saves Jira credentials to OmniFocus Credentials (macOS Keychain)
   * @param {string} accountId - The Jira account ID
   * @param {string} apiToken - The Jira API token
   */
  jiraCommon.saveCredentials = (accountId, apiToken) => {
    credentials.remove(jiraCommon.CREDENTIAL_SERVICE);
    credentials.write(jiraCommon.CREDENTIAL_SERVICE, accountId, apiToken);
  };

  /**
   * Fetches issues from Jira using JQL query with pagination support
   * @param {string} jiraUrl - The base Jira URL (e.g., https://company.atlassian.net)
   * @param {string} accountId - The Jira account ID for authentication
   * @param {string} apiToken - The Jira API token for authentication
   * @param {string} jql - The JQL query to filter issues
   * @param {boolean} [fullRefresh=false] - If true, fetches all matching issues; if false, appends date filter
   * @param {string|null} [lastSyncTime=null] - ISO timestamp of last sync for incremental updates
   * @returns {Promise<Array>} Array of Jira issue objects
   * @throws {Error} If the request fails or authentication is invalid
   */
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
      const response = await jiraCommon.fetchWithRetry(request);

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

  /**
   * Converts Atlassian Document Format (ADF) to plain text
   * @param {Object} adf - The ADF document object from Jira
   * @returns {string} Plain text representation of the ADF content
   */
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

  /**
   * Finds an OmniFocus task by Jira key using linear search (O(n))
   * @param {string} jiraKey - The Jira issue key (e.g., "PROJ-123")
   * @returns {Task|null} The matching task or null if not found
   * @deprecated Use findTaskByJiraKeyIndexed with buildTaskIndex for better performance
   */
  jiraCommon.findTaskByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const tasks = flattenedTasks.filter(task => task.name.startsWith(prefix));
    return tasks.length > 0 ? tasks[0] : null;
  };

  /**
   * Finds an OmniFocus project by Jira key using linear search (O(n))
   * @param {string} jiraKey - The Jira issue key (e.g., "PROJ-123")
   * @returns {Project|null} The matching project or null if not found
   * @deprecated Use findProjectByJiraKeyIndexed with buildProjectIndex for better performance
   */
  jiraCommon.findProjectByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const projects = flattenedProjects.filter(project => project.name.startsWith(prefix));
    return projects.length > 0 ? projects[0] : null;
  };

  /**
   * Builds an index of all tasks by Jira key for O(1) lookups
   * @returns {Map<string, Task>} Map with Jira keys as keys and Task objects as values
   */
  jiraCommon.buildTaskIndex = () => {
    const index = new Map();
    for (const task of flattenedTasks) {
      const match = task.name.match(/^\[([^\]]+)\]/);
      if (match) {
        index.set(match[1], task);
      }
    }
    return index;
  };

  /**
   * Builds an index of all projects by Jira key for O(1) lookups
   * @returns {Map<string, Project>} Map with Jira keys as keys and Project objects as values
   */
  jiraCommon.buildProjectIndex = () => {
    const index = new Map();
    for (const project of flattenedProjects) {
      const match = project.name.match(/^\[([^\]]+)\]/);
      if (match) {
        index.set(match[1], project);
      }
    }
    return index;
  };

  /**
   * Finds a task by Jira key using a pre-built index for O(1) lookup
   * @param {Map<string, Task>} index - The task index created by buildTaskIndex
   * @param {string} jiraKey - The Jira issue key (e.g., "PROJ-123")
   * @returns {Task|null} The matching task or null if not found
   */
  jiraCommon.findTaskByJiraKeyIndexed = (index, jiraKey) => {
    return index.get(jiraKey) || null;
  };

  /**
   * Finds a project by Jira key using a pre-built index for O(1) lookup
   * @param {Map<string, Project>} index - The project index created by buildProjectIndex
   * @param {string} jiraKey - The Jira issue key (e.g., "PROJ-123")
   * @returns {Project|null} The matching project or null if not found
   */
  jiraCommon.findProjectByJiraKeyIndexed = (index, jiraKey) => {
    return index.get(jiraKey) || null;
  };

  /**
   * Finds a nested folder by path using colon-separated notation
   * @param {string} folderPath - The folder path (e.g., "Parent:Child:Grandchild")
   * @returns {Folder|null} The matching folder or null if not found
   * @example
   * // Find a nested folder
   * const folder = findNestedFolder("Work:Projects:Active");
   */
  jiraCommon.findNestedFolder = (folderPath) => {
    if (!folderPath) return null;

    const parts = folderPath.split(':').map(p => p.trim());
    let currentFolder = null;

    // Find the top-level folder
    currentFolder = folderNamed(parts[0]);
    if (!currentFolder) {
      console.log(`Folder "${folderPath}" not found: top-level folder "${parts[0]}" does not exist`);
      return null;
    }

    // Navigate through nested folders
    for (let i = 1; i < parts.length; i++) {
      const childFolders = currentFolder.folders;
      const foundChild = childFolders.find(f => f.name === parts[i]);
      if (!foundChild) {
        console.log(`Folder "${folderPath}" not found: subfolder "${parts[i]}" does not exist in "${currentFolder.name}"`);
        return null;
      }
      currentFolder = foundChild;
    }

    return currentFolder;
  };

  /**
   * Finds an existing project for a parent Jira issue or creates a new one
   * @param {string} parentKey - The parent Jira issue key (e.g., "PROJ-123")
   * @param {string} parentSummary - The parent issue summary for the project name
   * @param {string} tagName - The tag name to apply to the project
   * @param {string} defaultFolder - The folder path where the project should be created
   * @param {Map<string, Project>|null} [projectIndex=null] - Optional pre-built project index for faster lookups
   * @returns {Project} The found or newly created project
   */
  jiraCommon.findOrCreateProject = (parentKey, parentSummary, tagName, defaultFolder, projectIndex = null) => {
    // Try to find existing project using index if available, otherwise linear scan
    let project = projectIndex
      ? jiraCommon.findProjectByJiraKeyIndexed(projectIndex, parentKey)
      : jiraCommon.findProjectByJiraKey(parentKey);

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

  /**
   * Creates a new OmniFocus task from a Jira issue
   * @param {Object} issue - The Jira issue object
   * @param {string} jiraUrl - The base Jira URL for generating issue links
   * @param {string} tagName - The tag name to apply to the task
   * @param {Object} [settings={}] - Plugin settings for configuration options
   * @param {Map<string, Project>|null} [projectIndex=null] - Optional pre-built project index
   * @returns {Task} The newly created task
   */
  jiraCommon.createTaskFromJiraIssue = (issue, jiraUrl, tagName, settings = {}, projectIndex = null) => {
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
        settings.defaultProjectFolder,
        projectIndex
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

  /**
   * Updates an existing OmniFocus task with data from a Jira issue
   * @param {Task} task - The OmniFocus task to update
   * @param {Object} issue - The Jira issue object with current data
   * @param {string} jiraUrl - The base Jira URL for generating issue links
   * @param {string} tagName - The tag name to apply to the task
   * @param {Object} [settings={}] - Plugin settings for configuration options
   * @param {Map<string, Project>|null} [projectIndex=null] - Optional pre-built project index
   * @returns {boolean} True if the task was updated, false if no changes were made
   */
  jiraCommon.updateTaskFromJiraIssue = (task, issue, jiraUrl, tagName, settings = {}, projectIndex = null) => {
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
          settings.defaultProjectFolder,
          projectIndex
        );
      }

      // Move task if project changed
      // Note: In OmniFocus, the project property is read-only after task creation
      // Tasks cannot be moved between projects, so we skip this if it would fail
      const currentProject = task.containingProject;
      if (targetProject && currentProject !== targetProject) {
        try {
          task.project = targetProject;
          updated = true;
          console.log(`Moved task ${jiraKey} to project ${targetProject.name}`);
        } catch (e) {
          console.log(`Cannot move task ${jiraKey} to project ${targetProject.name} (project is read-only after creation)`);
        }
      } else if (!targetProject && currentProject) {
        // Parent removed, move to inbox
        try {
          task.project = null;
          updated = true;
          console.log(`Moved task ${jiraKey} to inbox (parent removed)`);
        } catch (e) {
          console.log(`Cannot move task ${jiraKey} to inbox (project is read-only after creation)`);
        }
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
    const statusMappings = jiraCommon.getStatusMappings(settings);
    const shouldBeCompleted = statusMappings.completed.includes(statusName);
    const shouldBeDropped = statusMappings.dropped.includes(statusName);

    if (shouldBeCompleted && task.taskStatus !== Task.Status.Completed) {
      task.markComplete();
      updated = true;
    } else if (shouldBeDropped && task.taskStatus !== Task.Status.Dropped) {
      task.drop(true);
      updated = true;
    } else if (!shouldBeCompleted && !shouldBeDropped) {
      if (task.taskStatus === Task.Status.Completed || task.taskStatus === Task.Status.Dropped) {
        task.markIncomplete();
        updated = true;
      }
    }

    return updated;
  };

  /**
   * Tests the connection to Jira by verifying credentials and JQL query
   * @param {string} jiraUrl - The base Jira URL to test
   * @param {string} accountId - The Jira account ID for authentication
   * @param {string} apiToken - The Jira API token for authentication
   * @param {string} jqlQuery - The JQL query to validate
   * @returns {Promise<{success: boolean, displayName: string, issueCount: number}>} Test results with user info and issue count
   * @throws {Error} If authentication fails or the JQL query is invalid
   */
  jiraCommon.testConnection = async (jiraUrl, accountId, apiToken, jqlQuery) => {
    const baseUrl = jiraUrl.replace(/\/$/, '');
    const auth = jiraCommon.base64Encode(`${accountId}:${apiToken}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Step 1: Verify credentials using /myself endpoint (always requires auth)
    const myselfUrl = `${baseUrl}/rest/api/${jiraCommon.JIRA_API_VERSION}/myself`;
    const myselfRequest = URL.FetchRequest.fromString(myselfUrl);
    myselfRequest.method = 'GET';
    myselfRequest.headers = headers;
    myselfRequest.allowsCellularAccess = true;

    const myselfResponse = await jiraCommon.fetchWithRetry(myselfRequest);
    const myselfData = JSON.parse(myselfResponse.bodyString);
    console.log(`Authenticated as: ${myselfData.displayName} (${myselfData.emailAddress})`);

    // Step 2: Verify JQL query
    const searchUrl = `${baseUrl}/rest/api/${jiraCommon.JIRA_API_VERSION}/search/jql`;
    const params = {
      jql: jqlQuery,
      maxResults: 1,
      startAt: 0,
      fields: ['key']
    };

    const url = `${searchUrl}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const request = URL.FetchRequest.fromString(url);
    request.method = 'GET';
    request.headers = headers;
    request.allowsCellularAccess = true;

    const response = await jiraCommon.fetchWithRetry(request);

    const data = JSON.parse(response.bodyString);
    return {
      success: true,
      displayName: myselfData.displayName,
      issueCount: data.total || 0
    };
  };

  return jiraCommon;
})();
