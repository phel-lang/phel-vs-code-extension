// Pure project-detection helpers. Given the contents of a `composer.json`,
// determine whether the workspace folder is a Phel project (i.e. the
// `phel-lang/phel` package appears in `require` or `require-dev`).

export interface PhelProjectInfo {
    isPhelProject: boolean;
    /** Phel package version constraint declared in composer.json, if any. */
    version?: string;
    /** Whether the dependency is dev-only. */
    dev?: boolean;
}

interface ComposerJson {
    require?: Record<string, string>;
    'require-dev'?: Record<string, string>;
}

const PACKAGE_NAME = 'phel-lang/phel';

export function analyzeComposerJson(text: string): PhelProjectInfo {
    let data: ComposerJson;
    try {
        data = JSON.parse(text) as ComposerJson;
    } catch {
        return { isPhelProject: false };
    }
    if (data.require && data.require[PACKAGE_NAME]) {
        return { isPhelProject: true, version: data.require[PACKAGE_NAME] };
    }
    if (data['require-dev'] && data['require-dev'][PACKAGE_NAME]) {
        return { isPhelProject: true, version: data['require-dev'][PACKAGE_NAME], dev: true };
    }
    return { isPhelProject: false };
}
