(() => {
  // This action uses shared functions from lib/jiraCommon.js

  async function performSync(fullRefresh) {
    const settings = getSettings();
    if (!settings) {
      throw new Error('JIRA sync is not configured. Please run "Configure JIRA Sync" first.');
    }

    const { jiraUrl, jqlQuery, tagName, lastSyncTime } = settings;
    if (!jiraUrl || !jqlQuery || !tagName) {
      throw new Error('JIRA sync configuration is incomplete. Please run "Configure JIRA Sync".');
    }

    const creds = getCredentials();
    if (!creds) {
      throw new Error('JIRA credentials not found. Please run "Configure JIRA Sync" to set up authentication.');
    }

    const { accountId, apiToken } = creds;
    console.log(`Starting ${fullRefresh ? 'full' : 'incremental'} JIRA sync...`);

    const issues = await fetchJiraIssues(jiraUrl, accountId, apiToken, jqlQuery, fullRefresh, lastSyncTime);
    console.log(`Fetched ${issues.length} issues from JIRA`);

    const stats = { created: 0, updated: 0, reopened: 0, completed: 0, skipped: 0 };

    for (const issue of issues) {
      const jiraKey = issue.key;
      const fields = issue.fields;
      const statusName = fields.status.name;
      const shouldSkipCreation = COMPLETED_STATUSES.includes(statusName) || DROPPED_STATUSES.includes(statusName);
      const existingTask = findTaskByJiraKey(jiraKey);

      if (existingTask) {
        const wasCompleted = existingTask.taskStatus === Task.Status.Completed;
        const wasDropped = existingTask.taskStatus === Task.Status.Dropped;
        const wasUpdated = updateTaskFromJiraIssue(existingTask, issue, jiraUrl);

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
        createTaskFromJiraIssue(issue, jiraUrl, tagName);
        stats.created++;
      } else {
        stats.skipped++;
      }
    }

    if (fullRefresh) {
      const tag = tagNamed(tagName);
      const existingTasks = tag ? tag.tasks : [];
      const issueKeysFromJira = new Set(issues.map(i => i.key));

      for (const task of existingTasks) {
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
    }

    const newSyncTime = new Date().toISOString();
    saveSettings({ ...settings, lastSyncTime: newSyncTime });
    return stats;
  }

  const action = new PlugIn.Action(async function(selection, sender) {
    try {
      const stats = await performSync(true);
      const message = `Full sync completed successfully!\n\nCreated: ${stats.created}\nUpdated: ${stats.updated}\nReopened: ${stats.reopened}\nCompleted: ${stats.completed}\nSkipped: ${stats.skipped}`;
      console.log(message);
      new Alert('JIRA Full Sync Complete', message).show();
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      console.error('Full sync failed:', errorMessage);
      new Alert('JIRA Full Sync Failed', errorMessage).show();
    }
  });

  action.validate = function(selection, sender) {
    return true;
  };

  return action;
})();
