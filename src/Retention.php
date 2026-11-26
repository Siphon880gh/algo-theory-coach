<?php

declare(strict_types=1);

namespace TheoryCore;

/**
 * Learning retention wiring (weng/.agents/skills/learning-retention).
 * The browser owns the state (theory_core_progress_v1 → retention); PHP only ships the unit catalog
 * and the scripts so every page can show Mark complete, pace, streak, forecast, review and the diary.
 */
final class Retention
{
    /**
     * Units the retention layer counts: one guide per family, plus its quiz, coach session, drill, case and cheatsheet when authored.
     *
     * @return array<string, mixed>
     */
    public static function catalog(): array
    {
        $root = dirname(__DIR__) . '/content';
        $families = [];
        foreach (Catalog::all() as $f) {
            $slug = (string) ($f['slug'] ?? '');
            if ($slug === '') {
                continue;
            }
            $families[] = [
                'slug' => $slug,
                'title' => (string) ($f['title'] ?? $slug),
                'track' => (string) ($f['track_label'] ?? ''),
                'quiz' => is_file($root . '/quizzes/' . $slug . '.json'),
                'coach' => is_file($root . '/coaching/' . $slug . '.json'),
                'drill' => is_file($root . '/drills/' . $slug . '.json'),
                'case' => is_file($root . '/cases/' . $slug . '.json'),
                'cheatsheet' => is_file($root . '/cheatsheets/' . $slug . '.json'),
            ];
        }

        return [
            'routes' => [
                'home' => url('/'),
                'guide' => url('/guides/__S__'),
                'quiz' => url('/quiz/__S__'),
                'coach' => url('/coach/__S__'),
                'drill' => url('/drill/__S__'),
                'case' => url('/case/__S__'),
                'cheatsheet' => url('/cheatsheet/__S__'),
                'diary' => url('/diary'),
            ],
            'beginner' => ProgressSchema::BEGINNER_LEARNING_ORDER,
            'families' => $families,
        ];
    }

    public static function catalogScriptTag(): string
    {
        $json = json_encode(self::catalog(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);

        return '<script type="application/json" id="rt-catalog">' . ($json === false ? '{}' : $json) . '</script>';
    }

    /**
     * Scripts appended to every page, after the page's own scripts (progress.js only once).
     *
     * @param list<string> $pageScripts
     * @return list<string>
     */
    public static function scripts(array $pageScripts): array
    {
        $out = [];
        $progress = asset_url('js/progress.js');
        if (!in_array($progress, $pageScripts, true)) {
            $out[] = $progress;
        }
        $out[] = asset_url('js/retention-core.js');
        $out[] = asset_url('js/retention.js');

        return $out;
    }

    /** Diary page: completed units newest first, grouped by day, filterable by track (rendered by retention.js). */
    public static function diaryHtml(): string
    {
        $parts = [];
        $parts[] = '<h1>Diary</h1>';
        $parts[] = '<p class="lede">Everything you marked complete or passed, newest first. Each row links back to the lesson.</p>';
        $parts[] = '<section id="rt-diary" aria-label="Completed lessons"><p class="slot">Loading your diary…</p></section>';
        $parts[] = '<noscript><p>The diary reads progress saved in this browser and needs JavaScript.</p></noscript>';

        return Layout::document('Diary — Algo Theory Coach', implode("\n", $parts), [
            'mainClass' => 'diary-page',
            'navActive' => 'diary',
        ]);
    }
}
