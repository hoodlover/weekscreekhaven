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
  const commitsByDay = new Map();

  for (const commit of commits) {
    const day = commit.date.slice(0, 10);
    if (!commitsByDay.has(day)) commitsByDay.set(day, []);
    commitsByDay.get(day).push(commit);
  }

  let totalHours = 0;

  for (const dayCommits of commitsByDay.values()) {
    let dailyHours = 0;
    let session = [];

    const closeSession = () => {
      if (session.length === 0) return;

      const firstTime = new Date(session[0].date).getTime();
      const lastTime = new Date(session.at(-1).date).getTime();
      const spanHours = (lastTime - firstTime) / 36e5;
      const changedLines = session.reduce((sum, commit) => sum + commit.insertions + commit.deletions, 0);
      const changedFiles = session.reduce((sum, commit) => sum + commit.files, 0);

      let sessionHours = Math.max(0.75, spanHours + 0.5);

      if (changedLines > 750 || changedFiles > 25) sessionHours += 0.75;
      if (changedLines > 2500 || changedFiles > 75) sessionHours += 1.25;

      dailyHours += sessionHours;
      session = [];
    };

    for (const commit of dayCommits) {
      const previous = session.at(-1);
      if (previous) {
        const gapHours = (new Date(commit.date).getTime() - new Date(previous.date).getTime()) / 36e5;
        if (gapHours > 1.5) closeSession();
      }

      session.push(commit);
    }

    closeSession();

    totalHours += Math.min(dailyHours, 10);
  }

  return Math.max(1, Math.round(totalHours));
}

const commits = parseHistory();
const distinctDays = new Set(commits.map((commit) => commit.date.slice(0, 10))).size;
const totalCommits = commits.length;
const estimatedBuildHours = estimateHours(commits);
const rawCommitHoursAt45Minutes = Math.round(totalCommits * 0.75);
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
  rawCommitHoursAt45Minutes,
  estimateMethod:
    'Groups commit bursts into work sessions, starts each session at 45 minutes, adds time for session span and larger changes, and caps any single day at 10 hours.',
  interpretationNote:
    'This repository has many auto-save/upload commits, so build hours are interpreted from clustered work sessions instead of treating every commit as a separate 45-minute work block.',
});

console.log(version);
