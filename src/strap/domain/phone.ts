import { insist } from './types';

/** A US phone (the studio default) as its 10 digits: punctuation, spaces, +1 and a leading 1 are dropped. */
export function phoneDigits(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const digits = String(value).replace(/[\s().+-]/g,'');
  insist(/^1?\d{10}$/.test(digits),'invalid_phone');
  return digits.slice(-10);
}
