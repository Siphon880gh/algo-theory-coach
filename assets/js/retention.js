/**
 * Algo Theory Coach — learning retention (weng/.agents/skills/learning-retention).
 * Units: guide:<slug> (lesson, Mark complete), quiz:<slug> (quiz, completes on a pass of 80%+),
 * coach:<slug> (lesson, completes when the scenario finishes), drill:<slug> (quiz), case:<slug> and cheatsheet:<slug> (lessons).
 * Every item page has a visible Mark complete button (quizzes and coach sessions too). Opening or scrolling never completes.
 * State lives in theory_core_progress_v1 under `retention` (see progress.js / src/ProgressSchema.php).
 */
(function () {
  'use strict';
  var C = window.RetentionCore, P = window.TheoryCoreProgress;
  var dataEl = document.getElementById('rt-catalog');
  if (!C || !P || !dataEl) return;
  var CAT;
  try { CAT = JSON.parse(dataEl.textContent || '{}'); } catch (e) { return; }
  var OPTS = { pace: { lessonsPerDay: 1, quizzesPerDay: 1 }, reminderTime: '09:00' };
  var PASS = 0.8;
  var LABELS = { lesson: 'lesson', lessons: 'lessons', quiz: 'quiz', quizzes: 'quizzes' };
  var R = CAT.routes || {};
  var base = R.home || './';
  var fams = CAT.families || [];
  var bySlug = {};
  fams.forEach(function (f) { bySlug[f.slug] = f; });

  function get() { var s = P.load(); return C.normalize(s.retention, OPTS); }
  function save(r) { var s = P.load(); s.retention = r; s.recovery = false; P.save(s); }
  function href(kind, slug) {
    var tpl = { guides: R.guide, quiz: R.quiz, coach: R.coach, drill: R.drill, 'case': R['case'], cheatsheet: R.cheatsheet }[kind];
    return tpl ? tpl.replace('__S__', encodeURIComponent(slug)) : base;
  }
  function guideUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'guide:' + slug, title: f.title, path: [f.track], kind: 'lesson', href: href('guides', slug) }; }
  function quizUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'quiz:' + slug, title: 'Quiz: ' + f.title, path: [f.track], kind: 'quiz', href: href('quiz', slug) }; }
  function coachUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'coach:' + slug, title: 'Coach: ' + f.title, path: [f.track], kind: 'lesson', href: href('coach', slug) }; }
  function drillUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'drill:' + slug, title: 'Drill: ' + f.title, path: [f.track], kind: 'quiz', href: href('drill', slug) }; }
  function caseUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'case:' + slug, title: 'Case: ' + f.title, path: [f.track], kind: 'lesson', href: href('case', slug) }; }
  function sheetUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'cheatsheet:' + slug, title: 'Cheatsheet: ' + f.title, path: [f.track], kind: 'lesson', href: href('cheatsheet', slug) }; }
  function unitHref(id) {
    var p = id.split(':');
    var k = { guide: 'guides', quiz: 'quiz', coach: 'coach', drill: 'drill', 'case': 'case', cheatsheet: 'cheatsheet' }[p[0]];
    return k ? href(k, p[1]) : null;
  }
  function allUnits() {
    var out = [];
    fams.forEach(function (f) {
      out.push(guideUnit(f.slug));
      if (f.quiz) out.push(quizUnit(f.slug));
      if (f.coach) out.push(coachUnit(f.slug));
      if (f.drill) out.push(drillUnit(f.slug));
      if (f['case']) out.push(caseUnit(f.slug));
      if (f.cheatsheet) out.push(sheetUnit(f.slug));
    });
    return out;
  }
  /** Beginner order first, then every other guide in catalog order. */
  function guideOrder() {
    var seen = {}, order = [];
    (CAT.beginner || []).concat(fams.map(function (f) { return f.slug; })).forEach(function (s) {
      if (!seen[s] && bySlug[s]) { seen[s] = true; order.push('guide:' + s); }
    });
    return order;
  }
  function modules(r) {
    var mods = [];
    var beg = (CAT.beginner || []).filter(function (s) { return bySlug[s]; });
    mods.push({ title: 'the beginner path', ids: beg.map(function (s) { return 'guide:' + s; }) });
    var tracks = {};
    fams.forEach(function (f) { (tracks[f.track] = tracks[f.track] || []).push('guide:' + f.slug); });
    Object.keys(tracks).forEach(function (t) { mods.push({ title: t, ids: tracks[t] }); });
    return mods.map(function (m) {
      var done = m.ids.filter(function (id) { return r.completions[id]; }).length;
      return { title: m.title, total: m.ids.length, done: done, remaining: m.ids.length - done };
    });
  }
  function afterComplete() {
    var r = get();
    var fresh = C.updateBadges(r, { modulesFinished: modules(r).filter(function (m) { return m.total && !m.remaining; }).length });
    save(r);
    if (fresh.length) C.ui.banner('Badge earned: ' + fresh.map(function (b) { return b.name; }).join(', ') + '.');
    redrawItems();
    if (C.ui.refreshChrome) C.ui.refreshChrome();
  }

  /** A visible Mark complete button at the end of every item page: quiz, coach, drill, case, cheatsheet. */
  var itemBoxes = [];
  function redrawItems() { itemBoxes.forEach(function (fn) { fn(); }); }
  function initItemPages() {
    [
      ['main.quiz-page[data-slug]', quizUnit, 'Mark quiz complete', 'Quiz completion'],
      ['main.coach-page[data-slug]', coachUnit, 'Mark coach session complete', 'Coach session completion'],
      ['main.drill-page[data-slug]', drillUnit, 'Mark drill complete', 'Drill completion'],
      ['main.case-page[data-slug]', caseUnit, 'Mark case complete', 'Case completion'],
      ['main.cheatsheet[data-slug]', sheetUnit, 'Mark cheatsheet complete', 'Cheatsheet completion']
    ].forEach(function (t) {
      var main = document.querySelector(t[0]);
      if (!main) return;
      var unit = t[1](main.getAttribute('data-slug'));
      var box = document.createElement('section');
      box.id = 'rt-complete';
      box.setAttribute('aria-label', t[3]);
      main.appendChild(box);
      var draw = function () { C.ui.renderMarkComplete(box, { get: get, save: save, unit: unit, label: t[2], onComplete: afterComplete }); };
      itemBoxes.push(draw);
      draw();
    });
  }
  function markGuideRead(slug) {
    var s = P.load();
    var id = s.pathId + ':' + slug;
    if (s.milestones[id]) { s.milestones[id].guideRead = true; P.save(s); }
  }

  function initGuidePage() {
    var main = document.querySelector('main.guide-page[data-slug]');
    if (!main) return;
    var slug = main.getAttribute('data-slug');
    var box = document.createElement('section');
    box.id = 'rt-complete';
    box.setAttribute('aria-label', 'Lesson completion');
    var footer = main.querySelector('.guide-footer');
    if (footer) main.insertBefore(box, footer); else main.appendChild(box);
    C.ui.renderMarkComplete(box, {
      get: get, save: save, unit: guideUnit(slug), label: 'Mark lesson complete',
      onComplete: function () { markGuideRead(slug); afterComplete(); }
    });
  }
  /** Called by quiz.js when every item is answered. A pass (80%+) completes the quiz unit; a fail does not. */
  function quizFinished(slug, correct, total) {
    var acc = total > 0 ? correct / total : 0;
    var box = document.getElementById('rt-quiz-result');
    if (acc + 1e-9 < PASS) {
      if (box) box.textContent = 'Not passed yet (80% needed). Missed questions come back for review tomorrow.';
      return false;
    }
    var r = get();
    C.complete(r, quizUnit(slug), { source: 'quiz', score: acc, perfect: correct === total });
    save(r);
    afterComplete();
    if (box) box.textContent = 'Quiz passed. Marked complete.';
    return true;
  }
  function coachFinished(slug) {
    var r = get();
    C.complete(r, coachUnit(slug), { source: 'coach' });
    save(r);
    afterComplete();
  }

  /** Called by quiz.js for each answer: misses are scheduled 1, 3, 7 days out. */
  function quizAnswer(slug, index, correct, prompt) {
    var r = get();
    C.recordAnswer(r, { id: 'quiz:' + slug + '#' + index, unitId: 'quiz:' + slug, correct: !!correct, title: prompt || null, href: href('quiz', slug) });
    save(r);
  }
  function markDueOnQuizPage() {
    var live = document.querySelector('.quiz-live[data-slug]');
    if (!live) return;
    var slug = live.getAttribute('data-slug');
    var due = C.dueReviews(get()).filter(function (q) { return q.unitId === 'quiz:' + slug; });
    if (!due.length) return;
    var note = document.createElement('p');
    note.className = 'rt-muted';
    note.setAttribute('data-rt-review-note', String(due.length));
    note.textContent = due.length + ' question' + (due.length === 1 ? '' : 's') + ' here ' + (due.length === 1 ? 'is' : 'are') + ' due for review (marked below).';
    live.parentNode.insertBefore(note, live);
    due.forEach(function (q) {
      var i = q.id.split('#')[1];
      var sec = live.querySelector('.quiz-item[data-index="' + i + '"]');
      if (sec) { sec.setAttribute('data-rt-due', '1'); var tag = document.createElement('p'); tag.className = 'rt-muted'; tag.textContent = 'Due for review'; sec.insertBefore(tag, sec.firstChild); }
    });
  }

  function initQuizPage() {
    var live = document.querySelector('.quiz-live[data-slug]');
    if (!live) return;
    C.ui.injectStyles();
    var out = document.createElement('p');
    out.id = 'rt-quiz-result';
    out.setAttribute('aria-live', 'polite');
    live.appendChild(out);
    var c = get().completions['quiz:' + live.getAttribute('data-slug')];
    if (c) { var b = C.ui.agoBadge(c.completedAt); var p = document.createElement('p'); p.className = 'rt-muted'; p.textContent = 'Passed before'; p.appendChild(b); live.parentNode.insertBefore(p, live); }
  }

  function initHome() {
    var main = document.querySelector('main.dashboard');
    if (!main) return;
    var sec = document.createElement('section');
    sec.id = 'rt-home';
    var anchor = main.querySelector('.home-tracks') || main.querySelector('.next-action') || main.querySelector('.lede');
    if (anchor && anchor.nextSibling) main.insertBefore(sec, anchor.nextSibling); else main.appendChild(sec);
    draw(sec);
  }
  function draw(sec) {
    C.ui.renderHome(sec, homeCfg());
  }
  /** Shared by the home panel, the corner progress panel and the welcome popover. */
  function homeCfg() {
    var r = get();
    var nextId = C.nextUnit(r, guideOrder());
    var next = nextId ? bySlug[nextId.split(':')[1]] : null;
    var mods = modules(r).filter(function (m, i) { return i === 0 || (m.done > 0 && m.remaining > 0); }).slice(0, 3);
    var due = typeof C.dueReviews === 'function' && HAS.review ? C.dueReviews(r) : [];
    var stale = [];
    if (HAS.recency) {
      var rec = C.categoryRecency(r, allUnits());
      stale = C.staleCategories(rec, 14).map(function (k) { return { key: k, days: rec[k].ago.days }; });
    }
    return {
      get: get, save: save, labels: LABELS, title: 'Algo Theory Coach',
      theme: { surface: 'var(--panel)', ink: 'var(--text)', heading: 'var(--heading)', muted: 'var(--muted)', line: 'var(--panel-edge)', accent: 'var(--accent)', accentInk: 'var(--accent-ink)', accentSoft: 'var(--accent-soft)', radius: 'var(--radius-lg)', font: 'var(--font-sans)' },
      highlight: { cards: 'li[data-rt-unit]', idOf: function (li) { return li.getAttribute('data-rt-unit'); } },
      continueHref: next ? href('guides', next.slug) : null, continueTitle: next ? next.title : '',
      modules: mods, dueReviews: due.length, reviewHref: due.length ? (due[0].href || unitHref(due[0].unitId)) : null,
      diaryHref: HAS.diary ? R.diary : null, stale: stale, badges: true,
      onChange: function () {}, onReminder: function () { if (HAS.reminders) schedule(); }
    };
  }

  function schedule() {
    var r = get();
    var nextId = C.nextUnit(r, guideOrder());
    C.ui.scheduleReminder({ get: get, save: save, title: 'Algo Theory Coach', body: 'Time for today\u2019s lesson.', href: nextId ? unitHref(nextId) : base });
  }

  function initLists() {
    var hub = document.querySelector('main.guides-hub');
    if (!hub) return;
    C.ui.injectStyles();
    Array.prototype.forEach.call(hub.querySelectorAll('li[data-slug]'), function (li) { li.setAttribute('data-rt-unit', 'guide:' + li.getAttribute('data-slug')); });
    var r = get();
    C.ui.decorate(hub, r, C.categoryRecency(r, allUnits().filter(function (u) { return u.id.indexOf('guide:') === 0; })));
  }

  function initDiary() {
    var box = document.getElementById('rt-diary');
    if (!box) return;
    C.ui.renderDiary(box, { get: get, hrefFor: function (id) { return unitHref(id); } });
  }

  var HAS = { review: true, reminders: true, recency: true, diary: true };
  window.TheoryRetention = { get: get, quizFinished: quizFinished, coachFinished: coachFinished, quizAnswer: quizAnswer };
  initGuidePage(); initQuizPage(); initItemPages(); initHome(); markDueOnQuizPage(); schedule(); initLists(); initDiary();
  if (C.ui.mountChrome) C.ui.mountChrome(homeCfg);
})();
