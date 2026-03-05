import { Router } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendRoomEventToTokens } from './fcm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOM_CODE_LENGTH = 6;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const ACK_ONLINE_TTL_MS = 90 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

const dbPath = path.join(__dirname, 'v1-rooms.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT    NOT NULL UNIQUE,
    host_peer     TEXT    NOT NULL,
    state_json    TEXT    NOT NULL DEFAULT '{}',
    state_version INTEGER NOT NULL DEFAULT 0,
    last_event_id TEXT,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS peers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    peer_id      TEXT    NOT NULL,
    display_name TEXT    NOT NULL DEFAULT 'Anonymous',
    joined_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_seen    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_ack_at  INTEGER NOT NULL DEFAULT 0,
    is_online    INTEGER NOT NULL DEFAULT 0,
    fcm_token    TEXT,
    last_event_id TEXT,
    UNIQUE(room_id, peer_id)
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_code    ON rooms(code);
  CREATE INDEX IF NOT EXISTS idx_rooms_expires ON rooms(expires_at);
  CREATE INDEX IF NOT EXISTS idx_peers_room    ON peers(room_id);
`);

function ensureColumn(table, columnName, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const hasColumn = columns.some((col) => col.name === columnName);
    if (!hasColumn) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${definition}`);
    }
}

ensureColumn('rooms', 'state_version', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('rooms', 'last_event_id', 'TEXT');
ensureColumn('rooms', 'host_offset_ms', 'INTEGER');
ensureColumn('peers', 'last_ack_at', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('peers', 'is_online', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('peers', 'fcm_token', 'TEXT');
ensureColumn('peers', 'last_event_id', 'TEXT');

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

function generatePeerId() {
    return crypto.randomUUID();
}

function now() {
    return Date.now();
}

function tryParseJSON(str) {
    try { return JSON.parse(str); } catch { return {}; }
}

const stmts = {
    insertRoom: db.prepare(
        `INSERT INTO rooms (code, host_peer, state_json, expires_at, host_offset_ms) VALUES (?, ?, ?, ?, ?)`,
    ),
    findRoomByCode: db.prepare(`SELECT * FROM rooms WHERE code = ?`),
    updateRoomState: db.prepare(`UPDATE rooms SET state_json = ?, state_version = ?, last_event_id = ? WHERE id = ?`),
    deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),
    deleteExpiredRooms: db.prepare(`DELETE FROM rooms WHERE expires_at < ?`),

    insertPeer: db.prepare(`
      INSERT OR IGNORE INTO peers (room_id, peer_id, display_name, joined_at, last_seen, last_ack_at, is_online)
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `),
    upsertPeer: db.prepare(`
      INSERT INTO peers (room_id, peer_id, display_name, joined_at, last_seen, last_ack_at, is_online)
      VALUES (?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT(room_id, peer_id)
      DO UPDATE SET
        display_name = excluded.display_name,
        last_seen = excluded.last_seen
    `),
    findPeersInRoom: db.prepare(`
      SELECT peer_id, display_name, joined_at, last_seen, last_ack_at, is_online
      FROM peers
      WHERE room_id = ?
      ORDER BY joined_at ASC
    `),
    markPeerAck: db.prepare(`
      UPDATE peers
      SET last_ack_at = ?, is_online = 1, last_event_id = ?, last_seen = ?
      WHERE room_id = ? AND peer_id = ?
    `),
    markPeersOfflineByAck: db.prepare(`
      UPDATE peers
      SET is_online = 0
      WHERE room_id = ? AND is_online = 1 AND last_ack_at < ?
    `),
    markAllOfflineByAck: db.prepare(`
      UPDATE peers
      SET is_online = 0
      WHERE is_online = 1 AND last_ack_at < ?
    `),
    removePeer: db.prepare(`DELETE FROM peers WHERE room_id = ? AND peer_id = ?`),

    setPeerFcmToken: db.prepare(`
      UPDATE peers
      SET fcm_token = ?, last_seen = ?
      WHERE room_id = ? AND peer_id = ?
    `),
    clearFcmTokensByValue: db.prepare(`
      UPDATE peers
      SET fcm_token = NULL
      WHERE fcm_token = ?
    `),
    findTokensInRoom: db.prepare(`
      SELECT fcm_token
      FROM peers
      WHERE room_id = ?
        AND peer_id != ?
        AND fcm_token IS NOT NULL
        AND trim(fcm_token) != ''
    `),
    findPeerByRoomAndPeer: db.prepare(`
      SELECT peer_id, display_name, joined_at, last_ack_at, is_online
      FROM peers
      WHERE room_id = ? AND peer_id = ?
      LIMIT 1
    `),
    findHostToken: db.prepare(`
      SELECT p.fcm_token
      FROM peers p
      WHERE p.room_id = ? AND p.peer_id = ?
      LIMIT 1
    `),
};

const cleanupSweep = db.transaction(() => {
    const ts = now();
    stmts.deleteExpiredRooms.run(ts);
    stmts.markAllOfflineByAck.run(ts - ACK_ONLINE_TTL_MS);
});

setInterval(() => {
    try { cleanupSweep(); } catch { }
}, CLEANUP_INTERVAL_MS);

async function fanoutRoomEvent(roomId, excludePeerId, dataPayload) {
    const rows = stmts.findTokensInRoom.all(roomId, excludePeerId);
    const tokens = rows.map((r) => r.fcm_token).filter(Boolean);

    if (tokens.length === 0) return;

    const result = await sendRoomEventToTokens(tokens, dataPayload);
    if (result.invalidTokens.length > 0) {
        for (const invalidToken of result.invalidTokens) {
            stmts.clearFcmTokensByValue.run(invalidToken);
        }
    }
}

async function sendHostEvent(room, eventType, eventId, payload = {}) {
    const hostTokenRow = stmts.findHostToken.get(room.id, room.host_peer);
    const hostToken = hostTokenRow?.fcm_token;
    if (!hostToken) return;

    const result = await sendRoomEventToTokens([hostToken], {
        type: eventType,
        roomCode: room.code,
        eventId,
        title: 'Room activity',
        ...payload,
    });

    if (result.invalidTokens.length > 0) {
        for (const invalidToken of result.invalidTokens) {
            stmts.clearFcmTokensByValue.run(invalidToken);
        }
    }
}

const router = Router();

router.post('/', (req, res) => {
    const { displayName, initialState, hostOffsetMs } = req.body;
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        return res.status(400).json({ error: 'displayName is required (non-empty string)' });
    }

    const code = generateRoomCode();
    const peerId = generatePeerId();
    const expiresAt = now() + ROOM_TTL_MS;
    const initialTs = now();
    const normalizedHostOffsetMs =
        typeof hostOffsetMs === 'number' && Number.isFinite(hostOffsetMs) ? Math.round(hostOffsetMs) : 0;

    const stateObject = {
        ...(initialState || {}),
        updatedAt: initialState?.updatedAt || initialTs,
        queueVersion: 0,
        eventId: `evt-${crypto.randomUUID()}`,
    };

    try {
        const result = stmts.insertRoom.run(code, peerId, JSON.stringify(stateObject), expiresAt, normalizedHostOffsetMs);
        const roomId = result.lastInsertRowid;
        stmts.insertPeer.run(roomId, peerId, displayName.trim(), initialTs, initialTs);

        res.status(201).json({
            roomCode: code,
            peerId,
            expiresAt,
            hostOffsetMs: normalizedHostOffsetMs,
            message: `Room created. Share code "${code}" with others to join.`,
        });
    } catch (err) {
        console.error('Room creation error:', err);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

router.post('/:code/join', async (req, res) => {
    const { code } = req.params;
    const { displayName, peerId: existingPeerId } = req.body;

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        return res.status(400).json({ error: 'displayName is required' });
    }

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room || room.expires_at < now()) {
        if (room && room.expires_at < now()) stmts.deleteRoom.run(room.id);
        return res.status(404).json({ error: 'Room not found or expired' });
    }

    const peerId = existingPeerId || generatePeerId();
    const ts = now();

    try {
        stmts.upsertPeer.run(room.id, peerId, displayName.trim(), ts, ts);
        stmts.markPeersOfflineByAck.run(room.id, ts - ACK_ONLINE_TTL_MS);

        const peers = stmts.findPeersInRoom.all(room.id);

        if (peerId !== room.host_peer) {
            const eventId = `evt-${crypto.randomUUID()}`;
            await sendHostEvent(room, 'member_join', eventId, {
                memberPeerId: peerId,
                memberName: displayName.trim(),
                title: 'Member joined',
            });
        }

        res.status(200).json({
            roomCode: room.code,
            peerId,
            hostPeerId: room.host_peer,
            hostOffsetMs: room.host_offset_ms || 0,
            state: tryParseJSON(room.state_json),
            peers: peers.map((p) => ({
                peerId: p.peer_id,
                displayName: p.display_name,
                isHost: p.peer_id === room.host_peer,
                lastAckAt: p.last_ack_at,
                isOnline: p.is_online === 1 && (now() - p.last_ack_at) < ACK_ONLINE_TTL_MS,
            })),
        });
    } catch (err) {
        console.error('Join room error:', err);
        res.status(500).json({ error: 'Failed to join room' });
    }
});

router.get('/time', (req, res) => {
    return res.json({ serverTimeMs: now() });
});

router.get('/:code', (req, res) => {
    const { code } = req.params;

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room || room.expires_at < now()) {
        return res.status(404).json({ error: 'Room not found or expired' });
    }

    stmts.markPeersOfflineByAck.run(room.id, now() - ACK_ONLINE_TTL_MS);

    const peers = stmts.findPeersInRoom.all(room.id);
    res.json({
        roomCode: room.code,
        hostPeerId: room.host_peer,
        hostOffsetMs: room.host_offset_ms || 0,
        state: tryParseJSON(room.state_json),
        stateVersion: room.state_version || 0,
        lastEventId: room.last_event_id || null,
        peers: peers.map((p) => ({
            peerId: p.peer_id,
            displayName: p.display_name,
            isHost: p.peer_id === room.host_peer,
            lastAckAt: p.last_ack_at,
            isOnline: p.is_online === 1 && (now() - p.last_ack_at) < ACK_ONLINE_TTL_MS,
        })),
    });
});

router.put('/:code/state', async (req, res) => {
    const { code } = req.params;
    const { peerId, state } = req.body;

    if (!peerId || !state) {
        return res.status(400).json({ error: 'peerId and state are required' });
    }

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found or expired' });
    if (room.host_peer !== peerId) return res.status(403).json({ error: 'Only host can update state' });

    try {
        const nextVersion = (room.state_version || 0) + 1;
        const eventId = `evt-${crypto.randomUUID()}`;
        const updatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : now();
        const stateWithMeta = {
            ...state,
            updatedAt,
            queueVersion: nextVersion,
            eventId,
        };

        stmts.updateRoomState.run(JSON.stringify(stateWithMeta), nextVersion, eventId, room.id);

        await fanoutRoomEvent(room.id, peerId, {
            type: 'queue_update',
            roomCode: room.code,
            eventId,
            queueVersion: String(nextVersion),
            updatedAt: String(updatedAt),
            title: 'Queue update',
        });

        res.json({ message: 'State updated successfully', queueVersion: nextVersion, eventId });
    } catch (err) {
        console.error('Update state error:', err);
        res.status(500).json({ error: 'Failed to update state' });
    }
});

router.put('/:code/fcm-token', (req, res) => {
    const { code } = req.params;
    const { peerId, token } = req.body;

    if (!peerId || typeof peerId !== 'string') {
        return res.status(400).json({ error: 'peerId is required' });
    }
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'token is required' });
    }

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room || room.expires_at < now()) {
        return res.status(404).json({ error: 'Room not found or expired' });
    }

    const peer = stmts.findPeerByRoomAndPeer.get(room.id, peerId);
    if (!peer) {
        return res.status(404).json({ error: 'Peer not found in room' });
    }

    stmts.setPeerFcmToken.run(token.trim(), now(), room.id, peerId);
    return res.json({ message: 'FCM token registered' });
});

