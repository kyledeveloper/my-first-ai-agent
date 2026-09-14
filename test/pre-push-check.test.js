const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('Running Pre-Push Gatekeeper Unit Tests...');

const scriptPath = path.resolve(__dirname, '../.agents/scripts/pre-push-check.js');
const installerPath = path.resolve(__dirname, '../.agents/scripts/install-git-hooks.js');

// Require script module functions
let gatekeeper;
try {
  gatekeeper = require(scriptPath);
} catch (e) {
  gatekeeper = null;
}

assert.ok(gatekeeper, 'pre-push-check.js module should be exportable and loadable');

// Dynamically construct test tokens so static test files do not trigger git diff scanners
const fakeGhp = ['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_');
const fakeOpenAI = ['sk', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('-');
const fakeAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const fakePrivKey = ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('');

// Test 1: Secret Scanning - Positive Matches
console.log('Testing Secret Detection patterns...');
const secretDiffSamples = [
  `const token = "${fakeGhp}";`,
  `export const OPENAI_KEY = "${fakeOpenAI}";`,
  `AWS_KEY_ID="${fakeAws}"`,
  `${fakePrivKey}\nMIIEowIBAAKCAQEA0...`
];

for (const sample of secretDiffSamples) {
  const result = gatekeeper.scanSecrets(`+ ${sample}`);
  assert.strictEqual(result.hasSecrets, true, `Should detect secret in: ${sample}`);
  assert.ok(result.findings.length > 0, 'Findings should contain details');
}
console.log('✓ Test 1 Passed: Secret scanner successfully detects API keys, tokens, and private keys.');

// Test 2: Secret Scanning - Negative (Clean code)
console.log('Testing Secret Detection on clean code...');
const cleanDiffSample = `
+ function calculateTotal(items) {
+   return items.reduce((sum, item) => sum + item.price, 0);
+ }
+ const placeholderKey = "YOUR_API_KEY_HERE";
`;
const cleanResult = gatekeeper.scanSecrets(cleanDiffSample);
assert.strictEqual(cleanResult.hasSecrets, false, 'Clean code should have no secrets detected');
console.log('✓ Test 2 Passed: Clean code produces zero false positives.');

// Test 2b: OpenAI key pattern must not match substrings like disk- or task-sk-
console.log('Testing OpenAI key false positives (disk-/task-sk- prefixes)...');
const diskFalse = gatekeeper.scanSecrets('+ const path = "disk-abcdefghijklmnopqrstuvwxyz";');
assert.strictEqual(diskFalse.hasSecrets, false, 'disk-... must not be flagged as an OpenAI key');
const taskSkFalse = gatekeeper.scanSecrets('+ const id = "task-sk-abcdefghijklmnopqrstuvwxyz";');
assert.strictEqual(taskSkFalse.hasSecrets, false, 'task-sk-... must not be flagged as an OpenAI key');
const realKey = gatekeeper.scanSecrets(`+ export const OPENAI_KEY = "${fakeOpenAI}";`);
assert.strictEqual(realKey.hasSecrets, true, 'A standalone sk- key must still be detected');
console.log('✓ Test 2b Passed: OpenAI key regex no longer matches disk-/task-sk- substrings.');

// Test 3: Code Smell & Complexity Analysis
console.log('Testing Code Smell Detection (function length and nesting)...');
const longFunctionContent = `
function veryLongFunction() {
${Array.from({ length: 90 }, (_, i) => `  const step${i} = ${i};`).join('\n')}
  return step89;
}
`;
const deeplyNestedContent = `
function deeplyNested() {
  if (true) {
    for (let i = 0; i < 10; i++) {
      while (i < 5) {
        if (i % 2 === 0) {
          if (true) {
            console.log("Too deep!");
          }
        }
      }
    }
  }
}
`;

const smellLong = gatekeeper.analyzeComplexity(longFunctionContent, 'longFunc.js');
assert.ok(smellLong.warnings.some(w => w.type === 'LONG_FUNCTION'), 'Should warn on long function > 80 lines');

const smellDeep = gatekeeper.analyzeComplexity(deeplyNestedContent, 'nested.js');
assert.ok(smellDeep.warnings.some(w => w.type === 'DEEP_NESTING'), 'Should warn on nesting depth > 4');
console.log('✓ Test 3 Passed: Code smell analyzer identifies long functions and excessive nesting.');

// Test 4: CLI Execution with Hardcoded Secret (Exit Code 1)
console.log('Testing CLI execution with hardcoded secret detection...');
const secretRun = spawnSync(process.execPath, [scriptPath, '--scan-text', fakeOpenAI], {
  encoding: 'utf8'
});
assert.strictEqual(secretRun.status, 1, 'CLI should exit with code 1 when hardcoded secrets are present');
console.log('✓ Test 4 Passed: CLI correctly blocks execution (exit code 1) on secrets.');

// Test 5: Git Hook Installer Verification (isolated temp repo — never touch the real .git)
console.log('Testing Git Hook Installer...');
const { installHooks } = require(installerPath);
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-push-hooks-'));
fs.mkdirSync(path.join(tmpRepo, '.git', 'hooks'), { recursive: true });
const hookFilePath = installHooks({ repoRoot: tmpRepo });
assert.strictEqual(hookFilePath, path.join(tmpRepo, '.git', 'hooks', 'pre-push'));
assert.ok(fs.existsSync(hookFilePath), 'pre-push hook must be written under the supplied repoRoot');
const hookContent = fs.readFileSync(hookFilePath, 'utf8');
assert.ok(hookContent.includes('pre-push-check'), 'Hook script should call pre-push-check');
fs.rmSync(tmpRepo, { recursive: true, force: true });
console.log('✓ Test 5 Passed: Git hook installer writes an executable pre-push hook into an isolated repo.');

// Test 6: Diff Deletion Test - Removing a secret must NOT block push
console.log('Testing Diff Deletion (removing old secrets should not be flagged)...');
const deletedSecretDiff = `
diff --git a/config.js b/config.js
--- a/config.js
+++ b/config.js
@@ -1,2 +1,2 @@
-const oldKey = "${fakeOpenAI}";
+const newKey = process.env.API_KEY;
`;
const deletedRes = gatekeeper.scanSecrets(deletedSecretDiff);
assert.strictEqual(deletedRes.hasSecrets, false, 'Deleted secrets in diff should not trigger blocking');
console.log('✓ Test 6 Passed: Removing old secrets does not trigger false positive.');

// Test 7: Secret in Comments - Should be caught and blocked
console.log('Testing Secret in comments (must be caught)...');
const commentedSecret = `+ // Note: temporary token is ${fakeGhp}`;
const commentRes = gatekeeper.scanSecrets(commentedSecret);
assert.strictEqual(commentRes.hasSecrets, true, 'Secrets inside comments must be detected');
console.log('✓ Test 7 Passed: Sensitive credentials in code comments are caught.');

// Test 8: String literals containing braces should not cause false DEEP_NESTING
console.log('Testing string literals with braces for complexity analysis...');
const bracesInStringContent = `
function formatData() {
  const jsonTemplate = "{ item1: { nested: { deep: true } } }";
  return jsonTemplate;
}
`;
const bracesRes = gatekeeper.analyzeComplexity(bracesInStringContent, 'template.js');
assert.strictEqual(bracesRes.warnings.length, 0, 'Braces in string literals must not cause false DEEP_NESTING');
console.log('✓ Test 8 Passed: String literals with braces do not distort cyclomatic depth.');

// Test 9: Sensitive file detection (.env, .pem, .key)
console.log('Testing Sensitive File Detection...');
const sensitiveFilesResult = gatekeeper.checkSensitiveFiles([
  '.env',
  '.env.local',
  '.env.production',
  'server.key',
  'id_rsa',
  'README.md',
  '.env.example'
]);
assert.strictEqual(sensitiveFilesResult.hasSensitiveFiles, true);
assert.strictEqual(sensitiveFilesResult.findings.length, 5); // .env, .env.local, .env.production, server.key, id_rsa (excludes .env.example)
console.log('✓ Test 9 Passed: Sensitive files (.env, key, id_rsa) correctly detected while .env.example allowed.');

console.log('\nAll 10 Pre-Push Gatekeeper tests passed successfully! 🎉');
