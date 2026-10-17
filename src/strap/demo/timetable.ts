// Priya, Taylor, Alex and Sam carry forward the studio's integration examples.
export const memberNames = ['Alex Rivera', 'Sam Okafor', 'Jamie Chen', 'Avery Wilson', 'Jordan Patel', 'Casey Nguyen', 'Riley Thompson', 'Quinn Davis', 'Harper Lewis', 'Emerson Garcia', 'Sage Robinson', 'Rowan Clark', 'Elliot Walker', 'Finley Hall', 'Cameron Young', 'Drew Allen', 'Reese Wright', 'Blair Scott', 'Parker Green', 'Hayden Adams', 'Skyler Baker', 'Remy Nelson', 'Noel Carter', 'Shay Mitchell']

export function timetable(monday: Date, instructors: { id: string }[], history: boolean) {
  const slots = history ? [[0, 9], [2, 17], [4, 9], [5, 10]] : Array.from({ length: 7 }, (_, day) => [[day, 7], [day, 17]]).flat()
  return slots.map(([day, hour], i) => {
    const start = new Date(monday); start.setUTCDate(start.getUTCDate() + day); start.setUTCHours(hour)
    return {
      title: ['Morning Pilates · Reformer room', 'Slow Flow Yoga · Sun room', 'Strength & Mobility · Reformer room', 'Restorative Yoga · Sun room'][i % 4],
      start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString(),
      capacity: 8, instructorId: instructors[i % instructors.length].id,
    }
  })
}
