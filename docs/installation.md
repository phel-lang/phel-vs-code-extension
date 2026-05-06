# Installation

Requires **VS Code 1.75+**.

> **Note:** Marketplace publication is in progress. Once published under publisher [`chemaclass`](https://marketplace.visualstudio.com/manage/publishers/chemaclass), `code --install-extension chemaclass.phel-lang` will work. Until then, use one of the paths below.

## Option 1 — Pre-built `.vsix` (recommended)

Each tagged release publishes a `.vsix` you can install directly.

1. Download the latest `phel-lang-<version>.vsix` from the [releases page](https://github.com/phel-lang/phel-vs-code-extension/releases).
2. Install it:
   - **CLI:** `code --install-extension phel-lang-<version>.vsix`
   - **GUI:** Extensions sidebar → **`...`** menu → *Install from VSIX...*

## Option 2 — Build from source

Use this when you want changes from `main` that haven't been released yet.

```bash
git clone https://github.com/phel-lang/phel-vs-code-extension.git
cd phel-vs-code-extension
npm install
npm run compile
npx @vscode/vsce package        # produces phel-lang-<version>.vsix
code --install-extension phel-lang-*.vsix
```

## Option 3 — Symlink for live development

Iterate on grammar / TypeScript without rebuilding the `.vsix` each time. Pair this with <kbd>F5</kbd> from inside the cloned repo (launches an Extension Development Host with source maps).

**macOS / Linux**
```bash
cd ~/.vscode/extensions
ln -s /absolute/path/to/phel-vs-code-extension phel-lang.phel-lang-0.5.0
```

**Windows** (PowerShell, Administrator)
```powershell
cd $env:USERPROFILE\.vscode\extensions
New-Item -ItemType SymbolicLink `
    -Target "C:\absolute\path\to\phel-vs-code-extension" `
    -Path "phel-lang.phel-lang-0.5.0"
```

Restart VS Code (or run **Developer: Reload Window**) and changes to `syntaxes/`, `snippets/`, and the compiled `out/` directory pick up immediately.

## Verifying the install

Open any `.phel` file. You should see:

- Forms like `defn`, `let`, `cond`, `try` rendered as keywords.
- Inline form-comment `#_` highlighted as a comment.
- Completion suggestions when you type `re-` or `swap`.
- Hovering over a breakpoint gutter on a `.phel` line shows the compiled-PHP location (after a Phel build).

If any of those are missing, see [Troubleshooting](troubleshooting.md).
