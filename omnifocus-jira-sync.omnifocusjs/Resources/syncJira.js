/* global PlugIn Alert Task */
(() => {
  const action = new PlugIn.Action(async function(selection, sender) {
    try {
      const lib = this.jiraCommon;

      const settings = lib.getSettings();
      if (!settings) {
        throw new Error('JIRA sync is not configured. Please run "Configure JIRA Sync" first.');
      }

      const { jiraUrl, jqlQuery, tagName, lastSyncTime } = settings;
      if (!jiraUrl || !jqlQuery || !tagName) {
        throw new Error('JIRA sync configuration is incomplete. Please run "Configure JIRA Sync".');
      }

      const creds = lib.getCredentials();
      if (!creds) {
        throw new Error('JIRA credentials not found. Please run "Configure JIRA Sync" to set up authentication.');
      }

      const { accountId, apiToken } = creds;
      console.log('Starting incremental JIRA sync...');

      const issues = await lib.fetchJiraIssues(jiraUrl, accountId, apiToken, jqlQuery, false, lastSyncTime);
      console.log(`Fetched ${issues.length} issues from JIRA`);

      const stats = { created: 0, updated: 0, reopened: 0, completed: 0, skipped: 0 };

      // Build indexes for O(1) lookups instead of O(n) scans per issue
      const taskIndex = lib.buildTaskIndex();
      const projectIndex = settings.enableProjectOrganization ? lib.buildProjectIndex() : null;

      for (const issue of issues) {
        const jiraKey = issue.key;
        const fields = issue.fields;
        const statusName = fields.status.name;
        const statusMappings = lib.getStatusMappings(settings);
        const shouldSkipCreation = statusMappings.completed.includes(statusName) || statusMappings.dropped.includes(statusName);
        const existingTask = lib.findTaskByJiraKeyIndexed(taskIndex, jiraKey);

        if (existingTask) {
          const wasCompleted = existingTask.taskStatus === Task.Status.Completed;
          const wasDropped = existingTask.taskStatus === Task.Status.Dropped;
          const wasUpdated = lib.updateTaskFromJiraIssue(existingTask, issue, jiraUrl, tagName, settings, projectIndex);

          if (wasUpdated) {
            const isNowCompleted = existingTask.taskStatus === Task.Status.Completed;
            const isNowDropped = existingTask.taskStatus === Task.Status.Dropped;

            if ((wasCompleted || wasDropped) && !isNowCompleted && !isNowDropped) {
              stats.reopened++;
            } else if (!wasCompleted && isNowCompleted) {
              stats.completed++;
            } else {
              stats.updated++;
            }
          }
        } else if (!shouldSkipCreation) {
          lib.createTaskFromJiraIssue(issue, jiraUrl, tagName, settings, projectIndex);
          stats.created++;
        } else {
          stats.skipped++;
        }
      }

      const newSyncTime = new Date().toISOString();
      lib.saveSettings({ ...settings, lastSyncTime: newSyncTime });

      const message = `Sync completed successfully!\n\nCreated: ${stats.created}\nUpdated: ${stats.updated}\nReopened: ${stats.reopened}\nCompleted: ${stats.completed}\nSkipped: ${stats.skipped}`;
      console.log(message);
      new Alert('JIRA Sync Complete', message).show();
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      console.error('Sync failed:', errorMessage);
      new Alert('JIRA Sync Failed', errorMessage).show();
    }
  });

  action.validate = function(selection, sender) {
    return true;
  };

  return action;
})();
