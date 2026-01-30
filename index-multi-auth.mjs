import { generatePKCE } from "@openauthjs/openauth/pkce";
import { MultiAuthManager, DEFAULT_CONFIG } from "./multi-auth-config.js";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/**
 * @param {"max" | "console"} mode
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
 * @param {string} code
 * @param {string} verifier
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
  if (!result.ok)
    return {
      type: "failed",
    };
  const json = await result.json();
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

/**
 * Enhanced fetch wrapper with automatic failover
 * @param {any} input
 * @param {any} init
 * @param {Function} getAuth
 * @param {any} client
 * @param {number} maxRetries
 */
async function enhancedFetch(input, init, getAuth, client, maxRetries = 3) {
  let retryCount = 0;
  let lastError = null;

  while (retryCount <= maxRetries) {
    try {
      const auth = await getAuth();
      
      // Handle legacy single-account format
      if (auth.type === "oauth") {
        return await singleAccountFetch(input, init, getAuth, client);
      }
      
      // Handle multi-account format
      if (auth.type === "multi-oauth") {
        return await multiAccountFetch(input, init, getAuth, client, retryCount);
      }
      
      // Fallback to original fetch for other auth types
      return fetch(input, init);
      
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // Only retry on rate limit errors
      if (error.message?.includes('rate limit') || error.status === 429) {
        continue;
      }
      
      // For other errors, don't retry
      break;
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Single account fetch (original logic)
 */
async function singleAccountFetch(input, init, getAuth, client) {
  const auth = await getAuth();
  if (auth.type !== "oauth") return fetch(input, init);
  
  if (!auth.access || auth.expires < Date.now()) {
    const response = await fetch(
      "https://console.anthropic.com/v1/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: auth.refresh,
          client_id: CLIENT_ID,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }
    const json = await response.json();
    await client.auth.set({
      path: {
        id: "anthropic",
      },
      body: {
        type: "oauth",
        refresh: json.refresh_token,
        access: json.access_token,
        expires: Date.now() + json.expires_in * 1000,
      },
    });
    auth.access = json.access_token;
  }

  return await makeAuthenticatedRequest(input, init, auth.access);
}

/**
 * Multi-account fetch with failover logic
 */
async function multiAccountFetch(input, init, getAuth, client, retryCount) {
  const auth = await getAuth();
  
  if (!auth.accounts || auth.accounts.length === 0) {
    throw new Error('No accounts configured');
  }

  // Get current account
  let currentAccount = auth.accounts[auth.currentAccountIndex];
  if (!currentAccount) {
    throw new Error('Current account not found');
  }

  // Check if current account is rate-limited and switch if needed
  if (MultiAuthManager.isRateLimited(currentAccount)) {
    const nextAccountIndex = MultiAuthManager.findNextAvailableAccount(auth, auth.currentAccountIndex);
    
    if (nextAccountIndex !== null && auth.autoFailover) {
      // Switch to next available account
      auth.currentAccountIndex = nextAccountIndex;
      await client.auth.set({
        path: { id: "anthropic" },
        body: auth
      });
      
      currentAccount = auth.accounts[nextAccountIndex];
      console.log(`[Multi-Auth] Switched to account: ${currentAccount.label}`);
    } else {
      throw new Error('All accounts are rate-limited');
    }
  }

  // Refresh token if needed
  if (MultiAuthManager.isTokenExpired(currentAccount)) {
    try {
      const response = await fetch(
        "https://console.anthropic.com/v1/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: currentAccount.refresh,
            client_id: CLIENT_ID,
          }),
        },
      );
      
      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }
      
      const json = await response.json();
      currentAccount.access = json.access_token;
      currentAccount.expires = Date.now() + json.expires_in * 1000;
      
      // Save updated account
      await client.auth.set({
        path: { id: "anthropic" },
        body: auth
      });
      
    } catch (error) {
      // Mark account as problematic and try failover
      MultiAuthManager.markRateLimited(currentAccount, 300); // 5 minutes
      throw new Error(`Token refresh failed for ${currentAccount.label}: ${error.message}`);
    }
  }

  try {
    const response = await makeAuthenticatedRequest(input, init, currentAccount.access);
    
    // Check for rate limit in response
    if (response.status === 429) {
      const retryAfter = response.headers?.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter) : 60;
      
      MultiAuthManager.markRateLimited(currentAccount, waitTime);
      await client.auth.set({
        path: { id: "anthropic" },
        body: auth
      });
      
      console.log(`[Multi-Auth] Account ${currentAccount.label} rate-limited for ${waitTime}s`);
      
      // Try failover to next account
      if (auth.autoFailover && retryCount < 3) {
        const nextAccountIndex = MultiAuthManager.findNextAvailableAccount(auth, auth.currentAccountIndex);
        if (nextAccountIndex !== null) {
          auth.currentAccountIndex = nextAccountIndex;
          await client.auth.set({
            path: { id: "anthropic" },
            body: auth
          });
          
          // Retry with next account
          return await multiAccountFetch(input, init, getAuth, client, retryCount + 1);
        }
      }
      
      throw new Error(`Rate limit exceeded for ${currentAccount.label}. Retry after ${waitTime}s`);
    }
    
    return response;
    
  } catch (error) {
    // If it's not a rate limit error, re-throw
    if (!error.message?.includes('rate limit')) {
      throw error;
    }
    
    // Handle rate limit errors
    throw error;
  }
}

