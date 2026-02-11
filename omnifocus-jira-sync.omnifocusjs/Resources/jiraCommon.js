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

  // Safe logging function to prevent credential leakage
  // Usage: jiraCommon.safeLog('Message', object) or jiraCommon.safeLog('Message')
  // Automatically redacts sensitive fields like passwords, tokens, emails, etc.
  jiraCommon.safeLog = (message, obj) => {
    if (obj === undefined) {
      console.log(message);
      return;
    }

    // Create a sanitized copy of the object in a way that won't throw
    let sanitized;
    try {
      sanitized = JSON.parse(JSON.stringify(obj));
    } catch (e) {
      // Fall back to a safe, non-throwing representation
      try {
        sanitized = { value: String(obj), warning: 'Non-JSON-serializable object logged' };
      } catch (e2) {
        sanitized = { warning: 'Unable to serialize object for logging' };
      }
    }

    // List of sensitive keys to redact
    const sensitiveKeys = [
      'password', 'apiToken', 'token', 'authorization', 'Authorization',
      'api_token', 'access_token', 'accessToken', 'secret', 'key',
      'nextPageToken', 'pageToken', 'emailAddress', 'email'
    ];

    // Recursively sanitize the object
    function sanitizeObject(obj) {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
      }

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          // Check if key matches any sensitive pattern
          const isSensitive = sensitiveKeys.some(sensitiveKey =>
            key.toLowerCase().includes(sensitiveKey.toLowerCase())
          );

          if (isSensitive) {
            obj[key] = '***';
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
          }
        }
      }
    }

    sanitizeObject(sanitized);
    console.log(message, JSON.stringify(sanitized));
  };

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

  // Fetch with retry and exponential backoff
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

  // Get effective status mappings (settings override defaults)
  jiraCommon.getStatusMappings = (settings) => {
    const completed = (settings && Array.isArray(settings.completedStatuses) && settings.completedStatuses.length > 0)
      ? settings.completedStatuses
      : jiraCommon.COMPLETED_STATUSES;
    const dropped = (settings && Array.isArray(settings.droppedStatuses) && settings.droppedStatuses.length > 0)
      ? settings.droppedStatuses
      : jiraCommon.DROPPED_STATUSES;
    return { completed, dropped };
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
    credentials.remove(jiraCommon.CREDENTIAL_SERVICE);
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
      const response = await jiraCommon.fetchWithRetry(request);

      const data = JSON.parse(response.bodyString);
      allIssues.push(...data.issues);

      console.log(`Pagination: fetched ${data.issues.length} issues, isLast=${data.isLast}, accumulated=${allIssues.length}`);

      // Token-based pagination
      if (!data.isLast && data.nextPageToken) {
        nextPageToken = data.nextPageToken;
        console.log('Fetching next page...');
      } else {
        nextPageToken = null;
        console.log(`Pagination complete: fetched all ${allIssues.length} issues`);
      }
    } while (nextPageToken);

    return allIssues;
  };

  // Convert ADF to Markdown
  jiraCommon.convertAdfToMarkdown = (adf) => {
    if (!adf || typeof adf !== 'object') {
      return '';
    }

    let markdown = '';

    function convertNode(node, context = {}) {
      if (!node) return '';

      let result = '';

      switch (node.type) {
        case 'doc':
          // Document root
          if (node.content && Array.isArray(node.content)) {
            result = node.content.map(child => convertNode(child, context)).join('');
          }
          break;

        case 'paragraph':
          // Paragraph
          if (node.content && Array.isArray(node.content)) {
            result = node.content.map(child => convertNode(child, context)).join('') + '\n\n';
          } else {
            result = '\n\n';
          }
          break;

        case 'heading':
          // Heading (h1-h6)
          const level = node.attrs && node.attrs.level ? node.attrs.level : 1;
          const headingPrefix = '#'.repeat(Math.min(level, 6)) + ' ';
          if (node.content && Array.isArray(node.content)) {
            result = headingPrefix + node.content.map(child => convertNode(child, context)).join('') + '\n\n';
          }
          break;

        case 'bulletList':
          // Unordered list
          if (node.content && Array.isArray(node.content)) {
            result = node.content.map(child => convertNode(child, { ...context, listType: 'bullet', listDepth: (context.listDepth || 0) })).join('') + '\n';
          }
          break;

        case 'orderedList':
          // Ordered list
          if (node.content && Array.isArray(node.content)) {
            result = node.content.map((child, index) => convertNode(child, { ...context, listType: 'ordered', listDepth: (context.listDepth || 0), listIndex: index + 1 })).join('') + '\n';
          }
          break;

        case 'listItem':
          // List item
          const indent = '  '.repeat(context.listDepth || 0);
          const bullet = context.listType === 'ordered' ? `${context.listIndex || 1}. ` : '- ';
          if (node.content && Array.isArray(node.content)) {
            // Handle nested lists and paragraphs in list items
            const itemContent = node.content.map(child => {
              if (child.type === 'paragraph') {
                // For paragraphs in list items, don't add extra newlines
                if (child.content && Array.isArray(child.content)) {
                  return child.content.map(c => convertNode(c, context)).join('');
                }
                return '';
              } else if (child.type === 'bulletList' || child.type === 'orderedList') {
                // Nested lists
                return '\n' + convertNode(child, { ...context, listDepth: (context.listDepth || 0) + 1 });
              } else {
                return convertNode(child, context);
              }
            }).join('');
            result = indent + bullet + itemContent + '\n';
          }
          break;

        case 'codeBlock':
          // Code block
          const language = node.attrs && node.attrs.language ? node.attrs.language : '';
          let codeContent = '';
          if (node.content && Array.isArray(node.content)) {
            codeContent = node.content.map(child => convertNode(child, context)).join('');
          }
          result = '```' + language + '\n' + codeContent + '```\n\n';
          break;

        case 'text':
          // Text with optional marks (bold, italic, code, etc.)
          let text = node.text || '';
          if (node.marks && Array.isArray(node.marks)) {
            // Apply marks in order
            node.marks.forEach(mark => {
              switch (mark.type) {
                case 'strong':
                  text = `**${text}**`;
                  break;
                case 'em':
                  text = `*${text}*`;
                  break;
                case 'code':
                  text = `\`${text}\``;
                  break;
                case 'strike':
                  text = `~~${text}~~`;
                  break;
                case 'underline':
                  // Markdown doesn't have native underline, use HTML
                  text = `<u>${text}</u>`;
                  break;
                case 'link':
                  const href = mark.attrs && mark.attrs.href ? mark.attrs.href : '';
                  text = `[${text}](${href})`;
                  break;
              }
            });
          }
          result = text;
          break;

        case 'hardBreak':
          // Hard line break
          result = '  \n';
          break;

        case 'rule':
          // Horizontal rule
          result = '---\n\n';
          break;

        case 'blockquote':
          // Blockquote
          if (node.content && Array.isArray(node.content)) {
            const quoteContent = node.content.map(child => convertNode(child, context)).join('');
            // Add > prefix to each line
            result = quoteContent.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
          }
          break;

        case 'emoji':
          // Emoji shortcode
          const shortName = node.attrs && node.attrs.shortName ? node.attrs.shortName : '';
          result = shortName;
          break;

        case 'mention':
          // User mention
          const displayName = node.attrs && node.attrs.text ? node.attrs.text : '';
          result = `@${displayName}`;
          break;

        case 'inlineCard':
        case 'mediaInline':
        case 'mediaSingle':
          // Rich media - extract URL if available
          const url = node.attrs && node.attrs.url ? node.attrs.url : '';
          result = url ? `[Link](${url})` : '';
          break;

        default:
          // Unknown node type - try to extract content
          if (node.content && Array.isArray(node.content)) {
            result = node.content.map(child => convertNode(child, context)).join('');
          }
      }

      return result;
    }

    markdown = convertNode(adf);
    return markdown.trim();
  };

  // Keep the old function name for backward compatibility (deprecated)
  jiraCommon.convertAdfToPlainText = jiraCommon.convertAdfToMarkdown;

  // Find task by Jira key (linear scan)
  jiraCommon.findTaskByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const tasks = flattenedTasks.filter(task => task.name.startsWith(prefix));
    return tasks.length > 0 ? tasks[0] : null;
  };

  // Find project by Jira key (linear scan)
  jiraCommon.findProjectByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const projects = flattenedProjects.filter(project => project.name.startsWith(prefix));
    return projects.length > 0 ? projects[0] : null;
  };

  // Build a Map<string, Task> index from flattenedTasks for O(1) lookups
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

  // Build a Map<string, Project> index from flattenedProjects for O(1) lookups
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

  // Find task by Jira key using pre-built index
  jiraCommon.findTaskByJiraKeyIndexed = (index, jiraKey) => {
    return index.get(jiraKey) || null;
  };

  // Find project by Jira key using pre-built index
  jiraCommon.findProjectByJiraKeyIndexed = (index, jiraKey) => {
    return index.get(jiraKey) || null;
  };

  // Find nested folder by path (supports "Parent:Child" notation)
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

  // Find or create project for parent issue
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

  // Create task from Jira issue
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

  // Update task from Jira issue
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

  // Test connection
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
    console.log(`Authenticated as: ${myselfData.displayName}`);

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
