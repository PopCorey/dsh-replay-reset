import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';

/** Host location is supplied locally; no developer-specific paths are committed. */
export function configuredHostRoot(env=process.env) {
  const value=env.DSH_TEST_ROOT ?? env.DSH_TEST_ASAR_ROOT ?? env.DSH_REVIEW_ASAR;
  return value ? resolve(value) : undefined;
}
export function requireHostRoot(env=process.env) {
  const root=configuredHostRoot(env);
  if(!root) throw new Error('Set DSH_TEST_ROOT to the tested DSH app.asar or unpacked installation root. See CONTRIBUTING.md.');
  if(!existsSync(join(root,'package.json'))) throw new Error('DSH_TEST_ROOT must contain the host package.json; app.asar requires the Electron executable.');
  return root;
}
