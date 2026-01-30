#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generatePKCE } from "@openauthjs/openauth/pkce";
import { MultiAuthManager, DEFAULT_CONFIG } from './multi-auth-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'opencode');
const CONFIG_FILE = path.join(CONFIG_DIR, 'multi-auth.json');

/**
 * Ensure config directory exists
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load multi-auth configuration
 */
function loadConfig() {
  ensureConfigDir();
  
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error loading config:', error.message);
    process.exit(1);
  }
}

/**
 * Save multi-auth configuration
 */
function saveConfig(config) {
  ensureConfigDir();
  
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('❌ Error saving config:', error.message);
    process.exit(1);
  }
}

/**
 * Generate authorization URL
 */
async function authorize(mode) {
  const pkce = await generatePKCE();

  const url = new URL(
    `https://${mode === "console" ? "console.anthropic.com" : "claude.ai"}/oauth/authorize`,
    import.meta.url,
  );
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "redirect_uri",
    "https://console.anthropic.com/oauth/code/callback",
  );
  url.searchParams.set(
    "scope",
    "org:create_api_key user:profile user:inference",
  );
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.verifier);
  
  return {
    url: url.toString(),
    verifier: pkce.verifier,
  };
}

/**
 * Exchange authorization code for tokens
 */
async function exchange(code, verifier) {
  const splits = code.split("#");
  const result = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      code_verifier: verifier,
    }),
  });
  
  if (!result.ok) {
    throw new Error(`Token exchange failed: ${result.status} ${result.statusText}`);
  }
  
  const json = await result.json();
  return {
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

/**
 * Add a new account
 */
async function addAccount(label) {
  console.log('🔐 Adding new Claude account...');
  
  try {
    const { url, verifier } = await authorize("max");
    
    console.log(`\n📱 Open this URL in your browser:`);
    console.log(url);
    console.log(`\n📋 After authorizing, paste the complete callback URL here:`);
    
    // Read callback URL from stdin
    const callbackUrl = await new Promise(resolve => {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', data => {
        resolve(data.trim());
      });
    });
    
    console.log('\n🔄 Exchanging authorization code for tokens...');
    const credentials = await exchange(callbackUrl, verifier);
    
    const config = loadConfig();
    const newAccount = {
      id: `account-${Date.now()}`,
      label: label || `Account ${config.accounts.length + 1}`,
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      rateLimitedUntil: null,
      mode: "max"
    };
    
    config.accounts.push(newAccount);
    saveConfig(config);
    
    console.log(`✅ Account "${newAccount.label}" added successfully!`);
    console.log(`📊 Total accounts: ${config.accounts.length}`);
    
  } catch (error) {
    console.error('❌ Error adding account:', error.message);
    process.exit(1);
  }
}

/**
 * List all accounts
 */
function listAccounts() {
  const config = loadConfig();
  
  if (config.accounts.length === 0) {
    console.log('📋 No accounts configured. Use "multi-auth add" to add your first account.');
    return;
  }
  
  console.log('📋 Connected Accounts\n');
  
  config.accounts.forEach((account, index) => {
    const isRateLimited = MultiAuthManager.isRateLimited(account);
    const isExpired = MultiAuthManager.isTokenExpired(account);
    const statusIcon = isRateLimited ? "🔴" : isExpired ? "🟡" : "🟢";
    const statusText = isRateLimited ? "rate-limited" : isExpired ? "expired" : "valid";
    const timeRemaining = MultiAuthManager.formatTimeRemaining(account.expires);
    const isCurrent = index === config.currentAccountIndex ? " (current)" : "";
    
    console.log(`${index + 1}. "${account.label}"${isCurrent} - ${statusIcon} ${statusText} (${timeRemaining} left)`);
  });
  
  console.log(`\n🔄 Auto failover: ${config.autoFailover ? '✅ Enabled' : '❌ Disabled'}`);
}

/**
 * Show detailed account information
 */
function showInfo() {
  const config = loadConfig();
  
  if (config.accounts.length === 0) {
    console.log('📋 No accounts configured.');
    return;
  }
  
  console.log('📊 Detailed Account Information\n');
  
  const status = MultiAuthManager.getAuthStatus(config);
  
  console.log(`**Summary:**`);
  console.log(`- Total accounts: ${status.totalAccounts}`);
  console.log(`- Available: ${status.availableAccounts}`);
  console.log(`- Rate-limited: ${status.rateLimitedAccounts}`);
  console.log(`- Current account: ${status.currentAccount?.label || 'None'}`);
  console.log(`- Auto failover: ${config.autoFailover ? 'Enabled' : 'Disabled'}\n`);
  
  console.log(`**Account Details:**\n`);
  
  config.accounts.forEach((account, index) => {
    const isRateLimited = MultiAuthManager.isRateLimited(account);
    const isExpired = MultiAuthManager.isTokenExpired(account);
    const statusIcon = isRateLimited ? "🔴" : isExpired ? "🟡" : "🟢";
    const isCurrent = index === config.currentAccountIndex;
    
    console.log(`${index + 1}. ${account.label} ${isCurrent ? '(current)' : ''}`);
    console.log(`   Status: ${statusIcon} ${isRateLimited ? 'Rate Limited' : isExpired ? 'Expired' : 'Valid'}`);
    console.log(`   Token expires: ${new Date(account.expires).toLocaleString()}`);
    console.log(`   Time remaining: ${MultiAuthManager.formatTimeRemaining(account.expires)}`);
    
    if (isRateLimited) {
      console.log(`   Rate limited until: ${new Date(account.rateLimitedUntil).toLocaleString()}`);
      console.log(`   Rate limit time remaining: ${MultiAuthManager.formatTimeRemaining(account.rateLimitedUntil)}`);
    }
    
    console.log(`   Mode: ${account.mode}`);
    console.log(`   Account ID: ${account.id}\n`);
  });
}

