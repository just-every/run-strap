import {
  body,
  cell,
  emptyLine,
  field,
  form,
  h,
  hidden,
  panel,
  select,
  table,
} from "./shared";
const path = "/app/time-clock",
  req = () => hidden("requestId", crypto.randomUUID());
export function timeClockPage(s: any) {
  const clock = s.timeClock ?? { shifts: [], corrections: [], approvals: [] },
    owner = s.actor.role === "owner";
  const shifts = clock.shifts
    .map((r: any) => {
      const own = r.actorId === s.actor.id,
        key = req() + hidden("shiftId", r.id) + hidden("revision", r.revision);
      const controls =
        own && !r.effective.endAt
          ? form("clock.out", path, key, "Clock out") +
            form(
              r.breaks.some((b: any) => !b.endAt)
                ? "clock.break.end"
                : "clock.break.start",
              path,
              key,
              r.breaks.some((b: any) => !b.endAt) ? "End break" : "Start break",
            )
          : "";
      return `<tr>${cell("Employee", h(r.employee))}${cell("Location and job", h((s.locations ?? []).find((l: any) => l.id === r.locationId)?.name ?? r.locationId) + "<small>" + h(r.job) + "</small>")}${cell("Original clock", h(r.startAt) + "<small>" + h(r.endAt ?? "Missing clock-out") + "</small>")}${cell("Effective hours", h(r.effective.startAt) + "<small>" + h(r.effective.endAt ?? "Open") + "</small><small>" + h(r.effective.minutes === null ? "Not complete" : (r.effective.minutes / 60).toFixed(2) + " hours") + "</small>")}${cell("Status", h(r.pendingCorrectionId ? "Correction pending" : r.status))}${cell("Controls", controls + (own ? `<details class="more"><summary>Request correction</summary><div class="panel-body">${form("clock.correction.request", path, key + field("startAt", "Corrected start (UTC)", "", "datetime-local", "required") + field("endAt", "Corrected end (UTC)", "", "datetime-local", "required") + field("breakMinutes", "Unpaid break minutes", 0, "number", 'required min="0" step="1"') + field("reason", "Correction reason", "", "text", 'required maxlength="500"'), "Submit correction")}</div></details>` : "") + (owner && (r.status !== "approved" || r.pendingCorrectionId) ? form("clock.approve", path, key + field("exceptionReason", "Overtime review reason", "", "text", 'maxlength="500"', "Required above 8 hours in a shift or 40 approved hours in its local starting week."), "Approve hours") : ""))}</tr>`;
    })
    .join("");
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Time clock</h1><p>Record shifts, review corrections and export approved hours.</p></div>${panel(
    "Clock in",
    body(
      form(
        "clock.in",
        path,
        req() +
          select(
            "locationId",
            "Work location",
            (s.locations ?? []).map((l: any) => [l.id, l.name]),
            "studio",
          ) +
          field("job", "Job", "", "text", 'required maxlength="100"'),
        "Clock in",
      ),
    ),
  )}${panel("Shifts", body("<p>Original clock events remain alongside approved corrections. Missing clock-outs and pending corrections never enter the approved-hours export. The owner approves for managers until staff rights ship. Review thresholds flag hours for a human; Strap does not calculate legal overtime or run payroll.</p>") + (shifts ? table(["Employee", "Location and job", "Original clock", "Effective hours", "Status", "Controls"], shifts) : emptyLine("No shifts recorded.")))}${panel("Correction and approval history", body(table(["Shift", "Corrected start", "Corrected end", "Reason", "Status"], clock.corrections.map((c: any) => `<tr>${cell("Shift", h(c.shiftId))}${cell("Corrected start", h(c.startAt))}${cell("Corrected end", h(c.endAt))}${cell("Reason", h(c.reason))}${cell("Status", h(c.status))}</tr>`).join("")) + table(["Shift", "Approved minutes", "Approver", "Overtime review"], clock.approvals.map((a: any) => `<tr>${cell("Shift", h(a.shiftId))}${cell("Approved minutes", h(a.minutes))}${cell("Approver", h(a.approvedBy))}${cell("Overtime review", h(a.exceptionReason || "Below review thresholds"))}</tr>`).join("")) + (owner ? '<a class="btn" href="/api/strap/time-clock.csv">Download approved hours CSV</a>' : "")))}</div></div>`;
}
