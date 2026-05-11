# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains repository configuration (`.gitignore`) and local IDE metadata under `.idea/`; no application source, tests, or assets have been added yet. When code is introduced, keep the layout explicit:

- `src/` for production source code.
- `tests/` for automated tests, mirroring `src/` paths where practical.
- `assets/` or `public/` for static files such as images, fixtures, or sample data.
- `docs/` for design notes, API references, and contributor documentation.

Avoid committing machine-local editor state. `.DS_Store` and `.idea` are already ignored at the repository root.

## Build, Test, and Development Commands

There is no build system or package manager configured yet. Add commands through the project’s native tool file, such as `package.json`, `Makefile`, `pyproject.toml`, or `Cargo.toml`.

Document new commands here when they are added. Preferred examples:

- `npm install` - install JavaScript dependencies.
- `npm run dev` - start a local development server.
- `npm test` - run the full test suite.
- `make build` - produce a production build if a Makefile is used.

## Coding Style & Naming Conventions

Follow the formatter and linter configured for the language introduced. Until tooling exists, use 2-space indentation for JSON/YAML/Markdown and the idiomatic formatter for source files, such as Prettier, Black, `gofmt`, or `rustfmt`.

Use descriptive names. Prefer `kebab-case` for Markdown and config files (`contributor-guide.md`), `snake_case` for Python modules, and `camelCase` or `PascalCase` according to JavaScript/TypeScript conventions.

## Testing Guidelines

No test framework is configured yet. Add tests with the first source module. Place tests in `tests/` or beside source files only if the selected framework favors that pattern.

Use names that describe behavior, such as `test_parses_valid_config.py` or `user-service.test.ts`. Keep tests deterministic and avoid relying on local IDE settings or machine-specific paths.

## Commit & Pull Request Guidelines

The current Git history uses a short imperative commit style, for example: `add .gitignore to exclude .DS_Store and .idea files`. Continue using concise, lowercase, imperative summaries.

Pull requests should include a brief description, the reason for the change, commands run for verification, and screenshots or logs for user-facing behavior when relevant. Link related issues when available and call out any follow-up work clearly.

## Agent-Specific Instructions

Before editing, inspect the current tree and preserve unrelated user changes. Keep generated files focused and update this guide whenever new tooling, directories, or workflows become part of the repository.
