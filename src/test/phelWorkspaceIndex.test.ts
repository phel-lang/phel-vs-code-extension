import * as assert from 'assert';
import type { PhelDoc } from '../phelDocs';
import { combineDocs, PhelWorkspaceIndex, WorkspaceDoc } from '../phelWorkspaceIndex';

function fakeDoc(name: string, ns = 'app.core', overrides: Partial<PhelDoc> = {}): PhelDoc {
    return {
        name,
        ns,
        qualifiedName: `${ns}/${name}`,
        kind: 'fn',
        private: false,
        signature: `(${name})`,
        line: 0,
        column: 0,
        ...overrides,
    };
}

describe('PhelWorkspaceIndex', function () {
    it('starts empty', function () {
        const idx = new PhelWorkspaceIndex();
        assert.strictEqual(idx.fileCount(), 0);
        assert.strictEqual(idx.docCount(), 0);
        assert.deepStrictEqual(idx.allDocs(), []);
    });

    it('stores docs keyed by file and stamps sourceFile on each entry', function () {
        const idx = new PhelWorkspaceIndex();
        idx.setFile('/repo/a.phel', [fakeDoc('a')]);
        idx.setFile('/repo/b.phel', [fakeDoc('b'), fakeDoc('c')]);

        assert.strictEqual(idx.fileCount(), 2);
        assert.strictEqual(idx.docCount(), 3);

        const fromB = idx.docsForFile('/repo/b.phel');
        assert.strictEqual(fromB.length, 2);
        for (const d of fromB) {
            assert.strictEqual(d.sourceFile, '/repo/b.phel');
        }
    });

    it('replacing a file overwrites its previous docs', function () {
        const idx = new PhelWorkspaceIndex();
        idx.setFile('/repo/a.phel', [fakeDoc('old1'), fakeDoc('old2')]);
        idx.setFile('/repo/a.phel', [fakeDoc('new')]);
        const docs = idx.docsForFile('/repo/a.phel');
        assert.deepStrictEqual(
            docs.map((d) => d.name),
            ['new']
        );
    });

    it('setFile with an empty array forgets the file', function () {
        const idx = new PhelWorkspaceIndex();
        idx.setFile('/repo/a.phel', [fakeDoc('a')]);
        idx.setFile('/repo/a.phel', []);
        assert.strictEqual(idx.fileCount(), 0);
    });

    it('removeFile drops only the targeted file', function () {
        const idx = new PhelWorkspaceIndex();
        idx.setFile('/repo/a.phel', [fakeDoc('a')]);
        idx.setFile('/repo/b.phel', [fakeDoc('b')]);
        idx.removeFile('/repo/a.phel');
        assert.deepStrictEqual(
            idx.allDocs().map((d) => d.name),
            ['b']
        );
    });

    it('clear empties everything', function () {
        const idx = new PhelWorkspaceIndex();
        idx.setFile('/repo/a.phel', [fakeDoc('a')]);
        idx.clear();
        assert.strictEqual(idx.fileCount(), 0);
        assert.strictEqual(idx.docCount(), 0);
    });
});

describe('combineDocs', function () {
    it('returns workspace docs first, then core docs not already seen by name', function () {
        const ws: WorkspaceDoc[] = [
            { ...fakeDoc('helper', 'app.core'), sourceFile: '/repo/a.phel' },
        ];
        const core: PhelDoc[] = [fakeDoc('helper', 'app.core'), fakeDoc('map', 'phel.core')];
        const combined = combineDocs(ws, core);
        assert.deepStrictEqual(
            combined.map((d) => d.qualifiedName),
            ['app.core/helper', 'phel.core/map']
        );
    });

    it('keeps a core doc when nothing in the workspace shadows it', function () {
        const combined = combineDocs([], [fakeDoc('map', 'phel.core')]);
        assert.deepStrictEqual(
            combined.map((d) => d.qualifiedName),
            ['phel.core/map']
        );
    });

    it('lets the workspace fully override core when names collide', function () {
        const ws: WorkspaceDoc[] = [
            {
                ...fakeDoc('map', 'phel.core'),
                doc: 'shadowed in this project',
                sourceFile: '/repo/x.phel',
            },
        ];
        const core: PhelDoc[] = [fakeDoc('map', 'phel.core')];
        const [first] = combineDocs(ws, core);
        assert.strictEqual(first.doc, 'shadowed in this project');
    });
});
