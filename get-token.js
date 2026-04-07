#!/usr/bin/env node
// Usage: node get-token.js <email> <password>
// Prints GT_TOKEN and GT_REFRESH_TOKEN ready to paste into .mcp.json

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node get-token.js <email> <password>");
  process.exit(1);
}

const res = await fetch("https://api.gt-protocol.io/auth/sign_in", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

const body = await res.json();
if (!res.ok) {
  console.error("Auth failed:", body.message || JSON.stringify(body));
  process.exit(1);
}

const data = body.data ?? body;
const access = data.access_token ?? data.token;
const refresh = data.refresh_token;

if (!access) {
  console.error("No access_token in response:", JSON.stringify(body).slice(0, 300));
  process.exit(1);
}

console.log("\n✓ Tokens received. Add to .mcp.json:\n");
console.log(`"GT_TOKEN": "${access}",`);
if (refresh) console.log(`"GT_REFRESH_TOKEN": "${refresh}"`);
else console.log("(no refresh_token in response)");
console.log();
