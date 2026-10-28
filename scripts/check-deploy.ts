/**
 * `bun scripts/check-deploy.ts`: the deploy workflow's last step before
 * `wrangler deploy` (#232). Fails when wrangler.jsonc would ship without
 * Access (an empty `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN`) or with the dev
 * bypass (`DEV_ACCESS_EMAIL`). The rules are in deploy-config.ts.
 */
import { readFileSync } from 'node:fs';
import { deployProblems } from './deploy-config.ts';

const problems = deployProblems(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log('wrangler.jsonc: Access is configured, no dev bypass.');
