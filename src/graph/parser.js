/**
 * Lightweight Zero-Dependency AST & Token Parser for JavaScript
 * 
 * Extracts imports, exports, symbol declarations, and call sites.
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolve relative or local module import path to an absolute file path.
 * @param {string} importPath - Path string from require() or import
 * @param {string} currentFilePath - File making the import
 * @returns {string|null} - Absolute path if local, or null if built-in/package
 */
function resolveModulePath(importPath, currentFilePath) {
  if (!importPath || typeof importPath !== 'string') return null;
  // Ignore built-in modules or node_modules packages
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  const baseDir = path.dirname(currentFilePath);
  const target = path.resolve(baseDir, importPath);

  // Exact file match
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return target;
  }

  // Check extensions
  const extensions = ['.js', '.json', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'];
  for (const ext of extensions) {
    const withExt = target + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt;
    }
  }

  // Check index file in directory
  for (const ext of extensions) {
    const indexPath = path.join(target, 'index' + ext);
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return indexPath;
    }
  }

  return target;
}

/**
 * Strip line and block comments without treating // inside strings as comments.
 * Preserves "https://..." and similar URL literals that a naive //.* regex would truncate.
 */
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;

  while (i < n) {
    const c = code[i];
    const next = i + 1 < n ? code[i + 1] : '';

    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const ch = code[i];
        out += ch;
        if (ch === '\\' && i + 1 < n) {
          out += code[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === '/' && next === '/') {
      i += 2;
      while (i < n && code[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i + 1 < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/**
 * Parse source code string and extract symbols, dependencies, and exports.
 * @param {string} code - Source code
 * @param {string} filePath - Absolute file path
 * @returns {object} Parsed symbol metadata
 */
function parseSource(code, filePath) {
  if (!code || typeof code !== 'string') {
    return {
      filePath,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      callSites: []
    };
  }

  // Strip block and line comments to avoid token corruption
  const cleanCode = stripComments(code);

  const imports = [];
  const exportsList = new Set();
  const functions = [];
  const classes = [];
  const callSites = new Set();

  // 1. Extract require() imports: const { a, b } = require('...') OR const a = require('...')
  const cjsRequireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s*=\s*require\((["'][^"']+["'])\)/g;
  let match;
  while ((match = cjsRequireRegex.exec(cleanCode)) !== null) {
    const rawNamed = match[1];
    const defaultName = match[2] || null;
    const source = match[3].replace(/["']/g, '');
    const named = rawNamed ? rawNamed.split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : null;
    const resolvedPath = resolveModulePath(source, filePath);

    imports.push({
      type: 'cjs',
      source,
      resolvedPath,
      defaultName,
      named
    });
  }

  // 2. Extract ESM imports: import { a, b } from '...' OR import a from '...'
  const esmImportRegex = /import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from\s+(["'][^"']+["'])/g;
  while ((match = esmImportRegex.exec(cleanCode)) !== null) {
    const rawNamed = match[1];
    const defaultName = match[2] || null;
    const source = match[3].replace(/["']/g, '');
    const named = rawNamed ? rawNamed.split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : null;
    const resolvedPath = resolveModulePath(source, filePath);

    imports.push({
      type: 'esm',
      source,
      resolvedPath,
      defaultName,
      named
    });
  }

  // import * as ns from '...'
  const esmNamespaceImport = /import\s+\*\s+as\s+([a-zA-Z0-9_$]+)\s+from\s+(["'][^"']+["'])/g;
  while ((match = esmNamespaceImport.exec(cleanCode)) !== null) {
    const source = match[2].replace(/["']/g, '');
    imports.push({
      type: 'esm',
      source,
      resolvedPath: resolveModulePath(source, filePath),
      defaultName: match[1],
      named: null
    });
  }

  // 3. Extract Classes and base class extensions
  const classRegex = /class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+([a-zA-Z0-9_$]+))?\s*\{/g;
  while ((match = classRegex.exec(cleanCode)) !== null) {
    classes.push({
      name: match[1],
      extends: match[2] || null
    });
    if (match[2]) {
      callSites.add(match[2]);
    }
  }

  // 4. Extract Functions
  // Standard functions: function foo(...)
  const stdFuncRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/g;
  while ((match = stdFuncRegex.exec(cleanCode)) !== null) {
    functions.push({
      name: match[1],
      params: match[2].split(',').map(p => p.trim()).filter(Boolean)
    });
  }

  // Arrow & variable functions: const foo = (params) => OR const foo = async function(...)
  const varFuncRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|[a-zA-Z0-9_$]+)\s*=>/g;
  while ((match = varFuncRegex.exec(cleanCode)) !== null) {
    functions.push({
      name: match[1],
      params: (match[2] || '').split(',').map(p => p.trim()).filter(Boolean)
    });
  }

  // 5. Extract Exports
  // module.exports = { a, b, c }
  const cjsMultiExport = /module\.exports\s*=\s*\{([^}]+)\}/;
  const multiMatch = cleanCode.match(cjsMultiExport);
  if (multiMatch) {
    const items = multiMatch[1].split(',').map(s => s.trim());
    items.forEach(item => {
      // Handles 'a' or 'key: a'
      const name = item.includes(':') ? item.split(':')[0].trim() : item;
      if (name && /^[a-zA-Z0-9_$]+$/.test(name)) {
        exportsList.add(name);
      }
    });
  }

  // module.exports = Name (direct export)
  const cjsSingleExport = /module\.exports\s*=\s*([a-zA-Z0-9_$]+)\s*(?:;|$)/g;
  while ((match = cjsSingleExport.exec(cleanCode)) !== null) {
    if (match[1] !== '{') exportsList.add(match[1]);
  }

  // exports.name = ...
  const cjsNamedExport = /exports\.([a-zA-Z0-9_$]+)\s*=/g;
  while ((match = cjsNamedExport.exec(cleanCode)) !== null) {
    exportsList.add(match[1]);
  }

  // ESM exports: export const a = ... OR export function a() ...
  const esmNamedExports = /export\s+(?:const|let|var|function|class)\s+([a-zA-Z0-9_$]+)/g;
  while ((match = esmNamedExports.exec(cleanCode)) !== null) {
    exportsList.add(match[1]);
  }

  // ESM named list: export { a, b as c }
  const esmListExport = /export\s+\{([^}]+)\}/g;
  while ((match = esmListExport.exec(cleanCode)) !== null) {
    match[1].split(',').forEach(item => {
      const trimmed = item.trim();
      if (!trimmed) return;
      const parts = trimmed.split(/\s+as\s+/);
      const publicName = (parts[1] || parts[0]).trim();
      if (publicName && /^[a-zA-Z0-9_$]+$/.test(publicName)) {
        exportsList.add(publicName);
      }
    });
  }

  // 6. Extract Call Sites (e.g. foo(...) or obj.method(...))
  const callRegex = /(?:([a-zA-Z0-9_$]+)\.)?([a-zA-Z0-9_$]{2,})\s*\(/g;
  while ((match = callRegex.exec(cleanCode)) !== null) {
    const objectName = match[1] || null;
    const methodName = match[2];
    const keywords = ['if', 'for', 'while', 'switch', 'catch', 'require', 'import', 'return', 'function'];
    if (!keywords.includes(methodName)) {
      if (objectName) callSites.add(`${objectName}.${methodName}`);
      callSites.add(methodName);
    }
  }

  return {
    filePath,
    imports,
    exports: Array.from(exportsList),
    functions,
    classes,
    callSites: Array.from(callSites)
  };
}

module.exports = {
  resolveModulePath,
  parseSource,
  stripComments
};
