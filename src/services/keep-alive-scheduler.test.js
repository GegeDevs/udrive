import { test } from 'node:test';
import assert from 'node:assert';
import { parseWeekdays, nextWeekdayDelay, isRunDueToday } from './keep-alive-scheduler.js';

const sat = new Date('2026-10-31T10:00:00');

test('nextWeekdayDelay never targets today', () => {
  assert.equal(nextWeekdayDelay(parseWeekdays('sat'), sat), 7 * 864e5);
  assert.equal(nextWeekdayDelay(parseWeekdays('sun'), sat), 864e5);
});

test('isRunDueToday catches up only once per scheduled day', () => {
  const days = parseWeekdays('sat');
  assert.equal(isRunDueToday(days, null, sat), true);
  assert.equal(isRunDueToday(days, new Date(sat.getTime() - 864e5).toISOString(), sat), true);
  assert.equal(isRunDueToday(days, new Date(sat.getTime() - 36e5).toISOString(), sat), false);
  assert.equal(isRunDueToday(parseWeekdays('sun'), null, sat), false);
  assert.equal(isRunDueToday([], null, sat), false);
});