/**
 * Rename an account
 */
function renameAccount(index, newName) {
  const config = loadConfig();
  const accountIndex = parseInt(index) - 1;
  
  if (accountIndex < 0 || accountIndex >= config.accounts.length) {
    console.error('❌ Invalid account number.');
    process.exit(1);
  }
  
  const oldName = config.accounts[accountIndex].label;
  config.accounts[accountIndex].label = newName;
  saveConfig(config);
  
  console.log(`✅ Account renamed from "${oldName}" to "${newName}"`);
}

/**
 * Remove an account
 */
function removeAccount(index) {
  const config = loadConfig();
  const accountIndex = parseInt(index) - 1;
  
  if (accountIndex < 0 || accountIndex >= config.accounts.length) {
    console.error('❌ Invalid account number.');
    process.exit(1);
  }
  
  const account = config.accounts[accountIndex];
  
  // Don't allow removing the last account
  if (config.accounts.length === 1) {
    console.error('❌ Cannot remove the last account. Add another account first.');
    process.exit(1);
  }
  
  // Adjust current account index if needed
  if (config.currentAccountIndex >= accountIndex) {
    config.currentAccountIndex = Math.max(0, config.currentAccountIndex - 1);
  }
  
  config.accounts.splice(accountIndex, 1);
  saveConfig(config);
  
  console.log(`✅ Account "${account.label}" removed successfully.`);
}

/**
 * Show current status
 */
function showStatus() {
  const config = loadConfig();
  
  if (config.accounts.length === 0) {
    console.log('📋 No accounts configured.');
    return;
  }
  
  const status = MultiAuthManager.getAuthStatus(config);
  const currentAccount = status.currentAccount;
  
  console.log('🔄 Auth Status');
  
  if (currentAccount) {
    const isRateLimited = MultiAuthManager.isRateLimited(currentAccount);
    const isExpired = MultiAuthManager.isTokenExpired(currentAccount);
    const statusIcon = isRateLimited ? "🔴" : isExpired ? "🟡" : "🟢";
    const statusText = isRateLimited ? "Rate Limited" : isExpired ? "Expired" : "Valid";
    const timeRemaining = MultiAuthManager.formatTimeRemaining(currentAccount.expires);
    
    console.log(`\nCurrent Account: ${statusIcon} ${currentAccount.label} - ${statusText} (${timeRemaining})`);
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`- Total accounts: ${status.totalAccounts}`);
  console.log(`- Available: ${status.availableAccounts}`);
  console.log(`- Rate-limited: ${status.rateLimitedAccounts}`);
  console.log(`- Auto failover: ${config.autoFailover ? '✅ Enabled' : '❌ Disabled'}`);
  
  if (status.rateLimitedAccounts > 0) {
    console.log(`\n⚠️  ${status.rateLimitedAccounts} account(s) are currently rate-limited`);
  }
}

/**
 * Show help
 */
function showHelp() {
  process.stdout.write(`
🔐 Multi-Auth CLI - Claude Account Management

Usage: multi-auth <command> [options]

Commands:
  add [label]           Add a new Claude account
  list                  List all configured accounts
  info                  Show detailed account information
  rename <n> <name>     Rename account number <n>
  remove <n>            Remove account number <n>
  status                Show current authentication status
  help                  Show this help message

Examples:
  multi-auth add "Personal"           # Add account with label "Personal"
  multi-auth add                      # Add account with default label
  multi-auth list                     # List all accounts
  multi-auth rename 1 "Work"          # Rename account 1 to "Work"
  multi-auth remove 2                 # Remove account 2
  multi-auth status                   # Show current status

Configuration file: ${CONFIG_FILE}
`);
}

/**
 * Main CLI handler
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'add':
      addAccount(args[1]);
      break;
    case 'list':
      listAccounts();
      break;
    case 'info':
      showInfo();
      break;
    case 'rename':
      if (args.length < 3) {
        console.error('❌ Usage: multi-auth rename <account-number> <new-name>');
        process.exit(1);
      }
      renameAccount(args[1], args[2]);
      break;
    case 'remove':
      if (args.length < 2) {
        console.error('❌ Usage: multi-auth remove <account-number>');
        process.exit(1);
      }
      removeAccount(args[1]);
      break;
    case 'status':
      showStatus();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error('❌ Unknown command:', command);
      showHelp();
      process.exit(1);
  }
}

// Run CLI if called directly
if (process.argv[1] && process.argv[1].endsWith('multi-auth-cli.mjs')) {
  main();
}

export { addAccount, listAccounts, showInfo, renameAccount, removeAccount, showStatus, showHelp };
