/* global PlugIn Form Alert */
(() => {
  const action = new PlugIn.Action(async function(selection, sender) {
    try {
      const lib = this.jiraCommon;
      const currentSettings = lib.getSettings() || {};
      const currentCredentials = lib.getCredentials() || {};

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

      const enableProjectOrgField = new Form.Field.Checkbox(
        'enableProjectOrganization',
        'Enable Project Organization',
        currentSettings.enableProjectOrganization || false
      );

      const defaultProjectFolderField = new Form.Field.String(
        'defaultProjectFolder',
        'Default Folder for Projects (optional)',
        currentSettings.defaultProjectFolder || ''
      );
      defaultProjectFolderField.placeholder = 'Leave empty for root level';

      form.addField(jiraUrlField);
      form.addField(accountIdField);
      form.addField(apiTokenField);
      form.addField(jqlQueryField);
      form.addField(tagNameField);
      form.addField(enableProjectOrgField);
      form.addField(defaultProjectFolderField);

      const formPrompt = 'Configure JIRA Sync Settings';
      const buttonTitle = 'Save';

      const formObject = await form.show(formPrompt, buttonTitle);

      // Trim whitespace from all inputs
      const jiraUrl = (formObject.values.jiraUrl || '').trim();
      const accountId = (formObject.values.accountId || '').trim();
      const apiToken = (formObject.values.apiToken || '').trim();
      const jqlQuery = (formObject.values.jqlQuery || '').trim();
      const tagName = (formObject.values.tagName || '').trim();
      const enableProjectOrganization = formObject.values.enableProjectOrganization || false;
      const defaultProjectFolder = (formObject.values.defaultProjectFolder || '').trim();

      // Validate required fields
      if (!jiraUrl || !accountId || !apiToken || !jqlQuery || !tagName) {
        throw new Error('All fields are required. Please fill in all configuration values.');
      }

      // Validate Jira URL format
      if (!jiraUrl.startsWith('https://')) {
        throw new Error('Jira URL must start with https:// for security.\n\nExample: https://yourcompany.atlassian.net');
      }

      // Basic URL format validation
      const urlPattern = /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(\/.*)?$/;
      if (!urlPattern.test(jiraUrl)) {
        throw new Error('Invalid Jira URL format. Please enter a valid URL.\n\nExample: https://yourcompany.atlassian.net');
      }

      // Validate tag name format (basic check)
      if (tagName.includes('/') || tagName.includes('\\')) {
        throw new Error('Tag name cannot contain forward slashes (/) or backslashes (\\\\).\n\nUse colons to create nested tags (e.g., "Work:JIRA").');
      }

      // Normalize URL (remove trailing slash)
      const normalizedUrl = jiraUrl.replace(/\/$/, '');

      // Test connection before saving
      console.log('Testing Jira connection...');
      const testResult = await lib.testConnection(
        normalizedUrl,
        accountId,
        apiToken,
        jqlQuery
      );

      console.log('Connection test successful:', JSON.stringify(testResult));

      // Connection successful, save credentials and settings
      lib.saveCredentials(accountId, apiToken);

      const newSettings = {
        jiraUrl: normalizedUrl,
        jqlQuery: jqlQuery,
        tagName: tagName,
        enableProjectOrganization: enableProjectOrganization,
        defaultProjectFolder: defaultProjectFolder,
        lastSyncTime: currentSettings.lastSyncTime || null
      };

      lib.saveSettings(newSettings);

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
