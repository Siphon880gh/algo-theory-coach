// Run: TZ=America/Los_Angeles node --test tests/js/retention-core.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const C = require(path.join(__dirname, '..', '..', 'assets', 'js', 'retention-core.js'));

function at(day, hh) { return new Date(day + 'T' + (hh || '10') + ':00:00'); }
function fresh(p) { return C.normalize(null, { pace: p || { lessonsPerDay: 1, quizzesPerDay: 0 } }); }
const U = (id, path, kind) => ({ id, title: id.toUpperCase(), path: path || ['Cat', 'Sub'], kind: kind || 'lesson' });

test('normalize: defaults, unknown keys kept, junk dropped, never throws', () => {
  const r = C.normalize({ extra: 1, pace: { lessonsPerDay: 'x' }, completions: { a: 5 }, history: [1, { unitId: 'a', at: '2026-01-01T00:00:00Z' }] }, { pace: { lessonsPerDay: 3 } });
  assert.strictEqual(r.extra, 1);
  assert.strictEqual(r.pace.lessonsPerDay, 3);
  assert.deepStrictEqual(r.completions, {});
  assert.strictEqual(r.history.length, 1);
  assert.strictEqual(r.reminder.time, '09:00');
  assert.doesNotThrow(() => C.normalize('garbage'));
});

test('complete writes completedAt, log fields; re-complete updates date not unique total', () => {
  const r = fresh();
  const a = C.complete(r, U('a'), { now: at('2026-11-01'), source: 'button' });
  assert.ok(a.first);
  assert.ok(r.completions.a.completedAt.startsWith('2026-11-01T10:00:00'));
  assert.deepStrictEqual(r.history[0].path, ['Cat', 'Sub']);
  const b = C.complete(r, U('a'), { now: at('2026-11-05') });
  assert.ok(!b.first);
  assert.strictEqual(Object.keys(r.completions).length, 1);
  assert.ok(r.completions.a.completedAt.startsWith('2026-11-05'));
  assert.strictEqual(r.completions.a.count, 2);
  assert.strictEqual(C.todayCounts(r, at('2026-11-05')).lessons, 1);
  assert.strictEqual(r.lastUnitId, 'a');
});

test('goalMet uses lessons and quizzes goals', () => {
  const r = fresh({ lessonsPerDay: 2, quizzesPerDay: 1 });
  C.complete(r, U('a'), { now: at('2026-11-01') });
  C.complete(r, U('b'), { now: at('2026-11-01') });
  assert.ok(!C.goalMet(r, at('2026-11-01', '20')));
  C.complete(r, U('q', null, 'quiz'), { now: at('2026-11-01') });
  assert.ok(C.goalMet(r, at('2026-11-01', '20')));
});

test('streak: freeze earned after 7 active days covers one missed day; second miss resets; best kept', () => {
  const r = fresh();
  for (let d = 1; d <= 7; d++) C.complete(r, U('u' + d), { now: at('2026-11-0' + d) });
  let s = C.streak(r, at('2026-11-07', '20'));
  assert.strictEqual(s.current, 7);
  assert.strictEqual(s.freezes, 1);
  // miss Nov 8, active Nov 9 -> freeze covers
  C.complete(r, U('u9'), { now: at('2026-11-09') });
  s = C.streak(r, at('2026-11-09', '20'));
  assert.deepStrictEqual(s.frozenDays, ['2026-11-08']);
  assert.strictEqual(s.current, 9);
  assert.strictEqual(s.freezes, 0);
  // miss Nov 10 with no freeze -> reset; today (Nov 11) no activity yet
  s = C.streak(r, at('2026-11-11', '08'));
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.best, 9);
});

test('streak: today without activity does not break it', () => {
  const r = fresh();
  C.complete(r, U('a'), { now: at('2026-11-01') });
  C.complete(r, U('b'), { now: at('2026-11-02') });
  assert.strictEqual(C.streak(r, at('2026-11-03', '08')).current, 2);
});

test('bank at most one freeze', () => {
  const r = fresh();
  for (let d = 1; d <= 14; d++) C.complete(r, U('u' + d), { now: at('2026-11-' + String(d).padStart(2, '0')) });
  assert.strictEqual(C.streak(r, at('2026-11-14', '20')).freezes, 1);
});

