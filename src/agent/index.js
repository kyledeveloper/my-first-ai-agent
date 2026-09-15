#!/usr/bin/env node
/**
 * Unified Agent Loop
 *
 * Glue for the five pillars: retrieve reflexion memory, suggest/run a
 * synthesized tool, optionally compute blast-radius, and write failures back.
 *
 *   node src/agent/index.js plan  "<intent>" [--target <fileOrSymbol>]
 *   node src/agent/index.js run   "<intent>" [--tool <name> [--exec]] [--] [tool-args]
 *   node src/agent/index.js reflect --intent x --trigger y --cause z --heuristic h
 *   node src/agent/index.js tools
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { LongTermMemory, DEFAULT_DB_PATH } = require('../memory/index');
const { calculateBlastRadius } = require('../graph/blastRadius');
const { ToolmakerEngine } = require('../toolmaker/index');
const i18n = require('../i18n');

const DEFAULT_REGISTRY = path.join(__dirname, '../../.agents/scripts/registry.json');
const DEFAULT_ROOT = path.resolve(__dirname, '../../');

function hasUncommittedDiff(rootDir, target) {
  const resolved = path.resolve(rootDir, target);
  const rel = path.relative(rootDir, resolved);
  const opts = { cwd: rootDir, encoding: 'utf8', timeout: 5000 };
  const unstaged = spawnSync('git', ['diff', '--', rel], opts);
  const staged = spawnSync('git', ['diff', '--cached', '--', rel], opts);
  if ((unstaged.error || staged.error)) return false;
  return Boolean((unstaged.stdout || '').trim() || (staged.stdout || '').trim());
}

function summarizeBlast(report, rootDir) {
  return {
    target: report.target,
    targetType: report.targetType,
    riskLevel: report.riskLevel,
    riskScore: report.riskScore,
    directCount: report.directCount,
    testCount: report.testCount,
    impactedTests: (report.impactedTests || []).map(f => path.relative(rootDir, f)),
    safetyPlan: report.safetyPlan,
    isDiffAware: Boolean(report.isDiffAware),
    scope: report.scope || null,
    notes: report.notes || null,
    semantic: report.semanticAnalysis
      ? {
          mode: report.semanticAnalysis.mode,
          overallVerdict: report.semanticAnalysis.overallVerdict,
          hasBreaking: report.semanticAnalysis.hasBreaking
        }
      : null
  };
}

class AgentLoop {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
    this.registryPath = options.registryPath || path.join(this.rootDir, '.agents/scripts/registry.json');
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.memory = options.memory || null;
    this.ownsMemory = !options.memory;
    this.toolmaker = options.toolmaker || null;
    this.ownsToolmaker = Boolean(options.ownsToolmaker);
  }

  _memory() {
    if (!this.memory) {
      this.memory = new LongTermMemory(this.dbPath);
    }
    return this.memory;
  }

  listTools() {
    if (this.toolmaker) {
      return this.toolmaker.listTools();
    }
    if (!fs.existsSync(this.registryPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      return Object.values(data.tools || {});
    } catch (e) {
      return [];
    }
  }

  /**
   * Score registered tools against an intent by token overlap.
   */
  suggestTools(intent, tools = this.listTools()) {
    const tokens = String(intent || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .filter(t => t.length >= 3);
    if (tokens.length === 0) return [];

    return tools
      .map(tool => {
        const hay = `${tool.name || ''} ${tool.description || ''}`.toLowerCase();
        const score = tokens.filter(tok => hay.includes(tok)).length;
        return { tool, score };
      })
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(row => row.tool);
  }

  /**
   * Read-only pre-task step: memory + tool suggestions + optional blast-radius.
   */
  plan(intent, { target, limit = 3 } = {}) {
    if (!intent || !String(intent).trim()) {
      throw new Error('plan() requires a non-empty intent');
    }

    const memory = this._memory();
    const lessons = memory.query(String(intent).trim(), { limit });
    const guidance = memory.formatPrompt(lessons);
    const suggestedTools = this.suggestTools(intent);

    let blastRadius = null;
    if (target) {
      const dirty = hasUncommittedDiff(this.rootDir, target);
      const report = calculateBlastRadius(target, {
        rootDir: this.rootDir,
        diffAware: dirty,
        semantic: dirty
      });
      blastRadius = summarizeBlast(report, this.rootDir);
    }

    return { intent: String(intent).trim(), lessons, guidance, suggestedTools, blastRadius };
  }

  /**
   * Run a registered tool via argv array (no shell interpolation).
   */
  execute(toolName, toolArgs = []) {
    const tool = this.listTools().find(t => t.name === toolName);
    if (!tool) {
      return {
        ok: false,
        status: 1,
        tool: toolName,
        stdout: '',
        stderr: `Tool "${toolName}" not found in registry.`,
        scriptPath: null
      };
    }

    const scriptPath = path.isAbsolute(tool.scriptPath)
      ? tool.scriptPath
      : path.join(this.rootDir, tool.scriptPath);

    if (!fs.existsSync(scriptPath)) {
      return {
        ok: false,
        status: 1,
        tool: toolName,
        stdout: '',
        stderr: `Script file not found at: ${scriptPath}`,
        scriptPath
      };
    }

    const child = spawnSync(process.execPath, [scriptPath, ...toolArgs], {
      encoding: 'utf8',
      cwd: this.rootDir,
      timeout: 30000
    });

    const status = child.status === null ? 1 : child.status;
    return {
      ok: status === 0,
      status,
      tool: toolName,
      stdout: child.stdout || '',
      stderr: child.stderr || (child.error ? child.error.message : ''),
      scriptPath
    };
  }

  /**
   * Distill a diagnosed episode into long-term memory.
   */
  reflect(data) {
    return this._memory().recordExperience(data);
  }

  /**
   * Plan, optionally execute a tool, and write a failure back into memory.
   */
  run(intent, {
    tool = null,
    args = [],
    target = null,
    exec = false,
    recordOnFailure = false
  } = {}) {
    const planned = this.plan(intent, { target });

    let chosen = tool;
    if (!chosen && exec && planned.suggestedTools.length === 1) {
      chosen = planned.suggestedTools[0].name;
    }

    if (!chosen) {
      return { ...planned, executed: false, result: null, recorded: null };
    }

    const result = this.execute(chosen, args);
    let recorded = null;
    let tracked = null;

    if (this.toolmaker && chosen) {
      try {
        tracked = this.toolmaker.track({
          nameSlug: chosen,
          intentSummary: String(intent || chosen).trim(),
          commandTemplate: `node ${path.relative(this.rootDir, result.scriptPath || chosen)}`
        });
      } catch (e) {
        tracked = null;
      }
    }

    if (!result.ok && recordOnFailure) {
      const errorSignature = String(result.stderr || '')
        .split('\n')
        .find(l => l.includes('Error') || l.includes('fail') || l.includes('invalid')) || '';
      recorded = this.reflect({
        intent,
        trigger_pattern: `tool:${chosen}`,
        failure_mode: String(result.stderr || result.stdout || 'non-zero exit').slice(0, 500),
        root_cause: errorSignature
          ? `Tool "${chosen}" failed: ${errorSignature.trim().slice(0, 150)} (status ${result.status})`
          : `Tool "${chosen}" exited with status ${result.status}`,
        corrective_heuristic: `Re-run ${chosen} with DEBUG=1, inspect stderr, then call reflect() with a diagnosed root cause before retrying.`,
        importance_score: 0.2,
        status: 'failure',
        domain_tags: ['agent-loop', chosen]
      });
    }

    return { ...planned, executed: true, result, recorded, tracked };
  }

  close() {
    if (this.ownsMemory && this.memory) {
      this.memory.close();
      this.memory = null;
    }
    if (this.ownsToolmaker && this.toolmaker) {
      this.toolmaker.close();
      this.toolmaker = null;
    }
  }
}

