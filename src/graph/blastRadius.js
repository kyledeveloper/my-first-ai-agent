/**
 * Blast-Radius Analysis & Safety Plan Generator
 */

const path = require('path');
const fs = require('fs');
const { SymbolGraph } = require('./index');

/**
 * Calculate the blast radius of modifying a file or a symbol.
 * @param {string} target - Target file path or symbol name
 * @param {object} options - Options { graph, maxDepth, rootDir }
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

module.exports = { calculateBlastRadius };
