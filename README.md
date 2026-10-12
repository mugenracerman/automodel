# Auto Model

A Claude Code mod that picks the right model at the start of a conversation, then keeps the main conversation on that one model, so the prompt cache is never thrown away by switching back and forth.

## Install

Needs Claude Code 2.1.293 or newer. In a terminal session:

```
/plugin install automodel --marketplace mugenracerman/automodel
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

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
