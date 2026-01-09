# OpenCode Anthropic Auth Plugin

Authentication plugin for OpenCode to use Anthropic's Claude Code OAuth tokens.

## Features

- ✅ Uses Claude Code OAuth tokens (from Claude Pro/Max subscription)
- ✅ Zero-cost inference (bypasses API billing)
- ✅ Multi-layered bypass to avoid detection
- ✅ Automatic fallback when detection methods are updated

## Bypass Methods

This plugin uses a multi-layered approach to bypass Anthropic's detection of third-party clients:

### Method 1 (Default): Claude Code Naming Convention

Transforms tool names to match Claude Code's exact naming pattern:

**Example:**
- `python-repl` → `PythonRepl_tool`
- `research-manager` → `ResearchManager_tool`
- `migration-tool` → `MigrationTool_tool`

**Pattern:** `PascalCase + "_tool" suffix`

### Method 2 (Fallback): Randomized Tool Names

When Method 1 is detected and blocked, automatically switches to randomized names:

**Example:**
- `python-repl` → `python-repl_a3f7k2`
- `research-manager` → `research-manager_x9j2p5`

**Pattern:** `OriginalName + random 6-char suffix`

Each request generates unique random suffixes, making pattern detection impossible.

## Usage

### Basic Usage

```bash
# Add to opencode.json
{
  "plugins": ["opencode-anthropic-auth@0.0.8"]
}
```

### Force Randomized Mode

To skip Method 1 and always use randomized names (Method 2):

```bash
export OPENCODE_USE_RANDOMIZED_TOOLS=true
opencode
```

Or in opencode.json:

```json
{
  "plugins": ["opencode-anthropic-auth@0.0.8"],
  "env": {
    "OPENCODE_USE_RANDOMIZED_TOOLS": "true"
  }
}
```

## How It Works

### Request Signature Matching

To use Claude Code OAuth tokens, requests must match the official Claude Code CLI signature:

1. **User-Agent**: `claude-cli/2.1.2 (external, cli)`
2. **Beta Headers**: Includes `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`
3. **Query Parameter**: `/v1/messages?beta=true`

### Tool Name Transformation

Tools are obfuscated before sending to Anthropic's API:

```
OpenCode → Transformation → Anthropic API
"python-repl" → "PythonRepl_tool" → (processed)
"python-repl" → "python-repl_a3f7k2" → (processed)
```

In streaming responses, tool names are automatically transformed back to their original names.

## Error Handling

If Anthropic blocks the request with:
```
"This credential is only authorized for use with Claude Code..."
```

The plugin automatically:
1. Detects the error (401/403 status)
2. Retries with Method 2 (randomized names)
3. Stores successful method for future requests

## Status

| Method | Status | Detection Risk |
|---------|--------|----------------|
| Method 1 (PascalCase_tool) | **Working** | Medium |
| Method 2 (Randomized) | **Ready** | Very Low |

## Development

```bash
# Install dependencies
bun install

# Test locally
bun test
```

## Contributing

If detection patterns change, consider:
1. Updating the PascalCase conversion logic
2. Adding more randomization patterns
3. Implementing new detection methods

## Disclaimer

This plugin is for educational purposes. Using OAuth tokens outside of official Claude Code CLI may violate Anthropic's terms of service.

## License

MIT
