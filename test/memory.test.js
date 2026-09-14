const assert = require('assert');
const { LongTermMemory } = require('../src/memory/index');

console.log('Running Long-Term Memory Unit Tests...');

const mem = new LongTermMemory(':memory:');

// Test 1: Initial stats
const initialStats = mem.stats();
assert.strictEqual(initialStats.episodeCount, 0, 'Initial episodes should be 0');
assert.strictEqual(initialStats.reflectionCount, 0, 'Initial reflections should be 0');
console.log('✓ Test 1 Passed: Initial empty database verified.');

// Test 2: Record an experience (simulating the better-sqlite3 native build failure)
const res1 = mem.recordExperience({
  intent: '安装 context-mode 全局或本地包',
  context_summary: 'Node 24, macOS Darwin arm64, IDE sandbox',
  domain_tags: ['npm', 'native-build', 'permission'],
  status: 'failure',
  trigger_pattern: 'npm install context-mode 或 better-sqlite3',
  failure_mode: 'EPERM operation not permitted on node-gyp rebuild scandir build',
  root_cause: '沙盒环境限制底层 C++ 原生模块编译执行',
  corrective_heuristic: '避免在沙盒内用 npm 本地编译含原生扩展的包，优先使用 npx 免安装运行或由用户在系统终端安装'
});

assert.ok(res1.id.startsWith('ref_'), 'Reflection ID should start with ref_');
assert.strictEqual(res1.reinforced, false, 'Should be a new reflection');

const statsAfterAdd = mem.stats();
assert.strictEqual(statsAfterAdd.episodeCount, 1);
assert.strictEqual(statsAfterAdd.reflectionCount, 1);
console.log('✓ Test 2 Passed: Record experience successfully stored.');

// Test 3: Deduplication / reinforcement on repeating same trigger
const res2 = mem.recordExperience({
  intent: '再次尝试 npm install context-mode',
  domain_tags: ['npm'],
  status: 'failure',
  trigger_pattern: 'npm install context-mode 或 better-sqlite3',
  root_cause: '沙盒环境限制底层 C++ 原生模块编译执行',
  corrective_heuristic: '避免在沙盒内用 npm 本地编译含原生扩展的包，优先使用 npx 免安装运行或由用户在系统终端安装'
});

assert.strictEqual(res2.reinforced, true, 'Duplicate pattern should reinforce instead of creating duplicate');
assert.strictEqual(mem.stats().reflectionCount, 1, 'Reflection count should remain 1 after reinforcement');
console.log('✓ Test 3 Passed: Deduplication and reinforcement working properly.');

// Test 4: Full-text search retrieval (FTS5)
const queryResults = mem.query('npm install better-sqlite3 报错');
assert.ok(queryResults.length > 0, 'Should find matching lesson by keywords');
assert.strictEqual(queryResults[0].id, res1.id);
console.log('✓ Test 4 Passed: FTS5 keyword matching retrieved relevant reflection.');

// Test 5: Prompt formatting
const formattedPrompt = mem.formatPrompt(queryResults);
assert.ok(formattedPrompt.includes('历史反思经验提示'), 'Formatted prompt should include header');
assert.ok(formattedPrompt.includes('避坑指南'), 'Formatted prompt should contain heuristic advice');
console.log('✓ Test 5 Passed: Prompt formatting produces high-density markdown.');

// Test 6: Rule promotion candidate check
// Simulate multiple hits
for (let i = 0; i < 3; i++) {
  mem.query('better-sqlite3', { autoIncrementHit: true });
}
const candidates = mem.getCandidateRules(3);
assert.ok(candidates.length > 0, 'Should have candidate rules when hit_count >= 3');
assert.ok(candidates[0].ruleText.includes('历史规避次数'), 'Rule text should format metadata');
console.log('✓ Test 6 Passed: High-frequency memory consolidation / rule promotion candidates identified.');

mem.close();
console.log('\nAll 6 tests passed successfully! 🎉');
