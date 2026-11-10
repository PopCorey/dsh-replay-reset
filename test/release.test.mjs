import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const match = workflow.match(/          node --input-type=module <<'NODE'\r?\n([\s\S]*?)          NODE/);
assert.ok(match, 'release workflow must retain its testable registry check');
const source = match[1].replace(/^          /gm, '')
  .replace("import fs from 'node:fs';", '')
  .replace("import path from 'node:path';", '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const check = new AsyncFunction('fs', 'path', 'process', 'fetch', 'AbortSignal', 'console', source);

async function runCheck({status = 404, version = '0.1.4', integrity = 'sha512-example', error} = {}) {
  let output = '';
  let requests = 0;
  const pack = {name: 'dsh-replay-reset', version, integrity: 'sha512-example'};
  const fs = {
    readFileSync(file) {
      assert.equal(file, path.join('temp', 'npm-pack.json'));
      return JSON.stringify([pack]);
    },
    appendFileSync(file, text) {
      assert.equal(file, 'outputs');
      output += text;
    },
  };
  const fetch = async (url, options) => {
    requests++;
    assert.equal(url, `https://registry.npmjs.org/dsh-replay-reset/${version}`);
    assert.ok(options.signal instanceof AbortSignal);
    if (error) throw error;
    return {status, json: async () => ({dist: {integrity}})};
  };
  await check(fs, path, {env: {RUNNER_TEMP: 'temp', GITHUB_OUTPUT: 'outputs'}}, fetch, AbortSignal, {log() {}});
  assert.equal(requests, 1, 'registry failure must not cause blind retries');
  return output;
}

test('release workflow grants OIDC, pins capable npm, and publishes only after tests and packaging', () => {
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm@11\.17\.0 --ignore-scripts/);
  assert.ok(workflow.indexOf('npm run test:unit') < workflow.indexOf('npm pack --ignore-scripts'));
  assert.ok(workflow.indexOf('Check npm version') < workflow.indexOf('npm publish '));
  assert.ok(workflow.indexOf('npm publish ') < workflow.indexOf('gh release create'));
  assert.match(workflow, /if: steps\.npm\.outputs\.exists != 'true'/);
  assert.match(workflow, /--registry https:\/\/registry\.npmjs\.org\/ --provenance/);
  assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN|continue-on-error/);
});

test('unpublished stable release uses latest', async () => {
  assert.equal(await runCheck(), 'exists=false\ntag=latest\n');
});

test('unpublished prerelease uses next rather than latest', async () => {
  assert.equal(await runCheck({version: '0.2.0-beta.1'}), 'exists=false\ntag=next\n');
});

test('identical published version can resume without republishing', async () => {
  assert.equal(await runCheck({status: 200}), 'exists=true\ntag=latest\n');
});

test('published version with different or absent integrity refuses overwrite', async () => {
  await assert.rejects(runCheck({status: 200, integrity: 'sha512-other'}), /different contents/);
  await assert.rejects(runCheck({status: 200, integrity: null}), /different contents/);
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`registry HTTP ${status} is an error, not permission to publish`, async () => {
    await assert.rejects(runCheck({status}), new RegExp(`HTTP ${status}`));
  });
}

test('registry network failure is not treated as missing package', async () => {
  const error = new Error('simulated network failure');
  await assert.rejects(runCheck({error}), error);
});
