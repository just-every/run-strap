// The app's layout: top bar, studio navigation, panels, rows and forms. Tokens
// come from /rer-theme.css and the shared components (mat, cards, pills,
// buttons, initials) from /brand/strap.css; this inline sheet is admitted by
// its hash.
export const style = `
*,*::before,*::after{box-sizing:border-box}
html{background:var(--rer-page);color:var(--rer-text);font:400 16px/1.5 var(--rer-font-body);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;text-rendering:optimizeLegibility}
body{margin:0;min-height:100vh}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
:focus-visible{outline:3px solid var(--rer-focus);outline-offset:2px;border-radius:6px}
.btn:focus-visible,.btn-outline:focus-visible{border-radius:999px}
h1,h2,h3{font-family:var(--rer-font-heading);text-wrap:balance}
p{text-wrap:pretty}
code{font:500 .88em/1.4 var(--strap-mono);padding:1px 5px;border-radius:6px;background:#F3EFE9;overflow-wrap:anywhere}
time,.row-sub,.row-meta,.credits{font-variant-numeric:tabular-nums}
.skip{position:absolute;left:16px;top:-60px;z-index:2;padding:10px 16px;border-radius:12px;background:var(--rer-surface);box-shadow:var(--strap-card-shadow)}.skip:focus{top:12px}
.top{display:flex;align-items:center;gap:20px;max-width:1440px;height:64px;margin:0 auto;padding:0 32px;border-bottom:1px solid var(--strap-rule);background-clip:content-box}
.top::after{content:none}
.lockup{display:inline-flex;align-items:center;gap:10px;margin-right:auto;font:600 22px/1 var(--rer-font-heading);letter-spacing:-.01em;text-decoration:none}.lockup img{width:28px;height:28px;display:block}
.who{margin:0;color:var(--rer-muted);font-size:14px;overflow-wrap:anywhere}
.settings{position:relative;padding-left:20px;font-size:14px}.settings::before{content:'';position:absolute;left:0;top:50%;width:1px;height:20px;transform:translateY(-50%);background:var(--strap-rule)}
.signout{margin:0}.signout .btn-outline{min-height:40px;padding:0 18px;font-size:14px}
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);max-width:1440px;margin:0 auto;padding:0 32px}
nav.studio{display:flex;flex-direction:column;gap:4px;padding:32px 24px 32px 0;border-right:1px solid var(--strap-rule);min-height:calc(100vh - 64px)}
nav.studio a{display:flex;align-items:center;min-height:44px;padding:0 16px;border-radius:12px;font-size:16px;text-decoration:none;color:var(--rer-text);transition:background-color .15s ease}
nav.studio a:hover{background:rgba(28,33,41,.04)}
nav.studio a[aria-current]{background:var(--strap-berry-tint);box-shadow:inset 4px 0 0 var(--strap-berry);font-weight:600}
main{min-width:0;max-width:1168px;padding:40px 0 96px 48px}
h1{margin:0 0 8px;font-size:34px;line-height:1.15;font-weight:600;letter-spacing:-.02em}
h1+.columns,h1+.grid,h1+section,h1+.notice{margin-top:24px}
.lede{max-width:78ch;margin:0 0 28px;color:var(--rer-muted)}
.meta,.help,.empty{color:var(--rer-muted);font-size:14px;line-height:1.45}
.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:20px;align-items:start}
.columns.wide-aside{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.col-main,.col-aside{display:grid;gap:20px;min-width:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px;align-items:start;margin-top:20px}
.full{display:grid;gap:20px;margin-top:20px}
.panel{min-width:0;padding:24px}
.panel h2{margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
.panel>p{margin:0 0 16px}
.mat-surface{padding:12px}
.mat-surface>.panel{border-color:transparent;box-shadow:var(--strap-mat-card-shadow)}
.mat-surface>.panel>h2{padding-bottom:14px;margin-bottom:0;border-bottom:1px solid var(--strap-rule)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:16px 0;border-top:1px solid var(--strap-rule)}
h2+.row,.row:first-child{border-top:0}
.mat-surface h2+.row{border-top:0}
.row.current{position:relative;margin:4px -12px;padding:16px 12px 16px 20px;border-radius:12px;border-top-color:transparent;background:var(--strap-berry-tint);box-shadow:inset 4px 0 0 var(--strap-berry)}
.row.current+.row{border-top-color:transparent}
.row-main{flex:1 1 200px;min-width:0}
.row-main h3,.class-block h3{margin:0;font-size:17px;line-height:1.35;font-weight:600}
.row-sub{margin:2px 0 0;color:var(--rer-muted);font-size:14px;line-height:1.5}
.row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0;color:var(--rer-muted);font-size:14px;line-height:1.5}
.row-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.row-more{display:flex;flex-wrap:wrap;column-gap:28px;flex-basis:100%;min-width:0}
.row-more>*{flex-basis:100%;min-width:0}
.row-more>details{flex-basis:auto;margin-top:0;border-top:0}
.row-more>details[open]{flex-basis:100%}
.row-more:empty{display:none}
.role{min-width:72px}
.class-block>h3{font-size:24px;letter-spacing:-.01em}
.class-block>.row-sub{margin:6px 0 4px;font-size:15px}
.class-block{padding-top:16px}.class-block+.class-block{margin-top:24px;padding-top:24px;border-top:1px solid var(--strap-rule)}
.attendees{margin-top:12px;border-top:1px solid var(--strap-rule)}
.attendees>.row:first-child{border-top:0}
.credits{padding:4px 0}.credits+.credits{border-top:1px solid var(--strap-rule);padding-top:16px}
.credits-count{margin:0 0 6px;font-size:22px;font-weight:600;letter-spacing:-.01em}.credits-count strong{font-size:34px;font-weight:700}
.waiver-text{white-space:pre-wrap;margin:12px 0}
form{margin:0}
form.fields{display:grid;gap:16px}
form.act{display:inline-flex}
.row-more form.act,.actions form.act{margin-top:12px}
.actions{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}.actions details{flex-basis:100%}
label{display:grid;gap:6px;font-size:14px;font-weight:600}
label:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:10px;font-weight:400;font-size:15px}
input:not([type=checkbox]):not([type=hidden]),select,textarea{width:100%;min-width:0;min-height:48px;padding:10px 14px;border:1px solid var(--rer-border);border-radius:12px;background:var(--rer-surface);color:var(--rer-text);font:400 16px/1.4 var(--rer-font-body)}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--rer-focus);outline-offset:1px;border-color:var(--rer-focus)}
input[type=checkbox]{flex:none;width:20px;height:20px;margin:1px 0 0;accent-color:var(--strap-berry)}
/* Single-choice selects: two-line chevron in --rer-text, its right edge 14px in from the border; multiple and size>1 lists stay native. */
select:not([multiple]):not([size]),select[size="1"]:not([multiple]){-webkit-appearance:none;appearance:none;padding-right:44px;background:linear-gradient(45deg,transparent calc(50% - .8px),var(--rer-text) calc(50% - .8px) calc(50% + .8px),transparent calc(50% + .8px)) calc(100% - 21px) 50%/7px 7px no-repeat,linear-gradient(-45deg,transparent calc(50% - .8px),var(--rer-text) calc(50% - .8px) calc(50% + .8px),transparent calc(50% + .8px)) calc(100% - 14px) 50%/7px 7px no-repeat,var(--rer-surface)}
textarea{min-height:150px;resize:vertical;font-family:var(--strap-mono);font-size:14px}
.field-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:16px;align-items:end}
form.fields>.btn{justify-self:start;min-width:180px}
.col-aside form.fields>.btn{justify-self:stretch}
details{margin-top:12px;border-top:1px solid var(--strap-rule)}
summary{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer;font-size:15px;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'';width:8px;height:8px;margin:0 4px 0 2px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(-45deg);transition:transform .15s ease}
details[open]>summary::before{transform:rotate(45deg)}
details>:not(summary){margin-bottom:12px}
pre{max-width:100%;max-height:420px;overflow:auto;margin:12px 0 0;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--strap-rule);border-radius:12px;background:var(--rer-surface);font:400 13px/1.55 var(--strap-mono)}
.notice{margin:0 0 20px;padding:14px 16px 14px 20px;border:1px solid var(--strap-rule);border-radius:12px;background:var(--rer-surface);box-shadow:inset 4px 0 0 var(--strap-berry)}
.notice.error{border-color:var(--strap-berry);background:var(--strap-berry-tint);color:var(--strap-berry);font-weight:600}
.empty{margin:0}
.empty-mat{display:grid;place-items:center;min-height:360px;margin:8px 0 0;padding:56px 128px 56px 48px;border-radius:18px 8px 8px 18px}
.empty-mat>.card{width:min(100%,560px);padding:32px;text-align:center}
.empty-mat>.card p{margin:0 0 20px;font-size:19px;line-height:1.5}
.empty-mat+.grid{margin-top:32px}
@media (max-width:1023px){
.shell{display:block;padding:0 24px}
.top{padding:0 24px}
nav.studio{flex-direction:row;gap:8px;min-height:0;margin:0 -24px;padding:12px 24px;border-right:0;border-bottom:1px solid var(--strap-rule);overflow-x:auto;scrollbar-width:none}
nav.studio a{flex:none;min-height:44px;padding:0 18px;white-space:nowrap}
nav.studio a[aria-current]{scroll-initial-target:nearest}
main{padding:28px 0 72px}
.columns,.columns.wide-aside{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:639px){
.top{display:grid;grid-template-columns:1fr auto;height:auto;gap:6px 12px;padding:14px 16px 10px}
.lockup{grid-column:1}.signout{grid-column:2;grid-row:1}
.who{grid-column:1/-1;font-size:14px}
.settings{grid-column:1/-1;justify-self:start;padding-left:0;font-size:14px}.settings::before{content:none}
.shell{padding:0 16px}
nav.studio{margin:0 -16px;padding:10px 16px}
main{padding:24px 0 64px}
h1{font-size:28px}
.panel{padding:16px}
.mat-surface{margin-top:12px;padding:36px 10px 12px}.mat-surface::before{content:'';position:absolute;top:-10px;left:-5px;right:-5px;height:44px;border-radius:18px;background:var(--strap-roll-across);box-shadow:var(--strap-roll-shadow)}
.row.current{margin:4px -8px;padding:14px 8px 14px 16px}
.row-meta{flex-basis:100%}
.row-actions{flex-basis:100%}
.row:has(>.initials)>.row-meta,.row:has(>.initials)>.row-actions,.row:has(>.initials)>.row-more{padding-left:48px}
.class-block>h3{font-size:21px}
.empty-mat{min-height:0;padding:72px 18px 48px;border-radius:18px}
.empty-mat.roll-end::after{top:-12px;bottom:auto;left:-5px;right:-5px;width:auto;height:56px;border-radius:22px;background:var(--strap-roll-across);box-shadow:var(--strap-roll-shadow)}
.empty-mat.roll-end::before{content:none}
.empty-mat>.card{padding:24px 18px}
.empty-mat>.card p{font-size:17px}
form.fields>.btn{justify-self:stretch}
}
`
