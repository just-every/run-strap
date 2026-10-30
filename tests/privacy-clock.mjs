import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'
export async function privacyClock() {
  const dir=await mkdtemp(join(tmpdir(),'strap-privacy-clock-')),clock=join(dir,'offset'),library=join(dir,process.platform==='darwin'?'clock.dylib':'clock.so')
  const run=(command,args,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{env,stdio:'inherit'});child.once('error',reject);child.once('close',resolve)})
  try {
    assert.equal(await run(process.env.CC||'cc',[...(process.platform==='darwin'?['-dynamiclib']:['-shared','-fPIC']),'-O2','tests/recovery-clock.c','-o',library]),0)
    await writeFile(clock,String(Math.floor((Date.parse('2032-01-01T12:00:00Z')-Date.now())/1000)))
    assert.equal(await run(process.execPath,['tests/privacy-timed-journey.mjs'],{...process.env,[process.platform==='darwin'?'DYLD_INSERT_LIBRARIES':'LD_PRELOAD']:library,STRAP_RECOVERY_CLOCK:clock}),0,'privacy expiry and integration journey')
  } finally {await rm(dir,{recursive:true,force:true})}
}
