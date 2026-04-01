#!/usr/bin/env node

/**
 * dev-tunnel.mjs
 *
 * Starts Vite dev server, detects its port from stdout, creates a Cloudflare
 * Quick Tunnel via cloudflaredjs, and pushes the tunnel URL to the remote
 * KV service at techx.sanpro.workers.dev.
 */

import { spawn } from "node:child_process";
import { createTunnel } from "cloudflaredjs";

const KV_BASE = "https://m14u.sanpro.workers.dev/";
const KV_KEY = "m14u";

// ── 1. Update remote KV with the tunnel URL ──────────────────────────────────
async function updateRemoteKV(tunnelUrl) {
  const url = `${KV_BASE}?key=${KV_KEY}&value=${encodeURIComponent(tunnelUrl)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[tunnel] KV updated  → key="${KV_KEY}"  value="${tunnelUrl}"`);
  } catch (err) {
    console.error("[tunnel] Failed to update KV:", err.message);
  }
}

// ── 2. Start the Cloudflare tunnel ───────────────────────────────────────────
function startTunnel(port) {
  console.log(`[tunnel] Starting Cloudflare Quick Tunnel on port ${port}…`);

  const { startCloudflared, killChild } = createTunnel();

  const onTunnelUrl = async (url) => {
    console.log(`\n[tunnel] ──────────────────────────────────────────`);
    console.log(`[tunnel]  Tunnel URL : ${url}`);
    console.log(`[tunnel]  Static URL : ${KV_BASE}?key=${KV_KEY}`);
    console.log(`[tunnel] ──────────────────────────────────────────\n`);
    await updateRemoteKV(url);
  };

  startCloudflared({
    port,
    verbose: true,
    autoFaultDetectionAndUpdate: false,
    delay: 10000,
    afterFaultRetries: 10,
    successCallback: onTunnelUrl,
    faultCallback: () => {
      console.error("[tunnel] Tunnel failed permanently.");
    },
  }).then((url) => {
    // Library only calls successCallback on restarts, not on initial URL
    onTunnelUrl(url);
  }).catch((err) => {
    console.error("[tunnel] Initial start failed:", err.message);
  });

  // Cleanup on exit
  const cleanup = () => {
    killChild();
    process.exit();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ── 3. Spawn Vite and detect its port ────────────────────────────────────────
function startViteAndTunnel() {
  const vite = spawn("npx", ["vite"], {
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  });

  let portDetected = false;

  const detectPort = (data) => {
    const text = data.toString();
    // Vite prints lines like:  Local:   http://localhost:5173/
    const match = text.match(/Local:\s+https?:\/\/[^:]+:(\d+)/);
    if (match && !portDetected) {
      portDetected = true;
      const port = parseInt(match[1], 10);
      console.log(`[tunnel] Detected Vite on port ${port}`);
      startTunnel(port);
    }
    // Forward Vite output to the terminal
    process.stdout.write(data);
  };

  vite.stdout.on("data", detectPort);
  vite.stderr.on("data", (data) => {
    // Vite sometimes logs to stderr too
    detectPort(data);
    process.stderr.write(data);
  });

  vite.on("close", (code) => {
    console.log(`[tunnel] Vite exited with code ${code}`);
    process.exit(code ?? 0);
  });
}

startViteAndTunnel();
