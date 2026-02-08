# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-07

### Added

- Initial release of OmniFocus Jira Sync plugin
- One-way synchronization from Jira to OmniFocus using JQL queries
- Configuration interface for Jira credentials and sync settings
- Incremental sync to fetch only recently updated issues
- Full refresh sync to clean up tasks no longer in Jira results
- Automatic status mapping (Done/Closed/Resolved → Completed, Withdrawn → Dropped)
- Task deduplication based on Jira issue keys (`[JIRA-KEY]` prefix)
- Secure credential storage using macOS Keychain
- Sync statistics reporting (created, updated, reopened, completed counts)
- ADF (Atlassian Document Format) to plain text conversion for issue descriptions
- Custom Base64 encoding implementation for OmniFocus JavaScript environment
- Pagination support for fetching large numbers of Jira issues
- Task field synchronization (name, due date, notes, tags)
- Automatic task status updates based on Jira status changes
- Ability to reopen completed/dropped tasks when Jira status changes

### Features

- **Configure JIRA Sync**: Set up Jira URL, credentials, JQL query, and OmniFocus tag
- **Sync Jira**: Perform incremental sync of modified issues since last sync
- **Sync Jira Full**: Perform full refresh and mark orphaned tasks as completed

[Unreleased]: https://github.com/yourusername/omnifocus-jira-sync/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/omnifocus-jira-sync/releases/tag/v1.0.0
