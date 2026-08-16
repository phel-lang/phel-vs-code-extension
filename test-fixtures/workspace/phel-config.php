<?php

declare(strict_types=1);

// Fixture project for the integration suite. Nothing here is ever installed or
// executed: the point is that the extension finds a plausible Phel project and
// still behaves when `vendor/bin/phel` is missing.

return (new \Phel\Config\PhelConfig())
    ->setSrcDirs(['src'])
    ->setTestDirs(['tests']);
