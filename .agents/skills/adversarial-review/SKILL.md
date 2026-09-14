---
name: adversarial-review
description: Adversarial Red-Blue dual-agent review process. Mandates a cold-eye, isolated auditor perspective before committing non-trivial changes, evaluating ACID transactions, hermetic sandbox test isolation, regex boundaries, and VCS cleanliness.
user-invocable: true
---

# Adversarial Code Review (Red-Blue Dual-Agent Protocol)

This skill operationalizes a **Red-Team Auditor** mindset to break the "Author Bias" trap where builders overlook secondary failure modes during delivery.

---

## 1. The Four Cold-Eye Lenses

Before any core commit, the diff must be evaluated against four strict criteria:

1. **ACID Transaction Completeness**:
   - Any multi-step database writes (e.g. inserting episodes + reflections + FTS5 index) must be wrapped inside atomic transactions (`db.transaction()`).
   - If an error occurs midway, state must cleanly roll back with zero orphaned rows or ghost index entries.
2. **Hermetic Test Isolation**:
   - Unit tests must NEVER mutate the real workspace, user `.git/` directory, or real configuration files.
   - Tests altering filesystem state must allocate a temporary sandbox directory via `os.tmpdir()` + `fs.mkdtempSync()`, and guarantee cleanup in `finally` or teardown.
3. **Regex Boundary & False-Positive Defense**:
   - Secret scanners and AST tokenizers must use exact word boundaries (`\b` or negative lookarounds/lookbehinds).
   - Verify that substrings in legitimate identifiers (e.g. `disk-sk-...`, `task-sk-...`, URLs like `https://`) do not trigger false positives.
4. **VCS & Artifact Hygiene**:
   - Ephemeral artifacts (e.g. generated HTML visualizations, temporary SQLite databases, `.env` copies) must never be staged into Git commits. Ensure `.gitignore` coverage.

---

## 2. Automated Static Audit Tool

Run the zero-token local adversary auditor script:

```bash
node .agents/scripts/runner.js adversary-check
# or scan a specific diff
node .agents/scripts/adversary-check.js --staged
```

---

## 3. Subagent Adversarial Protocol

When authoring complex or security-sensitive modules (`src/memory/`, `src/graph/`, `.agents/scripts/`), the Agent must invoke a dedicated review subagent:

```javascript
invoke_subagent({
  Role: "Adversarial Code Auditor",
  TypeName: "research",
  Prompt: `Analyze the pending git diff under the four cold-eye lenses:
1. Are multi-step DB writes wrapped in atomic transactions?
2. Are tests hermetically isolated with os.tmpdir()?
3. Do regex patterns guard against false positives?
4. Are all generated artifacts and databases kept out of git?
Report issues as [CRITICAL], [WARNING], or [CLEAN PASS].`
});
```
