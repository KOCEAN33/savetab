#!/usr/bin/env node
// Builds the GitHub Release assets into apps/extension/.output/release.
// Usage: node scripts/package-release.mjs
// Env:
//   RELEASE_TAG       optional, fails unless it equals v<apps/extension/package.json version>
//   AMO_JWT_ISSUER    with AMO_JWT_SECRET, signs the Firefox build on the AMO unlisted channel
//   AMO_JWT_SECRET
//   GITHUB_OUTPUT     set by GitHub Actions, receives `dir` and `signed`
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = 'KOCEAN33/savetab';
const GECKO_ID = 'savetab@kocean33';

const root = resolve(import.meta.dirname, '..');
const ext = join(root, 'apps/extension');
const outDir = join(ext, '.output');
const releaseDir = join(outDir, 'release');

const { version } = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8'));
const tag = `v${version}`;
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== tag) {
  console.error(`Tag ${process.env.RELEASE_TAG} does not match apps/extension/package.json version ${version}.`);
  process.exit(1);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const wxt = (args, env = {}) => run('pnpm', ['exec', 'wxt', ...args], { cwd: ext, env: { ...process.env, ...env } });

// wxt names its zips `<package name>-<version>-<target>.zip`, so match by suffix.
const wxtZip = (suffix) => {
  const name = readdirSync(outDir).find((f) => f.endsWith(`-${version}-${suffix}.zip`));
  if (!name) throw new Error(`wxt produced no *-${version}-${suffix}.zip in ${outDir}`);
  return join(outDir, name);
};

rmSync(outDir, { recursive: true, force: true });
wxt(['zip'], { SAVETAB_SELF_DISTRIBUTED: '1' });
wxt(['zip', '-b', 'firefox'], { SAVETAB_SELF_DISTRIBUTED: '1' });
mkdirSync(releaseDir);

const asset = (name) => join(releaseDir, `savetab-${version}-${name}`);
copyFileSync(wxtZip('chrome'), asset('chrome.zip'));

// The wxt sources zip holds only apps/extension, without packages/core or the lockfile,
// so a reviewer cannot rebuild from it. The tagged commit is the full buildable tree.
run('git', ['archive', '--format=zip', `--prefix=savetab-${version}/`, '-o', asset('sources.zip'), 'HEAD'], {
  cwd: root,
});

const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;
const signed = Boolean(AMO_JWT_ISSUER && AMO_JWT_SECRET);
if (signed) {
  const artifacts = mkdtempSync(join(tmpdir(), 'savetab-sign-'));
  // web-ext reads the credentials from env, which keeps them out of the process list.
  run(
    'pnpm',
    [
      'exec',
      'web-ext',
      'sign',
      '--channel=unlisted',
      `--source-dir=${join(outDir, 'firefox-mv3')}`,
      `--artifacts-dir=${artifacts}`,
      `--upload-source-code=${asset('sources.zip')}`,
    ],
    { cwd: ext, env: { ...process.env, WEB_EXT_API_KEY: AMO_JWT_ISSUER, WEB_EXT_API_SECRET: AMO_JWT_SECRET } },
  );
  const xpis = readdirSync(artifacts).filter((f) => f.endsWith('.xpi'));
  if (xpis.length !== 1) throw new Error(`expected one signed xpi in ${artifacts}, found ${xpis.length}`);
  copyFileSync(join(artifacts, xpis[0]), asset('firefox.xpi'));
} else {
  copyFileSync(wxtZip('firefox'), asset('firefox.zip'));
}

// Firefox update manifest: https://extensionworkshop.com/documentation/manage/updating-your-extension/
const updates = {
  addons: {
    [GECKO_ID]: {
      updates: [
        { version, update_link: `https://github.com/${REPO}/releases/download/${tag}/savetab-${version}-firefox.xpi` },
      ],
    },
  },
};
writeFileSync(join(releaseDir, 'updates.json'), `${JSON.stringify(updates, null, 2)}\n`);

const install = [
  `- Chrome: unzip \`savetab-${version}-chrome.zip\`, open \`chrome://extensions\`, turn on Developer mode, and choose Load unpacked. Chrome does not update it.`,
  signed
    ? `- Firefox: open the \`savetab-${version}-firefox.xpi\` link in Firefox. It updates itself from later releases.`
    : `- Firefox: this release has no signed build, because the AMO credentials were missing. Release Firefox does not install \`savetab-${version}-firefox.zip\` permanently. Load it from \`about:debugging\` as a temporary add-on, or install it in Firefox Developer Edition with \`xpinstall.signatures.required\` set to \`false\`.`,
  `- \`savetab-${version}-sources.zip\`: the source tree of this tag.`,
];
writeFileSync(join(releaseDir, 'notes.md'), `## Install\n\n${install.join('\n')}\n`);

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `dir=${releaseDir}\nsigned=${signed}\n`);
console.log(`\nRelease assets in ${releaseDir} (Firefox ${signed ? 'signed' : 'unsigned'}):`);
for (const f of readdirSync(releaseDir)) console.log(`  ${f}`);
