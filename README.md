# OmniFocus Jira Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/PowerSchill/omnifocus-jira-sync/actions/workflows/lint.yml/badge.svg)](https://github.com/PowerSchill/omnifocus-jira-sync/actions/workflows/lint.yml)

A one-way sync plugin that imports Jira issues into OmniFocus as tasks using JQL queries.

## Features

- **One-way sync** from Jira to OmniFocus (Jira is the source of truth)
- **JQL-based filtering** to sync only the issues you care about
- **Incremental sync** to fetch only recently updated issues
- **Full refresh sync** to clean up tasks no longer in Jira
- **Automatic status mapping** from Jira statuses to OmniFocus task states, with configurable mappings
- **Project organization** with automatic project assignment based on Jira parent issues
- **Secure credential storage** using macOS Keychain
- **Task deduplication** based on Jira issue keys
- **Retry logic** with exponential backoff for transient network failures
- **Input validation** with connection testing before saving configuration
- **Optimized performance** with index-based O(1) task lookups

## Installation

1. Download or clone this repository
2. Copy the `omnifocus-jira-sync.omnifocusjs` directory to:

   ```
   ~/Library/Mobile Documents/iCloud~com~omnigroup~OmniFocus/Documents/Plug-Ins/
   ```

3. Restart OmniFocus completely (⌘Q to quit, then relaunch)
4. The plugin should appear in **Automation → Plug-Ins**

## Configuration

Before syncing, you need to configure the plugin:

1. In OmniFocus, go to **Automation → Plug-Ins → Jira Sync**
2. Run **Configure JIRA Sync** (gear icon)
3. Fill in the required fields:
   - **JIRA URL**: Your Atlassian instance URL (e.g., `https://yourcompany.atlassian.net`)
   - **JIRA Account ID**: Your Jira account ID/email
   - **JIRA API Token**: Generate one at <https://id.atlassian.com/manage-profile/security/api-tokens>
   - **JQL Query**: The query to filter issues (e.g., `assignee = currentUser() AND resolution = Unresolved`)
   - **OmniFocus Tag**: Tag name to apply to synced tasks (e.g., `Work:JIRA`)
4. Click **Save**

## Usage

The plugin provides two sync options:

### Incremental Sync

Run **Sync Jira** to fetch issues modified since the last sync.

- Faster for regular updates
- Only fetches issues updated since last sync
- Recommended for daily use

### Full Refresh Sync

Run **Sync Jira Full** to fetch all matching issues and clean up orphaned tasks.

- Fetches all issues matching your JQL query
- Marks OmniFocus tasks as completed if they no longer appear in Jira results
- Useful when issues move out of scope or are deleted
- Recommended weekly or when troubleshooting

## Advanced Configuration

### Project Organization

Enable **Project Organization** in the configuration to automatically group tasks by their Jira parent issue (epic). When enabled:

- Tasks with a parent issue are placed in an OmniFocus Project named `[PARENT-KEY] Parent Summary`
- You can set a **Default Project Folder** using colon-separated paths (e.g., `Work:Jira:Epics`) to organize projects into nested folders
- Leave the folder field empty to create projects at the root level

### Custom Status Mappings

By default, these Jira statuses map to OmniFocus states:

- **Completed**: `Done`, `Closed`, `Resolved`
- **Dropped**: `Withdrawn`

You can customize these in the configuration by providing comma-separated lists of status names. For example, set completed statuses to `Done, Closed, Resolved, Finished` to also mark "Finished" issues as completed.

## How It Works

### Task Mapping

Each Jira issue is converted to an OmniFocus task:

- **Task name**: `[JIRA-KEY] Issue Summary`
- **Due date**: Synced from Jira's due date field
- **Notes**: Contains:
  - Link to the Jira issue
  - Current status
  - Issue description
- **Tags**: Assigned the configured tag name

### Status Synchronization

Jira statuses are mapped to OmniFocus task states:

| Jira Status | OmniFocus State |
|-------------|-----------------|
| Done        | Completed       |
| Closed      | Completed       |
| Resolved    | Completed       |
| Withdrawn   | Dropped         |
| Other       | Active          |

Tasks will be reopened (marked incomplete) if their Jira status changes from completed to active.

### Task Updates

The plugin intelligently updates existing tasks:

- Tasks are identified by the `[JIRA-KEY]` prefix
- Only modified fields are updated
- Status changes are tracked and reported
- Completed/dropped tasks can be reopened if Jira status changes

## Sync Statistics

After each sync, you'll see statistics showing:

- **Created**: New tasks created from Jira issues
- **Updated**: Existing tasks that were modified
- **Reopened**: Completed/dropped tasks that became active again
- **Completed**: Tasks marked as completed (full sync only)

## Troubleshooting

### Plugin doesn't appear in OmniFocus

1. Verify the plugin is in the correct directory
2. Make sure the directory name ends with `.omnifocusjs`
3. Completely restart OmniFocus (⌘Q, not just close window)
4. Check Console.app for errors (filter for "OmniFocus")

### Sync fails with authentication error

1. Verify your Jira URL is correct (include `https://`)
2. Regenerate your API token at <https://id.atlassian.com/manage-profile/security/api-tokens>
3. Re-run **Configure JIRA Sync** with the new token

### Issues not syncing

1. Test your JQL query in Jira's issue search
2. Verify the query returns the expected issues
3. Check that issues have been updated since last sync (for incremental sync)
4. Try running **Sync Jira Full** to force a complete refresh

### Duplicate tasks appearing

Tasks are deduplicated by their `[JIRA-KEY]` prefix. If you see duplicates:

1. Check if tasks have different prefixes
2. Manually delete duplicates
3. Run **Sync Jira Full** to clean up

## Privacy & Security

- **Credentials** are stored securely in the macOS Keychain via OmniFocus Credentials API
- **Settings** (URL, JQL query, tag name) are stored in OmniFocus preferences
- **No data** is sent anywhere except to your configured Jira instance
- The plugin is **read-only** on Jira (it never modifies your Jira issues)

## Development

See [CLAUDE.md](CLAUDE.md) for technical documentation about the plugin architecture and implementation details.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Reporting bugs and requesting features
- Development setup and manual testing
- Coding standards and commit conventions
- The pull request process

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
