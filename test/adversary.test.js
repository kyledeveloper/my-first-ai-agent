const assert = require('assert');
const { AdversaryAuditor } = require('../.agents/scripts/adversary-check');

console.log('Running Adversarial Auditor Unit Tests...');

const auditor = new AdversaryAuditor();

// Test 1: Catches tests modifying real .git
const testGitDiff = `
diff --git a/test/bad.test.js b/test/bad.test.js
+ const hookPath = path.resolve(__dirname, '../.git/hooks/pre-push');
`;
const r1 = auditor.auditDiff(testGitDiff);
assert.strictEqual(r1.passed, false, 'Should fail when test mutates real .git');
assert.ok(r1.findings.some(f => f.lens === 'Hermetic Test Isolation'));
console.log('✓ Test 1 Passed: Auditor catches non-hermetic test touching real .git.');

// Test 2: Catches greedy regex lacking boundaries
const badRegexDiff = `
diff --git a/src/scanner.js b/src/scanner.js
+ const regex: /sk-[a-zA-Z0-9]{20,}/;
`;
const r2 = auditor.auditDiff(badRegexDiff);
assert.strictEqual(r2.passed, false, 'Should fail on greedy regex');
assert.ok(r2.findings.some(f => f.lens === 'Regex Boundary & False-Positive Defense'));
console.log('✓ Test 2 Passed: Auditor flags greedy regex without word boundary defenses.');

// Test 3: Catches tracked runtime db / html
const trackedArtifactDiff = `
diff --git a/agent-workflow.html b/agent-workflow.html
new file mode 100644
`;
const r3 = auditor.auditDiff(trackedArtifactDiff);
assert.ok(r3.findings.some(f => f.lens === 'VCS & Artifact Hygiene'));
console.log('✓ Test 3 Passed: Auditor warns on tracked generated HTML/database files.');

// Test 4: Clean diff passes cleanly
const cleanDiff = `
diff --git a/src/math.js b/src/math.js
+ function add(a, b) { return a + b; }
+ module.exports = { add };
`;
const r4 = auditor.auditDiff(cleanDiff);
assert.strictEqual(r4.passed, true);
assert.strictEqual(r4.findings.length, 0);
console.log('✓ Test 4 Passed: Clean diff passes auditor with zero findings.');

console.log('\nAll 4 Adversarial Auditor tests passed successfully! 🎉');
