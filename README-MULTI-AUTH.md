# Multi-Account Support for OpenCode Anthropic Auth

This feature adds multi-account support with automatic failover to the OpenCode Anthropic authentication plugin.

## Features

- **Multiple Accounts**: Add multiple Claude Pro/Max accounts with custom labels
- **Automatic Failover**: When one account hits rate limits (429), automatically switches to the next available account
- **Rate Limit Tracking**: Tracks which accounts are rate-limited with expiry times
- **CLI Management Tool**: Standalone CLI for account management outside of OpenCode
- **In-Session Status**: Ask the agent "what's my auth status?" to see current account information
- **Backwards Compatible**: Automatically migrates existing single-account auth to multi-account format

## Installation

1. Ensure you have the dependencies installed:
```bash
npm install
```

2. The multi-auth plugin is available in `index-multi-auth.mjs`

## CLI Tool Usage

The CLI tool allows you to manage your Claude accounts outside of OpenCode:

```bash
# Add a new account with a custom label
node multi-auth-cli.mjs add "Personal"

# Add an account with default label
node multi-auth-cli.mjs add

# List all configured accounts
node multi-auth-cli.mjs list

# Show detailed account information
node multi-auth-cli.mjs info

# Show current authentication status
node multi-auth-cli.mjs status

# Rename an account
node multi-auth-cli.mjs rename 1 "Work"

# Remove an account
node multi-auth-cli.mjs remove 2

# Show help
node multi-auth-cli.mjs help
```

## Example Output

### List Accounts
```
📋 Connected Accounts

1. "Personal" (current) - 🟢 valid (7h 56m left)
2. "Work" - 🟢 valid (7h 56m left)
3. "Backup" - 🔴 rate-limited (2m 30s left)

🔄 Auto failover: ✅ Enabled
```

### Status Check
```
🔄 Auth Status

Current Account: 🟢 Personal - Valid (7h 35m remaining)

📊 Summary:
- Total accounts: 3
- Available: 2
- Rate-limited: 1
- Auto failover: ✅ Enabled
```

## In-Session Status Tool

When using OpenCode, you can ask the agent: "what's my auth status?" and it will display a formatted table of all your accounts with their current status.

## How Automatic Failover Works

1. **Rate Limit Detection**: When a request returns a 429 status code, the plugin:
   - Parses the `retry-after` header to determine wait time
   - Marks the current account as rate-limited
   - Logs the rate limit event

2. **Account Switching**: If auto-failover is enabled:
   - Automatically switches to the next available account
   - Retries the failed request with the new account
   - Updates the current account index in storage

3. **Token Refresh**: Automatically refreshes expired tokens before making requests

4. **Fallback**: If all accounts are rate-limited, returns an appropriate error message

## Configuration Storage

Accounts are stored in `~/.config/opencode/multi-auth.json`:

```json
{
  "type": "multi-oauth",
  "accounts": [
    {
      "id": "account-1234567890",
      "label": "Personal",
      "access": "oauth_access_token",
      "refresh": "oauth_refresh_token",
      "expires": 1704067200000,
      "rateLimitedUntil": null,
      "mode": "max"
    }
  ],
  "currentAccountIndex": 0,
  "autoFailover": true
}
```

## Migration from Single Account

When you first add a multi-account, the system automatically:
1. Detects existing single-account OAuth configuration
2. Migrates it to the multi-account format
3. Preserves all existing tokens and settings

## File Structure

```
├── index-multi-auth.mjs     # Enhanced plugin with multi-account support
├── multi-auth-cli.mjs       # Standalone CLI tool
├── multi-auth-config.js     # Configuration and utility functions
├── index.mjs               # Original single-account plugin (unchanged)
└── package.json            # Updated with "type": "module"
```

## Testing

1. Test the CLI tool:
```bash
node multi-auth-cli.mjs help
node multi-auth-cli.mjs list
```

2. Test the plugin integration by using it with OpenCode

3. Test automatic failover by triggering rate limits (or simulating them)

## Security Considerations

- All tokens are stored locally in the user's config directory
- Tokens are automatically refreshed when expired
- Rate limit information is tracked locally
- No account information is shared externally

## Backwards Compatibility

The plugin maintains full backwards compatibility:
- Existing single-account setups continue to work
- Automatic migration when adding first multi-account
- Fallback to original behavior if no multi-account config exists

## Contributing

This implementation is designed to be beginner-friendly for GSoC contributors:
- Clear separation of concerns
- Well-documented functions
- Modular architecture
- Comprehensive error handling
