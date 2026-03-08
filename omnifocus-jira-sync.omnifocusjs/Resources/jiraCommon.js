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
   * Logs a message to the console while automatically redacting sensitive fields
   * to prevent credential leakage in log output.
   * @param {string} message - The message to log
   * @param {*} [obj] - Optional object to log alongside the message (sensitive fields will be redacted)
   */
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

    /**
     * Recursively redacts values of sensitive keys within an object (mutates in place).
     * @param {Object} obj - The object to sanitize
     * @returns {Object} The sanitized object
     */
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

  /**
   * Encodes a string to Base64 format.
   * Provided as a custom implementation because `btoa()` is not available in the
   * OmniFocus JavaScript environment.
   * @param {string} str - The string to encode
   * @returns {string} The Base64-encoded string
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
   * Executes an HTTP request with automatic retry logic and exponential backoff.
   * Retries on transient errors (rate limiting, server errors) and respects
   * `Retry-After` headers for 429 responses. Non-retryable errors (4xx) are thrown immediately.
   * @param {URL.FetchRequest} request - The configured fetch request to execute
   * @returns {Promise<URL.FetchResponse>} The successful HTTP response (status 200)
   * @throws {Error} If the request fails after all retry attempts or returns a non-retryable error
   */
  jiraCommon.fetchWithRetry = async (request) => {
    /**
     * Returns a promise that resolves after the given number of milliseconds.
     * @param {number} ms - Milliseconds to wait
     * @returns {Promise<void>}
     */
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
   * Creates a human-readable, actionable error message from a Jira API HTTP error response.
   * Attempts to extract Jira-specific error details from the response body.
   * @param {number} statusCode - The HTTP status code returned by Jira
   * @param {string} responseBody - The raw response body string (may contain JSON error details)
   * @returns {string} A descriptive error message with guidance on how to resolve the issue
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
   * Returns the effective Jira→OmniFocus status mappings, using user-configured values when
   * available and falling back to the built-in defaults otherwise.
   * @param {Object} settings - The current plugin settings object
   * @param {string[]} [settings.completedStatuses] - Custom list of Jira statuses that map to Completed
   * @param {string[]} [settings.droppedStatuses] - Custom list of Jira statuses that map to Dropped
   * @returns {{ completed: string[], dropped: string[] }} The effective status mapping arrays
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
   * Reads and deserializes plugin settings from the OmniFocus Preferences API.
   * @returns {Object|null} The parsed settings object, or null if not yet configured or on parse error
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
   * Serializes and persists plugin settings to the OmniFocus Preferences API.
   * @param {Object} settings - The settings object to save
   */
  jiraCommon.saveSettings = (settings) => {
    preferences.write(jiraCommon.SETTINGS_KEY, JSON.stringify(settings));
  };

  /**
   * Retrieves Jira credentials from the OmniFocus secure Credentials API (system keychain).
   * @returns {{ accountId: string, apiToken: string }|null} The stored credentials, or null if not found
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
   * Saves Jira credentials to the OmniFocus secure Credentials API (system keychain).
   * Any previously stored credentials for this service are replaced before writing.
   * @param {string} accountId - The Jira account ID (stored as username)
   * @param {string} apiToken - The Jira API token (stored as password)
   */
  jiraCommon.saveCredentials = (accountId, apiToken) => {
    credentials.remove(jiraCommon.CREDENTIAL_SERVICE);
    credentials.write(jiraCommon.CREDENTIAL_SERVICE, accountId, apiToken);
  };

  /**
   * Fetches all Jira issues matching the given JQL query, handling token-based pagination automatically.
   * For incremental syncs, appends an `updated >=` clause to the JQL to limit results to recently
   * modified issues.
   * @param {string} jiraUrl - The base Jira instance URL (e.g., https://yourcompany.atlassian.net)
   * @param {string} accountId - The Jira account ID for Basic Auth
   * @param {string} apiToken - The Jira API token for Basic Auth
   * @param {string} jql - The base JQL query string
   * @param {boolean} [fullRefresh=false] - If true, fetches all matching issues ignoring lastSyncTime
   * @param {string|null} [lastSyncTime=null] - ISO timestamp of the last successful sync;
   *   appended to JQL as a date filter when fullRefresh is false
   * @returns {Promise<Object[]>} Array of Jira issue objects from the API response
   * @throws {Error} If the API request fails or the Jira server returns an error response
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
        console.log('Fetching next page...');
      } else {
        nextPageToken = null;
        console.log(`Pagination complete: fetched all ${allIssues.length} issues`);
      }
    } while (nextPageToken);

    return allIssues;
  };

  /**
   * Converts an Atlassian Document Format (ADF) document object to a Markdown string.
   * Supports paragraphs, headings (h1–h6), ordered/unordered lists (with nesting),
   * code blocks, inline code, bold, italic, strikethrough, underline, links, blockquotes,
   * hard breaks, horizontal rules, mentions, emoji, and inline/single media cards.
   * @param {Object} adf - The ADF document object as returned by the Jira API `description` field
   * @returns {string} Markdown string representation, or an empty string if the input is invalid
   */
  jiraCommon.convertAdfToMarkdown = (adf) => {
    if (!adf || typeof adf !== 'object') {
      return '';
    }

    let markdown = '';

    /**
     * Recursively converts a single ADF node and its children to a Markdown string.
     * @param {Object} node - The ADF node object to convert
     * @param {Object} [context={}] - Context inherited from parent nodes
     * @param {'bullet'|'ordered'} [context.listType] - Set by parent list nodes to determine bullet style
     * @param {number} [context.listDepth] - Nesting depth for indentation of list items
     * @param {number} [context.listIndex] - 1-based position of the current ordered list item
     * @returns {string} Markdown string for this node and all its descendants
     */
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
            // Trim trailing newlines to avoid empty lines, then add > prefix to each line
            const trimmedContent = quoteContent.replace(/\n+$/, '');
            result = trimmedContent.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
          }
          break;

        case 'emoji':
          // Emoji shortcode (e.g., :smile:)
          // Note: OmniFocus may not render these as actual emoji
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

  /**
   * Alias for {@link convertAdfToMarkdown}, maintained for backwards compatibility.
   * @deprecated Use `convertAdfToMarkdown` instead. This alias will be kept indefinitely.
   * @type {typeof jiraCommon.convertAdfToMarkdown}
   */
  jiraCommon.convertAdfToPlainText = jiraCommon.convertAdfToMarkdown;

  /**
   * Searches all OmniFocus tasks for one whose name begins with the given Jira key prefix.
   * Performs a linear scan — prefer {@link findTaskByJiraKeyIndexed} when processing many issues.
   * @param {string} jiraKey - The Jira issue key (e.g., 'PROJ-123')
   * @returns {Task|null} The first matching OmniFocus Task, or null if not found
   */
  jiraCommon.findTaskByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const tasks = flattenedTasks.filter(task => task.name.startsWith(prefix));
    return tasks.length > 0 ? tasks[0] : null;
  };

  /**
   * Searches all OmniFocus projects for one whose name begins with the given Jira key prefix.
   * Performs a linear scan — prefer {@link findProjectByJiraKeyIndexed} when processing many issues.
   * @param {string} jiraKey - The Jira issue key (e.g., 'PROJ-123')
   * @returns {Project|null} The first matching OmniFocus Project, or null if not found
   */
  jiraCommon.findProjectByJiraKey = (jiraKey) => {
    const prefix = `[${jiraKey}]`;
    const projects = flattenedProjects.filter(project => project.name.startsWith(prefix));
    return projects.length > 0 ? projects[0] : null;
  };

  /**
   * Builds a `Map<jiraKey, Task>` index from all OmniFocus tasks for O(1) lookups.
   * Call this once before processing a batch of issues, then use
   * {@link findTaskByJiraKeyIndexed} to look up tasks without rescanning.
   * @returns {Map<string, Task>} Map where each key is a Jira issue key (e.g., 'PROJ-123')
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
   * Builds a `Map<jiraKey, Project>` index from all OmniFocus projects for O(1) lookups.
   * Call this once before processing a batch of issues, then use
   * {@link findProjectByJiraKeyIndexed} to look up projects without rescanning.
   * @returns {Map<string, Project>} Map where each key is a Jira issue key (e.g., 'PROJ-123')
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
   * Looks up an OmniFocus Task by Jira key using a pre-built index for O(1) performance.
   * @param {Map<string, Task>} index - Task index created by {@link buildTaskIndex}
   * @param {string} jiraKey - The Jira issue key to look up (e.g., 'PROJ-123')
   * @returns {Task|null} The matching OmniFocus Task, or null if not found
   */
  jiraCommon.findTaskByJiraKeyIndexed = (index, jiraKey) => {
    return index.get(jiraKey) || null;
  };

  /**
   * Looks up an OmniFocus Project by Jira key using a pre-built index for O(1) performance.
   * @param {Map<string, Project>} index - Project index created by {@link buildProjectIndex}
   * @param {string} jiraKey - The Jira issue key to look up (e.g., 'PROJ-123')
   * @returns {Project|null} The matching OmniFocus Project, or null if not found
   */
  jiraCommon.findProjectByJiraKeyIndexed = (index, jiraKey) => {
    return index.get(jiraKey) || null;
  };

  /**
   * Resolves the parent container for a Jira sub-task using pre-built indexes.
   * Prefers an existing OmniFocus Task (which will become a task group) over a Project.
   * Returns null when neither exists — callers should then create a flat top-level task.
   * @param {Map<string, Task>|null} taskIndex - Task index created by {@link buildTaskIndex}
   * @param {Map<string, Project>|null} projectIndex - Project index created by {@link buildProjectIndex}
   * @param {string} parentKey - The Jira key of the parent issue (e.g., 'PROJ-100')
   * @returns {Task|Project|null} The parent Task or Project, or null if neither exists in OmniFocus
   */
  jiraCommon.findParentContainer = (taskIndex, projectIndex, parentKey) => {
    if (taskIndex) {
      const parentTask = jiraCommon.findTaskByJiraKeyIndexed(taskIndex, parentKey);
      if (parentTask) {
        return parentTask;
      }
    }
    if (projectIndex) {
      const parentProject = jiraCommon.findProjectByJiraKeyIndexed(projectIndex, parentKey);
      if (parentProject) {
        return parentProject;
      }
    }
    return null;
  };

  /**
   * Resolves an OmniFocus Folder by a colon-delimited path string.
   * Each segment is treated as a child folder of the previous one
   * (e.g., `"Work:Projects:JIRA"` navigates three levels deep).
   * @param {string} folderPath - Colon-delimited folder path (e.g., `'Work'` or `'Work:Projects'`)
   * @returns {Folder|null} The resolved OmniFocus Folder, or null if any path segment is not found
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
   * Finds an existing OmniFocus Project for a Jira parent issue, or creates one if none exists.
   * New projects are placed in the specified folder; if the folder cannot be found they are
   * created at root level.
   * @param {string} parentKey - The Jira key of the parent issue (e.g., 'PROJ-100')
   * @param {string} parentSummary - The summary/title of the parent Jira issue
   * @param {string} tagName - The OmniFocus tag name to assign to newly created projects
   * @param {string} defaultFolder - Colon-delimited OmniFocus folder path for new projects (may be empty)
   * @param {Map<string, Project>|null} [projectIndex=null] - Optional pre-built project index for O(1) lookup
   * @returns {Project} The found or newly created OmniFocus Project
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
   * Creates a new OmniFocus Task from a Jira issue object.
   * Sets the task name, due date, notes (Jira URL + status + converted ADF description), and tag.
   * When project organization is enabled and the issue has a parent that already exists in
   * OmniFocus, the task is created as a child of that parent container.
   * @param {Object} issue - A Jira issue object as returned by the Jira search API
   * @param {string} jiraUrl - The base Jira instance URL
   * @param {string} tagName - The OmniFocus tag name to assign to the task
   * @param {Object} [settings={}] - Plugin settings (used for project organization configuration)
   * @param {Map<string, Project>|null} [projectIndex=null] - Pre-built project index for parent lookup
   * @param {Map<string, Task>|null} [taskIndex=null] - Pre-built task index for parent lookup
   * @returns {Task} The newly created OmniFocus Task
   */
  jiraCommon.createTaskFromJiraIssue = (issue, jiraUrl, tagName, settings = {}, projectIndex = null, taskIndex = null) => {
    const jiraKey = issue.key;
    const fields = issue.fields;
    const taskName = `[${jiraKey}] ${fields.summary}`;

    // Determine parent container (existing Task or Project — no auto-creation)
    let parent = null;
    if (settings.enableProjectOrganization && fields.parent) {
      const parentKey = fields.parent.key;
      parent = jiraCommon.findParentContainer(taskIndex, projectIndex, parentKey);
      if (!parent) {
        console.log(`Parent ${parentKey} not found in OmniFocus; creating ${jiraKey} as flat task`);
      }
    }

    // Create task under parent container or at root
    const task = parent ? new Task(taskName, parent) : new Task(taskName);

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
   * Updates an existing OmniFocus Task with the latest data from a Jira issue.
   * Applies changes to the task name, due date, notes, project assignment (when organization
   * is enabled), and completion/dropped status based on the current Jira status.
   * Tasks are reopened (marked incomplete) if their Jira status is no longer terminal.
   * @param {Task} task - The existing OmniFocus Task to update
   * @param {Object} issue - The Jira issue object with current field values
   * @param {string} jiraUrl - The base Jira instance URL
   * @param {string} tagName - The OmniFocus tag name (used when creating parent projects)
   * @param {Object} [settings={}] - Plugin settings (used for status mappings and project organization)
   * @param {Map<string, Project>|null} [projectIndex=null] - Pre-built project index for parent lookup
   * @returns {boolean} True if any field was changed, false if the task was already up to date
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
   * Verifies Jira credentials by calling the `/rest/api/3/myself` endpoint.
   * @param {string} jiraUrl - The base Jira instance URL
   * @param {string} accountId - The Jira account ID for Basic Auth
   * @param {string} apiToken - The Jira API token for Basic Auth
   * @returns {Promise<{ displayName: string }>} Object containing the authenticated user's display name
   * @throws {Error} If authentication fails or the network request errors
   */
  jiraCommon.testAuthentication = async (jiraUrl, accountId, apiToken) => {
    const baseUrl = jiraUrl.replace(/\/$/, '');
    const auth = jiraCommon.base64Encode(`${accountId}:${apiToken}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const myselfUrl = `${baseUrl}/rest/api/${jiraCommon.JIRA_API_VERSION}/myself`;
    const myselfRequest = URL.FetchRequest.fromString(myselfUrl);
    myselfRequest.method = 'GET';
    myselfRequest.headers = headers;
    myselfRequest.allowsCellularAccess = true;

    const myselfResponse = await jiraCommon.fetchWithRetry(myselfRequest);
    const myselfData = JSON.parse(myselfResponse.bodyString);
    console.log(`Authenticated as: ${myselfData.displayName}`);

    return { displayName: myselfData.displayName };
  };

  /**
   * Validates a JQL query by executing it against the Jira search API with `maxResults=1`.
   * Returns the total matching issue count if the query is syntactically and semantically valid.
   * @param {string} jiraUrl - The base Jira instance URL
   * @param {string} accountId - The Jira account ID for Basic Auth
   * @param {string} apiToken - The Jira API token for Basic Auth
   * @param {string} jqlQuery - The JQL query string to validate
   * @returns {Promise<{ issueCount: number }>} Object containing the total number of matching issues
   * @throws {Error} If the JQL query is invalid or the API request fails
   */
  jiraCommon.validateJql = async (jiraUrl, accountId, apiToken, jqlQuery) => {
    const baseUrl = jiraUrl.replace(/\/$/, '');
    const auth = jiraCommon.base64Encode(`${accountId}:${apiToken}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

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

    return { issueCount: data.total || 0 };
  };

  /**
   * Performs a full connection test combining credential verification and JQL validation.
   * Calls {@link testAuthentication} followed by {@link validateJql} and merges the results.
   * @param {string} jiraUrl - The base Jira instance URL
   * @param {string} accountId - The Jira account ID for Basic Auth
   * @param {string} apiToken - The Jira API token for Basic Auth
   * @param {string} jqlQuery - The JQL query to validate
   * @returns {Promise<{ success: boolean, displayName: string, issueCount: number }>} Combined test result
   * @throws {Error} If authentication fails or the JQL query is invalid
   */
  jiraCommon.testConnection = async (jiraUrl, accountId, apiToken, jqlQuery) => {
    const authResult = await jiraCommon.testAuthentication(jiraUrl, accountId, apiToken);
    const jqlResult = await jiraCommon.validateJql(jiraUrl, accountId, apiToken, jqlQuery);

    return {
      success: true,
      displayName: authResult.displayName,
      issueCount: jqlResult.issueCount
    };
  };

  return jiraCommon;
})();
