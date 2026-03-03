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

      // Step 1: Test authentication
      console.log('Testing Jira connection...');
      const authResult = await lib.testAuthentication(
        normalizedUrl,
        accountId,
        apiToken
      );
      lib.safeLog('Authentication successful:', authResult);

      // Step 2: Validate JQL query
      let jqlValid = true;
      let jqlError = null;
      let issueCount = 0;
      try {
        console.log('Validating JQL query...');
        const jqlResult = await lib.validateJql(
          normalizedUrl,
          accountId,
          apiToken,
          jqlQuery
        );
        issueCount = jqlResult.issueCount;
        lib.safeLog('JQL validation successful:', jqlResult);
      } catch (error) {
        jqlValid = false;
        jqlError = error.message;
        console.warn('JQL validation failed:', error.message);
      }

      // If JQL is invalid, ask user if they want to save anyway
      if (!jqlValid) {
        const warningAlert = new Alert(
          'JQL Query Warning',
          `Your JQL query could not be validated:\n\n${jqlError}\n\nWould you like to save the configuration anyway? You can fix the JQL query later.`
        );
        warningAlert.addOption('Save Anyway');
        warningAlert.addOption('Cancel');
        const choice = await warningAlert.show();
        if (choice === 1) {
          return;
        }
      }

      // Save credentials and settings
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

      let successMessage;
      if (jqlValid) {
        successMessage = `JIRA sync settings have been saved successfully.\n\nAuthenticated as: ${authResult.displayName}\nConnection test passed: Found ${issueCount} issue(s) matching your JQL query.`;
      } else {
        successMessage = `JIRA sync settings have been saved with warnings.\n\nAuthenticated as: ${authResult.displayName}\n\nWarning: Your JQL query could not be validated. Please check the query before syncing.`;
      }
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
