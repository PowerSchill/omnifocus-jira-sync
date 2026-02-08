(() => {
  // This action uses shared functions from lib/jiraCommon.js

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
