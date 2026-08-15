'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const info = {
    id: 'extension-manager',
    name: 'Extension Manager Storage',
    description: 'Server-side storage for extension manager metadata.',
};

const DATA_DIR = process.env.EXTENSION_MANAGER_DATA_DIR
    ? path.resolve(process.env.EXTENSION_MANAGER_DATA_DIR)
    : path.join(__dirname, 'data');
const MAX_META_BYTES = 2 * 1024 * 1024;
const MAX_EXTENSIONS = 2000;
const MAX_NAME_LENGTH = 160;
const MAX_NOTE_LENGTH = 2000;
let writeQueue = Promise.resolve();

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function userKey(req) {
    const profile = req && req.user && req.user.profile ? req.user.profile : {};
    const identity = String(profile.handle || profile.username || profile.name || 'default').trim() || 'default';
    return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function userFile(req) {
    return path.join(DATA_DIR, `${userKey(req)}.json`);
}

function emptyData() {
    return { schemaVersion: 1, updatedAt: null, extensions: {} };
}

async function readJson(filePath, fallback) {
    try { return JSON.parse(await fsp.readFile(filePath, 'utf8')); }
    catch (error) { if (error && error.code === 'ENOENT') return fallback; throw error; }
}

function normalizeData(value) {
    const source = isObject(value) ? value : {};
    const extensions = {};
    const entries = isObject(source.extensions) ? Object.entries(source.extensions) : [];
    entries.slice(0, MAX_EXTENSIONS).forEach(([folder, item]) => {
        const safeFolder = String(folder || '').trim();
        if (!/^[^/\\\0]{1,180}$/.test(safeFolder) || !isObject(item)) return;
        const name = String(item.name || '').trim().slice(0, MAX_NAME_LENGTH);
        const note = String(item.note || '').trim().slice(0, MAX_NOTE_LENGTH);
        if (name || note) extensions[safeFolder] = { name, note };
    });
    return {
        schemaVersion: 1,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
        extensions,
    };
}

async function readData(req) {
    const filePath = userFile(req);
    try {
        return normalizeData(await readJson(filePath, emptyData()));
    } catch (mainError) {
        try { return normalizeData(await readJson(`${filePath}.bak`, emptyData())); }
        catch (backupError) { throw mainError; }
    }
}

async function writeJsonAtomic(filePath, value) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
        await fsp.copyFile(filePath, `${filePath}.bak`);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
    }
    await fsp.rename(temporary, filePath);
}

function enqueueWrite(task) {
    const next = writeQueue.then(task, task);
    writeQueue = next.catch(() => {});
    return next;
}

function sendError(res, status, message, code = 'storage_error') {
    return res.status(status).json({ ok: false, error: message, code });
}

async function writeData(req, input) {
    const raw = JSON.stringify(input || {});
    if (Buffer.byteLength(raw, 'utf8') > MAX_META_BYTES) {
        const error = new Error('扩展资料超过 2 MB 限制');
        error.code = 'metadata_too_large';
        throw error;
    }
    const normalized = normalizeData(input);
    normalized.updatedAt = new Date().toISOString();
    await writeJsonAtomic(userFile(req), normalized);
    return normalized;
}

async function init(router) {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    router.get('/status', async (req, res) => {
        try {
            const data = await readData(req);
            res.set('Cache-Control', 'no-store');
            res.json({ ok: true, pluginId: info.id, version: '1.0.0', schemaVersion: data.schemaVersion, storage: 'server', extensionCount: Object.keys(data.extensions).length });
        } catch (error) { sendError(res, 500, error.message); }
    });

    router.get('/data', async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            res.json({ ok: true, data: await readData(req) });
        } catch (error) { sendError(res, 500, error.message); }
    });

    const saveHandler = async (req, res) => {
        if (!isObject(req.body)) return sendError(res, 400, '需要 JSON 对象', 'invalid_body');
        try {
            const input = isObject(req.body.data) ? req.body.data : req.body;
            const data = await enqueueWrite(() => writeData(req, input));
            res.json({ ok: true, data });
        } catch (error) {
            sendError(res, error.code === 'metadata_too_large' ? 413 : 500, error.message, error.code || 'storage_error');
        }
    };
    router.put('/data', saveHandler);
    router.post('/data', saveHandler);
}

module.exports = { info, init };
