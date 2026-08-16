# Debug with breakpoints in .phel

The extension bundles a debug adapter (`type: "phel"`) that translates between
`.phel` source and the compiled PHP, so breakpoints, stack traces, and stepping
all stay in your Phel files.

You need Xdebug in your PHP install:

```ini
[xdebug]
zend_extension=xdebug
xdebug.mode=debug
xdebug.start_with_request=yes
xdebug.client_port=9003
```

and a launch configuration:

```json
{
  "type": "phel",
  "request": "launch",
  "name": "Debug Phel (Listen for Xdebug)",
  "phpDebugPort": 9003
}
```

Then set a breakpoint in a `.phel` file, press <kbd>F5</kbd>, and run your code
(`vendor/bin/phel run src/main.phel`). Vectors render as `[3 items]`, hash maps
as `{:k v}`, and Phel's own runtime is stepped over by default.
