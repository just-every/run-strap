import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// The ordinary studio shard must exercise elapsed routines, not return before
// them. Only this child process and its native runtime receive a fixed clock.
export async function leadsClock(journey) {
  if(process.env.STRAP_RECOVERY_CLOCK) return journey()
  const dir=await mkdtemp(join(tmpdir(),'strap-leads-clock-')),clock=join(dir,'offset'),library=join(dir,process.platform==='darwin'?'clock.dylib':'clock.so')
  const run=(command,args,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{env,stdio:'inherit'});child.once('error',reject);child.once('close',code=>resolve(code))})
  try {
    assert.equal(await run(process.env.CC || 'cc',[...(process.platform==='darwin'?['-dynamiclib']:['-shared','-fPIC']),'-O2','tests/recovery-clock.c','-o',library]),0)
    const start=Date.parse('2032-01-05T12:00:00Z')
    await writeFile(clock,String(Math.floor((start-Date.now())/1000)))
    const key=process.platform==='darwin'?'DYLD_INSERT_LIBRARIES':'LD_PRELOAD',env={...process.env,[key]:[library,process.env[key]].filter(Boolean).join(process.platform==='darwin'?':':' '),STRAP_RECOVERY_CLOCK:clock}
    delete env.NODE_TEST_CONTEXT
    assert.equal(await run(process.execPath,['-e',`if(Math.abs(Date.now()-${start})>5000)throw Error('Native clock was not loaded')`],env),0)
    assert.equal(await run(process.execPath,['--test','--test-name-pattern=LEAD-004','tests/leads.test.mjs'],env),0,'elapsed routine and agent review journey')
  } finally {await rm(dir,{recursive:true,force:true})}
}
