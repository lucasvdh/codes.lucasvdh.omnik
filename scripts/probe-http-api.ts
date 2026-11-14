/**
 * Live test of OmnikHttpApi against a real inverter.
 *
 * Run with:
 *   npx tsc && node .homeybuild/scripts/probe-http-api.js <ip> [user] [password]
 */
import { OmnikHttpApi } from "../lib/omnik-http-client";

async function main() {
  const [ip, user, password] = process.argv.slice(2);
  if (!ip) {
    console.error("Usage: node probe-http-api.js <ip> [user] [password]");
    process.exit(1);
  }

  const auth = user && password ? { user, password } : undefined;
  const api = new OmnikHttpApi({ address: ip, auth });

  console.log(`→ discover ${ip}${auth ? ` with auth (${user}:***)` : " (no auth)"}`);
  const discovery = await api.discover();
  console.log(JSON.stringify(discovery, null, 2));

  console.log(`\n→ getData ${ip}`);
  const data = await api.getData();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err: unknown) => {
  console.error("✗", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
});
