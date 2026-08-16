# Run the tests

Three ways in, all backed by `phel.test.command` (falling back to
`phel.executablePath`):

- **The Testing view** — every `deftest` in the workspace shows up as a tree you
  can run, re-run, or debug.
- **The `▶ Run test` CodeLens** above each `deftest`, and `▶ Run benchmark`
  above each `defbench`. Turn them off with `phel.tests.codeLensEnabled`.
- **Phel: Watch Tests** — `phel test --watch` in a dedicated terminal, at the
  workspace-folder root, so a save re-runs the suite.

The `▷` button in the editor title bar covers the single-file cases: **Run File**
and **Run All Tests in File**.
