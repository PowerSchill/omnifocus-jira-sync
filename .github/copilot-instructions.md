# OmniFocus Jira Sync Plugin - Copilot Instructions

## Project Overview

This is an OmniFocus plugin that provides one-way synchronization from Jira to OmniFocus. It fetches Jira issues using JQL queries and creates/updates corresponding tasks in OmniFocus.

**Technology Stack:**
- JavaScript (ES6+)
- OmniFocus Plugin API
- Jira REST API

**Key Components:**
- Plugin bundle: `omnifocus-jira-sync.omnifocusjs/` (directory with `.omnifocusjs` extension)
- Manifest: `manifest.json` defines plugin metadata and available actions
- Action files: Individual JavaScript files in `Resources/` directory, one per action

## Plugin Architecture

### Three Main Actions

1. **configureJira.js** - Configuration interface
   - Stores settings in OmniFocus Preferences API
   - Stores credentials in OmniFocus Credentials API (secure keychain)

2. **syncJira.js** - Incremental sync
   - Fetches issues modified since last sync using JQL date filtering
   - Updates existing tasks or creates new ones

3. **syncJiraFull.js** - Full refresh sync
   - Fetches all issues matching base JQL query
   - Additionally completes OmniFocus tasks that no longer exist in Jira results

### Data Storage

- **Settings** stored in Preferences API under `jiraSync.settings`
- **Credentials** stored in Credentials API under `com.omnifocus.plugin.jira-sync`

## Testing

**No automated test suite exists.** Testing is done manually in OmniFocus:

1. Copy the plugin directory to `~/Library/Mobile Documents/iCloud~com~omnigroup~OmniFocus/Documents/Plug-Ins/`
2. Restart OmniFocus completely (Cmd+Q, then relaunch)
3. The plugin should appear in Automation → Plug-Ins
4. Run "Configure JIRA Sync" to set up credentials
5. Run "Sync Jira" or "Sync Jira Full" to test synchronization

**Debugging:** Use `console.log()` statements. View output in Console.app by filtering for "OmniFocus" process.

## Coding Standards

### JavaScript Style
- Use ES6+ features (arrow functions, const/let, async/await)
- No semicolons (existing code style)
- Use single quotes for strings
- Keep functions focused and small

### Plugin-Specific Conventions

- All actions must be wrapped in IIFEs (Immediately Invoked Function Expressions)
- Each action must return a `PlugIn.Action` object
- Actions must have an async function that performs the work
- Actions must have a `validate` function that determines when the action is available

### OmniFocus API Constraints

**Environment Limitations:**
- No access to `btoa()` or standard Node.js modules
- Must use OmniFocus-specific APIs: `Preferences`, `Credentials`, `Task`, `Tag`, `Alert`, `Form`
- HTTP requests use `URL.FetchRequest` (not `fetch()` or `XMLHttpRequest`)
- Must implement custom Base64 encoding for Basic Auth headers

### Key Implementation Patterns

**Task identification:** Tasks are found by looking for the `[JIRA-KEY]` prefix in the task name

**ADF parsing:** Jira descriptions use Atlassian Document Format (JSON). The `convertAdfToMarkdown()` function converts ADF to Markdown, preserving formatting like headings, lists, bold, italic, code, and links.

**Pagination:** Jira API responses are paginated (100 issues at a time). The plugin loops through all pages using `startAt` parameter.

**Incremental sync:** Appends `AND updated >= "YYYY-MM-DD HH:MM"` to the JQL query to fetch only recently modified issues.

## Status Mappings

The plugin recognizes these Jira status names (case-sensitive):

- **Completed**: `Done`, `Closed`, `Resolved`
- **Dropped**: `Withdrawn`
- All other statuses keep tasks active/incomplete

To modify status mappings, edit the `COMPLETED_STATUSES` and `DROPPED_STATUSES` constants in both sync files.

## Making Changes

### When Adding Features
1. Consider if it belongs in the incremental sync, full sync, or configuration action
2. Ensure changes work within OmniFocus API constraints
3. Test manually in OmniFocus after each change
4. Update README.md if adding user-facing features
5. Update CHANGELOG.md with version and changes

### When Fixing Bugs
1. Reproduce the issue manually in OmniFocus
2. Use `console.log()` for debugging (check Console.app)
3. Test fix in OmniFocus before committing
4. Consider if the fix applies to both sync actions

### When Refactoring
1. Maintain the IIFE + `PlugIn.Action` structure
2. Do not introduce Node.js dependencies (they won't work)
3. Keep shared logic in sync between syncJira.js and syncJiraFull.js
4. Test thoroughly in OmniFocus after refactoring

## File Organization

```
omnifocus-jira-sync.omnifocusjs/
├── manifest.json                 # Plugin metadata and action registry
└── Resources/
    ├── configureJira.js          # Configuration UI and settings management
    ├── syncJira.js               # Incremental sync implementation
    └── syncJiraFull.js           # Full sync with cleanup
```

## Security Considerations

- Credentials must always be stored via the Credentials API (macOS Keychain)
- Never log credentials or API tokens
- Use secure HTTPS for all Jira API requests
- The plugin is read-only on Jira (never modifies Jira issues)

## Common Pitfalls

1. **Don't use `btoa()`** - Implement custom Base64 encoding instead
2. **Don't use `fetch()` or `XMLHttpRequest`** - Use `URL.FetchRequest`
3. **Don't use Node.js modules** - They're not available in OmniFocus runtime
4. **Don't forget pagination** - Jira returns max 100 issues per request
5. **Don't assume stateless actions** - Settings and credentials persist between runs

## Resources

- [OmniFocus Plugin Documentation](https://omni-automation.com/omnifocus/plugins.html)
- [Jira REST API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Atlassian Document Format (ADF)](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
