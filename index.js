//name: 扩展管理器

(function () {
    'use strict';

    const SCRIPT_NAME = '扩展管理器';
    const SCRIPT_VERSION = '1.12.0';
    const MENU_BTN_ID = 'st-extension-manager-btn';
    const STYLE_ID = 'st-extension-manager-style';
    const OVERLAY_ID = 'st-extension-manager-overlay';
    const FLOAT_ID = 'st-extension-manager-float';
    const BACKEND_BASE = '/api/plugins/extension-manager';
    const BACKEND_REPOSITORY_URL = 'https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git';
    const BACKEND_INSTALL_COMMANDS = Object.freeze({
        termux: `pkg install git -y && cd ~/SillyTavern && mkdir -p plugins && ( [ -d plugins/extension-manager/.git ] || git clone ${BACKEND_REPOSITORY_URL} plugins/extension-manager ) && sed -i 's/^[[:space:]]*enableServerPlugins:.*/enableServerPlugins: true/' config.yaml`,
        windows: `$ErrorActionPreference='Stop'; $git=(Get-Command git -ErrorAction SilentlyContinue).Source; if (-not $git) { winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements; $git="$env:ProgramFiles\\Git\\cmd\\git.exe" }; if (-not (Test-Path $git)) { throw 'Git 安装失败，请先安装 Git for Windows' }; Set-Location "$HOME\\SillyTavern"; New-Item -ItemType Directory -Force "plugins" | Out-Null; if (-not (Test-Path "plugins\\extension-manager\\.git")) { & $git clone ${BACKEND_REPOSITORY_URL} "plugins\\extension-manager" }; (Get-Content "config.yaml" -Raw) -replace '(?m)^\\s*enableServerPlugins:.*$', 'enableServerPlugins: true' | Set-Content "config.yaml" -Encoding UTF8`,
    });
    const EXTENSION_DEFAULT_FOLDER = 'SillyTavern-Extension-Manager';
    const EXTENSION_RAW_MANIFEST_URL = 'https://raw.githubusercontent.com/qishiwan16-hub/SillyTavern-Extension-Manager/main/manifest.json';
    const INITIAL_SCRIPT_URL = document.currentScript?.src || '';
    const THEME_STORAGE_KEY = 'st-extension-manager-theme';
    const FLOAT_POSITION_STORAGE_KEY = 'st-extension-manager-float-position';
    const FLOATING_BALL_MIN = 25;
    const FLOATING_BALL_MAX = 56;
    const FLOATING_BALL_DEFAULT = 34;
    const timers = [];
    const state = { extensions: [], filter: '', category: '', sort: 'name', checking: false, updating: new Set(), updates: new Map(), checkingExtensions: new Set(), selectedExtensions: new Set(), groupPickerSelections: new Set(), expandedGroups: new Set(), groupPicker: '', selectionMode: false, batchUpdating: false, batchToggling: false, minimized: false, meta: {}, backendMeta: {}, settings: { floatingBallSize: FLOATING_BALL_DEFAULT }, backendInstallPlatform: 'termux', backend: { available: false, error: '', version: '', supportsBackendMeta: false } };
    const selfUpdateState = { phase: 'idle', message: '点击按钮检查本体更新', canUpdate: false, latestVersion: '', extensionName: EXTENSION_DEFAULT_FOLDER, global: false };
    const backendUpdateState = { phase: 'idle', message: '读取后端插件后可检测更新', canUpdate: false, plugins: [], restartRequired: false, batchUpdating: false, checkingPlugins: new Set(), checkedPlugins: new Set(), selectedPlugins: new Set(), expandedGroups: new Set(), groupPickerSelections: new Set(), groupPicker: '', selectionMode: false, filter: '', category: '', sort: 'name' };
    let extensionApiPromise = null;

    if (typeof window.__extensionManagerCleanup === 'function') window.__extensionManagerCleanup();

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    const backendInstallCommand = () => BACKEND_INSTALL_COMMANDS[state.backendInstallPlatform] || BACKEND_INSTALL_COMMANDS.termux;

    function readStoredNightMode() {
        try { return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'; }
        catch (error) { return false; }
    }

    function storeNightMode(dark) {
        try { window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light'); }
        catch (error) {}
    }

    function readFloatingPosition() {
        try {
            const value = JSON.parse(window.localStorage.getItem(FLOAT_POSITION_STORAGE_KEY) || 'null');
            return Number.isFinite(value?.left) && Number.isFinite(value?.top) ? value : null;
        } catch (error) { return null; }
    }

    function storeFloatingPosition(left, top) {
        try { window.localStorage.setItem(FLOAT_POSITION_STORAGE_KEY, JSON.stringify({ left: Math.round(left), top: Math.round(top) })); }
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

    function positionFloatingButton() {
        const button = getFloatingBar()[0];
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const size = rect.width || state.settings.floatingBallSize;
        const saved = readFloatingPosition();
        const defaultLeft = window.innerWidth - size - 16;
        const defaultTop = window.innerHeight - size - 80;
        const left = Math.min(Math.max(8, saved?.left ?? defaultLeft), Math.max(8, window.innerWidth - size - 8));
        const top = Math.min(Math.max(8, saved?.top ?? defaultTop), Math.max(8, window.innerHeight - size - 8));
        button.style.setProperty('left', `${left}px`, 'important');
        button.style.setProperty('top', `${top}px`, 'important');
        button.style.setProperty('right', 'auto', 'important');
        button.style.setProperty('bottom', 'auto', 'important');
    }

    async function loadServerMeta() {
        state.backend = { available: false, error: '', version: '', supportsBackendMeta: false };
        try {
            const status = await request(`${BACKEND_BASE}/status`, { method: 'GET' });
            const response = await request(`${BACKEND_BASE}/data`, { method: 'GET' });
            const data = response && response.data && typeof response.data === 'object' ? response.data : {};
            state.meta = normalizeMeta(data.extensions);
            state.backendMeta = normalizeMeta(data.backendPlugins);
            state.settings = normalizeSettings(data.settings);
            state.backend = { available: true, error: '', version: String(status?.version || ''), supportsBackendMeta: Object.prototype.hasOwnProperty.call(data, 'backendPlugins') };
        } catch (error) {
            state.meta = {};
            state.backendMeta = {};
            state.settings = normalizeSettings(state.settings);
            state.backend = { available: false, error: error.message || String(error), version: '', supportsBackendMeta: false };
        }
    }

    async function saveServerMeta(meta, settings = state.settings, backendMeta = state.backendMeta) {
        if (!state.backend.available) throw new Error('服务端存储未连接，请先安装并启用后端插件');
        const payload = { extensions: normalizeMeta(meta), backendPlugins: normalizeMeta(backendMeta), settings: normalizeSettings(settings) };
        const response = await request(`${BACKEND_BASE}/data`, { method: 'PUT', body: JSON.stringify(payload) });
        const data = response && response.data && typeof response.data === 'object' ? response.data : {};
        state.meta = normalizeMeta(data.extensions);
        state.backendMeta = normalizeMeta(data.backendPlugins || payload.backendPlugins);
        state.settings = normalizeSettings(data.settings || payload.settings);
        return state.meta;
    }

    async function saveBackendMeta(meta) {
        if (!state.backend.supportsBackendMeta) throw new Error('管理后端版本过旧，请先更新并手动重启 SillyTavern');
        await saveServerMeta(state.meta, state.settings, meta);
        return state.backendMeta;
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

    async function checkOne(extension, signal) {
        const folder = folderOf(extension);
        state.checkingExtensions.add(folder);
        try {
            if (!isExternal(extension)) {
                const data = { isUpToDate: true, currentBranchName: '', currentCommitHash: '', remoteUrl: '' };
                state.updates.set(folder, data);
                return data;
            }
            const data = await getVersion(extension, signal);
            state.updates.set(folder, data || {});
            return data || {};
        } catch (error) {
            const data = { error: error.message || String(error) };
            state.updates.set(folder, data);
            return data;
        } finally {
            state.checkingExtensions.delete(folder);
        }
    }

    function renderFloatingButton($popup) {
        const active = Number($popup.data('em-active-detections') || 0) > 0;
        const $button = getFloatingBar();
        $button.find('.em-float-state').attr('class', active ? 'em-float-state fa-solid fa-spinner fa-spin' : 'em-float-state fa-solid fa-wand-magic-sparkles');
        const title = active ? '正在检测更新；点击展开，拖动调整位置' : '点击展开扩展管理器，拖动调整位置';
        $button.attr({ title, 'aria-label': title });
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
        const $button = getFloatingBar();
        $button.prop('hidden', false).css({ display: 'grid', visibility: 'visible', pointerEvents: 'auto' });
        renderFloatingButton($popup);
        requestAnimationFrame(() => {
            positionFloatingButton();
            $button.trigger('focus');
        });
    }

    function restorePanel($popup) {
        state.minimized = false;
        $popup.removeClass('em-minimized').attr('aria-modal', 'true').find('.em-box').removeAttr('hidden');
        $popup.find('.em-minimize').attr('aria-expanded', 'true');
        getFloatingBar().prop('hidden', true).css({ display: '', visibility: '', pointerEvents: '' });
        requestAnimationFrame(() => $popup.trigger('focus'));
    }

    async function checkAll($popup) {
        if (state.checking || state.batchUpdating || state.batchToggling || !state.extensions.length) return;
        state.checking = true;
        beginDetection($popup);
        try {
            const targets = state.extensions.filter(isExternal);
            const checks = targets.map(async extension => {
                const result = await checkOne(extension);
                renderList($popup);
                return result;
            });
            renderList($popup);
            await Promise.all(checks);
            const availableExtensions = state.extensions.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
            const message = availableExtensions.length ? `发现 ${availableExtensions.length} 个扩展可快速更新` : '其他扩展均为最新版本';
            if (!state.minimized && window.toastr) toastr.info(message);
        } finally {
            state.checking = false;
            renderList($popup);
            renderBatchSelection($popup);
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

    function backendMetadata(pluginId) {
        const meta = state.backendMeta[pluginId];
        return meta && typeof meta === 'object' ? meta : {};
    }

    function normalizeBackendPlugins(value) {
        if (!Array.isArray(value)) return [];
        return value.map(item => {
            const id = String(item?.id || '').trim();
            const meta = backendMetadata(id);
            const nativeName = String(item?.nativeName || item?.name || id || '未命名后端插件');
            const nativeDescription = String(item?.nativeDescription || item?.description || '');
            return {
                id,
                nativeName,
                name: String(meta.name || nativeName),
                version: String(item?.version || ''),
                nativeDescription,
                description: String(meta.note || nativeDescription),
                note: String(meta.note || ''),
                category: String(meta.category || ''),
                currentBranchName: String(item?.currentBranchName || ''),
                shortCommitHash: String(item?.shortCommitHash || ''),
                updateSupported: typeof item?.updateSupported === 'boolean' ? item.updateSupported : null,
                isUpToDate: typeof item?.isUpToDate === 'boolean' ? item.isUpToDate : null,
                behind: Math.max(0, Number(item?.behind || 0)),
                error: String(item?.error || ''),
                code: String(item?.code || ''),
                isManager: item?.isManager === true,
                legacy: item?.legacy === true,
                updating: item?.updating === true,
                restartRequired: item?.restartRequired === true,
            };
        }).filter(plugin => plugin.id);
    }

    function mergeBackendPlugins(value) {
        const incoming = normalizeBackendPlugins(value);
        const current = new Map(backendUpdateState.plugins.map(plugin => [plugin.id, plugin]));
        incoming.forEach(plugin => {
            const existing = current.get(plugin.id);
            if (existing) Object.assign(existing, plugin);
            else backendUpdateState.plugins.push(plugin);
        });
        backendUpdateState.plugins.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans') || a.id.localeCompare(b.id));
        return incoming;
    }

    const backendGroupOf = plugin => String(plugin?.category || '').trim() || '未分组';

    function filteredBackendPlugins() {
        const filter = backendUpdateState.filter.toLowerCase();
        return backendUpdateState.plugins.filter(plugin => {
            const group = backendGroupOf(plugin);
            const matchesCategory = !backendUpdateState.category || group === backendUpdateState.category;
            const matchesText = !filter || [plugin.name, plugin.nativeName, plugin.id, plugin.description, group].join(' ').toLowerCase().includes(filter);
            return matchesCategory && matchesText;
        }).sort((a, b) => {
            if (backendUpdateState.sort === 'status') {
                const rank = plugin => backendUpdateState.checkingPlugins.has(plugin.id) || plugin.updating ? 0 : (backendUpdateState.checkedPlugins.has(plugin.id) && plugin.isUpToDate === false ? 1 : (backendUpdateState.checkedPlugins.has(plugin.id) ? 2 : 3));
                return rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-Hans');
            }
            return a.name.localeCompare(b.name, 'zh-Hans') || a.id.localeCompare(b.id);
        });
    }

    function renderBackendCategoryOptions($popup) {
        const categories = Array.from(new Set(backendUpdateState.plugins.map(backendGroupOf))).sort((a, b) => {
            if (a === '未分组') return 1;
            if (b === '未分组') return -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        if (backendUpdateState.category && !categories.includes(backendUpdateState.category)) backendUpdateState.category = '';
        const options = ['<option value="">全部分组</option>']
            .concat(categories.map(category => '<option value="' + escapeHtml(category) + '"' + (backendUpdateState.category === category ? ' selected' : '') + '>' + escapeHtml(category) + '</option>'))
            .join('');
        $popup.find('.em-backend-category-filter').html(options);
    }

    function renderBackendGroupPicker(group) {
        const candidates = backendUpdateState.plugins
            .filter(plugin => backendGroupOf(plugin) !== group)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'));
        const choices = candidates.length
            ? candidates.map(plugin => '<label class="em-group-choice em-backend-group-choice"><input type="checkbox" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (backendUpdateState.groupPickerSelections.has(plugin.id) ? ' checked' : '') + '><span><strong>' + escapeHtml(plugin.name) + '</strong><small>' + escapeHtml(backendGroupOf(plugin)) + '</small></span></label>').join('')
            : '<div class="em-group-picker-empty">没有可添加的后端插件</div>';
        return '<div class="em-group-picker" data-backend-group-picker="' + escapeHtml(group) + '"><div class="em-group-picker-list">' + choices + '</div><div class="em-group-picker-actions"><button type="button" class="em-action em-backend-group-cancel"><i class="fa-solid fa-xmark"></i> 取消</button><button type="button" class="em-action primary em-backend-group-add-save" data-group="' + escapeHtml(group) + '"' + (candidates.length ? '' : ' disabled') + '><i class="fa-solid fa-folder-plus"></i> 添加选中</button></div></div>';
    }

    function renderBackendPluginCard(plugin) {
        const checked = backendUpdateState.checkedPlugins.has(plugin.id);
        const checking = backendUpdateState.checkingPlugins.has(plugin.id);
        const selected = backendUpdateState.selectedPlugins.has(plugin.id);
        const available = checked && plugin.updateSupported === true && plugin.isUpToDate === false;
        const status = plugin.updating
            ? '更新中'
            : checking
                ? '检测中'
                : plugin.restartRequired
                    ? '已更新，待重启'
                    : !checked
                        ? '未检测'
                        : plugin.error
                            ? '检测失败'
                            : available
                                ? (plugin.behind ? '可更新 · 落后 ' + plugin.behind : '可更新')
                                : plugin.updateSupported === false
                                    ? '不可自动更新'
                                    : '最新';
        const statusClass = available ? 'update' : '';
        const details = [plugin.id, plugin.version ? 'v' + plugin.version : '', plugin.currentBranchName, plugin.shortCommitHash].filter(Boolean).join(' · ');
        const leading = backendUpdateState.selectionMode
            ? '<label class="em-card-choice' + (selected ? ' is-selected' : '') + '" title="选择 ' + escapeHtml(plugin.name) + '"><input type="checkbox" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (selected ? ' checked' : '') + '><i class="fa-solid fa-check"></i></label>'
            : '<div class="em-card-icon"><i class="fa-solid fa-server"></i></div>';
        const note = plugin.error || plugin.description || '暂无备注';
        return '<article class="em-card em-backend-card' + (available ? ' is-update' : '') + (selected ? ' is-selected' : '') + '" data-plugin-id="' + escapeHtml(plugin.id) + '">' +
            leading +
            '<div class="em-card-body">' +
                '<div class="em-card-head"><div class="em-card-title">' + escapeHtml(plugin.name) + (plugin.isManager ? ' <span class="em-type">管理后端</span>' : '') + (backendGroupOf(plugin) !== '未分组' ? ' <span class="em-category">' + escapeHtml(backendGroupOf(plugin)) + '</span>' : '') + '</div><span class="em-status ' + statusClass + '">' + escapeHtml(status) + '</span></div>' +
                '<div class="em-card-sub">' + escapeHtml(details || plugin.id) + '</div>' +
                '<div class="em-card-note">' + escapeHtml(note) + '</div>' +
                '<div class="em-card-actions">' +
                    (state.backend.supportsBackendMeta ? '<button type="button" class="em-action em-backend-edit" data-plugin-id="' + escapeHtml(plugin.id) + '"><i class="fa-solid fa-tags"></i> 中文资料与分组</button>' : '') +
                    '<button type="button" class="em-action em-check-backend-plugin" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (checking || plugin.updating || backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase) ? ' disabled' : '') + '><i class="fa-solid fa-magnifying-glass"></i> 检测</button>' +
                    (available ? '<button type="button" class="em-action primary em-update-backend-plugin" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (plugin.updating || backendUpdateState.batchUpdating ? ' disabled' : '') + '><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button>' : '') +
                '</div>' +
                '<div class="em-editor em-backend-editor" data-backend-editor="' + escapeHtml(plugin.id) + '" hidden><label>中文名<input class="em-backend-name-input" value="' + escapeHtml(backendMetadata(plugin.id).name || '') + '" maxlength="80"></label><label>分组<input class="em-backend-category-input" value="' + escapeHtml(plugin.category || '') + '" maxlength="80" placeholder="输入名称即可形成分组文件夹"></label><label>备注<textarea class="em-backend-note-input" maxlength="500">' + escapeHtml(plugin.note || '') + '</textarea></label><button type="button" class="em-save-meta primary em-backend-save-meta" data-plugin-id="' + escapeHtml(plugin.id) + '"><i class="fa-solid fa-floppy-disk"></i> 保存</button></div>' +
            '</div>' +
        '</article>';
    }

    function renderBackendGroup(group, plugins) {
        const expanded = backendUpdateState.expandedGroups.has(group) || backendUpdateState.groupPicker === group;
        const custom = state.backend.supportsBackendMeta && group !== '未分组';
        const actions = custom
            ? '<div class="em-group-actions"><button type="button" class="em-icon em-backend-group-add" data-group="' + escapeHtml(group) + '" title="添加后端插件" aria-label="向 ' + escapeHtml(group) + ' 添加后端插件"><i class="fa-solid fa-folder-plus"></i></button><button type="button" class="em-icon em-backend-group-rename" data-group="' + escapeHtml(group) + '" title="重命名分组" aria-label="重命名 ' + escapeHtml(group) + '"><i class="fa-solid fa-pen"></i></button><button type="button" class="em-icon em-backend-group-dissolve" data-group="' + escapeHtml(group) + '" title="解散分组" aria-label="解散 ' + escapeHtml(group) + '"><i class="fa-solid fa-folder-minus"></i></button></div>'
            : '';
        const picker = backendUpdateState.groupPicker === group ? renderBackendGroupPicker(group) : '';
        const icon = expanded ? 'fa-folder-open' : 'fa-folder';
        return '<section class="em-group em-backend-group" data-backend-group="' + escapeHtml(group) + '"><header class="em-group-head"><button type="button" class="em-icon em-backend-group-toggle" data-group="' + escapeHtml(group) + '" title="' + (expanded ? '收起' : '展开') + '分组" aria-label="' + (expanded ? '收起 ' : '展开 ') + escapeHtml(group) + '" aria-expanded="' + expanded + '"><i class="fa-solid fa-chevron-' + (expanded ? 'down' : 'right') + '"></i></button><i class="fa-solid ' + icon + ' em-group-folder"></i><strong>' + escapeHtml(group) + '</strong><span class="em-group-count">' + plugins.length + '</span>' + actions + '</header><div class="em-group-content"' + (expanded ? '' : ' hidden') + '><div class="em-group-cards">' + plugins.map(renderBackendPluginCard).join('') + '</div>' + picker + '</div></section>';
    }

    function renderBackendBatchSelection($popup) {
        const $toolbar = $popup.find('.em-backend-batch-toolbar');
        const $toggle = $popup.find('.em-backend-multi-toggle');
        if (!$toolbar.length) return;
        $toggle.toggleClass('active', backendUpdateState.selectionMode).attr('aria-pressed', String(backendUpdateState.selectionMode));
        $toggle.find('span').text(backendUpdateState.selectionMode ? '退出多选' : '多选');
        $toolbar.prop('hidden', !backendUpdateState.selectionMode);
        if (!backendUpdateState.selectionMode) return;

        const selected = backendUpdateState.plugins.filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id));
        const detected = selected.filter(plugin => backendUpdateState.checkedPlugins.has(plugin.id));
        const available = selected.filter(plugin => backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
        const undetected = selected.length - detected.length;
        const customGroups = Array.from(new Set(backendUpdateState.plugins.map(backendGroupOf).filter(group => group !== '未分组'))).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
        const groupOptions = ['<option value="">未分组</option>'].concat(customGroups.map(group => '<option value="' + escapeHtml(group) + '">' + escapeHtml(group) + '</option>'), ['<option value="__new__">新建分组...</option>']).join('');
        const busy = backendUpdateState.batchUpdating || ['checking', 'updating', 'loading'].includes(backendUpdateState.phase);
        const updateDisabled = busy || !available.length || undetected > 0;
        const status = selected.length
            ? '已选 ' + selected.length + ' 个 · 已检测 ' + detected.length + ' 个' + (available.length ? ' · 可更新 ' + available.length + ' 个' : '') + (undetected ? ' · 未检测 ' + undetected + ' 个' : '')
            : '请选择后端插件';
        $toolbar.html('<div class="em-batch-summary"><strong>批量操作</strong><span>' + status + '</span></div><div class="em-batch-controls"><button type="button" class="em-action em-backend-select-visible"><i class="fa-solid fa-list-check"></i> 全选当前</button><button type="button" class="em-action em-backend-clear-selection"' + (selected.length ? '' : ' disabled') + '><i class="fa-solid fa-xmark"></i> 清空</button><select class="em-batch-group em-backend-batch-group" aria-label="目标分组">' + groupOptions + '</select><button type="button" class="em-action em-backend-batch-group-save"' + (selected.length && !busy && state.backend.supportsBackendMeta ? '' : ' disabled') + '><i class="fa-solid fa-folder-plus"></i> 分组</button><button type="button" class="em-action em-check-selected-backend"' + (selected.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-magnifying-glass"></i> 检测选中</button><button type="button" class="em-action primary em-update-selected-backend"' + (updateDisabled ? ' disabled' : '') + ' title="' + (undetected ? '请先检测全部选中插件' : (available.length ? '更新检测到的新版本' : '没有检测到可用更新')) + '"><i class="fa-solid fa-cloud-arrow-down"></i> 更新选中</button></div><div class="em-backend-batch-status"></div>');
    }

    function renderBackendPluginList($popup) {
        const $list = $popup.find('.em-backend-plugin-list');
        if (!$list.length) return;
        renderBackendCategoryOptions($popup);
        const list = filteredBackendPlugins();
        $popup.find('.em-backend-count').text(list.length + ' / ' + backendUpdateState.plugins.length);
        if (!backendUpdateState.plugins.length) {
            const loading = ['loading', 'checking'].includes(backendUpdateState.phase);
            $list.html('<div class="em-backend-plugin-empty"><i class="fa-solid ' + (loading ? 'fa-spinner fa-spin' : 'fa-server') + '"></i><span>' + (loading ? '正在读取已安装后端插件' : '尚未检测到后端插件') + '</span></div>');
            renderBackendBatchSelection($popup);
            return;
        }
        const groups = new Map();
        list.forEach(plugin => {
            const group = backendGroupOf(plugin);
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(plugin);
        });
        const names = Array.from(groups.keys()).sort((a, b) => {
            if (a === '未分组') return 1;
            if (b === '未分组') return -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        $list.html(list.length ? names.map(name => renderBackendGroup(name, groups.get(name))).join('') : '<div class="em-empty"><i class="fa-solid fa-server"></i><span>没有匹配的后端插件</span></div>');
        renderBackendBatchSelection($popup);
    }

    function renderBackendUpdate($popup) {
        backendUpdateState.canUpdate = backendUpdateState.plugins.some(plugin => backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false && !plugin.updating);
        if (!['loading', 'checking', 'updating', 'error'].includes(backendUpdateState.phase)) {
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (backendUpdateState.canUpdate ? 'available' : (backendUpdateState.checkedPlugins.size ? 'latest' : 'idle'));
        }
        const $status = $popup.find('.em-backend-update-status');
        $status.text(backendUpdateState.message).toggleClass('error', backendUpdateState.phase === 'error').toggleClass('update', backendUpdateState.canUpdate).toggleClass('restart', backendUpdateState.restartRequired);
        const busy = ['loading', 'checking', 'updating'].includes(backendUpdateState.phase);
        $popup.find('.em-check-backend, .em-backend-refresh').prop('disabled', busy);
        $popup.find('.em-update-backend').prop('hidden', !backendUpdateState.canUpdate).prop('disabled', backendUpdateState.batchUpdating || backendUpdateState.phase === 'updating');
        renderBackendPluginList($popup);
        renderBackendPanel($popup);
    }

    async function loadLegacyBackendPlugin() {
        const data = await request(BACKEND_BASE + '/version', { method: 'GET' });
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

    async function loadBackendPlugins($popup, options = {}) {
        if (!options.force && backendUpdateState.plugins.length) {
            renderBackendUpdate($popup);
            return backendUpdateState.plugins;
        }
        if (!state.backend.available) {
            await loadServerMeta();
            renderBackendState($popup);
        }
        if (!state.backend.available) {
            backendUpdateState.phase = 'error';
            backendUpdateState.message = '管理后端未连接，请先安装扩展管理器后端';
            renderBackendUpdate($popup);
            return [];
        }
        backendUpdateState.phase = 'loading';
        backendUpdateState.message = '正在读取已安装后端插件';
        renderBackendUpdate($popup);
        try {
            let plugins;
            try {
                const data = await request(BACKEND_BASE + '/plugins?checkUpdates=false', { method: 'GET' });
                plugins = normalizeBackendPlugins(data.plugins);
            } catch (error) {
                if (error?.status !== 404) throw error;
                plugins = normalizeBackendPlugins([{ ...(await loadLegacyBackendPlugin()), updateSupported: null, isUpToDate: null, legacy: true }]);
            }
            backendUpdateState.plugins = plugins;
            backendUpdateState.checkedPlugins.clear();
            backendUpdateState.checkingPlugins.clear();
            backendUpdateState.phase = 'idle';
            backendUpdateState.message = '已读取 ' + plugins.length + ' 个后端插件，点击检测后查看更新';
        } catch (error) {
            backendUpdateState.phase = 'error';
            backendUpdateState.message = '读取后端插件失败：' + (error.message || error);
        }
        renderBackendUpdate($popup);
        return backendUpdateState.plugins;
    }

    async function checkBackendPlugins(pluginIds, $popup) {
        if (['loading', 'checking', 'updating'].includes(backendUpdateState.phase) || backendUpdateState.batchUpdating) return backendUpdateState;
        if (!backendUpdateState.plugins.length) await loadBackendPlugins($popup);
        const existing = new Set(backendUpdateState.plugins.map(plugin => plugin.id));
        const ids = Array.from(new Set(pluginIds || [])).filter(id => existing.has(id));
        if (!ids.length) {
            if (window.toastr) toastr.info('请选择需要检测的后端插件');
            return backendUpdateState;
        }
        backendUpdateState.phase = 'checking';
        backendUpdateState.message = '正在检测后端插件 0 / ' + ids.length;
        beginDetection($popup);
        renderBackendUpdate($popup);
        let legacy = false;
        try {
            for (let index = 0; index < ids.length; index++) {
                const pluginId = ids[index];
                backendUpdateState.checkingPlugins.add(pluginId);
                backendUpdateState.message = '正在检测后端插件 ' + (index + 1) + ' / ' + ids.length;
                renderBackendUpdate($popup);
                try {
                    const data = await request(BACKEND_BASE + '/plugins/check', {
                        method: 'POST',
                        body: JSON.stringify({ pluginIds: [pluginId] }),
                    });
                    const checked = mergeBackendPlugins(data.plugins);
                    if (!checked.length) {
                        const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
                        if (plugin) {
                            plugin.error = '后端插件未找到';
                            plugin.updateSupported = false;
                            plugin.isUpToDate = null;
                        }
                    }
                    backendUpdateState.checkedPlugins.add(pluginId);
                } catch (error) {
                    if (error?.status === 404) {
                        const data = await request(BACKEND_BASE + '/plugins?checkUpdates=true', { method: 'GET' });
                        backendUpdateState.plugins = normalizeBackendPlugins(data.plugins);
                        backendUpdateState.plugins.forEach(plugin => backendUpdateState.checkedPlugins.add(plugin.id));
                        legacy = true;
                        break;
                    }
                    const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
                    if (plugin) {
                        plugin.error = error.message || String(error);
                        plugin.updateSupported = false;
                        plugin.isUpToDate = null;
                    }
                    backendUpdateState.checkedPlugins.add(pluginId);
                } finally {
                    backendUpdateState.checkingPlugins.delete(pluginId);
                    renderBackendUpdate($popup);
                }
            }
            const detected = backendUpdateState.plugins.filter(plugin => backendUpdateState.checkedPlugins.has(plugin.id));
            const available = detected.filter(plugin => plugin.updateSupported === true && plugin.isUpToDate === false).length;
            const unsupported = detected.filter(plugin => plugin.updateSupported === false).length;
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (available ? 'available' : 'latest');
            backendUpdateState.message = legacy
                ? '管理后端版本较旧；请先更新并手动重启，重启后可多选检测'
                : '已检测 ' + ids.length + ' 个后端插件' + (available ? '，' + available + ' 个可更新' : '，没有可用更新') + (unsupported ? '，' + unsupported + ' 个无法自动更新' : '');
        } catch (error) {
            backendUpdateState.phase = 'error';
            backendUpdateState.message = '后端插件检测失败：' + (error.message || error);
        } finally {
            backendUpdateState.checkingPlugins.clear();
            renderBackendUpdate($popup);
            finishDetection($popup);
        }
        return backendUpdateState;
    }

    async function checkBackendUpdate($popup) {
        await loadBackendPlugins($popup);
        return checkBackendPlugins(backendUpdateState.plugins.map(plugin => plugin.id), $popup);
    }

    async function checkSelectedBackendPlugins($popup) {
        return checkBackendPlugins(Array.from(backendUpdateState.selectedPlugins), $popup);
    }

    async function updateBackendPlugin(pluginId, $popup, options = {}) {
        const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
        if (!plugin || plugin.updating || !backendUpdateState.checkedPlugins.has(pluginId) || plugin.updateSupported !== true || plugin.isUpToDate !== false || (backendUpdateState.phase === 'updating' && !options.batch)) return false;
        plugin.updating = true;
        backendUpdateState.phase = 'updating';
        backendUpdateState.message = '正在更新：' + plugin.name;
        renderBackendUpdate($popup);
        try {
            const data = await request(plugin.legacy ? BACKEND_BASE + '/update' : BACKEND_BASE + '/plugins/update', {
                method: 'POST',
                body: plugin.legacy ? '{}' : JSON.stringify({ pluginId: plugin.id }),
            });
            const next = normalizeBackendPlugins([{ ...plugin, ...(data.plugin || {}), version: data.plugin?.version || data.version || plugin.version, isUpToDate: true, updating: false, restartRequired: data.restartRequired === true }])[0];
            Object.assign(plugin, next);
            backendUpdateState.checkedPlugins.add(plugin.id);
            backendUpdateState.restartRequired = backendUpdateState.restartRequired || data.restartRequired === true;
            backendUpdateState.message = data.updated === false ? plugin.name + ' 已是最新版本' : plugin.name + ' 已更新，请手动重启 SillyTavern';
            if (!options.quiet && window.toastr) toastr[data.restartRequired === true ? 'warning' : 'success'](backendUpdateState.message);
            return true;
        } catch (error) {
            plugin.error = error.message || String(error);
            backendUpdateState.message = plugin.name + ' 更新失败：' + plugin.error;
            if (!options.quiet && window.toastr) toastr.error(backendUpdateState.message);
            return false;
        } finally {
            plugin.updating = false;
            if (!backendUpdateState.batchUpdating) {
                const remaining = backendUpdateState.plugins.some(item => backendUpdateState.checkedPlugins.has(item.id) && item.updateSupported === true && item.isUpToDate === false);
                backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (remaining ? 'available' : 'latest');
            }
            renderBackendUpdate($popup);
        }
    }

    async function updateBackendPluginsSequentially(pluginIds, $popup) {
        if (backendUpdateState.batchUpdating || ['checking', 'loading'].includes(backendUpdateState.phase)) return;
        const targets = Array.from(new Set(pluginIds || [])).map(id => backendUpdateState.plugins.find(plugin => plugin.id === id)).filter(plugin => plugin && backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
        if (!targets.length) {
            if (window.toastr) toastr.info('检测完成，所选后端插件暂无可更新项');
            return;
        }
        backendUpdateState.batchUpdating = true;
        backendUpdateState.phase = 'updating';
        renderBackendUpdate($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                const plugin = targets[index];
                backendUpdateState.message = '正在更新后端插件 ' + (index + 1) + ' / ' + targets.length + '：' + plugin.name;
                renderBackendUpdate($popup);
                $popup.find('.em-backend-batch-status').text(backendUpdateState.message);
                if (await updateBackendPlugin(plugin.id, $popup, { quiet: true, batch: true })) completed += 1;
            }
            backendUpdateState.message = backendUpdateState.restartRequired
                ? '后端更新完成：' + completed + ' / ' + targets.length + '。请手动重启 SillyTavern'
                : '后端检查完成：' + completed + ' / ' + targets.length + '，无需重启';
            if (window.toastr) toastr[backendUpdateState.restartRequired ? 'warning' : 'success'](backendUpdateState.message);
        } finally {
            backendUpdateState.batchUpdating = false;
            const remaining = backendUpdateState.plugins.some(plugin => backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (remaining ? 'available' : 'latest');
            renderBackendUpdate($popup);
        }
    }

    async function updateBackend($popup) {
        return updateBackendPluginsSequentially(backendUpdateState.plugins.map(plugin => plugin.id), $popup);
    }

    async function updateSelectedBackendPlugins($popup) {
        const selected = backendUpdateState.plugins.filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id));
        const undetected = selected.filter(plugin => !backendUpdateState.checkedPlugins.has(plugin.id));
        if (undetected.length) {
            if (window.toastr) toastr.warning('还有 ' + undetected.length + ' 个选中后端插件未检测，请先检测选中');
            return;
        }
        return updateBackendPluginsSequentially(selected.map(plugin => plugin.id), $popup);
    }

    function applyBackendMetadata() {
        backendUpdateState.plugins = normalizeBackendPlugins(backendUpdateState.plugins.map(plugin => ({
            ...plugin,
            name: plugin.nativeName,
            description: plugin.nativeDescription,
        })));
    }

    async function updateBackendPluginGroups(assignments) {
        const nextMeta = { ...state.backendMeta };
        Object.entries(assignments || {}).forEach(([pluginId, group]) => {
            const current = nextMeta[pluginId] && typeof nextMeta[pluginId] === 'object' ? nextMeta[pluginId] : {};
            const item = { name: String(current.name || ''), note: String(current.note || ''), category: String(group || '').trim() };
            if (item.name || item.note || item.category) nextMeta[pluginId] = item;
            else delete nextMeta[pluginId];
        });
        await saveBackendMeta(nextMeta);
        applyBackendMetadata();
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
            if (!options.deferRender) renderList($popup);
            if (!options.deferSelectionRender) renderBatchSelection($popup);
        }
        return success;
    }

    function selectedExternalExtensions() {
        return state.extensions.filter(extension => state.selectedExtensions.has(folderOf(extension)) && isExternal(extension));
    }

    async function checkSelected($popup) {
        if (state.checking || state.batchUpdating || state.batchToggling) return;
        const targets = selectedExternalExtensions();
        if (!targets.length) {
            if (window.toastr) toastr.info('请先选择需要检测的扩展');
            return;
        }
        state.checking = true;
        beginDetection($popup);
        try {
            const checks = targets.map(async extension => {
                const result = await checkOne(extension);
                renderList($popup);
                return result;
            });
            renderList($popup);
            await Promise.all(checks);
            const available = targets.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false);
            if (window.toastr) toastr.info(available.length ? `选中扩展中有 ${available.length} 个可更新` : '选中扩展均无可用更新');
        } finally {
            state.checking = false;
            renderList($popup);
            finishDetection($popup);
        }
    }

    async function setSelectedEnabled($popup, enabled) {
        if (state.batchToggling || state.batchUpdating || state.checking) return;
        const targets = selectedExternalExtensions().filter(extension => extension.enabled !== enabled);
        if (!targets.length) {
            if (window.toastr) toastr.info(enabled ? '选中扩展均已启用' : '选中扩展均已禁用');
            return;
        }
        state.batchToggling = true;
        renderBatchSelection($popup);
        const $status = $popup.find('.em-batch-update-status');
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                const extension = targets[index];
                $status.text(`正在${enabled ? '启用' : '禁用'} ${index + 1} / ${targets.length}：${extension.displayName}`);
                try {
                    await setExtensionEnabled(extension, enabled, false);
                    extension.enabled = enabled;
                    if (enabled) await hotReload(extension);
                    completed += 1;
                } catch (error) {
                    if (window.toastr) toastr.error(`${extension.displayName} ${enabled ? '启用' : '禁用'}失败：${error.message || error}`);
                }
            }
            if (window.toastr) toastr.success(`批量${enabled ? '启用' : '禁用'}完成：${completed} / ${targets.length}，未刷新网页`);
        } finally {
            state.batchToggling = false;
            renderList($popup);
        }
    }

    async function updateSelectedSequentially($popup) {
        if (state.batchUpdating || state.batchToggling || state.checking) return;
        const selected = selectedExternalExtensions();
        const undetected = selected.filter(extension => !state.updates.has(folderOf(extension)));
        if (undetected.length) {
            if (window.toastr) toastr.warning(`还有 ${undetected.length} 个选中扩展未检测，请先检测选中`);
            return;
        }
        const targets = selected.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) {
            if (window.toastr) toastr.info('检测完成，选中扩展暂无可更新项');
            return;
        }
        state.batchUpdating = true;
        renderBatchSelection($popup);
        const $status = $popup.find('.em-batch-update-status');
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                $status.text(`正在更新 ${index + 1} / ${targets.length}：${targets[index].displayName}`);
                if (await updateOne(targets[index], $popup, { quiet: true, deferRender: true, deferSelectionRender: true })) completed += 1;
            }
            if (window.toastr) toastr.success(`批量更新完成：${completed} / ${targets.length}，已依次热加载`);
        } finally {
            state.batchUpdating = false;
            renderList($popup);
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
                return `<label class="em-group-choice"><input type="checkbox" data-folder="${escapeHtml(folder)}" ${state.groupPickerSelections.has(folder) ? 'checked' : ''}><span><strong>${escapeHtml(extension.displayName)}</strong><small>${escapeHtml(groupOf(extension))}</small></span></label>`;
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
        const html = list.length
            ? names.map(name => renderGroup(name, groups.get(name))).join('')
            : '<div class="em-empty"><i class="fa-solid fa-puzzle-piece"></i><span>没有匹配的扩展</span></div>';
        $popup.find('#em-list').html(html);
        $popup.find('#em-count').text(`${list.length} / ${state.extensions.length}`);
        renderBatchSelection($popup);
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

    function renderBatchSelection($popup) {
        const $toolbar = $popup.find('.em-batch-toolbar');
        const $toggle = $popup.find('.em-multi-toggle');
        if (!$toolbar.length) return;
        $toggle.toggleClass('active', state.selectionMode).attr('aria-pressed', String(state.selectionMode));
        $toggle.find('span').text(state.selectionMode ? '退出多选' : '多选');
        $toolbar.prop('hidden', !state.selectionMode);
        if (!state.selectionMode) return;

        const selected = state.extensions.filter(extension => state.selectedExtensions.has(folderOf(extension)) && typeOf(extension) !== 'system');
        const external = selected.filter(isExternal);
        const detected = external.filter(extension => state.updates.has(folderOf(extension)));
        const undetected = external.length - detected.length;
        const available = external.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        const customGroups = Array.from(new Set(state.extensions.map(groupOf).filter(group => !['内置', '未分组'].includes(group)))).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
        const groupOptions = ['<option value="">未分组</option>', ...customGroups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`), '<option value="__new__">新建分组...</option>'].join('');
        const enabledSelected = external.filter(extension => extension.enabled);
        const disabledSelected = external.filter(extension => !extension.enabled);
        const busy = state.batchUpdating || state.batchToggling || state.checking;
        const updateDisabled = busy || !available.length || undetected > 0;
        const status = selected.length
            ? `已选 ${selected.length} 个 · 已检测 ${detected.length} 个${available.length ? ` · 可更新 ${available.length} 个` : ''}${undetected ? ` · 未检测 ${undetected} 个` : ''}`
            : '请选择扩展';
        $toolbar.html(`<div class="em-batch-summary"><strong>批量操作</strong><span>${status}</span></div><div class="em-batch-controls"><button type="button" class="em-action em-select-visible"><i class="fa-solid fa-list-check"></i> 全选当前</button><button type="button" class="em-action em-clear-selection" ${selected.length ? '' : 'disabled'}><i class="fa-solid fa-xmark"></i> 清空</button><select class="em-batch-group" aria-label="目标分组">${groupOptions}</select><button type="button" class="em-action em-batch-group-save" ${selected.length ? '' : 'disabled'}><i class="fa-solid fa-folder-plus"></i> 分组</button><button type="button" class="em-action em-enable-selected" ${disabledSelected.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-toggle-on"></i> 启用选中</button><button type="button" class="em-action em-disable-selected" ${enabledSelected.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-toggle-off"></i> 禁用选中</button><button type="button" class="em-action em-check-selected" ${external.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-magnifying-glass"></i> 检测选中</button><button type="button" class="em-action primary em-update-selected" ${updateDisabled ? 'disabled' : ''} title="${undetected ? '请先检测全部选中扩展' : (available.length ? '更新检测到的新版本' : '没有检测到可用更新')}"><i class="fa-solid fa-cloud-arrow-down"></i> 更新选中</button></div><div class="em-batch-update-status"></div>`);
    }

    function renderCard(extension) {
        const folder = folderOf(extension);
        const update = state.updates.get(folder) || {};
        const available = update.isUpToDate === false;
        const repo = repoUrl(extension);
        const branch = update.currentBranchName || '未检测';
        const commit = update.shortCommitHash || update.currentCommitHash?.slice(0, 8) || '';
        const typeLabel = { global: '全局', local: '当前用户', system: '内置' }[typeOf(extension)] || typeOf(extension);
        const status = state.updating.has(folder) ? '更新中' : state.checkingExtensions.has(folder) ? '检测中' : !extension.enabled ? '已禁用' : update.error ? '检测失败' : available ? '有更新' : update.isUpToDate === true ? '已是最新' : '未检测';
        const safeRepo = escapeHtml(repo);
        const group = groupOf(extension);
        const groupInput = typeOf(extension) === 'system'
            ? '<input class="em-category-input" value="内置" disabled>'
            : `<input class="em-category-input" value="${escapeHtml(extension.category || '')}" maxlength="80" placeholder="输入名称即可形成分组文件夹">`;
        const selected = state.selectedExtensions.has(folder);
        const leading = state.selectionMode && typeOf(extension) !== 'system'
            ? `<label class="em-card-choice ${selected ? 'is-selected' : ''}" title="选择 ${escapeHtml(extension.displayName)}"><input type="checkbox" data-folder="${escapeHtml(folder)}" ${selected ? 'checked' : ''}><i class="fa-solid fa-check"></i></label>`
            : '<div class="em-card-icon"><i class="fa-solid fa-puzzle-piece"></i></div>';
        return `<article class="em-card ${available ? 'is-update' : ''} ${extension.enabled ? '' : 'is-disabled'} ${selected ? 'is-selected' : ''}">
            ${leading}
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

    async function copyText(value) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('浏览器不允许写入剪贴板');
    }

    function renderInstallPanel($popup) {
        const $button = $popup.find('.em-copy-backend-command');
        const $status = $popup.find('.em-manager-backend-status');
        if (!$button.length) return;
        const isWindows = state.backendInstallPlatform === 'windows';
        $popup.find('.em-platform-option').each(function () {
            const active = String($(this).data('platform')) === state.backendInstallPlatform;
            $(this).toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
        });
        $popup.find('.em-backend-command').text(backendInstallCommand());
        $popup.find('.em-backend-install-note').text(isWindows
            ? '请在 PowerShell 中粘贴执行。命令不会自动重启，完成后请手动重启 SillyTavern。'
            : '请在 Termux 中粘贴执行。命令不会自动重启，完成后请手动重启 SillyTavern。');
        $button.prop('disabled', state.backend.available);
        $button.html(state.backend.available
            ? '<i class="fa-solid fa-circle-check"></i> 管理后端已安装'
            : `<i class="fa-solid fa-terminal"></i> 复制${isWindows ? ' PowerShell' : ' Termux'} 一键命令`);
        $status.removeClass('error').toggleClass('ok', state.backend.available).text(state.backend.available
            ? `已连接扩展管理器后端${state.backend.version ? ` v${state.backend.version}` : ''}`
            : '尚未连接扩展管理器后端');
    }

    async function installFrontendExtension($popup) {
        const $button = $popup.find('.em-install-frontend');
        const $status = $popup.find('.em-frontend-install-status');
        const url = String($popup.find('.em-install-url').val() || '').trim();
        const branch = String($popup.find('.em-install-branch').val() || '').trim();
        const global = $popup.find('.em-install-scope').val() === 'global';
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 HTTP 或 HTTPS 仓库地址');
        } catch (error) {
            $status.addClass('error').text(error.message || '请输入有效的 Git 仓库地址');
            return;
        }
        if (!window.confirm(`确认安装此前端扩展？\n${url}`)) return;
        $button.prop('disabled', true);
        $status.removeClass('error ok').text('正在克隆仓库并加载扩展');
        try {
            const installed = await request('/api/extensions/install', {
                method: 'POST',
                body: JSON.stringify({ url, global, branch }),
            });
            const api = await getExtensionApi();
            if (typeof api.loadExtensionSettings === 'function') await api.loadExtensionSettings({}, false, false);
            await discover();
            const extension = state.extensions.find(item => folderOf(item) === normalizeName(installed?.folderName || ''));
            if (extension) state.expandedGroups.add(groupOf(extension));
            renderList($popup);
            const name = installed?.display_name || installed?.folderName || '前端扩展';
            $status.addClass('ok').text(`${name} 已安装并动态加载，无需刷新网页`);
            if (window.toastr) toastr.success(`${name} 安装完成`);
        } catch (error) {
            $status.addClass('error').text(`安装失败：${error.message || error}`);
            if (window.toastr) toastr.error(`安装失败：${error.message || error}`);
        } finally {
            $button.prop('disabled', false);
        }
    }

    function renderBackendPanel($popup) {
        const $status = $popup.find('.em-backend-panel-state');
        if (!$status.length) return;
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        const pluginCount = backendUpdateState.plugins.length;
        const connected = '管理后端已连接' +
            (state.backend.version ? ' · v' + state.backend.version : '') +
            (pluginCount ? ' · 已发现 ' + pluginCount + ' 个后端插件' : '') +
            (state.backend.supportsBackendMeta ? '' : ' · 更新并重启后可保存分组');
        $status.text(state.backend.available ? connected : '管理后端未连接');
        $popup.find('.em-backend-install-help').prop('hidden', state.backend.available);
    }

    function renderBackendState($popup) {
        const $status = $popup.find('.em-backend-state');
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        $status.text(state.backend.available ? `服务端存储已连接${state.backend.version ? ` v${state.backend.version}` : ''}` : '服务端存储未连接');
        if (!state.backend.available && state.backend.error) $status.attr('title', state.backend.error);
        renderBackendPanel($popup);
        renderInstallPanel($popup);
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
            #st-extension-manager-overlay .em-search,
            #st-extension-manager-overlay .em-backend-search {
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
            #st-extension-manager-overlay .em-category-filter,
            #st-extension-manager-overlay .em-backend-category-filter {
                width: 112px;
                min-height: 36px;
                padding: 7px 8px;
                border: 1px solid var(--em-line);
                border-radius: 6px;
                background: var(--em-control);
                color: inherit;
            }
            #st-extension-manager-overlay .em-count { font-size: .76em; opacity: .62; white-space: nowrap; }
            #st-extension-manager-overlay .em-multi-toggle.active,
            #st-extension-manager-overlay .em-backend-multi-toggle.active {
                border-color: var(--em-accent);
                background: color-mix(in srgb, var(--em-accent) 12%, var(--em-control));
                color: var(--em-accent);
            }
            #st-extension-manager-overlay .em-batch-toolbar {
                margin: -3px 0 12px;
                padding: 10px;
                border: 1px solid color-mix(in srgb, var(--em-accent) 30%, var(--em-line));
                border-radius: 7px;
                background: color-mix(in srgb, var(--em-accent) 7%, var(--em-surface));
            }
            #st-extension-manager-overlay .em-batch-toolbar[hidden] { display: none; }
            #st-extension-manager-overlay .em-batch-summary {
                min-width: 0;
                margin-bottom: 8px;
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 10px;
            }
            #st-extension-manager-overlay .em-batch-summary strong { font-size: .82em; }
            #st-extension-manager-overlay .em-batch-summary span { min-width: 0; font-size: .72em; opacity: .66; text-align: right; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-batch-controls { display: flex; flex-wrap: wrap; gap: 6px; }
            #st-extension-manager-overlay .em-batch-controls > * { flex: 1 1 105px; }
            #st-extension-manager-overlay .em-batch-group {
                min-width: 110px;
                min-height: 32px;
                padding: 6px 8px;
                border: 1px solid var(--em-line);
                border-radius: 6px;
                background: var(--em-control);
                color: inherit;
                font-size: .76em;
            }

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
            #st-extension-manager-overlay .em-card.is-update {
                border-color: rgba(39, 141, 80, .52);
                border-left: 4px solid #278d50;
                background: color-mix(in srgb, #278d50 10%, var(--em-surface));
                box-shadow: 0 4px 16px rgba(23, 105, 57, .1);
            }
            #st-extension-manager-overlay .em-card.is-disabled { opacity: .62; }
            #st-extension-manager-overlay .em-card.is-selected {
                border-color: color-mix(in srgb, var(--em-accent) 60%, transparent);
                background: color-mix(in srgb, var(--em-accent) 9%, var(--em-surface));
            }
            #st-extension-manager-overlay .em-card.is-update.is-selected {
                border-color: rgba(39, 141, 80, .62);
                border-left-color: #278d50;
                background: color-mix(in srgb, #278d50 13%, var(--em-surface));
            }
            #st-extension-manager-overlay .em-card-choice {
                width: 40px;
                height: 40px;
                border: 1px solid color-mix(in srgb, var(--em-accent) 34%, transparent);
                border-radius: 7px;
                background: color-mix(in srgb, var(--em-accent) 9%, transparent);
                position: relative;
                display: grid;
                place-items: center;
                cursor: pointer;
            }
            #st-extension-manager-overlay .em-card-choice input {
                position: absolute;
                width: 1px;
                height: 1px;
                opacity: 0;
                pointer-events: none;
            }
            #st-extension-manager-overlay .em-card-choice i { color: var(--em-accent); opacity: .28; }
            #st-extension-manager-overlay .em-card-choice.is-selected {
                border-color: var(--em-accent);
                background: var(--em-accent);
            }
            #st-extension-manager-overlay .em-card-choice.is-selected i { color: #fff; opacity: 1; }
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
            #st-extension-manager-overlay .em-status.update { border-color: rgba(39, 141, 80, .4); background: rgba(39, 141, 80, .14); color: #237c47; font-weight: 700; opacity: 1; }
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

            #st-extension-manager-overlay .em-install-page {
                width: 100%;
                max-width: 720px;
                margin: 0 auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
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
            #st-extension-manager-overlay .em-install-status { min-height: 20px; margin: 0; font-size: .76em; line-height: 1.45; opacity: .68; }
            #st-extension-manager-overlay .em-install-status.ok,
            #st-extension-manager-overlay .em-manager-backend-status.ok { color: #278d50; font-weight: 700; opacity: 1; }
            #st-extension-manager-overlay .em-install-status.error { color: #b94e55; opacity: 1; }
            #st-extension-manager-overlay .em-install-backend-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: .8em; }
            #st-extension-manager-overlay .em-manager-backend-status { text-align: right; opacity: .66; }
            #st-extension-manager-overlay .em-platform-switch {
                width: 100%;
                min-width: 0;
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                border: 1px solid var(--em-line);
                border-radius: 6px;
                overflow: hidden;
                background: var(--em-control);
            }
            #st-extension-manager-overlay .em-platform-option {
                min-width: 0;
                min-height: 36px;
                padding: 7px 9px;
                border: 0;
                border-radius: 0;
                background: transparent;
                color: inherit;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                cursor: pointer;
                font-size: .76em;
            }
            #st-extension-manager-overlay .em-platform-option + .em-platform-option { border-left: 1px solid var(--em-line); }
            #st-extension-manager-overlay .em-platform-option.active { background: var(--em-accent); color: #fff; font-weight: 700; }
            #st-extension-manager-overlay .em-backend-command {
                max-height: 150px;
                margin: 0;
                padding: 10px;
                border: 1px solid var(--em-line-soft);
                border-radius: 6px;
                background: rgba(0, 0, 0, .055);
                overflow: auto;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                font: .7em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
            }
            #st-extension-manager-overlay .em-install-placeholder { padding-top: 10px; border-top: 1px solid var(--em-line-soft); font-size: .74em; text-align: center; opacity: .5; }
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
            #st-extension-manager-overlay .em-backend-plugin-list { min-width: 0; }
            #st-extension-manager-overlay .em-backend-install-help { margin-top: 12px; }
            #st-extension-manager-overlay .em-backend-update-note { margin-top: 10px; }
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
            #st-extension-manager-overlay .em-batch-update-status:not(:empty),
            #st-extension-manager-overlay .em-backend-batch-status:not(:empty) { padding-top: 8px; font-size: .76em; opacity: .68; }
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
            #st-extension-manager-overlay .em-box.em-dark .em-status.update { color: #72d69a; }

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
                #st-extension-manager-overlay .em-count { display: none; }
                #st-extension-manager-overlay .em-search-field { grid-column: 1 / -1; min-width: 0; }
                #st-extension-manager-overlay .em-select,
                #st-extension-manager-overlay .em-category-filter,
                #st-extension-manager-overlay .em-backend-category-filter { width: 100%; min-width: 0; }
                #st-extension-manager-overlay .em-card { padding: 10px; grid-template-columns: 34px minmax(0, 1fr); gap: 9px; }
                #st-extension-manager-overlay .em-card-icon,
                #st-extension-manager-overlay .em-card-choice { width: 34px; height: 34px; }
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
                #st-extension-manager-overlay .em-list-head { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; }
                #st-extension-manager-overlay .em-card { grid-template-columns: minmax(0, 1fr); }
                #st-extension-manager-overlay .em-card-icon { display: none; }
                #st-extension-manager-overlay .em-card-choice { width: 100%; height: 32px; }
                #st-extension-manager-overlay .em-batch-summary { align-items: flex-start; flex-direction: column; }
                #st-extension-manager-overlay .em-batch-summary span { text-align: left; }
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
                inset: auto !important;
                z-index: 2147483646 !important;
                width: var(--em-float-size, 34px) !important;
                height: var(--em-float-size, 34px) !important;
                min-width: 25px !important;
                min-height: 25px !important;
                max-width: 56px !important;
                max-height: 56px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 1px solid rgba(255, 255, 255, .42) !important;
                border-radius: 50% !important;
                background: var(--em-accent) !important;
                box-shadow: 0 4px 16px rgba(8, 14, 22, .34) !important;
                color: #fff !important;
                display: grid !important;
                place-items: center;
                box-sizing: border-box;
                transform: none !important;
                opacity: .9 !important;
                visibility: visible !important;
                pointer-events: auto !important;
                cursor: grab;
                touch-action: none;
                user-select: none;
                -webkit-user-select: none;
                line-height: 1;
                transition: opacity .14s ease, box-shadow .14s ease;
            }
            #st-extension-manager-float .em-float-state {
                font-size: clamp(11px, calc(var(--em-float-size, 34px) * .38), 19px);
                pointer-events: none;
            }
            #st-extension-manager-float:hover,
            #st-extension-manager-float:focus-visible {
                opacity: 1 !important;
                box-shadow: 0 6px 20px rgba(8, 14, 22, .42) !important;
                outline: 2px solid rgba(255, 255, 255, .78);
                outline-offset: -3px;
            }
            #st-extension-manager-float.em-dragging {
                cursor: grabbing;
                opacity: 1 !important;
                transition: none;
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
        const $popup = $(`<div id="${OVERLAY_ID}" class="em-overlay" role="dialog" aria-modal="true" aria-label="扩展管理器" tabindex="-1"><div class="em-box ${dark ? 'em-dark' : ''}"><header class="em-header"><div><div class="em-title"><i class="fa-solid fa-wand-magic-sparkles"></i>${SCRIPT_NAME}<span class="em-version">v${SCRIPT_VERSION}</span></div><div class="em-subtitle"><span class="em-backend-state">服务端存储检测中</span></div></div><div class="em-head-actions"><button type="button" class="em-icon em-minimize" title="收起面板" aria-label="收起面板" aria-expanded="true"><i class="fa-solid fa-window-minimize"></i></button><button type="button" class="em-icon em-night" title="切换夜间模式" aria-label="切换夜间模式"><i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}"></i></button><button type="button" class="em-icon em-close" title="关闭" aria-label="关闭面板"><i class="fa-solid fa-xmark"></i></button></div></header><nav class="em-toolbar" aria-label="扩展管理器页面"><button type="button" class="em-tab active" data-tab="installed"><i class="fa-solid fa-layer-group"></i> 前端扩展</button><button type="button" class="em-tab" data-tab="backend"><i class="fa-solid fa-server"></i> 后端管理</button><button type="button" class="em-tab" data-tab="install"><i class="fa-solid fa-download"></i> 安装扩展</button></nav><main class="em-content"><section class="em-panel active" data-panel="installed"><div class="em-frontend-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>扩展管理器本体</strong><span class="em-self-update-status">点击按钮检查本体更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-self"><i class="fa-solid fa-arrows-rotate"></i> 检测</button><button type="button" class="em-action primary em-update-self" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button></div></div><div class="em-tool-row"><div class="em-tool-copy"><strong>前端扩展更新</strong><span>检测全部前端扩展的可用更新</span></div><button type="button" class="em-action em-check-all"><i class="fa-solid fa-magnifying-glass"></i> 检测更新</button></div><label class="em-float-size-control"><span>悬浮球大小</span><input class="em-float-size" type="range" min="25" max="56" step="1" value="34"><output class="em-float-size-value">34px</output></label></div><div class="em-list-head"><div class="em-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-search" placeholder="搜索扩展、仓库、分组或备注" aria-label="搜索扩展"></div><select class="em-category-filter" aria-label="按分组筛选"><option value="">全部分组</option></select><select class="em-select em-sort" aria-label="扩展排序方式"><option value="name">按名称</option><option value="type">按类型</option></select><span id="em-count" class="em-count"></span><button type="button" class="em-action em-multi-toggle" aria-pressed="false"><i class="fa-solid fa-square-check"></i><span>多选</span></button><button type="button" class="em-action em-refresh" title="重新读取" aria-label="重新读取扩展"><i class="fa-solid fa-arrows-rotate"></i></button></div><div class="em-batch-toolbar" hidden></div><div id="em-list" class="em-list"></div></section><section class="em-panel" data-panel="backend"><div class="em-frontend-tools em-backend-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>后端插件管理</strong><span class="em-backend-panel-state">正在检测管理后端连接</span></div><button type="button" class="em-action em-backend-refresh" title="重新读取" aria-label="重新读取后端插件"><i class="fa-solid fa-arrows-rotate"></i> 读取插件</button></div><div class="em-tool-row"><div class="em-tool-copy"><strong>后端插件更新</strong><span class="em-backend-update-status">读取后端插件后可检测更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-backend"><i class="fa-solid fa-magnifying-glass"></i> 检测全部</button><button type="button" class="em-action primary em-update-backend" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部</button></div></div></div><div class="em-list-head em-backend-list-head"><div class="em-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-backend-search" placeholder="搜索后端插件、分组或备注" aria-label="搜索后端插件"></div><select class="em-backend-category-filter" aria-label="按后端分组筛选"><option value="">全部分组</option></select><select class="em-select em-backend-sort" aria-label="后端插件排序方式"><option value="name">按名称</option><option value="status">按更新状态</option></select><span class="em-count em-backend-count"></span><button type="button" class="em-action em-backend-multi-toggle" aria-pressed="false"><i class="fa-solid fa-square-check"></i><span>多选</span></button></div><div class="em-batch-toolbar em-backend-batch-toolbar" hidden></div><div class="em-list em-backend-plugin-list"><div class="em-backend-plugin-empty"><i class="fa-solid fa-server"></i><span>等待读取</span></div></div><div class="em-backend-install-help" hidden><p>未检测到扩展管理器后端，请在“安装扩展”页选择 Termux 或 Windows 并复制对应的一键命令。</p><p>命令会启用 <code>enableServerPlugins: true</code>，但不会自动重启 SillyTavern。</p></div><p class="em-backend-update-note">后端检测只查询固定插件目录中的 Git 仓库；更新按检测结果依次执行 <code>git pull --ff-only</code>，不会自动重启，完成后请手动重启。</p></section><section class="em-panel" data-panel="install"><div class="em-install-page"><div class="em-install"><h3><i class="fa-solid fa-puzzle-piece"></i> 安装前端扩展</h3><label>Git 仓库地址<input class="em-install-url" type="url" inputmode="url" placeholder="https://github.com/user/repository"></label><div class="em-install-row"><label>分支或标签（可选）<input class="em-install-branch" type="text" placeholder="main"></label><label>安装范围<select class="em-install-scope"><option value="user">当前用户</option><option value="global">全部用户</option></select></label></div><button type="button" class="em-action primary em-install-frontend"><i class="fa-solid fa-download"></i> 安装并加载</button><p class="em-install-status em-frontend-install-status">等待输入仓库地址</p></div><div class="em-install"><h3><i class="fa-solid fa-server"></i> 安装后端扩展</h3><div class="em-install-backend-head"><strong>扩展管理器后端</strong><span class="em-manager-backend-status">正在检测连接</span></div><div class="em-platform-switch" role="group" aria-label="选择运行环境"><button type="button" class="em-platform-option active" data-platform="termux" aria-pressed="true"><i class="fa-solid fa-mobile-screen"></i><span>Termux</span></button><button type="button" class="em-platform-option" data-platform="windows" aria-pressed="false"><i class="fa-solid fa-desktop"></i><span>Windows</span></button></div><pre class="em-backend-command">${escapeHtml(backendInstallCommand())}</pre><button type="button" class="em-action primary em-copy-backend-command"><i class="fa-solid fa-terminal"></i> 复制 Termux 一键命令</button><p class="em-install-status em-backend-install-note">请在 Termux 中粘贴执行。命令不会自动重启，完成后请手动重启 SillyTavern。</p><div class="em-install-placeholder">其他后端插件安装暂未开放</div></div></div></section></main></div></div>`);
        const $float = $(`<button type="button" id="${FLOAT_ID}" class="em-float" title="点击展开扩展管理器，拖动调整位置" aria-label="点击展开扩展管理器，拖动调整位置" hidden><i class="em-float-state fa-solid fa-wand-magic-sparkles"></i></button>`);
        $('body').append($popup, $float);
        applyFloatingBallSize($popup);
        applyPanelTheme($popup, dark);
        const panelAbortController = new AbortController();
        const close = () => { panelAbortController.abort(); state.minimized = false; state.selectionMode = false; state.selectedExtensions.clear(); state.groupPickerSelections.clear(); backendUpdateState.selectionMode = false; backendUpdateState.selectedPlugins.clear(); backendUpdateState.groupPickerSelections.clear(); $float.remove(); $popup.fadeOut(180, () => $popup.remove()); };
        $popup.on('click', '.em-close', close).on('click', e => { if (e.target === $popup[0]) close(); });
        $popup.on('keydown', e => { if (e.key === 'Escape') close(); });
        requestAnimationFrame(() => $popup.trigger('focus'));
        $popup.on('click', '.em-minimize', () => minimizePanel($popup));
        let floatDrag = null;
        let suppressFloatClick = false;
        $float.on('pointerdown', function (event) {
            const pointer = event.originalEvent || event;
            if (pointer.button !== undefined && pointer.button !== 0) return;
            const rect = this.getBoundingClientRect();
            floatDrag = {
                pointerId: pointer.pointerId,
                startX: pointer.clientX,
                startY: pointer.clientY,
                originLeft: rect.left,
                originTop: rect.top,
                moved: false,
            };
            this.setPointerCapture?.(pointer.pointerId);
            event.preventDefault();
        });
        $float.on('pointermove', function (event) {
            const pointer = event.originalEvent || event;
            if (!floatDrag || pointer.pointerId !== floatDrag.pointerId) return;
            const dx = pointer.clientX - floatDrag.startX;
            const dy = pointer.clientY - floatDrag.startY;
            if (!floatDrag.moved && Math.max(Math.abs(dx), Math.abs(dy)) <= 5) return;
            floatDrag.moved = true;
            $(this).addClass('em-dragging');
            const rect = this.getBoundingClientRect();
            const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
            const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
            const left = Math.min(maxLeft, Math.max(8, floatDrag.originLeft + dx));
            const top = Math.min(maxTop, Math.max(8, floatDrag.originTop + dy));
            this.style.setProperty('left', `${left}px`, 'important');
            this.style.setProperty('top', `${top}px`, 'important');
            this.style.setProperty('right', 'auto', 'important');
            this.style.setProperty('bottom', 'auto', 'important');
            event.preventDefault();
        });
        $float.on('pointerup pointercancel', function (event) {
            const pointer = event.originalEvent || event;
            if (!floatDrag || pointer.pointerId !== floatDrag.pointerId) return;
            const moved = floatDrag.moved;
            if (this.hasPointerCapture?.(pointer.pointerId)) this.releasePointerCapture(pointer.pointerId);
            floatDrag = null;
            $(this).removeClass('em-dragging');
            if (moved && event.type === 'pointerup') {
                const rect = this.getBoundingClientRect();
                storeFloatingPosition(rect.left, rect.top);
                suppressFloatClick = true;
            }
        });
        $float.on('click', function () {
            if (suppressFloatClick) {
                suppressFloatClick = false;
                return;
            }
            restorePanel($popup);
        });
        window.addEventListener('resize', positionFloatingButton, { signal: panelAbortController.signal });
        $popup.on('click', '.em-night', function () { const darkNow = !$popup.find('.em-box').hasClass('em-dark'); applyPanelTheme($popup, darkNow); storeNightMode(darkNow); });
        $popup.on('click', '.em-tab', function () { const tab = $(this).data('tab'); $popup.find('.em-tab').removeClass('active'); $(this).addClass('active'); $popup.find('.em-panel').removeClass('active'); $popup.find(`[data-panel="${tab}"]`).addClass('active'); if (tab === 'backend') void loadBackendPlugins($popup); });
        $popup.on('input', '.em-search:not(.em-backend-search)', function () { state.filter = $(this).val(); renderList($popup); });
        $popup.on('change', '.em-sort', function () { state.sort = $(this).val(); renderList($popup); });
        $popup.on('change', '.em-category-filter:not(.em-backend-category-filter)', function () { state.category = $(this).val(); renderList($popup); });
        $popup.on('input', '.em-float-size', function () { state.settings = normalizeSettings({ ...state.settings, floatingBallSize: $(this).val() }); applyFloatingBallSize($popup); });
        $popup.on('change', '.em-float-size', async function () {
            try {
                await saveServerSettings({ floatingBallSize: $(this).val() });
                applyFloatingBallSize($popup);
                if (window.toastr) toastr.success('悬浮球大小已保存');
            } catch (error) {
                if (window.toastr) toastr.warning(`当前大小仅本次有效：${error.message || error}`);
            }
        });
        $popup.on('click', '.em-group-toggle', function () { const group = $(this).data('group'); if (state.expandedGroups.has(group)) state.expandedGroups.delete(group); else state.expandedGroups.add(group); renderList($popup); });
        $popup.on('click', '.em-group-add', function () { const group = $(this).data('group'); state.groupPicker = group; state.groupPickerSelections.clear(); state.expandedGroups.add(group); renderList($popup); });
        $popup.on('click', '.em-group-cancel', function () { state.groupPicker = ''; state.groupPickerSelections.clear(); renderList($popup); });
        $popup.on('change', '.em-group-choice input[data-folder]', function () { const folder = $(this).data('folder'); if (this.checked) state.groupPickerSelections.add(folder); else state.groupPickerSelections.delete(folder); });
        $popup.on('click', '.em-group-add-save', async function () {
            const group = String($(this).data('group') || '');
            if (!state.groupPickerSelections.size) { if (window.toastr) toastr.info('请选择要加入分组的扩展'); return; }
            const assignments = Object.fromEntries(Array.from(state.groupPickerSelections, folder => [folder, group]));
            try {
                await updateExtensionGroups(assignments);
                state.groupPicker = '';
                state.groupPickerSelections.clear();
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
        $popup.on('input', '.em-backend-search', function () {
            backendUpdateState.filter = String($(this).val() || '');
            renderBackendPluginList($popup);
        });
        $popup.on('change', '.em-backend-category-filter', function () {
            backendUpdateState.category = String($(this).val() || '');
            renderBackendPluginList($popup);
        });
        $popup.on('change', '.em-backend-sort', function () {
            backendUpdateState.sort = String($(this).val() || 'name');
            renderBackendPluginList($popup);
        });
        $popup.on('click', '.em-backend-refresh', () => loadBackendPlugins($popup, { force: true }));
        $popup.on('click', '.em-backend-multi-toggle', function () {
            backendUpdateState.selectionMode = !backendUpdateState.selectionMode;
            if (!backendUpdateState.selectionMode) backendUpdateState.selectedPlugins.clear();
            renderBackendPluginList($popup);
        });
        $popup.on('change', '.em-backend-card .em-card-choice input', function () {
            const pluginId = String($(this).attr('data-plugin-id') || '');
            if (this.checked) backendUpdateState.selectedPlugins.add(pluginId);
            else backendUpdateState.selectedPlugins.delete(pluginId);
            renderBackendPluginList($popup);
        });
        $popup.on('click', '.em-backend-select-visible', function () {
            filteredBackendPlugins().forEach(plugin => backendUpdateState.selectedPlugins.add(plugin.id));
            renderBackendPluginList($popup);
        });
        $popup.on('click', '.em-backend-clear-selection', function () {
            backendUpdateState.selectedPlugins.clear();
            renderBackendPluginList($popup);
        });
        $popup.on('click', '.em-check-selected-backend', () => checkSelectedBackendPlugins($popup));
        $popup.on('click', '.em-update-selected-backend', () => updateSelectedBackendPlugins($popup));
        $popup.on('click', '.em-check-backend-plugin', function () {
            void checkBackendPlugins([String($(this).attr('data-plugin-id') || '')], $popup);
        });
        $popup.on('click', '.em-backend-edit', function () {
            const pluginId = String($(this).attr('data-plugin-id') || '');
            $popup.find('.em-backend-editor').filter(function () { return String($(this).attr('data-backend-editor') || '') === pluginId; }).prop('hidden', false);
        });
        $popup.on('click', '.em-backend-save-meta', async function () {
            const pluginId = String($(this).attr('data-plugin-id') || '');
            const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
            if (!plugin) return;
            const editor = $popup.find('.em-backend-editor').filter(function () { return String($(this).attr('data-backend-editor') || '') === pluginId; });
            const categoryInput = String(editor.find('.em-backend-category-input').val() || '').trim();
            if (categoryInput === '内置') { if (window.toastr) toastr.error('“内置”是系统保留分组'); return; }
            const category = categoryInput === '未分组' ? '' : categoryInput;
            const nextMeta = { ...state.backendMeta, [pluginId]: { name: String(editor.find('.em-backend-name-input').val() || '').trim(), note: String(editor.find('.em-backend-note-input').val() || '').trim(), category } };
            const $button = $(this).prop('disabled', true);
            try {
                await saveBackendMeta(nextMeta);
                applyBackendMetadata();
                backendUpdateState.expandedGroups.add(backendGroupOf(backendUpdateState.plugins.find(item => item.id === pluginId)));
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success('后端插件资料已保存');
            } catch (error) {
                $button.prop('disabled', false);
                if (window.toastr) toastr.error('保存失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-backend-batch-group-save', async function () {
            const selected = backendUpdateState.plugins.filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id));
            if (!selected.length) {
                if (window.toastr) toastr.info('请先选择要分组的后端插件');
                return;
            }
            let group = String($popup.find('.em-backend-batch-group').val() || '');
            if (group === '__new__') group = String(window.prompt('新分组名称') || '').trim();
            if (group === '内置') { if (window.toastr) toastr.error('“内置”是系统保留分组'); return; }
            if (group === '__new__' || ($popup.find('.em-backend-batch-group').val() === '__new__' && !group)) return;
            const assignments = Object.fromEntries(selected.map(plugin => [plugin.id, group === '未分组' ? '' : group]));
            const $button = $(this).prop('disabled', true);
            try {
                await updateBackendPluginGroups(assignments);
                backendUpdateState.expandedGroups.add(group || '未分组');
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success(group ? '已将 ' + selected.length + ' 个后端插件加入分组：' + group : '已将 ' + selected.length + ' 个后端插件移至未分组');
            } catch (error) {
                $button.prop('disabled', false);
                if (window.toastr) toastr.error('批量分组失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-backend-group-toggle', function () {
            const group = String($(this).attr('data-group') || '');
            if (backendUpdateState.expandedGroups.has(group)) backendUpdateState.expandedGroups.delete(group);
            else backendUpdateState.expandedGroups.add(group);
            renderBackendPluginList($popup);
        });
        $popup.on('click', '.em-backend-group-add', function () {
            const group = String($(this).attr('data-group') || '');
            backendUpdateState.groupPicker = group;
            backendUpdateState.groupPickerSelections.clear();
            backendUpdateState.expandedGroups.add(group);
            renderBackendPluginList($popup);
        });
        $popup.on('click', '.em-backend-group-cancel', function () {
            backendUpdateState.groupPicker = '';
            backendUpdateState.groupPickerSelections.clear();
            renderBackendPluginList($popup);
        });
        $popup.on('change', '.em-backend-group-choice input', function () {
            const pluginId = String($(this).attr('data-plugin-id') || '');
            if (this.checked) backendUpdateState.groupPickerSelections.add(pluginId);
            else backendUpdateState.groupPickerSelections.delete(pluginId);
        });
        $popup.on('click', '.em-backend-group-add-save', async function () {
            const group = String($(this).attr('data-group') || '');
            if (!backendUpdateState.groupPickerSelections.size) {
                if (window.toastr) toastr.info('请选择要加入分组的后端插件');
                return;
            }
            const assignments = Object.fromEntries(Array.from(backendUpdateState.groupPickerSelections, pluginId => [pluginId, group]));
            try {
                await updateBackendPluginGroups(assignments);
                backendUpdateState.groupPicker = '';
                backendUpdateState.groupPickerSelections.clear();
                backendUpdateState.expandedGroups.add(group);
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success('已添加到后端分组：' + group);
            } catch (error) {
                if (window.toastr) toastr.error('添加失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-backend-group-rename', async function () {
            const group = String($(this).attr('data-group') || '');
            const nextGroup = String(window.prompt('新的分组名称', group) || '').trim();
            if (!nextGroup || nextGroup === group) return;
            if (['内置', '未分组'].includes(nextGroup)) { if (window.toastr) toastr.error('该名称为系统保留分组'); return; }
            const assignments = Object.fromEntries(backendUpdateState.plugins.filter(plugin => backendGroupOf(plugin) === group).map(plugin => [plugin.id, nextGroup]));
            try {
                await updateBackendPluginGroups(assignments);
                backendUpdateState.expandedGroups.delete(group);
                backendUpdateState.expandedGroups.add(nextGroup);
                if (backendUpdateState.category === group) backendUpdateState.category = nextGroup;
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success('后端分组已重命名为：' + nextGroup);
            } catch (error) {
                if (window.toastr) toastr.error('重命名失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-backend-group-dissolve', async function () {
            const group = String($(this).attr('data-group') || '');
            if (!window.confirm('解散后端分组“' + group + '”？插件本身不会被修改。')) return;
            const assignments = Object.fromEntries(backendUpdateState.plugins.filter(plugin => backendGroupOf(plugin) === group).map(plugin => [plugin.id, '']));
            try {
                await updateBackendPluginGroups(assignments);
                backendUpdateState.expandedGroups.delete(group);
                backendUpdateState.expandedGroups.add('未分组');
                if (backendUpdateState.category === group) backendUpdateState.category = '';
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success('后端分组已解散：' + group);
            } catch (error) {
                if (window.toastr) toastr.error('解散失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-check-backend', () => checkBackendUpdate($popup));
        $popup.on('click', '.em-update-backend', () => updateBackend($popup));
        $popup.on('click', '.em-update-backend-plugin', function () { void updateBackendPlugin(String($(this).attr('data-plugin-id') || ''), $popup); });
        $popup.on('click', '.em-check-all', () => checkAll($popup));
        $popup.on('click', '.em-multi-toggle', function () {
            state.selectionMode = !state.selectionMode;
            if (!state.selectionMode) state.selectedExtensions.clear();
            renderList($popup);
        });
        $popup.on('change', '.em-card-choice input[data-folder]', function () {
            const folder = String($(this).data('folder') || '');
            if (this.checked) state.selectedExtensions.add(folder);
            else state.selectedExtensions.delete(folder);
            renderList($popup);
        });
        $popup.on('click', '.em-select-visible', function () {
            filteredExtensions().filter(extension => typeOf(extension) !== 'system').forEach(extension => state.selectedExtensions.add(folderOf(extension)));
            renderList($popup);
        });
        $popup.on('click', '.em-clear-selection', function () {
            state.selectedExtensions.clear();
            renderList($popup);
        });
        $popup.on('click', '.em-batch-group-save', async function () {
            const selected = state.extensions.filter(extension => state.selectedExtensions.has(folderOf(extension)) && typeOf(extension) !== 'system');
            if (!selected.length) {
                if (window.toastr) toastr.info('请先选择要分组的扩展');
                return;
            }
            let group = String($popup.find('.em-batch-group').val() || '');
            if (group === '__new__') group = String(window.prompt('新分组名称') || '').trim();
            if (group === '__new__' || group === '内置') {
                if (window.toastr) toastr.error('该名称为系统保留分组');
                return;
            }
            if ($popup.find('.em-batch-group').val() === '__new__' && !group) return;
            const assignments = Object.fromEntries(selected.map(extension => [folderOf(extension), group === '未分组' ? '' : group]));
            const $button = $(this).prop('disabled', true);
            try {
                await updateExtensionGroups(assignments);
                renderList($popup);
                if (window.toastr) toastr.success(group ? `已将 ${selected.length} 个扩展加入分组：${group}` : `已将 ${selected.length} 个扩展移至未分组`);
            } catch (error) {
                if (window.toastr) toastr.error(`批量分组失败：${error.message || error}`);
                $button.prop('disabled', false);
            }
        });
        $popup.on('click', '.em-enable-selected', () => setSelectedEnabled($popup, true));
        $popup.on('click', '.em-disable-selected', () => setSelectedEnabled($popup, false));
        $popup.on('click', '.em-check-selected', () => checkSelected($popup));
        $popup.on('click', '.em-update-selected', () => updateSelectedSequentially($popup));
        $popup.on('click', '.em-install-frontend', () => installFrontendExtension($popup));
        $popup.on('click', '.em-platform-option', function () {
            const platform = String($(this).data('platform') || 'termux');
            if (!Object.prototype.hasOwnProperty.call(BACKEND_INSTALL_COMMANDS, platform)) return;
            state.backendInstallPlatform = platform;
            renderInstallPanel($popup);
        });
        $popup.on('click', '.em-copy-backend-command', async function () {
            try {
                await copyText(backendInstallCommand());
                $popup.find('.em-manager-backend-status').removeClass('error').addClass('ok').text('安装命令已复制');
                const target = state.backendInstallPlatform === 'windows' ? 'PowerShell' : 'Termux';
                if (window.toastr) toastr.success(`已复制，请粘贴到 ${target} 执行`);
            } catch (error) {
                $popup.find('.em-manager-backend-status').removeClass('ok').addClass('error').text(`复制失败：${error.message || error}`);
            }
        });
        $popup.on('click', '.em-check', async function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (!extension || state.checkingExtensions.has(folderOf(extension))) return; beginDetection($popup); try { const checking = checkOne(extension); renderList($popup); await checking; renderList($popup); } finally { finishDetection($popup); } });
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
