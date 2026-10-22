// STUDIO-002: which location a ledger row or class belongs to, from the retained records alone.
// A charge or receipt belongs to the location named on it, else the class of the booking it was assessed on,
// else the sale location of its pack, else the original location. Reports and the manager's scope share this.
import type { RecordData } from './domain/types'

type Row = RecordData
export interface Ledger { classes: Row[]; bookings: Row[]; packs: Row[]; charges: Row[] }
const byId = (rows: Row[], id: unknown) => rows.find(row => row.id === id)

export function ledgerLocation(row: Row, ledger: Ledger): string {
  if (row.locationId) return row.locationId
  const charge = row.chargeId ? byId(ledger.charges, row.chargeId) : row.reversesChargeId ? byId(ledger.charges, row.reversesChargeId) : row
  const booking = byId(ledger.bookings, row.bookingId ?? charge?.bookingId)
  const entry = byId(ledger.classes, row.classId ?? charge?.classId ?? booking?.classId)
  if (entry) return entry.locationId ?? 'studio'
  const pack = byId(ledger.packs, row.packId ?? charge?.packId ?? booking?.packId)
  return pack?.locationId ?? 'studio'
}
export const zoneOfLocation = (locations: Row[] | undefined, id: string, fallback: string) => locations?.find(l => l.id === id)?.timeZone ?? fallback
