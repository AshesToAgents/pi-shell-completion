# pi-shell-completion

A [pi](https://github.com/earendil-works/pi) extension that provides shell completion scripts for bash and zsh.

## Install

```bash
# Global (user-level)
pi install ssh://git@github.com/SunflowerFuchs/pi-shell-completion.git

# Project-level (shared with team via .pi/settings.json)
pi install -l ssh://git@github.com/SunflowerFuchs/pi-shell-completion.git

# Try without installing
pi -e ssh://git@github.com/SunflowerFuchs/pi-shell-completion.git
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

- **Flags** — all pi CLI flags (`--provider`, `--model`, `--thinking`, etc.)
- **Enum values** — `--provider anthropic`, `--thinking high`, `--mode json`, etc.
- **File paths** — `--export`, `--extension`, `--skill`, `--session-dir`, etc.
- **Subcommands** — `install`, `remove`, `update`, `list`, `config`

## How It Works

The extension intercepts `pi --completion <shell>` during loading and prints the completion script for the requested shell, then exits. This lets you use `eval "$(pi --completion zsh)"` in your shell config without any extra files.

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT
