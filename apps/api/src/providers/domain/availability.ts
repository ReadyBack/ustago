import type { AvailabilityState, WeeklyHoursInterval } from '@ustago/types';

import { localParts } from '../../common/utils/local-time.js';

/**
 * Provider availability (docs/adr/0031), one pure function shared by
 * matching, dispatch, NOW, the inbox and the public profile. Account
 * suspension and verification are separate axes checked by eligibility.
 *
 * Precedence: PAUSED ("Yeni iş alma") > TIME_OFF (izin) > UNAVAILABLE_TODAY
 * ("Bugün müsait değilim") > OUTSIDE_HOURS > AVAILABLE. Empty weekly hours
 * mean "flexible": always inside hours.
 */
export interface AvailabilityInput {
  acceptingNewJobs: boolean;
  unavailableUntil: Date | null;
  weeklyHours: readonly WeeklyHoursInterval[];
  timeOff: readonly { startsAt: Date; endsAt: Date; cancelledAt?: Date | null }[];
  now: Date;
  timeZone: string;
}

export interface AvailabilityResult {
  state: AvailabilityState;
  /** Quote requests may be dispatched (outside hours still receives them). */
  receivesNewJobs: boolean;
  /** Inside working hours now and nothing blocks: NOW / urgent dispatch allowed. */
  workingNow: boolean;
  /** Can still take work today: shown as "Bugün müsait". */
  availableToday: boolean;
  onTimeOff: boolean;
}

export function isInWeeklyHours(
  hours: readonly WeeklyHoursInterval[],
  weekday: number,
  minute: number,
): boolean {
  if (hours.length === 0) return true;
  return hours.some(
    (h) => h.weekday === weekday && minute >= h.startMinute && minute < h.endMinute,
  );
}

function hasHoursLaterToday(
  hours: readonly WeeklyHoursInterval[],
  weekday: number,
  minute: number,
): boolean {
  if (hours.length === 0) return true;
  return hours.some((h) => h.weekday === weekday && h.endMinute > minute);
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const { now } = input;
  const onTimeOff = input.timeOff.some(
    (t) => !t.cancelledAt && t.startsAt <= now && t.endsAt > now,
  );
  const unavailable = input.unavailableUntil !== null && input.unavailableUntil > now;
  const local = localParts(now, input.timeZone);
  const minute = local.hour * 60 + local.minute;
  const inHours = isInWeeklyHours(input.weeklyHours, local.weekday, minute);

  let state: AvailabilityState;
  if (!input.acceptingNewJobs) state = 'PAUSED';
  else if (onTimeOff) state = 'TIME_OFF';
  else if (unavailable) state = 'UNAVAILABLE_TODAY';
  else if (!inHours) state = 'OUTSIDE_HOURS';
  else state = 'AVAILABLE';

  return {
    state,
    receivesNewJobs: state === 'AVAILABLE' || state === 'OUTSIDE_HOURS',
    workingNow: state === 'AVAILABLE',
    availableToday:
      (state === 'AVAILABLE' || state === 'OUTSIDE_HOURS') &&
      hasHoursLaterToday(input.weeklyHours, local.weekday, minute),
    onTimeOff,
  };
}
