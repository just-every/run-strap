// Generate the legacy seed's acceptance and claims without rewriting clause text.
import fs from 'node:fs';
import { parseContract } from '../src/base/seed-contract.mjs';

const marker='<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->';
const source=fs.readFileSync('CONTRACT.md','utf8'),lines=source.split('\n');
const summary=lines.findIndex(line=>/^\| Clauses \| Done \| Partial \| Missing \| Total \|$/.test(line));
if(summary<0)throw Error('Missing contract summary');
const without=lines.filter((_,i)=>i<summary||i>summary+4).join('\n');
const parsed=parseContract(without);
const tally=clauses=>[...['done','partial','missing'].map(status=>clauses.filter(c=>c.status===status).length),clauses.length];
lines.splice(summary+2,3,...[['Published',parsed.clauses.filter(c=>c.kind==='published')],['Target and push further',parsed.clauses.filter(c=>c.kind!=='published')],['All',parsed.clauses]].map(([label,clauses])=>'| '+label+' | '+tally(clauses).join(' | ')+' |'));
const contract=lines.join('\n'),checked=parseContract(contract);
const row=c=>lines[c.row-1].split(/(?<!\\)\|/).slice(1,-1).map(v=>v.trim());
const judged=lines.find(line=>line.startsWith('Judged from')) ?? '';
const counts='| Clauses | Done | Partial | Missing | Total |\n| --- | ---: | ---: | ---: | ---: |\n'+lines.slice(summary+2,summary+5).join('\n');
const acceptance=[marker,'# First release and target acceptance',judged,'## Progress',counts];
for(const area of [...new Set(checked.clauses.map(c=>c.area))]) {
  acceptance.push('## '+area);
  for(const c of checked.clauses.filter(c=>c.area===area)) {
    const cells=row(c);
    acceptance.push(`- **${c.id} — ${c.title}.** **Status:** ${c.status}. ${c.text} **Current evidence:** ${cells[4]||'None.'}${cells[5]?' **Gap:** '+cells[5]:''}`);
  }
}
const claims=[marker,'# Strap contract claims',judged,counts,'| Clause | Status | Evidence | Gap |\n| --- | --- | --- | --- |\n'+checked.clauses.map(c=>{const cells=row(c);return `| \`${c.id}\` | ${c.status} | ${cells[4]} | ${cells[5]} |`;}).join('\n')];
const files={'CONTRACT.md':contract,'ACCEPTANCE.md':acceptance.join('\n\n')+'\n','docs/CLAIMS.md':claims.join('\n\n')+'\n'};
if(!['write','check'].includes(process.argv[2]))throw Error('Usage: node scripts/contract-docs.mjs write|check');
for(const [name,content] of Object.entries(files)) {
  if(process.argv[2]==='write') {fs.mkdirSync(name.includes('/')?name.slice(0,name.lastIndexOf('/')):'.',{recursive:true});fs.writeFileSync(name,content);}
  else if(!fs.existsSync(name)||fs.readFileSync(name,'utf8')!==content)throw Error(name+' is stale; run node scripts/contract-docs.mjs write');
}
console.log('Contract documents '+(process.argv[2]==='check'?'checked':'generated')+': '+checked.clauses.length+' clauses.');
