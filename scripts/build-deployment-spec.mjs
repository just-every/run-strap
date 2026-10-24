import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {deploymentSpec} from './delivery/base/spec.mjs';

const config = JSON.parse(await readFile(new URL('../packaging.json', import.meta.url), 'utf8'));
const path = new URL('../management/integration/deployment-spec.json', import.meta.url);
const bytes = JSON.stringify(await deploymentSpec(process.cwd(), config.artifact.specInputs), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw Error('Deployment specification is stale; run pnpm delivery:spec after the real build.');
  console.log('Deployment specification matches the real build and source policy.');
} else {
  await mkdir(new URL('.', path), {recursive: true});
  await writeFile(path, bytes);
  console.log('Wrote management/integration/deployment-spec.json');
}
