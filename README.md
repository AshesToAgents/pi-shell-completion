# pi-completion

Shell completion scripts for [pi](https://github.com/mariozechner/pi-coding-agent), delivered as a pi extension. Supports bash and zsh.

## Installation

```sh
pi install path/to/pi-completion
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

## What it completes

- **Flags**: all pi CLI flags (`--provider`, `--model`, `--thinking`, etc.)
- **Enum values**: `--provider anthropic`, `--thinking high`, `--mode json`, etc.
- **File paths**: `--export`, `--extension`, `--skill`, `--session-dir`, etc.
- **Subcommands**: `install`, `remove`, `update`, `list`, `config`

## How it works

The extension intercepts `pi --completion <shell>` during loading and prints the completion script for the requested shell, then exits. This lets you use `eval "$(pi --completion zsh)"` in your shell config without any extra files.
