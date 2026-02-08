# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an OmniFocus plugin that provides one-way synchronization from Jira to OmniFocus. It fetches Jira issues using JQL queries and creates/updates corresponding tasks in OmniFocus.

## Plugin Structure

OmniFocus plugins use a specific file structure:

- **Plugin bundle**: `omnifocus-jira-sync.omnifocusjs/` (directory with `.omnifocusjs` extension)
- **Manifest**: `manifest.json` defines plugin metadata and available actions
- **Action files**: Individual JavaScript files in `Resources/` directory, one per action

Each action is an IIFE that returns a `PlugIn.Action` object with:

- An async function that performs the action
- A `validate` function that determines when the action is available

## Architecture

### Three Main Actions

1. **configureJira.js** - Configuration interface
   - Stores settings in OmniFocus Preferences API
   - Stores credentials in OmniFocus Credentials API (secure keychain)
   - Settings: JIRA URL, JQL query, OmniFocus tag name
   - Credentials: Account ID, API token

2. **syncJira.js** - Incremental sync
   - Fetches issues modified since last sync using JQL date filtering
   - Updates existing tasks or creates new ones
   - Uses `lastSyncTime` to build incremental JQL queries

3. **syncJiraFull.js** - Full refresh sync
   - Fetches all issues matching base JQL query
   - Additionally completes OmniFocus tasks that no longer exist in Jira results
   - Useful for cleanup when Jira issues are moved out of scope

### Data Storage

- **Settings** (stored in Preferences API under `jiraSync.settings`):
  - `jiraUrl`: Base Jira instance URL
  - `jqlQuery`: JQL query to filter issues
  - `tagName`: OmniFocus tag for synced tasks
  - `lastSyncTime`: ISO timestamp of last successful sync

- **Credentials** (stored in Credentials API under `com.omnifocus.plugin.jira-sync`):
  - `user`: Jira account ID
  - `password`: Jira API token

### Task Mapping

Jira issues map to OmniFocus tasks as follows:

- **Task name**: `[JIRA-KEY] Issue Summary`
- **Due date**: Synced from Jira's `duedate` field
- **Notes**: Contains Jira URL, status, and description (converted from Atlassian Document Format)
- **Tags**: Assigned the configured tag name
- **Status**:
  - `Done`, `Closed`, `Resolved` → Completed
  - `Withdrawn` → Dropped
  - Other statuses → Active (will reopen if previously completed/dropped)

### Key Implementation Details

**Task identification**: Tasks are found by looking for the `[JIRA-KEY]` prefix in the task name

**ADF parsing**: Jira descriptions use Atlassian Document Format (JSON). The `convertAdfToPlainText()` function recursively extracts text content.

**Base64 encoding**: Custom implementation since `btoa()` is not available in OmniFocus JavaScript environment. Required for Basic Auth headers.

**Pagination**: Jira API responses are paginated (100 issues at a time). The plugin loops through all pages using `startAt` parameter.

**Incremental sync**: Appends `AND updated >= "YYYY-MM-DD HH:MM"` to the JQL query to fetch only recently modified issues.

## Testing the Plugin

There is no automated test suite. Testing is done manually in OmniFocus:

1. Copy the plugin directory to `~/Library/Mobile Documents/iCloud~com~omnigroup~OmniFocus/Documents/Plug-Ins/`
2. Restart OmniFocus completely (Cmd+Q, then relaunch)
3. The plugin should appear in Automation → Plug-Ins
4. Run "Configure JIRA Sync" to set up credentials
5. Run "Sync Jira" or "Sync Jira Full" to test synchronization

**Debugging**: Use `console.log()` statements. View output in Console.app by filtering for "OmniFocus" process.

## Common Status Mappings

The plugin recognizes these Jira status names (case-sensitive):

- **Completed**: `Done`, `Closed`, `Resolved`
- **Dropped**: `Withdrawn`
- All other statuses keep tasks active/incomplete

To modify status mappings, edit the `COMPLETED_STATUSES` and `DROPPED_STATUSES` constants in both sync files.

## OmniFocus API Limitations

- No access to `btoa()` or standard Node.js modules
- Must use OmniFocus-specific APIs: `Preferences`, `Credentials`, `Task`, `Tag`, `Alert`, `Form`
- HTTP requests use `URL.FetchRequest` (not `fetch()` or `XMLHttpRequest`)
- All actions must be wrapped in IIFEs and return a `PlugIn.Action` object
