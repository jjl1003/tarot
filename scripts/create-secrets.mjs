import { randomBytes } from "node:crypto";
console.log(
  "TAROT_INVITE_CODES=" +
    JSON.stringify([randomBytes(24).toString("base64url")]),
);
console.log("TAROT_SESSION_SECRET=" + randomBytes(48).toString("base64url"));
