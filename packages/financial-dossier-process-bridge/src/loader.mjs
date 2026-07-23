import { closeSync, readFileSync } from "node:fs";

const TARGET_MODULE_FD = 3;
let bytes;
try {
  bytes = readFileSync(TARGET_MODULE_FD);
} finally {
  closeSync(TARGET_MODULE_FD);
}
await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
