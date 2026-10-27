<?php

declare(strict_types=1);

namespace TheoryCore\Tests;

use PHPUnit\Framework\TestCase;

final class BasePathTest extends TestCase
{
    /** @var array<string, mixed> */
    private array $serverBackup = [];

    protected function setUp(): void
    {
        $this->serverBackup = $_SERVER;
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->serverBackup;
        $_GET = [];
    }

    public function testAppBaseEmptyWhenScriptNameIsNotIndexPhp(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/Users/wengffung/dev/web/weng/trainer/algo-theory-coach/vendor/phpunit/phpunit/phpunit';
        $this->assertSame('', app_base());
        $this->assertSame('/index.php?route=%2Fguides', url('/guides'));
        $this->assertSame('/index.php', url('/'));
        $this->assertSame('/assets/js/progress.js', asset_url('js/progress.js'));
    }

    public function testAppBaseEmptyWhenScriptNameIsRootIndex(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/index.php';
        $this->assertSame('', app_base());
        $this->assertSame('/index.php?route=%2Fguides%2Farrays', url('/guides/arrays'));
    }

    public function testAppBaseFromSubdirectoryIndex(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/weng/trainer/algo-theory-coach/index.php';
        $this->assertSame('/weng/trainer/algo-theory-coach', app_base());
        $this->assertSame('/weng/trainer/algo-theory-coach/index.php', url('/'));
        $this->assertSame('/weng/trainer/algo-theory-coach/index.php?route=%2Fguides', url('/guides'));
        $this->assertSame('/weng/trainer/algo-theory-coach/index.php?route=%2Fguides%2Farrays', url('/guides/arrays'));
        $this->assertSame('/weng/trainer/algo-theory-coach/assets/js/progress.js', asset_url('js/progress.js'));
        $this->assertSame('/weng/trainer/algo-theory-coach/assets/js/progress.js', asset_url('/js/progress.js'));
    }

    public function testRequestPathStripsInstallBaseForHome(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/weng/trainer/algo-theory-coach/index.php';

        $_SERVER['REQUEST_URI'] = '/weng/trainer/algo-theory-coach';
        $this->assertSame('/', request_path());

        $_SERVER['REQUEST_URI'] = '/weng/trainer/algo-theory-coach/';
        $this->assertSame('/', request_path());

        $_SERVER['REQUEST_URI'] = '/weng/trainer/algo-theory-coach?x=1';
        $this->assertSame('/', request_path());
    }

    public function testRequestPathStripsBaseForNestedRoutes(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/weng/trainer/algo-theory-coach/index.php';
        $_SERVER['REQUEST_URI'] = '/weng/trainer/algo-theory-coach/guides/arrays';
        $this->assertSame('/guides/arrays', request_path());

        $_SERVER['REQUEST_URI'] = '/weng/trainer/algo-theory-coach/guides/';
        $this->assertSame('/guides', request_path());

        $_SERVER['REQUEST_URI'] = '/weng/trainer/algo-theory-coach/coach/arrays';
        $this->assertSame('/coach/arrays', request_path());
    }

    public function testRequestPathAtWebRootUnchanged(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/index.php';
        $_SERVER['REQUEST_URI'] = '/guides/arrays';
        $this->assertSame('/guides/arrays', request_path());

        $_SERVER['REQUEST_URI'] = '/';
        $this->assertSame('/', request_path());
    }

    public function testUrlEnsuresLeadingSlash(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/weng/trainer/algo-theory-coach/index.php';
        $this->assertSame('/weng/trainer/algo-theory-coach/index.php?route=%2Fguides', url('guides'));
    }

    public function testRequestPathPrefersRouteQuery(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/trainer/algo-theory-coach/index.php';
        $_SERVER['REQUEST_URI'] = '/trainer/algo-theory-coach/index.php?route=%2Fguides%2Farrays';
        $_GET = ['route' => '/guides/arrays'];
        $this->assertSame('/guides/arrays', request_path());

        $_GET = ['route' => '/guides'];
        $_SERVER['REQUEST_URI'] = '/trainer/algo-theory-coach/?route=%2Fguides';
        $this->assertSame('/guides', request_path());
    }

    public function testRouteBaseIncludesIndexPhp(): void
    {
        $_SERVER['SCRIPT_NAME'] = '/trainer/algo-theory-coach/index.php';
        $this->assertSame('/trainer/algo-theory-coach/index.php', route_base());
    }
}
