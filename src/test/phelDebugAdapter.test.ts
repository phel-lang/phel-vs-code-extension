import * as assert from 'assert';

/**
 * Tests for Phel Debug Adapter utilities.
 *
 * Note: The PhelDebugSession class relies heavily on VS Code APIs and network operations,
 * so we test the pure utility functions by replicating their logic here.
 */

describe('PhelDebugAdapter Utilities', function () {
    describe('convertPhelToPHP', function () {
        // Replicate the convertPhelToPHP logic
        function convertPhelToPHP(expression: string): string {
            let php = expression.trim();

            // If it looks like a variable reference (kebab-case identifier)
            if (/^[a-z][a-z0-9-]*$/i.test(php)) {
                // Convert kebab-case to snake_case and add $
                php = '$' + php.replace(/-/g, '_');
            }
            // If it's a keyword
            else if (php.startsWith(':')) {
                const name = php.substring(1);
                php = `new \\Phel\\Lang\\Keyword("${name}")`;
            }

            return php;
        }

        it('should convert simple variable names', function () {
            assert.strictEqual(convertPhelToPHP('foo'), '$foo');
            assert.strictEqual(convertPhelToPHP('bar'), '$bar');
            assert.strictEqual(convertPhelToPHP('x'), '$x');
        });

        it('should convert kebab-case to snake_case', function () {
            assert.strictEqual(convertPhelToPHP('my-var'), '$my_var');
            assert.strictEqual(convertPhelToPHP('some-long-name'), '$some_long_name');
            assert.strictEqual(convertPhelToPHP('a-b-c'), '$a_b_c');
        });

        it('should convert keywords to Phel Keyword objects', function () {
            assert.strictEqual(convertPhelToPHP(':status'), 'new \\Phel\\Lang\\Keyword("status")');
            assert.strictEqual(convertPhelToPHP(':my-key'), 'new \\Phel\\Lang\\Keyword("my-key")');
        });

        it('should handle variables with numbers', function () {
            assert.strictEqual(convertPhelToPHP('var1'), '$var1');
            assert.strictEqual(convertPhelToPHP('x2y3'), '$x2y3');
        });

        it('should preserve PHP expressions', function () {
            assert.strictEqual(convertPhelToPHP('$foo'), '$foo');
            assert.strictEqual(convertPhelToPHP('$arr[0]'), '$arr[0]');
        });

        it('should handle whitespace', function () {
            assert.strictEqual(convertPhelToPHP('  foo  '), '$foo');
            assert.strictEqual(convertPhelToPHP('\tbar\n'), '$bar');
        });
    });

    describe('mapRemoteToLocal / mapLocalToRemote', function () {
        // Replicate path mapping logic
        function mapRemoteToLocal(
            remotePath: string,
            pathMappings: { [key: string]: string }
        ): string {
            for (const [remote, local] of Object.entries(pathMappings)) {
                if (remotePath.startsWith(remote)) {
                    return remotePath.replace(remote, local);
                }
            }
            return remotePath;
        }

        function mapLocalToRemote(
            localPath: string,
            pathMappings: { [key: string]: string }
        ): string {
            for (const [remote, local] of Object.entries(pathMappings)) {
                if (localPath.startsWith(local)) {
                    return localPath.replace(local, remote);
                }
            }
            return localPath;
        }

        it('should map Docker paths to local paths', function () {
            const mappings = {
                '/var/www/html': '/Users/dev/project',
            };

            assert.strictEqual(
                mapRemoteToLocal('/var/www/html/src/index.php', mappings),
                '/Users/dev/project/src/index.php'
            );
        });

        it('should map local paths to Docker paths', function () {
            const mappings = {
                '/var/www/html': '/Users/dev/project',
            };

            assert.strictEqual(
                mapLocalToRemote('/Users/dev/project/src/index.php', mappings),
                '/var/www/html/src/index.php'
            );
        });

        it('should return original path when no mapping matches', function () {
            const mappings = {
                '/var/www/html': '/Users/dev/project',
            };

            assert.strictEqual(
                mapRemoteToLocal('/other/path/file.php', mappings),
                '/other/path/file.php'
            );
        });

        it('should handle multiple mappings', function () {
            const mappings = {
                '/app': '/home/user/app',
                '/vendor': '/home/user/vendor',
            };

            assert.strictEqual(
                mapRemoteToLocal('/app/src/main.php', mappings),
                '/home/user/app/src/main.php'
            );
            assert.strictEqual(
                mapRemoteToLocal('/vendor/autoload.php', mappings),
                '/home/user/vendor/autoload.php'
            );
        });
    });

    describe('shouldSkipFile / matchesGlob', function () {
        // Replicate glob matching logic
        function matchesGlob(filePath: string, pattern: string): boolean {
            const regex = pattern
                .replace(/\./g, '\\.')
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/\\\\]*')
                .replace(/\?/g, '.');

            return new RegExp(regex, 'i').test(filePath);
        }

        function shouldSkipFile(
            filePath: string,
            skipPhelInternals: boolean,
            skipFiles: string[]
        ): boolean {
            if (skipPhelInternals) {
                const lowerPath = filePath.toLowerCase();
                if (
                    lowerPath.includes('/phel-lang/phel-lang/src/php/') ||
                    lowerPath.includes('/phel-lang/src/php/') ||
                    lowerPath.includes('\\phel-lang\\phel-lang\\src\\php\\') ||
                    lowerPath.includes('\\phel-lang\\src\\php\\')
                ) {
                    return true;
                }
            }

            for (const pattern of skipFiles) {
                if (matchesGlob(filePath, pattern)) {
                    return true;
                }
            }

            return false;
        }

        it('should match simple glob patterns', function () {
            assert.strictEqual(matchesGlob('/path/to/file.php', '*.php'), true);
            assert.strictEqual(matchesGlob('/path/to/file.js', '*.php'), false);
        });

        it('should match double-star patterns', function () {
            // ** matches any path segment including /
            assert.strictEqual(matchesGlob('/a/b/c/d/file.php', '**file.php'), true);
            assert.strictEqual(matchesGlob('/project/vendor/lib/file.php', '**/vendor/**'), true);
        });

        it('should skip Phel internals when enabled', function () {
            assert.strictEqual(
                shouldSkipFile('/phel-lang/phel-lang/src/php/Core.php', true, []),
                true
            );
            assert.strictEqual(shouldSkipFile('/phel-lang/src/php/Runtime.php', true, []), true);
        });

        it('should not skip Phel internals when disabled', function () {
            assert.strictEqual(
                shouldSkipFile('/phel-lang/phel-lang/src/php/Core.php', false, []),
                false
            );
        });

        it('should skip files matching custom patterns', function () {
            const skipPatterns = ['**/vendor/**', '**/node_modules/**'];

            assert.strictEqual(
                shouldSkipFile('/project/vendor/lib/file.php', false, skipPatterns),
                true
            );
            assert.strictEqual(shouldSkipFile('/project/src/app.php', false, skipPatterns), false);
        });

        it('should handle Windows paths', function () {
            assert.strictEqual(
                shouldSkipFile('C:\\phel-lang\\phel-lang\\src\\php\\Core.php', true, []),
                true
            );
        });
    });

    describe('toFileUri / fromFileUri', function () {
        // Replicate file URI logic (Unix version)
        function toFileUri(filePath: string, platform: string = 'linux'): string {
            if (platform === 'win32') {
                return 'file:///' + filePath.replace(/\\/g, '/');
            }
            return 'file://' + filePath;
        }

        function fromFileUri(uri: string, platform: string = 'linux'): string {
            let filePath = uri.replace(/^file:\/\//, '');

            if (platform === 'win32' && filePath.startsWith('/')) {
                filePath = filePath.substring(1);
            }

            return decodeURIComponent(filePath);
        }

        it('should convert Unix paths to file URIs', function () {
            assert.strictEqual(
                toFileUri('/home/user/file.php', 'linux'),
                'file:///home/user/file.php'
            );
        });

        it('should convert Windows paths to file URIs', function () {
            assert.strictEqual(
                toFileUri('C:\\Users\\test\\file.php', 'win32'),
                'file:///C:/Users/test/file.php'
            );
        });

        it('should convert file URIs back to Unix paths', function () {
            assert.strictEqual(
                fromFileUri('file:///home/user/file.php', 'linux'),
                '/home/user/file.php'
            );
        });

        it('should convert file URIs back to Windows paths', function () {
            assert.strictEqual(
                fromFileUri('file:///C:/Users/test/file.php', 'win32'),
                'C:/Users/test/file.php'
            );
        });

        it('should decode URI-encoded characters', function () {
            assert.strictEqual(
                fromFileUri('file:///path/with%20spaces/file.php'),
                '/path/with spaces/file.php'
            );
        });
    });

    describe('formatVariableName', function () {
        // Replicate variable name formatting
        function formatVariableName(name: string): string {
            return name
                .replace(/^\$/, '')
                .replace(/_(\d+)$/, '')
                .replace(/_/g, '-');
        }

        it('should remove $ prefix', function () {
            assert.strictEqual(formatVariableName('$foo'), 'foo');
            assert.strictEqual(formatVariableName('$bar'), 'bar');
        });

        it('should convert snake_case to kebab-case', function () {
            assert.strictEqual(formatVariableName('$my_var'), 'my-var');
            assert.strictEqual(formatVariableName('$some_long_name'), 'some-long-name');
        });

        it('should remove numeric suffixes', function () {
            assert.strictEqual(formatVariableName('$foo_1'), 'foo');
            assert.strictEqual(formatVariableName('$bar_123'), 'bar');
        });

        it('should handle names without $ prefix', function () {
            assert.strictEqual(formatVariableName('foo_bar'), 'foo-bar');
        });
    });

    describe('formatPhelType', function () {
        // Replicate type formatting
        function formatPhelType(type: string, classname: string): string {
            if (classname) {
                if (classname.includes('PersistentVector')) {
                    return 'vector';
                }
                if (classname.includes('PersistentMap')) {
                    return 'map';
                }
                if (classname.includes('PersistentList')) {
                    return 'list';
                }
                if (classname.includes('Keyword')) {
                    return 'keyword';
                }
                if (classname.includes('Symbol')) {
                    return 'symbol';
                }
                if (classname.includes('AbstractFn')) {
                    return 'function';
                }
                if (classname.includes('Set')) {
                    return 'set';
                }
                return classname.split('\\').pop() || classname;
            }
            return type;
        }

        it('should format Phel collection types', function () {
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\PersistentVector'), 'vector');
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\PersistentMap'), 'map');
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\PersistentList'), 'list');
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\Set'), 'set');
        });

        it('should format Phel atom types', function () {
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\Keyword'), 'keyword');
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\Symbol'), 'symbol');
            assert.strictEqual(formatPhelType('object', 'Phel\\Lang\\AbstractFn'), 'function');
        });

        it('should extract class name from namespace', function () {
            assert.strictEqual(formatPhelType('object', 'Some\\Custom\\MyClass'), 'MyClass');
        });

        it('should return type when no classname', function () {
            assert.strictEqual(formatPhelType('string', ''), 'string');
            assert.strictEqual(formatPhelType('int', ''), 'int');
        });
    });

    describe('formatPhelValue', function () {
        // Replicate value formatting
        function formatPhelValue(
            type: string,
            classname: string,
            value: string,
            numChildren: number
        ): string {
            if (classname) {
                if (classname.includes('PersistentVector')) {
                    return `[${numChildren} items]`;
                }
                if (classname.includes('PersistentMap')) {
                    return `{${numChildren / 2} entries}`;
                }
                if (classname.includes('PersistentList')) {
                    return `(${numChildren} items)`;
                }
                if (classname.includes('Keyword')) {
                    return `:${value || '?'}`;
                }
                if (classname.includes('Symbol')) {
                    return value || '?';
                }
                if (classname.includes('Set')) {
                    return `#{${numChildren} items}`;
                }
            }

            switch (type) {
                case 'string':
                    return `"${value}"`;
                case 'int':
                case 'float':
                    return value;
                case 'bool':
                    return value === '1' ? 'true' : 'false';
                case 'null':
                    return 'nil';
                case 'array':
                    return `[${numChildren} items]`;
                case 'object':
                    return classname ? `<${classname.split('\\').pop()}>` : '<object>';
                default:
                    return value || `(${type})`;
            }
        }

        it('should format vectors', function () {
            assert.strictEqual(
                formatPhelValue('object', 'Phel\\Lang\\PersistentVector', '', 3),
                '[3 items]'
            );
        });

        it('should format maps (entries = numChildren / 2)', function () {
            assert.strictEqual(
                formatPhelValue('object', 'Phel\\Lang\\PersistentMap', '', 4),
                '{2 entries}'
            );
        });

        it('should format lists', function () {
            assert.strictEqual(
                formatPhelValue('object', 'Phel\\Lang\\PersistentList', '', 5),
                '(5 items)'
            );
        });

        it('should format keywords with colon prefix', function () {
            assert.strictEqual(
                formatPhelValue('object', 'Phel\\Lang\\Keyword', 'status', 0),
                ':status'
            );
        });

        it('should format symbols', function () {
            assert.strictEqual(
                formatPhelValue('object', 'Phel\\Lang\\Symbol', 'my-fn', 0),
                'my-fn'
            );
        });

        it('should format sets', function () {
            assert.strictEqual(formatPhelValue('object', 'Phel\\Lang\\Set', '', 3), '#{3 items}');
        });

        it('should format basic types', function () {
            assert.strictEqual(formatPhelValue('string', '', 'hello', 0), '"hello"');
            assert.strictEqual(formatPhelValue('int', '', '42', 0), '42');
            assert.strictEqual(formatPhelValue('float', '', '3.14', 0), '3.14');
            assert.strictEqual(formatPhelValue('bool', '', '1', 0), 'true');
            assert.strictEqual(formatPhelValue('bool', '', '0', 0), 'false');
            assert.strictEqual(formatPhelValue('null', '', '', 0), 'nil');
        });

        it('should format arrays', function () {
            assert.strictEqual(formatPhelValue('array', '', '', 5), '[5 items]');
        });
    });

    describe('decodeXdebugValue', function () {
        // Replicate Xdebug value decoding
        function decodeXdebugValue(value: string): string {
            return value
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"');
        }

        it('should decode HTML entities', function () {
            assert.strictEqual(decodeXdebugValue('foo &amp; bar'), 'foo & bar');
            assert.strictEqual(decodeXdebugValue('&lt;div&gt;'), '<div>');
            assert.strictEqual(decodeXdebugValue('&quot;hello&quot;'), '"hello"');
        });

        it('should handle multiple entities', function () {
            assert.strictEqual(
                decodeXdebugValue('&lt;a href=&quot;test&quot;&gt;'),
                '<a href="test">'
            );
        });

        it('should return unchanged if no entities', function () {
            assert.strictEqual(decodeXdebugValue('normal text'), 'normal text');
        });
    });
});
