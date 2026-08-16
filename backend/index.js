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
const FLOATING_BALL_MIN = 25;
const FLOATING_BALL_MAX = 56;
const FLOATING_BALL_DEFAULT = 34;
const GIT_TIMEOUT_MS = 120000;
const PLUGINS_DIR = path.dirname(__dirname);
const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
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
    return { schemaVersion: 4, updatedAt: null, extensions: {}, backendPlugins: {}, whitelist: { frontend: [], backend: [] }, settings: { floatingBallSize: FLOATING_BALL_DEFAULT } };
}

async function readJson(filePath, fallback) {
    try { return JSON.parse(await fsp.readFile(filePath, 'utf8')); }
    catch (error) { if (error && error.code === 'ENOENT') return fallback; throw error; }
}

function normalizeSettings(value) {
    const source = isObject(value) ? value : {};
    const parsed = Number.parseInt(source.floatingBallSize, 10);
    const floatingBallSize = Number.isFinite(parsed)
        ? Math.min(FLOATING_BALL_MAX, Math.max(FLOATING_BALL_MIN, parsed))
        : FLOATING_BALL_DEFAULT;
    return { floatingBallSize };
}

function normalizeMetadataMap(value) {
    const result = {};
    const entries = isObject(value) ? Object.entries(value) : [];
    entries.slice(0, MAX_EXTENSIONS).forEach(([key, item]) => {
        const safeKey = String(key || '').trim();
        if (!/^[^/\\\0]{1,180}$/.test(safeKey) || !isObject(item)) return;
        const name = String(item.name || '').trim().slice(0, MAX_NAME_LENGTH);
        const note = String(item.note || '').trim().slice(0, MAX_NOTE_LENGTH);
        const category = String(item.category || '').trim().slice(0, MAX_CATEGORY_LENGTH);
        if (name || note || category) result[safeKey] = { name, note, category };
    });
    return result;
}

function normalizeWhitelist(value) {
    const source = isObject(value) ? value : {};
    const normalizeList = (items, pattern) => Array.from(new Set((Array.isArray(items) ? items : [])
        .slice(0, MAX_EXTENSIONS)
        .map(item => String(item || '').trim())
        .filter(item => pattern.test(item))));
    return {
        frontend: normalizeList(source.frontend, /^[^/\\\0]{1,180}$/),
        backend: normalizeList(source.backend, PLUGIN_ID_PATTERN),
    };
}

