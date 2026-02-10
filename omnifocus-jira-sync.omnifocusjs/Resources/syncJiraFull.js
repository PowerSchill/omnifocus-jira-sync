/* global PlugIn Alert Task tagNamed */
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
      console.log('Starting full JIRA sync...');

      const issues = await lib.fetchJiraIssues(jiraUrl, accountId, apiToken, jqlQuery, true, lastSyncTime);
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

      // Full refresh: complete tasks no longer in Jira
      const tag = tagNamed(tagName);
      const existingTasks = tag ? tag.tasks : [];
      const issueKeysFromJira = new Set(issues.map(i => i.key));

      for (const task of existingTasks) {
        // Skip if not a Task object (use instanceof to check)
        if (!(task instanceof Task)) {
          continue;
        }

        // Skip if this is a Project (Projects have a 'tasks' property)
        if (task.tasks !== undefined) {
          continue;
        }

        const match = task.name.match(/^\[([^\]]+)\]/);
        if (match) {
          const taskJiraKey = match[1];

          if (!issueKeysFromJira.has(taskJiraKey) &&
              task.taskStatus !== Task.Status.Completed &&
              task.taskStatus !== Task.Status.Dropped) {
            task.markComplete();
            stats.completed++;
            console.log(`Completed (no longer in JIRA): ${taskJiraKey}`);
          }
        }
      }

      const newSyncTime = new Date().toISOString();
      lib.saveSettings({ ...settings, lastSyncTime: newSyncTime });

      const message = `Full sync completed successfully!\n\nCreated: ${stats.created}\nUpdated: ${stats.updated}\nReopened: ${stats.reopened}\nCompleted: ${stats.completed}\nSkipped: ${stats.skipped}`;
      console.log(message);
      new Alert('JIRA Full Sync Complete', message).show();
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      console.error('Full sync failed:', errorMessage);
      new Alert('JIRA Full Sync Failed', errorMessage).show();
    }
  });

  /**
   * Validates whether the full sync action can be executed
   * @param {Object} selection - The current OmniFocus selection
   * @param {Object} sender - The sender of the action
   * @returns {boolean} Always returns true as full sync is always available
   */
  action.validate = function(selection, sender) {
    return true;
  };

  return action;
})();
