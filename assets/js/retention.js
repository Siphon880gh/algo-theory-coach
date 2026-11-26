/**
 * Algo Theory Coach — learning retention (weng/.agents/skills/learning-retention).
 * Units: guide:<slug> (lesson, Mark complete), quiz:<slug> (quiz, completes on a pass of 80%+),
 * coach:<slug> (lesson, completes when the scenario finishes). Opening or scrolling a guide never completes it.
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
    var tpl = { guides: R.guide, quiz: R.quiz, coach: R.coach }[kind];
    return tpl ? tpl.replace('__S__', encodeURIComponent(slug)) : base;
  }
  function guideUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'guide:' + slug, title: f.title, path: [f.track], kind: 'lesson', href: href('guides', slug) }; }
  function quizUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'quiz:' + slug, title: 'Quiz: ' + f.title, path: [f.track], kind: 'quiz', href: href('quiz', slug) }; }
  function coachUnit(slug) { var f = bySlug[slug] || { title: slug, track: '' }; return { id: 'coach:' + slug, title: 'Coach: ' + f.title, path: [f.track], kind: 'lesson', href: href('coach', slug) }; }
  function unitHref(id) {
    var p = id.split(':');
    return p[0] === 'guide' ? href('guides', p[1]) : p[0] === 'quiz' ? href('quiz', p[1]) : p[0] === 'coach' ? href('coach', p[1]) : null;
  }
  function allUnits() {
    var out = [];
    fams.forEach(function (f) {
      out.push(guideUnit(f.slug));
      if (f.quiz) out.push(quizUnit(f.slug));
      if (f.coach) out.push(coachUnit(f.slug));
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
    C.ui.renderHome(sec, {
      get: get, save: save, labels: LABELS,
      continueHref: next ? href('guides', next.slug) : null, continueTitle: next ? next.title : '',
      modules: mods, dueReviews: due.length, reviewHref: due.length ? (due[0].href || unitHref(due[0].unitId)) : null,
      diaryHref: HAS.diary ? R.diary : null, stale: stale, badges: true,
      onChange: function () {}, onReminder: function () { if (HAS.reminders) schedule(); }
    });
  }




  var HAS = { review: true, reminders: false, recency: false, diary: false };
  window.TheoryRetention = { get: get, quizFinished: quizFinished, coachFinished: coachFinished, quizAnswer: quizAnswer };
  initGuidePage(); initQuizPage(); initHome(); markDueOnQuizPage();
})();
