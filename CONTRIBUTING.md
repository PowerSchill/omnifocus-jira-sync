# Contributing to OmniFocus Jira Sync

Thank you for your interest in contributing! This guide will help you get started.

## Reporting Bugs

1. **Search existing issues** first to avoid duplicates
2. Open a new issue using the **Bug Report** template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - OmniFocus and macOS versions
   - Relevant Console.app logs (filter for "OmniFocus")

## Requesting Features

1. Open a new issue using the **Feature Request** template
2. Describe the problem you're trying to solve
3. Propose a solution and any alternatives you've considered

## Development Setup

### Prerequisites

- macOS with [OmniFocus](https://www.omnigroup.com/omnifocus) installed
- Node.js (for linting only)
- A Jira instance with API access (for manual testing)

### Getting Started

1. Fork and clone the repository
2. Install linting dependencies:

   ```bash
   npm install
   ```

3. Symlink or copy the plugin to the OmniFocus Plug-Ins directory:

   ```
   ~/Library/Mobile Documents/iCloud~com~omnigroup~OmniFocus/Documents/Plug-Ins/
   ```

4. Restart OmniFocus completely (Cmd+Q, then relaunch)

### Manual Testing

There is no automated test suite. OmniFocus plugins must be tested manually:

1. Make your changes to the plugin files
2. Restart OmniFocus to pick up changes
3. Run **Configure JIRA Sync** to set up credentials
4. Run **Sync Jira** or **Sync Jira Full** to test
5. Check Console.app (filter for "OmniFocus") for debug output

## Coding Standards

### Language & Environment

- **ES6+** syntax (const/let, arrow functions, async/await, template literals, destructuring)
- **No Node.js or browser APIs** — OmniFocus has its own JavaScript environment
- `btoa()`, `fetch()`, and `XMLHttpRequest` are **not available**
- Use `URL.FetchRequest` for HTTP requests

### Style

- 2-space indentation
- Single quotes for strings
- Semicolons required
- camelCase for variables and functions
- UPPER_CASE for constants
- Wrap action files in IIFEs that return a `PlugIn.Action` object

### Linting

Run ESLint before submitting:

```bash
npm run lint
```

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `perf`

Examples:

- `feat: add support for custom field mapping`
- `fix: handle empty JQL query gracefully`
- `docs: update installation instructions`

## Pull Request Process

1. **Create a feature branch** from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with conventional commit messages
3. **Run the linter** to ensure code quality:

   ```bash
   npm run lint
   ```

4. **Test manually** in OmniFocus
5. **Open a Pull Request** against `main`
6. Fill out the PR template checklist
7. Wait for review and address any feedback

### PR Guidelines

- Keep PRs focused on a single change
- Update the CHANGELOG.md under `[Unreleased]` for user-facing changes
- Squash merge is preferred for clean history