router.post('/:code/ack', (req, res) => {
    const { code } = req.params;
    const { peerId, eventId } = req.body;

    if (!peerId || typeof peerId !== 'string') {
        return res.status(400).json({ error: 'peerId is required' });
    }

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room || room.expires_at < now()) {
        return res.status(404).json({ error: 'Room not found or expired' });
    }

    const ts = now();
    stmts.markPeerAck.run(ts, eventId || null, ts, room.id, peerId);

    const peer = stmts.findPeerByRoomAndPeer.get(room.id, peerId);
    if (!peer) {
        return res.status(404).json({ error: 'Peer not found in room' });
    }

    return res.json({
        message: 'ACK accepted',
        roomCode: room.code,
        peerId,
        eventId: eventId || null,
        ackAt: ts,
    });
});

router.get('/:code/host-online', (req, res) => {
    const { code } = req.params;

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room || room.expires_at < now()) {
        return res.status(404).json({ error: 'Room not found or expired' });
    }

    const host = stmts.findPeerByRoomAndPeer.get(room.id, room.host_peer);
    if (!host) {
        return res.status(404).json({ error: 'Host peer not found' });
    }

    const hostOnline = host.is_online === 1 && (now() - host.last_ack_at) < ACK_ONLINE_TTL_MS;

    return res.json({
        roomCode: room.code,
        hostPeerId: room.host_peer,
        isHostOnline: hostOnline,
        hostLastAckAt: host.last_ack_at || 0,
        ttlMs: ACK_ONLINE_TTL_MS,
    });
});

