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

// Test 7: Multi-dimensional score breakdown & mathematical verification
const scoredResults = mem.query('npm install better-sqlite3');
assert.ok(scoredResults.length > 0);
const topItem = scoredResults[0];
assert.ok(typeof topItem.score === 'number' && topItem.score > 0, 'Final score should be a positive number');
assert.ok(typeof topItem.relScore === 'number' && topItem.relScore >= 0 && topItem.relScore <= 1, 'relScore should be in [0, 1]');
assert.ok(typeof topItem.recScore === 'number' && topItem.recScore >= 0 && topItem.recScore <= 1, 'recScore should be in [0, 1]');
assert.ok(typeof topItem.impScore === 'number' && topItem.impScore >= 0 && topItem.impScore <= 1, 'impScore should be in [0, 1]');

// Default weights: alpha=0.5, beta=0.2, gamma=0.3
const expectedScore = 0.5 * topItem.relScore + 0.2 * topItem.recScore + 0.3 * topItem.impScore;
assert.ok(Math.abs(topItem.score - expectedScore) < 0.001, `Final score ${topItem.score} should match formula ${expectedScore}`);
console.log('✓ Test 7 Passed: Multi-dimensional score breakdown and mathematical formula verified.');

// Test 8: Recency exponential decay verification
const thirtyDaysAgo = Date.now() - (30 * 24 * 3600 * 1000);
mem.db.insertEpisode({
  id: 'ep_old',
  intent: '旧版编译测试',
  status: 'recovered',
  created_at: thirtyDaysAgo
});
mem.db.insertReflection({
  id: 'ref_old',
  episode_id: 'ep_old',
  intent: '旧版编译测试',
  trigger_pattern: 'npm install legacy-module-old',
  root_cause: '旧系统不支持',
  corrective_heuristic: '避免安装',
  created_at: thirtyDaysAgo,
  last_accessed_at: thirtyDaysAgo
});

const recentVsOldQuery = mem.query('legacy-module-old');
assert.strictEqual(recentVsOldQuery[0].id, 'ref_old');
assert.ok(recentVsOldQuery[0].recScore < 0.3, `30-day old record should have decayed recency (got ${recentVsOldQuery[0].recScore})`);
console.log(`✓ Test 8 Passed: Exponential recency decay verified (old recScore = ${recentVsOldQuery[0].recScore}).`);

// Test 9: Importance score differentiation
mem.recordExperience({
  intent: '轻微提示测试',
  trigger_pattern: 'vite build 出现轻微告警 (minor-warning-trigger)',
  root_cause: '未使用的变量',
  corrective_heuristic: '清除无用导入即可',
  importance_score: 0.3
});

mem.recordExperience({
  intent: '致命崩溃测试',
  trigger_pattern: 'vite build 发生系统崩溃 (critical-crash-trigger)',
  root_cause: '内存溢出 OOM',
  corrective_heuristic: '增加 node 堆内存参数',
  importance_score: 1.0
});

const minorResult = mem.query('minor-warning-trigger');
const criticalResult = mem.query('critical-crash-trigger');
assert.ok(criticalResult[0].impScore > minorResult[0].impScore, `Critical importance (${criticalResult[0].impScore}) should exceed minor (${minorResult[0].impScore})`);
console.log(`✓ Test 9 Passed: Importance weighting verified (critical: ${criticalResult[0].impScore} vs minor: ${minorResult[0].impScore}).`);

// Test 10: Dynamic weights override
const recencyFocusedResults = mem.query('legacy-module-old', {
  weights: { alpha: 0.1, beta: 0.8, gamma: 0.1 }
});
// When recency is heavily weighted (0.8), the old score should be drastically reduced
assert.ok(recencyFocusedResults[0].score < recentVsOldQuery[0].score, 'Higher beta should penalize old memories more');
console.log('✓ Test 10 Passed: Dynamic weights adjustment verified.');

// Test 11: Auto-refresh last_accessed_at on retrieval hit
const beforeAccess = mem.db.db.prepare('SELECT last_accessed_at FROM reflections WHERE id = ?').get('ref_old').last_accessed_at;
const nowAccessTime = Date.now();
mem.query('legacy-module-old', { autoIncrementHit: true, now: nowAccessTime });
const afterAccess = mem.db.db.prepare('SELECT last_accessed_at FROM reflections WHERE id = ?').get('ref_old').last_accessed_at;
assert.strictEqual(afterAccess, nowAccessTime, 'autoIncrementHit should update last_accessed_at to current timestamp');
console.log('✓ Test 11 Passed: Retrieval hit refreshes last_accessed_at activation.');

mem.close();
console.log('\nAll 11 tests passed successfully! 🎉');
