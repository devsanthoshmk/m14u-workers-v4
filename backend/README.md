# M14U-js Backend

The M14U backend is an ExpressJS service providing music metadata and direct audio streaming links by interacting with `youtube-dl-exec` and `ytmusic-api`.

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Set up environment variables:
   Copy `.env.example` to `.env` and fill in your Firebase credentials:
   ```bash
   cp .env.example .env
   ```
3. Approve post-installation build scripts (necessary for `youtube-dl-exec` downloading `yt-dlp` binary):
   ```bash
   pnpm approve-builds
   # Select youtube-dl-exec and @biomejs/biome if prompted
   ```
3. Start the development server (runs on `http://localhost:4000` by default):
   ```bash
   pnpm run dev
   ```

### Troubleshooting

#### `pnpm: command not found`
If `pnpm` is not found, it is likely due to the NVM environment not being sourced in the shell. Use this prefix:
```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pnpm ...
```

#### Path with Spaces
The path `/home/santhoshmk/EDUCATION CONTENT/` contains a space. Always wrap commands and paths in quotes.

## Endpoints

### 1. Music Search — `GET /api/search`
Retrieves a list of songs using the YouTube Music search API, enriched with high-resolution thumbnails, a synthesized description, and a ready-to-use `streamUrl`.

| Param | Type   | Required | Description              |
|-------|--------|----------|--------------------------|
| `q`   | string | ✅       | Song title, artist, album |

**Example**: `/api/search?q=believer`

**Response fields per song:**
- `videoId`, `name`, `artist`, `album`, `duration`
- `thumbnails` — array of 60×60 up to **1080×1080** images
- `description` — e.g. `Listen to "Believer" by Imagine Dragons. Featured on the album "Evolve". Duration: 3:25.`
- `streamUrl` — e.g. `/api/stream/Kx7B-XvmFtE`

---

### 2. Trending / Home Content — `GET /api/trending`
Retrieves home sections (trending artists, albums, playlists) customised for a location and/or language.

You can pass either **raw ISO codes** or **friendly names** — or both at once.

| Param | Type   | Required | Description                                      |
|-------|--------|----------|--------------------------------------------------|
| `q`   | string | optional | Friendly location/language like `tamil`, `india`, `usa`, `korean`, or combos like `tamil india` |
| `gl`  | string | optional | ISO 3166-1 country code (e.g. `IN`, `US`, `GB`). Used if `q` is not provided. Defaults to `IN`. |
| `hl`  | string | optional | ISO 639-1 language code (e.g. `ta`, `en`, `hi`). Used if `q` is not provided. Defaults to `en`. |

**Example queries:**
| URL                                   | Resolved locale |
|---------------------------------------|-----------------|
| `/api/trending?q=tamil`               | gl=IN, hl=ta    |
| `/api/trending?q=india`               | gl=IN, hl=en    |
| `/api/trending?q=tamil india`         | gl=IN, hl=ta    |
| `/api/trending?q=usa`                 | gl=US, hl=en    |
| `/api/trending?q=korean`              | gl=KR, hl=ko    |
| `/api/trending?q=japanese`            | gl=JP, hl=ja    |
| `/api/trending?gl=US&hl=en`           | gl=US, hl=en    |

**Response shape:**
```json
{
  "locale": { "gl": "IN", "hl": "ta" },
  "sections": [ { "title": "...", "contents": [...] }, ... ]
}
```

**Supported friendly names:**

- **Countries**: india, usa, uk, japan, korea, germany, france, brazil, canada, australia, spain, mexico, indonesia, russia, italy, turkey, pakistan, bangladesh, nigeria, egypt, sri lanka, nepal, singapore, malaysia, thailand, philippines, argentina, colombia, south africa, uae, saudi arabia, vietnam, china, taiwan
- **Languages**: tamil, hindi, telugu, kannada, malayalam, bengali, marathi, gujarati, punjabi, urdu, english, spanish, french, german, japanese, korean, portuguese, russian, arabic, chinese, italian, dutch, turkish, thai, vietnamese, indonesian, malay, filipino

> **Smart defaults**: Passing just a language (e.g. `?q=tamil`) will auto-infer the country (→ India). Passing just a country (e.g. `?q=usa`) defaults the language to English.

---

### 3. Audio Stream Link — `GET /api/stream/:videoId`
Fetches the direct Google Video audio link via `youtube-dl-exec`. The returned URL can be placed straight into an HTML5 `<audio>` tag.

