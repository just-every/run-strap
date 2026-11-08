import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Re-execute only this case with one native wall clock for Node, workerd and
// SQLite's commit fences. Monotonic timers and the host clock are untouched.
export async function fixedClock(t, file, instant, journey) {
  const start = Date.parse(instant), identity = file + '#' + t.name
  if (process.env.STRAP_FIXED_CLOCK_TEST === identity) {
    assert.ok(Math.abs(Date.now() - start) < 5000, 'test-owned native clock is loaded')
    return journey()
  }
  const dir = await mkdtemp(join(tmpdir(), 'strap-fixed-clock-'))
  const clock = join(dir, 'offset'), library = join(dir, process.platform === 'darwin' ? 'clock.dylib' : 'clock.so')
  const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', code => resolve(code))
  })
  try {
    assert.equal(await run(process.env.CC || 'cc', [...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']), '-O2', 'tests/recovery-clock.c', '-o', library]), 0)
    // A caller may already be probing another date with recovery-clock.c.
    // Remove that offset before replacing its preload, rather than stacking it.
    const inherited = process.env.STRAP_RECOVERY_CLOCK ? Number(await readFile(process.env.STRAP_RECOVERY_CLOCK, 'utf8')) * 1000 : 0
    await writeFile(clock, String(Math.floor((start - (Date.now() - inherited)) / 1000)))
    const key = process.platform === 'darwin' ? 'DYLD_INSERT_LIBRARIES' : 'LD_PRELOAD'
    const env = { ...process.env, [key]: library, STRAP_RECOVERY_CLOCK: clock, STRAP_FIXED_CLOCK_TEST: identity }
    delete env.NODE_TEST_CONTEXT
    const pattern = '^' + t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
    assert.equal(await run(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=' + pattern, fileURLToPath(file)], env), 0, 'journey passes at ' + instant)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
