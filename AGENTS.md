# opencode-anthropic-auth

OpenCode plugin for Anthropic OAuth authentication (Claude Pro/Max).

## Testing the Plugin

### 1. Add plugin to opencode.json

Add the plugin path to the `plugins` field in your `opencode.json` (usually at `~/.config/opencode/opencode.json`):

```json
{
  "plugins": [
    "/Users/morse/Documents/GitHub/opencode-anthropic-auth/index.mjs"
  ]
}
```

### 2. Install dependencies

```bash
bun install
```

### 3. Test the plugin

Run with default plugins disabled to isolate this plugin:

```bash
OPENCODE_DISABLE_DEFAULT_PLUGINS=true opencode run --model anthropic/claude-opus-4-5 hi
```

### Expected Results

- **Success**: If the plugin works correctly, you should get a response from the model.
- **Failure**: If you see a credentials error, the plugin is not working properly.

## Features

- OAuth authentication for Claude Pro/Max subscriptions
- API key creation via Anthropic Console
- Manual API key entry
- Zero-cost tracking for Max plan users
