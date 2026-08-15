import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const callsSource = readFileSync(
  new URL("../convex/calls.ts", import.meta.url),
  "utf8",
);
const appIndex = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("external video invites always use the public HTTPS site", () => {
  assert.match(
    callsSource,
    /const PUBLIC_INVITE_ORIGIN = "https:\/\/tokoyochet\.com";/,
  );
  assert.match(callsSource, /inviteUrl:\s*buildInviteUrl\(inviteId\)/);
  assert.doesNotMatch(
    callsSource,
    /inviteUrl:\s*buildInviteUrl\(args\.origin,\s*inviteId\)/,
  );
});

test("shared invite metadata is English rather than Japanese", () => {
  assert.match(appIndex, /<html lang="en"/);
  assert.match(appIndex, /<title>Song Jin \| Secure Communication Portal<\/title>/);
  assert.doesNotMatch(appIndex, /セキュア通信ポータル|認証済み利用者向け/);
});
