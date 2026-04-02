# M14U Project Rules

These are the strict architectural code rules tailored for the M14U repository. All AI assistants MUST adhere natively to this structure:

## 1. Unified Codebase (React + Capacitor)
- Ensure all frontend logic perfectly accommodates both Web and Android domains simultaneously without branching into separate components.
- The project leverages Capacitor to bundle the exact same Vite + React SPA natively onto Android `WebView`.
- Make absolute sure that browser limits (e.g. `ERR_INTERNET_DISCONNECTED`) when wrapping within WebView are safely avoided by interacting selectively against local routes (`127.0.0.1`) where native hooks run.

## 2. Listen Along State Management (Zustand)
- All shared Listen Along tracking strictly occurs inside `src/stores/listenAlongStore.ts` and `src/stores/playerStore.ts`.
- Only use standard **WebSockets (`wss://` and `ws://`)** for real-time synchronization. Never default to HTTP long-polling constraints.
- Hosts utilizing the `TunnelService` must initialize their WebSockets exactly to `ws://127.0.0.1:8080/ws` avoiding external tunnel networking loops. Guests entering via the web client exclusively fetch the tunnel link from KV and parse to `wss://<cloudflared-url>/ws`.
- Always employ an exponential backoff ping delay if websocket `onclose` invokes to allow DNS propagation buffers.

## 3. Native Android Tunneling
- Never employ Java web socket dependencies. `TunnelService.kt` and `RoomHttpServer` intercept binary TCP socket streams organically (`handleWebSocketUpgrade`).
- Maintain `cloudflared` native subprocess execution decoupled from the application lifecycle (`DevTunnelPlugin`).
- Handle KV storage pushes exclusively through `.workers.dev` edges cleanly separating state.

## 4. UI / Formatting
- Keep layout components fluid and minimalist. 
- Stick universally to standard Typescript/ES linting configuration. Avoid excessive `console.log` pollutions outside of robust lifecycle tracking (like `[ListenAlong WS] Connected`).
