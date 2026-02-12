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

      const completedStatusesField = new Form.Field.String(
        'completedStatuses',
        'Completed Statuses (comma-separated)',
        Array.isArray(currentSettings.completedStatuses) ? currentSettings.completedStatuses.join(', ') : ''
      );
      completedStatusesField.placeholder = 'Done, Closed, Resolved';

      const droppedStatusesField = new Form.Field.String(
        'droppedStatuses',
        'Dropped Statuses (comma-separated)',
        Array.isArray(currentSettings.droppedStatuses) ? currentSettings.droppedStatuses.join(', ') : ''
      );
      droppedStatusesField.placeholder = 'Withdrawn';

      form.addField(jiraUrlField);
      form.addField(accountIdField);
      form.addField(apiTokenField);
      form.addField(jqlQueryField);
      form.addField(tagNameField);
      form.addField(enableProjectOrgField);
      form.addField(defaultProjectFolderField);
      form.addField(completedStatusesField);
      form.addField(droppedStatusesField);

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
      const completedStatusesRaw = (formObject.values.completedStatuses || '').trim();
      const droppedStatusesRaw = (formObject.values.droppedStatuses || '').trim();

      const completedStatuses = completedStatusesRaw
        ? completedStatusesRaw.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];
      const droppedStatuses = droppedStatusesRaw
        ? droppedStatusesRaw.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];

      // Validate required fields
      if (!jiraUrl || !accountId || !apiToken || !jqlQuery || !tagName) {
        throw new Error('All fields are required. Please fill in all configuration values.');
      }

      // Validate Jira URL format - enforce HTTPS with override option
      if (!jiraUrl.startsWith('https://')) {
        // Check if it's HTTP (insecure protocol)
        if (jiraUrl.startsWith('http://')) {
          const securityWarning = new Alert(
            'Security Warning: Insecure Connection',
            'Using HTTP instead of HTTPS will expose your credentials and data to potential interception.\n\n' +
            'HTTP connections are not encrypted and should only be used for local testing.\n\n' +
            'Do you want to proceed anyway?'
          );
          securityWarning.addOption('Cancel');
          securityWarning.addOption('Proceed with HTTP');
          
          const choice = await securityWarning.show();
          if (choice === 0) {
            // User chose to cancel
            throw new Error('Configuration cancelled. Please use HTTPS for secure connections.');
          }
          // User chose to proceed, continue with validation
        } else {
          // URL doesn't start with http:// or https://
          throw new Error('Jira URL must start with https:// for security.\n\nExample: https://yourcompany.atlassian.net');
        }
      }

      // Basic URL format validation (allow both http and https at this point)
      const urlPattern = /^https?:\/\/[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(\/.*)?$/;
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

      lib.safeLog('Connection test successful:', testResult);

      // Connection successful, save credentials and settings
      lib.saveCredentials(accountId, apiToken);

      const newSettings = {
        jiraUrl: normalizedUrl,
        jqlQuery: jqlQuery,
        tagName: tagName,
        enableProjectOrganization: enableProjectOrganization,
        defaultProjectFolder: defaultProjectFolder,
        completedStatuses: completedStatuses.length > 0 ? completedStatuses : undefined,
        droppedStatuses: droppedStatuses.length > 0 ? droppedStatuses : undefined,
        lastSyncTime: currentSettings.lastSyncTime || null
      };

      lib.saveSettings(newSettings);

      const successMessage = `JIRA sync settings have been saved successfully.\n\nAuthenticated as: ${testResult.displayName}\nConnection test passed: Found ${testResult.issueCount} issue(s) matching your JQL query.`;
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
