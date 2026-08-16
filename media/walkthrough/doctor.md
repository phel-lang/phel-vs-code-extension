# Check your setup

**Phel: Doctor (check project health)** runs `phel doctor` and streams the
output — plus the exit code — into the **Phel Doctor** output channel. It is the
fastest way to find out whether the CLI, `phel-config.php`, and the cache
directory all agree with each other.

Two neighbours worth knowing:

- **Phel: Show Effective Configuration** opens `phel config --format=json`
  pretty-printed in a tab, so you can see what the CLI actually resolved.
- **Phel: Lint Workspace** walks the configured source dirs and fills the
  Problems panel for every file, including ones you never opened.

If Doctor cannot find the binary at all, go back and set
`phel.executablePath`.
