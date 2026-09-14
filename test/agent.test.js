const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { LongTermMemory } = require('../src/memory/index');
const { AgentLoop } = require('../src/agent/index');

console.log('Running Unified Agent Loop Unit Tests...');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-'));
let mem = null;
try {
  const okScript = path.join(tmp, 'ok-tool.js');
  const failScript = path.join(tmp, 'fail-tool.js');
fs.writeFileSync(okScript, 'console.log("ok-output");\n');
fs.writeFileSync(failScript, 'console.error("simulated-failure"); process.exit(2);\n');
const registryPath = path.join(tmp, 'registry.json');
fs.writeFileSync(registryPath, JSON.stringify({
  version: 1,
  tools: {
    'ok-tool': {
      name: 'ok-tool',
      description: 'Succeeds while auditing locale keys',
      scriptPath: okScript
    },
    'fail-tool': {
      name: 'fail-tool',
      description: 'Always fails for loop tests',
      scriptPath: failScript
    }
  }
}, null, 2));

mem = new LongTermMemory(':memory:');
mem.recordExperience({
  intent: 'Install sqlite native module',
  trigger_pattern: 'npm install better-sqlite3',
  failure_mode: 'EPERM node-gyp',
  root_cause: 'Sandbox blocks native compilation',
  corrective_heuristic: 'Do not compile native addons inside the sandbox',
  domain_tags: ['npm', 'sqlite']
});

const loop = new AgentLoop({
  memory: mem,
  registryPath,
  rootDir: tmp
});

// Test 1: plan() retrieves historical lessons before any tool runs
const planNative = loop.plan('install sqlite native addon');
assert.ok(planNative.lessons.length > 0, 'plan() should retrieve matching reflexion lessons');
assert.ok(planNative.guidance.includes('Do not compile native addons'), 'guidance should include corrective heuristic');
assert.strictEqual(planNative.executed, undefined);
console.log('✓ Test 1 Passed: plan() injects reflexion memory for the upcoming task.');

// Test 2: plan() suggests synthesized tools by intent keywords
const planAudit = loop.plan('audit locale keys');
assert.ok(planAudit.suggestedTools.some(t => t.name === 'ok-tool'), 'locale audit intent should suggest ok-tool');
console.log('✓ Test 2 Passed: plan() matches intent tokens to registered tools.');

// Test 3: execute() runs a registered tool and captures stdout
const okResult = loop.execute('ok-tool');
assert.strictEqual(okResult.ok, true);
assert.strictEqual(okResult.status, 0);
assert.ok(okResult.stdout.includes('ok-output'));
console.log('✓ Test 3 Passed: execute() runs a registry tool without a shell string.');

// Test 4: run() without --exec is plan-only and does not execute
const dryRun = loop.run('audit locale keys');
assert.strictEqual(dryRun.executed, false);
assert.strictEqual(dryRun.result, null);
console.log('✓ Test 4 Passed: run() stays plan-only unless a tool is selected.');

// Test 5: run() executes the selected tool on success
const successRun = loop.run('audit locale keys', { tool: 'ok-tool', exec: true });
assert.strictEqual(successRun.executed, true);
assert.strictEqual(successRun.result.ok, true);
assert.strictEqual(successRun.recorded, null, 'successful runs should not write a failure reflection');
console.log('✓ Test 5 Passed: run() executes the chosen tool and skips reflect on success.');

// Test 6: failed run does not pollute memory unless recordOnFailure is opted in
const silentFail = loop.run('always fails for loop tests', { tool: 'fail-tool' });
assert.strictEqual(silentFail.executed, true);
assert.strictEqual(silentFail.result.ok, false);
assert.strictEqual(silentFail.recorded, null, 'stub failures must not be written by default');

const statsBefore = mem.stats();
const failedRun = loop.run('always fails for loop tests', { tool: 'fail-tool', recordOnFailure: true });
assert.strictEqual(failedRun.executed, true);
assert.strictEqual(failedRun.result.ok, false);
assert.strictEqual(failedRun.result.status, 2);
assert.ok(failedRun.recorded && failedRun.recorded.id, 'opt-in failure should record a reflection');
assert.strictEqual(failedRun.recorded.reinforced, false);
assert.strictEqual(mem.stats().reflectionCount, statsBefore.reflectionCount + 1);

const planFail = loop.plan('tool:fail-tool simulated-failure');
const failLesson = planFail.lessons.find(l => l.trigger_pattern === 'tool:fail-tool');
assert.ok(failLesson, 'opt-in recorded failure must be retrievable');
assert.ok(!failLesson.corrective_heuristic.includes('native addons'), 'must not copy an unrelated prior heuristic');
console.log('✓ Test 6 Passed: failed execution is written back into reflexion memory only when opted in.');

// Test 7: reflect() records an explicit post-mortem and is searchable
const reflected = loop.reflect({
  intent: 'Configure project MCP isolation',
  trigger_pattern: 'write global mcp_config.json',
  root_cause: 'Global config leaks across workspaces',
  corrective_heuristic: 'Use .agents/plugins/<name>/ for project-scoped MCP config',
  status: 'recovered',
  domain_tags: ['mcp']
});
assert.ok(reflected.id.startsWith('ref_'));
const planMcp = loop.plan('configure project MCP tool isolation');
assert.ok(planMcp.lessons.some(l => l.trigger_pattern.includes('mcp_config')), 'explicit reflect() should be searchable');
console.log('✓ Test 7 Passed: reflect() stores a diagnosed lesson for later plan() calls.');

// Test 8: unknown tool does not throw; returns a structured failure
const missing = loop.execute('does-not-exist');
assert.strictEqual(missing.ok, false);
assert.ok(missing.stderr.includes('not found'));
console.log('✓ Test 8 Passed: execute() returns a structured error for unknown tools.');

// Test 9: plan({ target }) attaches blast-radius for refactoring tasks
const repoRoot = path.resolve(__dirname, '..');
const repoLoop = new AgentLoop({
  memory: mem,
  registryPath,
  rootDir: repoRoot
});
const planBlast = repoLoop.plan('refactor MemoryDatabase', { target: 'src/memory/db.js' });
assert.ok(planBlast.blastRadius, 'target should compute blast radius');
assert.strictEqual(planBlast.blastRadius.targetType, 'file');
assert.ok(planBlast.blastRadius.riskScore > 0);
assert.ok(Array.isArray(planBlast.blastRadius.safetyPlan.steps));
console.log('✓ Test 9 Passed: plan() attaches blast-radius when a refactor target is provided.');

// Test 9b: dirty target auto-enables diff-aware semantic analysis
console.log('Testing plan() auto --diff --semantic on a dirty target...');
const dirtyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dirty-'));
const dirtySrc = path.join(dirtyRoot, 'src');
fs.mkdirSync(dirtySrc);
fs.writeFileSync(path.join(dirtySrc, 'lib.js'), 'function login(user) { return user; }\nmodule.exports = { login };\n');
fs.writeFileSync(path.join(dirtySrc, 'app.js'), 'const { login } = require("./lib");\nlogin("a");\nmodule.exports = { app: true };\n');
const gitOpts = { cwd: dirtyRoot, encoding: 'utf8' };
assert.strictEqual(spawnSync('git', ['init'], gitOpts).status, 0);
spawnSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
spawnSync('git', ['config', 'user.name', 'Test'], gitOpts);
spawnSync('git', ['add', '.'], gitOpts);
assert.strictEqual(spawnSync('git', ['commit', '-m', 'init'], gitOpts).status, 0, 'temp repo commit should succeed');
fs.writeFileSync(path.join(dirtySrc, 'lib.js'), 'function login(user, password) { return user; }\nmodule.exports = { login };\n');

const dirtyLoop = new AgentLoop({ memory: mem, registryPath, rootDir: dirtyRoot });
const dirtyPlan = dirtyLoop.plan('refactor login', { target: 'src/lib.js' });
assert.strictEqual(dirtyPlan.blastRadius.isDiffAware, true, 'dirty file must enable diff-aware mode');
assert.ok(dirtyPlan.blastRadius.semantic, 'dirty file must run AST semantic contract');
assert.strictEqual(dirtyPlan.blastRadius.semantic.mode, 'ast-contract');
fs.rmSync(dirtyRoot, { recursive: true, force: true });
console.log('✓ Test 9b Passed: plan() auto-enables --diff --semantic when the target is dirty.');

// Test 10: CLI plan --json is executable and returns structured output
const cliPath = path.resolve(__dirname, '../src/agent/index.js');
const cliPlan = spawnSync(process.execPath, [
  cliPath, 'plan', 'install sqlite native addon',
  '--json',
  '--db', ':memory:'
], { encoding: 'utf8', cwd: repoRoot });
assert.strictEqual(cliPlan.status, 0, `CLI plan should exit 0, stderr=${cliPlan.stderr}`);
const cliPayload = JSON.parse(cliPlan.stdout.trim());
assert.strictEqual(cliPayload.intent, 'install sqlite native addon');
assert.ok(Array.isArray(cliPayload.suggestedTools));
console.log('✓ Test 10 Passed: CLI plan --json prints a structured loop report.');

// Test 11: CLI tools --json lists registry entries
const cliTools = spawnSync(process.execPath, [
  cliPath, 'tools', '--json', '--registry', registryPath, '--root', tmp
], { encoding: 'utf8', cwd: repoRoot });
assert.strictEqual(cliTools.status, 0, `CLI tools should exit 0, stderr=${cliTools.stderr}`);
const listed = JSON.parse(cliTools.stdout.trim());
assert.ok(listed.tools.some(t => t.name === 'ok-tool'));
console.log('✓ Test 11 Passed: CLI tools --json lists registry entries.');

const cliZh = spawnSync(process.execPath, [
  cliPath, 'plan', 'no-such-intent-xyz',
  '--lang', 'zh-CN',
  '--db', ':memory:'
], { encoding: 'utf8', cwd: repoRoot, env: { ...process.env, LANG: 'C', LANGUAGE: '', LC_ALL: 'C' } });
assert.strictEqual(cliZh.status, 0, `CLI zh plan should exit 0, stderr=${cliZh.stderr}`);
assert.ok(cliZh.stdout.includes('=== Agent Loop：计划 ==='), 'human CLI must follow --lang zh-CN');
assert.ok(cliZh.stdout.includes('没有与该意图匹配的既有反思经验'));
console.log('✓ Test 12 Passed: Agent CLI human output uses src/i18n.js.');

console.log('\nAll 12 Unified Agent Loop tests passed successfully! 🎉');
} finally {
  if (mem) mem.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
