#!/usr/bin/env node
/**
 * Adversary Code Review Gatekeeper (Red-Team Auditor)
 *
 * Scans git diff / files for the Four Cold-Eye Vulnerabilities:
 * 1. Multi-step DB writes missing db.transaction()
 * 2. Tests touching real .git instead of os.tmpdir()
 * 3. Aggressive regex without word boundary defenses
 * 4. Staging tracked runtime artifacts (*.html, *.db, *.log)
 *
 * Usage:
 *   node .agents/scripts/adversary-check.js [--staged] [--json]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AdversaryAuditor {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || path.resolve(__dirname, '../../');
    this.staged = options.staged || false;
  }

  getDiff() {
    try {
      const cmd = this.staged
        ? 'git diff --cached --unified=3'
        : 'git diff HEAD~1..HEAD --unified=3';
      return execSync(cmd, { cwd: this.repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      return '';
    }
  }

  auditDiff(diffText) {
    const findings = [];

    // 1. Check for tests mutating real .git without os.tmpdir
    const testGitMutation = /\+\s*const\s+\w+\s*=\s*path\.resolve\(__dirname,\s*['"]\.\.\/\.git/m;
    if (testGitMutation.test(diffText)) {
      findings.push({
        severity: 'CRITICAL',
        lens: 'Hermetic Test Isolation',
        message: 'Direct reference to real .git/ in test path detected. Must use os.tmpdir() + fs.mkdtempSync() instead.'
      });
    }

    // 2. Check for multi-table database write operations missing transaction
    const hasMultipleInserts = (diffText.match(/\.prepare\(['"]\s*INSERT INTO/gi) || []).length > 1;
    const hasTransaction = /transaction\s*\(/i.test(diffText);
    if (hasMultipleInserts && !hasTransaction) {
      findings.push({
        severity: 'WARNING',
        lens: 'ACID Transaction Completeness',
        message: 'Multiple INSERT statements found without obvious transaction() wrapping. Ensure atomic rollback.'
      });
    }

    // 3. Check for overly greedy secret regex without word/token boundary
    const greedySecretRegex = /\+\s*.*regex:\s*\/(?:sk|ghp|gho)-\[a-zA-Z0-9\]/m;
    if (greedySecretRegex.test(diffText)) {
      findings.push({
        severity: 'CRITICAL',
        lens: 'Regex Boundary & False-Positive Defense',
        message: 'Greedy token regex lacking prefix boundary (e.g. (?<![A-Za-z0-9_-])). May cause false positives.'
      });
    }

    // 4. Check for staged runtime artifacts (.db, .html in diff headers)
    const trackedArtifacts = /diff --git a\/(?:.*(?:\.db|\.sqlite|\.html|memory\.db))/i;
    if (trackedArtifacts.test(diffText)) {
      findings.push({
        severity: 'WARNING',
        lens: 'VCS & Artifact Hygiene',
        message: 'Tracked runtime database or generated HTML file detected in diff. Verify .gitignore.'
      });
    }

    return {
      passed: findings.filter(f => f.severity === 'CRITICAL').length === 0,
      findings
    };
  }

  run() {
    const diff = this.getDiff();
    return this.auditDiff(diff);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const isStaged = args.includes('--staged');

  const auditor = new AdversaryAuditor({ staged: isStaged });
  const result = auditor.run();

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('=== 🔴 Adversarial Red-Team Code Auditor ===');
    if (result.findings.length === 0) {
      console.log('✅ Clean Pass: No critical architectural or isolation blindspots detected.');
    } else {
      for (const f of result.findings) {
        const icon = f.severity === 'CRITICAL' ? '🚨' : '⚠️';
        console.log(`${icon} [${f.severity}] ${f.lens}: ${f.message}`);
      }
      if (!result.passed) {
        console.log('\n❌ Audit failed: Critical architectural flaws must be resolved before commit.');
        process.exit(1);
      }
    }
  }
}

module.exports = { AdversaryAuditor };