test('missed week is a quiet fresh start', () => {
  const r = fresh();
  C.complete(r, U('a'), { now: at('2026-11-01') });
  const b = C.behind(r, at('2026-11-09'));
  assert.ok(b.freshStart);
  assert.strictEqual(b.lessons, 0);
});

test('behind pace counts finished days since pace began', () => {
  const r = fresh({ lessonsPerDay: 3 });
  C.complete(r, U('a'), { now: at('2026-11-01') });
  C.complete(r, U('b'), { now: at('2026-11-02') });
  // days Nov 1..2 finished: expected 6, done 2 -> 4 behind
  assert.strictEqual(C.behind(r, at('2026-11-03')).lessons, 4);
});

test('forecast: set pace with little data, actual pace with 3+ active days, done at 0', () => {
  const r = fresh({ lessonsPerDay: 2 });
  let f = C.forecast(r, 10, at('2026-11-01'));
  assert.strictEqual(f.basis, 'set');
  assert.strictEqual(f.days, 5);
  assert.strictEqual(f.date, '2026-11-06');
  C.complete(r, U('a'), { now: at('2026-11-01') });
  C.complete(r, U('b'), { now: at('2026-11-02') });
  C.complete(r, U('c'), { now: at('2026-11-03') });
  // 3 new units over Nov 1..3 (3 finished days when asked on Nov 4) -> 1/day, slower than set pace 2
  f = C.forecast(r, 10, at('2026-11-04'));
  assert.strictEqual(f.basis, 'actual');
  assert.strictEqual(f.days, 10);
  assert.strictEqual(f.date, '2026-11-14');
  assert.ok(C.forecast(r, 0, at('2026-11-04')).done);
});

test('spaced review: wrong -> due in 1, correct -> 3, correct -> 7, correct -> graduated; miss resets', () => {
  const r = fresh();
  C.recordAnswer(r, { id: 'q1', unitId: 'a', correct: false }, at('2026-11-01'));
  assert.strictEqual(r.review.q1.dueOn, '2026-11-02');
  assert.strictEqual(C.dueReviews(r, at('2026-11-01')).length, 0);
  assert.strictEqual(C.dueReviews(r, at('2026-11-02')).length, 1);
  C.recordAnswer(r, { id: 'q1', correct: true }, at('2026-11-02'));
  assert.strictEqual(r.review.q1.dueOn, '2026-11-05');
  C.recordAnswer(r, { id: 'q1', correct: true }, at('2026-11-05'));
  assert.strictEqual(r.review.q1.dueOn, '2026-11-12');
  C.recordAnswer(r, { id: 'q1', correct: false }, at('2026-11-12'));
  assert.strictEqual(r.review.q1.dueOn, '2026-11-13');
  C.recordAnswer(r, { id: 'q1', correct: true }, at('2026-11-13'));
  C.recordAnswer(r, { id: 'q1', correct: true }, at('2026-11-16'));
  C.recordAnswer(r, { id: 'q1', correct: true }, at('2026-11-23'));
  assert.strictEqual(r.review.q1, undefined);
});

test('badges and xp; never revoked', () => {
  const r = fresh();
  C.complete(r, U('a'), { now: at('2026-11-01') });
  C.complete(r, U('q', null, 'quiz'), { now: at('2026-11-01'), perfect: true, score: 1 });
  const got = C.updateBadges(r, { modulesFinished: 1 }, at('2026-11-01')).map((b) => b.id);
  assert.deepStrictEqual(got.sort(), ['first-lesson', 'first-module', 'first-perfect']);
  assert.strictEqual(r.badges.xp, 10 + 25 + 40);
  assert.strictEqual(r.badges.level, 1);
  C.updateBadges(r, { modulesFinished: 0 }, at('2026-11-02'));
  assert.ok(r.badges.earned['first-module']);
});

test('daysAgo uses local calendar days', () => {
  assert.strictEqual(C.daysAgo('2026-11-26T23:30:00-08:00', at('2026-11-26', '23')).short, 'today');
  assert.strictEqual(C.daysAgo('2026-11-25T23:59:00-08:00', at('2026-11-26', '00')).short, '1d');
  const a = C.daysAgo('2026-06-02T10:00:00-07:00', at('2026-11-26'));
  assert.strictEqual(a.short, '177d');
  assert.strictEqual(a.long, 'completed 177 days ago');
});

