# Hook snippets for harnesses that read hooks only from your user config

Most harnesses read Harold's hooks from files in this repository. Two read them only from the user's own configuration, so they need a one-time copy:

| Harness | Snippet | Copy into |
|---|---|---|
| Kimi Code CLI | `kimi-config.toml` | `~/.kimi-code/config.toml` (the three `[[hooks]]` blocks) |
| Hermes Agent | `hermes-config.yaml` | `~/.hermes/config.yaml` (merge the `hooks:` block), then approve each hook once or start Hermes with `--accept-hooks` |

Every command first checks that the folder the tool runs in is a Harold workspace (or that `HAROLD_ROOT` names one) and otherwise does nothing, so the hooks are safe in all your other projects. Each file's header says which event does what and where its format comes from.
