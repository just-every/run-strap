// Tagged template for the run site's static pages: interpolated values are
// escaped unless they are markup made by `raw` or another html`` call.
const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => escapes[c])

export class Markup { constructor(readonly value: string) {} toString() { return this.value } }
export const raw = (value: string) => new Markup(value)

const part = (value: unknown): string => value instanceof Markup ? value.value : Array.isArray(value) ? value.map(part).join('') : value === false || value == null ? '' : escape(value)
export const html = (strings: TemplateStringsArray, ...values: unknown[]) => new Markup(strings.reduce((out, text, i) => out + text + (i < values.length ? part(values[i]) : ''), ''))

/** Keeps separators (·, ×, =), date-range dashes, "am"/"pm" and inline icons on the line of the word before them, so no wrapped line starts with one. */
export const keepTogether = (markup: Markup) => raw(markup.value
  .replace(/>([^<]+)</g, (_, text: string) => `>${text.replace(/ (·|×|=) /g, '\u00a0$1 ').replace(/(\d)–(\d)/g, '$1\u2060–\u2060$2').replace(/(\d) (am|pm)\b/g, '$1\u00a0$2')}<`)
  .replace(/ ([^\s<>]+) (<svg class="(?:arr|tick)"[^]*?<\/svg>)/g, ' <span class="nw">$1\u00a0$2</span>'))
