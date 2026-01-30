/**
 * Multi-account storage structure for OpenCode Anthropic Auth Plugin
 * 
 * This file defines the data structures and utilities for managing multiple
 * Claude accounts with automatic failover capabilities.
 */

/**
 * @typedef {Object} Account
 * @property {string} id - Unique account identifier
 * @property {string} label - User-friendly account name
 * @property {string} access - OAuth access token
 * @property {string} refresh - OAuth refresh token
 * @property {number} expires - Token expiry timestamp
 * @property {number|null} rateLimitedUntil - Timestamp when rate limit expires
 * @property {string} mode - "max" or "console"
 */

/**
 * @typedef {Object} MultiAuthConfig
 * @property {string} type - Always "multi-oauth"
 * @property {Account[]} accounts - Array of configured accounts
 * @property {number} currentAccountIndex - Index of currently active account
 * @property {boolean} autoFailover - Whether automatic failover is enabled
 */

/**
 * @typedef {Object} AuthStatus
 * @property {number} totalAccounts - Total number of configured accounts
 * @property {number} availableAccounts - Number of accounts not rate-limited
 * @property {number} rateLimitedAccounts - Number of rate-limited accounts
 * @property {Account|null} currentAccount - Currently active account
 * @property {Account[]} allAccounts - All configured accounts
 */

/**
 * Default configuration for multi-auth
 */
export const DEFAULT_CONFIG = {
  type: "multi-oauth",
  accounts: [],
  currentAccountIndex: 0,
  autoFailover: true
};

/**
 * Rate limit error response structure
 */
export const RATE_LIMIT_ERROR = {
  status: 429,
  error: "rate_limit_exceeded"
};

/**
 * Utility functions for account management
 */
export class MultiAuthManager {
  /**
   * Check if an account is currently rate-limited
   * @param {Account} account 
   * @returns {boolean}
   */
  static isRateLimited(account) {
    return account.rateLimitedUntil && Date.now() < account.rateLimitedUntil;
  }

  /**
   * Check if an account token is expired
   * @param {Account} account 
   * @returns {boolean}
   */
  static isTokenExpired(account) {
    return account.expires < Date.now();
  }

  /**
   * Get available (not rate-limited) accounts
   * @param {Account[]} accounts 
   * @returns {Account[]}
   */
  static getAvailableAccounts(accounts) {
    return accounts.filter(account => !this.isRateLimited(account));
  }

  /**
   * Format time remaining for display
   * @param {number} timestamp 
   * @returns {string}
   */
  static formatTimeRemaining(timestamp) {
    const now = Date.now();
    const remaining = Math.max(0, timestamp - now);
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Generate auth status summary
   * @param {MultiAuthConfig} config 
   * @returns {AuthStatus}
   */
  static getAuthStatus(config) {
    const availableAccounts = this.getAvailableAccounts(config.accounts);
    const rateLimitedAccounts = config.accounts.filter(account => this.isRateLimited(account));
    
    return {
      totalAccounts: config.accounts.length,
      availableAccounts: availableAccounts.length,
      rateLimitedAccounts: rateLimitedAccounts.length,
      currentAccount: config.accounts[config.currentAccountIndex] || null,
      allAccounts: config.accounts
    };
  }

  /**
   * Find next available account for failover
   * @param {MultiAuthConfig} config 
   * @param {number} currentIndex 
   * @returns {number|null}
   */
  static findNextAvailableAccount(config, currentIndex) {
    const availableAccounts = this.getAvailableAccounts(config.accounts);
    
    for (let i = 0; i < availableAccounts.length; i++) {
      const accountIndex = config.accounts.indexOf(availableAccounts[i]);
      if (accountIndex !== currentIndex) {
        return accountIndex;
      }
    }
    
    return null;
  }

  /**
   * Mark account as rate-limited
   * @param {Account} account 
   * @param {number} retryAfter - Seconds to wait before retry
   */
  static markRateLimited(account, retryAfter = 60) {
    account.rateLimitedUntil = Date.now() + (retryAfter * 1000);
  }

  /**
   * Clear rate limit for an account
   * @param {Account} account 
   */
  static clearRateLimit(account) {
    account.rateLimitedUntil = null;
  }
}
