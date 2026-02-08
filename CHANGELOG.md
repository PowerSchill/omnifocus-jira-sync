# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-08

### Added

- One-way synchronization from Jira to OmniFocus using JQL queries
- Configuration interface for Jira credentials and sync settings
- Incremental sync to fetch only recently updated issues
- Full refresh sync to clean up tasks no longer in Jira results
- Task deduplication based on Jira issue keys (`[JIRA-KEY]` prefix)
- Secure credential storage using macOS Keychain
- Sync statistics reporting (created, updated, reopened, completed counts)
- ADF (Atlassian Document Format) to plain text conversion for issue descriptions
- Custom Base64 encoding implementation for OmniFocus JavaScript environment
- Pagination support for fetching large numbers of Jira issues
- Task field synchronization (name, due date, notes, tags)
- Automatic task status updates based on Jira status changes
- Ability to reopen completed/dropped tasks when Jira status changes
- Configurable status mappings for completed and dropped statuses
- Automatic project organization based on Jira parent issues (epics)
- Configurable default folder for organized projects using colon-separated paths
- Comprehensive input validation with URL format checking and connection testing
- Retry logic with exponential backoff for transient network failures
- Indexed task and project lookups for O(1) performance during sync
- MIT license, contributing guidelines, and open source project files
- ESLint configuration and CI workflow for code quality

### Actions

- **Configure JIRA Sync**: Set up Jira URL, credentials, JQL query, OmniFocus tag, status mappings, and project organization
- **Sync Jira**: Perform incremental sync of modified issues since last sync
- **Sync Jira Full**: Perform full refresh and mark orphaned tasks as completed

[Unreleased]: https://github.com/PowerSchill/omnifocus-jira-sync/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/PowerSchill/omnifocus-jira-sync/releases/tag/v1.0.0
