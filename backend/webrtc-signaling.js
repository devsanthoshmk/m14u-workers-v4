/**
 * WebRTC Signaling Module — Room-based peer connection via HTTP polling + better-sqlite3
 *
 * Architecture:
 *   1. Rooms are created with a short alphanumeric code (e.g. "A7X2QP")
 *   2. Peers register themselves in a room (creator = host, joiners = guests)
 *   3. Signaling data (SDP offers/answers + ICE candidates) are exchanged through
 *      the backend using HTTP polling — no WebSocket needed.
 *   4. Stale rooms and signaling data are automatically purged on a configurable interval.
 *
 * Database Tables:
 *   - rooms: { id, code, host_peer_id, created_at, expires_at }
 *   - peers: { id, room_id, peer_id, display_name, joined_at, last_seen }
 *   - signals: { id, room_id, from_peer, to_peer, type, payload, created_at, consumed }
 */

import { Router } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const ROOM_CODE_LENGTH = 6;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;          // 2 hours
const PEER_TIMEOUT_MS = 120 * 1000;               // 120 s — generous for mobile backgrounding
const SIGNAL_TTL_MS = 5 * 60 * 1000;              // 5 min – stale signals are purged
const CLEANUP_INTERVAL_MS = 30 * 1000;            // purge sweep every 30 s

// ─────────────────────────────────────────────────────────────────────────────
// Database Init
// ─────────────────────────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, 'webrtc-signaling.db');
const db = new Database(dbPath);

// WAL mode for better concurrent read/write perf
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    host_peer   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS peers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    peer_id      TEXT    NOT NULL,
    display_name TEXT    NOT NULL DEFAULT 'Anonymous',
    joined_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_seen    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(room_id, peer_id)
  );

  CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_peer  TEXT    NOT NULL,
    to_peer    TEXT    NOT NULL,
    type       TEXT    NOT NULL CHECK(type IN ('offer','answer','ice-candidate')),
    payload    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    consumed   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_code       ON rooms(code);
  CREATE INDEX IF NOT EXISTS idx_rooms_expires     ON rooms(expires_at);
  CREATE INDEX IF NOT EXISTS idx_peers_room        ON peers(room_id);
  CREATE INDEX IF NOT EXISTS idx_signals_to_peer   ON signals(room_id, to_peer, consumed);
  CREATE INDEX IF NOT EXISTS idx_signals_created   ON signals(created_at);
