(() => {
  // Constants
  const CREDENTIAL_SERVICE = 'com.omnifocus.plugin.jira-sync';
  const SETTINGS_KEY = 'jiraSync.settings';

  // Create API instances
  const preferences = new Preferences();
  const credentials = new Credentials();

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

      new Alert('Configuration Saved', 'JIRA sync settings have been saved successfully.').show();
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
