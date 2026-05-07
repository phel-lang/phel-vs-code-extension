import * as assert from 'node:assert/strict';
import { analyzeComposerJson } from '../phelProject';

describe('phelProject.analyzeComposerJson', () => {
    it('detects phel-lang/phel in require', () => {
        const json = JSON.stringify({ require: { 'phel-lang/phel': '^0.18' } });
        const info = analyzeComposerJson(json);
        assert.equal(info.isPhelProject, true);
        assert.equal(info.version, '^0.18');
        assert.equal(info.dev, undefined);
    });

    it('detects phel-lang/phel in require-dev', () => {
        const json = JSON.stringify({ 'require-dev': { 'phel-lang/phel': 'dev-main' } });
        const info = analyzeComposerJson(json);
        assert.equal(info.isPhelProject, true);
        assert.equal(info.version, 'dev-main');
        assert.equal(info.dev, true);
    });

    it('returns false for unrelated packages', () => {
        const json = JSON.stringify({ require: { 'symfony/console': '*' } });
        assert.equal(analyzeComposerJson(json).isPhelProject, false);
    });

    it('returns false for invalid JSON', () => {
        assert.equal(analyzeComposerJson('{ broken').isPhelProject, false);
    });
});
