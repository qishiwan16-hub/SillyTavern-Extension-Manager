'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const packageInfo = require('./package.json');

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
const MAX_CATEGORY_LENGTH = 80;
const GIT_TIMEOUT_MS = 120000;
let writeQueue = Promise.resolve();
let updateQueue = Promise.resolve();

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
        const category = String(item.category || '').trim().slice(0, MAX_CATEGORY_LENGTH);
        if (name || note || category) extensions[safeFolder] = { name, note, category };
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

async function runGit(args) {
    const result = await execFileAsync('git', ['-C', __dirname, ...args], {
        cwd: __dirname,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
    });
    return { stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

async function getGitInfo(fetchRemote = true) {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree']);
    if (inside.stdout !== 'true') throw Object.assign(new Error('后端目录不是 Git 仓库，请按 README 使用 git clone 安装'), { code: 'not_git_repository' });
    const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
    const localCommit = (await runGit(['rev-parse', 'HEAD'])).stdout;
    if (fetchRemote) await runGit(['fetch', '--quiet', 'origin']);
    let upstreamCommit = '';
    let behind = 0;
    try {
        upstreamCommit = (await runGit(['rev-parse', '@{u}'])).stdout;
        behind = Number((await runGit(['rev-list', '--count', 'HEAD..@{u}'])).stdout || 0);
    } catch (error) {
        throw Object.assign(new Error('后端仓库没有可用的上游分支'), { code: 'upstream_unavailable' });
    }
    let remoteUrl = '';
    try { remoteUrl = (await runGit(['remote', 'get-url', 'origin'])).stdout; } catch (error) {}
    return {
        updateSupported: true,
        currentBranchName: branch,
        currentCommitHash: localCommit,
        upstreamCommitHash: upstreamCommit,
        shortCommitHash: localCommit.slice(0, 7),
        isUpToDate: behind === 0,
        behind,
        remoteUrl,
    };
}

function enqueueUpdate(task) {
    const next = updateQueue.then(task, task);
    updateQueue = next.catch(() => {});
    return next;
}

function isAdminRequest(req) {
    return Boolean(req && req.user && req.user.profile && req.user.profile.admin);
}

async function init(router) {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    router.get('/status', async (req, res) => {
        try {
            const data = await readData(req);
            res.set('Cache-Control', 'no-store');
            res.json({ ok: true, pluginId: info.id, version: packageInfo.version, schemaVersion: data.schemaVersion, storage: 'server', extensionCount: Object.keys(data.extensions).length });
        } catch (error) { sendError(res, 500, error.message); }
    });

    router.get('/version', async (req, res) => {
        try {
            const git = await getGitInfo(true);
            res.set('Cache-Control', 'no-store');
            res.json({ ok: true, version: packageInfo.version, ...git });
        } catch (error) {
            const unsupported = ['not_git_repository', 'upstream_unavailable'].includes(error && error.code);
            if (unsupported) return res.json({ ok: true, version: packageInfo.version, updateSupported: false, isUpToDate: true, error: error.message, code: error.code });
            sendError(res, 502, error.message, error.code || 'git_check_failed');
        }
    });

    router.post('/update', async (req, res) => {
        if (!isAdminRequest(req)) return sendError(res, 403, '只有酒馆管理员可以更新服务端插件', 'admin_required');
        try {
            const result = await enqueueUpdate(async () => {
                const before = await getGitInfo(true);
                if (before.isUpToDate) return { before, after: before, output: 'Already up to date.' };
                const pull = await runGit(['pull', '--ff-only']);
                const after = await getGitInfo(false);
                return { before, after, output: pull.stdout || pull.stderr };
            });
            const updated = result.before.currentCommitHash !== result.after.currentCommitHash;
            let installedVersion = packageInfo.version;
            try { installedVersion = JSON.parse(await fsp.readFile(path.join(__dirname, 'package.json'), 'utf8')).version || installedVersion; } catch (error) {}
            res.json({
                ok: true,
                updated,
                isUpToDate: result.after.isUpToDate,
                previousCommitHash: result.before.currentCommitHash,
                currentCommitHash: result.after.currentCommitHash,
                shortCommitHash: result.after.currentCommitHash.slice(0, 7),
                version: installedVersion,
                restartRequired: updated,
                message: updated ? '后端已更新，需要手动重启 Termux 中的 SillyTavern' : '后端已是最新版本',
                output: result.output,
            });
        } catch (error) {
            sendError(res, 500, error.message, error.code || 'git_update_failed');
        }
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