`);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a short uppercase alphanumeric room code */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O, 1/I
    let code = '';
    const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

/** Generate a v4-style peer ID */
function generatePeerId() {
    return crypto.randomUUID();
}

/** Timestamp in ms */
function now() {
    return Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepared Statements (precompiled for perf)
// ─────────────────────────────────────────────────────────────────────────────

const stmts = {
    insertRoom: db.prepare(`INSERT INTO rooms (code, host_peer, expires_at) VALUES (?, ?, ?)`),
    findRoomByCode: db.prepare(`SELECT * FROM rooms WHERE code = ?`),
    findRoomById: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
    deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),
    deleteExpiredRooms: db.prepare(`DELETE FROM rooms WHERE expires_at < ?`),

    insertPeer: db.prepare(`INSERT OR IGNORE INTO peers (room_id, peer_id, display_name, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)`),
    findPeersInRoom: db.prepare(`SELECT peer_id, display_name, joined_at, last_seen FROM peers WHERE room_id = ?`),
    findPeerById: db.prepare(`SELECT * FROM peers WHERE room_id = ? AND peer_id = ?`),
    updatePeerHeartbeat: db.prepare(`UPDATE peers SET last_seen = ? WHERE room_id = ? AND peer_id = ?`),
    // Upsert: re-insert peer if they were evicted during a reload (120s mobile background)
    upsertPeer: db.prepare(`INSERT INTO peers (room_id, peer_id, display_name, joined_at, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, peer_id) DO UPDATE SET last_seen = excluded.last_seen`),
    removePeer: db.prepare(`DELETE FROM peers WHERE room_id = ? AND peer_id = ?`),
    removeStalePeers: db.prepare(`DELETE FROM peers WHERE last_seen < ?`),
    countPeersInRoom: db.prepare(`SELECT COUNT(*) AS count FROM peers WHERE room_id = ?`),

    insertSignal: db.prepare(`INSERT INTO signals (room_id, from_peer, to_peer, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    pollSignals: db.prepare(`SELECT id, from_peer, to_peer, type, payload, created_at FROM signals WHERE room_id = ? AND to_peer = ? AND consumed = 0 ORDER BY created_at ASC`),
    consumeSignals: db.prepare(`UPDATE signals SET consumed = 1 WHERE id = ?`),
    deleteStaleSignals: db.prepare(`DELETE FROM signals WHERE created_at < ? OR consumed = 1`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup Sweep (runs in-process timer)
// ─────────────────────────────────────────────────────────────────────────────

const cleanupSweep = db.transaction(() => {
    const ts = now();
    stmts.deleteExpiredRooms.run(ts);
    stmts.removeStalePeers.run(ts - PEER_TIMEOUT_MS);
    stmts.deleteStaleSignals.run(ts - SIGNAL_TTL_MS);
});

const cleanupTimer = setInterval(() => {
    try { cleanupSweep(); } catch { /* swallow – db might be closed during shutdown */ }
}, CLEANUP_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => { clearInterval(cleanupTimer); db.close(); });
process.on('SIGINT', () => { clearInterval(cleanupTimer); db.close(); });

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── POST /api/rooms — Create a new room ─────────────────────────────────────
router.post('/rooms', (req, res) => {
    const { displayName } = req.body;
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        return res.status(400).json({ error: 'displayName is required (non-empty string)' });
    }

    const code = generateRoomCode();
    const peerId = generatePeerId();
    const expiresAt = now() + ROOM_TTL_MS;

    try {
        const result = stmts.insertRoom.run(code, peerId, expiresAt);
        const roomId = result.lastInsertRowid;
        const ts = now();
        stmts.insertPeer.run(roomId, peerId, displayName.trim(), ts, ts);

        res.status(201).json({
            roomCode: code,
            peerId,
            expiresAt,
            message: `Room created. Share code "${code}" with others to join.`,
        });
    } catch (err) {
        console.error('Room creation error:', err);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// ── POST /api/rooms/:code/join — Join an existing room (Member with Offer) ───
router.post('/rooms/:code/join', (req, res) => {
    const { code } = req.params;
    const { displayName, offer, peerId: existingPeerId } = req.body;

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        return res.status(400).json({ error: 'displayName is required (non-empty string)' });
    }
    if (!offer) {
        return res.status(400).json({ error: 'offer is required' });
    }

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room) {
        return res.status(404).json({ error: 'Room not found or expired' });
    }
    if (room.expires_at < now()) {
        stmts.deleteRoom.run(room.id);
        return res.status(404).json({ error: 'Room has expired' });
    }

    const peerId = existingPeerId || generatePeerId();
    const ts = now();

    try {
        stmts.upsertPeer.run(room.id, peerId, displayName.trim(), ts, ts);

        // Insert the member's offer into signals destined for the host
        const payloadStr = typeof offer === 'string' ? offer : JSON.stringify(offer);
        stmts.insertSignal.run(room.id, peerId, room.host_peer, 'offer', payloadStr, ts);

        const peers = stmts.findPeersInRoom.all(room.id);

        res.status(200).json({
            roomCode: room.code,
            peerId,
            hostPeerId: room.host_peer,
            peers: peers.map(p => ({
                peerId: p.peer_id,
                displayName: p.display_name,
                isHost: p.peer_id === room.host_peer,
            })),
        });
    } catch (err) {
        console.error('Join room error:', err);
        res.status(500).json({ error: 'Failed to join room' });
    }
});

// ── GET /api/rooms/:code — Get room info + peer list ────────────────────────
router.get('/rooms/:code', (req, res) => {
    const room = stmts.findRoomByCode.get(req.params.code.toUpperCase());
    if (!room || room.expires_at < now()) {
        return res.status(404).json({ error: 'Room not found or expired' });
    }

    const peers = stmts.findPeersInRoom.all(room.id);
    res.json({
        roomCode: room.code,
        hostPeerId: room.host_peer,
        createdAt: room.created_at,
        expiresAt: room.expires_at,
        peers: peers.map(p => ({
            peerId: p.peer_id,
            displayName: p.display_name,
            isHost: p.peer_id === room.host_peer,
            lastSeen: p.last_seen,
            isOnline: (now() - p.last_seen) < PEER_TIMEOUT_MS,
        })),
    });
});

// ── DELETE /api/rooms/:code — Close room (host only) ────────────────────────
router.delete('/rooms/:code', (req, res) => {
    const { peerId } = req.body;
    if (!peerId) {
        return res.status(400).json({ error: 'peerId is required' });
    }

    const room = stmts.findRoomByCode.get(req.params.code.toUpperCase());
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    if (room.host_peer !== peerId) {
        return res.status(403).json({ error: 'Only the host can close the room' });
    }

    stmts.deleteRoom.run(room.id); // CASCADE deletes peers + signals
    res.json({ message: 'Room closed' });
});

// ── POST /api/rooms/:code/leave — Leave a room ─────────────────────────────
router.post('/rooms/:code/leave', (req, res) => {
    const { peerId } = req.body;
    if (!peerId) {
        return res.status(400).json({ error: 'peerId is required' });
    }

    const room = stmts.findRoomByCode.get(req.params.code.toUpperCase());
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    stmts.removePeer.run(room.id, peerId);

    // If host leaves, close the entire room
    if (room.host_peer === peerId) {
        stmts.deleteRoom.run(room.id);
        return res.json({ message: 'Host left — room closed' });
    }

    res.json({ message: 'Left room' });
});

// ── GET /api/rooms/:code/offers — (Host) Poll for Member Offers ─────────────
router.get('/rooms/:code/offers', (req, res) => {
    const peerId = req.query.peerId;
    if (!peerId) return res.status(400).json({ error: 'peerId query parameter is required' });

    const room = stmts.findRoomByCode.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found or expired' });
    if (room.host_peer !== peerId) return res.status(403).json({ error: 'Only host can poll offers' });

    stmts.updatePeerHeartbeat.run(now(), room.id, peerId);

    const signals = stmts.pollSignals.all(room.id, peerId).filter(s => s.type === 'offer');

    const consumeTx = db.transaction((rows) => {
        for (const row of rows) {
            stmts.consumeSignals.run(row.id);
        }
    });
    consumeTx(signals);

    res.json({
        offers: signals.map(s => ({
            fromPeer: s.from_peer,
            offer: tryParseJSON(s.payload),
            createdAt: s.created_at,
        })),
    });
});

// ── POST /api/rooms/:code/answer/:memberId — (Host) Send Answer to Member ───
router.post('/rooms/:code/answer/:memberId', (req, res) => {
    const { code, memberId } = req.params;
    const { peerId, answer } = req.body;

    if (!peerId || !answer) {
        return res.status(400).json({ error: 'peerId and answer are required' });
    }

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found or expired' });
    if (room.host_peer !== peerId) return res.status(403).json({ error: 'Only host can send answers' });

    const payloadStr = typeof answer === 'string' ? answer : JSON.stringify(answer);

    try {
        stmts.insertSignal.run(room.id, peerId, memberId, 'answer', payloadStr, now());
        res.status(201).json({ message: 'Answer queued' });
    } catch (err) {
        console.error('Answer send error:', err);
        res.status(500).json({ error: 'Failed to send answer' });
    }
});

// ── GET /api/rooms/:code/my-answer — (Member) Poll for Host Answer ──────────
router.get('/rooms/:code/my-answer', (req, res) => {
    const peerId = req.query.peerId;
    if (!peerId) return res.status(400).json({ error: 'peerId query parameter is required' });

    const room = stmts.findRoomByCode.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found or expired' });

    stmts.updatePeerHeartbeat.run(now(), room.id, peerId);

    const signals = stmts.pollSignals.all(room.id, peerId).filter(s => s.type === 'answer');

    const consumeTx = db.transaction((rows) => {
        for (const row of rows) {
            stmts.consumeSignals.run(row.id);
        }
    });
    consumeTx(signals);

    res.json({
        answer: signals.length > 0 ? tryParseJSON(signals[signals.length - 1].payload) : null
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Safely parse JSON, returns original string on failure */
function tryParseJSON(str) {
    try { return JSON.parse(str); } catch { return str; }
}

export default router;
