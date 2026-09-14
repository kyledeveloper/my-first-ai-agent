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

## Pre-Refactoring Blast-Radius Analysis Policy
- **Impact Assessment First**: Before modifying or refactoring existing core modules or exported functions in `src/`, the AI Agent should evaluate the blast radius using `node .agents/scripts/runner.js blast-radius --target <fileOrSymbol>`.
- **Targeted Test Execution**: After completing refactorings, verify all impacted test suites identified by the blast radius report to guarantee zero regressions across downstream callers.

## Ambiguous Intent Clarification Policy (大词与模糊意图反向澄清准则)
- **Macro Vision Term Interception (Hard Stop on Coding)**: Whenever a user prompt contains broad, unbounded macro terms (e.g., "build an e-commerce mall", "create a blog system", "build a social platform", "make an admin dashboard", "做一个商城/博客/社区/管理后台"), the AI Agent is **strictly prohibited from writing implementation code immediately**.
- **Interactive Socratic Interview (`/grill-me` & `ask_question`)**: The Agent must trigger a requirement discovery interview (channeling `/grill-me` via `ask_question` or structured multi-choice inquiry) to interrogate and clarify ambiguous assumptions, technical boundaries, core MVP scopes (v0.1 slicing), and business logic until the user's intent is deterministic and actionable.
- **Visual Blueprint First (`archify`)**: Once requirements and user stories are clarified, for any complex business logic, state transitions, or multi-step workflows, the Agent must first compile and deliver an interactive `archify` diagram (workflow/lifecycle HTML) for user visual confirmation and sign-off **before** initiating TDD red-green implementation.
