/**
 * Learning retention core (weng/.agents/skills/learning-retention).
 * Pure helpers plus small DOM renderers. No dependencies, ES5, safe on iPad Safari.
 * The app owns storage: it passes a `retention` object and saves it after each change.
 *
 * Retention object (lives inside the app's own progress document):
 *   pace:        { lessonsPerDay, quizzesPerDay, since: 'YYYY-MM-DD' }
 *   completions: { unitId: { completedAt, firstAt, title, path: [..], kind, source, score, perfect, count } }
 *   history:     [ { unitId, at, kind, title, path, source, score, perfect, first } ]   (append-mostly, newest last)
 *   lastCompletedAt, lastUnitId
 *   streak:      { best, freezesUsed: ['YYYY-MM-DD'] }   (current streak is derived from history)
 *   badges:      { earned: { id: iso }, xp, level }
 *   review:      { questionId: { unitId, dueOn, step, wrongAt } }
 *   reminder:    { enabled, permission, time: 'HH:MM', lastNotifiedOn }
 *   doneForToday: 'YYYY-MM-DD' | null
 *   popover:     { onLoad: true, lastShownOn: 'YYYY-MM-DD' | null }   (welcome popover once per local day)
 */
(function (global) {
  'use strict';

  var CORE_VERSION = 2;
  var REVIEW_STEPS = [1, 3, 7];
  var FREEZE_EVERY = 7;
  var MAX_FREEZES = 1;
  var HISTORY_CAP = 5000;
  var DAY_MS = 86400000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function toDate(v) { return v instanceof Date ? v : new Date(v == null ? Date.now() : v); }

  /** Local calendar day (device timezone) as YYYY-MM-DD. */
  function localDay(v) {
    var d = toDate(v);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function dayIndex(day) {
    var p = String(day).split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS);
  }
  function dayFromIndex(i) {
    var d = new Date(i * DAY_MS);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(day, n) { return dayFromIndex(dayIndex(day) + n); }
  function dayDiff(fromDay, toDay) { return dayIndex(toDay) - dayIndex(fromDay); }
  /** Monday-based week start for a local day. */
  function weekStart(day) {
    var i = dayIndex(day);
    var dow = new Date(i * DAY_MS).getUTCDay(); // 0 = Sunday
    return dayFromIndex(i - ((dow + 6) % 7));
  }
  /** Local ISO-8601 timestamp with offset, e.g. 2026-11-26T09:00:00-08:00. */
  function localIso(v) {
    var d = toDate(v);
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return localDay(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
      + sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
  }
  function fullDate(iso) {
    var d = toDate(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return localDay(d); }
  }

  function defaults(opts) {
    opts = opts || {};
    var pace = opts.pace || {};
    return {
      coreVersion: CORE_VERSION,
      pace: {
        lessonsPerDay: typeof pace.lessonsPerDay === 'number' ? pace.lessonsPerDay : 1,
        quizzesPerDay: typeof pace.quizzesPerDay === 'number' ? pace.quizzesPerDay : 0,
        since: null
      },
      completions: {},
      history: [],
      lastCompletedAt: null,
      lastUnitId: null,
      streak: { best: 0, freezesUsed: [] },
      badges: { earned: {}, xp: 0, level: 1 },
      review: {},
      reminder: { enabled: false, permission: 'default', time: opts.reminderTime || '09:00', lastNotifiedOn: null },
      doneForToday: null,
      popover: { onLoad: true, lastShownOn: null }
    };
  }

  function num(v, d, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return d;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  /** Fill defaults, keep unknown keys, never throw. */
  function normalize(r, opts) {
    var out = defaults(opts);
    if (!isObj(r)) return out;
    Object.keys(r).forEach(function (k) { if (!(k in out)) out[k] = r[k]; });
    if (isObj(r.pace)) {
      out.pace.lessonsPerDay = num(r.pace.lessonsPerDay, out.pace.lessonsPerDay, 0, 50);
      out.pace.quizzesPerDay = num(r.pace.quizzesPerDay, out.pace.quizzesPerDay, 0, 50);
      out.pace.since = typeof r.pace.since === 'string' ? r.pace.since : null;
    }
    if (isObj(r.completions)) {
      Object.keys(r.completions).forEach(function (id) {
        var c = r.completions[id];
        if (isObj(c) && typeof c.completedAt === 'string') out.completions[id] = c;
      });
    }
    if (Array.isArray(r.history)) {
      out.history = r.history.filter(function (h) { return isObj(h) && typeof h.unitId === 'string' && typeof h.at === 'string'; });
    }
    if (typeof r.lastCompletedAt === 'string') out.lastCompletedAt = r.lastCompletedAt;
    if (typeof r.lastUnitId === 'string') out.lastUnitId = r.lastUnitId;
    if (isObj(r.streak)) {
      out.streak.best = num(r.streak.best, 0, 0, 100000);
      if (Array.isArray(r.streak.freezesUsed)) out.streak.freezesUsed = r.streak.freezesUsed.filter(function (d) { return typeof d === 'string'; });
    }
    if (isObj(r.badges)) {
      if (isObj(r.badges.earned)) out.badges.earned = r.badges.earned;
      out.badges.xp = num(r.badges.xp, 0, 0, 1e9);
      out.badges.level = num(r.badges.level, 1, 1, 1e6);
    }
    if (isObj(r.review)) {
      Object.keys(r.review).forEach(function (q) {
        var it = r.review[q];
        if (isObj(it) && typeof it.dueOn === 'string') out.review[q] = it;
      });
    }
    if (isObj(r.reminder)) {
      out.reminder.enabled = r.reminder.enabled === true;
      if (typeof r.reminder.permission === 'string') out.reminder.permission = r.reminder.permission;
      if (typeof r.reminder.time === 'string' && /^\d{2}:\d{2}$/.test(r.reminder.time)) out.reminder.time = r.reminder.time;
      if (typeof r.reminder.lastNotifiedOn === 'string') out.reminder.lastNotifiedOn = r.reminder.lastNotifiedOn;
    }
    if (typeof r.doneForToday === 'string') out.doneForToday = r.doneForToday;
    if (isObj(r.popover)) {
      out.popover.onLoad = r.popover.onLoad !== false;
      if (typeof r.popover.lastShownOn === 'string') out.popover.lastShownOn = r.popover.lastShownOn;
    }
    return out;
  }

  /**
   * Record an explicit completion (Mark complete button or a passed quiz). Never call on scroll/open.
   * unit: { id, title, path: ['Category', 'Sub'], kind: 'lesson'|'quiz' }
   * opts: { now, source: 'button'|'quiz', score, perfect }
   * Re-completing updates completedAt and today's count, not the unique total.
   */
  function complete(r, unit, opts) {
    opts = opts || {};
    var now = opts.now ? toDate(opts.now) : new Date();
    var at = localIso(now);
    var id = String(unit.id);
    var prev = r.completions[id];
    var first = !prev;
    var kind = unit.kind === 'quiz' ? 'quiz' : 'lesson';
    var path = Array.isArray(unit.path) ? unit.path.map(String) : [];
    var title = String(unit.title || (prev && prev.title) || id);
    var score = typeof opts.score === 'number' ? opts.score : null;
    var perfect = opts.perfect === true;
    r.completions[id] = {
      completedAt: at,
      firstAt: prev && prev.firstAt ? prev.firstAt : (prev ? prev.completedAt : at),
      title: title,
      path: path,
      kind: kind,
      source: opts.source || 'button',
      score: score,
      perfect: perfect || !!(prev && prev.perfect),
      count: (prev && prev.count ? prev.count : (prev ? 1 : 0)) + 1
    };
    r.history.push({ unitId: id, at: at, kind: kind, title: title, path: path, source: opts.source || 'button', score: score, perfect: perfect, first: first });
    if (r.history.length > HISTORY_CAP) r.history = r.history.slice(r.history.length - HISTORY_CAP);
    r.lastCompletedAt = at;
    r.lastUnitId = id;
    if (!r.pace.since) r.pace.since = localDay(now);
    return { first: first, at: at };
  }

  /** Migrate a flag-only store: ids already done get a completion without inventing history days. */
  function importLegacy(r, units, when) {
    (units || []).forEach(function (u) {
      if (r.completions[u.id]) return;
      var at = when && when[u.id] ? when[u.id] : null;
      if (!at) return;
      r.completions[u.id] = { completedAt: at, firstAt: at, title: u.title, path: u.path || [], kind: u.kind || 'lesson', source: 'legacy', score: null, perfect: false, count: 1 };
    });
    return r;
  }

  function isComplete(r, id) { return !!r.completions[id]; }

  function countsOn(r, day) {
    var c = { lessons: 0, quizzes: 0 };
    r.history.forEach(function (h) {
      if (localDay(h.at) !== day) return;
      if (h.kind === 'quiz') c.quizzes++; else c.lessons++;
    });
    return c;
  }
  function today(now) { return localDay(now || new Date()); }
  function todayCounts(r, now) { return countsOn(r, today(now)); }
  function goalMet(r, now) {
    var c = todayCounts(r, now);
    var lp = r.pace.lessonsPerDay, qp = r.pace.quizzesPerDay;
    if (lp <= 0 && qp <= 0) return c.lessons + c.quizzes > 0;
    return (lp <= 0 || c.lessons >= lp) && (qp <= 0 || c.quizzes >= qp);
  }

  function activeDays(r) {
    var set = {};
    r.history.forEach(function (h) { var d = localDay(h.at); if (d) set[d] = true; });
    return Object.keys(set).sort();
  }

  /**
   * Day streak with freezes: every 7th consecutive active day earns one freeze (bank at most 1).
   * A single missed day is covered by a banked freeze; otherwise the streak resets to 0 (best is kept).
   * Today without activity yet does not break the streak.
   */
  function streak(r, now) {
    var t = today(now);
    var days = activeDays(r);
    var res = { current: 0, best: r.streak.best || 0, freezes: 0, frozenDays: [], activeToday: false, lastActive: null, freshStart: false };
    if (!days.length) return res;
    var active = {};
    days.forEach(function (d) { active[d] = true; });
    var start = dayIndex(days[0]), end = dayIndex(t);
    var cur = 0, run = 0, freezes = 0, best = res.best;
    for (var i = start; i <= end; i++) {
      var d = dayFromIndex(i);
      if (active[d]) {
        cur++; run++;
        if (run % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
      } else if (d === t) {
        // today not over yet
      } else if (freezes > 0 && cur > 0) {
        freezes--; cur++; run = 0; res.frozenDays.push(d);
      } else {
        cur = 0; run = 0;
      }
      if (cur > best) best = cur;
    }
    res.current = cur;
    res.best = best;
    res.freezes = freezes;
    res.activeToday = !!active[t];
    res.lastActive = days[days.length - 1];
    res.freshStart = dayDiff(res.lastActive, t) >= 7;
    r.streak.best = best;
    r.streak.freezesUsed = res.frozenDays.slice(-30);
    return res;
  }

  /** Gentle behind-pace check over the last (up to) 7 finished days since the pace began. */
  function behind(r, now) {
    var t = today(now);
    var s = streak(r, now);
    if (!r.history.length) return { lessons: 0, quizzes: 0, freshStart: false };
    if (s.freshStart) return { lessons: 0, quizzes: 0, freshStart: true };
    var since = r.pace.since || localDay(r.history[0].at);
    var from = Math.max(dayIndex(since), dayIndex(t) - 7);
    var to = dayIndex(t) - 1;
    var res = { lessons: 0, quizzes: 0, freshStart: false };
    if (to < from) return res;
    var n = to - from + 1, L = 0, Q = 0;
    r.history.forEach(function (h) {
      var i = dayIndex(localDay(h.at));
      if (i < from || i > to) return;
      if (h.kind === 'quiz') Q++; else L++;
    });
    res.lessons = Math.max(0, Math.round(r.pace.lessonsPerDay * n - L));
    res.quizzes = Math.max(0, Math.round(r.pace.quizzesPerDay * n - Q));
    return res;
  }

  /** New-unit completions per day over the trailing 14 days, or null when fewer than 3 active days. */
  function actualPace(r, now, kind) {
    var t = today(now), ti = dayIndex(t);
    var from = ti - 13;
    var firstDay = r.history.length ? dayIndex(localDay(r.history[0].at)) : ti;
    if (firstDay > from) from = firstDay;
    var activeSet = {}, n = 0, todayActive = false;
    r.history.forEach(function (h) {
      if (!h.first) return;
      if (kind && (h.kind === 'quiz') !== (kind === 'quiz')) return;
      var i = dayIndex(localDay(h.at));
      if (i < from || i > ti) return;
      activeSet[i] = true; n++;
      if (i === ti) todayActive = true;
    });
    if (Object.keys(activeSet).length < 3) return null;
    var days = (ti - from) + (todayActive ? 1 : 0);
    if (days < 1) days = 1;
    return n / days;
  }

  /** Finish-date forecast for `remaining` units. */
  function forecast(r, remaining, now, kind) {
    var t = today(now);
    if (remaining <= 0) return { done: true, days: 0, date: t, basis: 'done', rate: 0 };
    var actual = actualPace(r, now, kind);
    var set = kind === 'quiz' ? r.pace.quizzesPerDay : r.pace.lessonsPerDay;
    var rate = actual !== null ? actual : set;
    var basis = actual !== null ? 'actual' : 'set';
    if (!(rate > 0)) return { done: false, days: null, date: null, basis: basis, rate: 0 };
    var days = Math.ceil(remaining / Math.max(rate, 0.01));
    return { done: false, days: days, date: addDays(t, days), basis: basis, rate: rate };
  }

  /** Spaced review of missed questions: 1, then 3, then 7 days. A miss resets to 1 day. */
  function recordAnswer(r, q, now) {
    var t = today(now);
    var id = String(q.id);
    var it = r.review[id];
    if (!q.correct) {
      r.review[id] = { unitId: q.unitId || (it && it.unitId) || null, title: q.title || (it && it.title) || null, href: q.href || (it && it.href) || null, dueOn: addDays(t, REVIEW_STEPS[0]), step: 0, wrongAt: localIso(now || new Date()) };
      return r.review[id];
    }
    if (!it) return null;
    if (dayIndex(it.dueOn) > dayIndex(t)) return it; // early correct answers do not advance
    var step = (it.step || 0) + 1;
    if (step >= REVIEW_STEPS.length) { delete r.review[id]; return null; }
    it.step = step;
    it.dueOn = addDays(t, REVIEW_STEPS[step]);
    return it;
  }
  function dueReviews(r, now) {
    var ti = dayIndex(today(now));
    return Object.keys(r.review).filter(function (q) { return dayIndex(r.review[q].dueOn) <= ti; })
      .map(function (q) { var o = {}; Object.keys(r.review[q]).forEach(function (k) { o[k] = r.review[q][k]; }); o.id = q; return o; });
  }

  var BADGES = [
    { id: 'first-lesson', name: 'First lesson completed' },
    { id: 'first-module', name: 'First module finished' },
    { id: 'first-perfect', name: 'First perfect quiz' },
    { id: 'streak-7', name: '7-day learning streak' }
  ];
  /** ctx: { modulesFinished } . Returns newly earned badges. Badges are never revoked. */
  function updateBadges(r, ctx, now) {
    ctx = ctx || {};
    var s = streak(r, now);
    var have = {
      'first-lesson': r.history.some(function (h) { return h.kind === 'lesson'; }),
      'first-module': (ctx.modulesFinished || 0) >= 1,
      'first-perfect': r.history.some(function (h) { return h.perfect; }),
      'streak-7': s.best >= 7
    };
    var fresh = [];
    BADGES.forEach(function (b) {
      if (have[b.id] && !r.badges.earned[b.id]) { r.badges.earned[b.id] = localIso(now || new Date()); fresh.push(b); }
    });
    var xp = 0;
    r.history.forEach(function (h) {
      if (!h.first) return;
      if (h.kind === 'quiz') xp += h.perfect ? 25 : 15; else xp += 10;
    });
    xp += 40 * (ctx.modulesFinished || 0);
    r.badges.xp = xp;
    r.badges.level = 1 + Math.floor(xp / 100);
    return fresh;
  }

  /** Days-ago label from the local calendar date of completedAt: 'today', '1d', '177d'. */
  function daysAgo(iso, now) {
    var d = localDay(iso);
    if (!d) return null;
    var n = Math.max(0, dayDiff(d, today(now)));
    return {
      days: n,
      short: n === 0 ? 'today' : n + 'd',
      long: n === 0 ? 'completed today' : 'completed ' + n + (n === 1 ? ' day ago' : ' days ago'),
      date: fullDate(iso)
    };
  }

  /**
   * Category recency. units: [{ id, path: [...] }]. Every prefix of a path is a category key ('A > B').
   * Returns { key: { done, total, lastAt, ago } } where ago is null when nothing in it is done.
   */
  function categoryRecency(r, units, now) {
    var out = {};
    (units || []).forEach(function (u) {
      var path = u.path || [];
      for (var i = 1; i <= path.length; i++) {
        var key = path.slice(0, i).join(' > ');
        var row = out[key] || (out[key] = { done: 0, total: 0, lastAt: null, ago: null, seen: {} });
        if (row.seen[u.id]) continue;
        row.seen[u.id] = true;
        row.total++;
        var c = r.completions[u.id];
        if (c) {
          row.done++;
          if (!row.lastAt || new Date(c.completedAt) > new Date(row.lastAt)) row.lastAt = c.completedAt;
        }
      }
    });
    Object.keys(out).forEach(function (k) {
      delete out[k].seen;
      out[k].ago = out[k].lastAt ? daysAgo(out[k].lastAt, now) : null;
    });
    return out;
  }
  /** Stale categories (with at least one completion, not finished), oldest first. */
  function staleCategories(rec, minDays) {
    return Object.keys(rec).filter(function (k) {
      var x = rec[k];
      return x.ago && x.ago.days >= (minDays || 14) && x.done < x.total;
    }).sort(function (a, b) { return rec[b].ago.days - rec[a].ago.days; });
  }

  /** Diary: newest first, grouped by local day. filter: category key prefix. */
  function diary(r, filter) {
    var groups = [], byDay = {};
    for (var i = r.history.length - 1; i >= 0; i--) {
      var h = r.history[i];
      var key = (h.path || []).join(' > ');
      if (filter && key !== filter && key.indexOf(filter + ' > ') !== 0) continue;
      var d = localDay(h.at);
      if (!byDay[d]) { byDay[d] = { day: d, rows: [] }; groups.push(byDay[d]); }
      byDay[d].rows.push(h);
    }
    return groups;
  }
  function diaryCategories(r) {
    var set = {};
    r.history.forEach(function (h) {
      var p = h.path || [];
      for (var i = 1; i <= p.length; i++) set[p.slice(0, i).join(' > ')] = true;
    });
    return Object.keys(set).sort();
  }

  /** Weekly recap for the local week (Monday start) containing now. */
  function weekly(r, now) {
    var t = today(now), ws = weekStart(t), wi = dayIndex(ws);
    var res = { weekStart: ws, lessons: 0, quizzes: 0, freezesUsed: 0, badges: [], active: false };
    r.history.forEach(function (h) {
      if (dayIndex(localDay(h.at)) < wi) return;
      res.active = true;
      if (h.kind === 'quiz') res.quizzes++; else res.lessons++;
    });
    var s = streak(r, now);
    res.freezesUsed = s.frozenDays.filter(function (d) { return dayIndex(d) >= wi; }).length;
    Object.keys(r.badges.earned).forEach(function (id) {
      if (dayIndex(localDay(r.badges.earned[id])) >= wi) res.badges.push(id);
    });
    return res;
  }

  /** Next incomplete unit after lastUnitId in `order` (list of ids), else the first incomplete. */
  function nextUnit(r, order) {
    if (!order || !order.length) return null;
    var start = r.lastUnitId ? order.indexOf(r.lastUnitId) : -1;
    for (var i = 1; i <= order.length; i++) {
      var id = order[(start + i + order.length) % order.length];
      if (start === -1) id = order[i - 1];
      if (!r.completions[id]) return id;
    }
    return null;
  }

  // ---------------------------------------------------------------- reminders
  function notificationSupport() {
    return typeof global.Notification === 'function' && typeof global.Notification.requestPermission === 'function';
  }
  /**
   * Enable reminders. Call ONLY from a click handler: it may call Notification.requestPermission().
   * done(retention) runs after the permission answer (or right away when unsupported).
   */
  function enableReminders(r, time, done) {
    if (/^\d{2}:\d{2}$/.test(time || '')) r.reminder.time = time;
    r.reminder.enabled = true;
    if (!notificationSupport()) { r.reminder.permission = 'unsupported'; done(r); return; }
    if (global.Notification.permission === 'granted' || global.Notification.permission === 'denied') {
      r.reminder.permission = global.Notification.permission; done(r); return;
    }
    var finish = function (p) { r.reminder.permission = p || 'default'; done(r); };
    try {
      var p = global.Notification.requestPermission(finish);
      if (p && typeof p.then === 'function') p.then(finish, function () { finish('denied'); });
    } catch (e) { finish('denied'); }
  }
  function disableReminders(r) { r.reminder.enabled = false; return r; }
  /** ms until the next reminder check; 0 when it is due now (time passed today, not yet sent). */
  function reminderDelay(r, now) {
    now = now || new Date();
    var hm = r.reminder.time.split(':');
    var at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +hm[0], +hm[1], 0, 0);
    if (now >= at) {
      if (r.reminder.lastNotifiedOn === localDay(now)) at = new Date(at.getTime() + DAY_MS);
      else return 0;
    }
    return at.getTime() - now.getTime();
  }

  // ---------------------------------------------------------------- welcome popover, corner, activity (pure)
  /** True when the welcome popover should show on this load: enabled and not yet shown this local day. */
  function popoverDue(r, now) {
    var p = r.popover || {};
    if (p.onLoad === false) return false;
    return p.lastShownOn !== today(now);
  }
  function markPopoverShown(r, now) {
    if (!isObj(r.popover)) r.popover = { onLoad: true, lastShownOn: null };
    r.popover.lastShownOn = today(now);
    return r;
  }
  function setPopoverOnLoad(r, on) {
    if (!isObj(r.popover)) r.popover = { onLoad: true, lastShownOn: null };
    r.popover.onLoad = !!on;
    return r;
  }

  /** Last `n` local days (oldest first): { day, state: 'active'|'frozen'|'missed'|'today', count }. */
  function activity(r, now, n) {
    n = n || 30;
    var t = today(now);
    var s = streak(r, now);
    var counts = {};
    r.history.forEach(function (h) { var d = localDay(h.at); if (d) counts[d] = (counts[d] || 0) + 1; });
    var frozen = {};
    s.frozenDays.forEach(function (d) { frozen[d] = true; });
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = addDays(t, -i);
      var c = counts[d] || 0;
      var state = c > 0 ? 'active' : frozen[d] ? 'frozen' : d === t ? 'today' : 'missed';
      out.push({ day: d, state: state, count: c });
    }
    return out;
  }

  /** The next milestone to show: an unearned badge, else the next streak length. */
  var STREAK_STEPS = [3, 7, 14, 30, 60, 100, 200, 365];
  function nextMilestone(r, now, opts) {
    opts = opts || {};
    if (opts.badges !== false) {
      for (var i = 0; i < BADGES.length; i++) if (!r.badges.earned[BADGES[i].id]) return BADGES[i].name;
    }
    var cur = streak(r, now).current;
    for (var j = 0; j < STREAK_STEPS.length; j++) if (STREAK_STEPS[j] > cur) return STREAK_STEPS[j] + '-day streak (' + (STREAK_STEPS[j] - cur) + ' to go)';
    return null;
  }

  /**
   * Progress toward the next milestone: { id, name, have, need, unit } or null.
   * opts: { badges: bool, modules: [{ title, done, total }] }
   */
  function milestoneProgress(r, now, opts) {
    opts = opts || {};
    var s = streak(r, now);
    if (opts.badges !== false) {
      for (var i = 0; i < BADGES.length; i++) {
        var b = BADGES[i];
        if (r.badges.earned[b.id]) continue;
        if (b.id === 'first-lesson') return { id: b.id, name: b.name, have: r.history.some(function (h) { return h.kind === 'lesson'; }) ? 1 : 0, need: 1, unit: 'lesson' };
        if (b.id === 'first-module') {
          var best = null;
          (opts.modules || []).forEach(function (m) { if (m.total && (!best || m.done / m.total > best.done / best.total)) best = m; });
          if (best) return { id: b.id, name: b.name + (best.title ? ': ' + best.title : ''), have: best.done, need: best.total, unit: 'done' };
          continue;
        }
        if (b.id === 'first-perfect') return { id: b.id, name: b.name, have: 0, need: 1, unit: 'perfect quiz' };
        if (b.id === 'streak-7') return { id: b.id, name: b.name, have: Math.min(s.current, 7), need: 7, unit: 'days' };
      }
    }
    for (var j = 0; j < STREAK_STEPS.length; j++) if (STREAK_STEPS[j] > s.current) return { id: 'streak-' + STREAK_STEPS[j], name: STREAK_STEPS[j] + '-day streak', have: s.current, need: STREAK_STEPS[j], unit: 'days' };
    return null;
  }

  function overlaps(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
  /**
   * Choose a free bottom corner for a fixed stack of size {w, h}.
   * occupied: [{ left, top, right, bottom }] rects of existing fixed/sticky UI (viewport coordinates).
   * opts: { vw, vh, margin (16), gap (8), order: ['bottom-right', 'bottom-left'] }
   * Returns { corner, lift, rect }: the first corner with no overlap; otherwise the corner needing the
   * smallest lift (px moved up so the stack clears what is under it), preferring the order on ties.
   */
  function pickCorner(occupied, size, opts) {
    opts = opts || {};
    var vw = opts.vw, vh = opts.vh, m = opts.margin == null ? 16 : opts.margin, gap = opts.gap == null ? 8 : opts.gap;
    var order = opts.order || ['bottom-right', 'bottom-left'];
    var best = null;
    for (var i = 0; i < order.length; i++) {
      var corner = order[i];
      var left = corner === 'bottom-left' ? m : vw - m - size.w;
      var lift = 0, rect, guard = 0, hit;
      do {
        rect = { left: left, right: left + size.w, bottom: vh - m - lift, top: vh - m - lift - size.h };
        hit = null;
        for (var k = 0; k < (occupied || []).length; k++) {
          var o = occupied[k];
          if (o && o.right > o.left && o.bottom > o.top && overlaps(rect, o)) { hit = o; break; }
        }
        if (hit) lift = Math.max(lift + 1, vh - m - hit.top + gap);
        guard++;
      } while (hit && rect.top > 0 && guard < 20);
      var res = { corner: corner, lift: hit ? Infinity : lift, rect: rect };
      if (res.lift === 0) return res;
      if (!best || res.lift < best.lift) best = res;
    }
    if (best && best.lift === Infinity) best.lift = 0;
    return best;
  }

  // ---------------------------------------------------------------- DOM helpers
  var doc = global.document;
  function el(tag, attrs, kids) {
    var n = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return n;
  }
  var STYLE_ID = 'rt-core-style';
  var CSS = [
    '.rt-panel{margin:1rem 0;padding:.9rem 1rem;border:1px solid var(--rt-edge,currentColor);border-radius:var(--rt-radius,6px);font:inherit}',
    '.rt-panel h2,.rt-panel h3{margin:.2rem 0 .5rem;font-size:1rem}',
    '.rt-panel p{margin:.35rem 0}',
    '.rt-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.5rem 0}',
    '.rt-btn{font:inherit;min-height:44px;padding:.45rem .9rem;border-radius:var(--rt-radius,6px);border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}',
    '.rt-btn--primary{background:var(--rt-accent,#2f6fa7);border-color:var(--rt-accent,#2f6fa7);color:var(--rt-accent-ink,#fff)}',
    '.rt-ago{display:inline-block;margin-left:.4rem;padding:0 .4rem;border:1px solid currentColor;border-radius:999px;font-size:.78em;line-height:1.5;opacity:.85;white-space:nowrap}',
    '.rt-cat{margin-left:.4rem;font-size:.8em;opacity:.85;white-space:nowrap}',
    '.rt-muted{opacity:.8;font-size:.9em}',
    '.rt-done{font-weight:600}',
    '.rt-complete{margin:1.25rem 0;padding:.8rem 1rem;border:1px dashed var(--rt-edge,currentColor);border-radius:var(--rt-radius,6px)}',
    '.rt-diary-day{margin:1rem 0 .3rem;font-size:.95rem}',
    '.rt-diary ul{list-style:none;padding:0;margin:0}',
    '.rt-diary li{padding:.35rem 0;border-bottom:1px solid var(--rt-edge,rgba(127,127,127,.3))}',
    '.rt-crumb{display:block;font-size:.85em;opacity:.8}',
    '.rt-banner{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:50;max-width:92vw;padding:.7rem 1rem;border-radius:var(--rt-radius,6px);background:var(--rt-banner-bg,#1c222b);color:var(--rt-banner-fg,#fff);box-shadow:0 2px 10px rgba(0,0,0,.3);display:flex;gap:.6rem;align-items:center}',
    '.rt-settings label{display:inline-flex;gap:.35rem;align-items:center;margin-right:.8rem}',
    '.rt-settings input{font:inherit;width:4.5rem;min-height:36px}',
    '.rt-settings input[type=time]{width:auto}',
    '.rt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}'
  ].join('\n');
  function injectStyles() {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var s = el('style', { id: STYLE_ID });
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function agoBadge(iso, now) {
    var a = daysAgo(iso, now);
    if (!a) return null;
    return el('span', { class: 'rt-ago', title: 'Completed ' + a.date, 'aria-label': a.long + ' (' + a.date + ')', 'data-rt-ago': a.days, text: a.short });
  }
  function catBadge(row) {
    if (!row) return null;
    var span = el('span', { class: 'rt-cat', 'data-rt-cat-badge': '1' });
    span.appendChild(doc.createTextNode(row.done + '/' + row.total + ' done'));
    if (row.ago) {
      var b = el('span', { class: 'rt-ago', title: 'Last completed ' + row.ago.date, 'aria-label': 'last completion ' + (row.ago.days === 0 ? 'today' : row.ago.days + (row.ago.days === 1 ? ' day ago' : ' days ago')) + ' (' + row.ago.date + ')', text: row.ago.short });
      span.appendChild(b);
    }
    return span;
  }
  /** Add days-ago badges to [data-rt-unit] and recency to [data-rt-cat] inside root. */
  function decorate(root, r, recency, now) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-rt-unit]'), function (node) {
      var old = node.querySelector(':scope > .rt-ago');
      if (old) old.remove();
      var c = r.completions[node.getAttribute('data-rt-unit')];
      if (c) node.appendChild(agoBadge(c.completedAt, now));
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-rt-cat]'), function (node) {
      var old = node.querySelector(':scope > .rt-cat');
      if (old) old.remove();
      var row = recency && recency[node.getAttribute('data-rt-cat')];
      if (row) node.appendChild(catBadge(row));
    });
  }

  function banner(text, actionLabel, actionHref) {
    if (!doc || doc.querySelector('.rt-banner')) return;
    var close = el('button', { type: 'button', class: 'rt-btn', text: 'Dismiss' });
    var b = el('div', { class: 'rt-banner', role: 'status' }, [el('span', { text: text }), actionHref ? el('a', { class: 'rt-btn rt-btn--primary', href: actionHref, text: actionLabel || 'Open' }) : null, close]);
    close.addEventListener('click', function () { b.remove(); });
    doc.body.appendChild(b);
  }

  /**
   * Wire the opt-in reminder for an open tab.
   * cfg: { get(): retention, save(retention), title, body, href }
   */
  var reminderTimer = null;
  function scheduleReminder(cfg) {
    if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
    var r = cfg.get();
    if (!r.reminder.enabled) return;
    var fire = function () {
      var cur = cfg.get();
      if (!cur.reminder.enabled) return;
      var t = today();
      if (cur.reminder.lastNotifiedOn === t) { scheduleReminder(cfg); return; }
      cur.reminder.lastNotifiedOn = t;
      cfg.save(cur);
      if (!goalMet(cur)) {
        var sent = false;
        if (notificationSupport() && global.Notification.permission === 'granted') {
          try { new global.Notification(cfg.title || 'Time for today\u2019s lesson', { body: cfg.body || '', tag: 'rt-daily' }); sent = true; } catch (e) { sent = false; }
        }
        if (!sent) banner(cfg.body || 'Time for today\u2019s lesson.', 'Continue', cfg.href);
      }
      scheduleReminder(cfg);
    };
    var ms = reminderDelay(r);
    reminderTimer = setTimeout(fire, Math.min(ms, 2147000000));
  }

  /**
   * Render the home retention panel.
   * cfg: {
   *   get(), save(r), labels: { lesson, lessons, quiz, quizzes }, continueHref, continueTitle,
   *   modules: [{ title, remaining, total, href }], dueReviews: n, reviewHref, diaryHref,
   *   stale: [{ key, days }], badges: bool, onChange(), quizGoal: bool, settingsOpen: bool
   * }
   */
  function renderHome(container, cfg) {
    if (!container) return;
    injectChromeStyles(cfg.theme);
    var now = new Date();
    var m = model(cfg, now);
    var r = m.r;
    var idp = cfg.idp || 'rt-';
    container.innerHTML = '';
    container.classList.add('rt-ui', 'rt-home');
    container.setAttribute('aria-labelledby', idp + 'home-h');
    var live = el('div', { 'aria-live': 'polite' });
    container.appendChild(el('h2', { class: 'rt-h', id: idp + 'home-h', text: headline(m, cfg) }));
    live.appendChild(el('p', { class: 'rt-sub', 'data-rt-behind': m.b.freshStart ? 'fresh' : m.b.lessons > 0 && !m.met ? String(m.b.lessons) : null, text: subline(m) }));
    container.appendChild(live);
    container.appendChild(statsBlock(m));
    var ms = milestoneCard(m); if (ms) container.appendChild(ms);
    if (m.met && r.doneForToday !== today(now)) {
      var stop = el('button', { type: 'button', class: 'rt-ghost', 'data-rt-done-today': '1', text: 'I\u2019m done for today' });
      stop.addEventListener('click', function () { var x = cfg.get(); x.doneForToday = today(); cfg.save(x); renderHome(container, cfg); });
      var act = actions(cfg, m);
      act.cta.setAttribute('data-rt-continue', '1');
      act.row.appendChild(stop);
      container.appendChild(act.row);
    } else if (m.met) {
      container.appendChild(el('p', { class: 'rt-fc', 'data-rt-done-today': '1', text: 'Done for today. See you tomorrow.' }));
    } else if (cfg.continueHref) {
      var a2 = actions(cfg, m); a2.cta.setAttribute('data-rt-continue', '1');
      container.appendChild(a2.row);
    }
    if (m.fcs.length) {
      var fl = el('ul', { class: 'rt-list', style: 'margin-top:18px' });
      m.fcs.forEach(function (f) { fl.appendChild(el('li', { 'data-rt-forecast': f.title }, [el('b', { text: cap(f.title) }), ' ' + (f.done ? 'finished' : f.date ? 'by ' + f.date + ' at your current pace' : f.remaining + ' left')])); });
      container.appendChild(fl);
    }
    if (cfg.dueReviews > 0) {
      var rv = el('p', { class: 'rt-note', style: 'margin-top:14px', 'data-rt-reviews': String(cfg.dueReviews) });
      rv.appendChild(cfg.reviewHref ? el('a', { class: 'rt-link', href: cfg.reviewHref, text: 'Review ' + plural(cfg.dueReviews, 'missed question', 'missed questions') }) : doc.createTextNode('Review ' + plural(cfg.dueReviews, 'missed question', 'missed questions')));
      container.appendChild(rv);
    }
    (cfg.stale || []).slice(0, 2).forEach(function (x) {
      container.appendChild(el('p', { class: 'rt-fc', 'data-rt-stale': x.key, text: 'You haven\u2019t touched ' + x.key + ' in ' + x.days + ' days.' }));
    });
    if (cfg.badges) container.appendChild(el('p', { class: 'rt-fc', 'data-rt-level': String(r.badges.level), text: 'Level ' + r.badges.level + ' with ' + r.badges.xp + ' XP.' }));
    else if (cfg.milestoneList && cfg.milestoneList.length) container.appendChild(el('p', { class: 'rt-fc', 'data-rt-milestones': '1', text: 'Milestones reached: ' + cfg.milestoneList.join(', ') + '.' }));
    var wk = weekly(r, now);
    var recap = el('div', { 'data-rt-weekly': '1', class: 'rt-sec' }, [el('h3', { class: 'rt-sec-h', text: 'This week' })]);
    if (!wk.active && r.history.length) recap.appendChild(el('p', { class: 'rt-fc', style: 'margin:0', text: 'Nothing yet this week. A fresh start is one ' + m.w.lesson + ' away.' }));
    else {
      var bits = [plural(wk.lessons, m.w.lesson, m.w.lessons)];
      if (cfg.quizGoal !== false) bits.push(plural(wk.quizzes, m.w.quiz, m.w.quizzes));
      var line = cap(bits.join(' and ')) + ' so far.';
      if (wk.freezesUsed) line += ' ' + plural(wk.freezesUsed, 'freeze', 'freezes') + ' used.';
      if (cfg.badges && wk.badges.length) line += ' ' + plural(wk.badges.length, 'badge', 'badges') + ' earned.';
      recap.appendChild(el('p', { class: 'rt-fc', style: 'margin:0', text: line }));
    }
    container.appendChild(recap);
    if (cfg.diaryHref) container.appendChild(el('p', { class: 'rt-fc' }, [el('a', { class: 'rt-link', href: cfg.diaryHref, 'data-rt-diary-link': '1', text: 'Open your diary' })]));
    container.appendChild(settingsBlock(cfg, function () { renderHome(container, cfg); var d = container.querySelector('details.rt-settings'); if (d) d.open = true; }));
  }

  function settingsBlock(cfg, rerender) {
    var r = cfg.get();
    var L = cfg.labels || {};
    var idp = cfg.idp || 'rt-';
    var d = el('details', { class: 'rt-settings' });
    if (cfg.settingsOpen) d.open = true;
    d.appendChild(el('summary', { text: 'Pace and reminders' }));
    var lp = el('input', { type: 'number', min: '0', max: '50', step: '1', value: String(r.pace.lessonsPerDay), id: idp + 'lpd' });
    var row = el('div', { class: 'rt-row' }, [el('label', { for: idp + 'lpd' }, [(L.lessons ? L.lessons.charAt(0).toUpperCase() + L.lessons.slice(1) : 'Lessons') + ' per day', lp])]);
    var qp = null;
    if (cfg.quizGoal !== false) {
      qp = el('input', { type: 'number', min: '0', max: '50', step: '1', value: String(r.pace.quizzesPerDay), id: idp + 'qpd' });
      row.appendChild(el('label', { for: idp + 'qpd' }, [(L.quizzes ? L.quizzes.charAt(0).toUpperCase() + L.quizzes.slice(1) : 'Quizzes') + ' per day', qp]));
    }
    var save = el('button', { type: 'button', class: 'rt-btn', text: 'Save pace' });
    save.addEventListener('click', function () {
      var x = cfg.get();
      x.pace.lessonsPerDay = num(lp.value, x.pace.lessonsPerDay, 0, 50);
      if (qp) x.pace.quizzesPerDay = num(qp.value, x.pace.quizzesPerDay, 0, 50);
      if (!x.pace.since) x.pace.since = today();
      cfg.save(x); if (cfg.onChange) cfg.onChange(); rerender();
    });
    row.appendChild(save);
    d.appendChild(row);
    d.appendChild(el('p', { class: 'rt-muted', text: 'Freezes: every 7 active days in a row earns one freeze (you can bank one). It covers a single missed day automatically.' }));

    var time = el('input', { type: 'time', value: r.reminder.time, id: idp + 'time' });
    var rrow = el('div', { class: 'rt-row' }, [el('label', { for: idp + 'time' }, ['Daily reminder at', time])]);
    if (!r.reminder.enabled) {
      var en = el('button', { type: 'button', class: 'rt-btn', 'data-rt-enable-reminders': '1', text: 'Enable reminders' });
      en.addEventListener('click', function () {
        var x = cfg.get();
        enableReminders(x, time.value, function (y) { cfg.save(y); if (cfg.onReminder) cfg.onReminder(); rerender(); });
      });
      rrow.appendChild(en);
    } else {
      var upd = el('button', { type: 'button', class: 'rt-btn', text: 'Save time' });
      upd.addEventListener('click', function () { var x = cfg.get(); if (/^\d{2}:\d{2}$/.test(time.value)) x.reminder.time = time.value; cfg.save(x); if (cfg.onReminder) cfg.onReminder(); rerender(); });
      var off = el('button', { type: 'button', class: 'rt-btn', text: 'Turn off reminders' });
      off.addEventListener('click', function () { var x = cfg.get(); disableReminders(x); cfg.save(x); if (cfg.onReminder) cfg.onReminder(); rerender(); });
      rrow.appendChild(upd); rrow.appendChild(off);
    }
    d.appendChild(rrow);
    var perm = r.reminder.permission;
    var status = !r.reminder.enabled ? 'Reminders are off.'
      : perm === 'granted' ? 'Reminders are on at ' + r.reminder.time + '.'
      : 'Reminders are on at ' + r.reminder.time + ' as an in-app banner' + (perm === 'denied' ? ' (notifications are blocked in this browser).' : perm === 'unsupported' ? ' (this browser has no notifications).' : '.');
    d.appendChild(el('p', { class: 'rt-muted', 'data-rt-reminder-status': perm, text: status }));
    d.appendChild(el('p', { class: 'rt-muted', text: 'Reminders only fire while this app is open in a tab.' }));
    return d;
  }

  /**
   * Mark complete control at the end of a unit.
   * cfg: { get(), save(r), unit: { id, title, path, kind }, label, onComplete(result) }
   */
  function renderMarkComplete(container, cfg) {
    if (!container) return;
    injectChromeStyles(cfg.theme);
    var r = cfg.get();
    container.innerHTML = '';
    container.classList.add('rt-complete', 'rt-ui', 'rt-done-card');
    var c = r.completions[cfg.unit.id];
    var noun = (cfg.noun || (cfg.label || 'Mark complete').replace(/^Mark\s+/i, '').replace(/\s*complete$/i, '') || 'item').toLowerCase();
    if (noun === 'mark' || noun === '') noun = 'item';
    var status = el('p', { class: 'rt-dc-sub', 'aria-live': 'polite', 'data-rt-status': c ? 'done' : 'open' });
    function finish(btn) {
      var x = cfg.get();
      var res = complete(x, cfg.unit, { source: 'button' });
      cfg.save(x);
      if (cfg.onComplete) cfg.onComplete(res);
      renderMarkComplete(container, cfg);
      var again = container.querySelector('[data-rt-mark-again]'); if (again && btn === doc.activeElement) again.focus();
      if (chrome) chrome.refresh();
    }
    if (c) {
      container.setAttribute('data-rt-state', 'done');
      var head = el('div', { class: 'rt-dc-head' }, [el('span', { class: 'rt-dc-ic rt-dc-ic--done', 'aria-hidden': 'true' }, [icon('check')]), el('div', {}, [el('p', { class: 'rt-dc-title' }, [el('span', { class: 'rt-done', text: 'Completed' }), agoBadge(c.completedAt)]), status])]);
      status.appendChild(doc.createTextNode('Reviewing it again counts toward today\u2019s pace.'));
      var again = el('button', { type: 'button', class: 'rt-ghost', 'data-rt-mark-again': '1' }, [icon('check'), 'Mark complete again']);
      again.addEventListener('click', function () { finish(again); });
      container.appendChild(head);
      container.appendChild(el('div', { class: 'rt-dc-act' }, [again]));
      return;
    }
    container.setAttribute('data-rt-state', 'open');
    status.appendChild(doc.createTextNode('Mark it complete to count it toward today\u2019s pace and your streak. Opening or scrolling never counts.'));
    var head2 = el('div', { class: 'rt-dc-head' }, [el('span', { class: 'rt-dc-ic', 'aria-hidden': 'true' }, [icon('check')]), el('div', {}, [el('p', { class: 'rt-dc-title', text: 'Finished this ' + noun + '?' }), status])]);
    var btn = el('button', { type: 'button', class: 'rt-cta', 'data-rt-mark-complete': cfg.unit.id }, [icon('check'), el('span', { text: cfg.label || 'Mark complete' })]);
    btn.addEventListener('click', function () { finish(btn); });
    container.appendChild(head2);
    container.appendChild(el('div', { class: 'rt-dc-act' }, [btn]));
  }

  /**
   * Diary view. cfg: { get(), hrefFor(unitId, row) -> url, emptyText }
   */
  function renderDiary(container, cfg) {
    if (!container) return;
    injectStyles();
    var r = cfg.get();
    container.innerHTML = '';
    injectChromeStyles(cfg.theme);
    container.classList.add('rt-diary', 'rt-ui');
    var cats = diaryCategories(r);
    var sel = el('select', { id: 'rt-diary-filter' }, [el('option', { value: '', text: 'All categories' })].concat(cats.map(function (k) { return el('option', { value: k, text: k }); })));
    var head = el('div', { class: 'rt-row' }, [el('label', { for: 'rt-diary-filter', text: 'Filter by category' }), sel]);
    var list = el('div', { 'aria-live': 'polite' });
    container.appendChild(head);
    container.appendChild(list);
    function draw() {
      list.innerHTML = '';
      var groups = diary(r, sel.value);
      if (!groups.length) { list.appendChild(el('p', { class: 'rt-muted', text: cfg.emptyText || 'Nothing completed yet. Use Mark complete at the end of a lesson.' })); return; }
      groups.forEach(function (g) {
        list.appendChild(el('h3', { class: 'rt-diary-day' }, [fullDate(g.day + 'T12:00:00'), el('span', { text: plural(g.rows.length, 'completion', 'completions') })]));
        var ul = el('ul');
        g.rows.forEach(function (h) {
          var href = cfg.hrefFor ? cfg.hrefFor(h.unitId, h) : null;
          var title = href ? el('a', { href: href, text: h.title || h.unitId }) : el('span', { text: h.title || h.unitId });
          var li = el('li', { 'data-rt-diary-row': h.unitId }, [title, agoBadge(h.at)]);
          if (h.kind === 'quiz') li.appendChild(el('span', { class: 'rt-cat', text: h.score !== null && h.score !== undefined ? 'quiz \u00b7 ' + Math.round(h.score * 100) + '%' : 'quiz' }));
          if (h.path && h.path.length) li.appendChild(el('span', { class: 'rt-crumb', text: h.path.join(' > ') }));
          ul.appendChild(li);
        });
        list.appendChild(ul);
      });
    }
    sel.addEventListener('change', draw);
    draw();
  }

  // ---------------------------------------------------------------- welcome popover, corner buttons, progress panel
  var ICONS = {
    flame: '<path d="M12 3.2c.6 3.3 4.6 5.4 4.6 10a4.6 4.6 0 0 1-9.2 0c0-2.1 1-3.5 2.3-4.8.2 1.6 1 2.7 2.4 3.2-.7-2.9-.9-5.7-.1-8.4z"/>',
    snow: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2"/>',
    book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14.5H7.5A2.5 2.5 0 0 0 5 20z"/><path d="M5 20a1.5 1.5 0 0 0 1.5 1H19M9 7.5h6"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.3 4.3L19 7.3"/>',
    arrow: '<path d="M5 12h13.5M13 6.5 18.5 12 13 17.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'
  };
  function icon(name, cls) {
    var s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'rt-i' + (cls ? ' ' + cls : ''));
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  // Theme: each app maps its own tokens (cfg.theme); anything missing is read from the page.
  function parseRgb(c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; var p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function lum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function mix(a, b, t) { return 'rgb(' + Math.round(a.r + (b.r - a.r) * t) + ',' + Math.round(a.g + (b.g - a.g) * t) + ',' + Math.round(a.b + (b.b - a.b) * t) + ')'; }
  function autoTheme() {
    var t = {};
    if (!global.getComputedStyle) return t;
    var bg = null, n = doc.body;
    while (n && n.nodeType === 1) { var c = parseRgb(global.getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) { bg = c; break; } n = n.parentNode; }
    if (!bg) bg = { r: 250, g: 249, b: 246 };
    var cs = global.getComputedStyle(doc.body);
    var fg = parseRgb(cs.color) || { r: 28, g: 32, b: 38 };
    var dark = lum(bg) < 0.25;
    var a = doc.querySelector('main a[href], a[href]');
    var acc = a ? parseRgb(global.getComputedStyle(a).color) : null;
    if (!acc || Math.abs(lum(acc) - lum(fg)) < 0.02) acc = dark ? { r: 110, g: 168, b: 220 } : { r: 38, g: 96, b: 150 };
    t.surface = dark ? mix(bg, { r: 255, g: 255, b: 255 }, 0.06) : mix(bg, { r: 255, g: 255, b: 255 }, 0.7);
    t.ink = mix(fg, fg, 0); t.heading = mix(fg, dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }, 0.35);
    t.muted = mix(fg, bg, 0.36); t.line = mix(fg, bg, 0.82);
    t.accent = mix(acc, acc, 0); t.accentInk = lum(acc) > 0.35 ? mix(bg, { r: 0, g: 0, b: 0 }, dark ? 0.2 : 0.85) : 'rgb(255,255,255)';
    t.accentSoft = mix(bg, acc, dark ? 0.16 : 0.1);
    t.font = cs.fontFamily; t.dark = dark;
    return t;
  }
  var THEME_KEYS = { surface: '--rt-surface', ink: '--rt-ink', heading: '--rt-heading', muted: '--rt-muted', line: '--rt-line', accent: '--rt-accent', accentInk: '--rt-accent-ink', accentSoft: '--rt-accent-soft', radius: '--rt-radius', font: '--rt-font', warm: '--rt-warm' };
  function applyTheme(theme) {
    var auto = autoTheme(), t = {};
    Object.keys(auto).forEach(function (k) { t[k] = auto[k]; });
    Object.keys(theme || {}).forEach(function (k) { if (theme[k]) t[k] = theme[k]; });
    if (!t.warm) t.warm = auto.dark ? '#e7a35a' : '#b5651d';
    var decl = Object.keys(THEME_KEYS).filter(function (k) { return t[k] && k !== 'dark'; }).map(function (k) { return THEME_KEYS[k] + ':' + t[k]; }).join(';');
    var s = doc.getElementById('rt-theme') || el('style', { id: 'rt-theme' });
    s.textContent = '.rt-ui{' + decl + ';--rt-shadow:' + (auto.dark ? '0 18px 48px -12px rgba(0,0,0,.65),0 2px 6px rgba(0,0,0,.35)' : '0 18px 44px -14px rgba(24,32,44,.32),0 2px 6px rgba(24,32,44,.08)') + '}';
    (doc.head || doc.documentElement).appendChild(s);
  }

  var CHROME_CSS = [
    '.rt-ui{font-family:var(--rt-font,inherit);color:var(--rt-ink);-webkit-font-smoothing:antialiased;line-height:1.45;font-size:15px;text-align:left}',
    '.rt-ui *{box-sizing:border-box}',
    '.rt-ui .rt-i{display:block;flex:none}',
    '.rt-ui :focus-visible{outline:2px solid var(--rt-accent);outline-offset:2px}',
    '.rt-ui ::selection{background:var(--rt-accent-soft)}',
    // corner
    '.rt-ui .rt-corner,.rt-corner.rt-ui{position:fixed;z-index:9990;display:flex;flex-direction:column;gap:10px;bottom:max(18px,env(safe-area-inset-bottom))}',
    '.rt-ui .rt-corner--bottom-right,.rt-corner--bottom-right.rt-ui{right:max(18px,env(safe-area-inset-right));align-items:flex-end}',
    '.rt-ui .rt-corner--bottom-left,.rt-corner--bottom-left.rt-ui{left:max(18px,env(safe-area-inset-left));align-items:flex-start}',
    '.rt-ui .rt-cbtn,.rt-cbtn.rt-ui{font:600 15px/1 var(--rt-font,inherit);color:var(--rt-heading);background:var(--rt-surface);border:1px solid var(--rt-line);box-shadow:var(--rt-shadow);height:46px;min-width:46px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 16px 0 13px;cursor:pointer;text-decoration:none;transition:transform .18s cubic-bezier(.16,1,.3,1),border-color .18s}',
    '.rt-ui .rt-cbtn:hover,.rt-cbtn.rt-ui:hover{border-color:var(--rt-accent);transform:translateY(-1px)}',
    '.rt-ui .rt-cbtn:active,.rt-cbtn.rt-ui:active{transform:translateY(0)}',
    '.rt-ui .rt-cbtn--icon,.rt-cbtn--icon.rt-ui{padding:0;width:46px}',
    '.rt-ui .rt-cbtn .rt-flame,.rt-cbtn.rt-ui .rt-flame{color:var(--rt-warm)}',
    '.rt-ui .rt-cbtn[data-rt-cold] .rt-flame,.rt-cbtn.rt-ui[data-rt-cold] .rt-flame{color:var(--rt-muted)}',
    '.rt-ui .rt-cbtn .rt-num,.rt-cbtn.rt-ui .rt-num{font-variant-numeric:tabular-nums;font-size:16px;letter-spacing:-.01em}',
    '.rt-ui .rt-cbtn .rt-cap,.rt-cbtn.rt-ui .rt-cap{font-weight:500;color:var(--rt-muted);font-size:13px}',
    '.rt-ui .rt-cbtn[aria-expanded=true],.rt-cbtn.rt-ui[aria-expanded=true]{border-color:var(--rt-accent)}',
    '.rt-ui .rt-tip,.rt-tip.rt-ui{position:relative}',
    '.rt-ui .rt-tip[data-tip]:hover::after,.rt-tip.rt-ui[data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);white-space:nowrap;background:var(--rt-heading);color:var(--rt-surface);font:500 12px/1 var(--rt-font,inherit);padding:7px 9px;border-radius:6px;pointer-events:none}',
    '.rt-ui .rt-corner--bottom-right .rt-tip[data-tip]:hover::after,.rt-corner--bottom-right.rt-ui .rt-tip[data-tip]:hover::after{right:0}.rt-corner--bottom-left .rt-tip[data-tip]:hover::after{left:0}',
    // shared card bits
    '.rt-ui .rt-card,.rt-card.rt-ui{background:var(--rt-surface);border:1px solid var(--rt-line);border-radius:calc(var(--rt-radius,10px) + 6px);box-shadow:var(--rt-shadow)}',
    '.rt-ui .rt-x,.rt-x.rt-ui{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:999px;border:0;background:transparent;color:var(--rt-muted);display:grid;place-items:center;cursor:pointer}',
    '.rt-ui .rt-x:hover,.rt-x.rt-ui:hover{background:var(--rt-accent-soft);color:var(--rt-heading)}',
    '.rt-ui .rt-h,.rt-h.rt-ui{margin:0;padding-right:44px;font:650 22px/1.2 var(--rt-font,inherit);letter-spacing:-.015em;color:var(--rt-heading);text-wrap:balance}',
    '.rt-ui .rt-sub,.rt-sub.rt-ui{margin:6px 0 0;color:var(--rt-muted);font-size:14.5px;text-wrap:pretty}',
    '.rt-ui .rt-stats,.rt-stats.rt-ui{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}',
    '.rt-ui .rt-stat,.rt-stat.rt-ui{border:1px solid var(--rt-line);border-radius:var(--rt-radius,10px);padding:14px 14px 13px;min-width:0}',
    '.rt-ui .rt-stat-k,.rt-stat-k.rt-ui{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--rt-muted);margin:0}',
    '.rt-ui .rt-big,.rt-big.rt-ui{display:flex;align-items:baseline;gap:6px;margin:8px 0 10px;color:var(--rt-heading)}',
    '.rt-ui .rt-big b,.rt-big.rt-ui b{font-size:36px;line-height:1;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}',
    '.rt-ui .rt-big span,.rt-big.rt-ui span{font-size:14px;color:var(--rt-muted);font-weight:500}',
    '.rt-ui .rt-meter,.rt-meter.rt-ui{margin-top:8px}',
    '.rt-ui .rt-meter-row,.rt-meter-row.rt-ui{display:flex;justify-content:space-between;font-size:12.5px;color:var(--rt-muted);margin-bottom:5px;gap:8px}',
    '.rt-ui .rt-meter-row b,.rt-meter-row.rt-ui b{color:var(--rt-ink);font-weight:600;font-variant-numeric:tabular-nums}',
    '.rt-ui .rt-bar,.rt-bar.rt-ui{display:flex;gap:3px;height:6px}',
    '.rt-ui .rt-bar i,.rt-bar.rt-ui i{flex:1;border-radius:999px;background:var(--rt-line)}',
    '.rt-ui .rt-bar i.on,.rt-bar.rt-ui i.on{background:var(--rt-accent)}',
    '.rt-ui .rt-bar--fill,.rt-bar--fill.rt-ui{display:block;border-radius:999px;background:var(--rt-line);overflow:hidden}',
    '.rt-ui .rt-bar--fill i,.rt-bar--fill.rt-ui i{display:block;height:100%;background:var(--rt-accent);border-radius:999px}',
    '.rt-ui .rt-flame,.rt-flame.rt-ui{color:var(--rt-warm)}',
    '.rt-ui .rt-freeze,.rt-freeze.rt-ui{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--rt-muted);margin:0}',
    '.rt-ui .rt-freeze .rt-i,.rt-freeze.rt-ui .rt-i{width:15px;height:15px}',
    '.rt-ui .rt-freeze[data-banked],.rt-freeze.rt-ui[data-banked]{color:var(--rt-ink)}',
    '.rt-ui .rt-week,.rt-week.rt-ui{display:flex;gap:5px;margin-top:10px}',
    '.rt-ui .rt-dot,.rt-dot.rt-ui{width:10px;height:10px;border-radius:999px;border:1.5px solid var(--rt-line);flex:none;list-style:none}',
    '.rt-ui .rt-dot--active,.rt-dot--active.rt-ui{background:var(--rt-accent);border-color:var(--rt-accent)}',
    '.rt-ui .rt-dot--frozen,.rt-dot--frozen.rt-ui{border-color:var(--rt-muted);background:repeating-linear-gradient(135deg,var(--rt-muted) 0 1.5px,transparent 1.5px 3.5px)}',
    '.rt-ui .rt-dot--today,.rt-dot--today.rt-ui{border-color:var(--rt-accent);border-style:dashed}',
    '.rt-ui .rt-ms,.rt-ms.rt-ui{margin-top:12px;padding:14px;border-radius:var(--rt-radius,10px);background:var(--rt-accent-soft);display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:center}',
    '.rt-ui .rt-ms .rt-i,.rt-ms.rt-ui .rt-i{grid-row:span 2;color:var(--rt-accent);width:22px;height:22px}',
    '.rt-ui .rt-ms-name,.rt-ms-name.rt-ui{font-weight:600;color:var(--rt-heading);font-size:14.5px;display:flex;justify-content:space-between;gap:8px}',
    '.rt-ui .rt-ms-name span,.rt-ms-name.rt-ui span{font-weight:500;color:var(--rt-muted);font-size:12.5px;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.rt-ui .rt-ms .rt-bar--fill,.rt-ms.rt-ui .rt-bar--fill{height:5px;background:color-mix(in srgb,var(--rt-accent) 18%,transparent)}',
    '.rt-ui .rt-fc,.rt-fc.rt-ui{margin:14px 0 0;font-size:13.5px;color:var(--rt-muted);text-wrap:pretty}',
    '.rt-ui .rt-actions,.rt-actions.rt-ui{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}',
    '.rt-ui .rt-cta,.rt-cta.rt-ui{flex:1 1 auto;min-height:46px;border-radius:var(--rt-radius,10px);border:1px solid var(--rt-accent);background:var(--rt-accent);color:var(--rt-accent-ink);font:600 15px/1.2 var(--rt-font,inherit);display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;text-decoration:none;cursor:pointer;transition:filter .15s,transform .15s cubic-bezier(.16,1,.3,1)}',
    '.rt-ui .rt-cta:hover,.rt-cta.rt-ui:hover{filter:brightness(1.08);transform:translateY(-1px)}',
    '.rt-ui .rt-cta span,.rt-cta.rt-ui span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:24ch}',
    '.rt-ui .rt-ghost,.rt-ghost.rt-ui{min-height:46px;border-radius:var(--rt-radius,10px);border:1px solid var(--rt-line);background:transparent;color:var(--rt-heading);font:600 15px/1.2 var(--rt-font,inherit);display:inline-flex;align-items:center;gap:8px;padding:10px 16px;text-decoration:none;cursor:pointer}',
    '.rt-ui .rt-ghost:hover,.rt-ghost.rt-ui:hover{border-color:var(--rt-accent);background:var(--rt-accent-soft)}',
    '.rt-ui .rt-foot,.rt-foot.rt-ui{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--rt-line)}',
    '.rt-ui .rt-switch,.rt-switch.rt-ui{display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13.5px;color:var(--rt-muted);min-height:44px}',
    '.rt-ui .rt-switch input,.rt-switch.rt-ui input{position:absolute;opacity:0;width:1px;height:1px}',
    '.rt-ui .rt-switch .rt-track,.rt-switch.rt-ui .rt-track{position:relative;width:38px;height:22px;border-radius:999px;background:var(--rt-line);flex:none;transition:background .2s}',
    '.rt-ui .rt-switch .rt-track::after,.rt-switch.rt-ui .rt-track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:999px;background:var(--rt-surface);box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s cubic-bezier(.16,1,.3,1)}',
    '.rt-ui .rt-switch input:checked+.rt-track,.rt-switch.rt-ui input:checked+.rt-track{background:var(--rt-accent)}',
    '.rt-ui .rt-switch input:checked+.rt-track::after,.rt-switch.rt-ui input:checked+.rt-track::after{transform:translateX(16px)}',
    '.rt-ui .rt-switch input:focus-visible+.rt-track,.rt-switch.rt-ui input:focus-visible+.rt-track{outline:2px solid var(--rt-accent);outline-offset:2px}',
    // popover
    '.rt-ui .rt-backdrop,.rt-backdrop.rt-ui{position:fixed;inset:0;z-index:9995;background:rgba(8,12,18,.5);display:flex;align-items:center;justify-content:center;padding:20px}',
    '.rt-ui .rt-pop:focus,.rt-pop.rt-ui:focus{outline:none}',
    '.rt-ui .rt-pop,.rt-pop.rt-ui{position:relative;width:min(468px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:26px 26px 18px}',
    // sheet
    '.rt-ui .rt-sheet,.rt-sheet.rt-ui{position:fixed;z-index:9991;width:min(392px,calc(100vw - 36px));max-height:calc(100vh - 140px);overflow:auto;padding:22px 20px 16px}',
    '.rt-ui .rt-sheet .rt-h,.rt-sheet.rt-ui .rt-h{font-size:19px}',
    '.rt-ui .rt-sec,.rt-sec.rt-ui{margin-top:22px}',
    '.rt-ui .rt-sec-h,.rt-sec-h.rt-ui{margin:0 0 10px;font:650 14px/1.3 var(--rt-font,inherit);color:var(--rt-heading);display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
    '.rt-ui .rt-sec-h span,.rt-sec-h.rt-ui span{font-weight:500;color:var(--rt-muted);font-size:12.5px}',
    '.rt-ui .rt-cal,.rt-cal.rt-ui{display:grid;grid-template-columns:repeat(15,1fr);gap:6px;padding:0;margin:0}',
    '.rt-ui .rt-cal .rt-dot,.rt-cal.rt-ui .rt-dot{width:100%;height:auto;aspect-ratio:1}',
    '.rt-ui .rt-legend,.rt-legend.rt-ui{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 0;font-size:12px;color:var(--rt-muted)}',
    '.rt-ui .rt-legend span,.rt-legend.rt-ui span{display:inline-flex;align-items:center;gap:6px}',
    '.rt-ui .rt-badges,.rt-badges.rt-ui{list-style:none;margin:0;padding:0;display:grid;gap:8px}',
    '.rt-ui .rt-badges li,.rt-badges.rt-ui li{display:flex;align-items:center;gap:10px;font-size:14px}',
    '.rt-ui .rt-badges li .rt-i,.rt-badges.rt-ui li .rt-i{width:18px;height:18px}',
    '.rt-ui .rt-badges li[data-earned] .rt-i,.rt-badges.rt-ui li[data-earned] .rt-i{color:var(--rt-accent)}',
    '.rt-ui .rt-badges li:not([data-earned]),.rt-badges.rt-ui li:not([data-earned]){color:var(--rt-muted)}',
    '.rt-ui .rt-list,.rt-list.rt-ui{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13.5px;color:var(--rt-muted)}',
    '.rt-ui .rt-list b,.rt-list.rt-ui b{color:var(--rt-ink);font-weight:600}',
    '.rt-ui .rt-link,.rt-link.rt-ui{color:var(--rt-accent);font-weight:600;text-decoration:underline;text-underline-offset:3px}',
    '.rt-ui .rt-note,.rt-note.rt-ui{margin:0;font-size:13.5px;color:var(--rt-ink);padding:10px 12px;border-radius:var(--rt-radius,10px);border:1px dashed var(--rt-line)}',
    '.rt-ui .rt-home,.rt-home.rt-ui{margin:1.25rem 0;padding:24px;background:var(--rt-surface);border:1px solid var(--rt-line);border-radius:calc(var(--rt-radius,10px) + 6px)}',
    '.rt-ui .rt-home .rt-stats,.rt-home.rt-ui .rt-stats{max-width:560px}',
    '.rt-ui .rt-home .rt-ms,.rt-home.rt-ui .rt-ms{max-width:560px}',
    '.rt-ui .rt-home details,.rt-home.rt-ui details,.rt-ui .rt-sheet details,.rt-sheet.rt-ui details{margin-top:18px;border-top:1px solid var(--rt-line);padding-top:6px}',
    '.rt-ui .rt-home summary,.rt-home.rt-ui summary,.rt-ui .rt-sheet summary,.rt-sheet.rt-ui summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600;color:var(--rt-heading);font-size:14px}',
    '.rt-ui .rt-home .rt-settings .rt-row,.rt-home.rt-ui .rt-settings .rt-row,.rt-ui .rt-sheet .rt-settings .rt-row,.rt-sheet.rt-ui .rt-settings .rt-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0}',
    '.rt-ui .rt-home .rt-settings label,.rt-home.rt-ui .rt-settings label,.rt-ui .rt-sheet .rt-settings label,.rt-sheet.rt-ui .rt-settings label{display:inline-flex;gap:8px;align-items:center;font-size:13.5px;color:var(--rt-ink)}',
    '.rt-ui .rt-home .rt-settings input,.rt-home.rt-ui .rt-settings input,.rt-ui .rt-sheet .rt-settings input,.rt-sheet.rt-ui .rt-settings input{font:inherit;color:var(--rt-ink);background:transparent;border:1px solid var(--rt-line);border-radius:8px;min-height:40px;padding:0 10px;width:4.5rem}',
    '.rt-ui .rt-home .rt-settings input[type=time],.rt-home.rt-ui .rt-settings input[type=time],.rt-ui .rt-sheet .rt-settings input[type=time],.rt-sheet.rt-ui .rt-settings input[type=time]{width:auto}',
    '.rt-ui .rt-home .rt-settings .rt-btn,.rt-home.rt-ui .rt-settings .rt-btn,.rt-ui .rt-sheet .rt-settings .rt-btn,.rt-sheet.rt-ui .rt-settings .rt-btn{min-height:40px;border:1px solid var(--rt-line);border-radius:8px;background:transparent;color:var(--rt-heading);font:600 13.5px var(--rt-font,inherit);padding:0 12px;cursor:pointer}',
    '.rt-ui .rt-home .rt-settings .rt-btn:hover,.rt-home.rt-ui .rt-settings .rt-btn:hover,.rt-ui .rt-sheet .rt-settings .rt-btn:hover,.rt-sheet.rt-ui .rt-settings .rt-btn:hover{border-color:var(--rt-accent)}',
    '.rt-ui .rt-home .rt-muted,.rt-home.rt-ui .rt-muted,.rt-ui .rt-sheet .rt-muted,.rt-sheet.rt-ui .rt-muted{font-size:12.5px;color:var(--rt-muted);opacity:1;margin:6px 0}',
    '.rt-ui .rt-done-card,.rt-done-card.rt-ui{margin:28px 0;padding:20px;background:var(--rt-surface);border:1px solid var(--rt-line);border-radius:calc(var(--rt-radius,10px) + 4px);display:flex;flex-wrap:wrap;gap:16px 20px;align-items:center;justify-content:space-between}',
    '.rt-done-card.rt-ui[data-rt-state=done]{border-color:color-mix(in srgb,var(--rt-accent) 45%,var(--rt-line))}',
    '.rt-done-card .rt-dc-head{display:flex;gap:14px;align-items:flex-start;flex:1 1 300px;min-width:0}',
    '.rt-done-card .rt-dc-ic{width:38px;height:38px;border-radius:999px;border:1.5px solid var(--rt-line);color:var(--rt-muted);display:grid;place-items:center;flex:none}',
    '.rt-done-card .rt-dc-ic--done{background:var(--rt-accent);border-color:var(--rt-accent);color:var(--rt-accent-ink)}',
    '.rt-done-card .rt-dc-title{margin:2px 0 0;font:650 16px/1.3 var(--rt-font,inherit);color:var(--rt-heading);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.rt-done-card .rt-dc-title .rt-done{font-weight:650}',
    '.rt-done-card .rt-dc-sub{margin:4px 0 0;font-size:13.5px;color:var(--rt-muted);text-wrap:pretty;max-width:52ch}',
    '.rt-done-card .rt-dc-act{flex:none;display:flex}',
    '.rt-done-card .rt-cta{flex:none}',
    '.rt-ui .rt-ago{display:inline-flex;align-items:center;margin-left:.4rem;padding:1px 8px;border:1px solid var(--rt-line);border-radius:999px;font:600 11.5px/1.5 var(--rt-font,inherit);color:var(--rt-muted);opacity:1;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.rt-ui .rt-ago[data-rt-ago="0"]{color:var(--rt-accent);border-color:color-mix(in srgb,var(--rt-accent) 50%,transparent)}',
    '.rt-ui summary{list-style:none;justify-content:space-between}',
    '.rt-ui summary::-webkit-details-marker{display:none}',
    '.rt-ui summary::after{content:"";width:8px;height:8px;border-right:1.8px solid var(--rt-muted);border-bottom:1.8px solid var(--rt-muted);transform:rotate(45deg);margin:-4px 4px 0 12px;transition:transform .2s}',
    '.rt-ui details[open]>summary::after{transform:rotate(-135deg);margin-top:4px}',
    '.rt-diary.rt-ui{font-size:15px}',
    '.rt-diary.rt-ui .rt-row{display:flex;gap:10px;align-items:center;margin:0 0 8px}',
    '.rt-diary.rt-ui select{font:inherit;color:var(--rt-ink);background:var(--rt-surface);border:1px solid var(--rt-line);border-radius:8px;min-height:40px;padding:0 10px}',
    '.rt-diary.rt-ui label{font-size:13.5px;color:var(--rt-muted);font-weight:600}',
    '.rt-diary.rt-ui .rt-diary-day{display:flex;justify-content:space-between;align-items:baseline;margin:26px 0 8px;font:650 14px/1.3 var(--rt-font,inherit);color:var(--rt-heading)}',
    '.rt-diary.rt-ui .rt-diary-day span{font-weight:500;font-size:12.5px;color:var(--rt-muted)}',
    '.rt-diary.rt-ui ul{list-style:none;margin:0;padding:0;border:1px solid var(--rt-line);border-radius:calc(var(--rt-radius,10px) + 2px);background:var(--rt-surface);overflow:hidden}',
    '.rt-diary.rt-ui li{display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--rt-line)}',
    '.rt-diary.rt-ui li:last-child{border-bottom:0}',
    '.rt-diary.rt-ui li>a,.rt-diary.rt-ui li>span:first-child{font-weight:600;color:var(--rt-heading);text-decoration:none;grid-column:1}',
    '.rt-diary.rt-ui li>a:hover{color:var(--rt-accent);text-decoration:underline;text-underline-offset:3px}',
    '.rt-diary.rt-ui li .rt-ago{grid-column:2;grid-row:1;margin:0}',
    '.rt-diary.rt-ui li .rt-cat{grid-column:2;font-size:12px;color:var(--rt-muted);margin:0;opacity:1}',
    '.rt-diary.rt-ui li .rt-crumb{grid-column:1;font-size:12.5px;color:var(--rt-muted);opacity:1}',
    '.rt-diary.rt-ui .rt-muted{color:var(--rt-muted);opacity:1}',
    '.rt-ui .rt-list li b{text-transform:none}',
    '@media (max-width:480px){.rt-pop{padding:22px 18px 14px}.rt-big b{font-size:30px}.rt-stats{gap:8px}.rt-stat{padding:12px}}',
    '@media (prefers-reduced-motion:no-preference){',
    '.rt-ui .rt-backdrop,.rt-backdrop.rt-ui{animation:rt-fade .24s ease-out}',
    '.rt-ui .rt-pop,.rt-pop.rt-ui{animation:rt-rise .42s cubic-bezier(.16,1,.3,1)}',
    '.rt-ui .rt-sheet,.rt-sheet.rt-ui{animation:rt-rise .3s cubic-bezier(.16,1,.3,1)}',
    '.rt-ui .rt-corner,.rt-corner.rt-ui{animation:rt-fade .4s ease-out}',
    '@keyframes rt-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes rt-rise{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}}',
    '@media (prefers-reduced-motion:reduce){.rt-ui *{transition:none!important;animation:none!important}}'
  ].join('\n');
  function injectChromeStyles(theme) {
    injectStyles();
    if (!doc) return;
    if (!doc.getElementById('rt-chrome-style')) {
      var s = el('style', { id: 'rt-chrome-style' });
      s.textContent = CHROME_CSS;
      (doc.head || doc.documentElement).appendChild(s);
    }
    applyTheme(theme);
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function bar(have, need) {
    var b = el('span', { class: 'rt-bar', 'aria-hidden': 'true' });
    if (need > 0 && need <= 10) { for (var i = 0; i < need; i++) b.appendChild(el('i', { class: i < have ? 'on' : null })); }
    else { b.className = 'rt-bar rt-bar--fill'; b.style.height = '6px'; var f = el('i'); f.style.width = (need > 0 ? Math.min(100, Math.round(have / need * 100)) : 0) + '%'; b.appendChild(f); }
    return b;
  }
  function meter(label, have, need) {
    return el('div', { class: 'rt-meter' }, [el('div', { class: 'rt-meter-row' }, [el('span', { text: label }), el('b', { text: have + ' of ' + need })]), bar(Math.min(have, need), need)]);
  }
  function words(cfg) {
    var L = cfg.labels || {};
    return { lesson: L.lesson || 'lesson', lessons: L.lessons || 'lessons', quiz: L.quiz || 'quiz', quizzes: L.quizzes || 'quizzes' };
  }

  /** Model shared by the popover and the panel. */
  function model(cfg, now) {
    var r = cfg.get(), w = words(cfg);
    var c = todayCounts(r, now), s = streak(r, now), b = behind(r, now);
    var lp = r.pace.lessonsPerDay, qp = cfg.quizGoal !== false ? r.pace.quizzesPerDay : 0;
    var goal = Math.max(0, lp) + Math.max(0, qp), done = Math.min(c.lessons, lp > 0 ? lp : c.lessons) + Math.min(c.quizzes, qp > 0 ? qp : 0);
    var fcs = (cfg.modules || []).map(function (m) {
      var f = forecast(r, m.remaining, now);
      return { title: m.title, remaining: m.remaining, done: f.done, date: f.date ? fullDate(f.date + 'T12:00:00') : null, basis: f.basis };
    });
    if (cfg.badges) {
      var fin = (cfg.modules || []).filter(function (x) { return x.total && !x.remaining; }).length;
      var before = Object.keys(r.badges.earned).length;
      updateBadges(r, { modulesFinished: Math.max(fin, cfg.modulesFinished || 0) }, now);
      if (Object.keys(r.badges.earned).length !== before && cfg.save) cfg.save(r);
    }
    var ms = milestoneProgress(r, now, { badges: !!cfg.badges, modules: (cfg.modules || []).map(function (m) { return { title: m.title, done: m.total - m.remaining, total: m.total }; }) });
    return { r: r, w: w, c: c, s: s, b: b, lp: lp, qp: qp, goal: goal, done: done, met: goalMet(r, now), fcs: fcs, ms: ms, days: activity(r, now, 30) };
  }
  function headline(m, cfg) {
    if (m.met) return 'Today\u2019s pace is done';
    if (cfg.continueTitle) return (m.r.history.length ? 'Next up: ' : 'Start with ') + cfg.continueTitle;
    return 'Ready for today\u2019s ' + m.w.lesson;
  }
  function subline(m) {
    var parts = [];
    if (m.lp > 0) parts.push(plural(m.lp, m.w.lesson, m.w.lessons));
    if (m.qp > 0) parts.push(plural(m.qp, m.w.quiz, m.w.quizzes));
    if (m.met) return m.s.current > 1 ? 'Your ' + m.s.current + '-day streak is safe. One more is a bonus.' : 'Nice work. Come back tomorrow to start a streak.';
    if (m.b.freshStart) return 'Welcome back. A fresh start takes one ' + m.w.lesson + '.';
    if (m.b.lessons > 0) return 'You\u2019re ' + plural(m.b.lessons, m.w.lesson, m.w.lessons) + ' behind your pace. One today keeps things moving.';
    return parts.length ? 'Your pace is ' + parts.join(' and ') + ' a day.' : 'Pick a daily pace from the Streak button.';
  }
  function statsBlock(m) {
    var today = el('div', { class: 'rt-stat', 'data-rt-today': m.done + '/' + m.goal });
    today.appendChild(el('p', { class: 'rt-stat-k', text: 'Today' }));
    today.appendChild(el('div', { class: 'rt-big' }, [el('b', { text: String(m.done) }), el('span', { text: 'of ' + m.goal + ' done' })]));
    if (m.lp > 0) today.appendChild(meter(cap(m.w.lessons), m.c.lessons, m.lp));
    if (m.qp > 0) today.appendChild(meter(cap(m.w.quizzes), m.c.quizzes, m.qp));
    var st = el('div', { class: 'rt-stat', 'data-rt-streak': String(m.s.current) });
    var k = el('p', { class: 'rt-stat-k' }, [icon('flame', 'rt-flame'), 'Streak']);
    k.firstChild.setAttribute('width', '15'); k.firstChild.setAttribute('height', '15');
    st.appendChild(k);
    st.appendChild(el('div', { class: 'rt-big' }, [el('b', { text: String(m.s.current) }), el('span', { text: m.s.current === 1 ? 'day' : 'days' })]));
    var fz = el('p', { class: 'rt-freeze', 'data-banked': m.s.freezes > 0 ? '1' : null }, [icon('snow'), m.s.freezes > 0 ? '1 freeze banked' : 'Freeze earned in ' + plural(7 - (m.s.current % 7), 'day', 'days')]);
    st.appendChild(fz);
    var wk = el('ul', { class: 'rt-week', 'aria-label': 'Last 7 days', style: 'padding:0;margin:10px 0 0' });
    m.days.slice(-7).forEach(function (d) { wk.appendChild(dot(d)); });
    st.appendChild(wk);
    return el('div', { class: 'rt-stats' }, [today, st]);
  }
  function dot(d) {
    var when = fullDate(d.day + 'T12:00:00');
    var txt = d.state === 'active' ? when + ': ' + plural(d.count, 'completion', 'completions') : d.state === 'frozen' ? when + ': freeze used' : d.state === 'today' ? when + ': today, nothing yet' : when + ': rest day';
    return el('li', { class: 'rt-dot rt-dot--' + d.state, 'data-rt-day': d.day, 'data-rt-state': d.state, title: txt, 'aria-label': txt });
  }
  function milestoneCard(m) {
    if (!m.ms) return null;
    var ms = m.ms;
    var f = el('span', { class: 'rt-bar rt-bar--fill', 'aria-hidden': 'true' }); var fi = el('i'); fi.style.width = Math.round(Math.min(1, ms.have / ms.need) * 100) + '%'; f.appendChild(fi);
    return el('div', { class: 'rt-ms', 'data-rt-milestone': ms.id, role: 'group', 'aria-label': 'Next milestone: ' + ms.name + ', ' + ms.have + ' of ' + ms.need }, [
      icon('target'),
      el('div', { class: 'rt-ms-name' }, [el('b', { style: 'font-weight:600', text: ms.name }), el('span', { text: ms.have + ' of ' + ms.need })]),
      f
    ]);
  }
  function forecastLine(m) {
    var f = m.fcs[0];
    if (!f) return null;
    var txt = f.done ? 'You\u2019ve finished ' + f.title + '.' : f.date ? 'At this pace you\u2019ll finish ' + f.title + ' by ' + f.date + '.' : f.remaining + ' left in ' + f.title + '. Set a pace to see a finish date.';
    return el('p', { class: 'rt-fc', 'data-rt-forecast': f.title, text: txt });
  }
  function actions(cfg, m, onPrimary) {
    var row = el('div', { class: 'rt-actions' });
    var label = m.met ? 'Do one more' : 'Continue';
    var cta = cfg.continueHref ? el('a', { class: 'rt-cta', href: cfg.continueHref, 'data-rt-pop-continue': '1' }) : el('button', { type: 'button', class: 'rt-cta', 'data-rt-pop-continue': '1' });
    cta.appendChild(el('span', { text: label + (cfg.continueTitle ? ': ' + cfg.continueTitle : '') }));
    cta.appendChild(icon('arrow'));
    if (cta.tagName === 'BUTTON' && onPrimary) cta.addEventListener('click', onPrimary);
    row.appendChild(cta);
    if (cfg.diaryHref) { var d = el('a', { class: 'rt-ghost', href: cfg.diaryHref, 'data-rt-pop-diary': '1' }, [icon('book'), 'Diary']); row.appendChild(d); }
    return { row: row, cta: cta };
  }
  function onloadSwitch(cfg, id) {
    var r = cfg.get();
    var input = el('input', { type: 'checkbox', id: id, role: 'switch', 'data-rt-onload-toggle': '1' });
    input.checked = !(r.popover && r.popover.onLoad === false);
    input.addEventListener('change', function () { var y = cfg.get(); setPopoverOnLoad(y, input.checked); cfg.save(y); input.setAttribute('aria-checked', String(input.checked)); });
    input.setAttribute('aria-checked', String(input.checked));
    return el('label', { class: 'rt-switch', for: id }, [input, el('span', { class: 'rt-track', 'aria-hidden': 'true' }), el('span', { text: 'Show this summary when I open the app' })]);
  }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex="-1"])'), function (n) { return n.getClientRects().length > 0 || n.type === 'checkbox'; });
  }
  function isVisibleFixed(n, skip) {
    if (!n || n.nodeType !== 1 || (skip && skip(n))) return false;
    var cs = global.getComputedStyle(n);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }
  /** Rects of visible fixed/sticky UI in the bottom half of the viewport (wrappers with pointer-events:none count by their visible children). */
  function occupiedRects(skip, extra) {
    var out = [];
    if (!doc || !doc.body || !global.getComputedStyle) return out;
    var vh = global.innerHeight, vw = global.innerWidth;
    var all = doc.body.getElementsByTagName('*');
    var push = function (b) { if (b.width >= 2 && b.height >= 2 && b.bottom > vh * 0.5 && !(b.width >= vw * 0.98 && b.height >= vh * 0.9)) out.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }); };
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (!isVisibleFixed(n, skip)) continue;
      if (global.getComputedStyle(n).pointerEvents === 'none') {
        Array.prototype.forEach.call(n.children, function (k) { push(k.getBoundingClientRect()); });
      } else push(n.getBoundingClientRect());
    }
    if (extra) Array.prototype.forEach.call(doc.querySelectorAll(extra), function (n) { push(n.getBoundingClientRect()); });
    return out;
  }

  var chrome = null;
  /**
   * Mount the fixed corner buttons (streak pill + diary), the progress panel and the welcome popover.
   * cfg (object or function returning it): the renderHome cfg (get, save, labels, continueHref, continueTitle,
   *   modules, dueReviews, reviewHref, diaryHref, badges, milestoneList, quizGoal, onChange, onReminder) plus
   *   title, theme { surface, ink, heading, muted, line, accent, accentInk, accentSoft, radius, font, warm }
   *   (values such as 'var(--panel)'), avoid (selector to keep clear of), order, corner, popover (default true).
   */
  function mountChrome(cfgIn) {
    if (!doc || !doc.body) return null;
    var getCfg = typeof cfgIn === 'function' ? cfgIn : function () { return cfgIn; };
    var cfg = getCfg();
    injectChromeStyles(cfg.theme);
    if (chrome) chrome.destroy();
    var stack = el('div', { class: 'rt-ui rt-corner', 'data-rt-corner': '1', role: 'group', 'aria-label': 'Learning progress' });
    var diaryBtn = null;
    if (cfg.diaryHref) { diaryBtn = el('a', { class: 'rt-cbtn rt-cbtn--icon rt-tip', href: cfg.diaryHref, 'data-rt-diary-btn': '1', 'aria-label': 'Open diary', 'data-tip': 'Diary' }, [icon('book')]); stack.appendChild(diaryBtn); }
    var prog = el('button', { type: 'button', class: 'rt-cbtn', 'data-rt-progress-btn': '1', 'aria-expanded': 'false', 'aria-controls': 'rt-sheet', 'aria-haspopup': 'dialog' });
    stack.appendChild(prog);
    doc.body.appendChild(stack);
    var spacer = el('div', { 'data-rt-corner-spacer': '1', 'aria-hidden': 'true', style: 'height:130px' });
    doc.body.appendChild(spacer);
    var CORNER_KEY = 'rt-corner-v1';
    var stored = null; try { stored = global.localStorage.getItem(CORNER_KEY); } catch (e) { stored = null; }
    var sheet = null, dodge = 0, corner = cfg.corner || (stored === 'bottom-left' ? 'bottom-left' : 'bottom-right'), lift = 0;
    stack.className = 'rt-ui rt-corner rt-corner--' + corner;

    function label() {
      var s = streak(getCfg().get());
      prog.textContent = '';
      prog.appendChild(icon('flame', 'rt-flame'));
      prog.appendChild(el('span', { class: 'rt-num', 'aria-hidden': 'true', text: String(s.current) }));
      prog.appendChild(el('span', { class: 'rt-cap', 'aria-hidden': 'true', text: s.current === 1 ? 'day' : 'days' }));
      if (s.current === 0) prog.setAttribute('data-rt-cold', '1'); else prog.removeAttribute('data-rt-cold');
      prog.setAttribute('aria-label', 'Progress: ' + s.current + '-day streak. Open pace, streak and milestones');
      prog.setAttribute('data-rt-streak', String(s.current));
    }
    function place() {
      var skip = function (n) { return stack.contains(n) || (sheet && sheet.contains(n)) || n.classList.contains('rt-banner') || n.classList.contains('rt-backdrop'); };
      var b = stack.getBoundingClientRect();
      var res = cfg.corner ? { corner: cfg.corner, lift: 0 } : pickCorner(occupiedRects(skip, cfg.avoid), { w: Math.max(b.width, 60), h: Math.max(b.height, 46) }, { vw: global.innerWidth, vh: global.innerHeight, order: cfg.order, margin: 18 });
      corner = res.corner; lift = res.lift || 0;
      try { global.localStorage.setItem(CORNER_KEY, corner); } catch (e) { /* private mode */ }
      stack.className = 'rt-ui rt-corner rt-corner--' + corner;
      stack.setAttribute('data-rt-corner', corner);
      apply();
      spacer.style.height = Math.round(b.height + lift + 36) + 'px';
      if (sheet) placeSheet();
    }
    function apply() {
      var off = lift + dodge;
      stack.style.bottom = off ? 'calc(max(18px, env(safe-area-inset-bottom)) + ' + Math.round(off) + 'px)' : '';
    }
    function placeSheet() {
      var b = stack.getBoundingClientRect();
      sheet.style.bottom = Math.round(global.innerHeight - b.top + 10) + 'px';
      sheet.style.left = corner === 'bottom-left' ? 'max(18px, env(safe-area-inset-left))' : '';
      sheet.style.right = corner === 'bottom-right' ? 'max(18px, env(safe-area-inset-right))' : '';
    }
    var ticking = false;
    function dodgeComplete() {
      ticking = false;
      var prev = dodge; dodge = 0; apply();
      var b = stack.getBoundingClientRect(), need = 0;
      Array.prototype.forEach.call(doc.querySelectorAll('[data-rt-mark-complete],[data-rt-mark-again],[data-rt-complete-control]'), function (n) {
        var r = n.getBoundingClientRect();
        if (r.width && overlaps({ left: b.left, right: b.right, top: b.top, bottom: b.bottom }, r)) need = Math.max(need, b.bottom - r.top + 10);
      });
      dodge = need;
      if (dodge !== prev || dodge) apply();
    }
    function onScroll() { if (!ticking) { ticking = true; (global.requestAnimationFrame || setTimeout)(dodgeComplete); } }
    function closeSheet(restore) {
      if (!sheet) return;
      sheet.remove(); sheet = null;
      prog.setAttribute('aria-expanded', 'false');
      if (restore !== false) prog.focus();
    }
    function openSheet() {
      var c = getCfg();
      sheet = el('div', { id: 'rt-sheet', class: 'rt-ui rt-card rt-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'rt-sheet-h', 'data-rt-sheet': '1' });
      renderProgress(sheet, c, function () { closeSheet(); }, function () { if (c.onChange) c.onChange(); label(); });
      doc.body.appendChild(sheet);
      placeSheet();
      prog.setAttribute('aria-expanded', 'true');
      var x = sheet.querySelector('.rt-x'); if (x) x.focus();
    }
    prog.addEventListener('click', function () { if (sheet) closeSheet(); else openSheet(); });
    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (doc.querySelector('.rt-backdrop')) return;
      if (sheet) { e.preventDefault(); closeSheet(); }
    }
    function onDown(e) { if (sheet && !sheet.contains(e.target) && !stack.contains(e.target)) closeSheet(false); }
    var resizeT = null;
    function onResize() { clearTimeout(resizeT); resizeT = setTimeout(place, 150); }
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('touchstart', onDown, { passive: true });
    global.addEventListener('resize', onResize);
    global.addEventListener('scroll', onScroll, { passive: true });
    label(); place();
    var timers = [setTimeout(place, 700), setTimeout(place, 2500), setTimeout(dodgeComplete, 60)];
    // widgets such as an AI helper or a chat button often mount late: re-check the corner when the body changes
    var moT = null, mo = null;
    if (global.MutationObserver) {
      mo = new global.MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) { var a = list[i].addedNodes[j]; if (a.nodeType === 1 && a !== stack && a !== sheet && a !== spacer && !(a.classList && (a.classList.contains('rt-backdrop') || a.classList.contains('rt-banner')))) { clearTimeout(moT); moT = setTimeout(place, 120); return; } }
      });
      mo.observe(doc.body, { childList: true });
    }
    chrome = {
      stack: stack, place: place, open: openSheet, close: closeSheet, corner: function () { return corner; },
      refresh: function () { label(); if (sheet) { closeSheet(false); openSheet(); } },
      destroy: function () {
        closeSheet(false); stack.remove(); spacer.remove();
        timers.forEach(clearTimeout); if (mo) mo.disconnect(); clearTimeout(moT);
        doc.removeEventListener('keydown', onKey); doc.removeEventListener('mousedown', onDown); doc.removeEventListener('touchstart', onDown);
        global.removeEventListener('resize', onResize); global.removeEventListener('scroll', onScroll);
        chrome = null;
      }
    };
    if (cfg.popover !== false) maybeWelcome(getCfg);
    return chrome;
  }

  /** Progress panel body (used inside the corner sheet). */
  function renderProgress(box, c, onClose, onChange) {
    var now = new Date();
    var m = model(c, now);
    box.innerHTML = '';
    var x = el('button', { type: 'button', class: 'rt-x', 'aria-label': 'Close progress' }, [icon('x')]);
    x.addEventListener('click', onClose);
    box.appendChild(x);
    box.appendChild(el('h2', { class: 'rt-h', id: 'rt-sheet-h', text: 'Your progress' }));
    box.appendChild(el('p', { class: 'rt-sub', 'aria-live': 'polite', text: subline(m) }));
    box.appendChild(statsBlock(m));
    var ms = milestoneCard(m); if (ms) box.appendChild(ms);
    // 30 days
    var cal = el('ul', { class: 'rt-cal', 'aria-label': 'Activity over the last 30 days', 'data-rt-strip': '1' });
    m.days.forEach(function (d) { cal.appendChild(dot(d)); });
    var active = m.days.filter(function (d) { return d.state === 'active'; }).length;
    var lg = el('p', { class: 'rt-legend' });
    [['active', 'Active'], ['frozen', 'Freeze'], ['missed', 'Rest day'], ['today', 'Today']].forEach(function (p) { lg.appendChild(el('span', {}, [el('i', { class: 'rt-dot rt-dot--' + p[0], 'aria-hidden': 'true' }), p[1]])); });
    box.appendChild(el('section', { class: 'rt-sec' }, [el('h3', { class: 'rt-sec-h' }, ['Last 30 days', el('span', { text: plural(active, 'active day', 'active days') })]), cal, lg]));
    // badges / milestones
    if (c.badges) {
      var ul = el('ul', { class: 'rt-badges' });
      BADGES.forEach(function (b) { var e = !!m.r.badges.earned[b.id]; ul.appendChild(el('li', { 'data-earned': e ? '1' : null }, [icon(e ? 'check' : 'lock'), b.name])); });
      box.appendChild(el('section', { class: 'rt-sec' }, [el('h3', { class: 'rt-sec-h' }, ['Badges', el('span', { text: 'Level ' + m.r.badges.level + ', ' + m.r.badges.xp + ' XP' })]), ul]));
    } else if (c.milestoneList && c.milestoneList.length) {
      var ml = el('ul', { class: 'rt-badges' });
      c.milestoneList.forEach(function (t) { ml.appendChild(el('li', { 'data-earned': '1' }, [icon('check'), t])); });
      box.appendChild(el('section', { class: 'rt-sec' }, [el('h3', { class: 'rt-sec-h', text: 'Milestones reached' }), ml]));
    }
    // forecasts
    if (m.fcs.length) {
      var fl = el('ul', { class: 'rt-list' });
      m.fcs.slice(0, 4).forEach(function (f) {
        fl.appendChild(el('li', { 'data-rt-forecast': f.title }, [el('b', { text: cap(f.title) }), ' ' + (f.done ? 'finished' : f.date ? 'by ' + f.date : f.remaining + ' left')]));
      });
      box.appendChild(el('section', { class: 'rt-sec' }, [el('h3', { class: 'rt-sec-h' }, ['Finish dates', el('span', { text: m.fcs[0].basis === 'actual' ? 'from your recent pace' : 'from your set pace' })]), fl]));
    }
    if (c.dueReviews > 0) {
      var rv = el('p', { class: 'rt-note', 'data-rt-reviews': String(c.dueReviews) });
      rv.appendChild(c.reviewHref ? el('a', { class: 'rt-link', href: c.reviewHref, text: 'Review ' + plural(c.dueReviews, 'missed question', 'missed questions') }) : doc.createTextNode('Review ' + plural(c.dueReviews, 'missed question', 'missed questions')));
      box.appendChild(el('div', { class: 'rt-sec' }, [rv]));
    }
    box.appendChild(actions(c, m).row);
    var hc = {}; Object.keys(c).forEach(function (k) { hc[k] = c[k]; });
    hc.idp = 'rt-s-';
    hc.onChange = onChange;
    var set = settingsBlock(hc, function () { renderProgress(box, c, onClose, onChange); var d = box.querySelector('details.rt-settings'); if (d) d.open = true; });
    box.appendChild(set);
    box.appendChild(el('div', { class: 'rt-foot' }, [onloadSwitch(c, 'rt-s-onload')]));
  }

  /** Show the welcome popover if due today (once per local day). Returns true when shown. */
  function maybeWelcome(getCfg, force) {
    var c = getCfg();
    var r = c.get();
    if (!force && !popoverDue(r)) return false;
    if (doc.querySelector('.rt-backdrop')) return false;
    markPopoverShown(r); c.save(r);
    var m = model(c, new Date());
    var lastFocus = doc.activeElement;
    var back = el('div', { class: 'rt-ui rt-backdrop', 'data-rt-welcome': '1' });
    var box = el('div', { class: 'rt-card rt-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rt-pop-h', 'aria-describedby': 'rt-pop-d' });
    var x = el('button', { type: 'button', class: 'rt-x', 'aria-label': 'Close', 'data-rt-pop-close': '1' }, [icon('x')]);
    box.appendChild(x);
    box.appendChild(el('h2', { class: 'rt-h', id: 'rt-pop-h', text: headline(m, c) }));
    box.appendChild(el('p', { class: 'rt-sub', id: 'rt-pop-d', text: subline(m) }));
    box.appendChild(statsBlock(m));
    var ms = milestoneCard(m); if (ms) box.appendChild(ms);
    var fc = forecastLine(m); if (fc) box.appendChild(fc);
    var act = actions(c, m, function () { close(); });
    box.appendChild(act.row);
    box.appendChild(el('div', { class: 'rt-foot' }, [onloadSwitch(c, 'rt-pop-onload')]));
    var sw = box.querySelector('#rt-pop-onload'); if (sw) sw.setAttribute('data-rt-pop-off', '1');
    back.appendChild(box);
    function close() {
      back.remove();
      doc.removeEventListener('keydown', key, true);
      if (lastFocus && lastFocus.focus && doc.contains(lastFocus)) lastFocus.focus();
    }
    function key(e) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(box);
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || !box.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (doc.activeElement === last || !box.contains(doc.activeElement))) { e.preventDefault(); first.focus(); }
    }
    x.addEventListener('click', close);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    doc.addEventListener('keydown', key, true);
    doc.body.appendChild(back);
    box.setAttribute('tabindex', '-1');
    box.focus();
    return true;
  }

  var api = {
    CORE_VERSION: CORE_VERSION, REVIEW_STEPS: REVIEW_STEPS, BADGES: BADGES,
    localDay: localDay, localIso: localIso, addDays: addDays, dayDiff: dayDiff, weekStart: weekStart, fullDate: fullDate,
    defaults: defaults, normalize: normalize, complete: complete, importLegacy: importLegacy, isComplete: isComplete,
    countsOn: countsOn, todayCounts: todayCounts, goalMet: goalMet, streak: streak, behind: behind,
    actualPace: actualPace, forecast: forecast, recordAnswer: recordAnswer, dueReviews: dueReviews,
    updateBadges: updateBadges, daysAgo: daysAgo, categoryRecency: categoryRecency, staleCategories: staleCategories,
    diary: diary, diaryCategories: diaryCategories, weekly: weekly, nextUnit: nextUnit,
    notificationSupport: notificationSupport, enableReminders: enableReminders, disableReminders: disableReminders,
    reminderDelay: reminderDelay,
    popoverDue: popoverDue, markPopoverShown: markPopoverShown, setPopoverOnLoad: setPopoverOnLoad,
    activity: activity, nextMilestone: nextMilestone, milestoneProgress: milestoneProgress, pickCorner: pickCorner,
    ui: { injectStyles: injectStyles, agoBadge: agoBadge, catBadge: catBadge, decorate: decorate, banner: banner,
      scheduleReminder: scheduleReminder, renderHome: renderHome, renderMarkComplete: renderMarkComplete, renderDiary: renderDiary,
      renderProgress: renderProgress, mountChrome: mountChrome, welcome: maybeWelcome, occupiedRects: occupiedRects, refreshChrome: function () { if (chrome) chrome.refresh(); } }
  };
  global.RetentionCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
