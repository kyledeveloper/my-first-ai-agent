const { getMemory } = require('../src/memory/index');

const mem = getMemory();

console.log('====================================================');
console.log('  🧠 Long-Term Reflexive Memory: System Demo');
console.log('====================================================\n');

// 1. Seed Real Lesson 1: Native C++ module compilation failure in sandbox
console.log('📥 Recording Lesson 1: Native C++ module compilation inside sandbox (better-sqlite3)...');
mem.recordExperience({
  intent: 'Install npm package with native extensions (e.g. context-mode / better-sqlite3) in sandbox',
  context_summary: 'macOS arm64, Node 24, IDE sandbox isolation',
  domain_tags: ['npm', 'native-addons', 'sandbox', 'permissions'],
  status: 'recovered',
  importance_score: 0.95,
  trigger_pattern: 'npm install requiring C++ native compilation (node-gyp rebuild)',
  failure_mode: 'EPERM: operation not permitted, uv_cwd / scandir build permission denied',
  root_cause: 'Sandbox environment intercepts system calls and low-level disk writes needed by node-gyp',
  corrective_heuristic: 'Do not compile native addons inside sandbox; instruct user to install in system terminal or run via npx directly'
});

// 2. Seed Real Lesson 2: MCP workspace isolation vs global pollution
console.log('📥 Recording Lesson 2: MCP Server workspace isolation vs global config...');
mem.recordExperience({
  intent: 'Configure MCP Server active only in current project (e.g. context-mode)',
  context_summary: 'Antigravity workspace customization',
  domain_tags: ['mcp', 'plugin', 'antigravity', 'isolation'],
  status: 'success',
  importance_score: 0.85,
  trigger_pattern: 'User requests enabling MCP plugin exclusively in current project',
  failure_mode: 'Writing directly to ~/.gemini/config/mcp_config.json affects all global sessions',
  root_cause: 'Antigravity global config path applies across all workspaces, lacking project scoping',
  corrective_heuristic: 'Create .agents/plugins/<name>/plugin.json and mcp_config.json in project root to isolate configuration cleanly'
});

console.log('\n📊 Current Memory Database Stats:');
console.log(mem.stats());

// 3. Simulate pre-task retrieval with 3D weighted scoring
console.log('\n----------------------------------------------------');
console.log('🔍 Scenario 1: Agent receives task "Install sqlite library requiring native compilation"');
console.log('----------------------------------------------------');
const query1 = 'install sqlite native compilation addon';
const lessons1 = mem.query(query1, { autoIncrementHit: true });
console.log(mem.formatPrompt(lessons1, { showScores: true }));

console.log('\n----------------------------------------------------');
console.log('🔍 Scenario 2: Agent receives task "Configure project-specific MCP tool without global pollution"');
console.log('----------------------------------------------------');
const query2 = 'configure project specific MCP tool avoid global pollution';
const lessons2 = mem.query(query2, { autoIncrementHit: true });
console.log(mem.formatPrompt(lessons2, { showScores: true }));

console.log('\n----------------------------------------------------');
console.log('📈 Rule Promotion Candidate Check (Memory Consolidation):');
console.log('----------------------------------------------------');
const candidates = mem.getCandidateRules(1);
for (const c of candidates) {
  console.log(c.ruleText);
}

console.log('\n✅ Demo complete! All lessons successfully persisted in .agents/memory.db');
