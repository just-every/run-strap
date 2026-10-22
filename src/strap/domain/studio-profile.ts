import { insist, text } from './types';
import { phoneDigits } from './phone';

const optional = (value: unknown, name: string, max: number) => value === '' || value === null ? null : text(value,name,max);
const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));
const clock = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Optional configuration, retained on older location/time-zone-only saves. */
export function studioProfile(input: Record<string,unknown>) {
  const result: Record<string,unknown> = {};
  for (const [key,max] of [['legalName',160],['receiptDetails',1000]] as const) {
    if (key in input) result[key] = optional(input[key],key,max);
  }
  if ('phone' in input) result.phone = phoneDigits(input.phone);
  if ('address' in input) {
    const address = input.address;
    if (address === null) result.address = null;
    else {
      insist(address && typeof address === 'object' && !Array.isArray(address),'invalid_address');
      const a = address as Record<string,unknown>;
      const region = text(a.region,'address_region',2).toUpperCase();
      const postalCode = text(a.postalCode,'address_postal_code',10);
      insist(states.has(region),'invalid_address_region');
      insist(/^\d{5}(?:-\d{4})?$/.test(postalCode),'invalid_address_postal_code');
      insist(a.country === 'US','invalid_address_country');
      result.address = {line1:text(a.line1,'address_line1',160),line2:optional(a.line2 ?? '', 'address_line2',160),
        city:text(a.city,'address_city',100),region,postalCode,country:'US'};
    }
  }
  if ('businessHours' in input) {
    insist(Array.isArray(input.businessHours) && input.businessHours.length <= 7,'invalid_business_hours');
    const days = new Set<number>();
    result.businessHours = input.businessHours.map(row => {
      insist(row && typeof row === 'object' && !Array.isArray(row),'invalid_business_hours');
      const {day,opens,closes} = row;
      insist(Number.isInteger(day) && day >= 1 && day <= 7 && !days.has(day),'invalid_business_hours_day');
      insist(clock(opens) && clock(closes) && opens < closes,'invalid_business_hours_interval');
      days.add(day);
      return {day,opens,closes};
    }).sort((a,b) => a.day-b.day);
  }
  return result;
}
