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

## 2. Mandatory Two-Tier Defense Gate

### Tier 1: Automated Static Audit Script
Run the zero-token local adversary auditor script on staged diffs for immediate baseline defense:

```bash
node .agents/scripts/runner.js adversary-check
# or scan staged diff
node .agents/scripts/adversary-check.js --staged
```

---

### Tier 2: Dedicated Subagent Red-Team Audit (Mandatory for Core Modules)
When authoring or refactoring sensitive architectural components (`src/memory/`, `src/graph/`, `src/agent/`, `.agents/scripts/`), **Tier 1 alone is NOT sufficient**. The Agent MUST invoke an independent read-only auditor subagent:

```javascript
invoke_subagent({
  Role: "Adversarial Code Auditor",
  TypeName: "research",
  Prompt: `You are the cold-eyed Adversarial Code Auditor (Red Team).
Inspect the pending changes and git diff across the four cold-eye lenses and edge-case resilience:
1. ACID Transaction Completeness: Are all multi-step mutations strictly transactional?
2. Hermetic Test Isolation: Are tests isolated via os.tmpdir() with 0 external pollution?
3. Regex & AST Boundary Defenses: Are there false positives, silent degradations, or unhandled syntax?
4. VCS & Artifact Hygiene: Are temporary files, databases, or sensitive configs properly ignored?
5. Edge Cases & Attack Scenarios: What runtime inputs, dynamic properties, or circular paths could break this code?

Deliver a formal 《红蓝对抗审计裁决书》 (Adversarial Verdict) categorized by [CRITICAL], [WARNING], and [SUGGESTION].`
});
```

The authoring Agent (Blue Team) must publicly address every finding in the conversation, implement necessary defenses, and achieve formal resolution before any local git commit is allowed.