test('category recency: unique done/total per prefix; no ago when nothing done', () => {
  const r = fresh();
  const units = [U('a', ['Practice', 'Arrays']), U('b', ['Practice', 'Arrays']), U('c', ['Practice', 'Graphs']), U('a', ['Lists', 'Top'])];
  C.complete(r, units[0], { now: at('2026-06-02') });
  const rec = C.categoryRecency(r, units, at('2026-11-26'));
  assert.strictEqual(rec['Practice > Arrays'].done, 1);
  assert.strictEqual(rec['Practice > Arrays'].total, 2);
  assert.strictEqual(rec['Practice > Arrays'].ago.short, '177d');
  assert.strictEqual(rec['Practice'].total, 3);
  assert.strictEqual(rec['Practice > Graphs'].ago, null);
  assert.strictEqual(rec['Lists > Top'].done, 1);
  assert.deepStrictEqual(C.staleCategories(rec, 14).slice(0, 1), ['Practice']);
});

test('diary newest first, grouped by day, filterable', () => {
  const r = fresh();
  C.complete(r, U('a', ['Practice', 'Arrays']), { now: at('2026-11-01') });
  C.complete(r, U('b', ['Practice', 'Graphs']), { now: at('2026-11-02') });
  C.complete(r, U('c', ['Practice', 'Graphs']), { now: at('2026-11-02', '11') });
  const g = C.diary(r);
  assert.strictEqual(g[0].day, '2026-11-02');
  assert.strictEqual(g[0].rows[0].unitId, 'c');
  assert.strictEqual(g[1].day, '2026-11-01');
  assert.strictEqual(C.diary(r, 'Practice > Arrays').length, 1);
  assert.strictEqual(C.diary(r, 'Practice').length, 2);
  assert.ok(C.diaryCategories(r).includes('Practice > Graphs'));
});

test('weekly recap counts this Monday-based week', () => {
  const r = fresh();
  C.complete(r, U('a'), { now: at('2026-11-22') }); // Sunday, previous week
  C.complete(r, U('b'), { now: at('2026-11-23') }); // Monday
  C.complete(r, U('q', null, 'quiz'), { now: at('2026-11-24') });
  const w = C.weekly(r, at('2026-11-26'));
  assert.strictEqual(w.weekStart, '2026-11-23');
  assert.strictEqual(w.lessons, 1);
  assert.strictEqual(w.quizzes, 1);
});

test('nextUnit continues after lastUnitId', () => {
  const r = fresh();
  assert.strictEqual(C.nextUnit(r, ['a', 'b', 'c']), 'a');
  C.complete(r, U('b'), { now: at('2026-11-01') });
  assert.strictEqual(C.nextUnit(r, ['a', 'b', 'c']), 'c');
});

test('reminders: unsupported -> banner path, no throw; delay is 0 when due and unsent', () => {
  const r = fresh();
  let called = false;
  C.enableReminders(r, '09:00', () => { called = true; });
  assert.ok(called);
  assert.strictEqual(r.reminder.permission, 'unsupported');
  assert.strictEqual(r.reminder.enabled, true);
  assert.strictEqual(C.reminderDelay(r, at('2026-11-26', '10')), 0);
  r.reminder.lastNotifiedOn = '2026-11-26';
  assert.ok(C.reminderDelay(r, at('2026-11-26', '10')) > 0);
  assert.strictEqual(C.reminderDelay(r, new Date('2026-11-26T08:00:00')), 3600000);
});

test('reminders: requestPermission result is stored', async () => {
  const r = fresh();
  globalThis.Notification = function () {};
  globalThis.Notification.permission = 'default';
  globalThis.Notification.requestPermission = () => Promise.resolve('denied');
  await new Promise((res) => C.enableReminders(r, '07:30', res));
  delete globalThis.Notification;
  assert.strictEqual(r.reminder.permission, 'denied');
  assert.strictEqual(r.reminder.time, '07:30');
});
