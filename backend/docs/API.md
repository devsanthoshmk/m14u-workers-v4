# M14U Music API — Full Reference

> **Base URL (local):** `http://localhost:4000`  
> **Base URL (production):** _set when deployed_  
> All responses are `Content-Type: application/json`.

---

## Table of Contents

1. [Health Check](#1-health-check)
2. [Search Songs](#2-search-songs)
3. [Trending / Home Feed](#3-trending--home-feed)
4. [Stream Audio Link](#4-stream-audio-link)
5. [Data Schemas](#5-data-schemas)
6. [Error Handling](#6-error-handling)
7. [Caching Behaviour](#7-caching-behaviour)
8. [Frontend Integration Guide](#8-frontend-integration-guide)
9. [WebRTC Signaling API](#9-webrtc-signaling-api)
10. [WebRTC Data Channel Protocol](#10-webrtc-data-channel-protocol)
11. [Mobile Resilience & Session Persistence](#11-mobile-resilience--session-persistence)

---

## 1. Health Check

**`GET /`**

Confirms the API server is alive. Use this to gate your UI loading state.

### Response `200 OK`

```json
{
  "message": "M14U Music API is running."
}
```

---

## 2. Search Songs

**`GET /api/search`**

Searches YouTube Music for songs matching a query. Returns enriched metadata — all fields needed to display a song card, a now-playing bar, and an album/artist detail page are included in a single call. No extra requests needed when a user taps a song.

### Query Parameters

| Parameter | Type   | Required | Description                                           |
| --------- | ------ | -------- | ----------------------------------------------------- |
| `q`       | string | ✅       | Search term — song name, artist, album, lyric snippet |

### Example Request

```
GET /api/search?q=believer
GET /api/search?q=AR+Rahman
GET /api/search?q=Blinding+Lights
```

### Response `200 OK`

Returns an **array** of Song objects.

```json
[
  {
    "type": "SONG",
    "videoId": "Kx7B-XvmFtE",
    "name": "Believer",
    "artist": {
      "name": "Imagine Dragons",
      "artistId": "UC0aXrjVxG5pZr99v77wZdPQ"
    },
    "album": {
      "name": "Evolve",
      "albumId": "MPREb_q16Gzaa1WK8"
    },
    "duration": 205,
    "thumbnails": [
      {
        "url": "https://lh3.googleusercontent.com/...=w60-h60-l90-rj",
        "width": 60,
        "height": 60
      },
      {
        "url": "https://lh3.googleusercontent.com/...=w120-h120-l90-rj",
        "width": 120,
        "height": 120
      },
      {
        "url": "https://lh3.googleusercontent.com/...=w226-h226-l90-rj",
        "width": 226,
        "height": 226
      },
      {
        "url": "https://lh3.googleusercontent.com/...=w544-h544-l90-rj",
        "width": 544,
        "height": 544
      },
      {
        "url": "https://lh3.googleusercontent.com/...=w1080-h1080-l90-rj",
        "width": 1080,
        "height": 1080
      }
    ],
    "description": "Listen to \"Believer\" by Imagine Dragons. Featured on the album \"Evolve\". Duration: 3:25.",
    "streamUrl": "/api/stream/Kx7B-XvmFtE"
  }
]
```

### Response `400 Bad Request`

```json
{ "error": "Query parameter 'q' is required" }
```

### Response `500 Internal Server Error`

```json
{ "error": "Failed to search songs" }
```

### Field Reference

| Field             | Type           | Description                                                                         |
| ----------------- | -------------- | ----------------------------------------------------------------------------------- |
| `type`            | `"SONG"`       | Always `SONG` for this endpoint                                                     |
| `videoId`         | string         | YouTube video ID — use this as the unique song key across your app                  |
| `name`            | string         | Song title                                                                          |
| `artist.name`     | string         | Primary artist display name                                                         |
| `artist.artistId` | string         | YouTube Music artist ID (can be used for future artist page APIs)                   |
| `album.name`      | string \| null | Album name — may be null for singles                                                |
| `album.albumId`   | string \| null | Album ID — may be null                                                              |
| `duration`        | number         | Duration in **seconds**                                                             |
| `thumbnails`      | Thumbnail[]    | Sorted ascending by width. Always contains `60`, `120`, `226`, `544`, `1080` sizes  |
| `description`     | string         | Pre-formatted string for meta tags and UI subtitles                                 |
| `streamUrl`       | string         | Relative path to the stream endpoint for this song — pass to `/api/stream/:videoId` |

---

## 3. Trending / Home Feed

**`GET /api/trending`**

Returns the YouTube Music home page sections (e.g. "Quick picks", "Trending", "Albums for you") filtered for a specific country and/or language. This powers your home screen.

Accepts **friendly plain-English names** — no need to look up ISO codes.

### Query Parameters

> Use **either** `q` (friendly) **or** `gl`+`hl` (raw codes). `q` takes priority.

| Parameter | Type   | Required | Default | Description                                                                             |
| --------- | ------ | -------- | ------- | --------------------------------------------------------------------------------------- |
| `q`       | string | optional | —       | Plain-English location/language: `tamil`, `india`, `usa`, `korean`, `tamil india`, etc. |
| `gl`      | string | optional | `IN`    | ISO 3166-1 alpha-2 country code (e.g. `US`, `GB`, `JP`)                                 |
| `hl`      | string | optional | `en`    | ISO 639-1 language code (e.g. `ta`, `hi`, `en`, `ko`)                                   |

### Locale Resolution Logic

The `q` parameter is parsed with this priority:

1. Multi-word country names checked first (`south korea`, `sri lanka`, `saudi arabia`)
2. Single words matched against country names (`india` → `IN`, `usa` → `US`)
3. Single words matched against language names (`tamil` → `ta`, `korean` → `ko`)
4. Raw 2-letter codes accepted (`IN`, `en`)
5. If language is resolved but country is not → country is **inferred from language** (e.g. `tamil` → `IN`)
6. Unresolved fields fall back to `IN` / `en`

### Supported Friendly Names

**Countries:**
`india`, `usa`, `uk`, `japan`, `korea`, `south korea`, `germany`, `france`, `brazil`, `canada`, `australia`, `spain`, `mexico`, `indonesia`, `russia`, `italy`, `turkey`, `pakistan`, `bangladesh`, `nigeria`, `egypt`, `sri lanka`, `nepal`, `singapore`, `malaysia`, `thailand`, `philippines`, `argentina`, `colombia`, `south africa`, `uae`, `saudi arabia`, `vietnam`, `china`, `taiwan`

**Languages:**
`tamil`, `hindi`, `telugu`, `kannada`, `malayalam`, `bengali`, `marathi`, `gujarati`, `punjabi`, `urdu`, `english`, `spanish`, `french`, `german`, `japanese`, `korean`, `portuguese`, `russian`, `arabic`, `chinese`, `italian`, `dutch`, `turkish`, `thai`, `vietnamese`, `indonesian`, `malay`, `filipino`

### Example Requests

```
GET /api/trending?q=tamil
GET /api/trending?q=india
GET /api/trending?q=tamil india
GET /api/trending?q=usa
GET /api/trending?q=korean
GET /api/trending?q=japanese
GET /api/trending?gl=US&hl=en
```

### Resolved Locale Quick Reference

| `q` value     | Resolved `gl`  | Resolved `hl` |
| ------------- | -------------- | ------------- |
| `tamil`       | IN             | ta            |
| `india`       | IN             | en            |
| `tamil india` | IN             | ta            |
| `hindi`       | IN             | hi            |
| `usa`         | US             | en            |
| `uk`          | GB             | en            |
| `korean`      | KR             | ko            |
| `japanese`    | JP             | ja            |
| `arabic`      | IN _(default)_ | ar            |

### Response `200 OK`

```json
{
  "locale": {
    "gl": "IN",
    "hl": "ta"
  },
  "sections": [
    {
      "title": "Quick picks",
      "contents": [
        {
          "type": "SONG",
          "videoId": "abc123",
          "name": "Vivegam Theme",
          "artist": {
            "name": "Anirudh Ravichander",
            "artistId": "UC..."
          },
          "album": {
            "name": "Vivegam",
            "albumId": "MPREb_..."
          },
          "duration": 210,
          "thumbnails": [
            { "url": "https://lh3.googleusercontent.com/...=w60-h60-l90-rj",    "width": 60,   "height": 60   },
            { "url": "https://lh3.googleusercontent.com/...=w120-h120-l90-rj",  "width": 120,  "height": 120  },
            { "url": "https://lh3.googleusercontent.com/...=w226-h226-l90-rj",  "width": 226,  "height": 226  },
            { "url": "https://lh3.googleusercontent.com/...=w544-h544-l90-rj",  "width": 544,  "height": 544  },
            { "url": "https://lh3.googleusercontent.com/...=w1080-h1080-l90-rj","width": 1080, "height": 1080 }
          ],
          "streamUrl": "/api/stream/abc123"
        }
      ]
    },
    {
      "title": "Albums & singles",
      "contents": [
        {
          "type": "ALBUM",
          "albumId": "MPREb_...",
          "playlistId": "OLAK5uy_...",
          "name": "Sivakasi",
          "artist": {
            "name": "Vidyasagar",
            "artistId": "UC..."
          },
          "year": 2005,
          "thumbnails": [...]
        }
      ]
    },
    {
      "title": "Recommended artists",
      "contents": [
        {
          "type": "ARTIST",
          "artistId": "UC...",
          "name": "Anirudh Ravichander",
          "thumbnails": [...]
        }
      ]
    }
  ]
}
```

### Section Content Types

Each section's `contents` array can contain any of these types — check the `type` field:

| `type`     | Key Fields                                                      | Has `streamUrl`? |
| ---------- | --------------------------------------------------------------- | ---------------- |
| `SONG`     | `videoId`, `name`, `artist`, `album`, `duration`, `thumbnails`  | ✅ Yes           |
| `ALBUM`    | `albumId`, `playlistId`, `name`, `artist`, `year`, `thumbnails` | ❌ No            |
| `ARTIST`   | `artistId`, `name`, `thumbnails`                                | ❌ No            |
| `PLAYLIST` | `playlistId`, `name`, `thumbnails`                              | ❌ No            |
| `VIDEO`    | `videoId`, `name`, `artist`, `duration`, `thumbnails`           | ✅ Yes           |

### Response `500 Internal Server Error`

```json
{ "error": "Failed to fetch trending content" }
```

---

## 4. Stream Audio Link

**`GET /api/stream/:videoId`**

Resolves a YouTube video ID to a **direct Google Video CDN audio URL** (best available audio quality). This URL can be used directly in an HTML5 `<audio>` tag or passed to any audio player library (Howler.js, Web Audio API, etc.).

> ⚠️ **Important:** Audio URLs expire in ~6 hours. The server caches them for 2 hours. For a smooth UX, fetch this URL only when the user actually plays a song, not in advance.

### Path Parameter

| Parameter | Type   | Required | Description                                                                         |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------- |
| `videoId` | string | ✅       | YouTube video ID (11-character string from `videoId` in search or trending results) |

### Example Request

```
GET /api/stream/Kx7B-XvmFtE
GET /api/stream/dQw4w9WgXcQ
```

### Response `200 OK`

```json
{
  "url": "https://rr1---sn-i5uif5t-h556.googlevideo.com/videoplayback?expire=1741111200&..."
}
```

### Response `404 Not Found`

```json
{ "error": "Audio stream not found" }
```

Possible causes: video is private, region-locked, or removed.

### Response `500 Internal Server Error`

```json
{ "error": "Failed to fetch stream link" }
```

### Using the URL in the Frontend

```html
<audio controls>
  <source src="<url from response>" type="audio/webm" />
  Your browser does not support audio.
</audio>
```

```javascript
// Fetch and play
const res = await fetch(`/api/stream/${videoId}`);
const { url } = await res.json();
const audio = new Audio(url);
audio.play();
```

---

## 5. Data Schemas

### Song Object

```ts
interface Song {
  type: "SONG";
  videoId: string; // Unique ID — use as React key, map key, etc.
  name: string; // Display title
  artist: {
    name: string;
    artistId: string;
  };
  album: {
    name: string;
    albumId: string;
  } | null;
  duration: number; // Seconds
  thumbnails: Thumbnail[]; // Always sorted smallest → largest
  description: string; // Pre-built subtitle / meta description
  streamUrl: string; // e.g. "/api/stream/Kx7B-XvmFtE"
}
```

### Thumbnail Object

```ts
interface Thumbnail {
  url: string; // Absolute lh3.googleusercontent.com URL
  width: number; // Pixel width (one of: 60, 120, 226, 544, 1080)
  height: number; // Always equals width (square)
}
```

**Thumbnail size usage guide:**

| Size   | Use case                                         |
| ------ | ------------------------------------------------ |
| `60`   | Mini player avatar, notification icon            |
| `120`  | Song list row thumbnail, search result           |
| `226`  | Song card in grid, home shelf item               |
| `544`  | Now-playing panel album art, album detail header |
| `1080` | Full-screen/hero background, blurred backdrop    |

### Trending Response Object

```ts
interface TrendingResponse {
  locale: {
    gl: string; // ISO country code that was resolved
    hl: string; // ISO language code that was resolved
  };
  sections: Section[];
}

interface Section {
  title: string;
  contents: (Song | Album | Artist | Playlist | Video)[];
}
```

### Stream Response Object

```ts
interface StreamResponse {
  url: string; // Direct Google Video CDN audio URL
}
```

### Error Object

```ts
interface ErrorResponse {
  error: string; // Human-readable error message
}
```

---

## 6. Error Handling

All endpoints follow a consistent error shape:

```json
{ "error": "Human-readable message" }
```

| HTTP Status | Meaning               | When it happens                                             |
| ----------- | --------------------- | ----------------------------------------------------------- |
| `200`       | Success               | —                                                           |
| `400`       | Bad Request           | Required query param missing (e.g. no `q` on `/api/search`) |
| `404`       | Not Found             | Video not available — private, deleted, or region-locked    |
| `500`       | Internal Server Error | YouTube Music or yt-dlp returned an unexpected response     |

### Frontend Error Handling Pattern

```javascript
async function searchSongs(query) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);

  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error); // Bubble up to your error boundary / toast
  }
  return res.json();
}
```

---

## 7. Caching Behaviour

The server uses an in-memory `node-cache` store. Identical requests within the TTL window return instantly without hitting YouTube.

| Endpoint            | Cache Key                 | TTL     | Notes                                           |
| ------------------- | ------------------------- | ------- | ----------------------------------------------- |
| `GET /api/search`   | `search-{q}`              | 1 hour  | Cached per exact query string                   |
| `GET /api/trending` | `trending-home-{gl}-{hl}` | 30 min  | Cached per resolved locale pair                 |
| `GET /api/stream`   | `stream-{videoId}`        | 2 hours | Audio CDN URLs expire ~6h; cached safely for 2h |

> Cache is **in-memory** and resets on server restart. For production, consider replacing with Redis.

---

## 8. Frontend Integration Guide

### Recommended Architecture

```
App
├── HomePage
│   ├── fetch /api/trending?q={userLocale}
│   └── Renders section shelves (songs, albums, artists)
│
├── SearchPage
│   ├── onInput → debounce → fetch /api/search?q={term}
│   └── Renders song list rows
│
└── PlayerBar (global)
    ├── Holds currently playing Song object (from search or trending)
    ├── onPlay → fetch /api/stream/{song.videoId}
    └── Passes stream URL to <audio> element
```

### Getting a Thumbnail for a Specific Size

The `thumbnails` array is always sorted ascending by `width`. Pick the best size for the context:

```javascript
function getThumbnail(thumbnails, preferredSize = 226) {
  // Find exact match or nearest larger size
  return (
    thumbnails.find((t) => t.width >= preferredSize) ||
    thumbnails[thumbnails.length - 1]
  ).url; // fallback to largest available
}

// Usage
const cardArt = getThumbnail(song.thumbnails, 226); // Grid card
const playerArt = getThumbnail(song.thumbnails, 544); // Now-playing
const heroBg = getThumbnail(song.thumbnails, 1080); // Full-screen backdrop
```

### Duration Formatting

```javascript
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}
// formatDuration(205) → "3:25"
```

### Playing a Song (End-to-End)

```javascript
let currentAudio = null;

async function playSong(song) {
  // 1. song object already has all the metadata you need for the UI
  updateNowPlayingUI(song); // name, artist, thumbnail immediately

  // 2. Fetch the stream URL only when playing
  const res = await fetch(`http://localhost:4000${song.streamUrl}`);
  if (!res.ok) throw new Error("Could not get stream URL");
  const { url } = await res.json();

  // 3. Play
  if (currentAudio) currentAudio.pause();
  currentAudio = new Audio(url);
  currentAudio.play();
}
```

### Home Screen: Rendering Sections

```javascript
// /api/trending response → { locale, sections }
const { locale, sections } = await fetch("/api/trending?q=tamil").then((r) =>
  r.json(),
);

for (const section of sections) {
  console.log(section.title); // "Quick picks", "Albums for you", etc.
  for (const item of section.contents) {
    if (item.type === "SONG") {
      // render song card — has streamUrl, thumbnails, name, artist
    } else if (item.type === "ALBUM") {
      // render album card — albumId, name, artist, year, thumbnails
    } else if (item.type === "ARTIST") {
      // render artist chip — artistId, name, thumbnails
    }
  }
}
```

### Locale Detection (UX Tip)

Let users set their region in settings, but also offer auto-detection:

```javascript
// Browser locale to ?q= value
function getDefaultLocaleQuery() {
  const lang = navigator.language || "en"; // e.g. "ta-IN", "en-US", "ko-KR"
  const parts = lang.split("-");
  const langName = new Intl.DisplayNames(["en"], { type: "language" }).of(
    parts[0],
  ); // e.g. "Tamil", "English", "Korean"
  return langName?.toLowerCase() || "english"; // → "tamil", "english", "korean"
}

fetch(`/api/trending?q=${getDefaultLocaleQuery()}`);
```

---

---

## 9. V1 Room Sync API (Polling Architecture)

Enables real-time audio sharing between devices. The backend acts as the single source of truth, storing the room state in a SQLite database. Members poll the backend to retrieve the latest state. There are no WebRTC connections or WebSockets used in this v1 architecture.

### Architecture Overview

```
┌─────────┐                 ┌──────────────┐                 ┌─────────┐
│  Peer A │   PUT /state    │   Backend    │   GET /:code    │  Peer B │
│ (Host)  │ ──── HTTP ───►  │  SQLite DB   │ ◄──── HTTP ───  │ (Member)│
└─────────┘                 └──────────────┘   polling       └─────────┘
```

**Flow:**

1. **Host** creates a room → gets a 6-character `roomCode` and initializes the room's playback `state`.
2. **Member** joins using `POST /api/v1/rooms/:code/join`.
3. **Members** repeatedly poll `GET /api/v1/rooms/:code` to fetch the updated player state and sync their local player.
4. **Host** updates the state via `PUT /api/v1/rooms/:code/state` whenever there is a change (play, pause, seek, queue update).

### Database Storage

Uses **better-sqlite3**. The DB file `v1-rooms.db` is ephemeral — rooms expire after **2 hours**, peers are dropped after **120s** of inactivity.

| Table   | Purpose                                   | Auto-Purge   |
| ------- | ----------------------------------------- | ------------ |
| `rooms` | Room codes, host info, state JSON, expiry | 2 hours      |
| `peers` | Peer membership per room + last-seen      | 120s timeout |

---

### 9.1 Create Room

**`POST /api/v1/rooms`**

Creates a new listening room and sets the initial state.

#### Request Body

| Field          | Type   | Required | Description                    |
| -------------- | ------ | -------- | ------------------------------ |
| `displayName`  | string | ✅       | Host's display name            |
| `initialState` | object | optional | Initial playback & queue state |

#### Response `201 Created`

```json
{
  "roomCode": "A7X2QP",
  "peerId": "550e8400-...",
  "expiresAt": 1741123200000,
  "message": "Room created. Share code \"A7X2QP\" with others to join."
}
```

---

### 9.2 Join Room

**`POST /api/v1/rooms/:code/join`**

#### Request Body

| Field         | Type   | Required | Description           |
| ------------- | ------ | -------- | --------------------- |
| `displayName` | string | ✅       | Member's display name |
| `peerId`      | string | optional | Re-use existing ID    |

#### Response `200 OK`

Returns the current `state` of the room immediately upon joining.

```json
{
  "roomCode": "A7X2QP",
  "peerId": "660e8400-...",
  "hostPeerId": "550e8400-...",
  "state": {
    "currentSong": { ... },
    "queue": [],
    "isPlaying": true,
    "playStartedAt": 1741123200000,
    "updatedAt": 1741123200000
  },
  "peers": [
    { "peerId": "550e...", "displayName": "Host", "isHost": true },
    { "peerId": "660e...", "displayName": "Member", "isHost": false }
  ]
}
```

---

### 9.3 Get Room State (Polling Endpoint)

**`GET /api/v1/rooms/:code?peerId=<your-peer-id>`**

Members poll this endpoint (e.g., every 4 seconds) to receive the latest queue and playback state. Including `peerId` updates the member's last-seen heartbeat.

#### Response `200 OK`

```json
{
  "roomCode": "A7X2QP",
  "hostPeerId": "550e...",
  "state": {
    "currentSong": { ... },
    "queue": [],
    "queueIndex": 0,
    "isPlaying": true,
    "repeatMode": "off",
    "isShuffled": false,
    "playStartedAt": 1741123200000,
    "updatedAt": 1741123200000
  },
  "peers": [
    { "peerId": "...", "displayName": "Host", "isHost": true, "isOnline": true }
  ]
}
```

---

### 9.4 Update Room State (Host Only)

**`PUT /api/v1/rooms/:code/state`**

Pushes the latest state from the Host to the Backend.

#### Request Body

| Field    | Type   | Required | Description      |
| -------- | ------ | -------- | ---------------- |
| `peerId` | string | ✅       | Host's peer ID   |
| `state`  | object | ✅       | New state object |

#### Response `200 OK`

```json
{ "message": "State updated successfully" }
```

---

### 9.5 Leave Room

**`POST /api/v1/rooms/:code/leave`**

Removes the peer. If the host leaves, the room is closed for everyone.

#### Request Body

| Field    | Type   | Required | Description     |
| -------- | ------ | -------- | --------------- |
| `peerId` | string | ✅       | Leaving peer ID |

---

### 9.6 Close Room (Host Only)

**`DELETE /api/v1/rooms/:code`**

Deletes the room from the backend database.

#### Request Body

| Field    | Type   | Required | Description    |
| -------- | ------ | -------- | -------------- |
| `peerId` | string | ✅       | Host's peer ID |

---

### 9.7 Register FCM Token

**`PUT /api/v1/rooms/:code/fcm-token`**

Registers or updates a peer's Firebase web push token for room events.

#### Request Body

| Field    | Type   | Required | Description         |
| -------- | ------ | -------- | ------------------- |
| `peerId` | string | ✅       | Peer ID in the room |
| `token`  | string | ✅       | FCM token           |

#### Response `200 OK`

```json
{ "message": "FCM token registered" }
```

---

### 9.8 ACK Presence / Delivery

**`POST /api/v1/rooms/:code/ack`**

Marks the peer online and records that an event has been handled.

#### Request Body

| Field     | Type   | Required | Description                         |
| --------- | ------ | -------- | ----------------------------------- |
| `peerId`  | string | ✅       | Peer ID in the room                 |
| `eventId` | string | optional | Event ID from push payload (if any) |

#### Response `200 OK`

```json
{
  "message": "ACK accepted",
  "roomCode": "ABC123",
  "peerId": "uuid",
  "eventId": "evt-uuid",
  "ackAt": 1741170000000
}
```

---

### 9.9 Host Online Check

**`GET /api/v1/rooms/:code/host-online`**

Returns host online/offline based on recent ACK activity.

#### Response `200 OK`

```json
{
  "roomCode": "ABC123",
  "hostPeerId": "uuid",
  "isHostOnline": true,
  "hostLastAckAt": 1741170000000,
  "ttlMs": 90000
}
```

---

### 9.10 Queue Update Fanout

Host `PUT /api/v1/rooms/:code/state` now also triggers member FCM data events (`type=queue_update`).

- Backend remains source of truth with full state snapshot in DB.
- FCM carries lightweight event metadata (`eventId`, `queueVersion`).
- Members fetch latest DB state and ACK handled events.

---

### 9.11 Send Client Logs

**`POST /api/v1/rooms/:code/logs`**

Allows the frontend to send sync debugging logs to the server. The logs will be saved as a JSON file in the `backend/logs` directory.

#### Request Body

| Field          | Type   | Required | Description                     |
| -------------- | ------ | -------- | ------------------------------- |
| `displayName`  | string | ✅       | Display name of the user        |
| `logs`         | array  | ✅       | Array of JSON sync log entries  |

#### Response `200 OK`

```json
{ "message": "Logs saved" }
```

---

_Last updated: 2026-03-05 · M14U Backend v1.5 (ACK Presence + FCM Room Events + Log Store)_
