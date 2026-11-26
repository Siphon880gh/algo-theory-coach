<?php

declare(strict_types=1);

namespace TheoryCore\Tests;

use PHPUnit\Framework\TestCase;
use TheoryCore\Catalog;
use TheoryCore\Guides;
use TheoryCore\Retention;

final class RetentionTest extends TestCase
{
    public function testCatalogListsEveryFamilyWithTrackAndRoutes(): void
    {
        $cat = Retention::catalog();
        $this->assertCount(count(Catalog::all()), $cat['families']);
        $first = $cat['families'][0];
        $this->assertNotSame('', $first['track']);
        $this->assertIsBool($first['quiz']);
        $this->assertStringContainsString('__S__', $cat['routes']['guide']);
        $this->assertArrayHasKey('diary', $cat['routes']);
    }

    public function testEveryPageShipsCatalogAndRetentionScriptsOnce(): void
    {
        $html = Guides::hubHtml();
        $this->assertSame(1, substr_count($html, 'id="rt-catalog"'));
        $this->assertSame(1, substr_count($html, 'js/progress.js'));
        $this->assertStringContainsString('js/retention-core.js', $html);
        $this->assertStringContainsString('js/retention.js', $html);
        $this->assertStringContainsString('>Diary</a>', $html);
    }

    public function testDiaryPageHasMountPoint(): void
    {
        $html = Retention::diaryHtml();
        $this->assertStringContainsString('id="rt-diary"', $html);
        $this->assertStringContainsString('aria-current="page"', $html);
    }

    public function testRetentionJsNeverCompletesOnScrollOrOpen(): void
    {
        $src = (string) file_get_contents(dirname(__DIR__) . '/assets/js/retention.js');
        $this->assertDoesNotMatchRegularExpression('/addEventListener\(\s*[\x27"]scroll/', $src);
        $this->assertStringNotContainsString('IntersectionObserver', $src);
        $core = (string) file_get_contents(dirname(__DIR__) . '/assets/js/retention-core.js');
        $this->assertSame(1, substr_count($core, 'Notification.requestPermission(finish)'), 'permission is requested from one place only');
    }
}
