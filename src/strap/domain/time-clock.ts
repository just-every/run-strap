import { ordered } from "./retail-records";
import {
  id,
  instant,
  integer,
  insist,
  list,
  now,
  record,
  text,
  type Actor,
  type RecordData,
  type State,
} from "./types";
import type { Transaction } from "./store";
import { placeId, locations } from "./locations";
import { localDate, addDays } from "../zone";
const staff = (who: Actor) =>
  insist(
    (who.role === "owner" && who.isOwner) || who.role === "instructor",
    "staff_clock_required",
    403,
  );
function request(
  tx: Transaction,
  action: string,
  input: Record<string, unknown>,
  apply: () => RecordData,
) {
  staff(tx.who);
  const requestId = text(input.requestId, "clock_request", 100),
    basis = JSON.stringify(
      Object.fromEntries(
        Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
    prior = list(tx.state, "clockRequest").find(
      (r) =>
        r.actorId === tx.who.id &&
        r.action === action &&
        r.requestId === requestId,
    );
  if (prior) {
    insist(prior.basis === basis, "clock_request_changed", 409);
    return prior.result;
  }
  const result = apply();
  tx.put("clockRequest", {
    id: id(),
    actorId: tx.who.id,
    action,
    requestId,
    basis,
    result,
    createdAt: now(),
  });
  return result;
}
const own = (tx: Transaction, key: unknown) => {
  const shift = record(tx.state, key, "clockShift");
  insist(shift.actorId === tx.who.id, "clock_shift_not_found", 404);
  return shift;
};
function basis(s: State, shift: RecordData) {
  const correction = shift.approvedCorrectionId
    ? record(s, shift.approvedCorrectionId, "clockCorrection")
    : null;
  const startAt = correction?.startAt ?? shift.startAt,
    endAt = correction?.endAt ?? shift.endAt,
    breakMinutes =
      correction?.breakMinutes ??
      shift.breaks
        .filter((b: any) => b.endAt)
        .reduce(
          (n: number, b: any) =>
            n + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000,
          0,
        );
  return {
    startAt,
    endAt,
    breakMinutes,
    minutes: endAt
      ? (Date.parse(endAt) - Date.parse(startAt)) / 60000 - breakMinutes
      : null,
  };
}
function overlap(s: State, shift: RecordData, startAt: string, endAt: string) {
  insist(
    !ordered(s, "clockShift").some((r) => {
      if (r.id === shift.id || r.actorId !== shift.actorId) return false;
      const b = basis(s, r);
      return b.endAt && startAt < b.endAt && endAt > b.startAt;
    }),
    "clock_shifts_overlap",
    409,
  );
}
export function clockIn(tx: Transaction, input: Record<string, unknown>) {
  return request(tx, "in", input, () => {
    insist(
      !list(tx.state, "clockShift").some(
        (r) => r.actorId === tx.who.id && !basis(tx.state, r).endAt,
      ),
      "clock_out_previous_shift",
      409,
    );
    const saved = {
      id: id(),
      actorId: tx.who.id,
      personId: tx.who.personId ?? null,
      employee: tx.who.email,
      locationId: placeId(tx.state, input.locationId),
      job: text(input.job, "job", 100),
      startAt: now(),
      endAt: null,
      breaks: [],
      revision: 0,
      status: "unapproved",
    };
    tx.put("clockShift", saved);
    tx.put("clockEvent", {
      id: id(),
      shiftId: saved.id,
      action: "in",
      after: saved,
      actorId: tx.who.id,
      createdAt: now(),
    });
    return saved;
  });
}
export function clockStep(
  tx: Transaction,
  input: Record<string, unknown>,
  action: "out" | "break.start" | "break.end",
) {
  return request(tx, action, input, () => {
    const shift = own(tx, input.shiftId);
    insist(!basis(tx.state, shift).endAt, "shift_already_ended", 409);
    insist(input.revision === shift.revision, "clock_shift_changed", 409);
    const breaks = shift.breaks.map((b: any) => ({ ...b })),
      active = breaks.find((b: any) => !b.endAt),
      at = now();
    if (action === "break.start") {
      insist(!active, "break_already_started", 409);
      breaks.push({ startAt: at, endAt: null });
    } else if (action === "break.end") {
      insist(active, "no_open_break", 409);
      active.endAt = at;
    } else insist(!active, "end_break_first", 409);
    const saved = {
      ...shift,
      breaks,
      revision: shift.revision + 1,
      ...(action === "out" ? { endAt: at } : {}),
    };
    tx.put("clockShift", saved);
    tx.put("clockEvent", {
      id: id(),
      shiftId: shift.id,
      action,
      before: shift,
      after: saved,
      actorId: tx.who.id,
      createdAt: at,
    });
    return saved;
  });
}
export function requestHoursCorrection(
  tx: Transaction,
  input: Record<string, unknown>,
) {
  return request(tx, "correction", input, () => {
    const shift = own(tx, input.shiftId);
    insist(input.revision === shift.revision, "clock_shift_changed", 409);
    insist(!shift.pendingCorrectionId, "correction_pending", 409);
    const startAt = instant(input.startAt, "corrected_start"),
      endAt = instant(input.endAt, "corrected_end"),
      breakMinutes = integer(input.breakMinutes, "break_minutes", 0, 1440),
      reason = text(input.reason, "correction_reason", 500);
    insist(
      startAt < endAt &&
        endAt <= now() &&
        Date.parse(endAt) - Date.parse(startAt) <= 86400000 &&
        breakMinutes * 60000 < Date.parse(endAt) - Date.parse(startAt),
      "invalid_corrected_hours",
    );
    overlap(tx.state, shift, startAt, endAt);
    tx.reached(endAt);
    const saved = {
      id: id(),
      shiftId: shift.id,
      actorId: tx.who.id,
      startAt,
      endAt,
      breakMinutes,
      reason,
      original: {
        startAt: shift.startAt,
        endAt: shift.endAt,
        breaks: shift.breaks,
      },
      revision: shift.revision + 1,
      status: "pending",
      createdAt: now(),
    };
    tx.put("clockCorrection", saved);
    tx.put("clockShift", {
      ...shift,
      pendingCorrectionId: saved.id,
      revision: saved.revision,
    });
    return saved;
  });
}
function weekKey(s: State, shift: RecordData, startAt: string) {
  const date = localDate(
      startAt,
      locations(s).find((l) => l.id === shift.locationId)?.timeZone ?? "UTC",
    ),
    day = new Date(date + "T12:00:00Z").getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
export function approveHours(tx: Transaction, input: Record<string, unknown>) {
  insist(tx.who.role === "owner" && tx.who.isOwner, "owner_required", 403);
  return request(tx, "approve", input, () => {
    const shift = record(tx.state, input.shiftId, "clockShift");
    insist(shift.actorId !== tx.who.id, "another_owner_approval_required", 403);
    insist(input.revision === shift.revision, "clock_shift_changed", 409);
    insist(
      shift.status !== "approved" || shift.pendingCorrectionId,
      "hours_already_approved",
      409,
    );
    const correction = shift.pendingCorrectionId
        ? record(tx.state, shift.pendingCorrectionId, "clockCorrection")
        : null,
      proposed = correction
        ? { ...shift, approvedCorrectionId: correction.id }
        : shift,
      b = basis(tx.state, proposed);
    insist(
      b.endAt && b.minutes !== null && b.minutes >= 0,
      "complete_shift_required",
      409,
    );
    overlap(tx.state, shift, b.startAt, b.endAt);
    const week = weekKey(tx.state, shift, b.startAt),
      other = list(tx.state, "clockShift")
        .filter(
          (r) =>
            r.actorId === shift.actorId &&
            r.id !== shift.id &&
            r.status === "approved",
        )
        .map((r) => ({ r, b: basis(tx.state, r) }))
        .filter(({ r, b }) => weekKey(tx.state, r, b.startAt) === week)
        .reduce((n, { b }) => n + (b.minutes ?? 0), 0),
      exception = b.minutes > 480 || other + b.minutes > 2400,
      exceptionReason = exception
        ? text(input.exceptionReason, "overtime_exception_reason", 500)
        : String(input.exceptionReason ?? "");
    const approval = {
      id: id(),
      shiftId: shift.id,
      correctionId: correction?.id ?? null,
      employeeId: shift.actorId,
      locationId: shift.locationId,
      job: shift.job,
      ...b,
      week,
      reviewThresholdExceeded: exception,
      exceptionReason,
      approvedBy: tx.who.id,
      createdAt: now(),
    };
    if (correction)
      tx.put("clockCorrection", {
        ...correction,
        status: "approved",
        approvedBy: tx.who.id,
        approvedAt: approval.createdAt,
      });
    tx.put("clockApproval", approval);
    tx.put("clockShift", {
      ...proposed,
      pendingCorrectionId: null,
      status: "approved",
      approvalId: approval.id,
      revision: shift.revision + 1,
    });
    return approval;
  });
}
export function timeSnapshot(s: State, who: Actor) {
  if (!["owner", "instructor"].includes(who.role)) return null;
  const shifts = ordered(s, "clockShift").filter(
      (r) => who.role === "owner" || r.actorId === who.id,
    ),
    ids = new Set(shifts.map((r) => r.id));
  return {
    shifts: shifts.map((r) => ({ ...r, effective: basis(s, r) })),
    events: ordered(s, "clockEvent").filter((r) => ids.has(r.shiftId)),
    corrections: ordered(s, "clockCorrection").filter((r) =>
      ids.has(r.shiftId),
    ),
    approvals: ordered(s, "clockApproval").filter((r) => ids.has(r.shiftId)),
  };
}
export function approvedHours(s: State): RecordData[] {
  return ordered(s, "clockShift")
    .filter((r) => r.status === "approved" && !r.pendingCorrectionId)
    .map((r) => ({
      ...record(s, r.approvalId, "clockApproval"),
      employee: r.employee,
    }));
}
