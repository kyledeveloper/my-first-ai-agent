#!/usr/bin/env node
/**
 * Pre-Push Security & Code Quality Gatekeeper
 * 
 * Purpose:
 *   Runs strictly before git push to scan unpushed commits for:
 *   1. Hardcoded API keys, tokens, and private keys (hard block - exit 1)
 *   2. Sensitive credential files (.env, private key files) (hard block - exit 1)
 *   3. High/Critical dependency vulnerabilities (warning/advisory)
 *   4. Code smell & cyclomatic complexity (long functions > 80 lines, deep nesting > 4)
 * 
 * Usage:
 *   node .agents/scripts/pre-push-check.js [options]
 *   node .agents/scripts/runner.js pre-push-check [options]
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const i18n = require(path.resolve(__dirname, '../../src/i18n'));

// Secret matching patterns
const SECRET_PATTERNS = [
  { name: 'GitHub Token', regex: /(?:ghp|gho|ghu|ghs|ghr)_[0-9a-zA-Z]{36}/ },
  { name: 'GitHub Fine-grained PAT', regex: /github_pat_[0-9a-zA-Z_]{22,}/ },
  { name: 'OpenAI / LLM API Key', regex: /(?<![A-Za-z0-9_-])sk-[a-zA-Z0-9_-]{20,}/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Slack Token', regex: /xox[baprs]-[0-9a-zA-Z]{10,48}/ },
  { name: 'Stripe Secret Key', regex: /sk_live_[0-9a-zA-Z]{24}/ },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z\-_]{35}/ }
];

// Sensitive file patterns
const SENSITIVE_FILE_PATTERNS = [
  {
    type: 'ENV_FILE',
    test: (file) => {
      const base = path.basename(file);
      if (/\.env\.(example|sample|template|test)$/i.test(base)) return false;
      return /^\.env(?:\..+)?$/i.test(base);
    }
  },
  {
    type: 'PRIVATE_KEY_FILE',
    test: (file) => /\.(pem|key|p8|p12|pkcs12)$/i.test(file)
  },
  {
    type: 'SSH_PRIVATE_KEY',
    test: (file) => {
      const base = path.basename(file);
      return /^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(base);
    }
  }
];

// Whitelist / placeholder patterns to prevent false positives
const IGNORE_PATTERNS = [
  /YOUR_API_KEY/i,
  /YOUR_SECRET/i,
  /PLACEHOLDER/i,
  /DUMMY_KEY/i,
  /test-sum-calc/i,
  /<.*api.*key.*>/i,
  /<.*token.*>/i
];

/**
 * Scan text or diff content for hardcoded secrets.
 * Correctly distinguishes Git diff additions (+) from removals (-) and context.
 * @param {string} text - Diff or source code text.
 * @returns {{ hasSecrets: boolean, findings: Array<{ type: string, line: string, lineNumber: number }> }}
 */
function scanSecrets(text) {
  if (!text || typeof text !== 'string') {
    return { hasSecrets: false, findings: [] };
  }

  const findings = [];
  const lines = text.split('\n');
  const isDiff = text.includes('diff --git ') || text.includes('--- a/') || text.includes('+++ b/');

  lines.forEach((line, idx) => {
    let contentToScan = '';

    if (isDiff) {
      // In git diffs, strictly only scan added lines (+) and ignore headers (+++)
      if (!line.startsWith('+') || line.startsWith('+++')) {
        return;
      }
      contentToScan = line.slice(1).trim();
    } else {
      contentToScan = line.trim();
    }

    if (!contentToScan) {
      return;
    }

    // Check placeholder ignore list
    const isIgnored = IGNORE_PATTERNS.some(pat => pat.test(contentToScan));
    if (isIgnored) {
      return;
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(contentToScan)) {
        findings.push({
          type: pattern.name,
          line: contentToScan.length > 80 ? contentToScan.slice(0, 77) + '...' : contentToScan,
          lineNumber: idx + 1
        });
      }
    }
  });

  return {
    hasSecrets: findings.length > 0,
    findings
  };
}

/**
 * Check a list of committed / modified files for sensitive filenames (.env, private keys, certificates).
 * @param {string[]} fileList
 * @returns {{ hasSensitiveFiles: boolean, findings: Array<{ file: string, type: string }> }}
 */
function checkSensitiveFiles(fileList) {
  const findings = [];
  if (!Array.isArray(fileList)) return { hasSensitiveFiles: false, findings };

  for (const file of fileList) {
    if (!file) continue;
    for (const pat of SENSITIVE_FILE_PATTERNS) {
      if (pat.test(file)) {
        findings.push({ file, type: pat.type });
        break;
      }
    }
  }

  return {
    hasSensitiveFiles: findings.length > 0,
    findings
  };
}

// Control flow block starter regex
const CONTROL_FLOW_REGEX = new RegExp(
  '(?:' +
    'if\\s*\\(.*?\\)|' +
    'for\\s*\\(.*?\\)|' +
    'while\\s*\\(.*?\\)|' +
    'switch\\s*\\(.*?\\)|' +
    'try|' +
    'catch\\s*\\(.*?\\)|' +
    'else|' +
    '(?:async\\s+)?function\\b.*?|' +
    '=>' +
  ')\\s*\\{'
);

