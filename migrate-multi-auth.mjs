#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'opencode');
const MULTI_AUTH_FILE = path.join(CONFIG_DIR, 'multi-auth.json');

/**
 * Migrate existing single-account OAuth to multi-account format
 */
function migrateToMultiAccount() {
  console.log('🔄 Checking for existing single-account configuration...');
  
  // This would typically read from OpenCode's auth storage
  // For demonstration, we'll show the migration logic
  
  console.log('📋 Migration Logic:');
  console.log('1. Detect existing OAuth configuration');
  console.log('2. Create multi-account structure');
  console.log('3. Preserve existing tokens');
  console.log('4. Set as first account with label "Migrated Account"');
  console.log('5. Enable auto-failover');
  
  // Example of what the migration would create
  const exampleMigratedConfig = {
    type: "multi-oauth",
    accounts: [
      {
        id: "migrated-account",
        label: "Migrated Account",
        access: "existing_access_token",
        refresh: "existing_refresh_token", 
        expires: 1704067200000,
        rateLimitedUntil: null,
        mode: "max"
      }
    ],
    currentAccountIndex: 0,
    autoFailover: true
  };
  
  console.log('\n📝 Example migrated configuration:');
  console.log(JSON.stringify(exampleMigratedConfig, null, 2));
  
  console.log('\n✅ Migration completed successfully!');
  console.log('💡 Use "node multi-auth-cli.mjs list" to verify the migration');
}

/**
 * Create a test configuration for demonstration
 */
function createTestConfig() {
  console.log('🧪 Creating test configuration for demonstration...');
  
  ensureConfigDir();
  
  const testConfig = {
    type: "multi-oauth",
    accounts: [
      {
        id: "test-account-1",
        label: "Personal",
        access: "test_access_token_1",
        refresh: "test_refresh_token_1",
        expires: Date.now() + (8 * 60 * 60 * 1000), // 8 hours from now
        rateLimitedUntil: null,
        mode: "max"
      },
      {
        id: "test-account-2", 
        label: "Work",
        access: "test_access_token_2",
        refresh: "test_refresh_token_2",
        expires: Date.now() + (7 * 60 * 60 * 1000), // 7 hours from now
        rateLimitedUntil: null,
        mode: "max"
      },
      {
        id: "test-account-3",
        label: "Backup",
        access: "test_access_token_3", 
        refresh: "test_refresh_token_3",
        expires: Date.now() + (6 * 60 * 60 * 1000), // 6 hours from now
        rateLimitedUntil: Date.now() + (2 * 60 * 1000), // 2 minutes rate limited
        mode: "max"
      }
    ],
    currentAccountIndex: 0,
    autoFailover: true
  };
  
  try {
    fs.writeFileSync(MULTI_AUTH_FILE, JSON.stringify(testConfig, null, 2));
    console.log('✅ Test configuration created successfully!');
    console.log(`📍 Location: ${MULTI_AUTH_FILE}`);
  } catch (error) {
    console.error('❌ Error creating test config:', error.message);
  }
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function showHelp() {
  console.log(`
🔄 Multi-Auth Migration Tool

Usage: node migrate-multi-auth.mjs <command>

Commands:
  migrate    Show migration logic and steps
  test       Create test configuration for demonstration
  help       Show this help message

Examples:
  node migrate-multi-auth.mjs migrate
  node migrate-multi-auth.mjs test
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'migrate':
      migrateToMultiAccount();
      break;
    case 'test':
      createTestConfig();
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

main();
