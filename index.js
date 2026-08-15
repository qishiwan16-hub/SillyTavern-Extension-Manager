//name: 扩展管理器

(function () {
    'use strict';

    const SCRIPT_NAME = '扩展管理器';
    const SCRIPT_VERSION = '1.2.0';
    const MENU_BTN_ID = 'st-extension-manager-btn';
    const STYLE_ID = 'st-extension-manager-style';
    const BACKEND_BASE = '/api/plugins/extension-manager';
    const EXTENSION_DEFAULT_FOLDER = 'SillyTavern-Extension-Manager';
    const EXTENSION_RAW_MANIFEST_URL = 'https://raw.githubusercontent.com/qishiwan16-hub/SillyTavern-Extension-Manager/main/manifest.json';
    const INITIAL_SCRIPT_URL = document.currentScript?.src || '';
    const timers = [];
    const state = { extensions: [], filter: '', sort: 'name', checking: false, updating: new Set(), updates: new Map(), meta: {}, backend: { available: false, error: '', version: '' } };
    const selfUpdateState = { phase: 'idle', message: '正在检查本体更新', canUpdate: false, latestVersion: '', extensionName: EXTENSION_DEFAULT_FOLDER, global: false };

    if (typeof window.__extensionManagerCleanup === 'function') window.__extensionManagerCleanup();

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    const normalizeName = value => String(value || '').replace(/^third-party[\\/]/i, '').replace(/^third-party/i, '').replace(/^[/\\]+/, '');
    const typeOf = extension => String(extension?.type || 'local').toLowerCase();
    const isGlobal = extension => typeOf(extension) === 'global';
    const isExternal = extension => ['local', 'global'].includes(typeOf(extension));
    const folderOf = extension => normalizeName(extension?.name || extension?.folderName || extension?.id || '');
    const displayPath = extension => String(extension?.name || folderOf(extension));
    const requestHeaders = () => {
        const headers = { 'Content-Type': 'application/json' };
        if (window.token) headers['X-CSRF-Token'] = window.token;
        if (typeof getRequestHeaders === 'function') Object.assign(headers, getRequestHeaders());
        return headers;
    };
    async function request(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { ...requestHeaders(), ...(options.headers || {}) } });
        if (!response.ok) throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
        return response.status === 204 ? {} : response.json();
    }

    function normalizeMeta(value) {
        const source = value && typeof value === 'object' ? value : {};
        const result = {};
        Object.entries(source).forEach(([folder, item]) => {
            if (!item || typeof item !== 'object') return;
            const name = String(item.name || '').trim();
            const note = String(item.note || '').trim();
            if (name || note) result[folder] = { name, note };
        });
        return result;
    }

    async function loadServerMeta() {
        state.backend = { available: false, error: '', version: '' };
        try {
            const status = await request(`${BACKEND_BASE}/status`, { method: 'GET' });
            const response = await request(`${BACKEND_BASE}/data`, { method: 'GET' });
            const data = response && response.data && typeof response.data === 'object' ? response.data : {};
            state.meta = normalizeMeta(data.extensions);
            state.backend = { available: true, error: '', version: String(status?.version || '') };
        } catch (error) {
            state.meta = {};
            state.backend = { available: false, error: error.message || String(error), version: '' };
        }
    }

    async function saveServerMeta(meta) {
        if (!state.backend.available) throw new Error('服务端存储未连接，请先安装并启用后端插件');
        const response = await request(`${BACKEND_BASE}/data`, { method: 'PUT', body: JSON.stringify({ extensions: normalizeMeta(meta) }) });
        const data = response && response.data && typeof response.data === 'object' ? response.data : {};
        state.meta = normalizeMeta(data.extensions);
        return state.meta;
    }

    async function fetchManifest(extension) {
        const path = displayPath(extension);
        const folder = folderOf(extension);
        const candidates = Array.from(new Set([
            `/scripts/extensions/${path}/manifest.json`,
            `/scripts/extensions/${folder}/manifest.json`,
            `/scripts/extensions/third-party/${folder}/manifest.json`,
        ]));
        for (const url of candidates) {
            try {
                const response = await fetch(`${url}?em=${Date.now()}`, { cache: 'no-store' });
                if (response.ok) return await response.json();
            } catch (error) { /* Try the next native path. */ }
        }
        return {};
    }

    function chineseValue(manifest, keys) {
        for (const key of keys) {
            const value = manifest?.[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        const locales = manifest?.i18n || manifest?.locales;
        if (locales && typeof locales === 'object') {
            const zh = locales['zh-CN'] || locales.zh || locales['zh_cn'] || locales['zh-TW'];
            if (zh && typeof zh === 'object') {
                for (const key of keys) if (typeof zh[key] === 'string' && zh[key].trim()) return zh[key].trim();
            }
        }
        return '';
    }

    async function discover() {
        const entries = await request('/api/extensions/discover', { method: 'GET' });
        const list = Array.isArray(entries) ? entries : [];
        const meta = state.meta;
        const enriched = await Promise.all(list.map(async entry => {
            const extension = typeof entry === 'string' ? { name: entry } : { ...(entry || {}) };
            extension.name = String(extension.name || extension.folderName || extension.id || '').trim();
            extension.manifest = await fetchManifest(extension);
            const folder = folderOf(extension);
            const serverMeta = meta[folder] && typeof meta[folder] === 'object' ? meta[folder] : {};
            extension.zhName = serverMeta.name || chineseValue(extension.manifest, ['display_name_zh', 'displayNameZh', 'zh_name', 'name_zh']) || String(extension.manifest.display_name_zh || '').trim();
            extension.note = serverMeta.note || chineseValue(extension.manifest, ['description_zh', 'descriptionZh', 'zh_description', 'note_zh', 'remarks_zh']);
            extension.displayName = extension.zhName || extension.manifest.display_name || folder || extension.name;
            extension.description = extension.note || extension.manifest.description || '暂无备注';
            extension.version = extension.manifest.version || '';
            return extension;
        }));
        state.extensions = enriched.filter(item => item.name);
        return state.extensions;
    }

    async function getVersion(extension, signal) {
        return request('/api/extensions/version', {
            method: 'POST', signal,
            body: JSON.stringify({ extensionName: folderOf(extension), global: isGlobal(extension) }),
        });
    }

    function repoUrl(extension) {
        const update = state.updates.get(folderOf(extension));
        const candidate = update?.remoteUrl || extension.manifest.homePage || extension.manifest.homepage || extension.manifest.repository;
        if (typeof candidate === 'string') return candidate;
        if (candidate && typeof candidate.url === 'string') return candidate.url;
        return '';
    }

    async function checkOne(extension) {
        if (!isExternal(extension)) {
            const data = { isUpToDate: true, currentBranchName: '', currentCommitHash: '', remoteUrl: '' };
            state.updates.set(folderOf(extension), data);
            return data;
        }
        try { const data = await getVersion(extension); state.updates.set(folderOf(extension), data || {}); return data || {}; }
        catch (error) { state.updates.set(folderOf(extension), { error: error.message || String(error) }); return { error: error.message || String(error) }; }
    }

    async function checkAll($popup) {
        if (state.checking || !state.extensions.length) return;
        state.checking = true;
        renderList($popup);
        const controller = new AbortController();
        state.extensions.filter(isExternal).forEach(extension => extension._checkPromise = checkOne(extension, controller.signal));
        await Promise.all(state.extensions.filter(isExternal).map(extension => extension._checkPromise));
        state.checking = false;
        renderList($popup);
        const available = state.extensions.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false).length;
        if (window.toastr) toastr.info(available ? `发现 ${available} 个扩展可更新` : '所有扩展均为最新版本');
    }

    function getInstalledExtensionName() {
        const scripts = Array.from(document.scripts || []);
        const source = INITIAL_SCRIPT_URL || scripts.find(script => /\/scripts\/extensions\/(?:third-party\/)?[^/]+\/index\.js(?:[?#]|$)/i.test(script.src || ''))?.src || '';
        const match = source.match(/\/scripts\/extensions\/(?:third-party\/)?([^/]+)\/index\.js(?:[?#]|$)/i);
        return match ? decodeURIComponent(match[1]) : EXTENSION_DEFAULT_FOLDER;
    }

    async function requestSelfExtensionApi(endpoint, options = {}) {
        const names = Array.from(new Set([options.extensionName, getInstalledExtensionName(), EXTENSION_DEFAULT_FOLDER].filter(Boolean)));
        const scopes = options.global === undefined ? [false, true] : [!!options.global];
        let lastError = new Error('扩展更新接口不可用');
        for (const extensionName of names) {
            for (const global of scopes) {
                try {
                    const data = await request(`/api/extensions/${endpoint}`, {
                        method: 'POST', signal: options.signal,
                        body: JSON.stringify({ extensionName, global }),
                    });
                    return { data, extensionName, global };
                } catch (error) {
                    if (error?.name === 'AbortError') throw error;
                    lastError = error;
                }
            }
        }
        throw lastError;
    }

    async function getLatestSelfVersion(signal) {
        try {
            const response = await fetch(`${EXTENSION_RAW_MANIFEST_URL}?em=${Date.now()}`, { cache: 'no-store', signal });
            if (!response.ok) return '';
            const manifest = await response.json();
            return String(manifest.version || '').trim();
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return '';
        }
    }

    function renderSelfUpdate($popup) {
        const $status = $popup.find('.em-self-update-status');
        $status.text(selfUpdateState.message).toggleClass('error', selfUpdateState.phase === 'error').toggleClass('update', selfUpdateState.canUpdate);
        $popup.find('.em-check-self').prop('disabled', ['checking', 'updating'].includes(selfUpdateState.phase));
        $popup.find('.em-update-self').prop('hidden', !selfUpdateState.canUpdate).prop('disabled', selfUpdateState.phase === 'updating');
    }

    async function checkSelfUpdate($popup, signal) {
        if (selfUpdateState.phase === 'checking' || selfUpdateState.phase === 'updating') return selfUpdateState;
        selfUpdateState.phase = 'checking';
        selfUpdateState.message = '正在检查本体更新';
        renderSelfUpdate($popup);
        try {
            const result = await requestSelfExtensionApi('version', { signal });
            selfUpdateState.extensionName = result.extensionName;
            selfUpdateState.global = result.global;
            selfUpdateState.latestVersion = await getLatestSelfVersion(signal);
            selfUpdateState.canUpdate = result.data?.isUpToDate === false;
            selfUpdateState.phase = selfUpdateState.canUpdate ? 'available' : 'latest';
            selfUpdateState.message = selfUpdateState.canUpdate
                ? `发现本体新版本${selfUpdateState.latestVersion ? ` v${selfUpdateState.latestVersion}` : ''}`
                : `扩展管理器已是最新版本 v${SCRIPT_VERSION}`;
        } catch (error) {
            if (error?.name === 'AbortError') {
                selfUpdateState.phase = 'idle';
                selfUpdateState.message = '本体更新检查已取消';
            } else {
                selfUpdateState.phase = 'error';
                selfUpdateState.message = `本体检查失败：${error.message || error}`;
            }
            selfUpdateState.canUpdate = false;
        }
        renderSelfUpdate($popup);
        return selfUpdateState;
    }

    function waitForManagerMenu(timeout = 8000) {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const check = () => {
                if ($(`#${MENU_BTN_ID}`).length) return resolve();
                if (Date.now() - startedAt >= timeout) return reject(new Error('扩展管理器未能重新初始化'));
                setTimeout(check, 100);
            };
            check();
        });
    }

    async function hotReloadSelf() {
        if (window.__extensionManagerReloadPromise) return window.__extensionManagerReloadPromise;
        window.__extensionManagerReloadPromise = (async () => {
            const installedName = getInstalledExtensionName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`/scripts/extensions/(?:third-party/)?${installedName}/index\\.js(?:[?#]|$)`, 'i');
            const scripts = Array.from(document.scripts || []).filter(script => pattern.test(script.src || ''));
            const source = INITIAL_SCRIPT_URL || scripts[0]?.src || `/scripts/extensions/third-party/${getInstalledExtensionName()}/index.js`;
            const url = new URL(source, document.baseURI || location.href);
            url.searchParams.set('em_self_update', Date.now());
            if (typeof window.__extensionManagerCleanup === 'function') window.__extensionManagerCleanup();
            scripts.forEach(script => script.remove());
            await new Promise((resolve, reject) => {
                const next = document.createElement('script');
                next.type = 'module';
                next.async = true;
                next.src = url.href;
                next.onload = resolve;
                next.onerror = () => reject(new Error('重新加载扩展管理器脚本失败'));
                document.body.appendChild(next);
            });
            await waitForManagerMenu();
        })();
        try { await window.__extensionManagerReloadPromise; return true; }
        finally { window.__extensionManagerReloadPromise = null; }
    }

    async function updateSelf($popup) {
        if (!selfUpdateState.canUpdate || selfUpdateState.phase === 'updating') return;
        selfUpdateState.phase = 'updating';
        selfUpdateState.message = '正在更新扩展管理器';
        renderSelfUpdate($popup);
        try {
            const result = await requestSelfExtensionApi('update', { extensionName: selfUpdateState.extensionName, global: selfUpdateState.global });
            if (result.data?.isUpToDate) {
                selfUpdateState.canUpdate = false;
                selfUpdateState.phase = 'latest';
                selfUpdateState.message = `扩展管理器已是最新版本 v${SCRIPT_VERSION}`;
                renderSelfUpdate($popup);
                return;
            }
            if (window.toastr) toastr.success('扩展管理器文件已更新，正在热加载');
            await hotReloadSelf();
        } catch (error) {
            selfUpdateState.phase = 'error';
            selfUpdateState.message = `本体更新失败：${error.message || error}`;
            renderSelfUpdate($popup);
            if (window.toastr) toastr.error(selfUpdateState.message);
        }
    }

    function currentScriptFor(extension) {
        const folder = folderOf(extension).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const entry = String(extension.manifest?.js || "index.js").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`/scripts/extensions/(?:third-party/)?${folder}/${entry}(?:[?#]|$)`, "i");
        return Array.from(document.scripts || []).find(script => pattern.test(script.src || ""));
    }

    async function hotReload(extension) {
        const script = currentScriptFor(extension);
        if (!script) return false;
        const folder = folderOf(extension);
        const cleanupName = `__${folder.replace(/[^a-z0-9_$]/gi, '_')}HotCleanup`;
        if (typeof window[cleanupName] === 'function') { try { window[cleanupName](); } catch (error) {} }
        const source = script.src || `/scripts/extensions/third-party/${folder}/${extension.manifest?.js || "index.js"}`;
        const url = new URL(source, document.baseURI || location.href);
        url.searchParams.set('em_update', Date.now());
        script.remove();
        await new Promise((resolve, reject) => {
            const next = document.createElement('script');
            next.type = script.type || 'module';
            next.async = true;
            next.src = url.href;
            next.onload = resolve;
            next.onerror = () => reject(new Error('重新加载扩展脚本失败'));
            document.body.appendChild(next);
        });
        return true;
    }

    async function updateOne(extension, $popup) {
        const folder = folderOf(extension);
        if (state.updating.has(folder)) return;
        state.updating.add(folder);
        renderList($popup);
        try {
            const data = await request('/api/extensions/update', { method: 'POST', body: JSON.stringify({ extensionName: folder, global: isGlobal(extension) }) });
            if (data?.isUpToDate) {
                state.updates.set(folder, data);
                if (window.toastr) toastr.info(`${extension.displayName} 已是最新版本`);
            } else {
                const isSelf = folder.toLowerCase() === getInstalledExtensionName().toLowerCase();
                const reloaded = isSelf ? await hotReloadSelf() : await hotReload(extension);
                if (window.toastr) toastr.success(reloaded ? `${extension.displayName} 已更新并热加载` : `${extension.displayName} 已更新，请刷新页面`);
                await checkOne(extension);
            }
        } catch (error) {
            state.updates.set(folder, { ...(state.updates.get(folder) || {}), error: error.message || String(error) });
            if (window.toastr) toastr.error(`${extension.displayName} 更新失败：${error.message || error}`);
        } finally { state.updating.delete(folder); renderList($popup); }
    }

    async function install(url, global, branch, $popup) {
        const clean = String(url || '').trim();
        if (!/^https?:\\/\\//i.test(clean)) throw new Error('请输入 HTTP 或 HTTPS 仓库链接');
        await request('/api/extensions/install', { method: 'POST', body: JSON.stringify({ url: clean, global: !!global, branch: String(branch || '').trim() }) });
        if (window.toastr) toastr.success('扩展安装完成');
        await loadExtensions($popup);
    }

    function filteredExtensions() {
        const filter = state.filter.toLowerCase();
        return state.extensions.filter(extension => !filter || [extension.displayName, extension.name, extension.description, repoUrl(extension)].join(' ').toLowerCase().includes(filter)).sort((a, b) => {
            if (state.sort === 'type') return typeOf(a).localeCompare(typeOf(b)) || a.displayName.localeCompare(b.displayName);
            return a.displayName.localeCompare(b.displayName, 'zh-Hans');
        });
    }

    function renderList($popup) {
        const list = filteredExtensions();
        const html = state.checking && !state.extensions.some(item => state.updates.has(folderOf(item)))
            ? '<div class="em-empty"><i class="fa-solid fa-spinner fa-spin"></i><span>正在读取扩展信息</span></div>'
            : list.length ? list.map(renderCard).join('') : '<div class="em-empty"><i class="fa-solid fa-puzzle-piece"></i><span>没有匹配的扩展</span></div>';
        $popup.find('#em-list').html(html);
        $popup.find('#em-count').text(`${state.extensions.length} 个扩展`);
    }

    function renderCard(extension) {
        const folder = folderOf(extension);
        const update = state.updates.get(folder) || {};
        const available = update.isUpToDate === false;
        const repo = repoUrl(extension);
        const branch = update.currentBranchName || '未检测';
        const commit = update.shortCommitHash || update.currentCommitHash?.slice(0, 8) || '';
        const typeLabel = { global: '全局', local: '当前用户', system: '内置' }[typeOf(extension)] || typeOf(extension);
        const status = state.updating.has(folder) ? '更新中' : update.error ? '检测失败' : available ? '有更新' : update.isUpToDate === true ? '已是最新' : '未检测';
        const safeRepo = escapeHtml(repo);
        return `<article class="em-card ${available ? 'is-update' : ''}">
            <div class="em-card-icon"><i class="fa-solid fa-puzzle-piece"></i></div>
            <div class="em-card-body">
                <div class="em-card-head"><div class="em-card-title">${escapeHtml(extension.displayName)} <span class="em-type">${escapeHtml(typeLabel)}</span></div><span class="em-status ${available ? 'update' : ''}">${escapeHtml(status)}</span></div>
                <div class="em-card-sub">${escapeHtml(folder)}${extension.version ? ` · v${escapeHtml(extension.version)}` : ''}${commit ? ` · ${escapeHtml(commit)}` : ''} · ${escapeHtml(branch)}</div>
                <div class="em-card-note">${escapeHtml(extension.description)}</div>
                <div class="em-card-actions">
                    ${repo ? `<a class="em-action" href="${safeRepo}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-code-branch"></i> 仓库</a>` : '<span class="em-action muted"><i class="fa-solid fa-code-branch"></i> 暂无仓库</span>'}
                    <button type="button" class="em-action em-edit" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-pen"></i> 中文资料</button>
                    ${isExternal(extension) ? `<button type="button" class="em-action em-check" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-arrows-rotate"></i> 检查</button>${available ? `<button type="button" class="em-action primary em-update" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button>` : ""}` : ""}
                </div>
                <div class="em-editor" data-editor="${escapeHtml(folder)}" hidden><label>中文名<input class="em-name-input" value="${escapeHtml(extension.zhName || '')}" maxlength="80"></label><label>备注<textarea class="em-note-input" maxlength="500">${escapeHtml(extension.note || '')}</textarea></label><button type="button" class="em-save-meta primary" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-floppy-disk"></i> 保存</button></div>
            </div>
        </article>`;
    }

    function renderBackendState($popup) {
        const $status = $popup.find('.em-backend-state');
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        $status.text(state.backend.available ? `服务端存储已连接${state.backend.version ? ` v${state.backend.version}` : ''}` : '服务端存储未连接');
        if (!state.backend.available && state.backend.error) $status.attr('title', state.backend.error);
    }

    async function loadExtensions($popup) {
        $popup.find('#em-list').html('<div class="em-empty"><i class="fa-solid fa-spinner fa-spin"></i><span>正在连接酒馆扩展接口</span></div>');
        try {
            await loadServerMeta();
            renderBackendState($popup);
            await discover();
            renderList($popup);
            void checkAll($popup);
        } catch (error) {
            $popup.find('#em-list').html(`<div class="em-empty em-error"><i class="fa-solid fa-triangle-exclamation"></i><span>读取失败：${escapeHtml(error.message || error)}</span></div>`);
        }
    }

    function injectStyle() {
        $(`#${STYLE_ID}`).remove();
        $('head').append(`<style id="${STYLE_ID}">
            .em-overlay{position:fixed;inset:0;z-index:99999;background:transparent}.em-box{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(94vw,900px);height:min(86vh,850px);background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(12px);border-radius:18px;box-shadow:0 14px 50px rgba(0,0,0,.24);display:flex;flex-direction:column;overflow:hidden;color:var(--SmartThemeBodyColor);font-family:sans-serif}.em-header{display:flex;justify-content:space-between;align-items:center;padding:17px 21px;border-bottom:1px solid rgba(0,0,0,.07);flex-shrink:0}.em-title{font-weight:700;font-size:1.15em;display:flex;align-items:center;gap:9px}.em-title i{color:var(--SmartThemeQuoteColor)}.em-version{font-size:.68em;opacity:.58;font-weight:400}.em-subtitle{font-size:.8em;opacity:.62;margin-top:3px}.em-backend-state.ok{color:#278d50}.em-backend-state.error{color:#c45c5c}.em-head-actions{display:flex;gap:5px}.em-icon{width:32px;height:32px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;opacity:.62;font-size:1.1em}.em-icon:hover{opacity:1;background:rgba(0,0,0,.06);color:var(--SmartThemeQuoteColor)}.em-toolbar{display:flex;gap:8px;padding:10px 15px;background:rgba(0,0,0,.025);border-bottom:1px solid rgba(0,0,0,.06);flex-shrink:0}.em-tab{flex:1;min-height:35px;padding:7px 10px;border:1px solid rgba(0,0,0,.12);border-radius:8px;background:rgba(255,255,255,.56);color:inherit;cursor:pointer;font-size:.86em}.em-tab.active,.em-tab:hover{background:var(--SmartThemeQuoteColor);border-color:var(--SmartThemeQuoteColor);color:#fff}.em-content{flex:1;overflow-y:auto;padding:15px}.em-panel{display:none}.em-panel.active{display:block}.em-list-head{display:flex;align-items:center;gap:9px;margin-bottom:13px}.em-search{flex:1;min-width:0;padding:9px 11px;border:1px solid rgba(0,0,0,.14);border-radius:8px;background:rgba(255,255,255,.68);color:inherit}.em-select{width:105px;padding:9px 8px;border:1px solid rgba(0,0,0,.14);border-radius:8px;background:rgba(255,255,255,.68);color:inherit}.em-count{font-size:.8em;opacity:.62;white-space:nowrap}.em-list{display:flex;flex-direction:column;gap:11px}.em-card{display:flex;gap:12px;padding:14px;background:rgba(255,255,255,.68);border:1px solid rgba(0,0,0,.07);border-radius:12px;transition:.2s}.em-card:hover{border-color:var(--SmartThemeQuoteColor);box-shadow:0 5px 15px rgba(0,0,0,.06)}.em-card.is-update{border-left:3px solid #d49435}.em-card-icon{width:38px;height:38px;flex:0 0 38px;border-radius:10px;background:color-mix(in srgb,var(--SmartThemeQuoteColor) 15%,transparent);display:flex;align-items:center;justify-content:center;color:var(--SmartThemeQuoteColor);font-size:1.15em}.em-card-body{min-width:0;flex:1}.em-card-head{display:flex;align-items:center;gap:10px}.em-card-title{min-width:0;flex:1;font-weight:700;overflow-wrap:anywhere}.em-type{display:inline-flex;padding:2px 7px;border-radius:5px;background:rgba(0,0,0,.07);font-size:.68em;font-weight:400;opacity:.75}.em-status{font-size:.74em;opacity:.62;white-space:nowrap}.em-status.update{color:#b97818;font-weight:700;opacity:1}.em-card-sub{margin-top:4px;font: .75em monospace;opacity:.58;overflow-wrap:anywhere}.em-card-note{margin-top:8px;font-size:.84em;line-height:1.45;opacity:.77;overflow-wrap:anywhere}.em-card-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.em-action{min-height:30px;padding:6px 10px;border:1px solid rgba(0,0,0,.13);border-radius:7px;background:rgba(255,255,255,.5);color:inherit;text-decoration:none;cursor:pointer;font-size:.78em;display:inline-flex;align-items:center;justify-content:center;gap:5px}.em-action:hover{border-color:var(--SmartThemeQuoteColor);color:var(--SmartThemeQuoteColor)}.em-action.primary{background:var(--SmartThemeQuoteColor);border-color:var(--SmartThemeQuoteColor);color:#fff}.em-action.muted{opacity:.5;cursor:default}.em-editor{display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:end;margin-top:11px;padding-top:11px;border-top:1px solid rgba(0,0,0,.08)}.em-editor label{display:flex;flex-direction:column;gap:4px;font-size:.75em;opacity:.78}.em-editor input,.em-editor textarea{box-sizing:border-box;width:100%;min-height:32px;padding:7px 8px;border:1px solid rgba(0,0,0,.14);border-radius:7px;background:rgba(255,255,255,.7);color:inherit;font:inherit}.em-editor textarea{min-height:32px;resize:vertical}.em-install{max-width:680px;margin:4px auto;padding:18px;background:rgba(255,255,255,.65);border:1px solid rgba(0,0,0,.07);border-radius:12px;display:flex;flex-direction:column;gap:11px}.em-install h3{margin:0;font-size:1em}.em-install label{display:flex;flex-direction:column;gap:5px;font-size:.8em;opacity:.8}.em-install input,.em-install select{padding:9px 10px;border:1px solid rgba(0,0,0,.14);border-radius:8px;background:rgba(255,255,255,.72);color:inherit;font:inherit}.em-install-row{display:flex;gap:9px}.em-install-row>*{flex:1}.em-install button{min-height:36px}.em-update-layout{display:flex;flex-direction:column;gap:12px}.em-update-actions{display:flex;gap:8px}.em-update-actions>*{flex:1}.em-self-update-status{margin:0;font-size:.84em;opacity:.72}.em-self-update-status.update{color:#b97818;font-weight:700;opacity:1}.em-self-update-status.error{color:#c45c5c}.em-update-self[hidden]{display:none}.em-empty{min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;opacity:.58;text-align:center;font-size:.86em}.em-empty i{font-size:2em}.em-error{color:#c45c5c}.em-box.em-dark{background:rgba(28,28,28,.96);color:#eee}.em-box.em-dark .em-toolbar{background:rgba(0,0,0,.24);border-color:rgba(255,255,255,.1)}.em-box.em-dark .em-tab,.em-box.em-dark .em-search,.em-box.em-dark .em-select,.em-box.em-dark .em-card,.em-box.em-dark .em-install,.em-box.em-dark .em-action,.em-box.em-dark .em-editor input,.em-box.em-dark .em-editor textarea,.em-box.em-dark .em-install input,.em-box.em-dark .em-install select{background:rgba(0,0,0,.3);border-color:rgba(255,255,255,.13);color:#eee}.em-box.em-dark .em-card:hover{background:rgba(255,255,255,.06)}.em-box.em-dark .em-type{background:rgba(255,255,255,.12)}
            @media(max-width:640px){.em-box{height:90vh;width:96vw}.em-header{padding:14px}.em-content{padding:11px}.em-toolbar{gap:5px;padding:8px}.em-tab{font-size:.75em;padding:6px 4px}.em-list-head{flex-wrap:wrap}.em-search{flex-basis:100%;order:-1}.em-editor{grid-template-columns:1fr}.em-card{padding:11px}.em-card-head{align-items:flex-start}.em-status{font-size:.68em}.em-install-row{flex-direction:column}}
        </style>`);
    }

    async function showPopup() {
        if ($('.em-overlay').length) return;
        const dark = false;
        const $popup = $(`<div class="em-overlay"><div class="em-box ${dark ? 'em-dark' : ''}"><header class="em-header"><div><div class="em-title"><i class="fa-solid fa-wand-magic-sparkles"></i>${SCRIPT_NAME}<span class="em-version">v${SCRIPT_VERSION}</span></div><div class="em-subtitle">集中查看与更新酒馆扩展 · <span class="em-backend-state">服务端存储检测中</span></div></div><div class="em-head-actions"><button type="button" class="em-icon em-night" title="切换夜间模式"><i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}"></i></button><button type="button" class="em-icon em-close" title="关闭"><i class="fa-solid fa-xmark"></i></button></div></header><nav class="em-toolbar"><button type="button" class="em-tab active" data-tab="installed"><i class="fa-solid fa-layer-group"></i> 已安装</button><button type="button" class="em-tab" data-tab="install"><i class="fa-solid fa-link"></i> 添加扩展</button><button type="button" class="em-tab" data-tab="updates"><i class="fa-solid fa-cloud-arrow-down"></i> 更新检查</button></nav><main class="em-content"><section class="em-panel active" data-panel="installed"><div class="em-list-head"><input class="em-search" placeholder="搜索扩展、仓库或备注"><select class="em-select"><option value="name">按名称</option><option value="type">按类型</option></select><span id="em-count" class="em-count"></span><button type="button" class="em-action em-refresh" title="重新读取"><i class="fa-solid fa-arrows-rotate"></i></button></div><div id="em-list" class="em-list"></div></section><section class="em-panel" data-panel="install"><form class="em-install"><h3><i class="fa-solid fa-link"></i> 从 Git 仓库添加扩展</h3><label>仓库链接<input name="url" type="url" placeholder="https://github.com/作者/仓库" required></label><div class="em-install-row"><label>分支或标签<input name="branch" placeholder="默认分支"></label><label>安装范围<select name="scope"><option value="local">仅当前用户</option><option value="global">全局安装</option></select></label></div><button type="submit" class="em-action primary"><i class="fa-solid fa-download"></i> 安装扩展</button><div class="em-install-status"></div></form></section><section class="em-panel" data-panel="updates"><div class="em-update-layout"><div class="em-install"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> 扩展管理器本体</h3><p class="em-self-update-status">正在检查本体更新</p><div class="em-update-actions"><button type="button" class="em-action em-check-self"><i class="fa-solid fa-arrows-rotate"></i> 检查本体更新</button><button type="button" class="em-action primary em-update-self" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 立即更新</button></div></div><div class="em-install"><h3><i class="fa-solid fa-arrows-rotate"></i> 批量更新检查</h3><p class="em-card-note">逐个连接酒馆原生版本接口，结果会同步到已安装列表。</p><button type="button" class="em-action primary em-check-all"><i class="fa-solid fa-magnifying-glass"></i> 检查全部扩展</button><button type="button" class="em-action em-update-all"><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部可用扩展</button><div class="em-update-summary"></div></div></div></section></main></div></div>`);
        $('body').append($popup);
        const panelAbortController = new AbortController();
        const close = () => { panelAbortController.abort(); $popup.fadeOut(180, () => $popup.remove()); };
        $popup.on('click', '.em-close', close).on('click', e => { if (e.target === $popup[0]) close(); });
        $popup.on('click', '.em-night', function () { const darkNow = !$popup.find('.em-box').hasClass('em-dark'); $popup.find('.em-box').toggleClass('em-dark', darkNow); $(this).find('i').toggleClass('fa-moon', !darkNow).toggleClass('fa-sun', darkNow); });
        $popup.on('click', '.em-tab', function () { const tab = $(this).data('tab'); $popup.find('.em-tab').removeClass('active'); $(this).addClass('active'); $popup.find('.em-panel').removeClass('active'); $popup.find(`[data-panel="${tab}"]`).addClass('active'); });
        $popup.on('input', '.em-search', function () { state.filter = $(this).val(); renderList($popup); });
        $popup.on('change', '.em-select', function () { state.sort = $(this).val(); renderList($popup); });
        $popup.on('click', '.em-refresh', () => loadExtensions($popup));
        $popup.on('click', '.em-check-self', () => checkSelfUpdate($popup, panelAbortController.signal));
        $popup.on('click', '.em-update-self', () => updateSelf($popup));
        $popup.on('click', '.em-check-all', () => checkAll($popup));
        $popup.on('click', '.em-update-all', async () => { await Promise.all(state.extensions.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false).map(extension => updateOne(extension, $popup))); });
        $popup.on('click', '.em-check', async function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (extension) { await checkOne(extension); renderList($popup); } });
        $popup.on('click', '.em-update', function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (extension) updateOne(extension, $popup); });
        $popup.on("click", ".em-edit", function () { const folder = $(this).data("folder"); $popup.find(".em-editor").filter(function () { return $(this).data("editor") === folder; }).prop("hidden", false); });
        $popup.on('click', '.em-save-meta', async function () {
            const folder = $(this).data('folder');
            const extension = state.extensions.find(item => folderOf(item) === folder);
            if (!extension) return;
            const $button = $(this);
            const editor = $popup.find('.em-editor').filter(function () { return $(this).data('editor') === folder; });
            const nextMeta = { ...state.meta, [folder]: { name: String(editor.find('.em-name-input').val() || '').trim(), note: String(editor.find('.em-note-input').val() || '').trim() } };
            $button.prop('disabled', true);
            try {
                await saveServerMeta(nextMeta);
                const saved = state.meta[folder] || {};
                extension.zhName = saved.name || chineseValue(extension.manifest, ['display_name_zh', 'displayNameZh', 'zh_name', 'name_zh']);
                extension.note = saved.note || chineseValue(extension.manifest, ['description_zh', 'descriptionZh', 'zh_description', 'note_zh', 'remarks_zh']);
                extension.displayName = extension.zhName || extension.manifest.display_name || folder;
                extension.description = extension.note || extension.manifest.description || '暂无备注';
                renderList($popup);
                if (window.toastr) toastr.success('中文资料已保存到酒馆后端');
            } catch (error) {
                if (window.toastr) toastr.error(`保存失败：${error.message || error}`);
                $button.prop('disabled', false);
            }
        });
        void checkSelfUpdate($popup, panelAbortController.signal);
        await loadExtensions($popup);
    }

    function injectMenu() {
        const $menu = $('#extensionsMenu');
        if (!$menu.length || $(`#${MENU_BTN_ID}`).length) return;
        const $item = $(`<div id="${MENU_BTN_ID}" class="list-group-item flex-container flexGap5 interactable" title="${SCRIPT_NAME}"><i class="fa-solid fa-wand-magic-sparkles"></i><span>${SCRIPT_NAME}</span></div>`);
        $item.on('click', showPopup);
        $menu.append($item);
    }

    injectStyle();
    timers.push(setTimeout(injectMenu, 500));
    timers.push(setInterval(injectMenu, 2000));
    window.__extensionManagerCleanup = () => { timers.splice(0).forEach(timer => { clearTimeout(timer); clearInterval(timer); }); $(`#${MENU_BTN_ID}`).remove(); $('.em-overlay').remove(); $(`#${STYLE_ID}`).remove(); };
})();
