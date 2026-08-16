//name: 扩展管理器

(function () {
    'use strict';

    const SCRIPT_NAME = '扩展管理器';
    const SCRIPT_VERSION = '1.8.0';
    const MENU_BTN_ID = 'st-extension-manager-btn';
    const STYLE_ID = 'st-extension-manager-style';
    const OVERLAY_ID = 'st-extension-manager-overlay';
    const FLOAT_ID = 'st-extension-manager-float';
    const BACKEND_BASE = '/api/plugins/extension-manager';
    const EXTENSION_DEFAULT_FOLDER = 'SillyTavern-Extension-Manager';
    const EXTENSION_RAW_MANIFEST_URL = 'https://raw.githubusercontent.com/qishiwan16-hub/SillyTavern-Extension-Manager/main/manifest.json';
    const INITIAL_SCRIPT_URL = document.currentScript?.src || '';
    const THEME_STORAGE_KEY = 'st-extension-manager-theme';
    const FLOATING_BALL_MIN = 25;
    const FLOATING_BALL_MAX = 56;
    const FLOATING_BALL_DEFAULT = 34;
    const timers = [];
    const state = { extensions: [], filter: '', category: '', sort: 'name', checking: false, updating: new Set(), updates: new Map(), selectedUpdates: new Set(), selectedExtensions: new Set(), expandedGroups: new Set(['内置', '未分组']), groupPicker: '', batchUpdating: false, minimized: false, meta: {}, settings: { floatingBallSize: FLOATING_BALL_DEFAULT }, backend: { available: false, error: '', version: '' } };
    const selfUpdateState = { phase: 'idle', message: '点击按钮检查本体更新', canUpdate: false, latestVersion: '', extensionName: EXTENSION_DEFAULT_FOLDER, global: false };
    const backendUpdateState = { phase: 'idle', message: '点击按钮检测全部已安装后端插件', canUpdate: false, plugins: [], restartRequired: false, batchUpdating: false };
    let extensionApiPromise = null;

    if (typeof window.__extensionManagerCleanup === 'function') window.__extensionManagerCleanup();

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

    function readStoredNightMode() {
        try { return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'; }
        catch (error) { return false; }
    }

    function storeNightMode(dark) {
        try { window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light'); }
        catch (error) {}
    }

    function applyPanelTheme($popup, dark) {
        const enabled = dark === true;
        $popup.find('.em-box').toggleClass('em-dark', enabled);
        const $button = $popup.find('.em-night');
        const label = enabled ? '切换日间模式' : '切换夜间模式';
        $button.attr({ title: label, 'aria-label': label });
        $button.find('i').toggleClass('fa-moon', !enabled).toggleClass('fa-sun', enabled);
    }

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
        if (!response.ok) {
            const error = new Error((await response.text()) || `${response.status} ${response.statusText}`);
            error.status = response.status;
            throw error;
        }
        return response.status === 204 ? {} : response.json();
    }

    function getExtensionApi() {
        if (!extensionApiPromise) extensionApiPromise = import('/scripts/extensions.js');
        return extensionApiPromise;
    }

    const groupOf = extension => typeOf(extension) === 'system' ? '内置' : (String(extension?.category || '').trim() || '未分组');

    async function setExtensionEnabled(extension, enabled, reload = true) {
        const api = await getExtensionApi();
        const action = enabled ? api.enableExtension : api.disableExtension;
        if (typeof action !== 'function') throw new Error('当前酒馆版本不支持扩展启停接口');
        await action(displayPath(extension), reload);
    }

    function normalizeMeta(value) {
        const source = value && typeof value === 'object' ? value : {};
        const result = {};
        Object.entries(source).forEach(([folder, item]) => {
            if (!item || typeof item !== 'object') return;
            const name = String(item.name || '').trim();
            const note = String(item.note || '').trim();
            const rawCategory = String(item.category || '').trim();
            const category = ['内置', '未分组'].includes(rawCategory) ? '' : rawCategory;
            if (name || note || category) result[folder] = { name, note, category };
        });
        return result;
    }

    function normalizeSettings(value) {
        const source = value && typeof value === 'object' ? value : {};
        const parsed = Number.parseInt(source.floatingBallSize, 10);
        const floatingBallSize = Number.isFinite(parsed)
            ? Math.min(FLOATING_BALL_MAX, Math.max(FLOATING_BALL_MIN, parsed))
            : FLOATING_BALL_DEFAULT;
        return { floatingBallSize };
    }

    const getFloatingBar = () => $(`#${FLOAT_ID}`);

    function applyFloatingBallSize($popup) {
        const size = normalizeSettings(state.settings).floatingBallSize;
        state.settings.floatingBallSize = size;
        $popup.css('--em-float-size', `${size}px`);
        getFloatingBar().css('--em-float-size', `${size}px`);
        $popup.find('.em-float-size').val(size);
        $popup.find('.em-float-size-value').text(`${size}px`);
    }

    function resetFloatingBarPosition() {
        const bar = getFloatingBar()[0];
        if (!bar) return;
        ['left', 'top', 'right', 'bottom'].forEach(property => bar.style.removeProperty(property));
    }

    async function loadServerMeta() {
        state.backend = { available: false, error: '', version: '' };
        try {
            const status = await request(`${BACKEND_BASE}/status`, { method: 'GET' });
            const response = await request(`${BACKEND_BASE}/data`, { method: 'GET' });
            const data = response && response.data && typeof response.data === 'object' ? response.data : {};
            state.meta = normalizeMeta(data.extensions);
            state.settings = normalizeSettings(data.settings);
            state.backend = { available: true, error: '', version: String(status?.version || '') };
        } catch (error) {
            state.meta = {};
            state.settings = normalizeSettings(state.settings);
            state.backend = { available: false, error: error.message || String(error), version: '' };
        }
    }

    async function saveServerMeta(meta, settings = state.settings) {
        if (!state.backend.available) throw new Error('服务端存储未连接，请先安装并启用后端插件');
        const payload = { extensions: normalizeMeta(meta), settings: normalizeSettings(settings) };
        const response = await request(`${BACKEND_BASE}/data`, { method: 'PUT', body: JSON.stringify(payload) });
        const data = response && response.data && typeof response.data === 'object' ? response.data : {};
        state.meta = normalizeMeta(data.extensions);
        state.settings = normalizeSettings(data.settings || payload.settings);
        return state.meta;
    }

    async function saveServerSettings(settings) {
        state.settings = normalizeSettings({ ...state.settings, ...(settings || {}) });
        await saveServerMeta(state.meta, state.settings);
        return state.settings;
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
        let extensionApi = null;
        try { extensionApi = await getExtensionApi(); } catch (error) {}
        const enriched = await Promise.all(list.map(async entry => {
            const extension = typeof entry === 'string' ? { name: entry } : { ...(entry || {}) };
            extension.name = String(extension.name || extension.folderName || extension.id || '').trim();
            extension.manifest = await fetchManifest(extension);
            const folder = folderOf(extension);
            const serverMeta = meta[folder] && typeof meta[folder] === 'object' ? meta[folder] : {};
            extension.zhName = serverMeta.name || chineseValue(extension.manifest, ['display_name_zh', 'displayNameZh', 'zh_name', 'name_zh']) || String(extension.manifest.display_name_zh || '').trim();
            extension.note = serverMeta.note || chineseValue(extension.manifest, ['description_zh', 'descriptionZh', 'zh_description', 'note_zh', 'remarks_zh']);
            extension.category = serverMeta.category || '';
            extension.displayName = extension.zhName || extension.manifest.display_name || folder || extension.name;
            extension.description = extension.note || extension.manifest.description || '暂无备注';
            extension.version = extension.manifest.version || '';
            extension.enabled = extensionApi?.findExtension?.(extension.name)?.enabled ?? true;
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

    function renderFloatingButton($popup) {
        const active = Number($popup.data('em-active-detections') || 0) > 0;
        const $bar = getFloatingBar();
        $bar.find('.em-float-state').attr('class', active ? 'em-float-state fa-solid fa-spinner fa-spin' : 'em-float-state fa-solid fa-grip-lines');
        $bar.attr('title', active ? '正在检测更新，可拖动悬浮条' : '拖动悬浮条调整位置');
        $bar.find('.em-float-restore').attr('title', active ? '正在检测更新，点击展开' : '展开扩展管理器');
    }

    function beginDetection($popup) {
        $popup.data('em-active-detections', Number($popup.data('em-active-detections') || 0) + 1);
        renderFloatingButton($popup);
    }

    function finishDetection($popup) {
        const remaining = Math.max(0, Number($popup.data('em-active-detections') || 0) - 1);
        $popup.data('em-active-detections', remaining);
        renderFloatingButton($popup);
        if (remaining === 0 && state.minimized && $popup.is(':visible') && window.toastr) toastr.info('更新检测已完成');
    }

    function minimizePanel($popup) {
        state.minimized = true;
        $popup.addClass('em-minimized').attr('aria-modal', 'false').find('.em-box').attr('hidden', true);
        $popup.find('.em-minimize').attr('aria-expanded', 'false');
        const $bar = getFloatingBar();
        $bar.prop('hidden', false).css({ display: 'flex', visibility: 'visible', pointerEvents: 'auto' });
        renderFloatingButton($popup);
        requestAnimationFrame(() => $bar.find('.em-float-restore').trigger('focus'));
    }

    function restorePanel($popup) {
        state.minimized = false;
        $popup.removeClass('em-minimized').attr('aria-modal', 'true').find('.em-box').removeAttr('hidden');
        $popup.find('.em-minimize').attr('aria-expanded', 'true');
        getFloatingBar().prop('hidden', true).css({ display: '', visibility: '', pointerEvents: '' });
        resetFloatingBarPosition();
        requestAnimationFrame(() => $popup.trigger('focus'));
    }

    async function checkAll($popup) {
        if (state.checking || !state.extensions.length) return;
        state.checking = true;
        beginDetection($popup);
        renderList($popup);
        try {
            const controller = new AbortController();
            state.extensions.filter(isExternal).forEach(extension => extension._checkPromise = checkOne(extension, controller.signal));
            await Promise.all(state.extensions.filter(isExternal).map(extension => extension._checkPromise));
            const availableExtensions = state.extensions.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
            state.selectedUpdates = new Set(availableExtensions.map(folderOf));
            const message = availableExtensions.length ? `发现 ${availableExtensions.length} 个扩展可快速更新` : '其他扩展均为最新版本';
            if (!state.minimized && window.toastr) toastr.info(message);
        } finally {
            state.checking = false;
            renderList($popup);
            renderUpdateSelection($popup);
            finishDetection($popup);
        }
    }

    function getInstalledExtensionName() {
        const scripts = Array.from(document.scripts || []);
        const escapedDefaultFolder = EXTENSION_DEFAULT_FOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const managerPattern = new RegExp(`/scripts/extensions/(?:third-party/)?${escapedDefaultFolder}/index\\.js(?:[?#]|$)`, 'i');
        const source = INITIAL_SCRIPT_URL || scripts.find(script => managerPattern.test(script.src || ''))?.src || '';
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
        beginDetection($popup);
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
        finishDetection($popup);
        return selfUpdateState;
    }

    function normalizeBackendPlugins(value) {
        if (!Array.isArray(value)) return [];
        return value.map(item => ({
            id: String(item?.id || ''),
            name: String(item?.name || item?.id || '未命名后端插件'),
            version: String(item?.version || ''),
            description: String(item?.description || ''),
            currentBranchName: String(item?.currentBranchName || ''),
            shortCommitHash: String(item?.shortCommitHash || ''),
            updateSupported: item?.updateSupported !== false,
            isUpToDate: item?.isUpToDate !== false,
            behind: Math.max(0, Number(item?.behind || 0)),
            error: String(item?.error || ''),
            code: String(item?.code || ''),
            isManager: item?.isManager === true,
            legacy: item?.legacy === true,
            updating: item?.updating === true,
            restartRequired: item?.restartRequired === true,
        })).filter(plugin => plugin.id);
    }

    function renderBackendPluginList($popup) {
        const $list = $popup.find('.em-backend-plugin-list');
        if (!$list.length) return;
        if (!backendUpdateState.plugins.length) {
            const loading = backendUpdateState.phase === 'checking';
            $list.html(`<div class="em-backend-plugin-empty"><i class="fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-server'}"></i><span>${loading ? '正在读取已安装后端插件' : '尚未检测到后端插件'}</span></div>`);
            return;
        }
        $list.html(backendUpdateState.plugins.map(plugin => {
            const available = plugin.updateSupported && !plugin.isUpToDate;
            const status = plugin.updating
                ? '更新中'
                : plugin.restartRequired
                    ? '已更新，待重启'
                    : available
                        ? `可更新${plugin.behind ? ` · 落后 ${plugin.behind}` : ''}`
                        : plugin.updateSupported
                            ? '最新'
                            : '不可自动更新';
            const statusClass = plugin.updating ? 'checking' : (plugin.restartRequired ? 'restart' : (available ? 'update' : (plugin.updateSupported ? 'latest' : 'unsupported')));
            const details = [plugin.id, plugin.version ? `v${plugin.version}` : '', plugin.currentBranchName, plugin.shortCommitHash].filter(Boolean).join(' · ');
            const note = plugin.error || plugin.description;
            return `<div class="em-backend-plugin-row" data-plugin-id="${escapeHtml(plugin.id)}"><div class="em-backend-plugin-main"><div class="em-backend-plugin-copy"><strong>${escapeHtml(plugin.name)}${plugin.isManager ? ' <span class="em-type">管理后端</span>' : ''}</strong><span>${escapeHtml(details)}</span></div><div class="em-backend-plugin-actions"><span class="em-backend-plugin-status ${statusClass}">${escapeHtml(status)}</span>${available ? `<button type="button" class="em-action primary em-update-backend-plugin" data-plugin-id="${escapeHtml(plugin.id)}" ${plugin.updating || backendUpdateState.phase === 'updating' ? 'disabled' : ''}><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button>` : ''}</div></div>${note ? `<p class="${plugin.error ? 'em-backend-plugin-error' : ''}">${escapeHtml(note)}</p>` : ''}</div>`;
        }).join(''));
    }

    function renderBackendUpdate($popup) {
        backendUpdateState.canUpdate = backendUpdateState.plugins.some(plugin => plugin.updateSupported && !plugin.isUpToDate && !plugin.updating);
        const $status = $popup.find('.em-backend-update-status');
        $status.text(backendUpdateState.message).toggleClass('error', backendUpdateState.phase === 'error').toggleClass('update', backendUpdateState.canUpdate).toggleClass('restart', backendUpdateState.restartRequired);
        $popup.find('.em-check-backend').prop('disabled', ['checking', 'updating'].includes(backendUpdateState.phase));
        $popup.find('.em-update-backend').prop('hidden', !backendUpdateState.canUpdate).prop('disabled', backendUpdateState.phase === 'updating');
        renderBackendPluginList($popup);
        renderBackendPanel($popup);
    }

    async function loadLegacyBackendPlugin() {
        const data = await request(`${BACKEND_BASE}/version`, { method: 'GET' });
        return {
            id: 'extension-manager',
            name: '扩展管理器后端',
            version: String(data.version || state.backend.version || ''),
            updateSupported: data.updateSupported !== false,
            isUpToDate: data.isUpToDate !== false,
            behind: Math.max(0, Number(data.behind || 0)),
            currentBranchName: String(data.currentBranchName || ''),
            shortCommitHash: String(data.shortCommitHash || ''),
            error: String(data.error || ''),
            isManager: true,
            legacy: true,
        };
    }

    async function checkBackendUpdate($popup) {
        if (backendUpdateState.phase === 'checking' || backendUpdateState.phase === 'updating') return backendUpdateState;
        if (!state.backend.available) {
            await loadServerMeta();
            renderBackendState($popup);
            if (!state.backend.available) {
                backendUpdateState.phase = 'error';
                backendUpdateState.message = '管理后端未连接，请先安装扩展管理器后端';
                backendUpdateState.canUpdate = false;
                renderBackendUpdate($popup);
                return backendUpdateState;
            }
        }
        backendUpdateState.phase = 'checking';
        backendUpdateState.message = '正在检测全部已安装后端插件';
        backendUpdateState.restartRequired = false;
        beginDetection($popup);
        renderBackendUpdate($popup);
        try {
            let plugins;
            let legacy = false;
            try {
                const data = await request(`${BACKEND_BASE}/plugins?checkUpdates=true`, { method: 'GET' });
                plugins = normalizeBackendPlugins(data.plugins);
            } catch (error) {
                if (error?.status !== 404) throw error;
                plugins = normalizeBackendPlugins([{ ...(await loadLegacyBackendPlugin()), legacy: true }]);
                legacy = true;
            }
            backendUpdateState.plugins = plugins;
            backendUpdateState.canUpdate = plugins.some(plugin => plugin.updateSupported && !plugin.isUpToDate);
            const unsupported = plugins.filter(plugin => !plugin.updateSupported).length;
            const available = plugins.filter(plugin => plugin.updateSupported && !plugin.isUpToDate).length;
            backendUpdateState.phase = available ? 'available' : 'latest';
            backendUpdateState.message = legacy
                ? '管理后端版本较旧；请先更新并手动重启，重启后即可管理其他后端插件'
                : `已检测 ${plugins.length} 个后端插件${available ? `，${available} 个可更新` : '，均无可用更新'}${unsupported ? `，${unsupported} 个无法自动更新` : ''}`;
        } catch (error) {
            backendUpdateState.phase = 'error';
            backendUpdateState.canUpdate = false;
            backendUpdateState.message = `后端插件检测失败：${error.message || error}`;
        } finally {
            renderBackendUpdate($popup);
            finishDetection($popup);
        }
        return backendUpdateState;
    }

    async function updateBackendPlugin(pluginId, $popup, options = {}) {
        const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
        if (!plugin || plugin.updating || !plugin.updateSupported || plugin.isUpToDate || (backendUpdateState.phase === 'updating' && !options.batch)) return false;
        plugin.updating = true;
        backendUpdateState.phase = 'updating';
        backendUpdateState.message = `正在更新：${plugin.name}`;
        renderBackendUpdate($popup);
        try {
            const data = await request(plugin.legacy ? `${BACKEND_BASE}/update` : `${BACKEND_BASE}/plugins/update`, {
                method: 'POST',
                body: plugin.legacy ? '{}' : JSON.stringify({ pluginId: plugin.id }),
            });
            const next = normalizeBackendPlugins([{ ...plugin, ...(data.plugin || {}), version: data.plugin?.version || data.version || plugin.version, isUpToDate: true, updating: false, restartRequired: data.restartRequired === true }])[0];
            Object.assign(plugin, next);
            backendUpdateState.restartRequired = backendUpdateState.restartRequired || data.restartRequired === true;
            backendUpdateState.message = data.message || `${plugin.name} 已更新，请手动重启 Termux 中的 SillyTavern`;
            if (!options.quiet && window.toastr) toastr[data.restartRequired === true ? 'warning' : 'success'](backendUpdateState.message);
            return true;
        } catch (error) {
            plugin.error = error.message || String(error);
            backendUpdateState.message = `${plugin.name} 更新失败：${plugin.error}`;
            if (!options.quiet && window.toastr) toastr.error(backendUpdateState.message);
            return false;
        } finally {
            plugin.updating = false;
            backendUpdateState.canUpdate = backendUpdateState.plugins.some(item => item.updateSupported && !item.isUpToDate);
            if (!backendUpdateState.batchUpdating) backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (backendUpdateState.canUpdate ? 'available' : 'latest');
            renderBackendUpdate($popup);
        }
    }

    async function updateBackend($popup) {
        if (!backendUpdateState.canUpdate || backendUpdateState.batchUpdating) return;
        const targets = backendUpdateState.plugins.filter(plugin => plugin.updateSupported && !plugin.isUpToDate).map(plugin => plugin.id);
        backendUpdateState.batchUpdating = true;
        backendUpdateState.phase = 'updating';
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                backendUpdateState.message = `正在更新后端插件 ${index + 1} / ${targets.length}`;
                renderBackendUpdate($popup);
                if (await updateBackendPlugin(targets[index], $popup, { quiet: true, batch: true })) completed += 1;
            }
            backendUpdateState.message = backendUpdateState.restartRequired
                ? `后端更新完成：${completed} / ${targets.length}。请手动重启 Termux 中的 SillyTavern`
                : `后端检查完成：${completed} / ${targets.length}，无需重启`;
            if (window.toastr) toastr[backendUpdateState.restartRequired ? 'warning' : 'success'](backendUpdateState.message);
        } finally {
            backendUpdateState.batchUpdating = false;
            backendUpdateState.canUpdate = backendUpdateState.plugins.some(plugin => plugin.updateSupported && !plugin.isUpToDate);
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (backendUpdateState.canUpdate ? 'available' : 'latest');
            renderBackendUpdate($popup);
        }
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
                const current = scripts[0];
                if (current?.type) next.type = current.type;
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
        const folder = folderOf(extension);
        const cleanupName = `__${folder.replace(/[^a-z0-9_$]/gi, '_')}HotCleanup`;
        if (typeof window[cleanupName] === 'function') { try { window[cleanupName](); } catch (error) {} }
        const source = script?.src || `/scripts/extensions/${displayPath(extension)}/${extension.manifest?.js || 'index.js'}`;
        const url = new URL(source, document.baseURI || location.href);
        url.searchParams.set('em_update', Date.now());
        if (script) script.remove();
        await new Promise((resolve, reject) => {
            const next = document.createElement('script');
            next.type = script?.type || 'module';
            next.async = true;
            next.src = url.href;
            next.onload = resolve;
            next.onerror = () => reject(new Error('重新加载扩展脚本失败'));
            document.body.appendChild(next);
        });
        return true;
    }

    async function updateOne(extension, $popup, options = {}) {
        const folder = folderOf(extension);
        if (state.updating.has(folder)) return false;
        state.updating.add(folder);
        renderList($popup);
        let success = false;
        try {
            const data = await request('/api/extensions/update', { method: 'POST', body: JSON.stringify({ extensionName: folder, global: isGlobal(extension) }) });
            if (data?.isUpToDate) {
                state.updates.set(folder, data);
                success = true;
                if (!options.quiet && window.toastr) toastr.info(`${extension.displayName} 已是最新版本`);
            } else {
                const isSelf = folder.toLowerCase() === getInstalledExtensionName().toLowerCase();
                if (isSelf) await hotReloadSelf();
                else if (extension.enabled) await hotReload(extension);
                await checkOne(extension);
                success = true;
                if (!options.quiet && window.toastr) toastr.success(`${extension.displayName} 已更新并热加载`);
            }
        } catch (error) {
            state.updates.set(folder, { ...(state.updates.get(folder) || {}), error: error.message || String(error) });
            if (window.toastr) toastr.error(`${extension.displayName} 更新失败：${error.message || error}`);
        } finally {
            state.updating.delete(folder);
            state.selectedUpdates.delete(folder);
            renderList($popup);
            if (!options.deferSelectionRender) renderUpdateSelection($popup);
        }
        return success;
    }

    async function updateSelectedSequentially($popup) {
        if (state.batchUpdating) return;
        const targets = state.extensions.filter(extension => state.selectedUpdates.has(folderOf(extension)) && state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) {
            if (window.toastr) toastr.info('请先选择需要更新的扩展');
            return;
        }
        state.batchUpdating = true;
        const $status = $popup.find('.em-batch-update-status');
        $popup.find('.em-update-selected, .em-update-choice').prop('disabled', true);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                $status.text(`正在更新 ${index + 1} / ${targets.length}：${targets[index].displayName}`);
                if (await updateOne(targets[index], $popup, { quiet: true, deferSelectionRender: true })) completed += 1;
            }
            $status.text(`顺序更新完成：${completed} / ${targets.length}`);
            if (window.toastr) toastr.success(`快速更新完成：${completed} / ${targets.length}`);
        } finally {
            state.batchUpdating = false;
            renderUpdateSelection($popup);
        }
    }

    function filteredExtensions() {
        const filter = state.filter.toLowerCase();
        return state.extensions.filter(extension => {
            const group = groupOf(extension);
            const matchesCategory = !state.category || group === state.category;
            const matchesText = !filter || [extension.displayName, extension.name, extension.description, group, repoUrl(extension)].join(' ').toLowerCase().includes(filter);
            return matchesCategory && matchesText;
        }).sort((a, b) => {
            if (state.sort === 'type') return typeOf(a).localeCompare(typeOf(b)) || a.displayName.localeCompare(b.displayName, 'zh-Hans');
            return a.displayName.localeCompare(b.displayName, 'zh-Hans');
        });
    }

    function renderCategoryOptions($popup) {
        const categories = Array.from(new Set(state.extensions.map(groupOf))).sort((a, b) => {
            if (a === '内置') return -1;
            if (b === '内置') return 1;
            if (a === '未分组') return 1;
            if (b === '未分组') return -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        if (state.category && !categories.includes(state.category)) state.category = '';
        const options = ['<option value="">全部分组</option>', ...categories.map(category => `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`)].join('');
        $popup.find('.em-category-filter').html(options);
    }

    function renderGroupPicker(group) {
        const candidates = state.extensions
            .filter(extension => typeOf(extension) !== 'system' && groupOf(extension) !== group)
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans'));
        const choices = candidates.length
            ? candidates.map(extension => {
                const folder = folderOf(extension);
                return `<label class="em-group-choice"><input type="checkbox" data-folder="${escapeHtml(folder)}" ${state.selectedExtensions.has(folder) ? 'checked' : ''}><span><strong>${escapeHtml(extension.displayName)}</strong><small>${escapeHtml(groupOf(extension))}</small></span></label>`;
            }).join('')
            : '<div class="em-group-picker-empty">没有可添加的扩展</div>';
        return `<div class="em-group-picker" data-group-picker="${escapeHtml(group)}"><div class="em-group-picker-list">${choices}</div><div class="em-group-picker-actions"><button type="button" class="em-action em-group-cancel"><i class="fa-solid fa-xmark"></i> 取消</button><button type="button" class="em-action primary em-group-add-save" data-group="${escapeHtml(group)}" ${candidates.length ? '' : 'disabled'}><i class="fa-solid fa-folder-plus"></i> 添加选中</button></div></div>`;
    }

    function renderGroup(group, extensions) {
        const expanded = state.expandedGroups.has(group) || state.groupPicker === group;
        const custom = group !== '内置' && group !== '未分组';
        const actions = custom
            ? `<div class="em-group-actions"><button type="button" class="em-icon em-group-add" data-group="${escapeHtml(group)}" title="添加扩展" aria-label="向 ${escapeHtml(group)} 添加扩展"><i class="fa-solid fa-folder-plus"></i></button><button type="button" class="em-icon em-group-rename" data-group="${escapeHtml(group)}" title="重命名分组" aria-label="重命名 ${escapeHtml(group)}"><i class="fa-solid fa-pen"></i></button><button type="button" class="em-icon em-group-dissolve" data-group="${escapeHtml(group)}" title="解散分组" aria-label="解散 ${escapeHtml(group)}"><i class="fa-solid fa-folder-minus"></i></button></div>`
            : '';
        const picker = state.groupPicker === group ? renderGroupPicker(group) : '';
        const icon = group === '内置' ? 'fa-box-archive' : (expanded ? 'fa-folder-open' : 'fa-folder');
        return `<section class="em-group" data-group="${escapeHtml(group)}"><header class="em-group-head"><button type="button" class="em-icon em-group-toggle" data-group="${escapeHtml(group)}" title="${expanded ? '收起' : '展开'}分组" aria-label="${expanded ? '收起' : '展开'} ${escapeHtml(group)}" aria-expanded="${expanded}"><i class="fa-solid fa-chevron-${expanded ? 'down' : 'right'}"></i></button><i class="fa-solid ${icon} em-group-folder"></i><strong>${escapeHtml(group)}</strong><span class="em-group-count">${extensions.length}</span>${actions}</header><div class="em-group-content" ${expanded ? '' : 'hidden'}><div class="em-group-cards">${extensions.map(renderCard).join('')}</div>${picker}</div></section>`;
    }

    function renderList($popup) {
        renderCategoryOptions($popup);
        const list = filteredExtensions();
        const groups = new Map();
        list.forEach(extension => {
            const group = groupOf(extension);
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(extension);
        });
        const names = Array.from(groups.keys()).sort((a, b) => {
            if (a === '内置') return -1;
            if (b === '内置') return 1;
            if (a === '未分组') return 1;
            if (b === '未分组') return -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        const html = state.checking && !state.extensions.some(item => state.updates.has(folderOf(item)))
            ? '<div class="em-empty"><i class="fa-solid fa-spinner fa-spin"></i><span>正在读取扩展信息</span></div>'
            : list.length ? names.map(name => renderGroup(name, groups.get(name))).join('') : '<div class="em-empty"><i class="fa-solid fa-puzzle-piece"></i><span>没有匹配的扩展</span></div>';
        $popup.find('#em-list').html(html);
        $popup.find('#em-count').text(`${list.length} / ${state.extensions.length}`);
    }

    async function updateExtensionGroups(assignments) {
        if (!state.backend.available) throw new Error('服务端存储未连接，无法保存分组');
        const nextMeta = { ...state.meta };
        Object.entries(assignments || {}).forEach(([folder, group]) => {
            const current = nextMeta[folder] && typeof nextMeta[folder] === 'object' ? nextMeta[folder] : {};
            const item = { name: String(current.name || ''), note: String(current.note || ''), category: String(group || '').trim() };
            if (item.name || item.note || item.category) nextMeta[folder] = item;
            else delete nextMeta[folder];
        });
        await saveServerMeta(nextMeta);
        state.extensions.forEach(extension => {
            const folder = folderOf(extension);
            if (Object.prototype.hasOwnProperty.call(assignments, folder) && typeOf(extension) !== 'system') {
                extension.category = state.meta[folder]?.category || '';
            }
        });
    }

    function quickUpdateExtensions() {
        return state.extensions.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
    }

    function renderUpdateSelection($popup) {
        const available = quickUpdateExtensions();
        const $container = $popup.find('.em-update-selection');
        if (!$container.length) return;
        if (!available.length) {
            $container.html('<div class="em-update-empty"><i class="fa-solid fa-check"></i> 暂无其他扩展需要更新</div>');
            return;
        }
        const rows = available.map(extension => {
            const folder = folderOf(extension);
            return `<label class="em-update-choice"><input type="checkbox" data-folder="${escapeHtml(folder)}" ${state.selectedUpdates.has(folder) ? 'checked' : ''}><span><strong>${escapeHtml(extension.displayName)}</strong><small>${escapeHtml(folder)} · ${escapeHtml(groupOf(extension))}</small></span></label>`;
        }).join('');
        $container.html(`<div class="em-update-choice-list">${rows}</div><div class="em-update-actions"><button type="button" class="em-action em-select-all"><i class="fa-solid fa-list-check"></i> 全选</button><button type="button" class="em-action primary em-update-selected"><i class="fa-solid fa-bolt"></i> 快速更新选中</button></div><div class="em-batch-update-status"></div>`);
    }

    function renderCard(extension) {
        const folder = folderOf(extension);
        const update = state.updates.get(folder) || {};
        const available = update.isUpToDate === false;
        const repo = repoUrl(extension);
        const branch = update.currentBranchName || '未检测';
        const commit = update.shortCommitHash || update.currentCommitHash?.slice(0, 8) || '';
        const typeLabel = { global: '全局', local: '当前用户', system: '内置' }[typeOf(extension)] || typeOf(extension);
        const status = state.updating.has(folder) ? '更新中' : !extension.enabled ? '已禁用' : update.error ? '检测失败' : available ? '有更新' : update.isUpToDate === true ? '已是最新' : '未检测';
        const safeRepo = escapeHtml(repo);
        const group = groupOf(extension);
        const groupInput = typeOf(extension) === 'system'
            ? '<input class="em-category-input" value="内置" disabled>'
            : `<input class="em-category-input" value="${escapeHtml(extension.category || '')}" maxlength="80" placeholder="输入名称即可形成分组文件夹">`;
        return `<article class="em-card ${available ? 'is-update' : ''} ${extension.enabled ? '' : 'is-disabled'}">
            <div class="em-card-icon"><i class="fa-solid fa-puzzle-piece"></i></div>
            <div class="em-card-body">
                <div class="em-card-head"><div class="em-card-title">${escapeHtml(extension.displayName)} <span class="em-type">${escapeHtml(typeLabel)}</span>${group !== '未分组' ? ` <span class="em-category">${escapeHtml(group)}</span>` : ''}</div><span class="em-status ${available ? 'update' : ''}">${escapeHtml(status)}</span></div>
                <div class="em-card-sub">${escapeHtml(folder)}${extension.version ? ` · v${escapeHtml(extension.version)}` : ''}${commit ? ` · ${escapeHtml(commit)}` : ''} · ${escapeHtml(branch)}</div>
                <div class="em-card-note">${escapeHtml(extension.description)}</div>
                <div class="em-card-actions">
                    ${repo ? `<a class="em-action" href="${safeRepo}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-code-branch"></i> 仓库</a>` : '<span class="em-action muted"><i class="fa-solid fa-code-branch"></i> 暂无仓库</span>'}
                    <button type="button" class="em-action em-edit" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-tags"></i> 中文资料与分组</button>
                    ${isExternal(extension) ? `<button type="button" class="em-action em-toggle" data-folder="${escapeHtml(folder)}" data-enable="${extension.enabled ? 'false' : 'true'}"><i class="fa-solid fa-power-off"></i> ${extension.enabled ? '禁用' : '启用'}</button><button type="button" class="em-action em-check" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-arrows-rotate"></i> 检查</button>${available ? `<button type="button" class="em-action primary em-update" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button>` : ''}` : ''}
                </div>
                <div class="em-editor" data-editor="${escapeHtml(folder)}" hidden><label>中文名<input class="em-name-input" value="${escapeHtml(extension.zhName || '')}" maxlength="80"></label><label>分组${groupInput}</label><label>备注<textarea class="em-note-input" maxlength="500">${escapeHtml(extension.note || '')}</textarea></label><button type="button" class="em-save-meta primary" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-floppy-disk"></i> 保存</button></div>
            </div>
        </article>`;
    }

    function renderBackendPanel($popup) {
        const $status = $popup.find('.em-backend-panel-state');
        if (!$status.length) return;
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        const pluginCount = backendUpdateState.plugins.length;
        $status.text(state.backend.available
            ? `管理后端已连接${state.backend.version ? ` · v${state.backend.version}` : ''}${pluginCount ? ` · 已发现 ${pluginCount} 个后端插件` : ''}`
            : '管理后端未连接');
        $popup.find('.em-backend-install-help').prop('hidden', state.backend.available);
    }

    function renderBackendState($popup) {
        const $status = $popup.find('.em-backend-state');
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        $status.text(state.backend.available ? `服务端存储已连接${state.backend.version ? ` v${state.backend.version}` : ''}` : '服务端存储未连接');
        if (!state.backend.available && state.backend.error) $status.attr('title', state.backend.error);
        renderBackendPanel($popup);
    }

    async function loadExtensions($popup) {
        $popup.find('#em-list').html('<div class="em-empty"><i class="fa-solid fa-spinner fa-spin"></i><span>正在连接酒馆扩展接口</span></div>');
        try {
            await loadServerMeta();
            renderBackendState($popup);
            applyFloatingBallSize($popup);
            await discover();
            renderList($popup);
        } catch (error) {
            $popup.find('#em-list').html(`<div class="em-empty em-error"><i class="fa-solid fa-triangle-exclamation"></i><span>读取失败：${escapeHtml(error.message || error)}</span></div>`);
        }
    }

    function injectStyle() {
        $(`#${STYLE_ID}`).remove();
        $('head').append(`<style id="${STYLE_ID}">
            #st-extension-manager-overlay,
            #st-extension-manager-overlay * {
                box-sizing: border-box;
                letter-spacing: 0;
            }

            #st-extension-manager-overlay {
                --em-accent: var(--SmartThemeQuoteColor, #376f91);
                --em-panel: var(--SmartThemeBlurTintColor, rgba(248, 249, 250, .98));
                --em-surface: rgba(255, 255, 255, .76);
                --em-surface-strong: rgba(255, 255, 255, .94);
                --em-control: rgba(255, 255, 255, .82);
                --em-line: rgba(22, 29, 37, .12);
                --em-line-soft: rgba(22, 29, 37, .07);
                --em-shadow: 0 24px 70px rgba(8, 14, 22, .28);
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483000;
                display: grid !important;
                place-items: center;
                width: 100vw !important;
                height: 100vh !important;
                height: 100dvh !important;
                margin: 0 !important;
                padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
                overflow: hidden;
                transform: none !important;
                background: rgba(10, 16, 24, .34);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                isolation: isolate;
            }

            #st-extension-manager-overlay > .em-box {
                position: relative !important;
                inset: auto !important;
                top: auto !important;
                right: auto !important;
                bottom: auto !important;
                left: auto !important;
                transform: none !important;
                width: min(550px, 90vw) !important;
                height: min(760px, 80vh) !important;
                height: min(760px, 80dvh) !important;
                min-width: 0;
                min-height: 0;
                max-width: 550px !important;
                max-height: 100% !important;
                margin: 0 !important;
                border: 1px solid rgba(255, 255, 255, .28);
                border-radius: 8px;
                background: var(--em-panel);
                box-shadow: var(--em-shadow);
                color: var(--SmartThemeBodyColor, #20262d);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                animation: em-panel-in .18s ease-out;
            }

            @keyframes em-panel-in {
                from { opacity: 0; scale: .985; }
                to { opacity: 1; scale: 1; }
            }

            #st-extension-manager-overlay .em-box[hidden] { display: none !important; }
            #st-extension-manager-overlay button,
            #st-extension-manager-overlay input,
            #st-extension-manager-overlay select,
            #st-extension-manager-overlay textarea { font: inherit; }
            #st-extension-manager-overlay button:focus-visible,
            #st-extension-manager-overlay a:focus-visible,
            #st-extension-manager-overlay input:focus-visible,
            #st-extension-manager-overlay select:focus-visible,
            #st-extension-manager-overlay textarea:focus-visible {
                outline: 2px solid var(--em-accent);
                outline-offset: 2px;
            }

            #st-extension-manager-overlay .em-header {
                min-height: 64px;
                padding: 10px 13px 9px 15px;
                border-bottom: 1px solid var(--em-line);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                flex: 0 0 auto;
                background: rgba(255, 255, 255, .18);
            }
            #st-extension-manager-overlay .em-header > div:first-child { min-width: 0; }
            #st-extension-manager-overlay .em-title {
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 9px;
                font-size: 1.05em;
                font-weight: 700;
                line-height: 1.25;
            }
            #st-extension-manager-overlay .em-title > i {
                width: 34px;
                height: 34px;
                border: 1px solid color-mix(in srgb, var(--em-accent) 32%, transparent);
                border-radius: 7px;
                background: color-mix(in srgb, var(--em-accent) 13%, transparent);
                color: var(--em-accent);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 34px;
            }
            #st-extension-manager-overlay .em-version {
                padding: 2px 6px;
                border: 1px solid var(--em-line);
                border-radius: 5px;
                font-size: .64em;
                font-weight: 500;
                opacity: .65;
            }
            #st-extension-manager-overlay .em-subtitle {
                margin: 3px 0 0 43px;
                min-height: 17px;
                font-size: .76em;
                opacity: .68;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #st-extension-manager-overlay .em-backend-state.ok { color: #278d50; opacity: 1; }
            #st-extension-manager-overlay .em-backend-state.error { color: #b94e55; opacity: 1; }
            #st-extension-manager-overlay .em-head-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
            #st-extension-manager-overlay .em-icon {
                width: 34px;
                height: 34px;
                padding: 0;
                border: 1px solid transparent;
                border-radius: 6px;
                background: transparent;
                color: inherit;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                opacity: .62;
            }
            #st-extension-manager-overlay .em-icon:hover {
                border-color: var(--em-line);
                background: var(--em-surface);
                color: var(--em-accent);
                opacity: 1;
            }

            #st-extension-manager-overlay .em-toolbar {
                min-height: 50px;
                padding: 8px 14px;
                border-bottom: 1px solid var(--em-line);
                background: rgba(0, 0, 0, .025);
                display: flex;
                align-items: center;
                gap: 6px;
                flex: 0 0 auto;
            }
            #st-extension-manager-overlay .em-tab {
                min-width: 0;
                min-height: 34px;
                padding: 7px 12px;
                border: 1px solid transparent;
                border-radius: 6px;
                background: transparent;
                color: inherit;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                flex: 1 1 0;
                cursor: pointer;
                font-size: .83em;
                font-weight: 600;
                opacity: .66;
            }
            #st-extension-manager-overlay .em-tab:hover { background: var(--em-surface); color: var(--em-accent); opacity: 1; }
            #st-extension-manager-overlay .em-tab.active {
                border-color: color-mix(in srgb, var(--em-accent) 35%, transparent);
                background: color-mix(in srgb, var(--em-accent) 12%, var(--em-surface));
                color: var(--em-accent);
                opacity: 1;
            }

            #st-extension-manager-overlay .em-content {
                min-width: 0;
                min-height: 0;
                padding: 14px;
                flex: 1 1 auto;
                overflow-x: hidden;
                overflow-y: auto;
                overscroll-behavior: contain;
                scrollbar-gutter: stable;
            }
            #st-extension-manager-overlay .em-panel { display: none; min-width: 0; }
            #st-extension-manager-overlay .em-panel.active { display: block; animation: em-content-in .14s ease-out; }
            #st-extension-manager-overlay .em-frontend-tools {
                margin: -2px -2px 12px;
                padding: 2px 2px 12px;
                border-bottom: 1px solid var(--em-line);
                display: flex;
                flex-direction: column;
                gap: 9px;
            }
            #st-extension-manager-overlay .em-tool-row {
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            #st-extension-manager-overlay .em-tool-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; }
            #st-extension-manager-overlay .em-tool-copy strong { font-size: .82em; }
            #st-extension-manager-overlay .em-tool-copy span { min-height: 0; font-size: .72em; line-height: 1.4; opacity: .62; }
            #st-extension-manager-overlay .em-tool-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
            #st-extension-manager-overlay .em-float-size-control {
                min-width: 0;
                display: grid;
                grid-template-columns: auto minmax(90px, 1fr) 42px;
                align-items: center;
                gap: 9px;
                font-size: .74em;
            }
            #st-extension-manager-overlay .em-float-size { width: 100%; min-height: 20px; padding: 0; accent-color: var(--em-accent); }
            #st-extension-manager-overlay .em-float-size-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; opacity: .68; }
            @keyframes em-content-in {
                from { opacity: 0; transform: translateY(3px); }
                to { opacity: 1; transform: translateY(0); }
            }

            #st-extension-manager-overlay .em-list-head {
                position: sticky;
                top: -14px;
                z-index: 4;
                min-width: 0;
                margin: -2px -2px 12px;
                padding: 2px 2px 10px;
                background: var(--em-panel);
                display: flex;
                align-items: center;
                gap: 8px;
            }
            #st-extension-manager-overlay .em-search-field {
                min-width: 180px;
                min-height: 36px;
                padding: 0 10px;
                border: 1px solid var(--em-line);
                border-radius: 6px;
                background: var(--em-control);
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1 1 280px;
            }
            #st-extension-manager-overlay .em-search-field > i { color: var(--em-accent); opacity: .7; }
            #st-extension-manager-overlay .em-search {
                min-width: 0;
                width: 100%;
                height: 34px;
                padding: 0;
                border: 0;
                outline: 0;
                background: transparent;
                color: inherit;
            }
            #st-extension-manager-overlay .em-select,
            #st-extension-manager-overlay .em-category-filter {
                width: 112px;
                min-height: 36px;
                padding: 7px 8px;
                border: 1px solid var(--em-line);
                border-radius: 6px;
                background: var(--em-control);
                color: inherit;
            }
            #st-extension-manager-overlay .em-count { font-size: .76em; opacity: .62; white-space: nowrap; }

            #st-extension-manager-overlay .em-list { display: flex; flex-direction: column; gap: 8px; }
            #st-extension-manager-overlay .em-group { min-width: 0; border-top: 1px solid var(--em-line); }
            #st-extension-manager-overlay .em-group:first-child { border-top: 0; }
            #st-extension-manager-overlay .em-group-head {
                min-height: 42px;
                display: flex;
                align-items: center;
                gap: 7px;
            }
            #st-extension-manager-overlay .em-group-head > strong { min-width: 0; overflow-wrap: anywhere; font-size: .84em; }
            #st-extension-manager-overlay .em-group-toggle { width: 28px; height: 28px; flex: 0 0 28px; font-size: .72em; }
            #st-extension-manager-overlay .em-group-folder { color: var(--em-accent); opacity: .78; }
            #st-extension-manager-overlay .em-group-count { min-width: 22px; padding: 1px 6px; border-radius: 4px; background: rgba(0, 0, 0, .055); font-size: .68em; text-align: center; opacity: .68; }
            #st-extension-manager-overlay .em-group-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
            #st-extension-manager-overlay .em-group-actions .em-icon { width: 28px; height: 28px; font-size: .78em; }
            #st-extension-manager-overlay .em-group-content[hidden] { display: none; }
            #st-extension-manager-overlay .em-group-cards { display: flex; flex-direction: column; gap: 8px; padding: 0 0 8px 35px; }
            #st-extension-manager-overlay .em-group-picker { margin: 0 0 10px 35px; padding: 10px; border: 1px solid var(--em-line); border-radius: 6px; background: var(--em-surface); }
            #st-extension-manager-overlay .em-group-picker-list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; }
            #st-extension-manager-overlay .em-group-choice { min-width: 0; padding: 6px 7px; display: flex !important; flex-direction: row !important; align-items: center; gap: 8px; cursor: pointer; }
            #st-extension-manager-overlay .em-group-choice input { width: 16px; height: 16px; min-height: 16px; padding: 0; flex: 0 0 16px; accent-color: var(--em-accent); }
            #st-extension-manager-overlay .em-group-choice span { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
            #st-extension-manager-overlay .em-group-choice strong { font-size: .78em; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-group-choice small { font-size: .68em; opacity: .58; }
            #st-extension-manager-overlay .em-group-picker-actions { margin-top: 9px; display: flex; justify-content: flex-end; gap: 7px; }
            #st-extension-manager-overlay .em-group-picker-empty { padding: 10px; text-align: center; font-size: .76em; opacity: .6; }
            #st-extension-manager-overlay .em-card {
                min-width: 0;
                padding: 12px;
                border: 1px solid var(--em-line-soft);
                border-radius: 7px;
                background: var(--em-surface);
                display: grid;
                grid-template-columns: 40px minmax(0, 1fr);
                gap: 11px;
                transition: border-color .16s ease, background-color .16s ease, box-shadow .16s ease;
            }
            #st-extension-manager-overlay .em-card:hover {
                border-color: color-mix(in srgb, var(--em-accent) 50%, transparent);
                background: var(--em-surface-strong);
                box-shadow: 0 5px 18px rgba(15, 25, 36, .07);
            }
            #st-extension-manager-overlay .em-card.is-update { border-left: 3px solid #c88628; }
            #st-extension-manager-overlay .em-card.is-disabled { opacity: .62; }
            #st-extension-manager-overlay .em-card-icon {
                width: 40px;
                height: 40px;
                border: 1px solid color-mix(in srgb, var(--em-accent) 24%, transparent);
                border-radius: 7px;
                background: color-mix(in srgb, var(--em-accent) 10%, transparent);
                color: var(--em-accent);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1em;
            }
            #st-extension-manager-overlay .em-card-body { min-width: 0; }
            #st-extension-manager-overlay .em-card-head { min-width: 0; display: flex; align-items: flex-start; gap: 10px; }
            #st-extension-manager-overlay .em-card-title {
                min-width: 0;
                flex: 1 1 auto;
                font-size: .92em;
                font-weight: 700;
                line-height: 1.45;
                overflow-wrap: anywhere;
            }
            #st-extension-manager-overlay .em-type,
            #st-extension-manager-overlay .em-category {
                display: inline-flex;
                align-items: center;
                margin-left: 4px;
                padding: 1px 6px;
                border-radius: 4px;
                font-size: .68em;
                font-weight: 500;
                vertical-align: 1px;
            }
            #st-extension-manager-overlay .em-type { background: rgba(68, 79, 91, .1); opacity: .74; }
            #st-extension-manager-overlay .em-category { background: rgba(39, 141, 80, .12); color: #257d48; }
            #st-extension-manager-overlay .em-status {
                min-height: 22px;
                padding: 3px 7px;
                border: 1px solid var(--em-line-soft);
                border-radius: 5px;
                background: rgba(75, 86, 98, .05);
                flex: 0 0 auto;
                font-size: .7em;
                white-space: nowrap;
                opacity: .68;
            }
            #st-extension-manager-overlay .em-status.update { border-color: rgba(200, 134, 40, .32); background: rgba(200, 134, 40, .1); color: #a96613; opacity: 1; }
            #st-extension-manager-overlay .em-card-sub {
                margin-top: 3px;
                font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
                font-size: .72em;
                line-height: 1.45;
                opacity: .54;
                overflow-wrap: anywhere;
            }
            #st-extension-manager-overlay .em-card-note { margin-top: 7px; font-size: .8em; line-height: 1.5; opacity: .72; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-card-actions { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 6px; }

            #st-extension-manager-overlay .em-action,
            #st-extension-manager-overlay .em-save-meta {
                min-height: 32px;
                padding: 6px 10px;
                border: 1px solid var(--em-line);
                border-radius: 6px;
                background: var(--em-control);
                color: inherit;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                cursor: pointer;
                font-size: .76em;
                transition: border-color .14s ease, background-color .14s ease, color .14s ease;
            }
            #st-extension-manager-overlay .em-action:hover,
            #st-extension-manager-overlay .em-save-meta:hover { border-color: var(--em-accent); color: var(--em-accent); }
            #st-extension-manager-overlay .em-action.primary,
            #st-extension-manager-overlay .em-save-meta.primary { border-color: var(--em-accent); background: var(--em-accent); color: #fff; }
            #st-extension-manager-overlay .em-action.primary:hover,
            #st-extension-manager-overlay .em-save-meta.primary:hover { filter: brightness(1.08); color: #fff; }
            #st-extension-manager-overlay .em-action.muted { cursor: default; opacity: .48; }
            #st-extension-manager-overlay button:disabled { cursor: wait; opacity: .5; }

            #st-extension-manager-overlay .em-editor {
                margin-top: 10px;
                padding: 11px;
                border: 1px solid var(--em-line-soft);
                border-radius: 6px;
                background: rgba(0, 0, 0, .025);
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                align-items: end;
                gap: 8px;
            }
            #st-extension-manager-overlay .em-editor[hidden] { display: none; }
            #st-extension-manager-overlay .em-editor label:nth-child(3) { grid-column: 1 / -1; }
            #st-extension-manager-overlay .em-editor .em-save-meta { grid-column: 1 / -1; justify-self: end; }
            #st-extension-manager-overlay .em-editor label,
            #st-extension-manager-overlay .em-install label { min-width: 0; display: flex; flex-direction: column; gap: 5px; font-size: .76em; opacity: .8; }
            #st-extension-manager-overlay .em-editor input,
            #st-extension-manager-overlay .em-editor textarea,
            #st-extension-manager-overlay .em-install input:not([type="checkbox"]),
            #st-extension-manager-overlay .em-install select {
                width: 100%;
                min-width: 0;
                min-height: 36px;
                padding: 7px 9px;
                border: 1px solid var(--em-line);
                border-radius: 6px;
                background: var(--em-control);
                color: inherit;
            }
            #st-extension-manager-overlay .em-editor textarea { resize: vertical; }

            #st-extension-manager-overlay .em-install {
                width: 100%;
                max-width: 720px;
                margin: 0 auto;
                padding: 16px;
                border: 1px solid var(--em-line-soft);
                border-radius: 7px;
                background: var(--em-surface);
                display: flex;
                flex-direction: column;
                gap: 11px;
            }
            #st-extension-manager-overlay .em-install h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: .9em; }
            #st-extension-manager-overlay .em-install h3 i { color: var(--em-accent); }
            #st-extension-manager-overlay .em-install-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, .45fr); gap: 9px; }
            #st-extension-manager-overlay .em-install > button { min-height: 36px; }
            #st-extension-manager-overlay .em-update-layout { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 10px; }
            #st-extension-manager-overlay .em-update-layout .em-install { max-width: none; margin: 0; }
            #st-extension-manager-overlay .em-update-layout .em-install:last-child { grid-column: auto; }
            #st-extension-manager-overlay .em-update-actions { display: flex; gap: 7px; }
            #st-extension-manager-overlay .em-update-actions > * { min-width: 0; flex: 1 1 0; }
            #st-extension-manager-overlay .em-self-update-status,
            #st-extension-manager-overlay .em-backend-update-status { min-height: 34px; margin: 0; font-size: .8em; line-height: 1.45; opacity: .7; }
            #st-extension-manager-overlay .em-self-update-status.update,
            #st-extension-manager-overlay .em-backend-update-status.update,
            #st-extension-manager-overlay .em-backend-update-status.restart { color: #a96613; font-weight: 700; opacity: 1; }
            #st-extension-manager-overlay .em-self-update-status.error,
            #st-extension-manager-overlay .em-backend-update-status.error,
            #st-extension-manager-overlay .em-error { color: #b94e55; }
            #st-extension-manager-overlay .em-backend-panel-state { min-height: 22px; margin: 0; font-size: .82em; font-weight: 600; }
            #st-extension-manager-overlay .em-backend-panel-state.ok { color: #278d50; }
            #st-extension-manager-overlay .em-backend-panel-state.error { color: #b94e55; }
            #st-extension-manager-overlay .em-backend-install-help { padding: 10px; border: 1px solid var(--em-line-soft); border-radius: 6px; background: rgba(0, 0, 0, .025); font-size: .78em; line-height: 1.5; }
            #st-extension-manager-overlay .em-backend-install-help[hidden] { display: none; }
            #st-extension-manager-overlay .em-backend-install-help p { margin: 0 0 7px; }
            #st-extension-manager-overlay .em-backend-install-help p:last-child { margin-bottom: 0; }
            #st-extension-manager-overlay .em-backend-install-help pre { margin: 7px 0; padding: 8px; overflow-x: auto; border-radius: 5px; background: rgba(0, 0, 0, .07); font: .9em/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
            #st-extension-manager-overlay .em-backend-plugin-list { min-width: 0; border-top: 1px solid var(--em-line-soft); border-bottom: 1px solid var(--em-line-soft); }
            #st-extension-manager-overlay .em-backend-plugin-row { min-width: 0; padding: 10px 0; border-bottom: 1px solid var(--em-line-soft); }
            #st-extension-manager-overlay .em-backend-plugin-row:last-child { border-bottom: 0; }
            #st-extension-manager-overlay .em-backend-plugin-main { min-width: 0; display: flex; align-items: center; gap: 10px; }
            #st-extension-manager-overlay .em-backend-plugin-copy { min-width: 0; display: flex; flex: 1 1 auto; flex-direction: column; gap: 3px; }
            #st-extension-manager-overlay .em-backend-plugin-copy strong { min-width: 0; font-size: .82em; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-backend-plugin-copy > span { font: .7em/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; opacity: .58; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-backend-plugin-actions { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; }
            #st-extension-manager-overlay .em-backend-plugin-status { font-size: .7em; white-space: nowrap; opacity: .68; }
            #st-extension-manager-overlay .em-backend-plugin-status.update,
            #st-extension-manager-overlay .em-backend-plugin-status.restart { color: #a96613; font-weight: 700; opacity: 1; }
            #st-extension-manager-overlay .em-backend-plugin-status.latest { color: #278d50; opacity: 1; }
            #st-extension-manager-overlay .em-backend-plugin-status.unsupported,
            #st-extension-manager-overlay .em-backend-plugin-error { color: #b94e55; }
            #st-extension-manager-overlay .em-backend-plugin-row > p { margin: 6px 0 0; font-size: .72em; line-height: 1.45; opacity: .66; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-backend-plugin-empty { min-height: 92px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: .78em; opacity: .6; }
            #st-extension-manager-overlay .em-backend-update-note { margin: 0; font-size: .76em; line-height: 1.45; opacity: .68; }
            #st-extension-manager-overlay .em-update-self[hidden],
            #st-extension-manager-overlay .em-update-backend[hidden] { display: none; }
            #st-extension-manager-overlay .em-update-choice-list { display: flex; flex-direction: column; gap: 6px; }
            #st-extension-manager-overlay .em-update-choice {
                min-width: 0;
                padding: 8px 9px;
                border: 1px solid var(--em-line-soft);
                border-radius: 6px;
                background: rgba(0, 0, 0, .02);
                display: flex !important;
                flex-direction: row !important;
                align-items: center;
                gap: 9px;
                cursor: pointer;
            }
            #st-extension-manager-overlay .em-update-choice input { width: 16px; height: 16px; min-height: 16px; padding: 0; flex: 0 0 16px; accent-color: var(--em-accent); }
            #st-extension-manager-overlay .em-update-choice span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
            #st-extension-manager-overlay .em-update-choice strong { font-size: .82em; }
            #st-extension-manager-overlay .em-update-choice small { font-size: .7em; opacity: .58; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-update-empty,
            #st-extension-manager-overlay .em-batch-update-status { padding: 8px 0; font-size: .78em; opacity: .62; }
            #st-extension-manager-overlay .em-empty {
                min-height: 210px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 11px;
                text-align: center;
                font-size: .82em;
                opacity: .56;
            }
            #st-extension-manager-overlay .em-empty i { font-size: 1.8em; }

            #st-extension-manager-overlay .em-box.em-dark {
                --em-panel: rgba(27, 30, 35, .98);
                --em-surface: rgba(255, 255, 255, .055);
                --em-surface-strong: rgba(255, 255, 255, .085);
                --em-control: rgba(7, 9, 12, .32);
                --em-line: rgba(255, 255, 255, .14);
                --em-line-soft: rgba(255, 255, 255, .09);
                color: #eef0f2;
                border-color: rgba(255, 255, 255, .12);
            }
            #st-extension-manager-overlay .em-box.em-dark .em-header { background: rgba(0, 0, 0, .12); }
            #st-extension-manager-overlay .em-box.em-dark .em-toolbar { background: rgba(0, 0, 0, .2); }
            #st-extension-manager-overlay .em-box.em-dark .em-list-head { background: var(--em-panel); }
            #st-extension-manager-overlay .em-box.em-dark .em-category { color: #62c989; }
            #st-extension-manager-overlay .em-box.em-dark .em-status.update { color: #e0aa59; }

            @media (max-width: 700px) {
                #st-extension-manager-overlay {
                    place-items: center;
                    padding: max(6px, env(safe-area-inset-top)) 0 0;
                }
                #st-extension-manager-overlay > .em-box {
                    width: min(550px, 90vw) !important;
                    height: min(760px, 80vh) !important;
                    height: min(760px, 80dvh) !important;
                    max-width: 550px !important;
                    max-height: calc(100vh - 12px) !important;
                    max-height: calc(100dvh - 12px) !important;
                    border-radius: 8px;
                }
                #st-extension-manager-overlay .em-header { min-height: 62px; padding: 10px 10px 9px 13px; }
                #st-extension-manager-overlay .em-title { font-size: .98em; }
                #st-extension-manager-overlay .em-title > i { width: 32px; height: 32px; flex-basis: 32px; }
                #st-extension-manager-overlay .em-subtitle { margin-left: 41px; font-size: .7em; }
                #st-extension-manager-overlay .em-icon { width: 32px; height: 32px; }
                #st-extension-manager-overlay .em-toolbar { min-height: 46px; padding: 6px 8px; gap: 3px; }
                #st-extension-manager-overlay .em-tab { min-height: 34px; padding: 6px 4px; font-size: .74em; gap: 5px; }
                #st-extension-manager-overlay .em-content { padding: 10px; scrollbar-gutter: auto; }
                #st-extension-manager-overlay .em-tool-row { align-items: flex-start; flex-wrap: wrap; }
                #st-extension-manager-overlay .em-tool-actions { width: 100%; }
                #st-extension-manager-overlay .em-tool-actions > * { flex: 1 1 0; }
                #st-extension-manager-overlay .em-backend-plugin-main { align-items: flex-start; flex-wrap: wrap; }
                #st-extension-manager-overlay .em-backend-plugin-actions { width: 100%; justify-content: space-between; }
                #st-extension-manager-overlay .em-group-cards { padding-left: 0; }
                #st-extension-manager-overlay .em-group-picker { margin-left: 0; }
                #st-extension-manager-overlay .em-list-head { top: -10px; margin: -1px -1px 9px; padding: 1px 1px 9px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; }
                #st-extension-manager-overlay .em-search-field { grid-column: 1 / -1; min-width: 0; }
                #st-extension-manager-overlay .em-select,
                #st-extension-manager-overlay .em-category-filter { width: 100%; min-width: 0; }
                #st-extension-manager-overlay .em-card { padding: 10px; grid-template-columns: 34px minmax(0, 1fr); gap: 9px; }
                #st-extension-manager-overlay .em-card-icon { width: 34px; height: 34px; }
                #st-extension-manager-overlay .em-card-head { align-items: flex-start; }
                #st-extension-manager-overlay .em-card-title { font-size: .86em; }
                #st-extension-manager-overlay .em-status { font-size: .64em; }
                #st-extension-manager-overlay .em-card-actions { gap: 5px; }
                #st-extension-manager-overlay .em-action { min-height: 34px; padding: 6px 9px; }
                #st-extension-manager-overlay .em-editor { grid-template-columns: minmax(0, 1fr); }
                #st-extension-manager-overlay .em-editor label:nth-child(3),
                #st-extension-manager-overlay .em-editor .em-save-meta { grid-column: auto; justify-self: stretch; }
                #st-extension-manager-overlay .em-install { padding: 13px; }
                #st-extension-manager-overlay .em-install-row,
                #st-extension-manager-overlay .em-update-layout { grid-template-columns: minmax(0, 1fr); }
                #st-extension-manager-overlay .em-update-layout .em-install:last-child { grid-column: auto; }
            }

            @media (max-width: 390px) {
                #st-extension-manager-overlay .em-version { display: none; }
                #st-extension-manager-overlay .em-tab { font-size: .69em; }
                #st-extension-manager-overlay .em-count { display: none; }
                #st-extension-manager-overlay .em-list-head { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
                #st-extension-manager-overlay .em-card { grid-template-columns: minmax(0, 1fr); }
                #st-extension-manager-overlay .em-card-icon { display: none; }
                #st-extension-manager-overlay .em-status { white-space: normal; text-align: center; }
            }

            @media (max-height: 560px) and (min-width: 701px) {
                #st-extension-manager-overlay { padding: 6px; }
                #st-extension-manager-overlay .em-header { min-height: 58px; padding-block: 8px; }
                #st-extension-manager-overlay .em-toolbar { min-height: 42px; padding-block: 5px; }
                #st-extension-manager-overlay .em-content { padding: 10px 14px; }
            }

            #st-extension-manager-overlay.em-minimized {
                pointer-events: none;
                background: transparent;
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }

            #st-extension-manager-float,
            #st-extension-manager-float[hidden] { display: none !important; }
            #st-extension-manager-float:not([hidden]) {
                --em-accent: var(--SmartThemeQuoteColor, #376f91);
                position: fixed !important;
                inset: auto max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) auto !important;
                z-index: 2147483646 !important;
                display: flex !important;
                visibility: visible !important;
                align-items: stretch;
                width: min(168px, calc(100vw - 16px)) !important;
                height: var(--em-float-size, 34px) !important;
                min-width: 118px !important;
                min-height: 25px !important;
                max-width: calc(100vw - 16px) !important;
                max-height: 56px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 1px solid rgba(255, 255, 255, .3) !important;
                border-radius: 5px !important;
                background: var(--em-accent) !important;
                box-shadow: 0 4px 14px rgba(8, 14, 22, .24) !important;
                color: #fff !important;
                box-sizing: border-box;
                transform: none !important;
                opacity: .9 !important;
                pointer-events: auto !important;
                cursor: grab;
                touch-action: none;
                user-select: none;
                -webkit-user-select: none;
            }
            #st-extension-manager-float.em-dragging {
                cursor: grabbing;
                opacity: 1 !important;
            }
            #st-extension-manager-float .em-float-label {
                min-width: 0;
                padding: 0 9px;
                display: flex;
                align-items: center;
                gap: 7px;
                flex: 1 1 auto;
                overflow: hidden;
                font-size: 12px;
                line-height: 1;
                white-space: nowrap;
                pointer-events: none;
            }
            #st-extension-manager-float .em-float-label span {
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #st-extension-manager-float .em-float-restore {
                width: var(--em-float-size, 34px) !important;
                height: 100% !important;
                min-width: 25px !important;
                min-height: 25px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                border-left: 1px solid rgba(255, 255, 255, .3) !important;
                border-radius: 0 4px 4px 0 !important;
                background: rgba(0, 0, 0, .12) !important;
                color: #fff !important;
                display: grid !important;
                place-items: center;
                flex: 0 0 auto;
                cursor: pointer;
                font-size: 12px;
                line-height: 1;
                pointer-events: auto !important;
            }
            #st-extension-manager-float .em-float-restore:hover,
            #st-extension-manager-float .em-float-restore:focus-visible {
                background: rgba(0, 0, 0, .25) !important;
                outline: 2px solid rgba(255, 255, 255, .72);
                outline-offset: -3px;
            }

            @media (prefers-reduced-motion: reduce) {
                #st-extension-manager-overlay > .em-box,
                #st-extension-manager-overlay .em-panel.active { animation: none; }
            }
        </style>`);
    }

    async function showPopup() {
        if ($(`#${OVERLAY_ID}`).length) return;
        const dark = readStoredNightMode();
        $(`#${FLOAT_ID}`).remove();
        const $popup = $(`<div id="${OVERLAY_ID}" class="em-overlay" role="dialog" aria-modal="true" aria-label="扩展管理器" tabindex="-1"><div class="em-box ${dark ? 'em-dark' : ''}"><header class="em-header"><div><div class="em-title"><i class="fa-solid fa-wand-magic-sparkles"></i>${SCRIPT_NAME}<span class="em-version">v${SCRIPT_VERSION}</span></div><div class="em-subtitle"><span class="em-backend-state">服务端存储检测中</span></div></div><div class="em-head-actions"><button type="button" class="em-icon em-minimize" title="收起面板" aria-label="收起面板" aria-expanded="true"><i class="fa-solid fa-window-minimize"></i></button><button type="button" class="em-icon em-night" title="切换夜间模式" aria-label="切换夜间模式"><i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}"></i></button><button type="button" class="em-icon em-close" title="关闭" aria-label="关闭面板"><i class="fa-solid fa-xmark"></i></button></div></header><nav class="em-toolbar" aria-label="扩展管理器页面"><button type="button" class="em-tab active" data-tab="installed"><i class="fa-solid fa-layer-group"></i> 前端扩展</button><button type="button" class="em-tab" data-tab="backend"><i class="fa-solid fa-server"></i> 后端管理</button></nav><main class="em-content"><section class="em-panel active" data-panel="installed"><div class="em-frontend-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>扩展管理器本体</strong><span class="em-self-update-status">点击按钮检查本体更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-self"><i class="fa-solid fa-arrows-rotate"></i> 检测</button><button type="button" class="em-action primary em-update-self" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button></div></div><div class="em-tool-row"><div class="em-tool-copy"><strong>前端扩展更新</strong><span>检测全部前端扩展并选择更新</span></div><button type="button" class="em-action em-check-all"><i class="fa-solid fa-magnifying-glass"></i> 检测更新</button></div><div class="em-update-selection"><div class="em-update-empty">点击“检测更新”开始检查</div></div><label class="em-float-size-control"><span>悬浮条高度</span><input class="em-float-size" type="range" min="25" max="56" step="1" value="34"><output class="em-float-size-value">34px</output></label></div><div class="em-list-head"><div class="em-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-search" placeholder="搜索扩展、仓库、分组或备注" aria-label="搜索扩展"></div><select class="em-category-filter" aria-label="按分组筛选"><option value="">全部分组</option></select><select class="em-select em-sort" aria-label="扩展排序方式"><option value="name">按名称</option><option value="type">按类型</option></select><span id="em-count" class="em-count"></span><button type="button" class="em-action em-refresh" title="重新读取" aria-label="重新读取扩展"><i class="fa-solid fa-arrows-rotate"></i></button></div><div id="em-list" class="em-list"></div></section><section class="em-panel" data-panel="backend"><div class="em-install em-backend-panel"><h3><i class="fa-solid fa-server"></i> 已安装后端插件</h3><p class="em-backend-panel-state">正在检测管理后端连接</p><p class="em-backend-update-status">点击按钮检测全部已安装后端插件</p><div class="em-update-actions"><button type="button" class="em-action em-check-backend"><i class="fa-solid fa-arrows-rotate"></i> 检测全部</button><button type="button" class="em-action primary em-update-backend" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部</button></div><div class="em-backend-plugin-list"><div class="em-backend-plugin-empty"><i class="fa-solid fa-server"></i><span>等待检测</span></div></div><div class="em-backend-install-help" hidden><p>未检测到扩展管理器后端。请先在 Termux 中安装管理后端：</p><pre>cd ~/SillyTavern/plugins
git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git extension-manager</pre><p>并在 <code>config.yaml</code> 中启用 <code>enableServerPlugins: true</code>，然后重启 SillyTavern。</p></div><p class="em-backend-update-note">会检测 <code>SillyTavern/plugins</code> 下所有已安装后端插件；更新只执行对应目录的 <code>git pull --ff-only</code>，不会自动重启，完成后请手动重启。</p></div></section></main></div></div>`);
        const $float = $(`<div id="${FLOAT_ID}" class="em-float" title="拖动悬浮条调整位置" aria-label="扩展管理器悬浮条" hidden><span class="em-float-label"><i class="em-float-state fa-solid fa-grip-lines"></i><span>扩展管理器</span></span><button type="button" class="em-float-restore" title="展开扩展管理器" aria-label="展开扩展管理器"><i class="fa-solid fa-plus"></i></button></div>`);
        $('body').append($popup, $float);
        applyFloatingBallSize($popup);
        applyPanelTheme($popup, dark);
        const panelAbortController = new AbortController();
        const close = () => { panelAbortController.abort(); state.minimized = false; $float.remove(); $popup.fadeOut(180, () => $popup.remove()); };
        $popup.on('click', '.em-close', close).on('click', e => { if (e.target === $popup[0]) close(); });
        $popup.on('keydown', e => { if (e.key === 'Escape') close(); });
        requestAnimationFrame(() => $popup.trigger('focus'));
        $popup.on('click', '.em-minimize', () => minimizePanel($popup));
        $float.on('click', '.em-float-restore', () => restorePanel($popup));
        let floatDrag = null;
        $float.on('pointerdown', function (event) {
            if ($(event.target).closest('.em-float-restore').length) return;
            const pointer = event.originalEvent || event;
            if (pointer.button !== undefined && pointer.button !== 0) return;
            const rect = this.getBoundingClientRect();
            floatDrag = { pointerId: pointer.pointerId, offsetX: pointer.clientX - rect.left, offsetY: pointer.clientY - rect.top };
            this.setPointerCapture?.(pointer.pointerId);
            $(this).addClass('em-dragging');
            event.preventDefault();
        });
        $float.on('pointermove', function (event) {
            const pointer = event.originalEvent || event;
            if (!floatDrag || pointer.pointerId !== floatDrag.pointerId) return;
            const rect = this.getBoundingClientRect();
            const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
            const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
            const left = Math.min(maxLeft, Math.max(8, pointer.clientX - floatDrag.offsetX));
            const top = Math.min(maxTop, Math.max(8, pointer.clientY - floatDrag.offsetY));
            this.style.setProperty('left', `${left}px`, 'important');
            this.style.setProperty('top', `${top}px`, 'important');
            this.style.setProperty('right', 'auto', 'important');
            this.style.setProperty('bottom', 'auto', 'important');
            event.preventDefault();
        });
        $float.on('pointerup pointercancel', function (event) {
            const pointer = event.originalEvent || event;
            if (!floatDrag || pointer.pointerId !== floatDrag.pointerId) return;
            if (this.hasPointerCapture?.(pointer.pointerId)) this.releasePointerCapture(pointer.pointerId);
            floatDrag = null;
            $(this).removeClass('em-dragging');
        });
        window.addEventListener('resize', resetFloatingBarPosition, { signal: panelAbortController.signal });
        $popup.on('click', '.em-night', function () { const darkNow = !$popup.find('.em-box').hasClass('em-dark'); applyPanelTheme($popup, darkNow); storeNightMode(darkNow); });
        $popup.on('click', '.em-tab', function () { const tab = $(this).data('tab'); $popup.find('.em-tab').removeClass('active'); $(this).addClass('active'); $popup.find('.em-panel').removeClass('active'); $popup.find(`[data-panel="${tab}"]`).addClass('active'); if (tab === 'backend') void checkBackendUpdate($popup); });
        $popup.on('input', '.em-search', function () { state.filter = $(this).val(); renderList($popup); });
        $popup.on('change', '.em-sort', function () { state.sort = $(this).val(); renderList($popup); });
        $popup.on('change', '.em-category-filter', function () { state.category = $(this).val(); renderList($popup); });
        $popup.on('input', '.em-float-size', function () { state.settings = normalizeSettings({ ...state.settings, floatingBallSize: $(this).val() }); applyFloatingBallSize($popup); });
        $popup.on('change', '.em-float-size', async function () {
            try {
                await saveServerSettings({ floatingBallSize: $(this).val() });
                applyFloatingBallSize($popup);
                if (window.toastr) toastr.success('悬浮条高度已保存');
            } catch (error) {
                if (window.toastr) toastr.warning(`当前大小仅本次有效：${error.message || error}`);
            }
        });
        $popup.on('click', '.em-group-toggle', function () { const group = $(this).data('group'); if (state.expandedGroups.has(group)) state.expandedGroups.delete(group); else state.expandedGroups.add(group); renderList($popup); });
        $popup.on('click', '.em-group-add', function () { const group = $(this).data('group'); state.groupPicker = group; state.selectedExtensions.clear(); state.expandedGroups.add(group); renderList($popup); });
        $popup.on('click', '.em-group-cancel', function () { state.groupPicker = ''; state.selectedExtensions.clear(); renderList($popup); });
        $popup.on('change', '.em-group-choice input', function () { const folder = $(this).data('folder'); if (this.checked) state.selectedExtensions.add(folder); else state.selectedExtensions.delete(folder); });
        $popup.on('click', '.em-group-add-save', async function () {
            const group = String($(this).data('group') || '');
            if (!state.selectedExtensions.size) { if (window.toastr) toastr.info('请选择要加入分组的扩展'); return; }
            const assignments = Object.fromEntries(Array.from(state.selectedExtensions, folder => [folder, group]));
            try {
                await updateExtensionGroups(assignments);
                state.groupPicker = '';
                state.selectedExtensions.clear();
                state.expandedGroups.add(group);
                renderList($popup);
                if (window.toastr) toastr.success(`已添加到分组：${group}`);
            } catch (error) { if (window.toastr) toastr.error(`添加失败：${error.message || error}`); }
        });
        $popup.on('click', '.em-group-rename', async function () {
            const group = String($(this).data('group') || '');
            const nextGroup = String(window.prompt('新的分组名称', group) || '').trim();
            if (!nextGroup || nextGroup === group) return;
            if (['内置', '未分组'].includes(nextGroup)) { if (window.toastr) toastr.error('该名称为系统保留分组'); return; }
            const assignments = Object.fromEntries(state.extensions.filter(extension => typeOf(extension) !== 'system' && groupOf(extension) === group).map(extension => [folderOf(extension), nextGroup]));
            try {
                await updateExtensionGroups(assignments);
                state.expandedGroups.delete(group);
                state.expandedGroups.add(nextGroup);
                if (state.category === group) state.category = nextGroup;
                renderList($popup);
                if (window.toastr) toastr.success(`分组已重命名为：${nextGroup}`);
            } catch (error) { if (window.toastr) toastr.error(`重命名失败：${error.message || error}`); }
        });
        $popup.on('click', '.em-group-dissolve', async function () {
            const group = String($(this).data('group') || '');
            if (!window.confirm(`解散分组“${group}”？扩展本身不会被修改。`)) return;
            const assignments = Object.fromEntries(state.extensions.filter(extension => typeOf(extension) !== 'system' && groupOf(extension) === group).map(extension => [folderOf(extension), '']));
            try {
                await updateExtensionGroups(assignments);
                state.expandedGroups.delete(group);
                state.expandedGroups.add('未分组');
                if (state.category === group) state.category = '';
                renderList($popup);
                if (window.toastr) toastr.success(`分组已解散：${group}`);
            } catch (error) { if (window.toastr) toastr.error(`解散失败：${error.message || error}`); }
        });
        $popup.on('click', '.em-refresh', () => loadExtensions($popup));
        $popup.on('click', '.em-check-self', () => checkSelfUpdate($popup, panelAbortController.signal));
        $popup.on('click', '.em-update-self', () => updateSelf($popup));
        $popup.on('click', '.em-check-backend', () => checkBackendUpdate($popup));
        $popup.on('click', '.em-update-backend', () => updateBackend($popup));
        $popup.on('click', '.em-update-backend-plugin', function () { void updateBackendPlugin(String($(this).attr('data-plugin-id') || ''), $popup); });
        $popup.on('click', '.em-check-all', () => checkAll($popup));
        $popup.on('change', '.em-update-choice input', function () { const folder = $(this).data('folder'); if (this.checked) state.selectedUpdates.add(folder); else state.selectedUpdates.delete(folder); });
        $popup.on('click', '.em-select-all', function () { state.selectedUpdates = new Set(quickUpdateExtensions().map(folderOf)); renderUpdateSelection($popup); });
        $popup.on('click', '.em-update-selected', () => updateSelectedSequentially($popup));
        $popup.on('click', '.em-check', async function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (!extension) return; beginDetection($popup); try { await checkOne(extension); renderList($popup); renderUpdateSelection($popup); } finally { finishDetection($popup); } });
        $popup.on('click', '.em-update', function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (extension) updateOne(extension, $popup); });
        $popup.on('click', '.em-toggle', async function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (!extension) return; $(this).prop('disabled', true); try { await setExtensionEnabled(extension, $(this).data('enable') === true || $(this).data('enable') === 'true'); } catch (error) { $(this).prop('disabled', false); if (window.toastr) toastr.error(`切换失败：${error.message || error}`); } });
        $popup.on("click", ".em-edit", function () { const folder = $(this).data("folder"); $popup.find(".em-editor").filter(function () { return $(this).data("editor") === folder; }).prop("hidden", false); });
        $popup.on('click', '.em-save-meta', async function () {
            const folder = $(this).data('folder');
            const extension = state.extensions.find(item => folderOf(item) === folder);
            if (!extension) return;
            const $button = $(this);
            const editor = $popup.find('.em-editor').filter(function () { return $(this).data('editor') === folder; });
            const category = typeOf(extension) === 'system' ? '' : String(editor.find('.em-category-input').val() || '').trim();
            if (category === '内置') { if (window.toastr) toastr.error('“内置”是系统保留分组'); return; }
            const normalizedCategory = category === '未分组' ? '' : category;
            const nextMeta = { ...state.meta, [folder]: { name: String(editor.find('.em-name-input').val() || '').trim(), note: String(editor.find('.em-note-input').val() || '').trim(), category: normalizedCategory } };
            $button.prop('disabled', true);
            try {
                await saveServerMeta(nextMeta);
                const saved = state.meta[folder] || {};
                extension.zhName = saved.name || chineseValue(extension.manifest, ['display_name_zh', 'displayNameZh', 'zh_name', 'name_zh']);
                extension.note = saved.note || chineseValue(extension.manifest, ['description_zh', 'descriptionZh', 'zh_description', 'note_zh', 'remarks_zh']);
                extension.category = typeOf(extension) === 'system' ? '' : (saved.category || '');
                state.expandedGroups.add(groupOf(extension));
                extension.displayName = extension.zhName || extension.manifest.display_name || folder;
                extension.description = extension.note || extension.manifest.description || '暂无备注';
                renderList($popup);
                if (window.toastr) toastr.success('中文资料已保存到酒馆后端');
            } catch (error) {
                if (window.toastr) toastr.error(`保存失败：${error.message || error}`);
                $button.prop('disabled', false);
            }
        });
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
    window.__extensionManagerCleanup = () => { timers.splice(0).forEach(timer => { clearTimeout(timer); clearInterval(timer); }); $(`#${MENU_BTN_ID}`).remove(); $(`#${OVERLAY_ID}`).remove(); $(`#${FLOAT_ID}`).remove(); $(`#${STYLE_ID}`).remove(); };
})();
