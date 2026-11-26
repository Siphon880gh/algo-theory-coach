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
    injectStyles();
    var r = cfg.get();
    var L = cfg.labels || {};
    var lesson = L.lesson || 'lesson', lessons = L.lessons || 'lessons', quiz = L.quiz || 'quiz', quizzes = L.quizzes || 'quizzes';
    var now = new Date();
    var c = todayCounts(r, now), s = streak(r, now), b = behind(r, now), met = goalMet(r, now);
    container.innerHTML = '';
    container.classList.add('rt-panel');
    var idp = cfg.idp || 'rt-';
    container.setAttribute('aria-labelledby', idp + 'home-h');
    var live = el('div', { 'aria-live': 'polite' });
    container.appendChild(el('h2', { id: idp + 'home-h', text: 'Your pace' }));
    container.appendChild(live);

    var paceText = c.lessons + ' of ' + r.pace.lessonsPerDay + ' ' + (r.pace.lessonsPerDay === 1 ? lesson : lessons) + ' today';
    if (cfg.quizGoal !== false && r.pace.quizzesPerDay > 0) paceText += ' \u00b7 ' + c.quizzes + ' of ' + r.pace.quizzesPerDay + ' ' + (r.pace.quizzesPerDay === 1 ? quiz : quizzes);
    live.appendChild(el('p', { 'data-rt-today': '1', text: paceText }));

    if (met && r.doneForToday !== today(now)) {
      var box = el('div', { class: 'rt-complete', 'data-rt-done-today': '1' }, [
        el('p', { class: 'rt-done', text: 'You met today\u2019s pace.' }),
        el('p', { text: 'Streak: ' + s.current + (s.current === 1 ? ' day' : ' days') + '.' })
      ]);
      var more = cfg.continueHref ? el('a', { class: 'rt-btn rt-btn--primary', href: cfg.continueHref, text: 'Do one more' }) : null;
      var stop = el('button', { type: 'button', class: 'rt-btn', text: 'I\u2019m done for today' });
      stop.addEventListener('click', function () { var x = cfg.get(); x.doneForToday = today(); cfg.save(x); renderHome(container, cfg); });
      box.appendChild(el('div', { class: 'rt-row' }, [more, stop]));
      live.appendChild(box);
    } else if (met) {
      live.appendChild(el('p', { class: 'rt-done', 'data-rt-done-today': '1', text: 'Done for today. See you tomorrow.' }));
    }

    if (cfg.continueHref && !(met && r.doneForToday !== today(now))) {
      live.appendChild(el('div', { class: 'rt-row' }, [el('a', { class: 'rt-btn rt-btn--primary', href: cfg.continueHref, 'data-rt-continue': '1', text: 'Continue' + (cfg.continueTitle ? ': ' + cfg.continueTitle : '') })]));
    }

    if (b.freshStart) {
      live.appendChild(el('p', { class: 'rt-muted', 'data-rt-behind': 'fresh', text: 'Welcome back. Fresh start: pick up with one ' + lesson + ' today.' }));
    } else if (b.lessons > 0 && !met) {
      var note = el('p', { 'data-rt-behind': String(b.lessons) }, ['You\u2019re ' + b.lessons + ' ' + (b.lessons === 1 ? lesson : lessons) + ' behind your pace. ']);
      if (cfg.continueHref) note.appendChild(el('a', { href: cfg.continueHref, text: 'Catch up' }));
      note.appendChild(doc.createTextNode(' or '));
      var lower = el('button', { type: 'button', class: 'rt-linkbtn', style: 'font:inherit;background:none;border:0;padding:0;text-decoration:underline;color:inherit;cursor:pointer', text: 'lower your pace' });
      lower.addEventListener('click', function () { var d = container.querySelector('details.rt-settings'); if (d) { d.open = true; var i = d.querySelector('input'); if (i) i.focus(); } });
      note.appendChild(lower);
      note.appendChild(doc.createTextNode('?'));
      live.appendChild(note);
    }

    var streakLine = 'Streak: ' + s.current + (s.current === 1 ? ' day' : ' days') + ' (best ' + s.best + ')';
    if (s.freezes > 0) streakLine += ' \u00b7 1 freeze banked';
    var yday = addDays(today(now), -1);
    if (s.frozenDays.indexOf(yday) !== -1) streakLine += ' \u00b7 Used a freeze yesterday';
    live.appendChild(el('p', { 'data-rt-streak': String(s.current), text: streakLine + '.' }));

    (cfg.modules || []).forEach(function (m) {
      var f = forecast(r, m.remaining, now);
      var txt;
      if (f.done) txt = m.title + ': finished.';
      else if (!f.date) txt = m.title + ': ' + m.remaining + ' left. Set a pace to see a finish date.';
      else txt = 'At your current pace, you\u2019ll finish ' + m.title + ' by ' + fullDate(f.date + 'T12:00:00') + ' (' + m.remaining + ' left).';
      live.appendChild(el('p', { 'data-rt-forecast': m.title, text: txt }));
    });

    if (cfg.dueReviews > 0) {
      var rv = el('p', { 'data-rt-reviews': String(cfg.dueReviews) });
      rv.appendChild(cfg.reviewHref ? el('a', { href: cfg.reviewHref, text: 'Review ' + cfg.dueReviews + ' missed question' + (cfg.dueReviews === 1 ? '' : 's') }) : doc.createTextNode('Review ' + cfg.dueReviews + ' missed question' + (cfg.dueReviews === 1 ? '' : 's')));
      live.appendChild(rv);
    }
    (cfg.stale || []).slice(0, 2).forEach(function (x) {
      live.appendChild(el('p', { class: 'rt-muted', 'data-rt-stale': x.key, text: 'Haven\u2019t touched ' + x.key + ' in ' + x.days + 'd.' }));
    });

    if (cfg.badges) {
      var earned = Object.keys(r.badges.earned);
      var names = BADGES.filter(function (x) { return earned.indexOf(x.id) !== -1; }).map(function (x) { return x.name; });
      live.appendChild(el('p', { 'data-rt-level': String(r.badges.level), text: 'Level ' + r.badges.level + ' \u00b7 ' + r.badges.xp + ' XP' + (names.length ? ' \u00b7 Badges: ' + names.join(', ') : '') }));
    } else if (cfg.milestoneList && cfg.milestoneList.length) {
      live.appendChild(el('p', { class: 'rt-muted', 'data-rt-milestones': '1', text: 'Milestones: ' + cfg.milestoneList.join(' \u00b7 ') }));
    }

    var w = weekly(r, now);
    var recap = el('div', { 'data-rt-weekly': '1' }, [el('h3', { text: 'This week' })]);
    if (!w.active && r.history.length) recap.appendChild(el('p', { class: 'rt-muted', text: 'Nothing yet this week. A fresh start is one ' + lesson + ' away.' }));
    else {
      var bits = [w.lessons + ' ' + (w.lessons === 1 ? lesson : lessons)];
      if (cfg.quizGoal !== false) bits.push(w.quizzes + ' ' + (w.quizzes === 1 ? quiz : quizzes));
      bits.push('streak ' + s.current);
      if (w.freezesUsed) bits.push(w.freezesUsed + ' freeze' + (w.freezesUsed === 1 ? '' : 's') + ' used');
      if (cfg.badges && w.badges.length) bits.push(w.badges.length + ' badge' + (w.badges.length === 1 ? '' : 's') + ' earned');
      recap.appendChild(el('p', { text: bits.join(' \u00b7 ') + '.' }));
    }
    container.appendChild(recap);

    if (cfg.diaryHref) container.appendChild(el('p', {}, [el('a', { href: cfg.diaryHref, 'data-rt-diary-link': '1', text: 'Diary: everything you\u2019ve completed' })]));
    container.appendChild(settingsBlock(cfg, function () { renderHome(container, cfg); }));
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
    injectStyles();
    var r = cfg.get();
    container.innerHTML = '';
    container.classList.add('rt-complete');
    var c = r.completions[cfg.unit.id];
    var status = el('p', { 'aria-live': 'polite', 'data-rt-status': c ? 'done' : 'open' });
    if (c) {
      status.appendChild(el('span', { class: 'rt-done', text: 'Completed' }));
      status.appendChild(agoBadge(c.completedAt));
      var again = el('button', { type: 'button', class: 'rt-btn', 'data-rt-mark-again': '1', text: 'Mark complete again' });
      again.addEventListener('click', function () { var x = cfg.get(); var res = complete(x, cfg.unit, { source: 'button' }); cfg.save(x); if (cfg.onComplete) cfg.onComplete(res); renderMarkComplete(container, cfg); if (chrome) chrome.refresh(); });
      container.appendChild(status);
      container.appendChild(el('p', { class: 'rt-muted', text: 'Reviewing it again counts toward today\u2019s pace.' }));
      container.appendChild(again);
      return;
    }
    var btn = el('button', { type: 'button', class: 'rt-btn rt-btn--primary', 'data-rt-mark-complete': cfg.unit.id, text: cfg.label || 'Mark complete' });
    btn.addEventListener('click', function () {
      var x = cfg.get();
      var res = complete(x, cfg.unit, { source: 'button' });
      cfg.save(x);
      if (cfg.onComplete) cfg.onComplete(res);
      renderMarkComplete(container, cfg);
      if (chrome) chrome.refresh();
    });
    container.appendChild(btn);
    container.appendChild(status);
  }

  /**
   * Diary view. cfg: { get(), hrefFor(unitId, row) -> url, emptyText }
   */
  function renderDiary(container, cfg) {
    if (!container) return;
    injectStyles();
    var r = cfg.get();
    container.innerHTML = '';
    container.classList.add('rt-diary');
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
        list.appendChild(el('h3', { class: 'rt-diary-day', text: fullDate(g.day + 'T12:00:00') }));
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

  // ---------------------------------------------------------------- corner buttons, progress panel, welcome popover
  var CHROME_CSS = [
    '.rt-corner{position:fixed;z-index:9990;display:flex;flex-direction:column;gap:8px;align-items:stretch;bottom:max(16px,env(safe-area-inset-bottom))}',
    '.rt-corner--bottom-right{right:max(16px,env(safe-area-inset-right))}',
    '.rt-corner--bottom-left{left:max(16px,env(safe-area-inset-left))}',
    '.rt-corner-btn{font:inherit;font-size:14px;min-width:44px;min-height:44px;padding:.4rem .75rem;border:1px solid var(--rt-edge,#888);border-radius:var(--rt-radius,999px);background:var(--rt-corner-bg,#fff);color:var(--rt-corner-fg,#1c222b);box-shadow:0 1px 6px rgba(0,0,0,.18);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;text-decoration:none;line-height:1.2}',
    '.rt-corner-btn:focus-visible,.rt-pop button:focus-visible,.rt-pop a:focus-visible{outline:3px solid var(--rt-accent,#2f6fa7);outline-offset:2px}',
    '.rt-sheet{position:fixed;z-index:9991;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 150px);overflow:auto;background:var(--rt-corner-bg,#fff);color:var(--rt-corner-fg,#1c222b);border:1px solid var(--rt-edge,#888);border-radius:var(--rt-radius,8px);box-shadow:0 4px 18px rgba(0,0,0,.22);padding:.25rem .9rem .9rem}',
    '.rt-sheet .rt-panel{border:0;margin:0;padding:.4rem 0}',
    '.rt-sheet-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem}',
    '.rt-x{font:inherit;min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;cursor:pointer;font-size:1.3rem}',
    '.rt-strip{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin:.4rem 0;max-width:280px}',
    '.rt-cell{display:block;aspect-ratio:1;min-width:14px;border-radius:3px;border:1px solid var(--rt-edge,#999);box-sizing:border-box}',
    '.rt-cell--active{background:var(--rt-accent,#2f6fa7);border-color:var(--rt-accent,#2f6fa7)}',
    '.rt-cell--frozen{background:repeating-linear-gradient(45deg,transparent 0 3px,var(--rt-edge,#999) 3px 4px)}',
    '.rt-cell--missed{background:transparent;opacity:.55}',
    '.rt-cell--today{border-style:dashed;border-width:2px}',
    '.rt-legend{display:flex;flex-wrap:wrap;gap:.7rem;font-size:.8em;opacity:.85;margin:.2rem 0 .6rem}',
    '.rt-legend span{display:inline-flex;align-items:center;gap:.3rem}',
    '.rt-legend .rt-cell{width:12px;min-width:12px;height:12px}',
    '.rt-backdrop{position:fixed;inset:0;z-index:9995;background:rgba(10,14,20,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.rt-pop{position:relative;width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--rt-corner-bg,#fff);color:var(--rt-corner-fg,#1c222b);border:1px solid var(--rt-edge,#888);border-radius:var(--rt-radius,10px);box-shadow:0 8px 30px rgba(0,0,0,.3);padding:1rem 1.1rem}',
    '.rt-pop h2{margin:.1rem 2.5rem .6rem 0;font-size:1.15rem}',
    '.rt-pop p{margin:.35rem 0}',
    '.rt-pop .rt-x{position:absolute;top:.25rem;right:.25rem}',
    '.rt-pop label{display:inline-flex;gap:.4rem;align-items:center;min-height:44px}',
    '@media (prefers-reduced-motion:no-preference){.rt-pop{animation:rt-in .16s ease-out}.rt-sheet{animation:rt-in .12s ease-out}@keyframes rt-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}'
  ].join('\n');
  function injectChromeStyles() {
    injectStyles();
    if (!doc || doc.getElementById('rt-chrome-style')) return;
    var s = el('style', { id: 'rt-chrome-style' });
    s.textContent = CHROME_CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /** 30-day activity strip with a legend and per-day text (no red, no guilt copy). */
  function renderStrip(r, now) {
    var days = activity(r, now, 30);
    var wrap = el('div', { 'data-rt-strip': '1' });
    wrap.appendChild(el('h3', { text: 'Last 30 days' }));
    var grid = el('ul', { class: 'rt-strip', role: 'list', 'aria-label': 'Activity over the last 30 days', style: 'list-style:none;padding:0' });
    days.forEach(function (d) {
      var when = fullDate(d.day + 'T12:00:00');
      var txt = d.state === 'active' ? when + ': ' + d.count + ' completed' : d.state === 'frozen' ? when + ': freeze used' : d.state === 'today' ? when + ' (today): nothing yet' : when + ': no activity';
      grid.appendChild(el('li', { class: 'rt-cell rt-cell--' + d.state, 'data-rt-day': d.day, 'data-rt-state': d.state, title: txt, 'aria-label': txt }));
    });
    wrap.appendChild(grid);
    var lg = el('p', { class: 'rt-legend' });
    [['active', 'Active'], ['frozen', 'Freeze'], ['missed', 'Rest day'], ['today', 'Today']].forEach(function (x) {
      lg.appendChild(el('span', {}, [el('i', { class: 'rt-cell rt-cell--' + x[0], 'aria-hidden': 'true' }), x[1]]));
    });
    wrap.appendChild(lg);
    var act = days.filter(function (d) { return d.state === 'active'; }).length;
    wrap.appendChild(el('p', { class: 'rt-muted', text: act + ' active ' + (act === 1 ? 'day' : 'days') + ' in the last 30.' }));
    return wrap;
  }

  function isVisibleFixed(n, skip) {
    if (!n || n.nodeType !== 1 || (skip && skip(n))) return false;
    var cs = global.getComputedStyle(n);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }
  /** Rects of visible fixed/sticky elements that sit in the bottom part of the viewport. */
  function occupiedRects(skip, extra) {
    var out = [];
    if (!doc || !doc.body || !global.getComputedStyle) return out;
    var vh = global.innerHeight;
    var all = doc.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (!isVisibleFixed(n, skip)) continue;
      var b = n.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.bottom < vh * 0.5) continue;
      if (b.width >= global.innerWidth * 0.98 && b.height >= vh * 0.9) continue; // full-screen layers
      out.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    }
    if (extra) Array.prototype.forEach.call(doc.querySelectorAll(extra), function (n) {
      var b = n.getBoundingClientRect(); if (b.width && b.height) out.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    });
    return out;
  }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'), function (n) { return n.offsetParent !== null || n === doc.activeElement; });
  }

  /** Short summary used by the popover. */
  function summary(cfg, now) {
    var r = cfg.get();
    var L = cfg.labels || {};
    var lesson = L.lesson || 'lesson', lessons = L.lessons || 'lessons', quiz = L.quiz || 'quiz', quizzes = L.quizzes || 'quizzes';
    var c = todayCounts(r, now), s = streak(r, now);
    var pace = c.lessons + ' of ' + r.pace.lessonsPerDay + ' ' + (r.pace.lessonsPerDay === 1 ? lesson : lessons) + ' today';
    if (cfg.quizGoal !== false && r.pace.quizzesPerDay > 0) pace += ' \u00b7 ' + c.quizzes + ' of ' + r.pace.quizzesPerDay + ' ' + (r.pace.quizzesPerDay === 1 ? quiz : quizzes);
    var st = 'Streak: ' + s.current + (s.current === 1 ? ' day' : ' days') + ' \u00b7 ' + (s.freezes > 0 ? '1 freeze banked' : 'no freeze banked');
    var ms = cfg.nextMilestone || nextMilestone(r, now, { badges: !!cfg.badges });
    var fc = null, m = (cfg.modules || [])[0];
    if (m) {
      var f = forecast(r, m.remaining, now);
      fc = f.done ? m.title + ': finished.' : f.date ? 'At your current pace, you\u2019ll finish ' + m.title + ' by ' + fullDate(f.date + 'T12:00:00') + '.' : m.title + ': ' + m.remaining + ' left. Set a pace to see a finish date.';
    }
    return { pace: pace, streak: st, milestone: ms, forecast: fc, met: goalMet(r, now), current: s.current };
  }

  var chrome = null;
  /**
   * Mount the fixed corner buttons (progress / streak + diary), the progress panel and the welcome popover.
   * cfg: the renderHome cfg (get, save, labels, continueHref, continueTitle, modules, dueReviews, reviewHref,
   *      diaryHref, badges, milestoneList, quizGoal, onChange, onReminder) plus:
   *      title (popover heading), avoid (CSS selector of extra UI to keep clear of),
   *      order (corner preference), popover (default true), corner (force a corner)
   * cfg may be a function returning that object (re-read on every open).
   */
  function mountChrome(cfgIn) {
    if (!doc || !doc.body) return null;
    var getCfg = typeof cfgIn === 'function' ? cfgIn : function () { return cfgIn; };
    var cfg = getCfg();
    injectChromeStyles();
    if (chrome) chrome.destroy();
    var stack = el('div', { class: 'rt-corner', 'data-rt-corner': '1', role: 'group', 'aria-label': 'Learning progress' });
    var prog = el('button', { type: 'button', class: 'rt-corner-btn', 'data-rt-progress-btn': '1', 'aria-expanded': 'false', 'aria-controls': 'rt-sheet', 'aria-haspopup': 'dialog' });
    stack.appendChild(prog);
    var diaryBtn = null;
    if (cfg.diaryHref) { diaryBtn = el('a', { class: 'rt-corner-btn', href: cfg.diaryHref, 'data-rt-diary-btn': '1', 'aria-label': 'Open diary', text: 'Diary' }); stack.appendChild(diaryBtn); }
    doc.body.appendChild(stack);
    var spacer = el('div', { 'data-rt-corner-spacer': '1', 'aria-hidden': 'true', style: 'height:120px' });
    doc.body.appendChild(spacer);
    var sheet = null, lastFocus = null, dodge = 0, corner = cfg.corner || 'bottom-right', lift = 0;

    function label() {
      var s = streak(getCfg().get());
      prog.textContent = '';
      prog.appendChild(el('span', { 'aria-hidden': 'true', text: 'Streak ' + s.current }));
      prog.setAttribute('aria-label', 'Progress: ' + s.current + '-day streak. Open pace, streak and milestones');
      prog.setAttribute('data-rt-streak', String(s.current));
    }
    function place() {
      var skip = function (n) { return stack.contains(n) || (sheet && sheet.contains(n)) || n.classList.contains('rt-banner') || n.classList.contains('rt-backdrop'); };
      var b = stack.getBoundingClientRect();
      var res = cfg.corner ? { corner: cfg.corner, lift: 0 } : pickCorner(occupiedRects(skip, cfg.avoid), { w: Math.max(b.width, 60), h: Math.max(b.height, 44) }, { vw: global.innerWidth, vh: global.innerHeight, order: cfg.order });
      corner = res.corner; lift = res.lift || 0;
      stack.className = 'rt-corner rt-corner--' + corner;
      stack.setAttribute('data-rt-corner', corner);
      apply();
      spacer.style.height = Math.round(b.height + lift + 32) + 'px';
      if (sheet) placeSheet();
    }
    function apply() {
      var off = lift + dodge;
      stack.style.bottom = off ? 'calc(max(16px, env(safe-area-inset-bottom)) + ' + Math.round(off) + 'px)' : '';
    }
    function placeSheet() {
      var b = stack.getBoundingClientRect();
      sheet.style.bottom = Math.round(global.innerHeight - b.top + 8) + 'px';
      sheet.style.left = corner === 'bottom-left' ? 'max(16px, env(safe-area-inset-left))' : '';
      sheet.style.right = corner === 'bottom-right' ? 'max(16px, env(safe-area-inset-right))' : '';
    }
    // keep clear of any Complete control that scrolls under the stack
    var ticking = false;
    function dodgeComplete() {
      ticking = false;
      var prev = dodge; dodge = 0; apply();
      var b = stack.getBoundingClientRect();
      var need = 0;
      Array.prototype.forEach.call(doc.querySelectorAll('[data-rt-mark-complete],[data-rt-mark-again],[data-rt-complete-control]'), function (n) {
        var r = n.getBoundingClientRect();
        if (r.width && overlaps({ left: b.left, right: b.right, top: b.top, bottom: b.bottom }, r)) need = Math.max(need, b.bottom - r.top + 8);
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
      sheet = el('div', { id: 'rt-sheet', class: 'rt-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'rt-sheet-h', 'data-rt-sheet': '1' });
      var x = el('button', { type: 'button', class: 'rt-x', 'aria-label': 'Close progress', text: '\u00d7' });
      x.addEventListener('click', function () { closeSheet(); });
      sheet.appendChild(el('div', { class: 'rt-sheet-head' }, [el('h2', { id: 'rt-sheet-h', style: 'font-size:1.05rem;margin:.6rem 0 .2rem', text: 'Your progress' }), x]));
      var body = el('div');
      sheet.appendChild(body);
      function draw() {
        body.innerHTML = '';
        var home = el('div');
        var hc = {}; Object.keys(c).forEach(function (k) { hc[k] = c[k]; });
        hc.idp = 'rt-s-';
        hc.onChange = function () { if (c.onChange) c.onChange(); label(); };
        renderHome(home, hc);
        var h = home.querySelector('h2'); if (h) h.textContent = 'Pace';
        body.appendChild(home);
        var weekly = home.querySelector('[data-rt-weekly]');
        home.insertBefore(renderStrip(c.get()), weekly || null);
        var r = c.get();
        var on = el('input', { type: 'checkbox', id: 'rt-s-onload', 'data-rt-onload-toggle': '1' });
        on.checked = !(r.popover && r.popover.onLoad === false);
        on.addEventListener('change', function () { var y = c.get(); setPopoverOnLoad(y, on.checked); c.save(y); });
        body.appendChild(el('p', {}, [el('label', { for: 'rt-s-onload', style: 'display:inline-flex;gap:.4rem;align-items:center;min-height:44px' }, [on, 'Show the welcome summary when the app opens'])]));
      }
      draw();
      doc.body.appendChild(sheet);
      placeSheet();
      prog.setAttribute('aria-expanded', 'true');
      var f = focusables(sheet); (f[1] || f[0] || sheet).focus();
    }
    prog.addEventListener('click', function () { if (sheet) closeSheet(); else openSheet(); });
    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (doc.querySelector('.rt-backdrop')) return; // popover handles its own Esc
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
    var timers = [setTimeout(place, 700), setTimeout(place, 2500)];
    setTimeout(dodgeComplete, 50);

    chrome = {
      stack: stack, refresh: function () { label(); if (sheet) { closeSheet(false); openSheet(); } }, place: place,
      open: openSheet, close: closeSheet, corner: function () { return corner; },
      destroy: function () {
        closeSheet(false); stack.remove(); spacer.remove();
        timers.forEach(clearTimeout);
        doc.removeEventListener('keydown', onKey); doc.removeEventListener('mousedown', onDown); doc.removeEventListener('touchstart', onDown);
        global.removeEventListener('resize', onResize); global.removeEventListener('scroll', onScroll);
        chrome = null;
      }
    };
    if (cfg.popover !== false) maybeWelcome(getCfg);
    return chrome;
  }

  /** Show the welcome popover if due today (once per local day). Returns true when shown. */
  function maybeWelcome(getCfg, force) {
    var c = getCfg();
    var r = c.get();
    if (!force && !popoverDue(r)) return false;
    if (doc.querySelector('.rt-backdrop')) return false;
    markPopoverShown(r); c.save(r);
    var sm = summary(c, new Date());
    var lastFocus = doc.activeElement;
    var back = el('div', { class: 'rt-backdrop', 'data-rt-welcome': '1' });
    var box = el('div', { class: 'rt-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rt-pop-h', 'aria-describedby': 'rt-pop-d' });
    var x = el('button', { type: 'button', class: 'rt-x', 'aria-label': 'Close', 'data-rt-pop-close': '1', text: '\u00d7' });
    box.appendChild(x);
    box.appendChild(el('h2', { id: 'rt-pop-h', text: c.title ? 'Welcome back to ' + c.title : 'Welcome back' }));
    var d = el('div', { id: 'rt-pop-d' });
    d.appendChild(el('p', { 'data-rt-pop-pace': '1', text: (sm.met ? 'You met today\u2019s pace: ' : 'Today: ') + sm.pace + '.' }));
    d.appendChild(el('p', { 'data-rt-pop-streak': String(sm.current), text: sm.streak + '.' }));
    if (sm.milestone) d.appendChild(el('p', { 'data-rt-pop-milestone': '1', text: 'Next milestone: ' + sm.milestone + '.' }));
    if (sm.forecast) d.appendChild(el('p', { 'data-rt-pop-forecast': '1', text: sm.forecast }));
    box.appendChild(d);
    var row = el('div', { class: 'rt-row' });
    var cont = c.continueHref ? el('a', { class: 'rt-btn rt-btn--primary', href: c.continueHref, 'data-rt-pop-continue': '1', text: 'Continue' + (c.continueTitle ? ': ' + c.continueTitle : '') }) : el('button', { type: 'button', class: 'rt-btn rt-btn--primary', 'data-rt-pop-continue': '1', text: 'Continue' });
    row.appendChild(cont);
    if (c.diaryHref) row.appendChild(el('a', { class: 'rt-btn', href: c.diaryHref, 'data-rt-pop-diary': '1', text: 'Diary' }));
    box.appendChild(row);
    var off = el('input', { type: 'checkbox', id: 'rt-pop-off', 'data-rt-pop-off': '1' });
    box.appendChild(el('p', { class: 'rt-muted' }, [el('label', { for: 'rt-pop-off' }, [off, 'Don\u2019t show on load']), el('span', { class: 'rt-sr', text: ' You can turn it back on from the Streak button.' })]));
    off.addEventListener('change', function () { var y = c.get(); setPopoverOnLoad(y, !off.checked); c.save(y); });
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
    if (cont.tagName === 'BUTTON') cont.addEventListener('click', close);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    doc.addEventListener('keydown', key, true);
    doc.body.appendChild(back);
    cont.focus();
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
    activity: activity, nextMilestone: nextMilestone, pickCorner: pickCorner,
    ui: { injectStyles: injectStyles, agoBadge: agoBadge, catBadge: catBadge, decorate: decorate, banner: banner,
      scheduleReminder: scheduleReminder, renderHome: renderHome, renderMarkComplete: renderMarkComplete, renderDiary: renderDiary,
      renderStrip: renderStrip, mountChrome: mountChrome, welcome: maybeWelcome, occupiedRects: occupiedRects, refreshChrome: function () { if (chrome) chrome.refresh(); } }
  };
  global.RetentionCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
