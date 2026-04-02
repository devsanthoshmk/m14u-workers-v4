---
description: Comprehensive workflow instructions for developing around the M14U Capacitor + Cloudflare tunneling architecture
---

# M14U Development Workflow
This workflow instructs Antigravity on exactly how to debug, evaluate, and scaffold interactions relating to the M14U Capacitor tunneling mechanics.

## 1. Understanding M14U Listen Along
When tasked with updating or diagnosing the Listen Along feature, reference the following routing loop:
1. **Creation**: `TunnelService.kt` invokes the internal `cloudflared` android bin passing `--url localhost:8080`.
2. **Server Execution**: Native `RoomHttpServer` instances run binding `8080`, checking raw HTTP chunks for `Upgrade: websocket`.
3. **Distribution**: Cloudflare dynamically prints tunnel URLs pushed directly to Cloudflare workers KV (`m14u.sanpro.workers.dev?key=<room>`).
4. **Client Binding**: 
   - **Host (Android WebView)**: Directly binds connection via loopback `ws://127.0.0.1:8080/ws`.
   - **Guest (External Web)**: Looks up worker KV URL, replaces TCP, and connects identically to `wss://your-url.trycloudflare.com/ws`.

## 2. Debugging Network Stack Failures
- **`ERR_INTERNET_DISCONNECTED` in WebView**: Indicates the system's `fetch()` or `WebSocket` cannot break out of Android's internal sandbox proxy. Resolve this by utilizing loopback URLs for host operations where the port is naturally shared.
- **WebSocket Handshakes Failing natively**: Validate `TunnelService.kt`'s `handleWebSocketUpgrade()` logic is digesting the `sec-websocket-key` byte chunk dynamically without terminating streams early. Ensure standard `0x1` pong data sequences encode properly.

## 3. Safely Compiling Android
When any edits occur aggressively inside `./android/app/src/main/java/**/*`, execute standard gradle assemblies before assuming completion:
```bash
// turbo
cd android && ./gradlew assembleDebug
```

## 4. Scaffold UI Updates
Any React updates made directly into `src/` should be rigorously built against:
```bash
pnpm run dev
# OR for native sync bridging
pnpm run dev:android
```
Ensure Capacitor builds synchronize effectively natively via Vite dist bounds securely. Use the `listenAlongStore` to natively emit logic back to KV cleanly!
