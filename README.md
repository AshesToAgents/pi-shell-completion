# pi-shell-completion

A [pi](https://github.com/earendil-works/pi) extension that provides shell completion scripts for bash and zsh — generated from the **live** CLI, so they never go stale.

## Install

```bash
# Global (user-level)
pi install ssh://git@github.com/AshesToAgents/pi-shell-completion.git

# Project-level (shared with team via .pi/settings.json)
pi install -l ssh://git@github.com/AshesToAgents/pi-shell-completion.git

# Try without installing
pi -e ssh://git@github.com/AshesToAgents/pi-shell-completion.git
```

## Setup

### Zsh

Add to `~/.zshrc`:

```sh
eval "$(pi --completion zsh)"
```

### Bash

Add to `~/.bashrc`:

```sh
eval "$(pi --completion bash)"
```

## What It Completes

Everything is derived from your actual pi installation at generation time:

- **Flags** — every top-level flag parsed from `pi --help`, including flags registered by your other installed extensions
- **Enums** — `--thinking off…max`, `--mode text/json/rpc`, `--tui-mode`, and tool names for `--tools`/`--exclude-tools`
- **Providers & models** — `--provider` and `--model` complete from your local model catalogs (`~/.pi/agent/models*.json`), refreshed automatically after `pi update --models`
- **Subcommands** — full depth for `install`, `remove`/`uninstall`, `update`, `list`, `config`, `auth` (incl. `print-api-key`, `print-bearer-token`, `check`), and `mcp` (incl. `add` flags like `--url`, `--env`, `--exposure`)
- **Package sources** — `pi install <TAB>` offers `npm:`, `git:`, `https://`, `ssh://` schemes plus local paths; `pi update <TAB>` also offers `self`/`pi`
- **File paths** — flags with file/dir values complete from the filesystem

## How It Works

The extension intercepts `pi --completion <shell>` during loading and prints the completion script. Scripts are **generated from live CLI data** and cached under `~/.pi/agent/cache/pi-shell-completion/`, keyed on the pi version and the mtimes of the model catalogs and settings:

- **Cache hit** — printed instantly; no added shell-startup cost
- **Stale cache** (pi upgraded, catalogs refreshed, settings changed) — the last script is served immediately and refreshed by a detached background process
- **First run** — a fast single `pi -ne --help` spawn produces an interim script, then the full-depth version is built in the background

The cache is also pre-warmed in the background on regular pi sessions, so after `pi update pi` or `pi update --models` the next shell you open is already up to date.

## Development

```bash
npm install
npm run typecheck
npm test               # unit tests + live drift test against the real pi CLI
npm run update-fixtures  # refresh fixtures/ after pi's CLI changes
```

`fixtures/` holds the current `pi --help` output. The drift test compares fixtures against the real CLI and fails with instructions when pi's flags change — parser regressions can't hide.

## License

MIT