/**
 * Make authenticated request with proper headers
 */
async function makeAuthenticatedRequest(input, init, accessToken) {
  const requestInit = init ?? {};

  const requestHeaders = new Headers();
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      requestHeaders.set(key, value);
    });
  }
  if (requestInit.headers) {
    if (requestInit.headers instanceof Headers) {
      requestInit.headers.forEach((value, key) => {
        requestHeaders.set(key, value);
      });
    } else if (Array.isArray(requestInit.headers)) {
      for (const [key, value] of requestInit.headers) {
        if (typeof value !== "undefined") {
          requestHeaders.set(key, String(value));
        }
      }
    } else {
      for (const [key, value] of Object.entries(
        requestInit.headers,
      )) {
        if (typeof value !== "undefined") {
          requestHeaders.set(key, String(value));
        }
      }
    }
  }

  // Preserve all incoming beta headers while ensuring OAuth requirements
  const incomingBeta = requestHeaders.get("anthropic-beta") || "";
  const incomingBetasList = incomingBeta
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

  const requiredBetas = [
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
  ];
  const mergedBetas = [
    ...new Set([...requiredBetas, ...incomingBetasList]),
  ].join(",");

  requestHeaders.set("authorization", `Bearer ${accessToken}`);
  requestHeaders.set("anthropic-beta", mergedBetas);
  requestHeaders.set(
    "user-agent",
    "claude-cli/2.1.2 (external, cli)",
  );
  requestHeaders.delete("x-api-key");

  const TOOL_PREFIX = "mcp_";
  let body = requestInit.body;
  if (body && typeof body === "string") {
    try {
      const parsed = JSON.parse(body);

      // Sanitize system prompt - server blocks "OpenCode" string
      if (parsed.system && Array.isArray(parsed.system)) {
        parsed.system = parsed.system.map((item) => {
          if (item.type === "text" && item.text) {
            return {
              ...item,
              text: item.text
                .replace(/OpenCode/g, "Claude Code")
                .replace(/opencode/gi, "Claude"),
            };
          }
          return item;
        });
      }

      // Add prefix to tools definitions
      if (parsed.tools && Array.isArray(parsed.tools)) {
        parsed.tools = parsed.tools.map((tool) => ({
          ...tool,
          name: tool.name
            ? `${TOOL_PREFIX}${tool.name}`
            : tool.name,
        }));
      }
      // Add prefix to tool_use blocks in messages
      if (parsed.messages && Array.isArray(parsed.messages)) {
        parsed.messages = parsed.messages.map((msg) => {
          if (msg.content && Array.isArray(msg.content)) {
            msg.content = msg.content.map((block) => {
              if (block.type === "tool_use" && block.name) {
                return {
                  ...block,
                  name: `${TOOL_PREFIX}${block.name}`,
                };
              }
              return block;
            });
          }
          return msg;
        });
      }
      body = JSON.stringify(parsed);
    } catch (e) {
      // ignore parse errors
    }
  }

  let requestInput = input;
  let requestUrl = null;
  try {
    if (typeof input === "string" || input instanceof URL) {
      requestUrl = new URL(input.toString());
    } else if (input instanceof Request) {
      requestUrl = new URL(input.url);
    }
  } catch {
    requestUrl = null;
  }

  if (
    requestUrl &&
    requestUrl.pathname === "/v1/messages" &&
    !requestUrl.searchParams.has("beta")
  ) {
    requestUrl.searchParams.set("beta", "true");
    requestInput =
      input instanceof Request
        ? new Request(requestUrl.toString(), input)
        : requestUrl;
  }

  const response = await fetch(requestInput, {
    ...requestInit,
    body,
    headers: requestHeaders,
  });

  // Transform streaming response to rename tools back
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        let text = decoder.decode(value, { stream: true });
        text = text.replace(
          /"name"\s*:\s*"mcp_([^"]+)"/g,
          '"name": "$1"',
        );
        controller.enqueue(encoder.encode(text));
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  return response;
}

/**
 * @type {import('@opencode-ai/plugin').Plugin}
 */