function splitArgv(argv) {
  const idx = argv.indexOf('--');
  if (idx === -1) return { own: argv, passthrough: [] };
  return { own: argv.slice(0, idx), passthrough: argv.slice(idx + 1) };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--exec') {
      args.exec = true;
    } else if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      if (rawKey.includes('=')) {
        const eqIdx = rawKey.indexOf('=');
        args[rawKey.slice(0, eqIdx)] = rawKey.slice(eqIdx + 1);
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

function applyLanguage(args = {}) {
  const selected = args.lang
    ? (String(args.lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US')
    : i18n.detectLanguage();
  i18n.changeLanguage(selected);
  return selected;
}

function printUsage() {
  console.log('\n' + i18n.t('cli.agent.usage') + '\n');
}

function printPlan(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(i18n.t('cli.agent.plan_header'));
  console.log(i18n.t('cli.agent.intent', { intent: report.intent }));
  console.log();

  if (report.guidance) {
    console.log(report.guidance);
  } else {
    console.log(i18n.t('cli.agent.no_lessons'));
  }

  console.log();
  if (report.suggestedTools.length === 0) {
    console.log(i18n.t('cli.agent.suggested_none'));
  } else {
    console.log(i18n.t('cli.agent.suggested_header', { count: report.suggestedTools.length }));
    for (const t of report.suggestedTools) {
      console.log(`  • ${t.name} — ${t.description || ''}`);
    }
  }

  if (report.blastRadius) {
    const br = report.blastRadius;
    console.log();
    console.log(i18n.t('cli.agent.blast', {
      target: br.target,
      type: br.targetType,
      level: br.riskLevel,
      score: br.riskScore
    }));
    if (br.isDiffAware) {
      console.log(i18n.t('cli.agent.diff_scope', {
        scope: br.scope || 'unknown',
        notes: br.notes ? ' — ' + br.notes : ''
      }));
    }
    if (br.semantic) {
      console.log(i18n.t('cli.agent.semantic', {
        verdict: br.semantic.overallVerdict,
        mode: br.semantic.mode
      }));
    }
    console.log(i18n.t('cli.agent.callers', { direct: br.directCount, tests: br.testCount }));
    if (br.safetyPlan && br.safetyPlan.steps) {
      for (const step of br.safetyPlan.steps) {
        console.log(`  ${step}`);
      }
    }
  }
}

function printRun(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printPlan(report, false);
  console.log();
  if (!report.executed) {
    console.log(i18n.t('cli.agent.no_exec'));
    return;
  }
  const r = report.result;
  console.log(i18n.t('cli.agent.executed', { tool: r.tool, status: r.status }));
  if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
  if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : r.stderr + '\n');
  if (report.recorded) {
    console.log(i18n.t('cli.agent.recorded', { id: report.recorded.id }));
  }
}

function createLoopFromArgs(args) {
  const dbPath = args.db || DEFAULT_DB_PATH;
  const registryPath = args.registry || DEFAULT_REGISTRY;
  let toolmaker = null;
  let ownsToolmaker = false;
  if (dbPath !== ':memory:') {
    toolmaker = new ToolmakerEngine({ dbOrPath: dbPath, registryPath });
    ownsToolmaker = true;
  }
  return new AgentLoop({
    rootDir: args.root || DEFAULT_ROOT,
    registryPath,
    dbPath,
    toolmaker,
    ownsToolmaker
  });
}

function main() {
  const { own, passthrough } = splitArgv(process.argv.slice(2));
  const args = parseArgs(own);
  applyLanguage(args);

  if (args.help || args._.length === 0) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const command = args._[0];
  const intent = args.intent || args._.slice(1).join(' ').trim();
  const loop = createLoopFromArgs(args);
  const json = !!args.json;

  try {
    if (command === 'plan') {
      if (!intent) {
        console.error(i18n.t('cli.agent.plan_requires'));
        printUsage();
        process.exit(1);
      }
      printPlan(loop.plan(intent, { target: args.target }), json);
      process.exit(0);
    }

    if (command === 'run') {
      if (!intent) {
        console.error(i18n.t('cli.agent.run_requires'));
        printUsage();
        process.exit(1);
      }
      const report = loop.run(intent, {
        tool: args.tool || null,
        args: passthrough,
        target: args.target || null,
        exec: !!args.exec || !!args.tool,
        recordOnFailure: !!args['record-failure']
      });
      printRun(report, json);
      process.exit(report.executed && report.result && !report.result.ok ? report.result.status : 0);
    }

    if (command === 'reflect') {
      const trigger = args.trigger;
      const cause = args.cause || args['root-cause'];
      const heuristic = args.heuristic;
      if (!intent || !trigger || !cause || !heuristic) {
        console.error(i18n.t('cli.agent.reflect_requires'));
        process.exit(1);
      }
      const recorded = loop.reflect({
        intent,
        trigger_pattern: trigger,
        failure_mode: args['failure-mode'] || '',
        root_cause: cause,
        corrective_heuristic: heuristic,
        status: args.status || 'recovered',
        domain_tags: String(args.tags || 'agent-loop').split(',').map(s => s.trim()).filter(Boolean)
      });
      if (json) {
        console.log(JSON.stringify(recorded, null, 2));
      } else {
        console.log(recorded.reinforced
          ? i18n.t('cli.agent.reinforced', { id: recorded.id })
          : i18n.t('cli.agent.recorded_ok', { id: recorded.id }));
      }
      process.exit(0);
    }

    if (command === 'tools') {
      const tools = loop.listTools();
      if (json) {
        console.log(JSON.stringify({ tools }, null, 2));
      } else {
        console.log(i18n.t('cli.agent.tools_header'));
        if (tools.length === 0) {
          console.log(i18n.t('cli.agent.tools_none'));
        } else {
          for (const t of tools) {
            console.log(`  • ${t.name} — ${t.description || ''} (${t.scriptPath})`);
          }
        }
      }
      process.exit(0);
    }

    console.error(i18n.t('cli.agent.unknown_command', { command }));
    printUsage();
    process.exit(1);
  } finally {
    loop.close();
  }
}

module.exports = {
  AgentLoop,
  DEFAULT_REGISTRY,
  DEFAULT_ROOT,
  hasUncommittedDiff
};

if (require.main === module) {
  main();
}
