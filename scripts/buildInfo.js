// gathers build info.
// meant for baking into the sources for display in the about dialog.

const childProcess = require('child_process');
const packageJson = require('../package.json');

function safeExec(command) {
  try {
    return childProcess.execSync(command, { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function getBuildInfo() {
  const dirtyOutput = safeExec('git status --porcelain');
  const dirty = dirtyOutput == null ? null : dirtyOutput.length > 0;

  const commitHash = safeExec('git rev-parse --short HEAD');
  const lastCommitDate = safeExec('git log -1 --format=%cI');
  const buildDate = new Date().toISOString();

  return {
     appVersion: packageJson.version || '-1.0.0',
    dirty,
    buildDate,
    lastCommitDate,
    commitHash,
  };
}

const BUILD_INFO = getBuildInfo();

function getBridgeCartFilename(info = BUILD_INFO) {
  const id = info && info.commitHash ? info.commitHash : 'dev';
  return `bridge-${id}.tic`;
}

module.exports = {
  BUILD_INFO,
  getBuildInfo,
  getBridgeCartFilename,
};