/**
 * Analyze code smell & cyclomatic complexity in JavaScript/TypeScript file content.
 * Tracks control flow nesting (if, for, while, switch, try, catch) and function lengths,
 * correctly ignoring object literals and stripping string literals/comments.
 * @param {string} content - File source code.
 * @param {string} filename - Filename for reporting.
 * @returns {{ file: string, warnings: Array<{ type: string, message: string, line: number }> }}
 */
function analyzeComplexity(content, filename) {
  const warnings = [];
  if (!content || typeof content !== 'string') return { file: filename, warnings };

  const lines = content.split('\n');
  let controlFlowDepth = 0;
  let currentFunc = null;
  let funcStartLine = 0;
  let funcDepth = 0;

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Strip strings, regex literals, and inline comments to prevent distortion
    const cleanLine = trimmed
      .replace(/\/\*.*?\*\/|\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, ' ')
      .replace(/\/(?![*\/])(?:\\.|[^\/\\\n])+\/[gimuy]*/g, ' ');

    const funcMatch = cleanLine.match(/(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{)/);
    if (funcMatch && !currentFunc) {
      currentFunc = funcMatch[1] || funcMatch[2] || funcMatch[3] || 'anonymous';
      funcStartLine = lineNum;
      funcDepth = controlFlowDepth;
    }

    const isCFStart = CONTROL_FLOW_REGEX.test(cleanLine);
    if (isCFStart) {
      controlFlowDepth++;
      const isDuplicate = warnings.some(w => w.type === 'DEEP_NESTING' && Math.abs(w.line - lineNum) < 3);
      if (controlFlowDepth > 4 && !isDuplicate) {
        warnings.push({
          type: 'DEEP_NESTING',
          message: `Control flow nesting depth exceeded (${controlFlowDepth} > 4)`,
          line: lineNum
        });
      }
    }

    const closeCount = (cleanLine.match(/\}/g) || []).length;
    for (let i = 0; i < closeCount; i++) {
      if (controlFlowDepth > 0) controlFlowDepth--;
      if (currentFunc && controlFlowDepth <= funcDepth) {
        const funcLength = lineNum - funcStartLine;
        if (funcLength > 80) {
          warnings.push({
            type: 'LONG_FUNCTION',
            message: `Function "${currentFunc}" exceeds length limit (${funcLength} lines > 80 lines)`,
            line: funcStartLine
          });
        }
        currentFunc = null;
      }
    }
  });

  return { file: filename, warnings };
}

/**
 * Audit dependencies using npm audit.
 * @returns {{ audited: boolean, high: number, critical: number, total: number }}
 */
function auditDependencies() {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { audited: false, high: 0, critical: 0, total: 0 };
  }

  try {
    const res = spawnSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      timeout: 5000,
      cwd: process.cwd()
    });

    if (!res.stdout) {
      return { audited: true, high: 0, critical: 0, total: 0 };
    }

    const auditData = JSON.parse(res.stdout);
    const vuln = auditData.metadata?.vulnerabilities || {};
    const high = vuln.high || 0;
    const critical = vuln.critical || 0;
    const total = (vuln.info || 0) + (vuln.low || 0) + (vuln.moderate || 0) + high + critical;

    return { audited: true, high, critical, total };
  } catch (e) {
    return { audited: false, high: 0, critical: 0, total: 0 };
  }
}

/**
 * Resolve Git repository root and outgoing diff range.
 */
function resolveGitContext() {
  let repoRoot = process.cwd();
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {}

  let range = '';
  // Try origin/main
  try {
    execSync('git rev-parse --verify origin/main', { stdio: 'ignore' });
    range = 'origin/main...HEAD';
  } catch {
    // Try upstream branch
    try {
      const upstream = execSync('git rev-parse --abbrev-ref @{u}', { encoding: 'utf8' }).trim();
      range = `${upstream}...HEAD`;
    } catch {
      // Fallback to recent local commit or cached diff
      try {
        execSync('git rev-parse --verify HEAD~1', { stdio: 'ignore' });
        range = 'HEAD~1..HEAD';
      } catch {
        range = '--cached';
      }
    }
  }

  return { repoRoot, range };
}

/**
 * Get outgoing diff text.
 */
