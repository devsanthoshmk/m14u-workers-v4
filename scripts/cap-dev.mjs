#!/usr/bin/env node

/**
 * cap-dev.mjs
 *
 * Just runs cap sync + cap run.
 * The Android app fetches the tunnel URL at runtime from KV.
 */

import { execSync } from "node:child_process";

execSync("npx cap sync android && npx cap run android", { stdio: "inherit" });
