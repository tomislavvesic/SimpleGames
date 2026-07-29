const MAX_JSON_BYTES = 4096;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function cleanName(value) {
  return String(value || "Player")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18) || "Player";
}

export function validClientSecret(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value);
}

export function websocketCredentials(request, url) {
  const protocols = (request.headers.get("sec-websocket-protocol") || "")
    .split(",")
    .map((value) => value.trim());
  const valueFor = (prefix) => protocols.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  return {
    requestedId: valueFor("p.") || url.searchParams.get("player"),
    authToken: valueFor("t.") || url.searchParams.get("token"),
    ownerToken: valueFor("o.") || url.searchParams.get("owner"),
    negotiatedProtocol: protocols.includes("simple-games-v1") ? "simple-games-v1" : null,
  };
}

export async function readJson(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_JSON_BYTES) {
    throw new Error("Request too large");
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_JSON_BYTES) {
        await reader.cancel("Request too large").catch(() => {});
        throw new Error("Request too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
}

function roomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let code = "";
  while (code.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const byte of bytes) {
      if (byte < limit) code += alphabet[byte % alphabet.length];
      if (code.length === 6) break;
    }
  }
  return code;
}

export async function initializeRoom(namespace, makeConfig) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = roomCode();
    const config = makeConfig(code);
    const response = await namespace.getByName(code).fetch("https://room.internal/init", {
      method: "POST",
      body: JSON.stringify(config),
    });
    if (response.status === 201) return config;
    if (response.status !== 409) throw new Error("Could not initialize room");
  }
  throw new Error("Could not allocate a unique room code");
}

export async function allowRoomMutation(request, env, scope) {
  try {
    const address = request.headers.get("cf-connecting-ip") || "local-development";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${scope}:${address}`),
    );
    const key = [...new Uint8Array(digest)]
      .slice(0, 12)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const response = await env.LOBBY_DIRECTORY.getByName("global").fetch(
      `https://directory.internal/permit?scope=${encodeURIComponent(scope)}&key=${key}`,
      { method: "POST" },
    );
    return response.status !== 429;
  } catch {
    return true;
  }
}

export function secureAssetResponse(asset, url) {
  const secured = new Response(asset.body, asset);
  secured.headers.set("content-security-policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "));
  secured.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  secured.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (url.protocol === "https:") {
    secured.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return secured;
}