function getOutgoingDiff(options = {}) {
  if (options.scanText) {
    return options.scanText;
  }
  const { range } = resolveGitContext();
  try {
    return execSync(`git diff ${range}`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

/**
 * Get list of outgoing changed file paths.
 */
function getOutgoingFiles() {
  const { repoRoot, range } = resolveGitContext();
  try {
    const list = execSync(`git diff --name-only ${range}`, { encoding: 'utf8' })
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
    return list.map(f => path.resolve(repoRoot, f));
  } catch {
    return [];
  }
}

/**
 * Parse CLI arguments.
 */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      if (rawKey.includes('=')) {
        const eqIdx = rawKey.indexOf('=');
        const k = rawKey.slice(0, eqIdx);
        const v = rawKey.slice(eqIdx + 1);
        args[k] = v;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[rawKey] = argv[++i];
      } else {
        args[rawKey] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

/**
 * Main execution runner
 */
async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
Pre-Push Security & Code Quality Gatekeeper
===========================================
Usage:
  node .agents/scripts/pre-push-check.js [options]

Options:
  --lang <lang>       Set language ('en-US' or 'zh-CN', defaults to $LANG)
  --strict            Treat code smell and dependency warnings as blocking errors
  --json              Output audit report in JSON format
  --scan-text <text>  Directly scan supplied string (used for testing)
  --help, -h          Show this help message
`);
    process.exit(0);
  }

  // Setup i18n
  const systemLang = process.env.LANG || process.env.LANGUAGE || '';
  const selectedLang = args.lang
    ? (args.lang.startsWith('zh') ? 'zh-CN' : 'en-US')
    : (systemLang.includes('zh') ? 'zh-CN' : 'en-US');
  i18n.changeLanguage(selectedLang);

  const isJson = args.json;
  if (!isJson) {
    console.log(i18n.t('cli.gatekeeper.header'));
  }

  // 1. Scan for hardcoded secrets in diff
  if (!isJson) console.log(i18n.t('cli.gatekeeper.scanning_secrets'));
  const diffContent = getOutgoingDiff({ scanText: args['scan-text'] });
  const secretResult = scanSecrets(diffContent);

  // 2. Scan outgoing files for sensitive credential files (.env, private keys)
  const changedFiles = getOutgoingFiles();
  const sensitiveFilesResult = checkSensitiveFiles(changedFiles);

  // 3. Audit dependencies
  if (!isJson) console.log(i18n.t('cli.gatekeeper.auditing_deps'));
  const depResult = auditDependencies();

  // 4. Analyze code smells in changed JS/TS files
  if (!isJson) console.log(i18n.t('cli.gatekeeper.checking_complexity'));
  const codeSmellReports = [];
  const jsFiles = changedFiles.filter(f => /\.(js|ts|jsx|tsx)$/i.test(f) && !/(?:^|\/)(?:test|tests|__tests__|node_modules)\//i.test(f));
  for (const f of jsFiles) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8');
      const report = analyzeComplexity(content, path.basename(f));
      if (report.warnings.length > 0) codeSmellReports.push(report);
    }
  }

  if (isJson) {
    console.log(JSON.stringify({
      secrets: secretResult,
      sensitiveFiles: sensitiveFilesResult,
      dependencies: depResult,
      codeSmells: codeSmellReports
    }, null, 2));
  } else {
    // Print Secrets Result
    if (secretResult.hasSecrets) {
      console.error(i18n.t('cli.gatekeeper.secrets_failed'));
      secretResult.findings.forEach(f => {
        console.error(`  • [${f.type}] Line ${f.lineNumber}: ${f.line}`);
      });
    } else {
      console.log(i18n.t('cli.gatekeeper.secrets_passed'));
    }

    // Print Sensitive Files Result
    if (sensitiveFilesResult.hasSensitiveFiles) {
      console.error(i18n.t('cli.gatekeeper.sensitive_files_failed'));
      sensitiveFilesResult.findings.forEach(f => {
        console.error(`  • [${f.type}] File: ${f.file}`);
      });
    } else {
      console.log(i18n.t('cli.gatekeeper.sensitive_files_passed'));
    }

    // Print Dependencies Result
    if (depResult.audited) {
      if (depResult.high > 0 || depResult.critical > 0) {
        console.warn(i18n.t('cli.gatekeeper.deps_warning', { count: depResult.high + depResult.critical }));
      } else {
        console.log(i18n.t('cli.gatekeeper.deps_passed'));
      }
    }

    // Print Code Smell Result
    if (codeSmellReports.length > 0) {
      console.warn(i18n.t('cli.gatekeeper.complexity_warning', { count: codeSmellReports.length }));
      for (const r of codeSmellReports) {
        console.warn(`  • File: ${r.file}`);
        r.warnings.forEach(w => console.warn(`    - [${w.type}] Line ${w.line}: ${w.message}`));
      }
    } else {
      console.log(i18n.t('cli.gatekeeper.complexity_passed'));
    }
  }

  // Hard Blocking Logic: Secrets or Sensitive Files block push (exit code 1)
  if (secretResult.hasSecrets || sensitiveFilesResult.hasSensitiveFiles) {
    process.exit(1);
  }

  if (args.strict && (depResult.high > 0 || depResult.critical > 0 || codeSmellReports.length > 0)) {
    process.exit(1);
  }

  if (!isJson) {
    console.log(i18n.t('cli.gatekeeper.all_passed'));
  }
  process.exit(0);
}

// If invoked as CLI script directly
if (require.main === module) {
  run();
}

module.exports = {
  scanSecrets,
  checkSensitiveFiles,
  analyzeComplexity,
  auditDependencies,
  getOutgoingDiff,
  getOutgoingFiles,
  resolveGitContext,
  run
};