function normalizeData(value) {
    const source = isObject(value) ? value : {};
    return {
        schemaVersion: 4,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
        extensions: normalizeMetadataMap(source.extensions),
        backendPlugins: normalizeMetadataMap(source.backendPlugins),
        whitelist: normalizeWhitelist(source.whitelist),
        settings: normalizeSettings(source.settings),
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

async function runGitIn(directory, args) {
    const result = await execFileAsync('git', ['-C', directory, ...args], {
        cwd: directory,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
    });
    return { stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

async function runGit(args) {
    return runGitIn(__dirname, args);
}

function githubAuthorFromRepository(value) {
    const candidate = typeof value === 'string' ? value : (isObject(value) ? value.url : '');
    const repository = String(candidate || '').trim().replace(/^git\+/, '');
    const match = repository.match(/^(?:https?:\/\/(?:[^/@]+@)?|git:\/\/|ssh:\/\/(?:git@)?)github\.com[/:]([A-Za-z0-9-]+)\//i)
        || repository.match(/^git@github\.com:([A-Za-z0-9-]+)\//i)
        || repository.match(/^github:([A-Za-z0-9-]+)\//i);
    return match ? match[1] : '';
}

async function getGitInfoFor(directory, fetchRemote = true) {
    let inside;
    try {
        inside = await runGitIn(directory, ['rev-parse', '--is-inside-work-tree']);
    } catch (error) {
        throw Object.assign(new Error('插件目录不是 Git 仓库'), { code: 'not_git_repository' });
    }
    if (inside.stdout !== 'true') throw Object.assign(new Error('插件目录不是 Git 仓库'), { code: 'not_git_repository' });
    const topLevel = (await runGitIn(directory, ['rev-parse', '--show-toplevel'])).stdout;
    const [gitPath, pluginPath, gitRoot, pluginRoot] = await Promise.all([
        fsp.realpath(topLevel),
        fsp.realpath(directory),
        fsp.stat(topLevel),
        fsp.stat(directory),
    ]);
    const normalizePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const samePath = normalizePath(gitPath) === normalizePath(pluginPath);
    const sameIdentity = gitRoot.ino !== 0 && gitRoot.dev === pluginRoot.dev && gitRoot.ino === pluginRoot.ino;
    if (!samePath && !sameIdentity) {
        throw Object.assign(new Error('插件没有独立的 Git 仓库'), { code: 'not_git_repository' });
    }
    const branch = (await runGitIn(directory, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
    const localCommit = (await runGitIn(directory, ['rev-parse', 'HEAD'])).stdout;
    if (fetchRemote) {
        try {
            await runGitIn(directory, ['fetch', '--quiet', 'origin']);
        } catch (error) {
            throw Object.assign(new Error('无法获取远端版本，请检查网络和 origin 配置'), { code: 'remote_unavailable' });
        }
    }
    let upstreamCommit = '';
    let behind = 0;
    try {
        upstreamCommit = (await runGitIn(directory, ['rev-parse', '@{u}'])).stdout;
        behind = Number((await runGitIn(directory, ['rev-list', '--count', 'HEAD..@{u}'])).stdout || 0);
    } catch (error) {
        throw Object.assign(new Error('插件仓库没有可用的上游分支'), { code: 'upstream_unavailable' });
    }
    let remoteUrl = '';
    try { remoteUrl = (await runGitIn(directory, ['remote', 'get-url', 'origin'])).stdout; } catch (error) {}
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

async function getGitInfo(fetchRemote = true) {
    return getGitInfoFor(__dirname, fetchRemote);
}

async function readOptionalJson(filePath) {
    try { return JSON.parse(await fsp.readFile(filePath, 'utf8')); }
    catch (error) { return null; }
}

async function fileExists(filePath) {
    try { await fsp.access(filePath); return true; }
    catch (error) { return false; }
}

async function readServerPlugin(pluginId, directory) {
    const packageJson = await readOptionalJson(path.join(directory, 'package.json'));
    const manifest = await readOptionalJson(path.join(directory, 'manifest.json'));
    const hasEntry = await fileExists(path.join(directory, 'index.js'));
    if (!packageJson && !manifest && !hasEntry) return null;
    const source = isObject(manifest) ? manifest : {};
    const pkg = isObject(packageJson) ? packageJson : {};
    const repository = source.homePage || source.homepage || source.repository || pkg.homepage || pkg.repository;
    let githubAuthor = githubAuthorFromRepository(repository);
    if (!githubAuthor) {
        try {
            githubAuthor = githubAuthorFromRepository((await runGitIn(directory, ['remote', 'get-url', 'origin'])).stdout);
        } catch (error) {}
    }
    return {
        id: pluginId,
        name: String(source.display_name || source.displayName || source.name || pkg.displayName || pkg.name || pluginId).trim() || pluginId,
        version: String(source.version || pkg.version || '').trim(),
        description: String(source.description || pkg.description || '').trim(),
        githubAuthor,
        isManager: path.resolve(directory) === path.resolve(__dirname),
    };
}

function publicGitInfo(git) {
    const { remoteUrl, ...safe } = git || {};
    const githubAuthor = githubAuthorFromRepository(remoteUrl);
    return githubAuthor ? { ...safe, githubAuthor } : safe;
}

async function inspectServerPlugin(pluginId, directory, checkUpdates) {
    const plugin = await readServerPlugin(pluginId, directory);
    if (!plugin) return null;
    if (!checkUpdates) return { ...plugin, updateSupported: null, isUpToDate: null };
    try {
        return { ...plugin, ...publicGitInfo(await getGitInfoFor(directory, true)) };
    } catch (error) {
        return {
            ...plugin,
            updateSupported: false,
            isUpToDate: true,
            error: error.message || String(error),
            code: error.code || 'git_check_failed',
        };
    }
}

async function scanServerPlugins(checkUpdates = true, pluginIds = null) {
    const requested = Array.isArray(pluginIds) ? new Set(pluginIds) : null;
    const entries = await fsp.readdir(PLUGINS_DIR, { withFileTypes: true });
    const candidates = entries
        .filter(entry => entry.isDirectory() && PLUGIN_ID_PATTERN.test(entry.name) && (!requested || requested.has(entry.name)))
        .map(entry => ({ id: entry.name, directory: path.join(PLUGINS_DIR, entry.name) }));
    const plugins = await Promise.all(candidates.map(candidate => inspectServerPlugin(candidate.id, candidate.directory, checkUpdates)));
    return plugins.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans') || a.id.localeCompare(b.id));
}

async function resolveServerPlugin(pluginId) {
    const id = String(pluginId || '').trim();
    if (!PLUGIN_ID_PATTERN.test(id)) throw Object.assign(new Error('无效的后端插件标识'), { code: 'invalid_plugin_id' });
    const directory = path.join(PLUGINS_DIR, id);
    let stats;
    try { stats = await fsp.lstat(directory); }
    catch (error) { throw Object.assign(new Error('未找到后端插件'), { code: 'plugin_not_found' }); }
    if (!stats.isDirectory()) throw Object.assign(new Error('后端插件必须是 plugins 下的直接目录'), { code: 'plugin_not_found' });
    const plugin = await readServerPlugin(id, directory);
    if (!plugin) throw Object.assign(new Error('目录不是可识别的后端插件'), { code: 'plugin_not_found' });
    return { id, directory, plugin };
}

async function updateServerPlugin(pluginId) {
    const target = await resolveServerPlugin(pluginId);
    const before = await getGitInfoFor(target.directory, true);
    if (before.isUpToDate) return { target, before, after: before, output: 'Already up to date.', updated: false };
    const pull = await runGitIn(target.directory, ['pull', '--ff-only']);
    const after = await getGitInfoFor(target.directory, false);
    return {
        target,
        before,
        after,
        output: pull.stdout || pull.stderr,
        updated: before.currentCommitHash !== after.currentCommitHash,
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
            res.json({ ok: true, pluginId: info.id, version: packageInfo.version, schemaVersion: data.schemaVersion, storage: 'server', extensionCount: Object.keys(data.extensions).length, backendPluginMetadataCount: Object.keys(data.backendPlugins).length, whitelistCount: data.whitelist.frontend.length + data.whitelist.backend.length });
        } catch (error) { sendError(res, 500, error.message); }
    });

    router.get('/version', async (req, res) => {
        try {
            const data = await readData(req);
            if (data.whitelist.backend.includes(info.id)) {
                res.set('Cache-Control', 'no-store');
                return res.json({ ok: true, version: packageInfo.version, ignored: true, updateSupported: false, isUpToDate: true });
            }
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
            const data = await readData(req);
            if (data.whitelist.backend.includes(info.id)) return sendError(res, 409, '扩展管理器后端已加入白名单', 'plugin_whitelisted');
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
                message: updated ? '后端已更新，需要手动重启 SillyTavern' : '后端已是最新版本',
                output: result.output,
            });
        } catch (error) {
            sendError(res, 500, error.message, error.code || 'git_update_failed');
        }
    });

    router.get('/plugins', async (req, res) => {
        try {
            const checkUpdates = String(req.query && req.query.checkUpdates || 'true').toLowerCase() !== 'false';
            let plugins;
            if (checkUpdates) {
                const data = await readData(req);
                const ignored = new Set(data.whitelist.backend);
                const installed = await scanServerPlugins(false);
                const checked = await scanServerPlugins(true, installed.filter(plugin => !ignored.has(plugin.id)).map(plugin => plugin.id));
                const checkedById = new Map(checked.map(plugin => [plugin.id, plugin]));
                plugins = installed.map(plugin => ignored.has(plugin.id) ? { ...plugin, ignored: true } : (checkedById.get(plugin.id) || plugin));
            } else {
                plugins = await scanServerPlugins(false);
            }
            res.set('Cache-Control', 'no-store');
            res.json({ ok: true, plugins, pluginCount: plugins.length });
        } catch (error) {
            sendError(res, 500, error.message, error.code || 'plugin_scan_failed');
        }
    });

    router.post('/plugins/check', async (req, res) => {
        if (!isObject(req.body) || !Array.isArray(req.body.pluginIds)) return sendError(res, 400, '需要 pluginIds 数组', 'invalid_body');
        const pluginIds = Array.from(new Set(req.body.pluginIds.map(id => String(id || '').trim())));
        if (!pluginIds.length || pluginIds.length > MAX_EXTENSIONS || pluginIds.some(id => !PLUGIN_ID_PATTERN.test(id))) {
            return sendError(res, 400, '后端插件标识列表无效', 'invalid_plugin_ids');
        }
        try {
            const data = await readData(req);
            const includeWhitelisted = req.body.includeWhitelisted === true;
            const ignoredIds = includeWhitelisted ? [] : pluginIds.filter(id => data.whitelist.backend.includes(id));
            const targets = includeWhitelisted ? pluginIds : pluginIds.filter(id => !data.whitelist.backend.includes(id));
            const plugins = targets.length ? await scanServerPlugins(true, targets) : [];
            res.set('Cache-Control', 'no-store');
            res.json({ ok: true, plugins, pluginCount: plugins.length, ignoredIds });
        } catch (error) {
            sendError(res, 500, error.message, error.code || 'plugin_check_failed');
        }
    });

    router.post('/plugins/update', async (req, res) => {
        if (!isAdminRequest(req)) return sendError(res, 403, '只有酒馆管理员可以更新服务端插件', 'admin_required');
        if (!isObject(req.body)) return sendError(res, 400, '需要 JSON 对象', 'invalid_body');
        const pluginId = String(req.body.pluginId || req.body.id || '').trim();
        try {
            const data = await readData(req);
            if (data.whitelist.backend.includes(pluginId) && req.body.includeWhitelisted !== true) return sendError(res, 409, '该后端插件已加入白名单', 'plugin_whitelisted');
            const result = await enqueueUpdate(() => updateServerPlugin(pluginId));
            const plugin = await readServerPlugin(result.target.id, result.target.directory);
            res.json({
                ok: true,
                plugin: { ...plugin, ...publicGitInfo(result.after) },
                updated: result.updated,
                restartRequired: result.updated,
                message: result.updated
                    ? `${plugin.name} 已更新，请手动重启 SillyTavern`
                    : `${plugin.name} 已是最新版本`,
                output: result.output,
            });
        } catch (error) {
            const status = error.code === 'invalid_plugin_id' ? 400 : (error.code === 'plugin_not_found' ? 404 : 500);
            sendError(res, status, error.message, error.code || 'plugin_update_failed');
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
            const data = await enqueueWrite(async () => {
                if (Object.prototype.hasOwnProperty.call(input, 'whitelist')) return writeData(req, input);
                const current = await readData(req);
                return writeData(req, { ...input, whitelist: current.whitelist });
            });
            res.json({ ok: true, data });
        } catch (error) {
            sendError(res, error.code === 'metadata_too_large' ? 413 : 500, error.message, error.code || 'storage_error');
        }
    };
    router.put('/data', saveHandler);
    router.post('/data', saveHandler);
}

module.exports = { info, init };
