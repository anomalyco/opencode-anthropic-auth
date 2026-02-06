import { generatePKCE } from "@openauthjs/openauth/pkce";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const LONG_CONTEXT_BETA = "context-1m-2025-08-07";

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
        if (auth.type === "oauth") {
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
          // 1M context window detection (in-memory, per session)
          // null = unknown, true = has 1M access, false = rejected
          let context1m = null;

          return {
            apiKey: "",
            /**
             * @param {any} input
             * @param {any} init
             */
            async fetch(input, init) {
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

              requestHeaders.set("authorization", `Bearer ${auth.access}`);
              requestHeaders.set(
                "user-agent",
                "claude-cli/2.1.2 (external, cli)",
              );
              requestHeaders.delete("x-api-key");

              const TOOL_PREFIX = "mcp_";
              let body = requestInit.body;
              let eligible1m = false;
              if (body && typeof body === "string") {
                try {
                  const parsed = JSON.parse(body);

                  // Check if model supports 1M context (Opus 4+, Sonnet 4+)
                  if (typeof parsed.model === "string") {
                    eligible1m = /claude-(opus|sonnet)-4/i.test(parsed.model);
                  }

                  // Sanitize system prompt - server blocks "OpenCode" string
                  // Note: (?<!\/) preserves paths like /path/to/opencode-foo
                  if (parsed.system && Array.isArray(parsed.system)) {
                    parsed.system = parsed.system.map((item) => {
                      if (item.type === "text" && item.text) {
                        return {
                          ...item,
                          text: item.text
                            .replace(/OpenCode/g, "Claude Code")
                            .replace(/(?<!\/)opencode/gi, "Claude"),
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

              // Preserve incoming beta headers while ensuring OAuth requirements
              const incomingBeta = requestHeaders.get("anthropic-beta") || "";
              let incomingBetasList = incomingBeta
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean);

              const use1m = eligible1m && context1m !== false;
              if (!use1m) {
                incomingBetasList = incomingBetasList.filter(
                  (b) => b !== LONG_CONTEXT_BETA,
                );
              }

              const requiredBetas = [
                "oauth-2025-04-20",
                "interleaved-thinking-2025-05-14",
              ];
              if (use1m) requiredBetas.push(LONG_CONTEXT_BETA);

              requestHeaders.set(
                "anthropic-beta",
                [...new Set([...requiredBetas, ...incomingBetasList])].join(","),
              );

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

              let response = await fetch(requestInput, {
                ...requestInit,
                body,
                headers: requestHeaders,
              });

              // 1M context probe: detect rejection and retry without the header
              if (
                use1m &&
                context1m !== false &&
                (response.status === 400 || response.status === 403)
              ) {
                let msg = "";
                try {
                  const json = await response.clone().json();
                  msg = (json?.error?.message || "").toLowerCase();
                } catch {
                  try {
                    msg = (await response.clone().text()).toLowerCase();
                  } catch {}
                }
                if (
                  msg.includes("long context beta") &&
                  (msg.includes("incompatible") ||
                    msg.includes("not yet available") ||
                    msg.includes("not available"))
                ) {
                  context1m = false;
                  // Rebuild headers without the 1M beta and retry
                  requestHeaders.set(
                    "anthropic-beta",
                    (requestHeaders.get("anthropic-beta") || "")
                      .split(",")
                      .map((b) => b.trim())
                      .filter((b) => b && b !== LONG_CONTEXT_BETA)
                      .join(","),
                  );
                  response = await fetch(requestInput, {
                    ...requestInit,
                    body,
                    headers: requestHeaders,
                  });
                }
              }

              // Mark 1M access confirmed on first successful eligible request
              if (response.ok && eligible1m && context1m === null) {
                context1m = true;
              }

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
            },
          };
        }

        return {};
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("max");
            return {
              url: url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => {
                const credentials = await exchange(code, verifier);
                return credentials;
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
  };
}
