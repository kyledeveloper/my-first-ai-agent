# Project Rules & Guidelines

## Git & Version Control Policy
- **Automatic Staging & Commit**: After completing and verifying code updates, the AI Agent should proactively run `git add` and `git commit -m "<descriptive message>"` to record the changes locally.
- **Push Policy**: **NEVER run `git push` automatically.** Pushing commits to remote repositories (GitHub) is strictly reserved for the USER to execute manually. Always prompt the user when commits are ready to push.

## Tiered Language & Communication Policy

| Layer | Language Standard | Rationale & Rules |
| :--- | :--- | :--- |
| **Core Code & Architecture** | **Strictly English** | Variable names, function identifiers, classes, interfaces, and code comments must be written in English to adhere to global engineering standards. |
| **Test Suites & Git Commits** | **Strictly English** | Test specs, assertion descriptions, test output logs, and Git commit messages must be in English for CI/CD and universal git log readability. |
| **CLI & User-Facing Tools** | **Adaptive i18n** | CLI tools (e.g. `.agents/scripts/`) must utilize the `src/i18n.js` dictionary engine to dynamically adapt outputs to the developer's environment (`$LANG`) or `--lang` flag. |
| **Project Documentation** | **Bilingual (EN + ZH)** | Maintain primary `README.md` (English) and secondary `README.zh-CN.md` (Chinese) with bidirectional navigation links at the top. |
| **Architecture Visualizations** | **Bilingual Showcase** | Visual architecture artifacts should provide both English and Chinese renders (e.g., `arch-en.html` and `arch-zh.html`) for multi-region audiences. |
| **Frontend UI Dictionaries** | **Multi-Locale Packs** | Frontend user-facing texts reside in `locales/{locale}/` dictionaries with 100% key synchronization across languages. |
| **Agent Chat Communication** | **Dynamic Language Match** | In conversational dialogs, strictly match the user's language: reply in Chinese if the user addresses you in Chinese, and reply in English if the user addresses you in English. |

## Test-Driven Development (TDD) & Self-Healing Policy
- **Red-Green-Refactor Flow**: For any new features or bug fixes, always write the reproducing or boundary test case first in `test/` (Red phase) before writing production logic (Green phase).
- **Offline Sandbox Execution**: All unit and integration tests run entirely inside the local execution environment without network dependencies, ensuring zero external token consumption on passing tests.
- **Self-Healing Loop**: If a test fails, capture the error trace, consult `reflexion-memory` for similar known issues, diagnose and repair root causes, and re-verify until 100% passing.

## Pre-Push Security & Code Quality Gatekeeper
- **Push-Time Gatekeeper Execution**: The security gatekeeper (`.agents/scripts/pre-push-check.js`) is triggered **strictly prior to `git push`** via the `.git/hooks/pre-push` hook or manually via `node .agents/scripts/runner.js pre-push-check`.
- **Hard Block on Sensitive Secrets**: Any unpushed commit containing hardcoded API keys (e.g., OpenAI, GitHub tokens, AWS keys, private keys) will be hard-blocked (exit code 1) from being pushed to remote repositories.
- **Dependency & Code Smell Advisories**: Automatically scans for high/critical CVEs via `npm audit` and flags code smell indicators (functions >80 lines, nesting depth >4) before pushing.
