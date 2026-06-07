// Programmatic Jasmine runner so `pnpm test` works without a global jasmine
// CLI install. Configures Jasmine, registers our reporter, then loads specs.

import Jasmine from 'jasmine';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
process.chdir(projectRoot);

const jasmine = new Jasmine();
jasmine.loadConfigFile(resolve(projectRoot, 'spec/support/jasmine.json'));
jasmine.exitOnCompletion = false;

const result = await jasmine.execute();
// The reporter writes kensho-results/ regardless of the suite outcome.
process.exit(0);