router.post('/:code/leave', async (req, res) => {
    const { code } = req.params;
    const { peerId } = req.body;

    if (!peerId) return res.status(400).json({ error: 'peerId is required' });

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const leavingPeer = stmts.findPeerByRoomAndPeer.get(room.id, peerId);
    stmts.removePeer.run(room.id, peerId);

    if (room.host_peer === peerId) {
        stmts.deleteRoom.run(room.id);
        return res.json({ message: 'Host left — room closed' });
    }

    if (leavingPeer) {
        const eventId = `evt-${crypto.randomUUID()}`;
        await sendHostEvent(room, 'member_leave', eventId, {
            memberPeerId: peerId,
            memberName: leavingPeer.display_name,
            title: 'Member left',
        });
    }

    res.json({ message: 'Left room' });
});

router.post('/:code/logs', async (req, res) => {
    const { code } = req.params;
    const { displayName, logs } = req.body;

    if (!displayName || !logs) return res.status(400).json({ error: 'displayName and logs are required' });

    try {
        const fs = await import('fs/promises');
        const logDir = path.join(__dirname, 'logs');

        // Ensure logs directory exists
        try { await fs.mkdir(logDir, { recursive: true }); } catch (e) { }

        const safeName = displayName.replace(/[^a-zA-Z0-9]/g, '_') || 'Anonymous';
        const fileName = `${safeName}_${code}.json`;
        const filePath = path.join(logDir, fileName);
        let existingLogs = [];
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            existingLogs = JSON.parse(fileContent);
        } catch (e) {
            // File doesn't exist or is invalid JSON; start fresh
        }

        const mergedLogs = existingLogs.concat(logs);

        // Save as JSON file named by the display name entered
        await fs.writeFile(filePath, JSON.stringify(mergedLogs, null, 2));

        res.json({ message: 'Logs saved' });
    } catch (err) {
        console.error('Save logs error:', err);
        res.status(500).json({ error: 'Failed to save logs' });
    }
});

router.delete('/:code', (req, res) => {
    const { code } = req.params;
    const { peerId } = req.body;

    if (!peerId) return res.status(400).json({ error: 'peerId is required' });

    const room = stmts.findRoomByCode.get(code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_peer !== peerId) return res.status(403).json({ error: 'Only the host can close the room' });

    stmts.deleteRoom.run(room.id);
    res.json({ message: 'Room closed' });
});

export default router;
