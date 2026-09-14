const { getMemory } = require('../src/memory/index');

const mem = getMemory();

console.log('====================================================');
console.log('  🧠 Long-Term Reflexive Memory 系统演练与种子沉淀');
console.log('====================================================\n');

// 1. 沉淀今天的真实教训 1：原生模块在沙盒中的编译问题
console.log('📥 记录历史教训 1: 沙盒环境下原生 C++ 模块编译 (better-sqlite3)...');
mem.recordExperience({
  intent: '在沙盒环境安装含原生扩展的 npm 包 (如 context-mode / better-sqlite3)',
  context_summary: 'macOS arm64, Node 24, IDE 沙盒隔离环境',
  domain_tags: ['npm', 'native-addons', 'sandbox', 'permissions'],
  status: 'recovered',
  importance_score: 0.95,
  trigger_pattern: 'npm install 含 C++ 原生模块编译 (node-gyp rebuild)',
  failure_mode: 'EPERM: operation not permitted, uv_cwd / scandir build 权限拦截',
  root_cause: '沙盒环境拦截了 node-gyp 原生编译所需的系统调用与底层写入',
  corrective_heuristic: '不要在沙盒内强行调用本地编译安装；优先引导用户在系统终端执行安装，或直接使用 npx 免安装运行对应工具'
});

// 2. 沉淀今天的真实教训 2：MCP 项目级隔离
console.log('📥 记录历史教训 2: MCP Server 全局 vs 项目级隔离...');
mem.recordExperience({
  intent: '配置只对单项目生效的 MCP Server (如 context-mode)',
  context_summary: 'Antigravity workspace customization',
  domain_tags: ['mcp', 'plugin', 'antigravity', 'isolation'],
  status: 'success',
  importance_score: 0.85,
  trigger_pattern: '用户要求仅在当前项目开启 MCP 插件，避免全局污染',
  failure_mode: '直接写在 ~/.gemini/config/mcp_config.json 会对所有项目全局生效',
  root_cause: 'Antigravity 全局配置目录适用于所有会话，缺少针对当前目录的独立性',
  corrective_heuristic: '在项目根目录创建 .agents/plugins/<name>/plugin.json 与 mcp_config.json，利用项目级 Plugin 实现环境干净隔离'
});

console.log('\n📊 记忆库当前状态:');
console.log(mem.stats());

// 3. 模拟新任务触发 Pre-Task 检索 (三维加权打分)
console.log('\n----------------------------------------------------');
console.log('🔍 场景 1: Agent 接到任务 "帮我安装一个需要编译的 sqlite 插件" (展示多维打分)');
console.log('----------------------------------------------------');
const query1 = '安装 需要本地编译的 sqlite 原生库';
const lessons1 = mem.query(query1, { autoIncrementHit: true });
console.log(mem.formatPrompt(lessons1, { showScores: true }));

console.log('\n----------------------------------------------------');
console.log('🔍 场景 2: Agent 接到任务 "我想为这个项目单独配置一个 MCP 工具" (展示多维打分)');
console.log('----------------------------------------------------');
const query2 = '为这个项目单独配置 MCP 工具 避免影响全局';
const lessons2 = mem.query(query2, { autoIncrementHit: true });
console.log(mem.formatPrompt(lessons2, { showScores: true }));

console.log('\n----------------------------------------------------');
console.log('📈 规则晋升候选检查 (Memory Consolidation):');
console.log('----------------------------------------------------');
const candidates = mem.getCandidateRules(1);
for (const c of candidates) {
  console.log(c.ruleText);
}

console.log('\n✅ 演示完成！所有历史经验已安全持久化存储于 .agents/memory.db');
