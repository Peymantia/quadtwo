/**
 * Quick checks for subscription URL helpers (run: npx tsx src/services/sub-url.selftest.ts)
 */
import {
  appendSubId,
  buildSubUrl,
  normalizeSubBase,
  sanitizeSubBase,
  stripTrailingClientSubId,
} from "./sub-url.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Pasted full sub URL must not keep the old client id
assert(
  normalizeSubBase("https://it.pishigaman.ir:1405/info/zdugcvix5jzv9k3v") ===
    "https://it.pishigaman.ir:1405/info/",
  "strip /info/{oldId}",
);
assert(
  appendSubId("https://it.pishigaman.ir:1405/info/zdugcvix5jzv9k3v", "e03b973bccf415a2") ===
    "https://it.pishigaman.ir:1405/info/e03b973bccf415a2",
  "no double id under /info/",
);

// Custom single-segment subPath (real 3x-ui random path) must stay
assert(
  normalizeSubBase("https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/") ===
    "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/",
  "keep custom subPath",
);
assert(
  appendSubId("https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/", "e03b973bccf415a2") ===
    "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/e03b973bccf415a2",
  "append onto custom subPath",
);

// Full URL with custom path + old id → strip id, keep path
assert(
  normalizeSubBase("https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/oldclientid99") ===
    "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/",
  "strip id after custom path",
);
assert(
  stripTrailingClientSubId("https://host/sub/abc").endsWith("/sub/") ||
    stripTrailingClientSubId("https://host/sub/abc").includes("/sub"),
  "strip after reserved root",
);

assert(sanitizeSubBase("app.piing.ir") === null, "reject bare mini-app host");
assert(sanitizeSubBase("https://host:2096/sub/") === "https://host:2096/sub/", "keep /sub/");

// Idempotent append
assert(
  appendSubId("https://host/sub/abc12345", "abc12345") === "https://host/sub/abc12345",
  "do not double-append same id",
);

// Panel subURI (real Sanaei path) must beat bad /info/ override
{
  const url = buildSubUrl(
    "e03b973bccf415a2",
    {
      subURI: "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/",
      subPath: "/zdugcvix5jzv9k3v/",
      subPort: 1405,
      subDomain: "it.pishigaman.ir",
    },
    "https://it.pishigaman.ir:1405/info/",
  );
  assert(
    url === "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/e03b973bccf415a2",
    `panel wins over /info/ override, got ${url}`,
  );
}

// Pasted full URL as override (no panel settings) must not double-id
{
  const url = buildSubUrl(
    "e03b973bccf415a2",
    {},
    "https://it.pishigaman.ir:1405/info/zdugcvix5jzv9k3v",
  );
  assert(
    url === "https://it.pishigaman.ir:1405/info/e03b973bccf415a2",
    `strip pasted id from override, got ${url}`,
  );
}

// Loopback panel subURI → allow public override
{
  const url = buildSubUrl(
    "abc12345deadbeef",
    { subURI: "http://127.0.0.1:2096/sub/" },
    "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/",
  );
  assert(
    url === "https://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/abc12345deadbeef",
    `override wins over loopback panel, got ${url}`,
  );
}

// Reconstruct from subPath when subURI empty
{
  const url = buildSubUrl("deadbeefcafebabe", {
    subPath: "/zdugcvix5jzv9k3v/",
    subPort: 1405,
    subDomain: "it.pishigaman.ir",
  });
  assert(
    url === "http://it.pishigaman.ir:1405/zdugcvix5jzv9k3v/deadbeefcafebabe",
    `reconstruct from subPath, got ${url}`,
  );
}

console.log("sub-url.selftest: ok");
