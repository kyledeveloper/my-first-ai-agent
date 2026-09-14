/**
 * Blast-Radius Analysis & Safety Plan Generator
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { SymbolGraph } = require('./index');
const { findNodesAtLines } = require('./parser');

/**
 * Parse unified diff text and extract modified line numbers for the specified file.
 * @param {string} diffText
 * @param {string} [targetFilePath]
 * @returns {number[]} 1-based modified line numbers
 */
function parseDiffHunks(diffText, targetFilePath) {
  if (!diffText || typeof diffText !== 'string') return [];

  const lines = new Set();
  const fileChunks = diffText.split(/^diff --git /m);
  const targetBase = targetFilePath ? path.basename(targetFilePath) : null;

  for (const chunk of fileChunks) {
    if (!chunk.trim()) continue;

    if (targetBase) {
      const headerMatch = chunk.match(/(?:---|\+\+\+)\s+[ab]\/([^\n\r]+)/g);
      const belongsToTarget = !headerMatch || headerMatch.some(h => h.includes(targetBase));
      if (!belongsToTarget) continue;
    }

    const hunkRegex = /^@@\s+-(?:\d+)(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
    let match;
    while ((match = hunkRegex.exec(chunk)) !== null) {
      const newStart = parseInt(match[1], 10);
      const newCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;

      if (newCount === 0) {
        lines.add(newStart);
      } else {
        for (let i = 0; i < newCount; i++) {
          lines.add(newStart + i);
        }
      }
    }
  }

  // If no lines matched chunks (e.g. diff without git headers), match directly
  if (lines.size === 0) {
    const hunkRegex = /^@@\s+-(?:\d+)(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
    let match;
    while ((match = hunkRegex.exec(diffText)) !== null) {
      const newStart = parseInt(match[1], 10);
      const newCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;

      if (newCount === 0) {
        lines.add(newStart);
      } else {
        for (let i = 0; i < newCount; i++) {
          lines.add(newStart + i);
        }
      }
    }
  }

  return Array.from(lines).sort((a, b) => a - b);
}

/**
 * Extract modified line numbers from options.diff or git diff -U0.
 */
function getModifiedLines(filePath, options = {}) {
  if (options.diff) {
    return parseDiffHunks(options.diff, filePath);
  }

  if (options.diffAware) {
    try {
      const res = spawnSync('git', ['diff', '-U0', 'HEAD', '--', filePath], {
        encoding: 'utf8',
        cwd: options.rootDir || process.cwd()
      });
      if (res.stdout && res.stdout.trim()) {
        return parseDiffHunks(res.stdout, filePath);
      }
      const resWorktree = spawnSync('git', ['diff', '-U0', '--', filePath], {
        encoding: 'utf8',
        cwd: options.rootDir || process.cwd()
      });
      if (resWorktree.stdout && resWorktree.stdout.trim()) {
        return parseDiffHunks(resWorktree.stdout, filePath);
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  return null;
}

/**
 * Evaluate if file modifications are confined to local private scope.
 */
function evaluateDiffScope(targetFile, graph, options) {
  const modifiedLines = getModifiedLines(targetFile, options);
  if (modifiedLines === null) {
    return { isDiffAware: false };
  }

  if (modifiedLines.length === 0) {
    return {
      isDiffAware: true,
      scope: 'CLEAN',
      modifiedLines: [],
      notes: 'No modified lines detected in target file [CLEAN].'
    };
  }

  const fileNode = graph.getFileNode(targetFile);
  if (!fileNode) {
    return { isDiffAware: true, scope: 'PUBLIC_CONTRACT', modifiedLines };
  }

  const { matchedNodes, touchesTopLevel, touchesExports } = findNodesAtLines(fileNode, modifiedLines);
  const touchedSymbols = matchedNodes.map(n => n.name);

  let isPublic = touchesTopLevel || touchesExports;
  for (const node of matchedNodes) {
    if ((fileNode.exports || []).includes(node.name)) {
      isPublic = true;
      break;
    }
    const externalCallers = graph.findSymbolCallers(node.name).filter(f => f !== targetFile);
    if (externalCallers.length > 0) {
      isPublic = true;
      break;
    }
  }

  if (!isPublic) {
    return {
      isDiffAware: true,
      scope: 'LOCAL_PRIVATE',
      modifiedLines,
      touchedSymbols,
      notes: `Changes strictly confined to internal private scope [LOCAL_PRIVATE]: ${touchedSymbols.join(', ') || 'internal lines'}.`
    };
  }

  return {
    isDiffAware: true,
    scope: 'PUBLIC_CONTRACT',
    modifiedLines,
    touchedSymbols,
    notes: `Changes affect public contract [PUBLIC_CONTRACT]: ${touchedSymbols.join(', ') || 'exported statements'}.`
  };
}

/**
 * Calculate the blast radius of modifying a file or a symbol.
 * @param {string} target - Target file path or symbol name
 * @param {object} options - Options { graph, maxDepth, rootDir, diff, diffAware }
 * @returns {object} Blast radius analysis report
 */
function calculateBlastRadius(target, options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const graph = options.graph || new SymbolGraph({ rootDir });
  if (!options.graph) {
    graph.build();
  }

  const maxDepth = options.maxDepth || 10;
  let targetType = 'symbol';
  let targetFile = null;
  let targetSymbol = null;
  let declarationFile = null;

  // 1. Resolve Target
  const resolvedTargetAsPath = path.resolve(rootDir, target);
  if (fs.existsSync(resolvedTargetAsPath) && fs.statSync(resolvedTargetAsPath).isFile()) {
    targetType = 'file';
    targetFile = resolvedTargetAsPath;
  } else if (target.endsWith('.js') || target.includes('/')) {
    // Check if there is an indexed file matching this basename or suffix
    const allFiles = Array.from(graph.fileNodes.keys());
    const matched = allFiles.find(f => f.endsWith('/' + target) || path.basename(f) === target);
    if (matched) {
      targetType = 'file';
      targetFile = matched;
    } else {
      targetType = 'file';
      targetFile = resolvedTargetAsPath;
    }
  } else {
    // Check if target is a registered symbol
    const decls = graph.findSymbol(target);
    if (decls.length > 0) {
      targetType = 'symbol';
      targetSymbol = target;
      declarationFile = decls[0].filePath;
      targetFile = declarationFile;
    } else {
      // Check if target matches a file basename without extension (e.g. "db")
      const allFiles = Array.from(graph.fileNodes.keys());
      const matched = allFiles.find(f => path.basename(f, path.extname(f)) === target);
      if (matched) {
        targetType = 'file';
        targetFile = matched;
      } else {
        targetType = 'symbol';
        targetSymbol = target;
      }
    }
  }

  let directFiles = [];
  let indirectFiles = [];
  let impactedTests = [];

  const diffEval = (targetType === 'file' && (options.diff || options.diffAware))
    ? evaluateDiffScope(targetFile, graph, options)
    : { isDiffAware: false };

  const isDiffAware = diffEval.isDiffAware;
  const scope = diffEval.scope || 'PUBLIC_CONTRACT';
  const notes = diffEval.notes || null;

  if (targetType === 'file' && isDiffAware && scope === 'CLEAN') {
    return {
      target: targetFile ? path.relative(rootDir, targetFile) : target,
      targetType: 'file',
      targetFile,
      isDiffAware: true,
      scope: 'CLEAN',
      riskScore: 0,
      riskLevel: 'LOW',
      directFiles: [],
      directCount: 0,
      indirectFiles: [],
      indirectCount: 0,
      impactedTests: [],
      testCount: 0,
      safetyPlan: {
        steps: ['No modifications detected in target file. Isolated clean state.'],
        recommendedTestCommands: ['npm test']
      },
      notes
    };
  }

  if (targetType === 'file' && isDiffAware && scope === 'LOCAL_PRIVATE') {
    return {
      target: targetFile ? path.relative(rootDir, targetFile) : target,
      targetType: 'file',
      targetFile,
      isDiffAware: true,
      scope: 'LOCAL_PRIVATE',
      touchedSymbols: diffEval.touchedSymbols || [],
      riskScore: 5,
      riskLevel: 'LOW',
      directFiles: [],
      directCount: 0,
      indirectFiles: [],
      indirectCount: 0,
      impactedTests: [],
      testCount: 0,
      safetyPlan: {
        steps: [
          '1. Local verification: Changes confined to internal private scope [LOCAL_PRIVATE].',
          '2. Targeted check: Run test suite to verify internal logic integrity.'
        ],
        recommendedTestCommands: ['npm test']
      },
      notes
    };
  }

  if (targetType === 'file') {
    directFiles = graph.getDownstreamFiles(targetFile);
    const transitive = graph.getTransitiveDownstream(targetFile, maxDepth);
    indirectFiles = transitive.map(t => t.file).filter(f => !directFiles.includes(f));
  } else {
    // Symbol-level: find direct callers
    const callers = graph.findSymbolCallers(targetSymbol);
    directFiles = callers.filter(c => c !== declarationFile);

    // Indirect dependents: downstream dependents of direct callers
    const indirectSet = new Set();
    for (const callerFile of directFiles) {
      const trans = graph.getTransitiveDownstream(callerFile, maxDepth);
      for (const item of trans) {
        if (!directFiles.includes(item.file) && item.file !== declarationFile) {
          indirectSet.add(item.file);
        }
      }
    }
    indirectFiles = Array.from(indirectSet);
  }

  // Filter impacted test suites
  const allImpacted = Array.from(new Set([...directFiles, ...indirectFiles]));
  impactedTests = allImpacted.filter(f => /(?:^|\/)(?:test|tests)\/.*\.test\.js$/i.test(f));

  // Risk scoring
  const nDirect = directFiles.length;
  const nIndirect = indirectFiles.length;
  const nTests = impactedTests.length;
  const isCore = targetFile && targetFile.includes('/src/') && (nDirect >= 2);
  const coreBonus = isCore ? 20 : 0;

  const rawScore = 15 * nDirect + 8 * nIndirect + 20 * nTests + coreBonus;
  const riskScore = Math.min(100, Math.max(5, rawScore));

  let riskLevel = 'LOW';
  if (riskScore >= 70) {
    riskLevel = 'HIGH';
  } else if (riskScore >= 30) {
    riskLevel = 'MEDIUM';
  }

  // Safety plan generation
  const recommendedTestCommands = impactedTests.length > 0
    ? impactedTests.map(t => `node ${path.relative(rootDir, t)}`)
    : ['npm test'];

  const steps = [
    `1. Pre-flight check: Run baseline tests (${recommendedTestCommands[0] || 'npm test'}) before starting modifications.`,
    `2. Code update: Modify target (${targetType}: ${path.basename(targetFile || target)}) keeping exported contracts intact.`
  ];

  if (nDirect > 0) {
    steps.push(`3. Review call-sites: Inspect and update ${nDirect} direct caller module(s).`);
  }
  if (impactedTests.length > 0) {
    steps.push(`4. Regression testing: Re-run ${impactedTests.length} impacted test suite(s) to verify zero regressions.`);
  } else {
    steps.push(`4. Regression testing: Run full test suite (npm test) to verify integrity.`);
  }

  return {
    target: targetFile ? path.relative(rootDir, targetFile) : target,
    targetType,
    targetFile,
    targetSymbol,
    declarationFile,
    isDiffAware,
    scope,
    notes,
    directFiles,
    directCount: directFiles.length,
    indirectFiles,
    indirectCount: indirectFiles.length,
    impactedTests,
    testCount: impactedTests.length,
    riskScore,
    riskLevel,
    safetyPlan: {
      steps,
      recommendedTestCommands
    }
  };
}

module.exports = {
  calculateBlastRadius,
  parseDiffHunks
};
