# Install Phel

Everything the extension does beyond highlighting — diagnostics, formatting,
tests, the REPL — shells out to the Phel CLI. So a project needs Phel itself.

**Adding Phel to an existing project:**

```bash
composer require phel-lang/phel
```

Composer installs the binary at `vendor/bin/phel`, which is exactly where the
extension looks by default.

**Starting from nothing?** Skip the Composer step and use **Phel: Init Project**
instead — it scaffolds `composer.json`, `phel-config.php`, and a `src/` tree from
one of the official templates.

Either way, check it worked:

```bash
vendor/bin/phel --version
```
