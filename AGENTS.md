# Project Rules & Guidelines

## Git & Version Control Policy
- **Automatic Staging & Commit**: After completing and verifying code updates, the AI Agent should proactively run `git add` and `git commit -m "<descriptive message>"` to record the changes locally.
- **Push Policy**: **NEVER run `git push` automatically.** Pushing commits to remote repositories (GitHub) is strictly reserved for the USER to execute manually. Always prompt the user when commits are ready to push.

## Language & Communication Policy
- **Code & Comments**: All project code, comments, docstrings, internal documentation, test suites, CLI tools, and Git commit messages must be written in English.
- **Frontend UI Exception**: Chinese is allowed only when specifically required for frontend web user interfaces and localization resource files (e.g., `locales/zh-CN/`).
- **User Communication**: In chat conversations, match the user's language — respond in Chinese if the user addresses you in Chinese, and respond in English if the user addresses you in English.
