import type { SessionFiles } from "../channels/whatsapp-session-files.ts";

const bytes = (n: number) => Buffer.alloc(n, 7).toString("base64");
const pair = { private: { type: "Buffer", data: bytes(32) }, public: { type: "Buffer", data: bytes(32) } };
export const sessionFixture = (): SessionFiles => [
  {
    name: "creds.json",
    text: JSON.stringify({
      registered: false,
      me: { id: "10000000000:1@s.whatsapp.net" },
      signedIdentityKey: pair,
      noiseKey: pair,
      signedPreKey: { keyPair: pair, signature: bytes(64), keyId: 1 },
      account: { accountSignatureKey: bytes(32), accountSignature: bytes(64), deviceSignature: bytes(64) },
    }),
  },
  { name: "session-contact.0.json", text: JSON.stringify({ ratchet: "initial-state" }) },
  { name: "app-state-sync-key-example=.json", text: JSON.stringify({ key: "application-state" }) },
];
