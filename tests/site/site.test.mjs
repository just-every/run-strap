// PUBLIC-001 keeps the run-site and installed-studio journey through their public doors.
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { publicDoors } from './browser-journey.mjs'

const root = new URL('../..', import.meta.url).pathname
const site = join(root, 'dist/site')

test('PUBLIC-001: built site, every guide and installed private doors stay separate at desktop and phone widths', async () => {
  execFileSync(join(root, 'node_modules/.bin/rer'), ['build', '--site'], { cwd: root, stdio: 'pipe' })
  await publicDoors(site)
})
