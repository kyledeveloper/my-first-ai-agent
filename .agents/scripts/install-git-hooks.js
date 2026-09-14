#!/usr/bin/env node
/**
 * Git Hooks Installer
 * 
 * Installs pre-push hook to trigger pre-push-check before each git push.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../');
const gitHooksDir = path.join(repoRoot, '.git', 'hooks');
const prePushHookPath = path.join(gitHooksDir, 'pre-push');

function installHooks() {
  if (!fs.existsSync(gitHooksDir)) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
  }

  const hookScript = `#!/bin/sh
# Pre-Push Security & Code Quality Gatekeeper
# Installed by Antigravity AI Agent

echo "🛡️  Running Pre-Push Security & Code Quality Gatekeeper..."
node .agents/scripts/runner.js pre-push-check "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "❌ Pre-push gatekeeper failed. Push aborted."
  exit $EXIT_CODE
fi

exit 0
`;

  fs.writeFileSync(prePushHookPath, hookScript, { mode: 0o755 });
  // Ensure executable permissions on POSIX
  try {
    fs.chmodSync(prePushHookPath, 0o755);
  } catch (e) {
    // Ignore chmod errors on unsupported environments
  }

  console.log(`✅ Git pre-push hook installed successfully at: ${prePushHookPath}`);
}

if (require.main === module) {
  installHooks();
}

module.exports = { installHooks };
