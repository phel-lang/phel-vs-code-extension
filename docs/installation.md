# Installation

Requires **VS Code 1.88+**. Published on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang) under publisher `Phel-Lang`.

## Option 1 - Marketplace (recommended)

In VS Code, open the Extensions sidebar (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search for **"Phel Lang"**, click **Install**. Or from the terminal:

```bash
code --install-extension Phel-Lang.phel-lang
```

## Option 2 - Pre-built `.vsix`

Useful for offline machines or when you want a specific version.

1. Download `phel-lang-<version>.vsix` from the [releases page](https://github.com/phel-lang/phel-vs-code-extension/releases).
2. Install it:
   - **CLI:** `code --install-extension phel-lang-<version>.vsix`
   - **GUI:** Extensions sidebar → **`...`** menu → *Install from VSIX...*

## Option 3 - Build from source

Use this when you want changes from `main` that haven't been released yet.

```bash
git clone https://github.com/phel-lang/phel-vs-code-extension.git
cd phel-vs-code-extension
npm install
npm run compile
npx @vscode/vsce package        # produces phel-lang-<version>.vsix
code --install-extension phel-lang-*.vsix
```

## Option 4 - Symlink for live development

Iterate on grammar / TypeScript without rebuilding the `.vsix` each time. Pair this with <kbd>F5</kbd> from inside the cloned repo (launches an Extension Development Host with source maps).

**macOS / Linux**
```bash
cd ~/.vscode/extensions
ln -s /absolute/path/to/phel-vs-code-extension phel-lang.phel-lang-0.9.0
```

**Windows** (PowerShell, Administrator)
```powershell
cd $env:USERPROFILE\.vscode\extensions
New-Item -ItemType SymbolicLink `
    -Target "C:\absolute\path\to\phel-vs-code-extension" `
    -Path "phel-lang.phel-lang-0.9.0"
```

Restart VS Code (or run **Developer: Reload Window**) and changes to `syntaxes/`, `snippets/`, and the compiled `out/` directory pick up immediately.

## Verifying the install

Open any `.phel` file. You should see:

- Forms like `defn`, `let`, `cond`, `try` rendered as keywords.
- Inline form-comment `#_` highlighted as a comment.
- Completion suggestions when you type `re-` or `swap`.
- Hovering over a breakpoint gutter on a `.phel` line shows the compiled-PHP location (after a Phel build).

If any of those are missing, see [Troubleshooting](troubleshooting.md).
