(() => {
  // Constants
  const CREDENTIAL_SERVICE = 'com.omnifocus.plugin.jira-sync';
  const SETTINGS_KEY = 'jiraSync.settings';
  // JIRA API Configuration
  const JIRA_API_VERSION = 3;
  const MAX_RESULTS_PER_PAGE = 1;
  // HTTP Status codes
  const HTTP_STATUS_OK = 200;
  const HTTP_STATUS_UNAUTHORIZED = 401;
  const HTTP_STATUS_FORBIDDEN = 403;
  const HTTP_STATUS_NOT_FOUND = 404;
  const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
  const HTTP_STATUS_BAD_REQUEST = 400;

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
          errorMessage += '\n\nPlease check your JQL query.';
        }
        break;
      case HTTP_STATUS_UNAUTHORIZED:
        errorMessage = 'Authentication failed. Your Jira API token may be invalid or expired.\n\nPlease check your Account ID and API token.';
        break;
      case HTTP_STATUS_FORBIDDEN:
        errorMessage = 'Access denied. Your Jira account does not have permission to access this resource.\n\nPlease check your Jira permissions or contact your Jira administrator.';
        break;
      case HTTP_STATUS_NOT_FOUND:
        errorMessage = 'Jira instance not found. The Jira URL may be incorrect.\n\nPlease verify your Jira URL (e.g., https://yourcompany.atlassian.net).';
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

  async function testConnection(jiraUrl, accountId, apiToken, jqlQuery) {
    const baseUrl = jiraUrl.replace(/\/$/, '');
    const searchUrl = `${baseUrl}/rest/api/${JIRA_API_VERSION}/search/jql`;

    // Test with a minimal query to verify connection and credentials
    const params = {
      jql: jqlQuery,
      maxResults: MAX_RESULTS_PER_PAGE,
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

  function getSettings() {
    const settingsString = preferences.read(SETTINGS_KEY);
    console.log('Reading settings:', settingsString);
    if (settingsString) {
      try {
        const parsed = JSON.parse(settingsString);
        console.log('Parsed settings:', JSON.stringify(parsed));
        return parsed;
      } catch (e) {
        console.error('Failed to parse settings:', e);
        return null;
      }
    }
    console.log('No settings found');
    return null;
  }

  function saveSettings(settings) {
    const settingsString = JSON.stringify(settings);
    console.log('Saving settings:', settingsString);
    preferences.write(SETTINGS_KEY, settingsString);
    console.log('Settings saved');
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

  function saveCredentials(accountId, apiToken) {
    credentials.write(CREDENTIAL_SERVICE, accountId, apiToken);
  }

  const action = new PlugIn.Action(async function(selection, sender) {
    try {
      const currentSettings = getSettings() || {};
      const currentCredentials = getCredentials() || {};

      const form = new Form();

      const jiraUrlField = new Form.Field.String(
        'jiraUrl',
        'JIRA URL',
        currentSettings.jiraUrl || ''
      );
      jiraUrlField.placeholder = 'https://yourcompany.atlassian.net';

      const accountIdField = new Form.Field.String(
        'accountId',
        'JIRA Account ID',
        currentCredentials.accountId || ''
      );
      accountIdField.placeholder = 'Your JIRA account ID';

      const apiTokenField = new Form.Field.Password(
        'apiToken',
        'JIRA API Token',
        currentCredentials.apiToken || ''
      );
      apiTokenField.placeholder = 'Your JIRA API token';

      const jqlQueryField = new Form.Field.String(
        'jqlQuery',
        'JQL Query',
        currentSettings.jqlQuery || ''
      );
      jqlQueryField.placeholder = 'assignee = currentUser() AND resolution = Unresolved';

      const tagNameField = new Form.Field.String(
        'tagName',
        'OmniFocus Tag',
        currentSettings.tagName || ''
      );
      tagNameField.placeholder = 'Work:JIRA';

      form.addField(jiraUrlField);
      form.addField(accountIdField);
      form.addField(apiTokenField);
      form.addField(jqlQueryField);
      form.addField(tagNameField);

      const formPrompt = 'Configure JIRA Sync Settings';
      const buttonTitle = 'Save';

      const formObject = await form.show(formPrompt, buttonTitle);

      // Validate required fields
      if (!formObject.values.jiraUrl || !formObject.values.accountId ||
          !formObject.values.apiToken || !formObject.values.jqlQuery ||
          !formObject.values.tagName) {
        throw new Error('All fields are required. Please fill in all configuration values.');
      }

      // Test connection before saving
      console.log('Testing Jira connection...');
      const testResult = await testConnection(
        formObject.values.jiraUrl,
        formObject.values.accountId,
        formObject.values.apiToken,
        formObject.values.jqlQuery
      );

      console.log('Connection test successful:', JSON.stringify(testResult));

      // Connection successful, save credentials and settings
      if (formObject.values.accountId && formObject.values.apiToken) {
        saveCredentials(formObject.values.accountId, formObject.values.apiToken);
      }

      const newSettings = {
        jiraUrl: formObject.values.jiraUrl,
        jqlQuery: formObject.values.jqlQuery,
        tagName: formObject.values.tagName,
        lastSyncTime: currentSettings.lastSyncTime || null
      };

      saveSettings(newSettings);

      const successMessage = `JIRA sync settings have been saved successfully.\n\nConnection test passed: Found ${testResult.issueCount} issue(s) matching your JQL query.`;
      new Alert('Configuration Saved', successMessage).show();
      console.log('JIRA sync configuration saved');

    } catch (error) {
      if (error.message !== 'User cancelled form') {
        console.error('Configuration failed:', error);
        new Alert('Configuration Failed', error.message).show();
      }
    }
  });

  action.validate = function(selection, sender) {
    return true;
  };

  return action;
})();
