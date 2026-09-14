const path = require('path');
const { getToolmaker } = require('../src/toolmaker/index');
const { spawnSync } = require('child_process');

console.log('====================================================');
console.log('  🛠️  AI Agent Self-Toolmaker: 动态自造工具系统演练');
console.log('====================================================\n');

const toolmaker = getToolmaker();

// 1. 模拟开发者在当前项目里反复执行同一类高频任务（例如：排查多语言翻译缺失）
console.log('📊 模拟高频任务触发跟踪: "多语言字典 Key 缺失比对与审计"...');
const taskName = 'audit-locales';
const taskIntent = '比对 zh-CN 与 en-US 语言包中的 key 差异并报告缺失项';

console.log('• 第 1 次执行任务: 临时手写脚本...');
toolmaker.track({ nameSlug: taskName, intentSummary: taskIntent });

console.log('• 第 2 次执行任务: 再次临时拼接命令...');
toolmaker.track({ nameSlug: taskName, intentSummary: taskIntent });

console.log('• 第 3 次执行任务: 触发频次阈值 (>= 3 次)！');
const check = toolmaker.track({ nameSlug: taskName, intentSummary: taskIntent });

if (check.shouldSynthesize) {
  console.log('\n🔔 [Toolmaker 自动触发] 检测到该任务已执行 3 次，进入自动脚本合成流程！');
}

// 2. 自动化合成专门的 CLI 脚本：.agents/scripts/audit-locales.js
console.log('\n⚙️ 正在合成专用 CLI 工具: .agents/scripts/audit-locales.js ...');

const auditToolCode = `
    const baseDir = path.resolve(process.cwd(), args.base || 'locales/zh-CN');
    const targetDir = path.resolve(process.cwd(), args.target || 'locales/en-US');

    if (!fs.existsSync(baseDir)) {
      throw new Error(\`Base locale dir not found: \${baseDir}\`);
    }
    if (!fs.existsSync(targetDir)) {
      throw new Error(\`Target locale dir not found: \${targetDir}\`);
    }

    const baseFiles = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
    const report = {
      baseLocale: path.basename(baseDir),
      targetLocale: path.basename(targetDir),
      filesAudited: baseFiles.length,
      discrepancies: []
    };

    for (const file of baseFiles) {
      const basePath = path.join(baseDir, file);
      const targetPath = path.join(targetDir, file);

      if (!fs.existsSync(targetPath)) {
        report.discrepancies.push({ file, type: 'MISSING_FILE', message: \`Target file \${file} missing\` });
        continue;
      }

      const baseJson = JSON.parse(fs.readFileSync(basePath, 'utf8'));
      const targetJson = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

      const baseKeys = Object.keys(baseJson);
      const targetKeys = Object.keys(targetJson);

      const missingInTarget = baseKeys.filter(k => !targetKeys.includes(k));
      const extraInTarget = targetKeys.filter(k => !baseKeys.includes(k));

      if (missingInTarget.length > 0 || extraInTarget.length > 0) {
        report.discrepancies.push({
          file,
          missingInTarget,
          extraInTarget
        });
      }
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(\`=== 🌐 多语言包审计结果 (\${report.baseLocale} ➔ \${report.targetLocale}) ===\`);
      console.log(\`审计文件数: \${report.filesAudited}\`);
      if (report.discrepancies.length === 0) {
        console.log('✅ 所有语言包 Key 100% 对齐，无缺失项！');
      } else {
        console.log(\`⚠️ 发现 \${report.discrepancies.length} 处不一致:\`);
        for (const d of report.discrepancies) {
          console.log(\`  • 文件: \${d.file}\`);
          if (d.missingInTarget) console.log(\`    缺失 Key: \${d.missingInTarget.join(', ')}\`);
          if (d.extraInTarget) console.log(\`    多余 Key: \${d.extraInTarget.join(', ')}\`);
        }
      }
    }
`;

const synthesized = toolmaker.synthesizeTool({
  name: taskName,
  description: '快速审计并比对各语言包（如 zh-CN vs en-US）之间的 Key 是否对齐',
  parameters: [
    { name: 'base', description: '基准语言目录 (如 locales/zh-CN)', default: 'locales/zh-CN' },
    { name: 'target', description: '待对比目标语言目录 (如 locales/en-US)', default: 'locales/en-US' }
  ],
  codeBody: auditToolCode,
  examples: [
    '--base locales/zh-CN --target locales/en-US',
    '--json'
  ],
  patternHash: check.patternHash
});

console.log(`✅ 脚本合成成功: ${synthesized.scriptPath}`);

// 3. 验证通过 Runner 分发调用自造工具
console.log('\n🚀 测试通过统一分发器调用: node .agents/scripts/runner.js audit-locales');
const runnerPath = path.join(__dirname, '../.agents/scripts/runner.js');
const runResult = spawnSync(process.execPath, [runnerPath, 'audit-locales'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '../')
});

console.log('\n📋 当前已沉淀自造工具清单:');
const tools = toolmaker.listTools();
for (const t of tools) {
  console.log(`• [${t.name}] - ${t.description} (脚本: ${t.scriptPath})`);
}

console.log('\n🎉 自造工具演练成功！后续遇到多语言比对任务，Agent 可直接执行：');
console.log('   node .agents/scripts/runner.js audit-locales\n');
