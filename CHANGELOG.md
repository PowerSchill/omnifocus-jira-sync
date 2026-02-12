# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0](https://github.com/PowerSchill/omnifocus-jira-sync/compare/omnifocus-jira-sync-v1.2.0...omnifocus-jira-sync-v1.3.0) (2026-02-12)


### Features

* convert ADF to Markdown instead of plain text ([#71](https://github.com/PowerSchill/omnifocus-jira-sync/issues/71)) ([9d4b94b](https://github.com/PowerSchill/omnifocus-jira-sync/commit/9d4b94bda7c1bee637975bb3c4542001b3b03b9c))

## [1.2.0](https://github.com/PowerSchill/omnifocus-jira-sync/compare/omnifocus-jira-sync-v1.1.0...omnifocus-jira-sync-v1.2.0) (2026-02-11)


### Features

* add friendly menu labels and distinct icons ([#70](https://github.com/PowerSchill/omnifocus-jira-sync/issues/70)) ([2d74aeb](https://github.com/PowerSchill/omnifocus-jira-sync/commit/2d74aebb77300c9ccdc389f2af855f38f1da010d))
* add sync progress logging to console ([#69](https://github.com/PowerSchill/omnifocus-jira-sync/issues/69)) ([cea316b](https://github.com/PowerSchill/omnifocus-jira-sync/commit/cea316ba3f2f8c19b8c7c6f78a9c7c2d23d4145c))


### Bug Fixes

* pass required allOccurrences argument to Task.drop() ([0fbbfcb](https://github.com/PowerSchill/omnifocus-jira-sync/commit/0fbbfcbb0346da2e320e12c2de7bef9837669daa))
* validate credentials with /myself endpoint before saving config ([24ed45d](https://github.com/PowerSchill/omnifocus-jira-sync/commit/24ed45d87ecd3819db476d2fa13443264dcec4be))

## [1.1.0](https://github.com/PowerSchill/omnifocus-jira-sync/compare/omnifocus-jira-sync-v1.0.0...omnifocus-jira-sync-v1.1.0) (2026-02-08)


### Features

* add actionable error messages for Jira API failures ([85aa83d](https://github.com/PowerSchill/omnifocus-jira-sync/commit/85aa83d4c26f3da4c4ab416f582d5b1c5a06e514)), closes [#9](https://github.com/PowerSchill/omnifocus-jira-sync/issues/9)
* add API connection validation during configuration ([0008a3a](https://github.com/PowerSchill/omnifocus-jira-sync/commit/0008a3a9ebece9998162334058c5a11db317830b)), closes [#7](https://github.com/PowerSchill/omnifocus-jira-sync/issues/7)
* add comprehensive input validation to configuration ([#57](https://github.com/PowerSchill/omnifocus-jira-sync/issues/57)) ([286a539](https://github.com/PowerSchill/omnifocus-jira-sync/commit/286a53967d75afcb37eed80f5c0f86e3b4de86d0))
* add configurable status mappings for completed and dropped statuses ([#60](https://github.com/PowerSchill/omnifocus-jira-sync/issues/60)) ([d05f1c6](https://github.com/PowerSchill/omnifocus-jira-sync/commit/d05f1c63929e1af62a5d301521c63d5bd91d17b4))
* add initial implementation of Jira sync plugin with configuration and sync functionalities ([5cb1e1d](https://github.com/PowerSchill/omnifocus-jira-sync/commit/5cb1e1df9c49abe783acb41dddb48b692c42f03c))
* add retry logic with exponential backoff for network failures ([#59](https://github.com/PowerSchill/omnifocus-jira-sync/issues/59)) ([dd3cef1](https://github.com/PowerSchill/omnifocus-jira-sync/commit/dd3cef1c7b1860426ab04d3714dd6502813cb27f)), closes [#8](https://github.com/PowerSchill/omnifocus-jira-sync/issues/8)
* add task organization with automatic project assignment ([#58](https://github.com/PowerSchill/omnifocus-jira-sync/issues/58)) ([24965d6](https://github.com/PowerSchill/omnifocus-jira-sync/commit/24965d68dc0c82cc56d099dfb48ec5b85bbc8a04))


### Performance Improvements

* optimize task finding with index-based O(1) lookups ([#61](https://github.com/PowerSchill/omnifocus-jira-sync/issues/61)) ([c2a63f4](https://github.com/PowerSchill/omnifocus-jira-sync/commit/c2a63f4999ed496a8f400bc276a54aa0276b965e)), closes [#6](https://github.com/PowerSchill/omnifocus-jira-sync/issues/6)

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
