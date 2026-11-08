// 10 Moving in: the Mindbody import rehearsal, and Strap's one-line start in a
// terminal (the start line and plain comments, nothing else).
import { html, raw } from '../html'
import { check, heading } from './parts'
import run from '../run.json'

// The one start line every Run Edit Run page shows (the installer, then rer dev); the npx line is the alternative.
const start = `curl -fsSL https://runeditrun.com/install.sh | sh -s -- ${run.clone.slice('npx -y @runeditrun/rer '.length)}`
// Words stay whole when a line wraps, and the installer's `install.sh | sh` stays together.
const words = (line: string) => raw(line.split(/(\S*install\.sh \| sh|\S+)/).map(part => {
  const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
  return pipe ? `<span class="nobr">${pipe[1]}</span><wbr><span class="nobr">${pipe[2]}</span>` : part.trim() ? `<span class="nobr">${part}</span>` : part
}).join(''))

const rows: { text: string; wait?: boolean }[] = [
  { text: 'Rows read · 640 · 4 columns each' },
  { text: 'New members · 598 · imported inactive' },
  { text: 'Already in Strap · 42 · left unchanged', wait: true },
  { text: 'Credits and charges · none created' },
  { text: 'Invitations · none sent' },
  { text: 'Original file · kept in the journal' },
  { text: 'Undo · ready' },
]

export const moving = html`<section class="band band-sea moving" aria-labelledby="moving-title"><div class="wrap moving-grid">
  <div class="moving-copy">
    ${heading('moving-title', 'Moving in', 'Bring your member list across.')}
    <p class="lede lede-lg">Strap reads a member CSV in the Mindbody layout, keeps the original file and a journal of every change, and undoes an import cleanly.</p>
    <div class="terminal" role="group" aria-label="Start Strap on your computer"><p class="terminal-dots" aria-hidden="true"><i></i><i></i><i></i></p>
      <pre><code><span class="prompt" aria-hidden="true">$ </span>${words(start)}
<span class="comment"># ${words('installs rer, then gets and starts Strap on your computer')}</span>
<span class="comment"># ${words(`Already have Node 22 or later? ${run.clone}`)}</span></code></pre></div>
  </div>
  <article class="card import-card"><h3>Mindbody member CSV · preview</h3>
    <ul>${rows.map(r => html`<li>${r.wait ? html`<span class="amber-dot" aria-label="Waiting"></span>` : check(true)}<span>${r.text}</span></li>`)}</ul>
    <p class="import-actions"><span class="btn btn-sm">Apply import</span></p></article>
</div></section>`
