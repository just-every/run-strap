// The demo studio: East Nashville, on Central time. Names, packs and the day's
// classes follow the owner-picked "Today" screen; every figure is produced by
// Strap's own domain commands when the demo starts.
export const studio = { location: 'East Nashville', timeZone: 'America/Chicago' }
export const ownerName = 'Mara Ellis'
export const instructorNames = ['Dana Reyes', 'Kim Lowe', 'Tessa Moore', 'Ray Chen']

// [name, credits, price in cents, paid in cents]
export const memberPacks: [string, number, number, number][] = [
  ['Alicia Stone', 20, 34000, 34000], ['Megan Kerr', 20, 34000, 34000], ['Jordan Park', 10, 18900, 18900], ['Lucia Cruz', 20, 34000, 34000],
  ['Nora Price', 20, 34000, 34000], ['Emma Olsen', 20, 34000, 34000], ['Sam Reyes', 10, 18900, 18900], ['Tara Bell', 20, 34000, 34000],
  ['Kara Wells', 20, 34000, 34000], ['Jasmine Hart', 20, 34000, 34000], ['Abby Cole', 20, 34000, 34000], ['Diane Lowry', 20, 34000, 17000],
  ['Rachel Moss', 10, 18900, 18900], ['Casey Nguyen', 5, 10500, 10500], ['Lena Ortiz', 5, 10500, 10500], ['Tom Grady', 20, 34000, 34000],
  ['Chris Lee', 10, 18900, 0], ['Jess Alvarez', 3, 3900, 3900], ['Ana Patel', 10, 18900, 18900], ['Taylor Kim', 3, 3900, 0],
  ['Maria Santos', 20, 34000, 34000], ['Grace Liu', 20, 34000, 34000], ['Hannah Brooks', 10, 18900, 18900], ['Olivia Grant', 20, 34000, 34000],
  ['Priya Desai', 20, 34000, 34000], ['Zoe Martin', 10, 18900, 18900], ['Ruth Adler', 20, 34000, 34000], ['Ivy Chen', 20, 34000, 34000],
  ['Paige Turner', 20, 34000, 34000], ['Leah Burns', 10, 18900, 18900], ['Mia Russo', 20, 34000, 34000], ['Claire Dunn', 20, 34000, 34000],
  ['Erin Walsh', 20, 34000, 34000], ['Sofia Ramos', 10, 18900, 18900], ['Holly Pierce', 20, 34000, 34000], ['Nina Shah', 20, 34000, 34000],
  ['Beth Ward', 5, 10500, 10500], ['Wendy Fox', 20, 34000, 34000], ['Owen Fisher', 0, 0, 0], ['Jordan Bailey', 5, 10500, 10500],
  ['Noel Carter', 5, 10500, 10500], ['Shay Mitchell', 3, 3900, 3900],
]
// Paused members: inactive access is Strap's current pause.
export const inactive = ['Noel Carter', 'Shay Mitchell']

export interface Slot { time: string; minutes: number; title: string; room: string; capacity: number; instructor: number }
const flow = (time: string, instructor = 0): Slot => ({ time, minutes: 50, title: 'Reformer Flow', room: 'Reformer room', capacity: 12, instructor })
const mat = (time: string, instructor = 1): Slot => ({ time, minutes: 60, title: 'Mat Yoga', room: 'Sun room', capacity: 24, instructor })
const express = (time: string): Slot => ({ time, minutes: 45, title: 'Reformer Express', room: 'Reformer room', capacity: 12, instructor: 0 })
const barre = (time: string): Slot => ({ time, minutes: 50, title: 'Barre', room: 'Barre room', capacity: 20, instructor: 2 })
const restore = (time: string, instructor = 1): Slot => ({ time, minutes: 60, title: 'Restore Yoga', room: 'Sun room', capacity: 24, instructor })

/** Today's five classes, with who is booked, waiting and who cancelled, in booking order. */
export const today: { slot: Slot; booked: string[]; waitlist?: string[]; cancel?: string[] }[] = [
  { slot: flow('06:00'), booked: ['Alicia Stone', 'Megan Kerr', 'Jordan Park', 'Lucia Cruz', 'Nora Price', 'Emma Olsen', 'Sam Reyes', 'Tara Bell', 'Kara Wells', 'Jasmine Hart', 'Abby Cole', 'Diane Lowry'], waitlist: ['Rachel Moss', 'Casey Nguyen'] },
  { slot: mat('09:30'), booked: ['Sam Reyes', 'Lena Ortiz', 'Tom Grady', 'Chris Lee', 'Jess Alvarez', 'Maria Santos', 'Grace Liu', 'Hannah Brooks', 'Olivia Grant', 'Priya Desai', 'Zoe Martin', 'Ruth Adler', 'Ivy Chen', 'Paige Turner', 'Leah Burns', 'Mia Russo', 'Claire Dunn', 'Erin Walsh', 'Sofia Ramos'], cancel: ['Tom Grady'] },
  // Full, then four cancel: Owen waits with no credit, so the open spots stay open.
  { slot: express('12:15'), booked: ['Holly Pierce', 'Nina Shah', 'Beth Ward', 'Wendy Fox', 'Megan Kerr', 'Lucia Cruz', 'Emma Olsen', 'Tara Bell', 'Kara Wells', 'Abby Cole', 'Jordan Bailey', 'Maria Santos'], waitlist: ['Owen Fisher'], cancel: ['Kara Wells', 'Abby Cole', 'Jordan Bailey', 'Maria Santos'] },
  { slot: barre('17:30'), booked: ['Alicia Stone', 'Nora Price', 'Jasmine Hart', 'Diane Lowry', 'Grace Liu', 'Hannah Brooks', 'Olivia Grant', 'Priya Desai', 'Ruth Adler', 'Ivy Chen', 'Paige Turner', 'Mia Russo', 'Claire Dunn', 'Erin Walsh', 'Holly Pierce', 'Nina Shah'] },
  { slot: restore('18:00'), booked: ['Wendy Fox', 'Rachel Moss', 'Zoe Martin', 'Leah Burns', 'Sofia Ramos', 'Beth Ward', 'Taylor Kim', 'Lena Ortiz', 'Olivia Grant', 'Ruth Adler', 'Ivy Chen'] },
]

/** The week's pattern, Monday first, for the days ahead. */
export const week: Slot[][] = [
  [flow('06:00'), mat('09:30'), express('12:15'), barre('17:30'), restore('18:00')],
  [flow('06:00'), mat('09:30'), barre('17:30'), barre('19:00'), restore('18:00')],
  [flow('06:00'), mat('09:30'), express('12:15'), barre('17:30'), restore('18:00')],
  [flow('06:00'), mat('09:30'), barre('17:30'), barre('19:00'), restore('18:00')],
  [flow('06:00'), mat('09:30'), express('12:15'), barre('17:30')],
  [flow('08:00', 3), mat('10:00', 3)],
  [restore('09:00', 3)],
]
