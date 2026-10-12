# Auto Model

A Claude Code mod that picks the right model at the start of a conversation, then keeps the main conversation on that one model, so the prompt cache is never thrown away by switching back and forth.

## Install

Works on macOS, Windows and Linux, in the terminal and in the Claude desktop app's Code tab.

### 1. Get Claude Code 2.1.293 or newer

Check your version:

```
claude --version
```

If it is older, update it:

```
claude update
```

If `claude` is not installed yet, install it first. On macOS or Linux:

```
curl -fsSL https://claude.ai/install.sh | bash
```

On Windows (PowerShell):

```
irm https://claude.ai/install.ps1 | iex
```

### 2. Install Auto Model

Either type this inside a running `claude` session:

```
/plugin install automodel --marketplace mugenracerman/automodel
```

Answer `y` to add the marketplace, then choose the **user** scope so it loads in every session.

Or run these two commands from a terminal (Terminal on macOS, PowerShell on Windows), which do the same:

```
claude plugin marketplace add mugenracerman/automodel
claude plugin install automodel@automodel --scope user
```

A user-scope install made from the terminal also loads in the desktop app's Code tab.

### 3. Turn it on

Start a new session and type `/automodel on`, or click **Auto Model: Off** in the status bar. It starts off on every machine; the switch is remembered per machine.

### Update

```
claude plugin update automodel@automodel
```

Then start a new session, or run `/reload-plugins` in a running one.

### Uninstall

```
claude plugin uninstall automodel@automodel
```

Turn it off first (`/automodel off`) so your next session starts on the model you used before.

## Use

Auto Model starts off. Turn it on with `/automodel on`, or click **Auto Model: Off** in the status bar.

| Command | What it does |
| --- | --- |
| `/automodel on` | Starts sorting your typed prompts. |
| `/automodel off` | Stops sorting. The current session keeps its model; your next new session starts on the model you used before. |
| `/automodel status` | Shows the locked model, the level that chose it, and how many jobs went to helpers this session. |
| `/automodel repick` | Sorts your next prompt fresh, up or down. A change of model rebuilds the cache once. |

## How it decides

- **Sorting.** Before a typed prompt is sent, the smallest model in your install sorts it into `small`, `everyday`, `strong` or `strongest` (8 tokens, 4 seconds). If that fails, a guess from the prompt's words decides, `strong` when in doubt. The four levels map to the model lines your install lists (Haiku, Sonnet, Opus, Fable), stepping down when your plan lacks one.
- **When the model changes.** On the first typed prompt of a new session, and the first after `/clear` or a compaction, it picks fresh. After that the model is locked. A later prompt that sorts higher steps up once; it never steps back down in the same session. A resumed session keeps the model it had. Turning it on mid-session locks to the model already in use.
- **Helpers.** A later, smaller job that has real material to get through (files, or a long pasted text) and does not depend on the conversation gets a short note asking Claude to hand it to one helper agent on a smaller model. Short jobs stay on the locked model, which answers them from its cache.
- **Left alone.** Short replies ("yes", "keep going"), slash commands, messages sent while Claude is working, and helper agents you start yourself.
- **Picking a model by hand** (`/model`, `/config`, the app's picker) turns Auto Model off so the two never fight.

It sets the model through your `model` setting, so nothing appears in the chat; the model name in the status line is the only sign.

## Develop

```
claude plugin validate .
claude plugin test .
```

`claude --plugin-dir <this folder>` runs it from disk for one session.

## License

MIT. See [LICENSE](LICENSE).