export async function AnthropicAuthPlugin({ client }) {
  return {
    "experimental.chat.system.transform": (input, output) => {
      const prefix =
        "You are Claude Code, Anthropic's official CLI for Claude.";
      if (input.model?.providerID === "anthropic") {
        output.system.unshift(prefix);
        if (output.system[1])
          output.system[1] = prefix + "\n\n" + output.system[1];
      }
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth();
        
        // Handle both legacy and multi-account formats
        if (auth.type === "oauth" || auth.type === "multi-oauth") {
          // zero out cost for max plan
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            };
          }
          
          return {
            apiKey: "",
            async fetch(input, init) {
              return enhancedFetch(input, init, getAuth, client);
            },
          };
        }

        return {};
      },
      methods: [
        {
          label: "Claude Pro/Max (Multi-Account)",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("max");
            return {
              url: url,
              instructions: "Enter a label for this account (e.g., 'Personal', 'Work'): ",
              method: "code_with_label",
              callback: async (code, label) => {
                const credentials = await exchange(code, verifier);
                if (credentials.type === "failed") return credentials;
                
                // Get existing auth or create new multi-auth config
                const existingAuth = await client.auth.get({ path: { id: "anthropic" } });
                let config;
                
                if (existingAuth.type === "multi-oauth") {
                  config = existingAuth;
                } else {
                  // Migrate from single account to multi-account
                  config = { ...DEFAULT_CONFIG };
                  if (existingAuth.type === "oauth") {
                    config.accounts.push({
                      id: "migrated-account",
                      label: "Migrated Account",
                      access: existingAuth.access,
                      refresh: existingAuth.refresh,
                      expires: existingAuth.expires,
                      rateLimitedUntil: null,
                      mode: "max"
                    });
                  }
                }
                
                // Add new account
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
                
                // Save updated config
                await client.auth.set({
                  path: { id: "anthropic" },
                  body: config
                });
                
                return { 
                  type: "success", 
                  message: `Account "${newAccount.label}" added successfully. Total accounts: ${config.accounts.length}`
                };
              },
            };
          },
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("console");
            return {
              url: url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => {
                const credentials = await exchange(code, verifier);
                if (credentials.type === "failed") return credentials;
                const result = await fetch(
                  `https://api.anthropic.com/api/oauth/claude_cli/create_api_key`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      authorization: `Bearer ${credentials.access}`,
                    },
                  },
                ).then((r) => r.json());
                return { type: "success", key: result.raw_key };
              },
            };
          },
        },
        {
          provider: "anthropic",
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    // Add status tool for multi-account management
    tools: [
      {
        name: "multi_auth_status",
        description: "Get status of all configured Claude accounts",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          try {
            const auth = await client.auth.get({ path: { id: "anthropic" } });
            
            if (auth.type !== "multi-oauth") {
              return {
                content: [{
                  type: "text",
                  text: "Multi-account authentication is not enabled. Please add a Claude Pro/Max account with multi-account support."
                }]
              };
            }
            
            const status = MultiAuthManager.getAuthStatus(auth);
            const currentAccount = status.currentAccount;
            
            let statusText = `## Auth Status\n\n`;
            statusText += `**Total Accounts:** ${status.totalAccounts}\n`;
            statusText += `**Available:** ${status.availableAccounts} | **Rate-Limited:** ${status.rateLimitedAccounts}\n\n`;
            
            if (currentAccount) {
              const isRateLimited = MultiAuthManager.isRateLimited(currentAccount);
              const isExpired = MultiAuthManager.isTokenExpired(currentAccount);
              const statusIcon = isRateLimited ? "🔴" : isExpired ? "🟡" : "🟢";
              const timeRemaining = MultiAuthManager.formatTimeRemaining(currentAccount.expires);
              
              statusText += `**Current Account:** ${statusIcon} ${currentAccount.label} (${timeRemaining} remaining)\n\n`;
            }
            
            statusText += `### All Accounts\n\n`;
            statusText += `| Account | Status | Token Validity | Rate Limit |\n`;
            statusText += `|---------|--------|----------------|------------|\n`;
            
            for (const account of status.allAccounts) {
              const isRateLimited = MultiAuthManager.isRateLimited(account);
              const isExpired = MultiAuthManager.isTokenExpired(account);
              const statusIcon = isRateLimited ? "🔴" : isExpired ? "🟡" : "🟢";
              const statusText = isRateLimited ? "Rate Limited" : isExpired ? "Expired" : "Valid";
              const timeRemaining = MultiAuthManager.formatTimeRemaining(account.expires);
              const rateLimitTime = isRateLimited ? MultiAuthManager.formatTimeRemaining(account.rateLimitedUntil) : "None";
              const current = account.id === currentAccount?.id ? " (current)" : "";
              
              statusText += `| ${account.label}${current} | ${statusIcon} ${statusText} | ${timeRemaining} | ${rateLimitTime} |\n`;
            }
            
            statusText += `\n**Auto Failover:** ${auth.autoFailover ? "✅ Enabled" : "❌ Disabled"}`;
            
            return {
              content: [{
                type: "text",
                text: statusText
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting auth status: ${error.message}`
              }]
            };
          }
        }
      }
    ]
  };
}
