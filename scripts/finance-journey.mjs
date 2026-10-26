import { spawn } from 'node:child_process'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// Run outside push Verify: Node, workerd and SQLite inherit one native wall
// clock. The journey advances it by atomically replacing the offset file.
const { values } = parseArgs({ options: { start: { type: 'string', default: '2032-01-01T07:00:00Z' } } })
const start = Date.parse(values.start)
if (!Number.isFinite(start)) throw new Error('--start must be an ISO date-time')
if (!['linux', 'darwin'].includes(process.platform)) throw new Error('The finance clock journey requires Linux or macOS')

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'strap-finance-clock-'))
const clock = join(dir, 'offset'), library = join(dir, process.platform === 'darwin' ? 'clock.dylib' : 'clock.so')
let active, interrupted
const signals = new Map([['SIGINT', 130], ['SIGTERM', 143]])
const forward = signal => {
  interrupted = signal
  if (active) {
    try { process.kill(-active.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}
const handlers = [...signals].map(([signal]) => {
  const handler = () => forward(signal)
  process.on(signal, handler)
  return [signal, handler]
})
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  if (interrupted) return resolve(signals.get(interrupted))
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true })
  active = child
  child.once('error', reject)
  child.once('close', (code, signal) => { active = undefined; resolve(code ?? signals.get(signal) ?? 1) })
})

try {
  const flags = process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']
  let code = await run(process.env.CC || 'cc', [...flags, '-O2', 'tests/recovery-clock.c', '-o', library])
  if (code !== 0) throw new Error(`Clock helper compilation failed (${code})`)
  await writeFile(clock + '.new', String(Math.floor(start / 1000) - Math.floor(Date.now() / 1000)) + '\n')
  await rename(clock + '.new', clock)
  const key = process.platform === 'darwin' ? 'DYLD_INSERT_LIBRARIES' : 'LD_PRELOAD'
  const env = { ...process.env, [key]: [library, process.env[key]].filter(Boolean).join(process.platform === 'darwin' ? ':' : ' '), STRAP_RECOVERY_CLOCK: clock, STRAP_FINANCE_TIMING: '1', TZ: 'America/Phoenix' }
  // Refuse an ignored preload (for example a protected macOS Node binary).
  code = await run(process.execPath, ['-e', `if(Math.abs(Date.now()-${start})>5000)throw new Error('Native clock preload did not reach Node')`], env)
  if (code !== 0) throw new Error(`Clock preload check failed (${code})`)
  console.log(`Finance journey starts at ${new Date(start).toISOString()} (studio clock)`)
  process.exitCode = await run(process.execPath, ['--test', '--test-name-pattern=RPT-004', 'tests/reports.test.mjs'], env)
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler)
  await rm(dir, { recursive: true, force: true })
}