| Param     | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `videoId` | string | ✅       | YouTube Video ID (e.g. `dQw4w9WgXcQ`)    |

**Example**: `/api/stream/dQw4w9WgXcQ`

> **Note**: To prevent blocking due to binary path issues with whitespaces on Linux, the backend invokes `youtube-dl-exec` using a relative binary path (`node_modules/youtube-dl-exec/bin/yt-dlp`).

---

### 4. WebRTC Signaling — Room-Based Peer Connection

Enables real-time audio sharing between devices using WebRTC. The backend acts as a signaling server using HTTP polling + better-sqlite3. See [docs/API.md](docs/API.md#9-webrtc-signaling-api) for full reference.

| Endpoint                           | Method   | Description                            |
|------------------------------------|----------|----------------------------------------|
| `/api/rooms`                       | `POST`   | Create a new room (returns room code)  |
| `/api/rooms/:code/join`            | `POST`   | Join room with code + display name     |
| `/api/rooms/:code`                 | `GET`    | Get room info + peer list              |
| `/api/rooms/:code`                 | `DELETE` | Close room (host only)                 |
| `/api/rooms/:code/leave`           | `POST`   | Leave a room                           |
| `/api/rooms/:code/heartbeat`       | `POST`   | Keep-alive ping (every 10–15s)         |
| `/api/rooms/:code/signal`          | `POST`   | Send SDP/ICE to a specific peer        |
| `/api/rooms/:code/signal?peerId=X` | `GET`    | Poll pending signals for your peer     |

**Quick flow:**
1. Host: `POST /api/rooms` → gets `roomCode` + `peerId`
2. Guest: `POST /api/rooms/:code/join` → gets `peerId` + existing peers
3. Both: exchange SDP/ICE via `POST` + `GET /signal` endpoints
4. Both: heartbeat every 12s, poll signals every 1–2s during setup
5. WebRTC P2P connection established — audio flows directly between devices

---

## Caching

| Endpoint     | TTL          |
|--------------|--------------|
| `/api/search`   | 1 hour (default) |
| `/api/trending`  | 30 minutes (per locale) |
| `/api/stream`    | 2 hours      |

> WebRTC signaling data uses **better-sqlite3** (not in-memory cache). Rooms expire after 2 hours, signals after 5 minutes.

## Testing with Bruno

A Bruno collection resides inside the `test/` directory.

| Test file            | Endpoint                          |
|----------------------|-----------------------------------|
| `1_Root.bru`         | `GET /`                           |
| `2_Trending.bru`     | `GET /api/trending?q=tamil`       |
| `3_Search.bru`       | `GET /api/search?q=believer`      |
| `4_Stream.bru`       | `GET /api/stream/dQw4w9WgXcQ`     |
| `5_Trending_USA.bru` | `GET /api/trending?q=usa`         |
| `6_CreateRoom.bru`   | `POST /api/rooms`                 |
| `7_JoinRoom.bru`     | `POST /api/rooms/:code/join`      |
| `8_GetRoom.bru`      | `GET /api/rooms/:code`            |
| `9_SendSignal.bru`   | `POST /api/rooms/:code/signal`    |
| `10_PollSignals.bru` | `GET /api/rooms/:code/signal`     |
| `11_Heartbeat.bru`   | `POST /api/rooms/:code/heartbeat` |
| `12_LeaveRoom.bru`   | `POST /api/rooms/:code/leave`     |
| `13_CloseRoom.bru`   | `DELETE /api/rooms/:code`         |

> **Note:** For WebRTC tests (6–13), run `6_CreateRoom.bru` first, then replace `ROOMCD` placeholders in subsequent tests with the actual room code from the response.

To run tests via CLI:
```bash
npx @usebruno/cli run --env local
```
(Ensure the local server is running before executing.)

## Deployment

The backend is configured to be deployed on **Railway** using **Railpack**. A `railway.toml` file is included in the root of the backend directory.

### Railway Configuration
The included `railway.toml` uses Railpack version `0.17.2` to natively detect the Node.js environment and `pnpm` package manager. It automatically runs `pnpm start`.

To deploy:
1. Initialize a project on Railway (e.g., from your GitHub repository).
2. Point the root directory to `backend/` if deploying as a monorepo, or deploy this directory directly.
3. Add your Firebase credentials and any other required environment variables to the Railway environment variables dashboard.
