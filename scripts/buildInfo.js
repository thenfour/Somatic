// gathers build info (git tag, etc).
// meant for baking into the sources for display in the about dialog.

const childProcess = require('child_process');

function safeExec(command) {
  try {
    return childProcess.execSync(command, { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function getBuildInfo() {
  const gitTag = safeExec('git describe --tags --abbrev=0');

  let commitsSinceTag = null;
  if (gitTag) {
    const count = safeExec(`git rev-list ${gitTag}..HEAD --count`);
    commitsSinceTag = count != null ? parseInt(count, 10) : null;
  }

  const dirtyOutput = safeExec('git status --porcelain');
  const dirty = dirtyOutput == null ? null : dirtyOutput.length > 0;

  const commitHash = safeExec('git rev-parse --short HEAD');
  const lastCommitDate = safeExec('git log -1 --format=%cI');
  const buildDate = new Date().toISOString();

  return {
    gitTag,
    commitsSinceTag,
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
