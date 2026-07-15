import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function parseHistory() {
  const log = git([
    'log',
    '--reverse',
    '--date=iso-strict',
    '--shortstat',
    '--pretty=format:__COMMIT__%x09%H%x09%ad',
  ]);

  const commits = [];
  let current = null;

  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('__COMMIT__\t')) {
      const [, hash, date] = line.split('\t');
      current = { hash, date, files: 0, insertions: 0, deletions: 0 };
      commits.push(current);
      continue;
    }

    if (!current) continue;

    const files = line.match(/(\d+) files? changed/);
    const insertions = line.match(/(\d+) insertions?\(\+\)/);
    const deletions = line.match(/(\d+) deletions?\(-\)/);

    current.files = files ? Number(files[1]) : 0;
    current.insertions = insertions ? Number(insertions[1]) : 0;
    current.deletions = deletions ? Number(deletions[1]) : 0;
  }

  return commits;
}

function estimateHours(commits) {
  let hours = 0;
  let previousTime = null;

  for (const commit of commits) {
    const changedLines = commit.insertions + commit.deletions;
    const changedFiles = commit.files;
    const commitTime = new Date(commit.date).getTime();

    hours += 0.75;

    if (changedLines > 150 || changedFiles > 8) hours += 0.25;
    if (changedLines > 600 || changedFiles > 25) hours += 0.5;
    if (changedLines > 2000 || changedFiles > 60) hours += 1;

    if (previousTime !== null) {
      const gapHours = (commitTime - previousTime) / 36e5;
      if (gapHours > 1 && gapHours <= 4) hours += Math.min(gapHours * 0.3, 1);
      if (gapHours > 4 && gapHours <= 12) hours += 0.75;
    }

    previousTime = commitTime;
  }

  return Math.max(1, Math.round(hours));
}

const commits = parseHistory();
const distinctDays = new Set(commits.map((commit) => commit.date.slice(0, 10))).size;
const totalCommits = commits.length;
const estimatedBuildHours = estimateHours(commits);
const version = `${distinctDays}.${estimatedBuildHours}.${totalCommits}`;

const packagePath = join(root, 'package.json');
const packageLockPath = join(root, 'package-lock.json');
const buildVersionPath = join(root, 'build-version.json');

const packageJson = readJson(packagePath);
packageJson.version = version;
packageJson.scripts = {
  ...packageJson.scripts,
  'version:update': 'node scripts/update-version.mjs',
};
writeJson(packagePath, packageJson);

const packageLock = readJson(packageLockPath);
packageLock.version = version;
if (packageLock.packages?.['']) {
  packageLock.packages[''].version = version;
}
writeJson(packageLockPath, packageLock);

writeJson(buildVersionPath, {
  version,
  format: 'days.hours.commits',
  distinctCommitDays: distinctDays,
  estimatedBuildHours,
  totalCommits,
  estimateMethod:
    'Starts at 45 minutes per commit, then adjusts upward for larger changes and commit gaps that suggest longer sessions.',
});

console.log(version);
