//name: 扩展管理器

(function () {
    'use strict';

    const SCRIPT_NAME = '扩展管理器';
    const SCRIPT_VERSION = '1.23.13';
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
    const FRONTEND_META_STORAGE_KEY = 'st-extension-manager-frontend-meta-v1';
    const SETTINGS_STORAGE_KEY = 'st-extension-manager-settings-v1';
    const NY_FONT_MANAGER_FOLDER = 'ny-font-manager';
    const NY_FONT_MANAGER_STATE_KEY = 'st-extension-manager-ny-font-state-v1';
    const HOT_RUNTIME_KEY = '__extensionManagerHotRuntime';
    const FLOATING_BALL_MIN = 25;
    const FLOATING_BALL_MAX = 56;
    const FLOATING_BALL_DEFAULT = 34;
    const NETWORK_OPTIMIZATION_DEFAULT = true;
    const NETWORK_DETECTION_CONCURRENCY = 2;
    const STANDARD_DETECTION_CONCURRENCY = 6;
    const NETWORK_RETRY_DELAYS = [1200, 3200];

    function installExtensionHotRuntime() {
        const existingRuntime = window[HOT_RUNTIME_KEY];
        if (existingRuntime?.version >= 3) return existingRuntime;
        if (existingRuntime?.version >= 1) {
            if (existingRuntime.version === 1) {
                ['pause', 'resume'].forEach(method => {
                    const previous = typeof existingRuntime[method] === 'function' ? existingRuntime[method].bind(existingRuntime) : null;
                    if (!previous) return;
                    existingRuntime[method] = (...args) => {
                        try { return previous(...args); }
                        catch (error) { console.warn('[Extension Manager] Recovered an older hot runtime ' + method + ' failure.', error); return true; }
                    };
                });
            }
            let captureUntil = 0;
            const cleanFrame = document.createElement('iframe');
            cleanFrame.hidden = true;
            cleanFrame.setAttribute('aria-hidden', 'true');
            document.documentElement.appendChild(cleanFrame);
            const cleanWindow = cleanFrame.contentWindow;
            cleanFrame.dataset.emRuntimeBridge = '1';
            const pristine = {
                addEventListener: cleanWindow?.EventTarget?.prototype?.addEventListener,
                removeEventListener: cleanWindow?.EventTarget?.prototype?.removeEventListener,
                appendChild: cleanWindow?.Node?.prototype?.appendChild,
                insertBefore: cleanWindow?.Node?.prototype?.insertBefore,
                replaceChild: cleanWindow?.Node?.prototype?.replaceChild,
                insertAdjacentHTML: cleanWindow?.Element?.prototype?.insertAdjacentHTML,
                setTimeout: cleanWindow?.setTimeout,
                clearTimeout: cleanWindow?.clearTimeout,
                setInterval: cleanWindow?.setInterval,
                clearInterval: cleanWindow?.clearInterval,
                requestAnimationFrame: cleanWindow?.requestAnimationFrame,
                cancelAnimationFrame: cleanWindow?.cancelAnimationFrame,
            };
            const runQuiet = (callback, thisArg, args) => existingRuntime.runWithOwner(EXTENSION_DEFAULT_FOLDER, () => callback.apply(thisArg, args));
            const guard = (target, method, nativeMethod = null) => {
                const previous = target?.[method];
                if (typeof previous !== 'function' || previous.__emQuietGuard) return;
                const guarded = function (...args) {
                    if (performance.now() < captureUntil) return previous.apply(this, args);
                    if (typeof nativeMethod === 'function') return nativeMethod.apply(this, args);
                    return runQuiet(previous, this, args);
                };
                Object.defineProperty(guarded, '__emQuietGuard', { value: true });
                try { target[method] = guarded; } catch (error) {}
            };
            const guardScheduled = (scheduleMethod, cancelMethod, oneShot) => {
                const previousSchedule = window[scheduleMethod];
                const previousCancel = window[cancelMethod];
                const nativeSchedule = pristine[scheduleMethod];
                const nativeCancel = pristine[cancelMethod];
                if (typeof nativeSchedule !== 'function' || typeof nativeCancel !== 'function') {
                    guard(window, scheduleMethod);
                    guard(window, cancelMethod);
                    return;
                }
                const handles = new Set();
                const scheduled = function (callback, ...args) {
                    if (performance.now() < captureUntil || typeof callback !== 'function') return runQuiet(previousSchedule, this, [callback, ...args]);
                    let handle = 0;
                    const wrapped = function (...callbackArgs) {
                        if (oneShot) handles.delete(handle);
                        return callback.apply(window, callbackArgs);
                    };
                    handle = nativeSchedule.call(this, wrapped, ...args);
                    handles.add(handle);
                    return handle;
                };
                const cancelled = function (handle) {
                    if (handles.delete(handle)) return nativeCancel.call(this, handle);
                    return runQuiet(previousCancel, this, [handle]);
                };
                Object.defineProperty(scheduled, '__emQuietGuard', { value: true });
                Object.defineProperty(cancelled, '__emQuietGuard', { value: true });
                window[scheduleMethod] = scheduled;
                window[cancelMethod] = cancelled;
            };
            ['addEventListener', 'removeEventListener'].forEach(method => guard(EventTarget.prototype, method, pristine[method]));
            guardScheduled('setTimeout', 'clearTimeout', true);
            guardScheduled('setInterval', 'clearInterval', false);
            guardScheduled('requestAnimationFrame', 'cancelAnimationFrame', true);
            ['appendChild', 'insertBefore', 'replaceChild'].forEach(method => guard(Node.prototype, method, pristine[method]));
            guard(Element.prototype, 'insertAdjacentHTML', pristine.insertAdjacentHTML);
            const jq = window.jQuery || window.$;
            ['on', 'one', 'off'].forEach(method => guard(jq?.fn, method));
            const source = window.SillyTavern?.getContext?.().eventSource;
            ['on', 'once', 'off', 'removeListener'].forEach(method => guard(source, method));
            existingRuntime.beginCapture = (duration = 2500) => { captureUntil = Math.max(captureUntil, performance.now() + Math.max(0, Number(duration) || 0)); };
            existingRuntime.version = 3;
            existingRuntime.performanceGuardInstalled = true;
            return existingRuntime;
        }

        const pathPattern = /\/scripts\/extensions\/(?:third-party\/)?([^/?#]+)\//i;
        const managerFolder = (() => {
            const currentPath = (() => {
                try { return new URL(INITIAL_SCRIPT_URL, document.baseURI || location.href).pathname; }
                catch (error) { return ''; }
            })();
            const detected = currentPath.match(pathPattern)?.[1] || String(new Error().stack || '').match(pathPattern)?.[1] || EXTENSION_DEFAULT_FOLDER;
            try { return decodeURIComponent(detected).toLowerCase(); } catch (error) { return String(detected).toLowerCase(); }
        })();
        const original = {
            addEvent: EventTarget.prototype.addEventListener,
            removeEvent: EventTarget.prototype.removeEventListener,
            setTimeout: window.setTimeout.bind(window),
            clearTimeout: window.clearTimeout.bind(window),
            setInterval: window.setInterval.bind(window),
            clearInterval: window.clearInterval.bind(window),
            requestFrame: window.requestAnimationFrame.bind(window),
            cancelFrame: window.cancelAnimationFrame.bind(window),
            appendChild: Node.prototype.appendChild,
            insertBefore: Node.prototype.insertBefore,
            replaceChild: Node.prototype.replaceChild,
            insertHtml: Element.prototype.insertAdjacentHTML,
        };
        const resources = new Map();
        const timerItems = new Map();
        const frameItems = new Map();
        const observers = new WeakMap();
        const eventItems = new WeakMap();
        const paused = new Set();
        let passiveOwnerTracking = true;
        let passiveTrackingDeadline = performance.now() + 8000;
        let activeOwner = '';
        let skipNativeEvent = 0;
        let skipSourceEvent = 0;
        let jqueryReady = false;
        let sourceReady = false;

        const normalize = value => String(value || '').replace(/^third-party\//i, '').toLowerCase();
        const ownerFromStack = () => {
            for (const line of String(new Error().stack || '').split('\n')) {
                const match = line.match(pathPattern);
                if (!match) continue;
                let owner = '';
                try { owner = normalize(decodeURIComponent(match[1])); }
                catch (error) { owner = normalize(match[1]); }
                if (owner && owner !== managerFolder) return owner;
            }
            return '';
        };
        const currentOwner = () => activeOwner || (passiveOwnerTracking ? ownerFromStack() : '');
        const canTrack = owner => Boolean(owner && owner !== managerFolder);
        const bucket = owner => {
            const key = normalize(owner);
            if (!resources.has(key)) resources.set(key, { events: [], jquery: [], source: [], timers: [], frames: [], observers: [], nodes: new Set(), styles: new Set() });
            return resources.get(key);
        };
        const runOwned = (owner, callback, thisArg, args = []) => {
            const previous = activeOwner;
            activeOwner = normalize(owner);
            try { return callback.apply(thisArg, args); }
            finally { activeOwner = previous; }
        };
        const wrapCallback = (owner, callback, after) => typeof callback !== 'function' ? callback : function (...args) {
            try { return runOwned(owner, callback, this, args); }
            finally { after?.(); }
        };
        const hideNode = node => {
            if (!(node instanceof Element) || node.dataset.emHotHidden === '1') return;
            node.dataset.emHotHidden = '1';
            node.dataset.emHotDisplay = node.style.display || '';
            node.style.setProperty('display', 'none', 'important');
        };
        const showNode = node => {
            if (!(node instanceof Element) || node.dataset.emHotHidden !== '1') return;
            const display = node.dataset.emHotDisplay || '';
            delete node.dataset.emHotHidden;
            delete node.dataset.emHotDisplay;
            node.style.removeProperty('display');
            if (display) node.style.display = display;
        };
        const disableStyle = node => {
            if (!(node instanceof Element) || node.dataset.emHotStyleDisabled === '1') return;
            node.dataset.emHotStyleDisabled = '1';
            if (node.tagName === 'LINK') {
                node.dataset.emHotWasDisabled = node.disabled ? '1' : '0';
                node.disabled = true;
            } else {
                node.dataset.emHotMedia = node.getAttribute('media') || '';
                node.setAttribute('media', 'not all');
            }
        };
        const enableStyle = node => {
            if (!(node instanceof Element) || node.dataset.emHotStyleDisabled !== '1') return;
            if (node.tagName === 'LINK') node.disabled = node.dataset.emHotWasDisabled === '1';
            else if (node.dataset.emHotMedia) node.setAttribute('media', node.dataset.emHotMedia);
            else node.removeAttribute('media');
            delete node.dataset.emHotStyleDisabled;
            delete node.dataset.emHotWasDisabled;
            delete node.dataset.emHotMedia;
        };
        const rememberNodes = (owner, nodes) => {
            if (!canTrack(owner)) return;
            const store = bucket(owner);
            nodes.filter(node => node instanceof Element && ['LINK', 'STYLE'].includes(node.tagName)).forEach(node => {
                store.styles.add(node);
                if (paused.has(owner)) disableStyle(node);
            });
            nodes.filter(node => node instanceof Element
                && !['SCRIPT', 'LINK', 'STYLE', 'META'].includes(node.tagName)
                && !node.closest?.(`#${OVERLAY_ID}, #chat, #chat_history`)
                && (node.closest?.('[id^="extensions_settings"], #extensionsMenu, #movingDivs') || node.parentElement === document.body))
                .forEach(node => { store.nodes.add(node); if (paused.has(owner)) hideNode(node); });
        };
        const inserted = node => node instanceof DocumentFragment ? Array.from(node.children) : (node instanceof Element ? [node] : []);

        const eventKey = (type, options) => `${type}:${typeof options === 'boolean' ? options : options?.capture === true}`;
        const indexedEventListeners = (target, type, options, create = false) => {
            let targetItems = eventItems.get(target);
            if (!targetItems && create) { targetItems = new Map(); eventItems.set(target, targetItems); }
            if (!targetItems) return null;
            const key = eventKey(type, options);
            let listeners = targetItems.get(key);
            if (!listeners && create) { listeners = new WeakMap(); targetItems.set(key, listeners); }
            return listeners || null;
        };

        EventTarget.prototype.addEventListener = function (type, listener, options) {
            const owner = skipNativeEvent ? '' : currentOwner();
            if (!canTrack(owner) || !listener) return original.addEvent.call(this, type, listener, options);
            const listenerItems = indexedEventListeners(this, type, options, true);
            const item = { target: this, type, listener, registered: listener, options, active: true, removed: false };
            if (typeof options === 'object' && options?.once) {
                item.registered = function (...args) {
                    item.active = false;
                    item.removed = true;
                    listenerItems.delete(listener);
                    return typeof listener === 'function' ? listener.apply(this, args) : listener.handleEvent?.apply(listener, args);
                };
            }
            const result = original.addEvent.call(this, type, item.registered, options);
            listenerItems.set(listener, item);
            bucket(owner).events.push(item);
            if (paused.has(owner)) { original.removeEvent.call(this, type, item.registered, options); item.active = false; }
            return result;
        };
        EventTarget.prototype.removeEventListener = function (type, listener, options) {
            const listeners = listener && indexedEventListeners(this, type, options);
            const item = listeners?.get(listener);
            if (!item) return original.removeEvent.call(this, type, listener, options);
            item.active = false;
            item.removed = true;
            listeners.delete(listener);
            return original.removeEvent.call(this, type, item.registered, options);
        };

        const registerTimer = (kind, callback, delay, args) => {
            const owner = currentOwner();
            if (!canTrack(owner) || typeof callback !== 'function') return original[kind](callback, delay, ...args);
            const item = { kind, delay, args, handle: 0, active: true, removed: false };
            const isTimeout = kind === 'setTimeout';
            item.callback = wrapCallback(owner, callback, isTimeout ? () => { item.active = false; item.removed = true; timerItems.delete(item.handle); } : undefined);
            item.handle = original[kind](item.callback, delay, ...args);
            timerItems.set(item.handle, item);
            bucket(owner).timers.push(item);
            if (paused.has(owner)) { original[isTimeout ? 'clearTimeout' : 'clearInterval'](item.handle); timerItems.delete(item.handle); item.active = false; }
            return item.handle;
        };
        window.setTimeout = (callback, delay, ...args) => registerTimer('setTimeout', callback, delay, args);
        window.setInterval = (callback, delay, ...args) => registerTimer('setInterval', callback, delay, args);
        const clearTimer = (kind, handle) => {
            const item = timerItems.get(handle);
            if (item) { item.active = false; item.removed = true; timerItems.delete(handle); }
            return original[kind](handle);
        };
        window.clearTimeout = handle => clearTimer('clearTimeout', handle);
        window.clearInterval = handle => clearTimer('clearInterval', handle);
        window.requestAnimationFrame = callback => {
            const owner = currentOwner();
            if (!canTrack(owner) || typeof callback !== 'function') return original.requestFrame(callback);
            const item = { handle: 0, active: true, removed: false };
            item.callback = wrapCallback(owner, callback, () => { item.active = false; item.removed = true; frameItems.delete(item.handle); });
            item.handle = original.requestFrame(item.callback);
            frameItems.set(item.handle, item);
            bucket(owner).frames.push(item);
            if (paused.has(owner)) { original.cancelFrame(item.handle); frameItems.delete(item.handle); item.active = false; }
            return item.handle;
        };
        window.cancelAnimationFrame = handle => {
            const item = frameItems.get(handle);
            if (item) { item.active = false; item.removed = true; frameItems.delete(handle); }
            return original.cancelFrame(handle);
        };

        Node.prototype.appendChild = function (node) {
            const owner = currentOwner();
            if (!canTrack(owner)) return original.appendChild.call(this, node);
            const nodes = inserted(node);
            const result = original.appendChild.call(this, node);
            rememberNodes(owner, nodes);
            return result;
        };
        Node.prototype.insertBefore = function (node, reference) {
            const owner = currentOwner();
            if (!canTrack(owner)) return original.insertBefore.call(this, node, reference);
            const nodes = inserted(node);
            const result = original.insertBefore.call(this, node, reference);
            rememberNodes(owner, nodes);
            return result;
        };
        Node.prototype.replaceChild = function (node, oldNode) {
            const owner = currentOwner();
            if (!canTrack(owner)) return original.replaceChild.call(this, node, oldNode);
            const nodes = inserted(node);
            const result = original.replaceChild.call(this, node, oldNode);
            rememberNodes(owner, nodes);
            return result;
        };
        Element.prototype.insertAdjacentHTML = function (position, html) {
            const owner = currentOwner();
            if (!canTrack(owner)) return original.insertHtml.call(this, position, html);
            const parent = /beforebegin|afterend/i.test(position) ? this.parentElement : this;
            const before = new Set(parent?.children || []);
            const result = original.insertHtml.call(this, position, html);
            rememberNodes(owner, Array.from(parent?.children || []).filter(node => !before.has(node)));
            return result;
        };

        const installObserver = type => {
            const NativeObserver = window[type];
            if (typeof NativeObserver !== 'function') return;
            const observe = NativeObserver.prototype.observe;
            const disconnect = NativeObserver.prototype.disconnect;
            function ManagedObserver(callback) {
                const owner = currentOwner();
                if (!canTrack(owner)) return new NativeObserver(callback);
                const item = { owner, type, instance: null, targets: [], active: true, removed: false };
                item.instance = new NativeObserver(wrapCallback(owner, callback));
                observers.set(item.instance, item);
                bucket(owner).observers.push(item);
                if (paused.has(owner)) item.active = false;
                return item.instance;
            }
            ManagedObserver.prototype = NativeObserver.prototype;
            Object.setPrototypeOf(ManagedObserver, NativeObserver);
            NativeObserver.prototype.observe = function (target, options) {
                const item = observers.get(this);
                if (item) {
                    const known = item.targets.find(entry => entry.target === target);
                    if (known) known.options = options;
                    else item.targets.push({ target, options });
                    item.removed = false;
                    if (paused.has(item.owner)) return;
                    item.active = true;
                }
                return observe.call(this, target, options);
            };
            NativeObserver.prototype.disconnect = function () {
                const item = observers.get(this);
                if (item) { item.active = false; item.removed = true; item.targets = []; }
                return disconnect.call(this);
            };
            original[type] = { observe, disconnect };
            window[type] = ManagedObserver;
        };
        ['MutationObserver', 'ResizeObserver', 'IntersectionObserver'].forEach(installObserver);

        const jqueryOffArgs = args => {
            if (args[0] && typeof args[0] === 'object') return typeof args[1] === 'string' ? [args[0], args[1]] : [args[0]];
            const selector = typeof args[1] === 'string' ? args[1] : undefined;
            const handler = [...args].reverse().find(value => typeof value === 'function' || value === false);
            return selector === undefined ? [args[0], handler].filter(value => value !== undefined) : [args[0], selector, handler].filter(value => value !== undefined);
        };
        const installJquery = () => {
            const jq = window.jQuery || window.$;
            if (jqueryReady || !jq?.fn?.on || !jq?.fn?.off) return false;
            jqueryReady = true;
            const on = jq.fn.on;
            const one = jq.fn.one;
            const off = jq.fn.off;
            original.jqueryOff = off;
            const add = (method, collection, args) => {
                const owner = currentOwner();
                skipNativeEvent += 1;
                let result;
                try { result = method.apply(collection, args); }
                finally { skipNativeEvent -= 1; }
                if (canTrack(owner)) {
                    const item = { targets: collection.toArray(), args, offArgs: jqueryOffArgs(args), method, active: true, removed: false };
                    bucket(owner).jquery.push(item);
                    if (paused.has(owner)) { item.targets.forEach(target => off.apply(jq(target), item.offArgs)); item.active = false; }
                }
                return result;
            };
            jq.fn.on = function (...args) { return add(on, this, args); };
            if (one) jq.fn.one = function (...args) { return add(one, this, args); };
            jq.fn.off = function (...args) {
                const owner = currentOwner();
                if (canTrack(owner)) bucket(owner).jquery.forEach(item => {
                    if (item.targets.some(target => this.toArray().includes(target))) { item.active = false; item.removed = true; }
                });
                skipNativeEvent += 1;
                try { return off.apply(this, args); }
                finally { skipNativeEvent -= 1; }
            };
            return true;
        };

        const installEventSource = () => {
            const source = window.SillyTavern?.getContext?.().eventSource;
            if (sourceReady || !source?.on || !source?.off) return false;
            sourceReady = true;
            const on = source.on.bind(source);
            const off = source.off.bind(source);
            const once = typeof source.once === 'function' ? source.once.bind(source) : null;
            const removeListener = typeof source.removeListener === 'function' ? source.removeListener.bind(source) : off;
            original.sourceOn = on;
            original.sourceOff = off;
            original.sourceOnce = once;
            source.on = function (event, listener) {
                const owner = skipSourceEvent ? '' : currentOwner();
                const result = on(event, listener);
                if (canTrack(owner) && listener) {
                    const item = { event, listener, once: false, active: true, removed: false };
                    bucket(owner).source.push(item);
                    if (paused.has(owner)) { off(event, listener); item.active = false; }
                }
                return result;
            };
            const removeTrackedListener = (event, listener, method) => {
                const owner = currentOwner();
                if (canTrack(owner)) bucket(owner).source.forEach(item => {
                    if (item.event === event && item.listener === listener) { item.active = false; item.removed = true; }
                });
                return method(event, listener);
            };
            source.off = function (event, listener) { return removeTrackedListener(event, listener, off); };
            if (typeof source.removeListener === 'function') {
                source.removeListener = function (event, listener) { return removeTrackedListener(event, listener, removeListener); };
            }
            if (once) source.once = function (event, listener) {
                const owner = currentOwner();
                if (!canTrack(owner) || !listener) return once(event, listener);
                const item = { event, listener: null, once: true, active: true, removed: false };
                item.listener = wrapCallback(owner, listener, () => {
                    off(event, item.listener);
                    item.active = false;
                    item.removed = true;
                });
                skipSourceEvent += 1;
                try { on(event, item.listener); }
                finally { skipSourceEvent -= 1; }
                bucket(owner).source.push(item);
                if (paused.has(owner)) { off(event, item.listener); item.active = false; }
                return source;
            };
            return true;
        };

        const ignoreToggleError = (owner, phase, kind, item, error) => {
            if (item && typeof item === 'object' && 'removed' in item) {
                item.active = false;
                item.removed = true;
            }
            console.warn('[Extension Manager] Ignored stale ' + kind + ' while ' + phase + ' ' + owner + '.', error);
        };
        const pause = ownerValue => {
            const owner = normalize(ownerValue);
            paused.add(owner);
            const store = resources.get(owner);
            if (!store) return false;
            store.events.forEach(item => { try { if (item.active && !item.removed) original.removeEvent.call(item.target, item.type, item.registered, item.options); item.active = false; } catch (error) { ignoreToggleError(owner, 'pausing', 'event listener', item, error); } });
            store.jquery.forEach(item => { try { if (item.active && !item.removed && original.jqueryOff) item.targets.forEach(target => original.jqueryOff.apply((window.jQuery || window.$)(target), item.offArgs)); item.active = false; } catch (error) { ignoreToggleError(owner, 'pausing', 'jQuery listener', item, error); } });
            store.source.forEach(item => { try { if (item.active && !item.removed && original.sourceOff) original.sourceOff(item.event, item.listener); item.active = false; } catch (error) { ignoreToggleError(owner, 'pausing', 'SillyTavern event listener', item, error); } });
            store.timers.forEach(item => { try { if (item.active && !item.removed) original[item.kind === 'setTimeout' ? 'clearTimeout' : 'clearInterval'](item.handle); timerItems.delete(item.handle); item.active = false; } catch (error) { ignoreToggleError(owner, 'pausing', 'timer', item, error); } });
            store.frames.forEach(item => { try { if (item.active && !item.removed) original.cancelFrame(item.handle); frameItems.delete(item.handle); item.active = false; } catch (error) { ignoreToggleError(owner, 'pausing', 'animation frame', item, error); } });
            store.observers.forEach(item => { try { if (item.active && !item.removed) original[item.type]?.disconnect.call(item.instance); item.active = false; } catch (error) { ignoreToggleError(owner, 'pausing', 'observer', item, error); } });
            store.nodes.forEach(node => { try { hideNode(node); } catch (error) { ignoreToggleError(owner, 'pausing', 'interface node', node, error); } });
            store.styles.forEach(node => { try { disableStyle(node); } catch (error) { ignoreToggleError(owner, 'pausing', 'style', node, error); } });
            return true;
        };
        const resume = ownerValue => {
            const owner = normalize(ownerValue);
            paused.delete(owner);
            const store = resources.get(owner);
            if (!store) return false;
            store.events.forEach(item => { try { if (!item.active && !item.removed) { if (typeof item.options === 'object' && item.options?.signal?.aborted) { item.removed = true; return; } original.addEvent.call(item.target, item.type, item.registered, item.options); item.active = true; } } catch (error) { ignoreToggleError(owner, 'resuming', 'event listener', item, error); } });
            store.jquery.forEach(item => { try { if (!item.active && !item.removed) { item.targets.forEach(target => item.method.apply((window.jQuery || window.$)(target), item.args)); item.active = true; } } catch (error) { ignoreToggleError(owner, 'resuming', 'jQuery listener', item, error); } });
            store.source.forEach(item => { try { if (!item.active && !item.removed && original.sourceOn) { original.sourceOn(item.event, item.listener); item.active = true; } } catch (error) { ignoreToggleError(owner, 'resuming', 'SillyTavern event listener', item, error); } });
            store.timers.forEach(item => { try { if (!item.active && !item.removed) { item.handle = original[item.kind](item.callback, item.delay, ...item.args); timerItems.set(item.handle, item); item.active = true; } } catch (error) { ignoreToggleError(owner, 'resuming', 'timer', item, error); } });
            store.frames.forEach(item => { try { if (!item.active && !item.removed) { item.handle = original.requestFrame(item.callback); frameItems.set(item.handle, item); item.active = true; } } catch (error) { ignoreToggleError(owner, 'resuming', 'animation frame', item, error); } });
            store.observers.forEach(item => { try { if (!item.active && !item.removed) { item.targets.forEach(entry => original[item.type]?.observe.call(item.instance, entry.target, entry.options)); item.active = item.targets.length > 0; } } catch (error) { ignoreToggleError(owner, 'resuming', 'observer', item, error); } });
            store.nodes.forEach(node => { try { showNode(node); } catch (error) { ignoreToggleError(owner, 'resuming', 'interface node', node, error); } });
            store.styles.forEach(node => { try { enableStyle(node); } catch (error) { ignoreToggleError(owner, 'resuming', 'style', node, error); } });
            return true;
        };
        const dispose = (ownerValue, removeNodes = false) => {
            const owner = normalize(ownerValue);
            pause(owner);
            if (removeNodes) {
                resources.get(owner)?.nodes.forEach(node => node.remove());
                resources.get(owner)?.styles.forEach(node => node.remove());
            }
            resources.delete(owner);
            paused.delete(owner);
        };

        const stopPassiveTracking = (force = false) => {
            const remaining = passiveTrackingDeadline - performance.now();
            if (!force && remaining > 0) {
                original.setTimeout(() => stopPassiveTracking(false), remaining);
                return;
            }
            passiveOwnerTracking = false;
        };
        const beginCapture = (duration = 2500) => {
            const delay = Math.max(0, Number(duration) || 0);
            passiveTrackingDeadline = Math.max(passiveTrackingDeadline, performance.now() + delay);
            passiveOwnerTracking = true;
            original.setTimeout(() => stopPassiveTracking(false), delay);
        };

        installJquery();
        installEventSource();
        const discoveryTimer = original.setInterval(() => {
            installJquery();
            installEventSource();
            if (jqueryReady && sourceReady) original.clearInterval(discoveryTimer);
        }, 500);
        original.addEvent.call(document, 'pointerdown', () => stopPassiveTracking(true), { capture: true, once: true, passive: true });
        original.addEvent.call(document, 'keydown', () => stopPassiveTracking(true), { capture: true, once: true });
        original.setTimeout(() => stopPassiveTracking(false), 8000);
        const runtime = {
            version: 3,
            pause,
            resume,
            dispose,
            beginCapture,
            has: owner => resources.has(normalize(owner)),
            isPaused: owner => paused.has(normalize(owner)),
            runWithOwner: (owner, callback) => runOwned(owner, callback),
            trackNode: (owner, node) => { if (canTrack(normalize(owner)) && node instanceof Element) bucket(owner).nodes.add(node); },
            stats: owner => {
                const store = resources.get(normalize(owner));
                return store ? Object.fromEntries(Object.entries(store).map(([key, value]) => [key, value.size ?? value.length])) : null;
            },
        };
        window[HOT_RUNTIME_KEY] = runtime;
        return runtime;
    }

    const extensionHotRuntime = installExtensionHotRuntime();
    const FAQ_ITEMS = [{
        id: 'invalid-csrf-token',
        title: '1.15.0 以及更高版本酒馆出现 ForbiddenError: Invalid CSRF token',
        solution: '**扩展管理器会在遇到此错误时自动刷新 CSRF token 并重试一次。**\n\n1. 请先更新扩展并刷新网页。\n2. 若仍不行，请先关闭 SillyTavern 后端，将 `config.yaml` 中 `disableCsrfProtection` 的 `false` 修改为 `true`，保存后重新启动 SillyTavern。\n\n> **注意：** ==此操作会降低 CSRF 防护==，仅建议作为最后的临时排查手段。',
    }, {
        id: 'http-403-forbidden',
        title: '检测更新返回 403 Forbidden 或 HTML 错误页面',
        solution: '**这是 HTTP 访问权限或登录校验拒绝**，检测请求在进入 Git 更新逻辑前就被 SillyTavern、反向代理或登录中间件拦截，并非 GitHub 仓库或插件代码报错。\n\n扩展管理器会针对这种裸 403 自动刷新 CSRF token 并重试一次。请先更新扩展管理器并刷新酒馆页面；仍失败时请退出后重新登录，确认当前账号有权管理该扩展。若扩展安装在全局目录，请使用管理员账号操作，或将扩展重新安装到当前用户目录。使用反向代理时，请确认 Cookie、Host 和 CSRF 请求头被正常转发，并查看 SillyTavern 后端控制台中的对应 403 日志。\n\n> **不要优先关闭 CSRF 防护。** 若报错明确包含 `Invalid CSRF token`，请查看上一条常见问题。',
    }];
    const CHANGELOG_ITEMS = [{
        id: 'v1.23.13', version: 'v1.23.13', date: '2026-08-23', title: '修复禁用入口复现并简化仓库导入', summary: '禁用后补做一次入口复核，导入 GitHub 地址时自动去掉末尾 .git。', content: "**禁用修复：** 酒馆切换扩展状态后如果重新创建入口，管理器会在下一帧再次隐藏，避免面板继续可交互；不使用常驻扫描。\n\n**导入优化：** 输入以 `.git` 结尾的 GitHub 仓库地址会在安装请求前自动去掉后缀。",
        id: 'v1.23.12', version: 'v1.23.12', date: '2026-08-23', title: '卸载前立即隐藏扩展入口', summary: '卸载现在先执行禁用热清理，删除请求期间入口不可见、不可交互。', content: "**处理顺序：** 点击卸载后先立即隐藏入口、停止事件和定时器、禁用样式，再请求删除扩展文件。删除完成后继续清理残留资源；如果删除请求失败，会尝试恢复扩展。",
    }, {
        id: 'v1.23.11', version: 'v1.23.11', date: '2026-08-23', title: '彻底清理卸载后的残留入口', summary: '补充未被运行时追踪的菜单和设置入口扫描，卸载后不再留下不可点击的入口。', content: '**问题原因：** 部分扩展在管理器开始追踪前就创建了菜单或设置入口，旧版卸载只能清理已追踪节点。\n\n**本次修复：** 卸载会补充识别插件中文名、显示名、名称和 ID，并扫描酒馆扩展菜单与设置容器，移除所有匹配的残留入口；普通禁用仍只隐藏入口，不会删除。',
    }, {
        id: 'v1.23.10',
        version: 'v1.23.10',
        date: '2026-08-23',
        title: '修复卸载后入口残留',
        summary: '卸载流程现在复用禁用扩展的入口和运行时清理逻辑。',
        content: '**问题原因：** 禁用扩展时会扫描并隐藏扩展菜单入口、设置入口、脚本事件和样式；旧版卸载只清理已经被运行时追踪的节点，部分入口没有被追踪，因此文件夹删除后入口仍然可见。\n\n**现在的处理：** 卸载前会复用禁用流程，先隐藏入口、停止事件/定时器/观察器并禁用样式；删除目录成功后再移除脚本、样式和已记录的界面节点，清理资料并重新读取扩展状态。',
    }, {
        id: 'v1.23.9',
        version: 'v1.23.9',
        date: '2026-08-23',
        title: '修复卸载接口返回格式',
        summary: '修复卸载前端扩展时酒馆返回纯文本导致的 JSON 报错。',
        content: '**问题原因：** 酒馆原生删除接口会先删除扩展目录，然后返回一段纯文本确认信息；旧版请求解析器强制按 JSON 读取，因此文件可能已经删除，却在页面显示“不是 JSON”的卸载失败。\n\n**现在的处理：** 请求解析器会根据内容尝试读取 JSON；遇到酒馆的纯文本删除结果也会视为成功。随后扩展管理器会热清理脚本、样式、事件和入口，清除中文资料与白名单记录，并重新读取扩展列表，不需要刷新网页。',
    }, {
        id: 'v1.23.8',
        version: 'v1.23.8',
        date: '2026-08-23',
        title: '补齐前后端扩展卸载',
        summary: '前端、后端、白名单、检测结果、多选和分组现在都可以卸载插件。',
        content: '**前端卸载：** 第三方前端扩展可以从普通列表、白名单页和检测结果页直接卸载，也支持多选和整组卸载。卸载完成后会沿用热更新的资源清理方式移除脚本、样式、事件和当前页面入口，不刷新浏览器。\n\n**后端卸载：** 后端插件支持单个、多选和整组卸载。管理后端会安全删除对应的 plugins 子目录并清理资料与白名单记录；完成后会提示手动重启 SillyTavern。\n\n> **防误删：** SillyTavern 内置前端扩展和扩展管理器本体不可删除，按钮会锁定并显示原因，接口也会再次拒绝。所有批量与分组卸载都会先要求确认。',
    }, {
        id: 'v1.23.7',
        version: 'v1.23.7',
        date: '2026-08-23',
        title: '彻底降低键盘与页面操作卡顿',
        summary: '移除正常使用期间的调用栈扫描和全量资源遍历，禁用入口只在点击时检查一次。',
        content: '**键盘卡顿修复：** 旧热启停运行时会在页面添加事件、定时器、动画和 DOM 时反复解析调用栈，手机键盘弹出和输入会触发大量此类操作。现在扩展初始化结束、用户首次触摸或按键后就停止被动识别；正常聊天和输入不再解析调用栈。热更新到本版本时会立即用浏览器原生事件、定时器和 DOM 方法绕过旧包装器，不要求刷新页面。\n\n**高频操作提速：** 定时器、动画帧和事件监听器改为直接索引，清理时不再遍历所有插件的历史资源。Firefox 已实测事件、DOM 和定时器原生旁路全部通过，不会重新引入 Illegal invocation。\n\n**严格一次检查：** 点击禁用后只扫描一次当前插件入口并隐藏，随后立即结束。已删除 150ms、600ms、1500ms 三次复查、复查计时器，以及重新读取前端列表时对全部禁用插件的扫描。\n\n**后端说明：** 键盘、事件和 DOM 都在浏览器中运行，后端无法代替处理。本次直接移除了前端高频开销；后端继续只在用户主动读取、检测或更新时工作。',
    }, {
        id: 'v1.23.6',
        version: 'v1.23.6',
        date: '2026-08-23',
        title: '加快前端扩展列表读取',
        summary: '打开管理器时优先显示前端列表，不再为每个扩展重复强制读取 manifest。',
        content: '**读取提速：** 前端列表现在优先复用 SillyTavern 已经加载到内存的扩展 manifest。兼容旧版酒馆时才会补读 manifest 文件，并允许浏览器复用已有缓存，减少大量重复请求和无效路径尝试。\n\n**并行加载：** 前端扩展列表与管理后端连接、中文标注和分组资料改为同时读取。前端列表准备好后会立即显示，后端资料稍后返回时自动补齐，不再因为后端响应慢一直卡在“读取插件”。\n\n**更新准确性：** 插件更新完成后仍会强制读取最新 manifest，因此提速不会导致版本号或插件资料停留在更新前。',
    }, {
        id: 'v1.23.5',
        version: 'v1.23.5',
        date: '2026-08-23',
        title: '修复新版安装后酒馆卡顿',
        summary: '禁用入口检查改为一次性流程，完成短时复核后彻底停止，不再持续占用酒馆页面。',
        content: '**卡顿原因：** 上个版本为了防止插件异步重新插入入口，留下了常驻页面观察器。部分插件频繁更新界面时，会反复触发禁用入口扫描。\n\n**本次修复：** 点击禁用后先立即处理入口，再仅于 150ms、600ms 和 1500ms 复核排队中的异步界面。最后一次复核完成后流程彻底结束，不保留 DOM 监听、轮询或周期扫描；启用插件会立即取消该插件尚未执行的禁用复核。\n\n**后端核对：** 管理后端没有常驻轮询或自动 Git 扫描，仅在用户主动读取、检测或更新时工作，请求完成后即停止，因此本次无需增加后端任务或重启后端。',
    }, {
        id: 'v1.23.4',
        version: 'v1.23.4',
        date: '2026-08-23',
        title: '修复部分插件禁用后设置入口仍然存在',
        summary: '扩展管理页的设置块和延迟创建的入口现在会随插件禁用立即隐藏。',
        content: '**设置页兼容：** SillyTavern 和部分插件会把设置界面放进 `extensions_settings2` 等设置容器。过去管理器只扫描旧容器，像羁绊助手这样的设置块就可能在禁用后继续显示；现在会识别全部扩展设置容器，并按插件显示名收回整块设置界面。\n\n**持续守卫：** 禁用后会继续观察插件界面。如果插件通过异步任务再次插入按钮、抽屉或设置块，新入口也会立即隐藏；启用时则原地恢复，不刷新浏览器。',
    }, {
        id: 'v1.23.3',
        version: 'v1.23.3',
        date: '2026-08-23',
        title: '修复部分插件禁用时报 Illegal invocation',
        summary: '失效的浏览器对象不再中断热禁用，插件入口和样式会继续正常隐藏。',
        content: '**异常隔离：** 部分插件会在 iframe、临时窗口或已经销毁的节点上注册事件和观察器。过去清理这些失效对象时，浏览器可能抛出 Illegal invocation，导致后面的入口隐藏没有执行。现在每一项资源会独立处理，失效项只记录警告，不会中断其他事件、定时器、样式和入口的禁用或恢复。\n\n**入口兜底：** 插件入口显隐已从资源清理流程中独立出来，即使某个第三方对象无法调用，入口和主样式仍会按启用状态同步变化。\n\n**无需刷新：** 从 v1.23.2 热更新时会在线兼容已有运行时，修复生效不需要刷新浏览器。',
    }, {
        id: 'v1.23.2',
        version: 'v1.23.2',
        date: '2026-08-23',
        title: '第三方扩展真正无刷新热启停',
        summary: '扩展无需自带热启停接口，也能在当前酒馆页面暂停和恢复。',
        content: '**无刷新启停：** 扩展管理器会在第三方扩展加载时记录它创建的原生事件、jQuery 事件、酒馆事件订阅、定时任务、动画帧、页面观察器、样式和界面入口。禁用时统一暂停并隐藏，启用时原地恢复，整个过程不会刷新浏览器。\n\n**兼容普通扩展：** 插件不需要提供 `enable/disable` 或清理接口。单项启停、多选、检测结果页和白名单页都使用同一套运行时托管。首次启用本页尚未加载的扩展时，管理器会直接加载它的入口脚本。\n\n**字体管理器：** Ny 字体管理器继续使用专用适配，字体效果、聊天字体扫描和设置入口会随启停同步恢复。',
    }, {
        id: 'v1.23.1',
        version: 'v1.23.1',
        date: '2026-08-23',
        title: '修复扩展启用与禁用兼容性',
        summary: '按扩展实际生命周期选择热切换或安全刷新，并专门适配 Ny 字体管理器。',
        content: '**启停修复：** 不再强制把所有扩展当成可以卸载的普通脚本。支持 `hooks.enable/disable`、纯 CSS 或显式清理函数的扩展继续热切换；没有清理生命周期的旧式扩展会保存状态后自动刷新一次，确保事件、定时器和入口真正加载或停止。批量启停会先处理完整批次，再只刷新一次。\n\n**Ny 字体管理器：** 禁用时调用它自己的字体应用与聊天扫描逻辑清除字体效果、动态样式和设置入口；启用时恢复原字体开关、CSS、设置界面和聊天字体扫描，不会因为 ES module 子模块缓存而加载失败。\n\n> 页面刷新只用于无法安全热卸载的旧式扩展，这是浏览器模块和事件监听的限制，不会影响已经支持生命周期的扩展。'
    }, {
        id: "v1.23.0",
        version: "v1.23.0",
        date: "2026-08-21",
        title: "新增可选排序与启用扩展优先",
        summary: "前端、后端、白名单和检测结果页都可以按常用字段排序。",
        content: "**排序：** 前端扩展可按首字母、安装/更新时间、启用状态、类型或检测状态排序；后端插件可按首字母、更新时间或检测状态排序；白名单和检测结果页也有对应的排序选择。\n\n**检测结果：** 默认仍按检测失败（红色）、可更新（绿色）、最新排列，方便先处理异常和更新；检测结果页可以切换为启用状态、安装/更新时间或首字母排序。\n\n**启用扩展优先：** 在“安装扩展”页的设置中打开后，前端列表、白名单和检测结果的同一状态组内会把已启用扩展排在已禁用扩展前面。关闭后恢复原顺序。\n\n后端插件会使用 Git 当前提交时间排序；没有提交时间时使用安装目录时间。"
    }, {
        id: 'v1.22.1',
        version: 'v1.22.1',
        date: '2026-08-21',
        title: '修复禁用后入口和功能残留',
        summary: '禁用扩展后会重新核对酒馆状态，并清理目标扩展的脚本、样式和菜单入口。',
        content: '**修复内容：** 启停操作现在使用酒馆返回的内部扩展名称，保存后立即重新读取状态；只有酒馆确认已经禁用，界面才会显示成功。\n\n禁用时会移除目标扩展的 JS 和 CSS，按插件 ID、中文名和显示名称清理魔法棒菜单入口，并在页面完成两个渲染帧后再检查一次，避免延迟生成的入口残留。单项、多选、检测结果页和白名单页全部使用同一套逻辑。\n\n> **兼容提示：** 若第三方扩展没有实现酒馆的 disable 清理钩子，它已经注册到全局的事件监听或常驻任务无法由管理器安全猜测；管理器会清掉可识别入口，但这类插件的深层运行状态仍可能需要刷新页面。'
    }, {
        id: 'v1.22.0',
        version: 'v1.22.0',
        date: '2026-08-21',
        title: '后端连接按钮与禁用热清理',
        summary: '安装或更新后端后，可以在页面内重新连接并读取状态；禁用前端扩展时会更可靠地移除已加载脚本。',
        content: '**后端：** 执行 Termux 或 Windows 安装命令、重启酒馆后，在“安装扩展”页点击“连接后端”或“重新连接”，管理器会直接读取后端状态和插件列表，不需要刷新整个网页。后端代码已经更新但酒馆进程还没有重启时，按钮只能读取旧进程，仍需先重启一次才能加载新代码。\n\n**前端：** 禁用扩展时会调用酒馆的禁用钩子，按实际脚本路径移除已加载文件，并清理能识别到的扩展菜单入口。第三方扩展如果没有提供清理钩子，自己创建的弹窗或按钮可能仍需按该扩展说明关闭。'
    }, {
        id: 'v1.21.0',
        version: 'v1.21.0',
        date: '2026-08-21',
        title: '启用和禁用扩展改为热更新',
        summary: '现在切换扩展状态不会刷新整个酒馆网页，操作完成后会立即在当前页面生效。',
        content: '**这次更新解决了什么？** 以前点击“启用”或“禁用”可能触发酒馆页面刷新；现在扩展管理器会调用酒馆接口保存状态，再只重新加载目标扩展的脚本。\n\n> **启用：** 重新加载目标扩展，让它立即开始工作。\n\n> **禁用：** 先执行扩展自己的清理，再移除目标脚本，让它立即停止工作。\n\n批量操作、检测结果页和白名单页的启用/禁用也同步使用这套热更新逻辑。页面不会跳走，正在查看的搜索、分组和检测结果会保留。若某个第三方扩展没有提供清理函数，管理器仍会移除它的脚本；这类扩展如果还残留页面元素，请按该扩展自己的说明处理。'
    }, {
        id: 'v1.20.0',
        version: 'v1.20.0',
        date: '2026-08-20',
        title: '内置扩展排除检测与分组白名单',
        summary: '内置扩展不再参与检测更新，前后端分组可以整组加入或移出白名单。',
        content: '**主要变化：** 内置扩展保留查看资料、仓库和备注等基础能力，但不会被批量、分组或单项检测更新。前端和后端分组标题增加盾牌按钮，可以一键加入白名单；白名单页面也可以整组移出。\n\n常见问题和新手教程现在支持重点、下划线、删除线、引用和高亮。'
    }];
    const TUTORIAL_SECTIONS = [
        { id: 'getting-started', title: '一、开始使用与界面', icon: 'fa-compass', items: [{ title: '第一次打开扩展管理器', content: '1. 刷新 SillyTavern 网页，打开顶部的魔法棒菜单。\n2. 点击“扩展管理器”进入主界面。\n3. 顶部三个标签分别是“前端扩展”“后端管理”“安装扩展”。\n4. 标题下方会显示服务端存储是否连接；__未连接时，前端中文名、备注和分组仍会保存在当前浏览器。__' }, { title: '标题栏、主题和关闭按钮', content: '标题栏会显示扩展管理器版本号。右上角太阳或月亮按钮用于切换日间、夜间模式，并会记住选择；叉号用于关闭管理器。点击顶部标签可以随时切换前端、后端和安装设置页面。' }, { title: '收起面板、拖动悬浮球和调整大小', content: '点击右上角收起按钮后，管理器会变成悬浮球，不会中断正在进行的检测。拖动悬浮球可以改变位置，点击悬浮球会恢复完整面板。\n\n在“前端扩展”页上方拖动“悬浮球大小”滑杆，可在 25-56px 之间调整大小；位置和主题保存在浏览器，大小在管理后端连接时保存。' }] },
        { id: 'frontend', title: '二、前端扩展管理', icon: 'fa-puzzle-piece', items: [{ title: '看懂前端扩展卡片', content: '每张卡片会显示扩展名称、安装类型、所属分组、启用状态、插件 ID、GitHub 作者、版本号、提交号、分支、备注和仓库入口。\n\n“当前用户”只属于当前酒馆账号，“全局”对全部账号可见，“内置”是 SillyTavern 自带扩展。开启隐私打码后，ID、作者和提交号会被模糊。' }, { title: '搜索、取消搜索、筛选、排序和重新读取', content: '在搜索框输入名称、仓库、分组或备注即可过滤列表；点击旁边的“取消搜索”立即恢复完整列表。分组下拉框只显示指定文件夹，排序下拉框可按首字母、安装/更新时间、启用状态、类型或检测状态排列。右侧刷新图标会重新读取 SillyTavern 当前安装的扩展。' }, { title: '检测和更新扩展管理器本体', content: '在“扩展管理器本体”一栏点击“检测”。==发现新版本后才会出现“更新”按钮==；点击更新会拉取新代码并热加载扩展管理器，入口不会消失，也不需要刷新整个网页。' }, { title: '单个扩展的检测、更新、启用和禁用', content: '点击卡片上的“检查”只检测这一项，并留在当前页面。**只有检测到新版本后才会出现“更新”**，避免~~未检测就直接更新~~。\n\n“启用/禁用”会先保存酒馆状态，再由扩展管理器暂停或恢复目标扩展的事件、定时任务、观察器、样式和界面入口。第三方扩展不需要自带热启停接口，整个过程不会刷新浏览器。批量、检测结果页和白名单页使用相同逻辑；Ny 字体管理器另有专用字体与扫描适配。' }, { title: '如何卸载前端扩展', content: '第三方前端扩展卡片提供“卸载”按钮，确认后会删除扩展文件，并沿用热更新资源清理方式移除当前页面中的脚本、样式、事件和入口，不需要刷新网页。普通列表、白名单和检测结果页均可卸载，也支持多选和整组卸载。==内置扩展与扩展管理器本体不允许删除==，按钮会锁定并提示原因。' }, { title: '编辑中文名、分组和备注', content: '点击“中文资料与分组”，填写中文名、分组或备注后保存。输入新的分组名称会自动形成文件夹；这些只是扩展管理器中的标记，不会移动、改名或修改原始插件目录。' }] },
        { id: 'detection', title: '三、检测、更新与结果页', icon: 'fa-magnifying-glass', items: [{ title: '检测全部、检测分组和检测选中', content: '**“检测更新”只会检查全部非白名单、非内置的前端扩展；**分组标题旁的放大镜只检查该文件夹；进入多选后可使用“检测选中”。后端和白名单页也提供相同的全部、分组和多选检测。\n\n单插件检测不会打开结果页，其他批量检测完成后都会进入本批检测结果页。' }, { title: '查看检测进度和手动取消', content: '检测期间按钮和卡片会显示旋转图标，前端与后端状态栏会显示“已完成/总数”。\n\n> **取消规则：** 点击顶部“取消检测”后，正在检测的项目会完成，==尚未开始的项目会停止==，不会伪造已完成数量。取消后保留已经得到的检测结果。' }, { title: '检测失败、重试和复制报错', content: '==检测失败的卡片会标红==并显示“查看报错”。展开后可以查看原始错误并一键复制诊断信息，复制内容不会包含仓库地址和插件 ID。\n\n列表上方的“重试失败”只重新检查失败项；弱网时也可以在网络恢复后再次检测。' }, { title: '看懂独立检测结果页', content: '批量检测完成后，结果页会直接罗列本批插件，不按原分组拆分。顺序为：检测失败的红色卡片、需要更新的绿色卡片、无需更新的插件，最后是未完成项。\n\n结果页支持搜索、取消搜索、重新检测、一键更新、多选、全选当前、清空、检测选中和更新选中；前端结果还支持启用或禁用。点击左上角返回原管理页面。' }, { title: '一键更新和顺序热更新规则', content: '**“更新全部”只更新本次已经检测并确认有新版本的插件；**“更新选中”也要求所选插件先完成检测。前端扩展会一个接一个更新并尝试热加载，不刷新整个网页。更新完成后会重新读取扩展状态、版本和提交信息。' }, { title: '检测后的临时排序和颜色', content: '除单插件检测外，检测结束后主列表会在每个分组内临时按“失败、可更新、最新、未检测”排序。失败卡片标红，可更新卡片标绿。手动更改排序方式后会退出临时排序。' }] },
        { id: 'batch-groups', title: '四、多选与分组操作', icon: 'fa-list-check', items: [{ title: '如何使用多选模式', content: '点击列表右侧“多选”，再点击卡片左侧选择框。只选一个插件也可以执行多选操作。“全选当前”只选择搜索和筛选后当前可见的项目，“清空”取消全部选择，再次点击“退出多选”返回普通模式。' }, { title: '前端和后端支持哪些批量操作', content: '前端多选支持：分组、加入白名单、检测选中、更新选中、启用选中、禁用选中和卸载选中。\n\n后端多选支持：分组、加入白名单、检测选中、更新选中和卸载选中。所有更新都会先核对检测结果，再逐项执行。白名单页和检测结果页也有对应的多选操作。' }, { title: '创建、展开和管理文件夹分组', content: '在多选工具栏选择已有分组，或选择“新建分组”输入名称，即可把插件标记到文件夹。文件夹默认收起，点击左侧箭头展开或折叠。\n\n文件夹右侧按钮依次可**检测分组、更新分组、整组加入白名单、添加新插件、重命名、解散和卸载分组**。解散只清除分组标记，不会删除插件；分组更新只处理该组内已检测到更新的项目。' }, { title: '内置与未分组文件夹', content: 'SillyTavern 自带的前端扩展会自动归入“内置”文件夹，不需要手动选择。没有自定义分组的项目显示在“未分组”。“内置”和“未分组”是保留名称，不能当作普通自定义分组重命名。\n\n> **内置扩展不参与任何检测或更新**，但仍保留查看仓库、资料和备注等基础按钮。' }] },
        { id: 'backend', title: '五、后端插件管理', icon: 'fa-server', items: [{ title: '后端管理需要什么条件', content: '“后端管理”页面最上方单独显示扩展管理器后端的检测与更新；下方列表读取 SillyTavern/plugins 中安装的其他后端插件。要使用读取、分组、白名单、检测和更新能力，必须先安装扩展管理器后端，并在 config.yaml 中启用服务端插件，然后手动重启 SillyTavern。' }, { title: '读取和查看后端插件信息', content: '点击“读取插件”刷新列表。后端页支持搜索、取消搜索、分组筛选、按名称或更新状态排序。卡片会显示插件 ID、GitHub 作者、版本号、提交号、分支、备注和是否支持自动更新，便于核对实际安装代码。' }, { title: '后端检测、更新和重启规则', content: '页面顶部可单独检测和更新扩展管理器后端；普通“检测全部”和“更新全部”只处理下方的其他后端插件。其他插件可以检测全部、单个、分组或选中项，只有检测到更新的独立 Git 仓库才允许更新，管理器会依次执行安全的 git pull --ff-only。\n\n> **后端更新不会自动停止或重启 SillyTavern。** 全部完成后==必须由用户手动重启==，更新后的后端代码才会生效。' }, { title: '后端中文资料、分组和多选', content: '管理后端连接后，可为后端插件保存中文名、备注和文件夹分组。文件夹支持展开、检测、更新、添加、重命名和解散；多选支持分组、加入白名单、检测、顺序更新和卸载，操作方式与前端页一致。后端插件不提供前端扩展的启用/禁用按钮。' }] },
        { id: 'whitelist', title: '六、更新检测白名单', icon: 'fa-shield-halved', items: [{ title: '白名单有什么作用，怎样加入', content: '白名单适合已经停更、删除仓库、使用私有修改版或不希望自动检测的插件。白名单项目不会参加主列表的全部检测、多选检测或一键更新。\n\n加入方法：在前端或后端主列表进入多选，选择一个或多个插件，再点击“加入白名单”；也可以点击分组标题旁的盾牌按钮，==一键将整个分组加入白名单==。' }, { title: '进入白名单并切换前后端', content: '进入“安装扩展”页，在设置区域点击“白名单管理”。页面只显示已经加入白名单的插件；顶部按钮可切换前端扩展和后端插件。未安装但仍保留记录的项目会显示“未安装”，可以继续保留或移出。' }, { title: '白名单内仍可手动检测和更新', content: '白名单只是跳过主列表自动操作，不代表永远不能更新。在白名单页仍可单个、分组、全部或多选检测，并可更新已确认有新版本的项目。检测完成同样会进入结果页，失败项可重试。前端白名单还支持批量启用和禁用。' }, { title: '白名单的搜索、分组和移出操作', content: '白名单支持搜索、取消搜索、分组筛选、状态排序、默认折叠文件夹、多选、全选当前和清空。分组支持添加、重命名、解散、检测与更新。点击卡片“移出白名单”可移出单项，多选后可一次移出多个；点击分组标题旁的盾牌按钮可**将整个分组移出白名单**。移出不会卸载插件。' }] },
        { id: 'installation', title: '七、安装前端与后端', icon: 'fa-download', items: [{ title: '通过 Git 地址安装前端扩展', content: '在“安装扩展”页输入完整 Git 仓库地址。需要指定特殊分支或标签时填写“分支或标签”，否则留空；“当前用户”只安装给当前账号，“全部用户”安装为全局扩展。点击“安装并加载”，成功后会动态读取并加载，不需要刷新网页。' }, { title: '安装扩展管理器后端', content: '在后端安装区域选择自己的运行环境：Termux 或 Windows。点击复制一键命令，再到对应终端中粘贴执行。命令为单行串联操作，会安装或复用后端并开启 enableServerPlugins。\n\n> **命令不会自动重启 SillyTavern，执行完成后请手动重启。**\n\n若 SillyTavern 不在默认目录，先把命令中的路径改成实际目录。其他后端插件的一键安装暂未开放。' }] },
        { id: 'settings-data', title: '八、设置、隐私与数据保存', icon: 'fa-gear', items: [{ title: '隐私打码', content: '在“安装扩展”页的设置中打开“隐私打码”，插件 ID、GitHub 用户名和提交号会在界面中模糊显示，适合截图分享。关闭后恢复正常显示。该功能只改变展示，不修改插件或仓库信息。' }, { title: '弱网检测优化和 Git 代理', content: '“弱网检测优化”默认开启：降低前端检测并发，并对临时网络错误自动退避重试。网络稳定时可以关闭。打开“启用扩展优先”后，列表和检测结果同一状态组内会把已启用扩展排在已禁用扩展前面。\n\n“Git 代理”只临时用于后端插件的 Git 检测和更新，例如填写本机代理地址；它不会修改全局 Git 配置，也不会改写插件仓库地址。修改后点击“保存设置”。' }, { title: '资料保存在哪里', content: '管理后端已连接时，前端中文名、备注和分组会按酒馆账号保存到后端；未连接时自动保存在当前浏览器。日间/夜间模式和悬浮球位置保存在浏览器。\n\n后端插件资料、白名单、悬浮球大小、弱网开关和 Git 代理需要管理后端保存。换设备或浏览器时，本地保存的前端标注不会自动同步。' }, { title: '常见问题和自动 CSRF 恢复', content: '新手教程下方的“常见问题”用于查看已知报错与解决方案。遇到 Invalid CSRF token 或裸 403 Forbidden 时，扩展管理器会先刷新 CSRF token 并自动重试一次；仍失败再按常见问题中的步骤排查。' }] },
    ];
    const timers = [];
    const state = { extensions: [], filter: '', category: '', sort: 'name', statusSortActive: false, checking: false, frontendCheckProgress: { completed: 0, total: 0 }, detectionActive: false, detectionCancelled: false, detectionMessage: '', updating: new Set(), uninstalling: new Set(), updates: new Map(), checkingExtensions: new Set(), togglingExtensions: new Set(), selectedExtensions: new Set(), groupPickerSelections: new Set(), expandedGroups: new Set(), groupPicker: '', groupAction: { group: '', phase: '' }, selectionMode: false, batchUpdating: false, batchToggling: false, batchAction: '', minimized: false, meta: {}, backendMeta: {}, whitelist: { frontend: [], backend: [] }, settings: { floatingBallSize: FLOATING_BALL_DEFAULT, privacyMasking: false, networkOptimization: NETWORK_OPTIMIZATION_DEFAULT, enabledFirst: false, gitProxy: '' }, backendInstallPlatform: 'termux', backendConnecting: false, backend: { available: false, error: '', version: '', supportsBackendMeta: false, supportsWhitelist: false, supportsNetworkOptimization: false } };
    const selfUpdateState = { phase: 'idle', message: '点击按钮检查本体更新', canUpdate: false, latestVersion: '', extensionName: EXTENSION_DEFAULT_FOLDER, global: false };
    const backendSelfUpdateState = { phase: 'idle', message: '点击按钮检查后端更新', canUpdate: false, version: '', restartRequired: false };
    const backendUpdateState = { phase: 'idle', message: '读取后端插件后可检测更新', canUpdate: false, plugins: [], restartRequired: false, batchUpdating: false, batchAction: '', checkingPlugins: new Set(), checkedPlugins: new Set(), selectedPlugins: new Set(), expandedGroups: new Set(), groupPickerSelections: new Set(), groupPicker: '', groupAction: { group: '', phase: '' }, selectionMode: false, filter: '', category: '', sort: 'name', statusSortActive: false };
    const whitelistState = { scope: 'frontend', selected: new Set(), filter: '', category: '', sort: 'name', statusSortActive: false, selectionMode: false, expandedGroups: { frontend: new Set(), backend: new Set() }, groupPicker: '', groupPickerSelections: new Set(), groupAction: { group: '', phase: '' }, batchAction: '' };
    const detectionResults = { active: false, scope: 'frontend', ids: [], filter: '', sort: 'status', selected: new Set(), selectionMode: false, allowWhitelisted: false, returnPanel: 'installed', title: '检测结果', action: '', message: '' };
    let extensionApiPromise = null;
    let csrfTokenOverride = '';
    let csrfRefreshPromise = null;

    if (typeof window.__extensionManagerCleanup === 'function') window.__extensionManagerCleanup();

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    const backendInstallCommand = () => BACKEND_INSTALL_COMMANDS[state.backendInstallPlatform] || BACKEND_INSTALL_COMMANDS.termux;

    function syncSearchInput($input, value) {
        if (!$input.length || document.activeElement === $input[0]) return;
        const nextValue = String(value || '');
        if (String($input.val() || '') !== nextValue) $input.val(nextValue);
    }

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
        if (typeof getRequestHeaders === 'function') Object.assign(headers, getRequestHeaders());
        else if (window.token) headers['X-CSRF-Token'] = window.token;
        if (csrfTokenOverride) headers['X-CSRF-Token'] = csrfTokenOverride;
        return headers;
    };

    function isInvalidCsrfResponse(response, body) {
        return response.status === 403 && (/invalid csrf token/i.test(String(body || '')) || /<pre>\s*Forbidden\s*<\/pre>/i.test(String(body || '')) || String(body || '').trim() === 'Forbidden');
    }

    async function refreshCsrfToken() {
        if (!csrfRefreshPromise) {
            csrfRefreshPromise = fetch('/csrf-token', { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
                .then(async response => {
                    if (!response.ok) throw new Error((await response.text()) || '无法刷新 CSRF token');
                    const data = await response.json();
                    const token = String(data?.token || '').trim();
                    if (!token) throw new Error('CSRF token 响应为空');
                    csrfTokenOverride = token;
                    return token;
                })
                .finally(() => { csrfRefreshPromise = null; });
        }
        return csrfRefreshPromise;
    }

    async function request(url, options = {}) {
        const execute = () => {
            const headers = { ...requestHeaders(), ...(options.headers || {}) };
            if (csrfTokenOverride) headers['X-CSRF-Token'] = csrfTokenOverride;
            return { token: String(headers['X-CSRF-Token'] || ''), promise: fetch(url, { ...options, credentials: options.credentials || 'same-origin', headers }) };
        };
        let attempt = execute();
        let response = await attempt.promise;
        let errorBody = response.ok ? '' : await response.text();
        if (isInvalidCsrfResponse(response, errorBody) && options.retryCsrf !== false) {
            try {
                if (!csrfTokenOverride || csrfTokenOverride === attempt.token) await refreshCsrfToken();
            } catch (refreshError) {
                const error = new Error(errorBody + '\nCSRF token 自动刷新失败：' + (refreshError.message || refreshError));
                error.status = response.status;
                throw error;
            }
            attempt = execute();
            response = await attempt.promise;
            errorBody = response.ok ? '' : await response.text();
        }
        if (!response.ok) {
            const error = new Error(errorBody || `${response.status} ${response.statusText}`);
            error.status = response.status;
            throw error;
        }
        if (response.status === 204) return {};
        const body = await response.text();
        if (!body.trim()) return {};
        try { return JSON.parse(body); } catch (error) { return body; }
    }

    async function withButtonBusy($button, label, action) {
        const original = $button?.html?.();
        if ($button?.length) $button.prop("disabled", true).html("<i class=\"fa-solid fa-spinner fa-spin\"></i> " + escapeHtml(label));
        try { return await action(); }
        finally { if ($button?.length && $button.closest("body").length) $button.prop("disabled", false).html(original); }
    }

    function isTransientDetectionError(error) {
        if (!error || error.name === "AbortError") return false;
        if ([408, 425, 429, 500, 502, 503, 504].includes(Number(error.status))) return true;
        const message = String(error.message || error).toLowerCase();
        return /network|fetch|timeout|timed out|econn|socket|connection|remote_unavailable|git_check_failed|无法获取远端|网络|远端.*失败|github/.test(message);
    }

    function waitForDetectionRetry(delay, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(new DOMException("检测已取消", "AbortError"));
            const timer = window.setTimeout(() => { cleanup(); resolve(); }, delay);
            const abort = () => { window.clearTimeout(timer); cleanup(); reject(new DOMException("检测已取消", "AbortError")); };
            const cleanup = () => signal?.removeEventListener("abort", abort);
            signal?.addEventListener("abort", abort, { once: true });
        });
    }

    async function optimizedDetectionRequest(action, signal, onRetry) {
        const delays = state.settings.networkOptimization ? NETWORK_RETRY_DELAYS : [];
        for (let attempt = 0; ; attempt++) {
            try { return await action(); }
            catch (error) {
                if (attempt >= delays.length || !isTransientDetectionError(error)) throw error;
                if (typeof onRetry === "function") onRetry(attempt + 1, delays.length, error);
                await waitForDetectionRetry(delays[attempt], signal);
            }
        }
    }

    async function mapDetectionTargets(targets, worker) {
        const items = Array.from(targets || []);
        if (!items.length) return [];
        const concurrencyLimit = state.settings.networkOptimization ? NETWORK_DETECTION_CONCURRENCY : STANDARD_DETECTION_CONCURRENCY;
        const concurrency = Math.min(concurrencyLimit, items.length);
        const results = new Array(items.length);
        let cursor = 0;
        await Promise.all(Array.from({ length: concurrency }, async () => {
            while (cursor < items.length && !state.detectionCancelled) {
                const index = cursor++;
                results[index] = await worker(items[index], index);
            }
        }));
        return results;
    }
    async function withBatchAction(actionState, action, render, task) {
        actionState.batchAction = action;
        render();
        try { return await task(); }
        finally { actionState.batchAction = ""; render(); }
    }


    function getExtensionApi() {
        if (!extensionApiPromise) extensionApiPromise = import('/scripts/extensions.js');
        return extensionApiPromise;
    }

    const groupOf = extension => typeOf(extension) === 'system' ? '内置' : (String(extension?.category || '').trim() || '未分组');

    async function setExtensionEnabled(extension, enabled, reload = false) {
        const api = await getExtensionApi();
        const action = enabled ? api.enableExtension : api.disableExtension;
        if (typeof action !== "function") throw new Error("当前酒馆版本不支持扩展启停接口");
        const found = api.findExtension?.(displayPath(extension)) || api.findExtension?.(folderOf(extension));
        const internalName = found?.name || displayPath(extension);
        await action(internalName, reload);
        const current = api.findExtension?.(internalName) || api.findExtension?.(folderOf(extension));
        if (!current) throw new Error("酒馆未能重新读取扩展启停状态");
        extension.enabled = current.enabled === true;
        if (extension.enabled !== enabled) throw new Error("酒馆返回的扩展状态与操作不一致");
        return current;
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

    function readLocalFrontendMeta() {
        try {
            return normalizeMeta(JSON.parse(window.localStorage.getItem(FRONTEND_META_STORAGE_KEY) || '{}'));
        } catch (error) {
            return {};
        }
    }

    function writeLocalFrontendMeta(meta, required = false) {
        const normalized = normalizeMeta(meta);
        try {
            window.localStorage.setItem(FRONTEND_META_STORAGE_KEY, JSON.stringify(normalized));
        } catch (error) {
            if (required) throw new Error(`浏览器本地存储不可用：${error.message || error}`);
        }
        return normalized;
    }

    function normalizeGitProxy(value, strict = false) {
        const candidate = String(value || "").trim();
        if (!candidate) return "";
        try {
            const parsed = new URL(candidate);
            if (!["http:", "https:", "socks5:", "socks5h:"].includes(parsed.protocol)) throw new Error("仅支持 HTTP、HTTPS、SOCKS5 代理");
            if (!parsed.hostname) throw new Error("代理地址缺少主机名");
            if (parsed.username || parsed.password) throw new Error("请勿在代理地址中保存用户名或密码");
            if (candidate.length > 300) throw new Error("代理地址过长");
            return candidate.replace(/\/$/, "");
        } catch (error) {
            if (strict) throw error;
            return "";
        }
    }

    function readLocalSettings() {
        try {
            const value = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (error) { return {}; }
    }

    function normalizeSettings(value) {
        const source = value && typeof value === "object" ? value : {};
        const parsed = Number.parseInt(source.floatingBallSize, 10);
        const floatingBallSize = Number.isFinite(parsed)
            ? Math.min(FLOATING_BALL_MAX, Math.max(FLOATING_BALL_MIN, parsed))
            : FLOATING_BALL_DEFAULT;
        return { floatingBallSize, privacyMasking: source.privacyMasking === true, networkOptimization: source.networkOptimization !== false, enabledFirst: source.enabledFirst === true, gitProxy: normalizeGitProxy(source.gitProxy) };
    }

    function writeLocalSettings(settings) {
        const normalized = normalizeSettings(settings);
        try { window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized)); } catch (error) {}
        return normalized;
    }

    function normalizeWhitelist(value) {
        const source = value && typeof value === 'object' ? value : {};
        const normalizeList = (items, pattern) => Array.from(new Set((Array.isArray(items) ? items : [])
            .map(item => String(item || '').trim())
            .filter(item => pattern.test(item))));
        return {
            frontend: normalizeList(source.frontend, /^[^/\\\0]{1,180}$/),
            backend: normalizeList(source.backend, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
        };
    }

    const isFrontendWhitelisted = extensionOrFolder => state.whitelist.frontend.includes(typeof extensionOrFolder === 'string' ? extensionOrFolder : folderOf(extensionOrFolder));
    const isBackendWhitelisted = pluginOrId => state.whitelist.backend.includes(typeof pluginOrId === 'string' ? pluginOrId : String(pluginOrId?.id || ''));
    const getFloatingBar = () => $(`#${FLOAT_ID}`);

    function applyFloatingBallSize($popup) {
        const size = normalizeSettings(state.settings).floatingBallSize;
        state.settings.floatingBallSize = size;
        $popup.css('--em-float-size', `${size}px`);
        getFloatingBar().css('--em-float-size', `${size}px`);
        $popup.find('.em-float-size').val(size);
        $popup.find('.em-float-size-value').text(`${size}px`);
    }

    function applyPrivacyMasking($popup) {
        $popup.toggleClass('em-privacy-enabled', state.settings.privacyMasking === true);
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
        state.backend = { available: false, error: '', version: '', supportsBackendMeta: false, supportsWhitelist: false, supportsNetworkOptimization: false };
        try {
            const status = await request(`${BACKEND_BASE}/status`, { method: 'GET' });
            const response = await request(`${BACKEND_BASE}/data`, { method: 'GET' });
            const data = response && response.data && typeof response.data === 'object' ? response.data : {};
            state.meta = normalizeMeta(data.extensions);
            writeLocalFrontendMeta(state.meta);
            state.backendMeta = normalizeMeta(data.backendPlugins);
            state.whitelist = normalizeWhitelist(data.whitelist);
            state.settings = writeLocalSettings(normalizeSettings({ ...readLocalSettings(), ...(data.settings || {}) }));
            state.backend = { available: true, error: '', version: String(status?.version || ''), supportsBackendMeta: Object.prototype.hasOwnProperty.call(data, 'backendPlugins'), supportsWhitelist: Number(status?.schemaVersion || 0) >= 4 && Object.prototype.hasOwnProperty.call(data, 'whitelist'), supportsNetworkOptimization: Number(status?.schemaVersion || 0) >= 5 };
        } catch (error) {
            state.meta = readLocalFrontendMeta();
            state.backendMeta = {};
            state.whitelist = normalizeWhitelist(state.whitelist);
            state.settings = writeLocalSettings(normalizeSettings({ ...state.settings, ...readLocalSettings() }));
            state.backend = { available: false, error: error.message || String(error), version: '', supportsBackendMeta: false, supportsWhitelist: false, supportsNetworkOptimization: false };
        }
    }

    async function saveServerMeta(meta, settings = state.settings, backendMeta = state.backendMeta, whitelist = state.whitelist) {
        if (!state.backend.available) throw new Error('服务端存储未连接，请先安装并启用后端插件');
        const payload = { extensions: normalizeMeta(meta), backendPlugins: normalizeMeta(backendMeta), whitelist: normalizeWhitelist(whitelist), settings: normalizeSettings(settings) };
        const response = await request(`${BACKEND_BASE}/data`, { method: 'PUT', body: JSON.stringify(payload) });
        const data = response && response.data && typeof response.data === 'object' ? response.data : {};
        state.meta = normalizeMeta(data.extensions);
        state.backendMeta = normalizeMeta(data.backendPlugins || payload.backendPlugins);
        state.whitelist = normalizeWhitelist(data.whitelist || payload.whitelist);
        state.settings = writeLocalSettings(normalizeSettings({ ...payload.settings, ...(data.settings || {}) }));
        return state.meta;
    }

    async function saveFrontendMeta(meta) {
        const normalized = normalizeMeta(meta);
        if (state.backend.available) {
            await saveServerMeta(normalized);
            writeLocalFrontendMeta(state.meta);
        } else {
            state.meta = writeLocalFrontendMeta(normalized, true);
        }
        return state.meta;
    }

    async function saveBackendMeta(meta) {
        if (!state.backend.supportsBackendMeta) throw new Error('管理后端版本过旧，请先更新并手动重启 SillyTavern');
        await saveServerMeta(state.meta, state.settings, meta);
        return state.backendMeta;
    }

    async function saveWhitelist(whitelist) {
        if (!state.backend.supportsWhitelist) throw new Error('管理后端版本过旧，请先更新并手动重启 SillyTavern');
        await saveServerMeta(state.meta, state.settings, state.backendMeta, whitelist);
        return state.whitelist;
    }

    async function saveServerSettings(settings) {
        state.settings = writeLocalSettings(normalizeSettings({ ...state.settings, ...(settings || {}) }));
        if (state.backend.available) await saveServerMeta(state.meta, state.settings);
        return state.settings;
    }

    async function fetchManifest(extension, options = {}) {
        const path = displayPath(extension);
        const folder = folderOf(extension);
        const fresh = options.fresh === true;
        const candidates = Array.from(new Set([
            `/scripts/extensions/${path}/manifest.json`,
            `/scripts/extensions/${folder}/manifest.json`,
            `/scripts/extensions/third-party/${folder}/manifest.json`,
        ]));
        for (const url of candidates) {
            try {
                const response = await fetch(fresh ? `${url}?em=${Date.now()}` : url, { cache: fresh ? 'no-store' : 'default' });
                if (response.ok) return await response.json();
            } catch (error) { /* Try the next native path. */ }
        }
        return {};
    }

    function loadedManifest(extensionApi, extension) {
        if (typeof extensionApi?.getExtensionManifest !== 'function') return null;
        try {
            const manifest = extensionApi.getExtensionManifest(displayPath(extension)) || extensionApi.getExtensionManifest(folderOf(extension));
            return manifest && typeof manifest === 'object' ? manifest : null;
        } catch (error) {
            return null;
        }
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

    function applyFrontendMetadata(extension, meta = state.meta) {
        const folder = folderOf(extension);
        const serverMeta = meta[folder] && typeof meta[folder] === 'object' ? meta[folder] : {};
        extension.zhName = serverMeta.name || chineseValue(extension.manifest, ['display_name_zh', 'displayNameZh', 'zh_name', 'name_zh']) || String(extension.manifest.display_name_zh || '').trim();
        extension.note = serverMeta.note || chineseValue(extension.manifest, ['description_zh', 'descriptionZh', 'zh_description', 'note_zh', 'remarks_zh']);
        extension.category = serverMeta.category || '';
        extension.displayName = extension.zhName || extension.manifest.display_name || folder || extension.name;
        extension.description = extension.note || extension.manifest.description || '暂无备注';
        extension.version = extension.manifest.version || '';
        return extension;
    }

    async function discover(options = {}) {
        const entries = await request('/api/extensions/discover', { method: 'GET' });
        const list = Array.isArray(entries) ? entries : [];
        const meta = state.meta;
        const freshManifests = options.freshManifests === true;
        let extensionApi = null;
        try { extensionApi = await getExtensionApi(); } catch (error) {}
        const enriched = await Promise.all(list.map(async entry => {
            const extension = typeof entry === 'string' ? { name: entry } : { ...(entry || {}) };
            extension.name = String(extension.name || extension.folderName || extension.id || '').trim();
            extension.manifest = (!freshManifests && loadedManifest(extensionApi, extension)) || await fetchManifest(extension, { fresh: freshManifests });
            applyFrontendMetadata(extension, meta);
            extension.enabled = extensionApi?.findExtension?.(extension.name)?.enabled ?? true;
            return extension;
        }));
        state.extensions = enriched.filter(item => item.name);
        return state.extensions;
    }

    async function getVersion(extension, signal) {
        return optimizedDetectionRequest(() => request("/api/extensions/version", {
            method: "POST", signal,
            body: JSON.stringify({ extensionName: folderOf(extension), global: isGlobal(extension) }),
        }), signal);
    }

    function repoUrl(extension) {
        const update = state.updates.get(folderOf(extension));
        const candidate = update?.remoteUrl || extension.manifest.homePage || extension.manifest.homepage || extension.manifest.repository;
        if (typeof candidate === 'string') return candidate;
        if (candidate && typeof candidate.url === 'string') return candidate.url;
        return '';
    }

    function githubAuthorFromRepository(value) {
        const candidate = typeof value === 'string' ? value : (value && typeof value.url === 'string' ? value.url : '');
        const repository = String(candidate || '').trim().replace(/^git\+/, '');
        const match = repository.match(/^(?:https?:\/\/(?:[^/@]+@)?|git:\/\/|ssh:\/\/(?:git@)?)github\.com[/:]([A-Za-z0-9-]+)\//i)
            || repository.match(/^git@github\.com:([A-Za-z0-9-]+)\//i)
            || repository.match(/^github:([A-Za-z0-9-]+)\//i);
        return match ? match[1] : '';
    }

    async function checkOne(extension, signal, options = {}) {
        const folder = folderOf(extension);
        if (!isExternal(extension)) return { ignored: true, builtin: true };
        if (isFrontendWhitelisted(folder) && !options.allowWhitelisted) return { ignored: true };
        state.checkingExtensions.add(folder);
        try {
            const data = await getVersion(extension, signal);
            state.updates.set(folder, data || {});
            return data || {};
        } catch (error) {
            if (error?.name === "AbortError" || state.detectionCancelled) return { cancelled: true };
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

    function renderDetectionControls($popup) {
        const active = Number($popup.data('em-active-detections') || 0) > 0;
        $popup.find('.em-cancel-detection').prop('hidden', !active).prop('disabled', !active).html('<i class="fa-solid fa-ban"></i><span>取消检测</span>');
    }

    function beginDetection($popup) {
        if (!state.detectionActive) {
            state.detectionActive = true;
            state.detectionCancelled = false;
            state.detectionMessage = '';
        }
        $popup.data('em-active-detections', Number($popup.data('em-active-detections') || 0) + 1);
        renderFloatingButton($popup);
        renderDetectionControls($popup);
    }

    function finishDetection($popup) {
        const remaining = Math.max(0, Number($popup.data('em-active-detections') || 0) - 1);
        $popup.data('em-active-detections', remaining);
        if (remaining === 0) state.detectionActive = false;
        renderFloatingButton($popup);
        renderDetectionControls($popup);
        if (remaining === 0 && state.minimized && $popup.is(':visible') && window.toastr) toastr.info(state.detectionCancelled ? '更新检测已取消' : '更新检测已完成');
    }

    function cancelDetection($popup) {
        if (!state.detectionActive) return;
        state.detectionCancelled = true;
        state.detectionMessage = '检测已取消，正在完成当前请求，未开始的插件已跳过';
        if (backendUpdateState.phase === 'checking') backendUpdateState.message = state.detectionMessage;
        if (selfUpdateState.phase === 'checking') selfUpdateState.message = state.detectionMessage;
        if (backendSelfUpdateState.phase === 'checking') backendSelfUpdateState.message = state.detectionMessage;
        $popup.find('.em-cancel-detection').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i><span>正在停止</span>');
        renderList($popup);
        renderBackendUpdate($popup);
        renderSelfUpdate($popup);
        renderBackendSelfUpdate($popup);
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
        const targets = state.extensions.filter(extension => isExternal(extension) && !isFrontendWhitelisted(extension));
        try {
            state.frontendCheckProgress = { completed: 0, total: targets.length };
            const checks = mapDetectionTargets(targets, async extension => {
                const result = await checkOne(extension);
                state.frontendCheckProgress.completed += 1;
                renderList($popup);
                return result;
            });
            renderList($popup);
            await checks;
            const availableExtensions = state.extensions.filter(extension => isExternal(extension) && !isFrontendWhitelisted(extension) && state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
            const message = availableExtensions.length ? `发现 ${availableExtensions.length} 个扩展可快速更新` : "其他扩展均为最新版本";
            if (!state.detectionCancelled && !state.minimized && window.toastr) toastr.info(message);
        } finally {
            state.checking = false;
            if (!state.detectionCancelled) state.frontendCheckProgress = { completed: state.frontendCheckProgress.total, total: state.frontendCheckProgress.total };
            renderList($popup);
            renderBatchSelection($popup);
            const showResults = !state.detectionCancelled;
            state.statusSortActive = true;
            finishDetection($popup);
            if (showResults) openDetectionResults('frontend', targets.map(folderOf), $popup, { returnPanel: 'installed', title: '前端扩展检测结果' });
        }
    }

    function failedFrontendExtensions() {
        return state.extensions.filter(extension => isExternal(extension) && !isFrontendWhitelisted(extension) && Boolean(state.updates.get(folderOf(extension))?.error));
    }

    async function retryFailedFrontend($popup) {
        if (state.checking || state.batchUpdating || state.batchToggling) return;
        const targets = failedFrontendExtensions();
        if (!targets.length) {
            if (window.toastr) toastr.info("当前没有检测失败的前端扩展");
            return;
        }
        state.checking = true;
        state.frontendCheckProgress = { completed: 0, total: targets.length };
        beginDetection($popup);
        try {
            await mapDetectionTargets(targets, async extension => {
                const result = await checkOne(extension);
                state.frontendCheckProgress.completed += 1;
                renderList($popup);
                return result;
            });
            const failed = failedFrontendExtensions().length;
            if (!state.detectionCancelled && window.toastr) toastr.info(failed ? `重试完成，仍有 ${failed} 个前端扩展检测失败` : "检测失败项已全部重试成功");
        } finally {
            state.checking = false;
            if (!state.detectionCancelled) state.frontendCheckProgress = { completed: state.frontendCheckProgress.total, total: state.frontendCheckProgress.total };
            renderList($popup);
            const showResults = !state.detectionCancelled;
            state.statusSortActive = true;
            finishDetection($popup);
            if (showResults) openDetectionResults('frontend', targets.map(folderOf), $popup, { returnPanel: 'installed', title: '前端失败项重试结果' });
        }
    }

    async function checkFrontendGroup(group, $popup, options = {}) {
        if (state.checking || state.batchUpdating || state.batchToggling) return;
        const targets = state.extensions.filter(extension => isExternal(extension) && groupOf(extension) === group && (options.allowWhitelisted || !isFrontendWhitelisted(extension)));
        if (!targets.length) { if (window.toastr) toastr.info("此分组没有可检测的前端扩展"); return; }
        const actionState = options.whitelistView ? whitelistState : state;
        actionState.groupAction = { group, phase: 'checking' };
        state.checking = true;
        state.frontendCheckProgress = { completed: 0, total: targets.length };
        beginDetection($popup);
        renderList($popup);
        if (options.whitelistView) renderWhitelistPanel($popup);
        try {
            for (const extension of targets) {
                if (state.detectionCancelled) break;
                await checkOne(extension, undefined, { allowWhitelisted: options.allowWhitelisted === true });
                state.frontendCheckProgress.completed += 1;
                renderList($popup);
                if (options.whitelistView) renderWhitelistPanel($popup);
            }
        } finally {
            state.checking = false;
            actionState.groupAction = { group: '', phase: '' };
            if (!state.detectionCancelled) state.frontendCheckProgress = { completed: targets.length, total: targets.length };
            renderList($popup);
            if (options.whitelistView) renderWhitelistPanel($popup);
            const showResults = !state.detectionCancelled;
            state.statusSortActive = true;
            if (options.whitelistView) whitelistState.statusSortActive = true;
            finishDetection($popup);
            if (showResults) openDetectionResults('frontend', targets.map(folderOf), $popup, { allowWhitelisted: options.allowWhitelisted === true, returnPanel: options.whitelistView ? 'whitelist' : 'installed', title: '分组检测结果：' + group });
        }
    }

    async function updateFrontendGroup(group, $popup, options = {}) {
        if (state.batchUpdating || state.batchToggling || state.checking) return;
        const candidates = state.extensions.filter(extension => isExternal(extension) && groupOf(extension) === group && (options.allowWhitelisted || !isFrontendWhitelisted(extension)));
        const undetected = candidates.filter(extension => !state.updates.has(folderOf(extension)));
        if (undetected.length) {
            if (window.toastr) toastr.warning('此分组还有 ' + undetected.length + ' 个扩展未检测，请先检测分组');
            return;
        }
        const targets = candidates.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) {
            if (window.toastr) toastr.info('检测完成，此分组暂无可更新扩展');
            return;
        }
        const actionState = options.whitelistView ? whitelistState : state;
        actionState.groupAction = { group, phase: 'updating' };
        state.batchUpdating = true;
        renderList($popup);
        if (options.whitelistView) renderWhitelistPanel($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                const extension = targets[index];
                const message = '正在更新分组 ' + (index + 1) + ' / ' + targets.length + '：' + extension.displayName;
                $popup.find('.em-frontend-update-status, .em-whitelist-update-status').text(message);
                if (await updateOne(extension, $popup, { quiet: true, deferRender: true, deferSelectionRender: true, allowWhitelisted: options.allowWhitelisted === true })) completed += 1;
                renderList($popup);
                if (options.whitelistView) renderWhitelistPanel($popup);
            }
            if (window.toastr) toastr.success('分组更新完成：' + completed + ' / ' + targets.length + '，已依次热加载');
        } finally {
            state.batchUpdating = false;
            actionState.groupAction = { group: '', phase: '' };
            renderList($popup);
            if (options.whitelistView) renderWhitelistPanel($popup);
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
        const selfBusy = ["checking", "updating"].includes(selfUpdateState.phase);
        $popup.find(".em-check-self").prop("disabled", selfBusy).html(selfUpdateState.phase === "checking" ? `<i class="fa-solid fa-spinner fa-spin"></i> 检测中` : `<i class="fa-solid fa-arrows-rotate"></i> 检测`);
        $popup.find(".em-update-self").prop("hidden", !selfUpdateState.canUpdate).prop("disabled", selfUpdateState.phase === "updating").html(selfUpdateState.phase === "updating" ? `<i class="fa-solid fa-spinner fa-spin"></i> 更新中` : `<i class="fa-solid fa-cloud-arrow-down"></i> 更新`);
    }

    async function checkSelfUpdate($popup, signal) {
        if (isFrontendWhitelisted(getInstalledExtensionName())) {
            selfUpdateState.canUpdate = false;
            selfUpdateState.phase = 'ignored';
            selfUpdateState.message = '本体已加入白名单，跳过更新检测';
            renderSelfUpdate($popup);
            return selfUpdateState;
        }
        if (selfUpdateState.phase === 'checking' || selfUpdateState.phase === 'updating') return selfUpdateState;
        selfUpdateState.phase = 'checking';
        selfUpdateState.message = '正在检查本体更新';
        beginDetection($popup);
        const activeSignal = signal;
        renderSelfUpdate($popup);
        try {
            const result = await requestSelfExtensionApi('version', { signal: activeSignal });
            selfUpdateState.extensionName = result.extensionName;
            selfUpdateState.global = result.global;
            selfUpdateState.latestVersion = await getLatestSelfVersion(activeSignal);
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
                githubAuthor: String(item?.githubAuthor || githubAuthorFromRepository(item?.remoteUrl) || ''),
                nativeDescription,
                description: String(meta.note || nativeDescription),
                note: String(meta.note || ''),
                category: String(meta.category || ''),
                currentBranchName: String(item?.currentBranchName || ''),
                currentCommitHash: String(item?.currentCommitHash || ''),
                currentCommitAt: String(item?.currentCommitAt || ''),
                installedAt: String(item?.installedAt || ''),
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

    const isManagerBackendPlugin = plugin => plugin?.isManager === true || String(plugin?.id || '') === 'extension-manager';
    const managerBackendPlugin = () => backendUpdateState.plugins.find(isManagerBackendPlugin) || null;
    const regularBackendPlugins = () => backendUpdateState.plugins.filter(plugin => !isManagerBackendPlugin(plugin));

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

    function sortTimestamp(value) {
        if (value === undefined || value === null || value === "") return 0;
        const parsed = Date.parse(String(value));
        if (Number.isFinite(parsed)) return parsed;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function enabledSortRank(extension) {
        return state.settings.enabledFirst ? (extension?.enabled ? 0 : 1) : 0;
    }

    function extensionUpdatedTimestamp(extension) {
        const update = state.updates.get(folderOf(extension)) || {};
        return Math.max(
            sortTimestamp(extension?.updatedAt),
            sortTimestamp(extension?.lastUpdated),
            sortTimestamp(extension?.installTimestamp),
            sortTimestamp(extension?.installedAt),
            sortTimestamp(extension?.manifest?.updatedAt),
            sortTimestamp(extension?.manifest?.createdAt),
            sortTimestamp(update?.updatedAt),
            sortTimestamp(update?.currentCommitAt),
        );
    }

    function compareFrontendExtensions(a, b, sort = state.sort, statusSort = state.statusSortActive) {
        const nameCompare = () => a.displayName.localeCompare(b.displayName, "zh-Hans", { numeric: true }) || folderOf(a).localeCompare(folderOf(b));
        const enabledCompare = enabledSortRank(a) - enabledSortRank(b);
        if (statusSort || sort === "status") return frontendStatusRank(a) - frontendStatusRank(b) || enabledCompare || nameCompare();
        if (sort === "enabled") return enabledCompare || nameCompare();
        if (sort === "updated") return extensionUpdatedTimestamp(b) - extensionUpdatedTimestamp(a) || enabledCompare || nameCompare();
        if (sort === "type") return typeOf(a).localeCompare(typeOf(b)) || enabledCompare || nameCompare();
        return enabledCompare || nameCompare();
    }

    function backendUpdatedTimestamp(plugin) {
        return Math.max(sortTimestamp(plugin?.currentCommitAt), sortTimestamp(plugin?.updatedAt), sortTimestamp(plugin?.installedAt));
    }

    function compareBackendPlugins(a, b, sort = backendUpdateState.sort, statusSort = backendUpdateState.statusSortActive) {
        const nameCompare = () => a.name.localeCompare(b.name, "zh-Hans", { numeric: true }) || a.id.localeCompare(b.id);
        if (statusSort || sort === "status") return backendStatusRank(a) - backendStatusRank(b) || nameCompare();
        if (sort === "updated") return backendUpdatedTimestamp(b) - backendUpdatedTimestamp(a) || nameCompare();
        return nameCompare();
    }

    function backendStatusRank(plugin) {
        if (plugin?.error) return 0;
        if (backendUpdateState.checkedPlugins.has(plugin.id) && plugin.isUpToDate === false) return 1;
        if (backendUpdateState.checkedPlugins.has(plugin.id)) return 2;
        return 3;
    }

    function filteredBackendPlugins() {
        const filter = backendUpdateState.filter.toLowerCase();
        return regularBackendPlugins().filter(plugin => {
            const group = backendGroupOf(plugin);
            const matchesCategory = !backendUpdateState.category || group === backendUpdateState.category;
            const matchesText = !filter || [plugin.name, plugin.nativeName, plugin.id, plugin.githubAuthor, plugin.description, group].join(' ').toLowerCase().includes(filter);
            return matchesCategory && matchesText;
        }).sort((a, b) => compareBackendPlugins(a, b));
    }

    function renderBackendCategoryOptions($popup) {
        const categories = Array.from(new Set(regularBackendPlugins().map(backendGroupOf))).sort((a, b) => {
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
        const candidates = regularBackendPlugins()
            .filter(plugin => backendGroupOf(plugin) !== group)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'));
        const choices = candidates.length
            ? candidates.map(plugin => '<label class="em-group-choice em-backend-group-choice"><input type="checkbox" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (backendUpdateState.groupPickerSelections.has(plugin.id) ? ' checked' : '') + '><span><strong>' + escapeHtml(plugin.name) + '</strong><small>' + escapeHtml(backendGroupOf(plugin)) + '</small></span></label>').join('')
            : '<div class="em-group-picker-empty">没有可添加的后端插件</div>';
        return '<div class="em-group-picker" data-backend-group-picker="' + escapeHtml(group) + '"><div class="em-group-picker-list">' + choices + '</div><div class="em-group-picker-actions"><button type="button" class="em-action em-backend-group-cancel"><i class="fa-solid fa-xmark"></i> 取消</button><button type="button" class="em-action primary em-backend-group-add-save" data-group="' + escapeHtml(group) + '"' + (candidates.length ? '' : ' disabled') + '><i class="fa-solid fa-folder-plus"></i> 添加选中</button></div></div>';
    }

    function renderBackendPluginCard(plugin, options = {}) {
        const whitelistView = options?.whitelistView === true;
        const resultView = options?.resultView === true;
        const checked = backendUpdateState.checkedPlugins.has(plugin.id);
        const checking = backendUpdateState.checkingPlugins.has(plugin.id);
        const selected = backendUpdateState.selectedPlugins.has(plugin.id);
        const whitelisted = isBackendWhitelisted(plugin);
        const ignored = whitelisted && !whitelistView && !resultView;
        const available = !ignored && checked && plugin.updateSupported === true && plugin.isUpToDate === false;
        const status = ignored
            ? '已忽略'
            : plugin.updating
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
        const statusClass = plugin.error ? 'error' : (available ? 'update' : (ignored ? 'ignored' : ''));
        const commit = plugin.shortCommitHash || plugin.currentCommitHash.slice(0, 8);
        const details = [
            '<span class="em-private">' + escapeHtml(plugin.id) + '</span>',
            'GitHub作者：<span class="em-private">' + escapeHtml(plugin.githubAuthor ? '@' + plugin.githubAuthor : '未知') + '</span>',
            '版本：' + escapeHtml(plugin.version ? 'v' + plugin.version : '未知'),
            '提交：<span class="em-private">' + escapeHtml(commit || '检测后显示') + '</span>',
            plugin.currentBranchName ? '分支：' + escapeHtml(plugin.currentBranchName) : '',
        ].filter(Boolean).join(' · ');
        const whitelistSelected = whitelistState.selected.has(plugin.id);
        const resultSelected = detectionResults.selected.has(plugin.id);
        const cardSelected = resultView ? resultSelected : (whitelistView ? whitelistSelected : selected);
        const uninstallProtected = plugin.isManager || plugin.id === "extension-manager";
        const leading = resultView && detectionResults.selectionMode && !uninstallProtected
            ? '<label class="em-card-choice' + (resultSelected ? ' is-selected' : '') + '" title="选择 ' + escapeHtml(plugin.name) + '"><input class="em-result-card-choice" type="checkbox" data-result-id="' + escapeHtml(plugin.id) + '"' + (resultSelected ? ' checked' : '') + '><i class="fa-solid fa-check"></i></label>'
            : whitelistView && whitelistState.selectionMode && !uninstallProtected
            ? '<label class="em-card-choice' + (whitelistSelected ? ' is-selected' : '') + '" title="选择 ' + escapeHtml(plugin.name) + '"><input class="em-whitelist-card-choice" type="checkbox" data-whitelist-id="' + escapeHtml(plugin.id) + '"' + (whitelistSelected ? ' checked' : '') + '><i class="fa-solid fa-check"></i></label>'
            : backendUpdateState.selectionMode && !whitelistView && !uninstallProtected
                ? '<label class="em-card-choice' + (selected ? ' is-selected' : '') + '" title="选择 ' + escapeHtml(plugin.name) + '"><input type="checkbox" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (selected ? ' checked' : '') + '><i class="fa-solid fa-check"></i></label>'
            : '<div class="em-card-icon"><i class="fa-solid fa-server"></i></div>';
        const note = plugin.description || '暂无备注';
        const backendUninstallAction = (uninstallProtected ? `<button type="button" class="em-action muted" disabled title="扩展管理器后端不允许删除，以免出现不可逆错误"><i class="fa-solid fa-lock"></i> 管理后端不可删除</button>` : `<button type="button" class="em-action em-uninstall-backend" data-plugin-id="${escapeHtml(plugin.id)}" ${plugin.updating ? "disabled" : ""}><i class="fa-solid ${plugin.updating ? "fa-spinner fa-spin" : "fa-trash"}"></i> ${plugin.updating ? "处理中" : "卸载"}</button>`);
        return '<article class="em-card em-backend-card' + (available ? ' is-update' : '') + (plugin.error ? ' is-error' : '') + (ignored ? ' is-ignored' : '') + (cardSelected ? ' is-selected' : '') + '" data-plugin-id="' + escapeHtml(plugin.id) + '">' +
            leading +
            '<div class="em-card-body">' +
                '<div class="em-card-head"><div class="em-card-title">' + escapeHtml(plugin.name) + (plugin.isManager ? ' <span class="em-type">管理后端</span>' : '') + (backendGroupOf(plugin) !== '未分组' ? ' <span class="em-category">' + escapeHtml(backendGroupOf(plugin)) + '</span>' : '') + '</div><span class="em-status ' + statusClass + '">' + escapeHtml(status) + '</span></div>' +
                '<div class="em-card-sub">' + (details || '<span class="em-private">' + escapeHtml(plugin.id) + '</span>') + '</div>' +
                '<div class="em-card-note">' + escapeHtml(note) + '</div>' +
                '<div class="em-card-actions">' +
                    (resultView ? '' : (whitelistView ? '' : (state.backend.supportsBackendMeta ? '<button type="button" class="em-action em-backend-edit" data-plugin-id="' + escapeHtml(plugin.id) + '"><i class="fa-solid fa-tags"></i> 中文资料与分组</button>' : ''))) +
                    (resultView ? '<button type="button" class="em-action em-result-check-one" data-result-id="' + escapeHtml(plugin.id) + '"' + (checking || plugin.updating ? ' disabled' : '') + '><i class="fa-solid ' + (checking ? 'fa-spinner fa-spin' : 'fa-magnifying-glass') + '"></i> ' + (checking ? '检测中' : '检测') + '</button>' : (whitelistView ? '<button type="button" class="em-action em-whitelist-check-backend" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (checking || plugin.updating || backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase) ? ' disabled' : '') + '><i class="fa-solid ' + (checking ? 'fa-spinner fa-spin' : 'fa-magnifying-glass') + '"></i> ' + (checking ? '检测中' : '检测') + '</button>' : (whitelisted ? '<span class="em-action muted"><i class="fa-solid fa-shield-halved"></i> 白名单</span>' : '<button type="button" class="em-action em-check-backend-plugin" data-plugin-id="' + escapeHtml(plugin.id) + '"' + (checking || plugin.updating || backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase) ? ' disabled' : '') + '><i class="fa-solid ' + (checking ? 'fa-spinner fa-spin' : 'fa-magnifying-glass') + '"></i> ' + (checking ? '检测中' : '检测') + '</button>'))) +
                    (available ? '<button type="button" class="em-action primary ' + (resultView ? 'em-result-update-one' : (whitelistView ? 'em-whitelist-update-backend' : 'em-update-backend-plugin')) + '" ' + (resultView ? 'data-result-id' : 'data-plugin-id') + '="' + escapeHtml(plugin.id) + '"' + (plugin.updating || backendUpdateState.batchUpdating ? ' disabled' : '') + '><i class="fa-solid ' + (plugin.updating ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down') + '"></i> ' + (plugin.updating ? '更新中' : '更新') + '</button>' : '') +
                    (!resultView && whitelistView ? '<button type="button" class="em-action em-whitelist-remove-one" data-scope="backend" data-whitelist-id="' + escapeHtml(plugin.id) + '"><i class="fa-solid fa-shield"></i> 移出白名单</button>' : '') +
                    backendUninstallAction +
                '</div>' +
                renderErrorDetails(plugin.error, 'backend', plugin.id) +
                '<div class="em-editor em-backend-editor" data-backend-editor="' + escapeHtml(plugin.id) + '" hidden><label>中文名<input class="em-backend-name-input" value="' + escapeHtml(backendMetadata(plugin.id).name || '') + '" maxlength="80"></label><label>分组<input class="em-backend-category-input" value="' + escapeHtml(plugin.category || '') + '" maxlength="80" placeholder="输入名称即可形成分组文件夹"></label><label>备注<textarea class="em-backend-note-input" maxlength="500">' + escapeHtml(plugin.note || '') + '</textarea></label><button type="button" class="em-save-meta primary em-backend-save-meta" data-plugin-id="' + escapeHtml(plugin.id) + '"><i class="fa-solid fa-floppy-disk"></i> 保存</button></div>' +
            '</div>' +
        '</article>';
    }

    function renderBackendGroup(group, plugins) {
        const expanded = Boolean(backendUpdateState.filter.trim()) || backendUpdateState.expandedGroups.has(group) || backendUpdateState.groupPicker === group;
        const custom = state.backend.supportsBackendMeta && group !== '未分组';
        const groupBusy = backendUpdateState.groupAction.group === group;
        const groupAvailable = plugins.some(plugin => !isBackendWhitelisted(plugin) && backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
        const groupWhitelistable = regularBackendPlugins().some(plugin => backendGroupOf(plugin) === group && !isBackendWhitelisted(plugin));
        const groupUpdate = groupAvailable || (groupBusy && backendUpdateState.groupAction.phase === 'updating') ? `<button type="button" class="em-icon em-backend-group-update" data-group="${escapeHtml(group)}" title="更新此分组" aria-label="更新后端分组 ${escapeHtml(group)}" ${['loading', 'checking', 'updating'].includes(backendUpdateState.phase) || backendUpdateState.batchUpdating ? 'disabled' : ''}><i class="fa-solid ${groupBusy && backendUpdateState.groupAction.phase === 'updating' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i></button>` : '';
        const groupCheck = `<button type="button" class="em-icon em-backend-group-check" data-group="${escapeHtml(group)}" title="检测此分组" aria-label="检测后端分组 ${escapeHtml(group)}" ${['loading', 'checking', 'updating'].includes(backendUpdateState.phase) ? 'disabled' : ''}><i class="fa-solid ${groupBusy && backendUpdateState.groupAction.phase === 'checking' ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}"></i></button>`;
        const groupWhitelist = state.backend.supportsWhitelist && groupWhitelistable ? `<button type="button" class="em-icon em-backend-group-whitelist" data-group="${escapeHtml(group)}" title="整组加入白名单" aria-label="将后端分组 ${escapeHtml(group)} 整组加入白名单" ${['loading', 'checking', 'updating'].includes(backendUpdateState.phase) || backendUpdateState.batchUpdating ? 'disabled' : ''}><i class="fa-solid fa-shield-halved"></i></button>` : '';
        const groupUninstall = `<button type="button" class="em-icon em-backend-group-uninstall" data-group="${escapeHtml(group)}" title="卸载此分组后端插件" aria-label="卸载后端分组"><i class="fa-solid fa-trash"></i></button>`;
        const actions = custom
            ? groupCheck + groupUpdate + groupWhitelist + `<div class="em-group-actions"><button type="button" class="em-icon em-backend-group-add" data-group="${escapeHtml(group)}" title="添加后端插件" aria-label="向 ${escapeHtml(group)} 添加后端插件"><i class="fa-solid fa-folder-plus"></i></button><button type="button" class="em-icon em-backend-group-rename" data-group="${escapeHtml(group)}" title="重命名分组" aria-label="重命名 ${escapeHtml(group)}"><i class="fa-solid fa-pen"></i></button><button type="button" class="em-icon em-backend-group-dissolve" data-group="${escapeHtml(group)}" title="解散分组" aria-label="解散后端分组 ${escapeHtml(group)}"><i class="fa-solid fa-folder-minus"></i></button></div>`
            : groupCheck + groupUpdate + groupWhitelist;
        const picker = backendUpdateState.groupPicker === group ? renderBackendGroupPicker(group) : '';
        const icon = expanded ? 'fa-folder-open' : 'fa-folder';
        return '<section class="em-group em-backend-group" data-backend-group="' + escapeHtml(group) + '"><header class="em-group-head"><button type="button" class="em-icon em-backend-group-toggle" data-group="' + escapeHtml(group) + '" title="' + (expanded ? '收起' : '展开') + '分组" aria-label="' + (expanded ? '收起 ' : '展开 ') + escapeHtml(group) + '" aria-expanded="' + expanded + '"><i class="fa-solid fa-chevron-' + (expanded ? 'down' : 'right') + '"></i></button><i class="fa-solid ' + icon + ' em-group-folder"></i><strong>' + escapeHtml(group) + '</strong><span class="em-group-count">' + plugins.length + '</span>' + groupUninstall + actions + '</header><div class="em-group-content"' + (expanded ? '' : ' hidden') + '><div class="em-group-cards">' + plugins.map(renderBackendPluginCard).join('') + '</div>' + picker + '</div></section>';
    }

    function renderBackendBatchSelection($popup) {
        const $toolbar = $popup.find('.em-backend-batch-toolbar');
        const $toggle = $popup.find('.em-backend-multi-toggle');
        if (!$toolbar.length) return;
        $toggle.toggleClass('active', backendUpdateState.selectionMode).attr('aria-pressed', String(backendUpdateState.selectionMode));
        $toggle.find('span').text(backendUpdateState.selectionMode ? '退出多选' : '多选');
        $toolbar.prop('hidden', !backendUpdateState.selectionMode);
        if (!backendUpdateState.selectionMode) return;

        const selected = regularBackendPlugins().filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id));
        const ignored = selected.filter(isBackendWhitelisted);
        const whitelistable = selected.filter(plugin => !isBackendWhitelisted(plugin));
        const active = whitelistable;
        const detected = active.filter(plugin => backendUpdateState.checkedPlugins.has(plugin.id));
        const available = active.filter(plugin => backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
        const undetected = active.length - detected.length;
        const customGroups = Array.from(new Set(regularBackendPlugins().map(backendGroupOf).filter(group => group !== '未分组'))).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
        const groupOptions = ['<option value="">未分组</option>'].concat(customGroups.map(group => '<option value="' + escapeHtml(group) + '">' + escapeHtml(group) + '</option>'), ['<option value="__new__">新建分组...</option>']).join('');
        const busy = backendUpdateState.batchUpdating || ['checking', 'updating', 'loading'].includes(backendUpdateState.phase) || ['checking', 'updating'].includes(backendSelfUpdateState.phase);
        const updateDisabled = busy || !available.length || undetected > 0;
        const status = selected.length
            ? '已选 ' + selected.length + ' 个 · 已检测 ' + detected.length + ' 个' + (available.length ? ' · 可更新 ' + available.length + ' 个' : '') + (undetected ? ' · 未检测 ' + undetected + ' 个' : '') + (ignored.length ? ' · 已忽略 ' + ignored.length + ' 个' : '')
            : '请选择后端插件';
        $toolbar.toggleClass('em-processing', busy);
        $toolbar.attr("data-action", backendUpdateState.batchAction || "");
        $toolbar.html('<div class="em-batch-summary"><strong>批量操作</strong><span>' + status + '</span></div><div class="em-batch-controls"><button type="button" class="em-action em-backend-select-visible"><i class="fa-solid fa-list-check"></i> 全选当前</button><button type="button" class="em-action em-backend-clear-selection"' + (selected.length ? '' : ' disabled') + '><i class="fa-solid fa-xmark"></i> 清空</button><select class="em-batch-group em-backend-batch-group" aria-label="目标分组">' + groupOptions + '</select><button type="button" class="em-action em-backend-batch-group-save"' + (selected.length && !busy && state.backend.supportsBackendMeta ? '' : ' disabled') + '><i class="fa-solid fa-folder-plus"></i> 分组</button><button type="button" class="em-action em-whitelist-backend-selected"' + (whitelistable.length && !busy && state.backend.supportsWhitelist ? '' : ' disabled') + '><i class="fa-solid fa-shield-halved"></i> 加入白名单</button><button type="button" class="em-action em-check-selected-backend"' + (active.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-magnifying-glass"></i> 检测选中</button><button type="button" class="em-action em-uninstall-selected-backend"' + (selected.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-trash"></i> 卸载选中</button><button type="button" class="em-action primary em-update-selected-backend"' + (updateDisabled ? ' disabled' : '') + ' title="' + (undetected ? '请先检测全部未忽略的选中插件' : (available.length ? '更新检测到的新版本' : '没有检测到可用更新')) + '"><i class="fa-solid fa-cloud-arrow-down"></i> 更新选中</button></div><div class="em-backend-batch-status"></div>');
    }

    function renderBackendPluginList($popup) {
        const $list = $popup.find('.em-backend-plugin-list');
        if (!$list.length) return;
        renderBackendCategoryOptions($popup);
        const list = filteredBackendPlugins();
        $popup.find(".em-check-backend").html(backendUpdateState.phase === "checking" ? `<i class="fa-solid fa-spinner fa-spin"></i> 检测中` : `<i class="fa-solid fa-magnifying-glass"></i> 检测全部`);
        $popup.find(".em-update-backend").html(backendUpdateState.phase === "updating" ? `<i class="fa-solid fa-spinner fa-spin"></i> 更新中` : `<i class="fa-solid fa-cloud-arrow-down"></i> 更新全部`);
        syncSearchInput($popup.find('.em-backend-search'), backendUpdateState.filter);
        $popup.find('.em-backend-search-clear').prop('hidden', !backendUpdateState.filter);
        $popup.find('.em-backend-sort').val(backendUpdateState.sort);
        const regularPlugins = regularBackendPlugins();
        $popup.find('.em-backend-count').text(list.length + ' / ' + regularPlugins.length);
        if (!regularPlugins.length) {
            const loading = ['loading', 'checking'].includes(backendUpdateState.phase);
            $list.html('<div class="em-backend-plugin-empty"><i class="fa-solid ' + (loading ? 'fa-spinner fa-spin' : 'fa-server') + '"></i><span>' + (loading ? '正在读取已安装后端插件' : '尚未检测到其他后端插件') + '</span></div>');
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
        backendUpdateState.canUpdate = regularBackendPlugins().some(plugin => !isBackendWhitelisted(plugin) && backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false && !plugin.updating);
        if (!['loading', 'checking', 'updating', 'error'].includes(backendUpdateState.phase)) {
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (backendUpdateState.canUpdate ? 'available' : (backendUpdateState.checkedPlugins.size ? 'latest' : 'idle'));
        }
        const $status = $popup.find('.em-backend-update-status');
        $status.text(backendUpdateState.message).toggleClass('error', backendUpdateState.phase === 'error').toggleClass('update', backendUpdateState.canUpdate).toggleClass('restart', backendUpdateState.restartRequired);
        const busy = ['loading', 'checking', 'updating'].includes(backendUpdateState.phase) || ['checking', 'updating'].includes(backendSelfUpdateState.phase);
        $popup.find('.em-check-backend').prop('disabled', busy).html(backendUpdateState.phase === 'checking' ? '<i class="fa-solid fa-spinner fa-spin"></i> 检测中' : '<i class="fa-solid fa-magnifying-glass"></i> 检测全部');
        $popup.find('.em-backend-refresh').prop('disabled', busy).html(backendUpdateState.phase === 'loading' ? '<i class="fa-solid fa-spinner fa-spin"></i> 读取中' : '<i class="fa-solid fa-arrows-rotate"></i> 读取插件');
        const failedCount = failedBackendPlugins().length;
        $popup.find('.em-retry-backend').prop('hidden', failedCount === 0).prop('disabled', busy).html(backendUpdateState.phase === 'checking' ? '<i class="fa-solid fa-spinner fa-spin"></i> 重试中' : '<i class="fa-solid fa-rotate-right"></i> 重试失败' + (failedCount ? ' (' + failedCount + ')' : ''));
        $popup.find('.em-update-backend').prop('hidden', !backendUpdateState.canUpdate && backendUpdateState.phase !== 'updating').prop('disabled', busy).html(backendUpdateState.phase === 'updating' ? '<i class="fa-solid fa-spinner fa-spin"></i> 更新中' : '<i class="fa-solid fa-cloud-arrow-down"></i> 更新全部');
        renderBackendSelfUpdate($popup);
        renderBackendPluginList($popup);
        renderBackendPanel($popup);
        if (detectionResults.active) renderDetectionResults($popup);
    }

    function syncBackendSelfPlugin(data = {}) {
        const current = managerBackendPlugin();
        const plugin = normalizeBackendPlugins([{
            ...(current || {}),
            id: current?.id || 'extension-manager',
            nativeName: current?.nativeName || '扩展管理器后端',
            name: current?.nativeName || current?.name || '扩展管理器后端',
            version: data.version || current?.version || state.backend.version,
            githubAuthor: data.githubAuthor || current?.githubAuthor || '',
            currentBranchName: data.currentBranchName || current?.currentBranchName || '',
            currentCommitHash: data.currentCommitHash || current?.currentCommitHash || '',
            shortCommitHash: data.shortCommitHash || current?.shortCommitHash || '',
            updateSupported: typeof data.updateSupported === 'boolean' ? data.updateSupported : current?.updateSupported,
            isUpToDate: typeof data.isUpToDate === 'boolean' ? data.isUpToDate : current?.isUpToDate,
            behind: Number.isFinite(Number(data.behind)) ? Number(data.behind) : current?.behind,
            error: data.error || '',
            code: data.code || '',
            isManager: true,
        }])[0];
        if (current) Object.assign(current, plugin);
        else backendUpdateState.plugins.push(plugin);
        backendSelfUpdateState.version = plugin.version || state.backend.version || '';
        return current || plugin;
    }

    function renderBackendSelfUpdate($popup) {
        const ownBusy = ['checking', 'updating'].includes(backendSelfUpdateState.phase);
        const otherBusy = backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase);
        const busy = ownBusy || otherBusy;
        const $status = $popup.find('.em-backend-self-update-status');
        $status.text(backendSelfUpdateState.message)
            .toggleClass('error', backendSelfUpdateState.phase === 'error')
            .toggleClass('update', backendSelfUpdateState.canUpdate)
            .toggleClass('restart', backendSelfUpdateState.restartRequired);
        $popup.find('.em-check-backend-self')
            .prop('disabled', !state.backend.available || busy)
            .html(backendSelfUpdateState.phase === 'checking'
                ? '<i class="fa-solid fa-spinner fa-spin"></i> 检测中'
                : '<i class="fa-solid fa-arrows-rotate"></i> 检测');
        $popup.find('.em-update-backend-self')
            .prop('hidden', !backendSelfUpdateState.canUpdate && backendSelfUpdateState.phase !== 'updating')
            .prop('disabled', busy)
            .html(backendSelfUpdateState.phase === 'updating'
                ? '<i class="fa-solid fa-spinner fa-spin"></i> 更新中'
                : '<i class="fa-solid fa-cloud-arrow-down"></i> 更新');
    }

    async function checkBackendSelfUpdate($popup) {
        if (['checking', 'updating'].includes(backendSelfUpdateState.phase) || backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase)) return backendSelfUpdateState;
        if (!state.backend.available) {
            await loadServerMeta();
            renderBackendState($popup);
        }
        if (!state.backend.available) {
            backendSelfUpdateState.phase = 'error';
            backendSelfUpdateState.canUpdate = false;
            backendSelfUpdateState.message = '管理后端未连接，请先安装并手动重启 SillyTavern';
            renderBackendSelfUpdate($popup);
            return backendSelfUpdateState;
        }
        backendSelfUpdateState.phase = 'checking';
        backendSelfUpdateState.canUpdate = false;
        backendSelfUpdateState.message = '正在检查扩展管理器后端更新';
        beginDetection($popup);
        renderBackendSelfUpdate($popup);
        try {
            const detect = () => request(BACKEND_BASE + '/version', { method: 'GET' });
            const data = state.backend.supportsNetworkOptimization
                ? await detect()
                : await optimizedDetectionRequest(detect, undefined, (attempt, total) => {
                    backendSelfUpdateState.message = '网络不稳定，正在重试 ' + attempt + ' / ' + total + '：扩展管理器后端';
                    renderBackendSelfUpdate($popup);
                });
            const plugin = syncBackendSelfPlugin(data);
            if (state.detectionCancelled) {
                backendSelfUpdateState.phase = 'idle';
                backendSelfUpdateState.message = '扩展管理器后端更新检查已取消';
            } else if (backendSelfUpdateState.restartRequired) {
                backendSelfUpdateState.phase = 'restart';
                backendSelfUpdateState.message = '扩展管理器后端代码已更新，请手动重启 SillyTavern';
            } else if (data.ignored === true) {
                backendSelfUpdateState.phase = 'ignored';
                backendSelfUpdateState.message = '扩展管理器后端已加入白名单，跳过更新检测';
            } else if (data.updateSupported === false) {
                backendSelfUpdateState.phase = 'error';
                backendSelfUpdateState.message = '扩展管理器后端无法自动更新' + (data.error ? '：' + data.error : '');
            } else {
                backendSelfUpdateState.canUpdate = data.isUpToDate === false;
                backendSelfUpdateState.phase = backendSelfUpdateState.canUpdate ? 'available' : 'latest';
                backendSelfUpdateState.message = backendSelfUpdateState.canUpdate
                    ? '发现扩展管理器后端更新' + (plugin.behind ? ' · 落后 ' + plugin.behind + ' 个提交' : '') + (plugin.version ? ' · 当前 v' + plugin.version : '')
                    : '扩展管理器后端已是最新版本' + (plugin.version ? ' v' + plugin.version : '');
            }
        } catch (error) {
            backendSelfUpdateState.phase = 'error';
            backendSelfUpdateState.canUpdate = false;
            backendSelfUpdateState.message = '扩展管理器后端检查失败：' + (error.message || error);
        } finally {
            renderBackendSelfUpdate($popup);
            finishDetection($popup);
        }
        return backendSelfUpdateState;
    }

    async function updateBackendSelf($popup) {
        if (!backendSelfUpdateState.canUpdate || ['checking', 'updating'].includes(backendSelfUpdateState.phase) || backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase)) return;
        backendSelfUpdateState.phase = 'updating';
        backendSelfUpdateState.message = '正在更新扩展管理器后端';
        renderBackendUpdate($popup);
        try {
            const data = await request(BACKEND_BASE + '/update', { method: 'POST', body: '{}' });
            syncBackendSelfPlugin({ ...data, isUpToDate: true, updateSupported: true });
            backendSelfUpdateState.canUpdate = false;
            backendSelfUpdateState.restartRequired = data.restartRequired === true;
            backendSelfUpdateState.phase = backendSelfUpdateState.restartRequired ? 'restart' : 'latest';
            backendSelfUpdateState.message = data.updated === false
                ? '扩展管理器后端已是最新版本' + (backendSelfUpdateState.version ? ' v' + backendSelfUpdateState.version : '')
                : '扩展管理器后端已更新，请手动重启 SillyTavern';
            if (window.toastr) toastr[data.restartRequired === true ? 'warning' : 'success'](backendSelfUpdateState.message);
        } catch (error) {
            backendSelfUpdateState.phase = 'error';
            backendSelfUpdateState.message = '扩展管理器后端更新失败：' + (error.message || error);
            if (window.toastr) toastr.error(backendSelfUpdateState.message);
        } finally {
            renderBackendUpdate($popup);
        }
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
            const manager = managerBackendPlugin();
            if (manager) {
                backendSelfUpdateState.version = manager.version || state.backend.version || '';
                if (!['checking', 'updating', 'available', 'restart'].includes(backendSelfUpdateState.phase)) {
                    backendSelfUpdateState.message = '已连接' + (backendSelfUpdateState.version ? ' v' + backendSelfUpdateState.version : '') + '，点击检测后端更新';
                }
            }
            backendUpdateState.checkedPlugins.clear();
            backendUpdateState.checkingPlugins.clear();
            backendUpdateState.phase = 'idle';
            backendUpdateState.message = '已读取 ' + regularBackendPlugins().length + ' 个其他后端插件，点击检测后查看更新';
        } catch (error) {
            backendUpdateState.phase = 'error';
            backendUpdateState.message = '读取后端插件失败：' + (error.message || error);
        }
        renderBackendUpdate($popup);
        return backendUpdateState.plugins;
    }

    async function checkBackendPlugins(pluginIds, $popup, options = {}) {
        if (['checking', 'updating'].includes(backendSelfUpdateState.phase)) return backendUpdateState;
        if (['loading', 'checking', 'updating'].includes(backendUpdateState.phase) || backendUpdateState.batchUpdating) return backendUpdateState;
        if (!backendUpdateState.plugins.length) await loadBackendPlugins($popup);
        const existing = new Set(backendUpdateState.plugins.map(plugin => plugin.id));
        const ids = Array.from(new Set(pluginIds || [])).filter(id => existing.has(id) && (options.allowWhitelisted || !isBackendWhitelisted(id)));
        if (!ids.length) {
            if (window.toastr) toastr.info('请选择需要检测的后端插件');
            return backendUpdateState;
        }
        const returnPanel = String($popup.find('.em-panel.active').attr('data-panel') || 'backend');
        backendUpdateState.phase = 'checking';
        backendUpdateState.message = '正在检测后端插件 0 / ' + ids.length;
        beginDetection($popup);
        renderBackendUpdate($popup);
        if (options.whitelistView) renderWhitelistPanel($popup);
        let legacy = false;
        try {
            for (let index = 0; index < ids.length; index++) {
                if (state.detectionCancelled) break;
                const pluginId = ids[index];
                backendUpdateState.checkingPlugins.add(pluginId);
                backendUpdateState.message = '正在检测后端插件 ' + (index + 1) + ' / ' + ids.length;
                renderBackendUpdate($popup);
                if (options.whitelistView) renderWhitelistPanel($popup);
                try {
                    const detectPlugin = () => request(BACKEND_BASE + "/plugins/check", {
                        method: "POST",
                        body: JSON.stringify({ pluginIds: [pluginId], includeWhitelisted: options.allowWhitelisted === true }),
                    });
                    const data = state.backend.supportsNetworkOptimization
                        ? await detectPlugin()
                        : await optimizedDetectionRequest(detectPlugin, undefined, (attempt, total) => {
                            backendUpdateState.message = `网络不稳定，正在重试 ${attempt} / ${total}：${backendUpdateState.plugins.find(item => item.id === pluginId)?.name || pluginId}`;
                            renderBackendUpdate($popup);
                            if (options.whitelistView) renderWhitelistPanel($popup);
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
                    if (state.detectionCancelled || error?.name === "AbortError") break;
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
                    if (options.whitelistView) renderWhitelistPanel($popup);
                }
            }
            const detected = backendUpdateState.plugins.filter(plugin => (options.allowWhitelisted ? ids.includes(plugin.id) : !isBackendWhitelisted(plugin)) && backendUpdateState.checkedPlugins.has(plugin.id));
            const available = detected.filter(plugin => plugin.updateSupported === true && plugin.isUpToDate === false).length;
            const unsupported = detected.filter(plugin => plugin.updateSupported === false).length;
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (available ? 'available' : 'latest');
            backendUpdateState.message = state.detectionCancelled
                ? '检测已取消，未开始的后端插件已跳过'
                : legacy
                ? '管理后端版本较旧；请先更新并手动重启，重启后可多选检测'
                : '已检测 ' + ids.length + ' 个后端插件' + (available ? '，' + available + ' 个可更新' : '，没有可用更新') + (unsupported ? '，' + unsupported + ' 个无法自动更新' : '');
        } catch (error) {
            backendUpdateState.phase = 'error';
            backendUpdateState.message = '后端插件检测失败：' + (error.message || error);
        } finally {
            backendUpdateState.checkingPlugins.clear();
            renderBackendUpdate($popup);
            if (options.whitelistView) renderWhitelistPanel($popup);
            const showResults = options.showResults === true && !state.detectionCancelled;
            backendUpdateState.statusSortActive = options.showResults === true || backendUpdateState.statusSortActive;
            if (options.whitelistView && options.showResults === true) whitelistState.statusSortActive = true;
            finishDetection($popup);
            if (showResults) openDetectionResults('backend', ids, $popup, { allowWhitelisted: options.allowWhitelisted === true, returnPanel: options.returnPanel || returnPanel, title: options.resultTitle || '后端插件检测结果' });
        }
        return backendUpdateState;
    }

    function failedBackendPlugins() {
        return regularBackendPlugins().filter(plugin => !isBackendWhitelisted(plugin) && backendUpdateState.checkedPlugins.has(plugin.id) && Boolean(plugin.error));
    }

    async function retryFailedBackend($popup) {
        const ids = failedBackendPlugins().map(plugin => plugin.id);
        if (!ids.length) {
            if (window.toastr) toastr.info('当前没有检测失败的后端插件');
            return backendUpdateState;
        }
        return checkBackendPlugins(ids, $popup, { showResults: true, returnPanel: 'backend', resultTitle: '后端失败项重试结果' });
    }

    async function checkBackendUpdate($popup) {
        await loadBackendPlugins($popup);
        const ids = regularBackendPlugins().map(plugin => plugin.id);
        if (!ids.length) {
            backendUpdateState.message = '当前没有其他后端插件可检测';
            renderBackendUpdate($popup);
            if (window.toastr) toastr.info(backendUpdateState.message);
            return backendUpdateState;
        }
        return checkBackendPlugins(ids, $popup, { showResults: true, returnPanel: 'backend', resultTitle: '其他后端插件检测结果' });
    }

    async function checkBackendGroup(group, $popup, options = {}) {
        const actionState = options.whitelistView ? whitelistState : backendUpdateState;
        const ids = (options.whitelistView ? backendUpdateState.plugins : regularBackendPlugins()).filter(plugin => backendGroupOf(plugin) === group && (options.allowWhitelisted || !isBackendWhitelisted(plugin))).map(plugin => plugin.id);
        if (!ids.length) { if (window.toastr) toastr.info('此分组没有可检测的后端插件'); return; }
        actionState.groupAction = { group, phase: 'checking' };
        try { await checkBackendPlugins(ids, $popup, { allowWhitelisted: options.allowWhitelisted === true, whitelistView: options.whitelistView === true, showResults: true, returnPanel: options.whitelistView ? 'whitelist' : 'backend', resultTitle: '后端分组检测结果：' + group }); }
        finally { actionState.groupAction = { group: '', phase: '' }; renderBackendPluginList($popup); if (options.whitelistView) renderWhitelistPanel($popup); }
    }

    async function updateBackendGroup(group, $popup, options = {}) {
        if (backendUpdateState.batchUpdating || backendUpdateState.phase === 'checking' || ['checking', 'updating'].includes(backendSelfUpdateState.phase)) return;
        const actionState = options.whitelistView ? whitelistState : backendUpdateState;
        const candidates = (options.whitelistView ? backendUpdateState.plugins : regularBackendPlugins()).filter(plugin => backendGroupOf(plugin) === group && (options.allowWhitelisted || !isBackendWhitelisted(plugin)));
        const undetected = candidates.filter(plugin => !backendUpdateState.checkedPlugins.has(plugin.id));
        if (undetected.length) { if (window.toastr) toastr.warning('此分组还有 ' + undetected.length + ' 个后端插件未检测，请先检测分组'); return; }
        const ids = candidates.filter(plugin => plugin.updateSupported === true && plugin.isUpToDate === false).map(plugin => plugin.id);
        if (!ids.length) { if (window.toastr) toastr.info('检测完成，此分组暂无可更新后端插件'); return; }
        actionState.groupAction = { group, phase: 'updating' };
        try { await updateBackendPluginsSequentially(ids, $popup, { allowWhitelisted: options.allowWhitelisted === true, whitelistView: options.whitelistView === true }); }
        finally { actionState.groupAction = { group: '', phase: '' }; renderBackendPluginList($popup); if (options.whitelistView) renderWhitelistPanel($popup); }
    }

    async function checkSelectedBackendPlugins($popup) {
        return checkBackendPlugins(Array.from(backendUpdateState.selectedPlugins), $popup, { showResults: true, returnPanel: 'backend', resultTitle: '所选后端插件检测结果' });
    }

    async function uninstallBackendPlugin(pluginId, $popup, options = {}) {
        const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
        if (!plugin || plugin.isManager || pluginId === "extension-manager") { if (window.toastr) toastr.warning("扩展管理器后端不允许删除，以免出现不可逆错误"); return false; }
        if (!options.confirmed && !window.confirm("确认卸载后端插件“" + plugin.name + "”？删除后需要重启酒馆后端，且无法撤销。")) return false;
        plugin.updating = true;
        renderBackendUpdate($popup);
        try {
            const data = await request(BACKEND_BASE + "/plugins/" + encodeURIComponent(pluginId), { method: "DELETE" });
            backendUpdateState.plugins = backendUpdateState.plugins.filter(item => item.id !== pluginId);
            backendUpdateState.selectedPlugins.delete(pluginId);
            backendUpdateState.checkedPlugins.delete(pluginId);
            if (!options.quiet && window.toastr) toastr.warning(data.message || (plugin.name + " 已卸载，请手动重启 SillyTavern"));
            renderBackendUpdate($popup);
            if (whitelistState.scope === "backend") renderWhitelistPanel($popup);
            if (detectionResults.active) renderDetectionResults($popup);
            return true;
        } catch (error) {
            plugin.updating = false;
            if (window.toastr) toastr.error(plugin.name + " 卸载失败：" + (error.message || error));
            renderBackendUpdate($popup);
            return false;
        }
    }

    async function uninstallBackendPluginsSequentially(plugins, $popup, options = {}) {
        const targets = (plugins || []).filter(plugin => plugin && !plugin.isManager && plugin.id !== "extension-manager");
        if (!targets.length) { if (window.toastr) toastr.warning("扩展管理器后端不允许删除"); return; }
        if (!options.confirmed && !window.confirm("确认卸载选中的 " + targets.length + " 个后端插件？删除后需要重启酒馆后端，且无法撤销。")) return;
        backendUpdateState.batchUpdating = true;
        renderBackendUpdate($popup);
        let completed = 0;
        try { for (const plugin of targets) if (await uninstallBackendPlugin(plugin.id, $popup, { confirmed: true, quiet: true })) completed += 1; }
        finally { backendUpdateState.batchUpdating = false; renderBackendUpdate($popup); }
        if (window.toastr) toastr.warning("后端插件卸载完成：" + completed + " / " + targets.length + "，请手动重启 SillyTavern");
    }

    async function uninstallBackendGroup(group, $popup) {
        const targets = regularBackendPlugins().filter(plugin => backendGroupOf(plugin) === group && !plugin.isManager);
        if (!targets.length) { if (window.toastr) toastr.info("此分组没有可卸载的后端插件"); return; }
        if (!window.confirm("确认卸载后端分组“" + group + "”内的 " + targets.length + " 个插件？删除后需要重启酒馆后端。")) return;
        await uninstallBackendPluginsSequentially(targets, $popup, { confirmed: true });
    }
    async function updateBackendPlugin(pluginId, $popup, options = {}) {
        const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
        if (!plugin || ['checking', 'updating'].includes(backendSelfUpdateState.phase) || (isBackendWhitelisted(plugin) && !options.allowWhitelisted) || plugin.updating || !backendUpdateState.checkedPlugins.has(pluginId) || plugin.updateSupported !== true || plugin.isUpToDate !== false || (backendUpdateState.phase === 'updating' && !options.batch)) return false;
        plugin.updating = true;
        backendUpdateState.phase = 'updating';
        backendUpdateState.message = '正在更新：' + plugin.name;
        renderBackendUpdate($popup);
        if (options.whitelistView) renderWhitelistPanel($popup);
        try {
            const data = await request(plugin.legacy ? BACKEND_BASE + '/update' : BACKEND_BASE + '/plugins/update', {
                method: 'POST',
                body: plugin.legacy ? '{}' : JSON.stringify({ pluginId: plugin.id, includeWhitelisted: options.allowWhitelisted === true }),
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
                const remaining = regularBackendPlugins().some(item => !isBackendWhitelisted(item) && backendUpdateState.checkedPlugins.has(item.id) && item.updateSupported === true && item.isUpToDate === false);
                backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (remaining ? 'available' : 'latest');
            }
            renderBackendUpdate($popup);
            if (options.whitelistView) renderWhitelistPanel($popup);
        }
    }

    async function updateBackendPluginsSequentially(pluginIds, $popup, options = {}) {
        if (backendUpdateState.batchUpdating || ['checking', 'loading'].includes(backendUpdateState.phase) || ['checking', 'updating'].includes(backendSelfUpdateState.phase)) return;
        const targets = Array.from(new Set(pluginIds || [])).map(id => backendUpdateState.plugins.find(plugin => plugin.id === id)).filter(plugin => plugin && (options.allowWhitelisted || !isBackendWhitelisted(plugin)) && backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
        if (!targets.length) {
            if (window.toastr) toastr.info('检测完成，所选后端插件暂无可更新项');
            return;
        }
        backendUpdateState.batchUpdating = true;
        backendUpdateState.phase = 'updating';
        renderBackendUpdate($popup);
        if (options.whitelistView) renderWhitelistPanel($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                const plugin = targets[index];
                backendUpdateState.message = '正在更新后端插件 ' + (index + 1) + ' / ' + targets.length + '：' + plugin.name;
                renderBackendUpdate($popup);
                if (options.whitelistView) renderWhitelistPanel($popup);
                $popup.find('.em-backend-batch-status, .em-whitelist-batch-status').text(backendUpdateState.message);
                if (await updateBackendPlugin(plugin.id, $popup, { quiet: true, batch: true, allowWhitelisted: options.allowWhitelisted === true, whitelistView: options.whitelistView === true })) completed += 1;
            }
            backendUpdateState.message = backendUpdateState.restartRequired
                ? '后端更新完成：' + completed + ' / ' + targets.length + '。请手动重启 SillyTavern'
                : '后端检查完成：' + completed + ' / ' + targets.length + '，无需重启';
            if (window.toastr) toastr[backendUpdateState.restartRequired ? 'warning' : 'success'](backendUpdateState.message);
        } finally {
            backendUpdateState.batchUpdating = false;
            const remaining = regularBackendPlugins().some(plugin => !isBackendWhitelisted(plugin) && backendUpdateState.checkedPlugins.has(plugin.id) && plugin.updateSupported === true && plugin.isUpToDate === false);
            backendUpdateState.phase = backendUpdateState.restartRequired ? 'restart' : (remaining ? 'available' : 'latest');
            renderBackendUpdate($popup);
            if (options.whitelistView) renderWhitelistPanel($popup);
        }
    }

    async function updateBackend($popup) {
        return updateBackendPluginsSequentially(regularBackendPlugins().map(plugin => plugin.id), $popup);
    }

    async function updateSelectedBackendPlugins($popup) {
        const selected = regularBackendPlugins().filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id) && !isBackendWhitelisted(plugin));
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
        if (isFrontendWhitelisted(getInstalledExtensionName())) return;
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

    function extensionAssetElements(extension) {
        const folder = folderOf(extension).toLowerCase();
        const entries = [extension.manifest?.js, extension.manifest?.css].filter(Boolean).map(value => String(value).toLowerCase());
        return Array.from(document.querySelectorAll("script[src], link[href]")).filter(element => {
            const source = element.src || element.href || "";
            let pathname = "";
            try { pathname = new URL(source, document.baseURI || location.href).pathname.toLowerCase(); } catch (error) {}
            return pathname.includes("/scripts/extensions/") && pathname.includes("/" + folder + "/") && (!entries.length || entries.some(entry => pathname.endsWith("/" + entry)));
        });
    }

    function extensionScriptElements(extension) {
        return extensionAssetElements(extension).filter(element => element.tagName === "SCRIPT");
    }

    function normalizedMenuText(value) {
        return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\-_/.:·()（）]+/g, "");
    }

    function extensionUiLabels(extension) {
        const rawTokens = [
            folderOf(extension),
            displayPath(extension),
            extension.name,
            extension.displayName,
            extension.zhName,
            extension.manifest?.display_name,
            extension.manifest?.name,
            extension.manifest?.id,
        ]
            .map(value => String(value || '').trim())
            .filter(Boolean);
        return Array.from(new Set(rawTokens
            .flatMap(value => [value, value.replace(/^(sillytavern|st)[-_ ]*/i, '')])
            .map(normalizedMenuText)
            .filter(value => /[^\x00-\x7F]/.test(value) ? value.length >= 2 : value.length >= 4)));
    }

    function extensionUiMetadata(node, includeText = false, includeDescendants = false) {
        if (!(node instanceof Element)) return '';
        const nodes = includeDescendants ? [node, ...node.querySelectorAll('*')] : [node];
        const attributes = nodes.flatMap(item => [
            'id', 'class', 'data-name', 'data-extension', 'data-plugin', 'data-extension-name',
            'aria-label', 'title', 'href', 'for',
        ].map(attribute => item.getAttribute?.(attribute) || ''));
        return normalizedMenuText([includeText ? node.textContent || '' : '', ...attributes].join(' '));
    }

    function matchesExtensionUi(node, labels, includeText = false, includeDescendants = false) {
        const haystack = extensionUiMetadata(node, includeText, includeDescendants);
        return Boolean(haystack && labels.some(label => haystack.includes(label)));
    }

    function settingEntryRoot(candidate, surface) {
        const extensionRoot = candidate.closest('[data-extension], [data-plugin], [data-extension-name], [class*="extension-settings"], [class*="extension_settings"]');
        const preferred = extensionRoot || candidate.closest('.inline-drawer');
        if (preferred && preferred !== surface && surface.contains(preferred)) return preferred;
        let root = candidate;
        while (root.parentElement && root.parentElement !== surface) root = root.parentElement;
        return root === surface ? candidate : root;
    }

    function rememberExtensionUiEntries(extension) {
        const folder = folderOf(extension);
        const entries = new Set();
        const labels = extensionUiLabels(extension);
        const remember = node => {
            if (!(node instanceof Element) || node.closest?.(`#${OVERLAY_ID}`)) return;
            entries.add(node);
            extensionHotRuntime.trackNode(folder, node);
        };
        $("#extensionsMenu").find(".list-group-item, .menu_button, [role=menuitem], button").each(function () {
            const $candidate = $(this);
            if ($candidate.is("#st-extension-manager-btn") || $candidate.closest("#st-extension-manager-btn").length) return;
            if (!matchesExtensionUi(this, labels, true, true)) return;
            const $entry = $candidate.closest(".list-group-item, [role=menuitem]").first();
            remember(($entry.length ? $entry : $candidate)[0]);
        });
        document.querySelectorAll('[id^="extensions_settings"]').forEach(surface => {
            surface.querySelectorAll('[id], [class], [data-extension], [data-name], [data-plugin], [data-extension-name], [aria-label], [title]').forEach(candidate => {
                if (matchesExtensionUi(candidate, labels, false)) remember(settingEntryRoot(candidate, surface));
            });
            surface.querySelectorAll('.inline-drawer-header, .inline-drawer-toggle, [role="heading"], h1, h2, h3, h4, h5, h6, legend, b, strong').forEach(candidate => {
                if (matchesExtensionUi(candidate, labels, true)) remember(settingEntryRoot(candidate, surface));
            });
        });
        document.querySelectorAll('#movingDivs > *, body > [data-extension], body > [data-plugin], body > [data-extension-name]').forEach(candidate => {
            if (matchesExtensionUi(candidate, labels, false)) remember(candidate);
        });
        return entries;
    }

    function applyExtensionUiEntryState(node, enabled, owner) {
        if (!(node instanceof Element)) return;
        if (!enabled) {
            if (node.dataset.emHotOwner && node.dataset.emHotOwner !== owner) return;
            node.dataset.emHotOwner = owner;
            if (node.dataset.emHotHidden === '1') return;
            node.dataset.emHotHidden = '1';
            node.dataset.emHotDisplay = node.style.display || '';
            node.style.setProperty('display', 'none', 'important');
            return;
        }
        if (node.dataset.emHotOwner && node.dataset.emHotOwner !== owner) return;
        if (node.dataset.emHotHidden !== '1') {
            delete node.dataset.emHotOwner;
            return;
        }
        const display = node.dataset.emHotDisplay || '';
        delete node.dataset.emHotHidden;
        delete node.dataset.emHotDisplay;
        delete node.dataset.emHotOwner;
        node.style.removeProperty('display');
        if (display) node.style.display = display;
    }

    function setExtensionUiEntriesEnabled(extension, enabled) {
        const owner = folderOf(extension).toLowerCase();
        rememberExtensionUiEntries(extension).forEach(node => applyExtensionUiEntryState(node, enabled, owner));
    }

    function verifyExtensionUiState(extension, enabled) {
        setExtensionUiEntriesEnabled(extension, enabled);
    }

    function removeExtensionUiEntries(extension) {
        const labels = extensionUiLabels(extension);
        const owner = folderOf(extension).toLowerCase();
        const remove = node => {
            if (!(node instanceof Element) || node.id === MENU_BTN_ID || node.closest?.("#" + OVERLAY_ID)) return;
            node.remove();
        };
        rememberExtensionUiEntries(extension);
        extensionHotRuntime.dispose(owner, true);
        extensionAssetElements(extension).forEach(element => element.remove());
        document.querySelectorAll("#extensionsMenu .list-group-item, #extensionsMenu .menu_button, #extensionsMenu [role=menuitem], #extensionsMenu button").forEach(candidate => {
            if (candidate.id === MENU_BTN_ID || candidate.closest?.("#" + MENU_BTN_ID)) return;
            if (matchesExtensionUi(candidate, labels, true, true)) remove(candidate.closest(".list-group-item, [role=menuitem]") || candidate);
        });
        document.querySelectorAll("[id^=extensions_settings]").forEach(surface => surface.querySelectorAll("[id], [class], [data-extension], [data-name], [data-plugin], [data-extension-name], [aria-label], [title]").forEach(candidate => {
            if (matchesExtensionUi(candidate, labels, true, false)) remove(settingEntryRoot(candidate, surface));
        }));
    }

    function currentScriptFor(extension) {
        return extensionScriptElements(extension)[0] || null;
    }

    function isNyFontManager(extension) {
        return folderOf(extension).toLowerCase() === NY_FONT_MANAGER_FOLDER;
    }

    function readNyFontManagerState() {
        try {
            const value = JSON.parse(window.sessionStorage.getItem(NY_FONT_MANAGER_STATE_KEY) || 'null');
            return value && typeof value === 'object' ? value : null;
        } catch (error) { return null; }
    }

    function storeNyFontManagerState(value) {
        try {
            if (value) window.sessionStorage.setItem(NY_FONT_MANAGER_STATE_KEY, JSON.stringify(value));
            else window.sessionStorage.removeItem(NY_FONT_MANAGER_STATE_KEY);
        } catch (error) {}
    }

    function extensionFileUrl(extension, file) {
        return new URL(`/scripts/extensions/${displayPath(extension)}/${file}`, document.baseURI || location.href).href;
    }

    async function ensureExtensionStyle(extension) {
        const css = String(extension.manifest?.css || '').trim();
        if (!css || extensionAssetElements(extension).some(element => element.tagName === 'LINK')) return;
        const url = new URL(extensionFileUrl(extension, css));
        url.searchParams.set('em_update', Date.now());
        await new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url.href;
            link.dataset.extensionManagerHot = '1';
            link.onload = resolve;
            link.onerror = () => reject(new Error('重新加载扩展样式失败'));
            document.head.appendChild(link);
        });
    }

    async function toggleNyFontManagerHot(extension, enabled) {
        if (!isNyFontManager(extension)) return false;
        const [stateModule, coreModule] = await Promise.all([
            import(extensionFileUrl(extension, 'nytwState.js')),
            import(extensionFileUrl(extension, 'nytwCore.js')),
        ]);
        const nySettings = stateModule?.settings;
        if (!nySettings || typeof nySettings !== 'object') throw new Error('无法读取 Ny 字体管理器设置');

        if (!enabled) {
            if (!readNyFontManagerState()) {
                storeNyFontManagerState({
                    fontsEnabled: nySettings.fontsEnabled !== false,
                    chatFontImportEnabled: nySettings.chatFontImportEnabled === true,
                });
            }
            nySettings.fontsEnabled = false;
            nySettings.chatFontImportEnabled = false;
            coreModule.queueApplyFonts?.();
            coreModule.scheduleScan?.({ full: true });
            await nextPaint();
            document.getElementById('nytw_settings_root')?.remove();
            document.getElementById('nytw-reading-style')?.remove();
            document.getElementById('nytw-font-style')?.remove();
            document.querySelectorAll('link[data-nytw-font-css]').forEach(element => element.remove());
            document.querySelectorAll('link[data-st-chat-font-importer]').forEach(element => { element.disabled = true; });
            return true;
        }

        const previous = readNyFontManagerState();
        if (previous) {
            nySettings.fontsEnabled = previous.fontsEnabled !== false;
            nySettings.chatFontImportEnabled = previous.chatFontImportEnabled === true;
            storeNyFontManagerState(null);
        }
        await ensureExtensionStyle(extension);
        document.querySelectorAll('link[data-st-chat-font-importer]').forEach(element => { element.disabled = false; });
        const [settingsUiModule, importerModule] = await Promise.all([
            import(extensionFileUrl(extension, 'nytwSettingsUi.js')),
            import(extensionFileUrl(extension, 'nytwChatFontImporter.js')),
        ]);
        coreModule.queueApplyFonts?.();
        coreModule.scheduleScan?.({ full: true });
        await settingsUiModule.setupSettingsUi?.();
        if (typeof globalThis.nytwChatFontImporterRescan === 'function') importerModule.importer_scheduleScan?.('extension-manager-enable');
        else importerModule.initChatFontImporter?.();
        return true;
    }

    async function loadExtensionEntry(extension, cacheKey = 'em_hot_start') {
        const script = currentScriptFor(extension);
        const js = String(extension.manifest?.js || '').trim();
        if (!js) return true;
        const source = script?.src || `/scripts/extensions/${displayPath(extension)}/${extension.manifest?.js || 'index.js'}`;
        const url = new URL(source, document.baseURI || location.href);
        url.searchParams.set(cacheKey, Date.now());
        extensionHotRuntime.beginCapture?.();
        await new Promise((resolve, reject) => {
            const next = document.createElement('script');
            next.type = script?.type || 'module';
            next.async = true;
            next.src = url.href;
            next.onload = resolve;
            next.onerror = () => reject(new Error('重新加载扩展脚本失败'));
            extensionHotRuntime.runWithOwner(folderOf(extension), () => document.body.appendChild(next));
        });
        return true;
    }

    async function hotReload(extension) {
        const folder = folderOf(extension);
        const cleanupName = extensionCleanupName(extension);
        if (typeof window[cleanupName] === 'function') {
            try { await window[cleanupName](); }
            catch (error) { console.warn('[Extension Manager] Extension cleanup before update failed.', folder, error); }
        }
        if (isNyFontManager(extension)) {
            await toggleNyFontManagerHot(extension, false);
            await toggleNyFontManagerHot(extension, true);
            return true;
        }
        rememberExtensionUiEntries(extension);
        extensionHotRuntime.dispose(folder, true);
        extensionAssetElements(extension).forEach(element => element.remove());
        await ensureExtensionStyle(extension);
        await loadExtensionEntry(extension, 'em_update');
        return true;
    }

    function nextPaint() {
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function extensionCleanupName(extension) {
        return `__${folderOf(extension).replace(/[^a-z0-9_$]/gi, '_')}HotCleanup`;
    }

    function extensionHotToggleMode(extension) {
        if (isNyFontManager(extension)) return 'ny-font-manager';
        if (!String(extension.manifest?.js || '').trim() && String(extension.manifest?.css || '').trim()) return 'css-only';
        return 'runtime-managed';
    }

    async function setExtensionStylesEnabled(extension, enabled) {
        if (enabled) await ensureExtensionStyle(extension);
        extensionAssetElements(extension)
            .filter(element => element.tagName === 'LINK')
            .forEach(element => { element.disabled = !enabled; });
    }

    async function stopExtensionHot(extension, options = {}) {
        const folder = folderOf(extension);
        verifyExtensionUiState(extension, false);
        extensionHotRuntime.pause(folder);
        await setExtensionStylesEnabled(extension, false);
        await nextPaint();
        verifyExtensionUiState(extension, false);
        if (options.removeResources) {
            extensionHotRuntime.dispose(folder, true);
            extensionAssetElements(extension).forEach(element => element.remove());
            verifyExtensionUiState(extension, false);
            extensionHotRuntime.dispose(folder, true);
            extensionAssetElements(extension).forEach(element => element.remove());
        }
    }

    async function toggleExtensionHot(extension, enabled) {
        const mode = extensionHotToggleMode(extension);
        const folder = folderOf(extension);
        await setExtensionEnabled(extension, enabled, false);

        if (isNyFontManager(extension)) {
            if (!enabled) await stopExtensionHot(extension);
            await toggleNyFontManagerHot(extension, enabled);
            await setExtensionStylesEnabled(extension, enabled);
            if (enabled) {
                extensionHotRuntime.resume(folder);
                verifyExtensionUiState(extension, true);
            }
        } else if (!enabled) {
            await stopExtensionHot(extension);
        } else {
            await setExtensionStylesEnabled(extension, true);
            const resumed = extensionHotRuntime.resume(folder);
            if (!resumed && !currentScriptFor(extension)) await loadExtensionEntry(extension);
            verifyExtensionUiState(extension, true);
        }

        await nextPaint();
        const api = await getExtensionApi();
        const current = api.findExtension?.(displayPath(extension)) || api.findExtension?.(folderOf(extension));
        if (!current || current.enabled !== enabled) throw new Error('扩展状态复核失败');
        extension.enabled = current.enabled;
        return { ...current, hot: true, mode, resources: extensionHotRuntime.stats(folder) };
    }

    async function updateOne(extension, $popup, options = {}) {
        const folder = folderOf(extension);
        if (!isExternal(extension) || (isFrontendWhitelisted(folder) && !options.allowWhitelisted) || state.updating.has(folder)) return false;
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
                await discover({ freshManifests: true });
                const refreshedExtension = state.extensions.find(item => folderOf(item) === folder) || extension;
                refreshedExtension.updatedAt = Date.now();
                await checkOne(refreshedExtension, undefined, { allowWhitelisted: options.allowWhitelisted === true });
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
            if (detectionResults.active) renderDetectionResults($popup);
        }
        return success;
    }

    function selectedExternalExtensions() {
        return state.extensions.filter(extension => state.selectedExtensions.has(folderOf(extension)) && isExternal(extension));
    }

    async function checkSelected($popup) {
        if (state.checking || state.batchUpdating || state.batchToggling) return;
        const targets = selectedExternalExtensions().filter(extension => !isFrontendWhitelisted(extension));
        if (!targets.length) {
            if (window.toastr) toastr.info('请先选择需要检测的扩展');
            return;
        }
        state.checking = true;
        beginDetection($popup);
        state.frontendCheckProgress = { completed: 0, total: targets.length };
        try {
            const checks = mapDetectionTargets(targets, async extension => {
                const result = await checkOne(extension);
                state.frontendCheckProgress.completed += 1;
                renderList($popup);
                return result;
            });
            renderList($popup);
            await checks;
            const available = targets.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false);
            if (!state.detectionCancelled) state.frontendCheckProgress = { completed: state.frontendCheckProgress.total, total: state.frontendCheckProgress.total };
            if (!state.detectionCancelled && window.toastr) toastr.info(available.length ? `选中扩展中有 ${available.length} 个可更新` : '选中扩展均无可用更新');
        } finally {
            state.checking = false;
            renderList($popup);
            const showResults = !state.detectionCancelled;
            state.statusSortActive = true;
            finishDetection($popup);
            if (showResults) openDetectionResults('frontend', targets.map(folderOf), $popup, { returnPanel: 'installed', title: '所选前端扩展检测结果' });
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
                    await toggleExtensionHot(extension, enabled);
                    completed += 1;
                } catch (error) {
                    if (window.toastr) toastr.error(`${extension.displayName} ${enabled ? '启用' : '禁用'}失败：${error.message || error}`);
                }
            }
            if (window.toastr) toastr.success(`批量${enabled ? '启用' : '禁用'}完成：${completed} / ${targets.length}，已在当前页面热切换`);
        } finally {
            state.batchToggling = false;
            renderList($popup);
        }
    }

    async function updateSelectedSequentially($popup) {
        if (state.batchUpdating || state.batchToggling || state.checking) return;
        const selected = selectedExternalExtensions().filter(extension => !isFrontendWhitelisted(extension));
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

    async function updateAll($popup) {
        if (state.batchUpdating || state.batchToggling || state.checking) return;
        const targets = state.extensions.filter(extension => isExternal(extension) && !isFrontendWhitelisted(extension) && state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) { if (window.toastr) toastr.info("检测完成，暂无可更新的前端扩展"); return; }
        state.batchUpdating = true;
        renderList($popup);
        const $status = $popup.find(".em-frontend-update-status");
        let completed = 0;
        try {
            for (const extension of targets) {
                $status.text(`正在更新 ${completed + 1} / ${targets.length}：${extension.displayName}`);
                if (await updateOne(extension, $popup, { quiet: true, deferRender: true, deferSelectionRender: true })) completed += 1;
            }
            if (window.toastr) toastr.success(`批量更新完成：${completed} / ${targets.length}，已依次热加载`);
        } finally {
            state.batchUpdating = false;
            renderList($popup);
        }
    }

    function compareWhitelistEntries(a, b, scope = whitelistState.scope) {
        const nameCompare = () => a.name.localeCompare(b.name, "zh-Hans", { numeric: true }) || a.id.localeCompare(b.id);
        const statusRank = (entry) => whitelistStatusRank(entry, scope);
        if (whitelistState.statusSortActive || whitelistState.sort === "status") {
            const enabledCompare = scope === "frontend" ? enabledSortRank(a.entity) - enabledSortRank(b.entity) : 0;
            return statusRank(a) - statusRank(b) || enabledCompare || nameCompare();
        }
        if (whitelistState.sort === "updated") {
            const timeA = scope === "backend" ? backendUpdatedTimestamp(a.entity) : extensionUpdatedTimestamp(a.entity);
            const timeB = scope === "backend" ? backendUpdatedTimestamp(b.entity) : extensionUpdatedTimestamp(b.entity);
            return timeB - timeA || nameCompare();
        }
        if (whitelistState.sort === "enabled" && scope === "frontend") return enabledSortRank(a.entity) - enabledSortRank(b.entity) || nameCompare();
        return nameCompare();
    }

    function frontendStatusRank(extension) {
        const update = state.updates.get(folderOf(extension));
        if (update?.error) return 0;
        if (update?.isUpToDate === false) return 1;
        if (update?.isUpToDate === true) return 2;
        return 3;
    }

    function filteredExtensions() {
        const filter = state.filter.toLowerCase();
        return state.extensions.filter(extension => {
            const group = groupOf(extension);
            const matchesCategory = !state.category || group === state.category;
            const matchesText = !filter || [extension.displayName, extension.name, extension.description, group, repoUrl(extension)].join(' ').toLowerCase().includes(filter);
            return matchesCategory && matchesText;
        }).sort((a, b) => compareFrontendExtensions(a, b));
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

    async function uninstallFrontendExtension(extension, $popup, options = {}) {
        const folder = folderOf(extension);
        if (!extension || typeOf(extension) === "system" || folder.toLowerCase() === getInstalledExtensionName().toLowerCase()) {
            if (window.toastr) toastr.warning("内置扩展或扩展管理器本体不允许删除，以免出现不可逆错误");
            return false;
        }
        if (!options.confirmed && !window.confirm("确认卸载前端扩展“" + extension.displayName + "”？此操作会删除扩展文件，且无法撤销。")) return false;
        state.uninstalling.add(folder);
        let stoppedForUninstall = false;
        renderList($popup);
        try {
            await stopExtensionHot(extension);
            stoppedForUninstall = true;
            await request("/api/extensions/delete", { method: "POST", body: JSON.stringify({ extensionName: folder, global: isGlobal(extension) }) });
            const cleanupName = extensionCleanupName(extension);
            try { if (typeof window[cleanupName] === "function") await window[cleanupName](); }
            catch (error) { if (window.toastr) toastr.warning(extension.displayName + " 已删除，但扩展自带清理失败：" + (error.message || error)); }
            const nextMeta = { ...state.meta }; delete nextMeta[folder];
            const nextWhitelist = normalizeWhitelist({ ...state.whitelist, frontend: state.whitelist.frontend.filter(id => id !== folder) });
            try {
                if (state.backend.available) await saveServerMeta(nextMeta, state.settings, state.backendMeta, nextWhitelist);
                else { state.meta = writeLocalFrontendMeta(nextMeta, true); state.whitelist = nextWhitelist; }
            } catch (error) {
                state.meta = normalizeMeta(nextMeta);
                state.whitelist = nextWhitelist;
                writeLocalFrontendMeta(nextMeta);
                if (window.toastr) toastr.warning(extension.displayName + " 已删除，但资料记录清理失败：" + (error.message || error));
            }
            try { removeExtensionUiEntries(extension); }
            catch (error) { if (window.toastr) toastr.warning(extension.displayName + " 已删除，但入口和运行时清理失败：" + (error.message || error)); }
            state.selectedExtensions.delete(folder);
            whitelistState.selected.delete(folder);
            detectionResults.selected.delete(folder);
            state.updates.delete(folder);
            state.checkingExtensions.delete(folder);
            state.updating.delete(folder);
            state.togglingExtensions.delete(folder);
            try { await discover({ freshManifests: true }); }
            catch (error) {
                state.extensions = state.extensions.filter(item => folderOf(item) !== folder);
                if (window.toastr) toastr.warning(extension.displayName + " 已删除，但扩展列表重读失败：" + (error.message || error));
            }
            if (!options.quiet && window.toastr) toastr.success(extension.displayName + " 已卸载并热清理，无需刷新网页");
            return true;
        } catch (error) {
            if (stoppedForUninstall) {
                try { await toggleExtensionHot(extension, true); } catch (restoreError) {}
            }
            if (window.toastr) toastr.error(extension.displayName + " 卸载失败：" + (error.message || error));
            return false;
        } finally {
            state.uninstalling.delete(folder);
            renderList($popup);
            if (whitelistState.scope === "frontend") renderWhitelistPanel($popup);
            if (detectionResults.active) renderDetectionResults($popup);
        }
    }

    async function uninstallFrontendExtensionsSequentially(extensions, $popup, options = {}) {
        const targets = (extensions || []).filter(extension => isExternal(extension) && typeOf(extension) !== "system" && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) { if (window.toastr) toastr.warning("内置扩展或扩展管理器本体不允许删除，以免出现不可逆错误"); return; }
        if (!options.confirmed && !window.confirm("确认卸载选中的 " + targets.length + " 个前端扩展？此操作会删除扩展文件，且无法撤销。")) return;
        state.batchUpdating = true;
        renderList($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                const extension = targets[index];
                $popup.find(".em-batch-update-status, .em-frontend-update-status").text("正在卸载 " + (index + 1) + " / " + targets.length + "：" + extension.displayName);
                if (await uninstallFrontendExtension(extension, $popup, { confirmed: true, quiet: true })) completed += 1;
            }
            if (window.toastr) toastr.success("前端扩展卸载完成：" + completed + " / " + targets.length + "，已热清理");
        } finally { state.batchUpdating = false; renderList($popup); }
    }

    async function uninstallFrontendGroup(group, $popup) {
        const targets = state.extensions.filter(extension => isExternal(extension) && typeOf(extension) !== "system" && groupOf(extension) === group && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) { if (window.toastr) toastr.info("此分组没有可卸载的前端扩展"); return; }
        if (!window.confirm("确认卸载分组“" + group + "”内的 " + targets.length + " 个前端扩展？此操作无法撤销。")) return;
        await uninstallFrontendExtensionsSequentially(targets, $popup, { confirmed: true });
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
        const expanded = Boolean(state.filter.trim()) || state.expandedGroups.has(group) || state.groupPicker === group;
        const custom = group !== '内置' && group !== '未分组';
        const groupBusy = state.groupAction.group === group;
        const groupAvailable = extensions.some(extension => isExternal(extension) && !isFrontendWhitelisted(extension) && state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        const groupWhitelistable = group !== '内置' && state.extensions.some(extension => isExternal(extension) && groupOf(extension) === group && !isFrontendWhitelisted(extension));
        const groupUpdate = groupAvailable || (groupBusy && state.groupAction.phase === 'updating') ? `<button type="button" class="em-icon em-group-update" data-group="${escapeHtml(group)}" title="更新此分组" aria-label="更新 ${escapeHtml(group)}" ${state.checking || state.batchUpdating ? 'disabled' : ''}><i class="fa-solid ${groupBusy && state.groupAction.phase === 'updating' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i></button>` : '';
        const groupCheck = group === '内置' ? '' : `<button type="button" class="em-icon em-group-check" data-group="${escapeHtml(group)}" title="检测此分组" aria-label="检测 ${escapeHtml(group)}" ${state.checking || state.batchUpdating ? 'disabled' : ''}><i class="fa-solid ${groupBusy && state.groupAction.phase === 'checking' ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}"></i></button>`;
        const groupUninstall = group === "内置" ? `<button type="button" class="em-icon muted" disabled title="内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-lock"></i></button>` : `<button type="button" class="em-icon em-group-uninstall" data-group="${escapeHtml(group)}" title="卸载此分组扩展" aria-label="卸载分组扩展"><i class="fa-solid fa-trash"></i></button>`;
        const groupWhitelist = state.backend.supportsWhitelist && groupWhitelistable ? `<button type="button" class="em-icon em-group-whitelist" data-group="${escapeHtml(group)}" title="整组加入白名单" aria-label="将前端分组 ${escapeHtml(group)} 整组加入白名单" ${state.checking || state.batchUpdating || state.batchToggling ? 'disabled' : ''}><i class="fa-solid fa-shield-halved"></i></button>` : '';
        const actions = custom
            ? `${groupCheck}${groupUpdate}${groupWhitelist}<div class="em-group-actions"><button type="button" class="em-icon em-group-add" data-group="${escapeHtml(group)}" title="添加扩展" aria-label="向 ${escapeHtml(group)} 添加扩展"><i class="fa-solid fa-folder-plus"></i></button><button type="button" class="em-icon em-group-rename" data-group="${escapeHtml(group)}" title="重命名分组" aria-label="重命名分组"><i class="fa-solid fa-pen"></i></button><button type="button" class="em-icon em-group-dissolve" data-group="${escapeHtml(group)}" title="解散分组" aria-label="解散分组"><i class="fa-solid fa-folder-minus"></i></button></div>${groupUninstall}`
            : `${groupCheck}${groupUpdate}${groupWhitelist}${group === "内置" ? `<button type="button" class="em-icon muted" disabled title="内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-lock"></i></button>` : `<button type="button" class="em-icon em-group-uninstall" data-group="${escapeHtml(group)}" title="卸载此分组扩展" aria-label="卸载分组扩展"><i class="fa-solid fa-trash"></i></button>`}`;
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
        const availableCount = state.extensions.filter(extension => isExternal(extension) && !isFrontendWhitelisted(extension) && state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase()).length;
        const frontendStatus = state.detectionMessage ? state.detectionMessage : (state.checking ? `正在检测前端扩展 ${state.frontendCheckProgress.completed} / ${state.frontendCheckProgress.total}` : (state.batchUpdating ? "正在更新前端扩展" : (availableCount ? `发现 ${availableCount} 个扩展可更新` : (state.extensions.length ? "检测后显示可用更新" : "正在读取扩展"))));
        $popup.find(".em-frontend-update-status").text(frontendStatus).toggleClass("update", availableCount > 0);
        $popup.find(".em-check-all").prop("disabled", state.checking || state.batchUpdating || state.batchToggling).html(state.checking ? `<i class="fa-solid fa-spinner fa-spin"></i> 检测中 ${state.frontendCheckProgress.completed} / ${state.frontendCheckProgress.total}` : `<i class="fa-solid fa-magnifying-glass"></i> 检测更新`);
        $popup.find(".em-update-all").prop("hidden", !availableCount).prop("disabled", state.checking || state.batchUpdating || state.batchToggling).html(state.batchUpdating ? `<i class="fa-solid fa-spinner fa-spin"></i> 更新中` : `<i class="fa-solid fa-cloud-arrow-down"></i> 更新全部`);
        syncSearchInput($popup.find('.em-search'), state.filter);
        $popup.find('.em-frontend-search-clear').prop('hidden', !state.filter);
        $popup.find('.em-sort').val(state.sort);
        $popup.find('#em-list').html(html);
        $popup.find('#em-count').text(`${list.length} / ${state.extensions.length}`);
        const failedCount = failedFrontendExtensions().length;
        $popup.find('.em-retry-frontend').prop('hidden', failedCount === 0).prop('disabled', state.checking).html(state.checking ? '<i class="fa-solid fa-spinner fa-spin"></i> 重试中' : '<i class="fa-solid fa-rotate-right"></i> 重试失败' + (failedCount ? ' (' + failedCount + ')' : ''));
        renderBatchSelection($popup);
    }

    async function updateExtensionGroups(assignments) {
        const nextMeta = { ...state.meta };
        Object.entries(assignments || {}).forEach(([folder, group]) => {
            const current = nextMeta[folder] && typeof nextMeta[folder] === 'object' ? nextMeta[folder] : {};
            const item = { name: String(current.name || ''), note: String(current.note || ''), category: String(group || '').trim() };
            if (item.name || item.note || item.category) nextMeta[folder] = item;
            else delete nextMeta[folder];
        });
        await saveFrontendMeta(nextMeta);
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
        const uninstallable = external.filter(extension => folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        const ignored = external.filter(isFrontendWhitelisted);
        const whitelistable = external.filter(extension => !isFrontendWhitelisted(extension));
        const active = whitelistable;
        const detected = active.filter(extension => state.updates.has(folderOf(extension)));
        const undetected = active.length - detected.length;
        const available = active.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        const customGroups = Array.from(new Set(state.extensions.map(groupOf).filter(group => !['内置', '未分组'].includes(group)))).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
        const groupOptions = ['<option value="">未分组</option>', ...customGroups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`), '<option value="__new__">新建分组...</option>'].join('');
        const enabledSelected = external.filter(extension => extension.enabled);
        const disabledSelected = external.filter(extension => !extension.enabled);
        const busy = state.batchUpdating || state.batchToggling || state.checking;
        const updateDisabled = busy || !available.length || undetected > 0;
        const status = selected.length
            ? `已选 ${selected.length} 个 · 已检测 ${detected.length} 个${available.length ? ` · 可更新 ${available.length} 个` : ''}${undetected ? ` · 未检测 ${undetected} 个` : ''}${ignored.length ? ` · 已忽略 ${ignored.length} 个` : ''}`
            : '请选择扩展';
        $toolbar.html(`<div class="em-batch-summary"><strong>批量操作</strong><span>${status}</span></div><div class="em-batch-controls"><button type="button" class="em-action em-select-visible"><i class="fa-solid fa-list-check"></i> 全选当前</button><button type="button" class="em-action em-clear-selection" ${selected.length ? '' : 'disabled'}><i class="fa-solid fa-xmark"></i> 清空</button><select class="em-batch-group" aria-label="目标分组">${groupOptions}</select><button type="button" class="em-action em-batch-group-save" ${selected.length ? '' : 'disabled'}><i class="fa-solid fa-folder-plus"></i> 分组</button><button type="button" class="em-action em-enable-selected" ${disabledSelected.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-toggle-on"></i> 启用选中</button><button type="button" class="em-action em-disable-selected" ${enabledSelected.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-toggle-off"></i> 禁用选中</button><button type="button" class="em-action em-whitelist-frontend-selected" ${whitelistable.length && !busy && state.backend.supportsWhitelist ? '' : 'disabled'}><i class="fa-solid fa-shield-halved"></i> 加入白名单</button><button type="button" class="em-action em-check-selected" ${active.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-magnifying-glass"></i> 检测选中</button><button type="button" class="em-action em-uninstall-selected" ${uninstallable.length && !busy ? "" : "disabled"} title="仅可卸载第三方扩展；内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-trash"></i> 卸载选中</button><button type="button" class="em-action primary em-update-selected" ${updateDisabled ? 'disabled' : ''} title="${undetected ? '请先检测全部选中扩展' : (available.length ? '更新检测到的新版本' : '没有检测到可用更新')}"><i class="fa-solid fa-cloud-arrow-down"></i> 更新选中</button></div><div class="em-batch-update-status"></div>`);
        $toolbar.toggleClass("em-processing", busy);
        $toolbar.attr("data-action", state.batchAction || "");
    }

    function renderErrorDetails(error, scope, id) {
        if (!error) return '';
        return `<div class="em-detection-error"><button type="button" class="em-action em-error-toggle" aria-expanded="false"><i class="fa-solid fa-circle-exclamation"></i> 查看报错</button><div class="em-error-details" hidden><pre>${escapeHtml(error)}</pre><button type="button" class="em-action em-copy-error" data-error-scope="${escapeHtml(scope)}" data-error-id="${escapeHtml(id)}"><i class="fa-solid fa-copy"></i> 一键复制报错</button></div></div>`;
    }

    function buildErrorReport(scope, id) {
        if (scope === 'backend') {
            const plugin = backendUpdateState.plugins.find(item => item.id === id);
            if (!plugin) return '';
            const commit = plugin.shortCommitHash || String(plugin.currentCommitHash || '').slice(0, 8) || '未知';
            return ['扩展管理器版本：v' + SCRIPT_VERSION, '类型：后端插件', '插件：' + plugin.name, '插件版本：' + (plugin.version || '未知'), '提交：' + commit, '错误：' + (plugin.error || '未知错误')].join('\n');
        }
        const extension = state.extensions.find(item => folderOf(item) === id);
        const update = state.updates.get(id) || {};
        if (!extension) return '';
        const commit = update.shortCommitHash || String(update.currentCommitHash || '').slice(0, 8) || '未知';
        return ['扩展管理器版本：v' + SCRIPT_VERSION, '类型：前端扩展', '插件：' + extension.displayName, '插件版本：' + (extension.version || '未知'), '提交：' + commit, '错误：' + (update.error || '未知错误')].join('\n');
    }

    function renderFaqInline(value) {
        const codeTokens = [];
        const tick = String.fromCharCode(96);
        const codePattern = new RegExp(tick + '([^' + tick + '\n]+)' + tick, 'g');
        let output = String(value || '').replace(codePattern, (_match, code) => {
            const token = '\uE000' + codeTokens.length + '\uE001';
            codeTokens.push('<code>' + code + '</code>');
            return token;
        });
        output = output
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_\n]+)__/g, '<u>$1</u>')
            .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
            .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
        return output.replace(/\uE000(\d+)\uE001/g, (_match, index) => codeTokens[Number(index)] || '');
    }

    function renderFaqSolution(value) {
        return escapeHtml(value).split(/\n{2,}/).map(block => {
            const lines = block.split('\n');
            const quote = lines.length > 0 && lines.every(line => /^&gt;(?:\s|$)/.test(line));
            const content = lines.map(line => renderFaqInline(quote ? line.replace(/^&gt;\s?/, '') : line)).join('<br>');
            return quote ? '<blockquote>' + content + '</blockquote>' : '<p>' + content + '</p>';
        }).join('');
    }

    function renderFaqItems() {
        return FAQ_ITEMS.map(item => `<article class="em-faq-item" data-faq-id="${escapeHtml(item.id)}"><button type="button" class="em-faq-question" aria-expanded="false"><span><i class="fa-solid fa-circle-question"></i> ${escapeHtml(item.title)}</span><i class="fa-solid fa-chevron-right em-faq-chevron"></i></button><div class="em-faq-answer" hidden><div class="em-faq-post-label">解决方案</div><div class="em-faq-rich">${renderFaqSolution(item.solution)}</div></div></article>`).join('');
    }

    function renderChangelogItems() {
        return CHANGELOG_ITEMS.map(item => `<article class="em-faq-item em-changelog-item" data-changelog-id="${escapeHtml(item.id)}"><button type="button" class="em-faq-question" aria-expanded="false"><span><i class="fa-solid fa-clock-rotate-left"></i> <strong>${escapeHtml(item.version)} · ${escapeHtml(item.title)}</strong></span><span class="em-changelog-date">${escapeHtml(item.date)}</span><i class="fa-solid fa-chevron-right em-faq-chevron"></i></button><div class="em-faq-answer" hidden><div class="em-faq-post-label">${escapeHtml(item.summary)}</div><div class="em-faq-rich">${renderFaqSolution(item.content)}</div></div></article>`).join('');
    }

    function renderTutorialHome() {

        const categories = TUTORIAL_SECTIONS.map(section => `<article class="em-faq-item em-tutorial-category-item"><button type="button" class="em-faq-question em-tutorial-open-category" data-tutorial-section="${escapeHtml(section.id)}"><span><i class="fa-solid ${escapeHtml(section.icon)}"></i><strong>${escapeHtml(section.title)}</strong></span><span class="em-tutorial-category-meta">${section.items.length} 项 <i class="fa-solid fa-chevron-right"></i></span></button></article>`).join('');
        return `<div class="em-whitelist-head"><button type="button" class="em-icon em-tutorial-back" title="返回安装扩展" aria-label="返回安装扩展"><i class="fa-solid fa-arrow-left"></i></button><div><strong>新手教程</strong><span>选择类别后查看具体操作</span></div></div><div class="em-tutorial-list">${categories}</div>`;
    }

    function renderTutorialCategory(sectionId) {
        const section = TUTORIAL_SECTIONS.find(item => item.id === sectionId);
        if (!section) return renderTutorialHome();
        const items = section.items.map((item, index) => `<article class="em-faq-item em-tutorial-item" data-tutorial-id="${escapeHtml(section.id)}-${index}"><button type="button" class="em-faq-question" aria-expanded="false"><span><i class="fa-solid fa-book-open"></i> ${escapeHtml(item.title)}</span><i class="fa-solid fa-chevron-right em-faq-chevron"></i></button><div class="em-faq-answer" hidden><div class="em-faq-post-label">操作说明</div><div class="em-faq-rich">${renderFaqSolution(item.content)}</div></div></article>`).join('');
        return `<div class="em-whitelist-head"><button type="button" class="em-icon em-tutorial-category-back" title="返回教程类别" aria-label="返回教程类别"><i class="fa-solid fa-arrow-left"></i></button><div><strong>${escapeHtml(section.title)}</strong><span>点击具体问题展开操作方法</span></div></div><div class="em-faq-list">${items}</div>`;
    }

    function renderCard(extension, options = {}) {
        const whitelistView = options?.whitelistView === true;
        const resultView = options?.resultView === true;
        const folder = folderOf(extension);
        const uninstalling = state.uninstalling.has(folder);
        const update = state.updates.get(folder) || {};
        const checking = state.checkingExtensions.has(folder);
        const updating = state.updating.has(folder);
        const toggling = state.togglingExtensions.has(folder);
        const whitelisted = isFrontendWhitelisted(folder);
        const ignored = whitelisted && !whitelistView && !resultView;
        const available = !ignored && update.isUpToDate === false;
        const repo = repoUrl(extension);
        const githubAuthor = githubAuthorFromRepository(repo);
        const branch = update.currentBranchName || '未检测';
        const commit = update.shortCommitHash || update.currentCommitHash?.slice(0, 8) || '';
        const typeLabel = { global: '全局', local: '当前用户', system: '内置' }[typeOf(extension)] || typeOf(extension);
        const status = uninstalling ? '卸载中' : ignored ? '已忽略' : updating ? '更新中' : checking ? '检测中' : toggling ? '处理中' : !extension.enabled ? '已禁用' : update.error ? '检测失败' : available ? '有更新' : update.isUpToDate === true ? '已是最新' : '未检测';
        const safeRepo = escapeHtml(repo);
        const group = groupOf(extension);
        const groupInput = typeOf(extension) === 'system'
            ? '<input class="em-category-input" value="内置" disabled>'
            : `<input class="em-category-input" value="${escapeHtml(extension.category || '')}" maxlength="80" placeholder="输入名称即可形成分组文件夹">`;
        const selected = state.selectedExtensions.has(folder);
        const whitelistSelected = whitelistState.selected.has(folder);
        const resultSelected = detectionResults.selected.has(folder);
        const cardSelected = resultView ? resultSelected : (whitelistView ? whitelistSelected : selected);
        const uninstallProtected = typeOf(extension) === "system" || folder.toLowerCase() === getInstalledExtensionName().toLowerCase();
        const uninstallAction = uninstallProtected ? `<button type="button" class="em-action muted" disabled title="内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-lock"></i> 内置扩展不可删除</button>` : `<button type="button" class="em-action em-uninstall" data-folder="${escapeHtml(folder)}" ${uninstalling ? "disabled" : ""}><i class="fa-solid ${uninstalling ? "fa-spinner fa-spin" : "fa-trash"}"></i> ${uninstalling ? "卸载中" : "卸载"}</button>`;
        const leading = resultView && detectionResults.selectionMode && !uninstallProtected
            ? `<label class="em-card-choice ${resultSelected ? 'is-selected' : ''}" title="选择 ${escapeHtml(extension.displayName)}"><input class="em-result-card-choice" type="checkbox" data-result-id="${escapeHtml(folder)}" ${resultSelected ? 'checked' : ''}><i class="fa-solid fa-check"></i></label>`
            : whitelistView && whitelistState.selectionMode && !uninstallProtected
            ? `<label class="em-card-choice ${whitelistSelected ? 'is-selected' : ''}" title="选择 ${escapeHtml(extension.displayName)}"><input class="em-whitelist-card-choice" type="checkbox" data-whitelist-id="${escapeHtml(folder)}" ${whitelistSelected ? 'checked' : ''}><i class="fa-solid fa-check"></i></label>`
            : state.selectionMode && !uninstallProtected
                ? `<label class="em-card-choice ${selected ? 'is-selected' : ''}" title="选择 ${escapeHtml(extension.displayName)}"><input type="checkbox" data-folder="${escapeHtml(folder)}" ${selected ? 'checked' : ''}><i class="fa-solid fa-check"></i></label>`
            : '<div class="em-card-icon"><i class="fa-solid fa-puzzle-piece"></i></div>';
        return `<article class="em-card ${available ? 'is-update' : ''} ${update.error ? 'is-error' : ''} ${ignored ? 'is-ignored' : ''} ${extension.enabled ? '' : 'is-disabled'} ${cardSelected ? 'is-selected' : ''}" data-folder="${escapeHtml(folder)}">
            ${leading}
            <div class="em-card-body">
                <div class="em-card-head"><div class="em-card-title">${escapeHtml(extension.displayName)} <span class="em-type">${escapeHtml(typeLabel)}</span>${group !== '未分组' ? ` <span class="em-category">${escapeHtml(group)}</span>` : ''}</div><span class="em-status ${update.error ? 'error' : (available ? 'update' : (ignored ? 'ignored' : ''))}">${escapeHtml(status)}</span></div>
                <div class="em-card-sub"><span class="em-private">${escapeHtml(folder)}</span> · GitHub作者：<span class="em-private">${escapeHtml(githubAuthor ? `@${githubAuthor}` : '未知')}</span> · 版本：${escapeHtml(extension.version ? `v${extension.version}` : '未知')} · 提交：<span class="em-private">${escapeHtml(commit || '检测后显示')}</span> · 分支：${escapeHtml(branch)}</div>
                <div class="em-card-note">${escapeHtml(extension.description)}</div>
                <div class="em-card-actions">
                    ${repo ? `<a class="em-action" href="${safeRepo}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-code-branch"></i> 仓库</a>` : '<span class="em-action muted"><i class="fa-solid fa-code-branch"></i> 暂无仓库</span>'}
                    ${resultView ? '' : (whitelistView ? '' : `<button type="button" class="em-action em-edit" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-tags"></i> 中文资料与分组</button>`)}
                    ${resultView ? `<button type="button" class="em-action em-result-check-one" data-result-id="${escapeHtml(folder)}" ${checking || updating ? 'disabled' : ''}><i class="fa-solid ${checking ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}"></i> ${checking ? '检测中' : '检测'}</button>${available || updating ? `<button type="button" class="em-action primary em-result-update-one" data-result-id="${escapeHtml(folder)}" ${updating ? 'disabled' : ''}><i class="fa-solid ${updating ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${updating ? '更新中' : '更新'}</button>` : ''}<button type="button" class="em-action em-result-toggle-one" data-result-id="${escapeHtml(folder)}" data-enable="${extension.enabled ? 'false' : 'true'}" ${toggling ? 'disabled' : ''}><i class="fa-solid ${toggling ? 'fa-spinner fa-spin' : 'fa-power-off'}"></i> ${toggling ? '处理中' : (extension.enabled ? '禁用' : '启用')}</button>` : (whitelistView ? `<button type="button" class="em-action em-whitelist-check-frontend" data-folder="${escapeHtml(folder)}" ${checking || updating ? 'disabled' : ''}><i class="fa-solid ${checking ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}"></i> ${checking ? '检测中' : '检测'}</button>${available || updating ? `<button type="button" class="em-action primary em-whitelist-update-frontend" data-folder="${escapeHtml(folder)}" ${updating ? 'disabled' : ''}><i class="fa-solid ${updating ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${updating ? '更新中' : '更新'}</button>` : ''}<button type="button" class="em-action em-whitelist-remove-one" data-scope="frontend" data-whitelist-id="${escapeHtml(folder)}"><i class="fa-solid fa-shield"></i> 移出白名单</button>` : (isExternal(extension) ? `<button type="button" class="em-action em-toggle" data-folder="${escapeHtml(folder)}" data-enable="${extension.enabled ? 'false' : 'true'}" ${toggling ? 'disabled' : ''}><i class="fa-solid ${toggling ? 'fa-spinner fa-spin' : 'fa-power-off'}"></i> ${toggling ? '处理中' : (extension.enabled ? '禁用' : '启用')}</button>${whitelisted ? '<span class="em-action muted"><i class="fa-solid fa-shield-halved"></i> 白名单</span>' : `<button type="button" class="em-action em-check" data-folder="${escapeHtml(folder)}" ${checking || updating ? 'disabled' : ''}><i class="fa-solid ${checking ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}"></i> ${checking ? '检测中' : '检查'}</button>${available || updating ? `<button type="button" class="em-action primary em-update" data-folder="${escapeHtml(folder)}" ${updating ? 'disabled' : ''}><i class="fa-solid ${updating ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${updating ? '更新中' : '更新'}</button>` : ''}`}` : ''))}
                    ${uninstallAction}
                </div>
                ${renderErrorDetails(update.error, 'frontend', folder)}
                <div class="em-editor" data-editor="${escapeHtml(folder)}" hidden><label>中文名<input class="em-name-input" value="${escapeHtml(extension.zhName || '')}" maxlength="80"></label><label>分组${groupInput}</label><label>备注<textarea class="em-note-input" maxlength="500">${escapeHtml(extension.note || '')}</textarea></label><button type="button" class="em-save-meta primary" data-folder="${escapeHtml(folder)}"><i class="fa-solid fa-floppy-disk"></i> 保存</button></div>
            </div>
        </article>`;
    }

    function detectionResultEntities() {
        if (detectionResults.scope === 'backend') {
            const byId = new Map(backendUpdateState.plugins.map(plugin => [plugin.id, plugin]));
            return detectionResults.ids.map(id => byId.get(id)).filter(Boolean);
        }
        const byId = new Map(state.extensions.map(extension => [folderOf(extension), extension]));
        return detectionResults.ids.map(id => byId.get(id)).filter(Boolean);
    }

    function detectionResultRank(entity) {
        return detectionResults.scope === 'backend' ? backendStatusRank(entity) : frontendStatusRank(entity);
    }

    function filteredDetectionResults() {
        const filter = detectionResults.filter.trim().toLowerCase();
        return detectionResultEntities().filter(entity => {
            if (!filter) return true;
            if (detectionResults.scope === 'backend') return [entity.name, entity.nativeName, entity.id, entity.githubAuthor, entity.description].join(' ').toLowerCase().includes(filter);
            return [entity.displayName, folderOf(entity), entity.description, repoUrl(entity)].join(' ').toLowerCase().includes(filter);
        }).sort((a, b) => compareDetectionResults(a, b));
    }

    function compareDetectionResults(a, b) {
        const nameA = detectionResults.scope === 'backend' ? a.name : a.displayName;
        const nameB = detectionResults.scope === 'backend' ? b.name : b.displayName;
        const nameCompare = () => String(nameA).localeCompare(String(nameB), 'zh-Hans', { numeric: true }) || String(detectionResults.scope === 'backend' ? a.id : folderOf(a)).localeCompare(String(detectionResults.scope === 'backend' ? b.id : folderOf(b)));
        if (detectionResults.sort === 'enabled' && detectionResults.scope === 'frontend') return enabledSortRank(a) - enabledSortRank(b) || nameCompare();
        if (detectionResults.sort === 'updated') {
            const timeA = detectionResults.scope === 'backend' ? backendUpdatedTimestamp(a) : extensionUpdatedTimestamp(a);
            const timeB = detectionResults.scope === 'backend' ? backendUpdatedTimestamp(b) : extensionUpdatedTimestamp(b);
            return timeB - timeA || nameCompare();
        }
        if (detectionResults.sort === 'name') return nameCompare();
        const statusCompare = detectionResultRank(a) - detectionResultRank(b);
        const enabledCompare = detectionResults.scope === 'frontend' ? enabledSortRank(a) - enabledSortRank(b) : 0;
        return statusCompare || enabledCompare || nameCompare();
    }

    function detectionResultCounts(entities = detectionResultEntities()) {
        const failed = entities.filter(entity => detectionResultRank(entity) === 0).length;
        const available = entities.filter(entity => detectionResultRank(entity) === 1 && (detectionResults.scope !== 'frontend' || folderOf(entity).toLowerCase() !== getInstalledExtensionName().toLowerCase())).length;
        const latest = entities.filter(entity => detectionResultRank(entity) === 2).length;
        return { failed, available, latest };
    }

    function openDetectionResults(scope, ids, $popup, options = {}) {
        const normalizedScope = scope === 'backend' ? 'backend' : 'frontend';
        const existing = new Set((normalizedScope === 'backend' ? backendUpdateState.plugins.map(plugin => plugin.id) : state.extensions.map(folderOf)));
        const normalizedIds = Array.from(new Set(ids || [])).filter(id => existing.has(id));
        if (!normalizedIds.length) return;
        const activePanel = String($popup.find('.em-panel.active').attr('data-panel') || 'installed');
        detectionResults.active = true;
        detectionResults.scope = normalizedScope;
        detectionResults.ids = normalizedIds;
        detectionResults.filter = '';
        detectionResults.selected.clear();
        detectionResults.selectionMode = false;
        detectionResults.allowWhitelisted = options.allowWhitelisted === true;
        detectionResults.returnPanel = activePanel === 'results' ? detectionResults.returnPanel : (options.returnPanel || activePanel);
        detectionResults.title = String(options.title || (normalizedScope === 'backend' ? '后端插件检测结果' : '前端扩展检测结果'));
        detectionResults.action = '';
        detectionResults.message = '';
        $popup.find('.em-tab').removeClass('active');
        $popup.find('.em-panel').removeClass('active').filter('[data-panel="results"]').addClass('active');
        renderDetectionResults($popup);
        const content = $popup.find('.em-content')[0];
        if (content) content.scrollTop = 0;
    }

    function closeDetectionResults($popup) {
        const panel = detectionResults.returnPanel || (detectionResults.scope === 'backend' ? 'backend' : 'installed');
        detectionResults.active = false;
        detectionResults.selected.clear();
        detectionResults.selectionMode = false;
        detectionResults.filter = '';
        detectionResults.action = '';
        detectionResults.message = '';
        $popup.find('.em-panel').removeClass('active').filter('[data-panel="' + panel + '"]').addClass('active');
        $popup.find('.em-tab').removeClass('active');
        const tab = ['installed', 'backend', 'install'].includes(panel) ? panel : (panel === 'whitelist' || panel === 'faq' || panel === 'changelog' ? 'install' : 'installed');
        $popup.find('.em-tab[data-tab="' + tab + '"]').addClass('active');
        if (panel === 'whitelist') renderWhitelistPanel($popup);
        else if (panel === 'backend') renderBackendUpdate($popup);
        else if (panel === 'installed') renderList($popup);
        const content = $popup.find('.em-content')[0];
        if (content) content.scrollTop = 0;
    }

    function renderDetectionResultBatch($popup, entities) {
        const $toolbar = $popup.find('.em-results-batch-toolbar');
        const selected = entities.filter(entity => detectionResults.selected.has(detectionResults.scope === 'backend' ? entity.id : folderOf(entity)));
        const uninstallable = selected.filter(entity => detectionResults.scope === "backend" ? !isManagerBackendPlugin(entity) : typeOf(entity) !== "system" && folderOf(entity).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        const available = selected.filter(entity => detectionResultRank(entity) === 1 && (detectionResults.scope !== 'frontend' || folderOf(entity).toLowerCase() !== getInstalledExtensionName().toLowerCase()));
        const busy = detectionResults.scope === 'backend' ? backendUpdateState.batchUpdating || ['checking', 'updating', 'loading'].includes(backendUpdateState.phase) : state.checking || state.batchUpdating || state.batchToggling;
        const disabled = detectionResults.scope === 'frontend' ? selected.filter(entity => !entity.enabled) : [];
        const enabled = detectionResults.scope === 'frontend' ? selected.filter(entity => entity.enabled) : [];
        $popup.find('.em-results-multi-toggle').toggleClass('active', detectionResults.selectionMode).attr('aria-pressed', String(detectionResults.selectionMode)).find('span').text(detectionResults.selectionMode ? '退出多选' : '多选');
        $toolbar.prop('hidden', !detectionResults.selectionMode);
        if (!detectionResults.selectionMode) return;
        $toolbar.attr('data-action', detectionResults.action || (detectionResults.scope === 'backend' && backendUpdateState.phase === 'checking' ? 'checking' : (detectionResults.scope === 'backend' && backendUpdateState.phase === 'updating' ? 'updating' : '')));
        $toolbar.toggleClass('em-processing', busy);
        const uninstallButton = '<button type="button" class="em-action em-results-uninstall-selected"' + (uninstallable.length && !busy ? '' : ' disabled') + ' title="仅可卸载第三方扩展；内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-trash"></i> 卸载选中</button>';
        $toolbar.html('<div class="em-batch-summary"><strong>本批多选</strong><span>' + (selected.length ? '已选 ' + selected.length + ' 个' + (available.length ? ' · 可更新 ' + available.length + ' 个' : '') : '请选择插件') + '</span></div><div class="em-batch-controls"><button type="button" class="em-action em-results-select-visible"><i class="fa-solid fa-list-check"></i> 全选当前</button><button type="button" class="em-action em-results-clear"' + (selected.length ? '' : ' disabled') + '><i class="fa-solid fa-xmark"></i> 清空</button>' + (detectionResults.scope === 'frontend' ? '<button type="button" class="em-action em-results-enable-selected"' + (disabled.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-toggle-on"></i> 启用选中</button><button type="button" class="em-action em-results-disable-selected"' + (enabled.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-toggle-off"></i> 禁用选中</button>' : '') + '<button type="button" class="em-action em-results-check-selected"' + (selected.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-magnifying-glass"></i> 检测选中</button>' + uninstallButton + '<button type="button" class="em-action primary em-results-update-selected"' + (available.length && !busy ? '' : ' disabled') + '><i class="fa-solid fa-cloud-arrow-down"></i> 更新选中</button></div><div class="em-results-batch-status"></div>');
        $toolbar.find('.em-results-batch-status').text(detectionResults.message);
    }

    function renderDetectionResults($popup) {
        if (!detectionResults.active) return;
        const all = detectionResultEntities();
        const visible = filteredDetectionResults();
        const validIds = new Set(all.map(entity => detectionResults.scope === 'backend' ? entity.id : folderOf(entity)));
        Array.from(detectionResults.selected).forEach(id => { if (!validIds.has(id)) detectionResults.selected.delete(id); });
        const counts = detectionResultCounts(all);
        const busy = detectionResults.scope === 'backend' ? backendUpdateState.batchUpdating || ['checking', 'updating', 'loading'].includes(backendUpdateState.phase) : state.checking || state.batchUpdating || state.batchToggling;
        syncSearchInput($popup.find('.em-results-search'), detectionResults.filter);
        $popup.find('.em-results-search-clear').prop('hidden', !detectionResults.filter);
        $popup.find('.em-results-title').text(detectionResults.title);
        $popup.find('.em-results-summary').text('本批 ' + all.length + ' 个 · 检测失败 ' + counts.failed + ' 个 · 可更新 ' + counts.available + ' 个 · 最新 ' + counts.latest + ' 个');
        $popup.find('.em-results-status').text(busy ? (detectionResults.message || (detectionResults.scope === 'backend' ? backendUpdateState.message : (state.batchUpdating ? '正在依次热更新前端扩展' : (state.batchToggling ? '正在处理本批前端扩展' : '正在检测本批前端扩展')))) : '失败项标红置顶，可更新项标绿排列其后');
        $popup.find('.em-results-count').text(visible.length + ' / ' + all.length);
        $popup.find('.em-results-sort').val(detectionResults.sort);
        $popup.find('.em-results-recheck').prop('disabled', busy || !all.length).html((detectionResults.scope === 'backend' ? backendUpdateState.phase === 'checking' : state.checking) ? '<i class="fa-solid fa-spinner fa-spin"></i> 检测中' : '<i class="fa-solid fa-magnifying-glass"></i> 重新检测');
        $popup.find('.em-results-update-all').prop('hidden', counts.available === 0).prop('disabled', busy).html((detectionResults.scope === 'backend' ? backendUpdateState.batchUpdating : state.batchUpdating) ? '<i class="fa-solid fa-spinner fa-spin"></i> 更新中' : '<i class="fa-solid fa-cloud-arrow-down"></i> 更新全部');
        $popup.find('.em-results-list').html(visible.length ? visible.map(entity => detectionResults.scope === 'backend' ? renderBackendPluginCard(entity, { resultView: true }) : renderCard(entity, { resultView: true })).join('') : '<div class="em-empty"><i class="fa-solid fa-circle-check"></i><span>本次检测没有匹配的插件</span></div>');
        renderDetectionResultBatch($popup, all);
    }

    async function checkDetectionResultIds(ids, $popup) {
        const targets = Array.from(new Set(ids || [])).filter(id => detectionResults.ids.includes(id));
        if (!targets.length) return;
        if (detectionResults.scope === 'backend') {
            await checkBackendPlugins(targets, $popup, { allowWhitelisted: detectionResults.allowWhitelisted, showResults: false });
            backendUpdateState.statusSortActive = true;
            renderDetectionResults($popup);
            return;
        }
        if (state.checking || state.batchUpdating || state.batchToggling) return;
        const extensions = targets.map(id => state.extensions.find(extension => folderOf(extension) === id)).filter(Boolean);
        state.checking = true;
        state.frontendCheckProgress = { completed: 0, total: extensions.length };
        detectionResults.action = 'checking';
        beginDetection($popup);
        detectionResults.message = '正在检测 0 / ' + extensions.length;
        renderDetectionResults($popup);
        try {
            await mapDetectionTargets(extensions, async extension => {
                const result = await checkOne(extension, undefined, { allowWhitelisted: detectionResults.allowWhitelisted });
                state.frontendCheckProgress.completed += 1;
                detectionResults.message = '正在检测 ' + state.frontendCheckProgress.completed + ' / ' + extensions.length;
                renderDetectionResults($popup);
                return result;
            });
            state.statusSortActive = true;
        } finally {
            state.checking = false;
            detectionResults.action = '';
            detectionResults.message = '';
            renderList($popup);
            renderDetectionResults($popup);
            finishDetection($popup);
        }
    }

    async function updateDetectionResultIds(ids, $popup) {
        const selected = new Set(ids || []);
        if (detectionResults.scope === 'backend') {
            await updateBackendPluginsSequentially(detectionResults.ids.filter(id => selected.has(id)), $popup, { allowWhitelisted: detectionResults.allowWhitelisted });
            renderDetectionResults($popup);
            return;
        }
        if (state.batchUpdating || state.batchToggling || state.checking) return;
        const targets = detectionResultEntities().filter(extension => selected.has(folderOf(extension)) && state.updates.get(folderOf(extension))?.isUpToDate === false && folderOf(extension).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        if (!targets.length) { if (window.toastr) toastr.info('本次结果中没有可更新的前端扩展'); return; }
        state.batchUpdating = true;
        detectionResults.action = 'updating';
        renderDetectionResults($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                detectionResults.message = '正在更新 ' + (index + 1) + ' / ' + targets.length + '：' + targets[index].displayName;
                renderDetectionResults($popup);
                if (await updateOne(targets[index], $popup, { quiet: true, deferRender: true, deferSelectionRender: true, allowWhitelisted: detectionResults.allowWhitelisted })) completed += 1;
                renderDetectionResults($popup);
            }
            if (window.toastr) toastr.success('本批更新完成：' + completed + ' / ' + targets.length + '，已依次热加载');
        } finally {
            state.batchUpdating = false;
            detectionResults.action = '';
            detectionResults.message = '';
            renderList($popup);
            renderDetectionResults($popup);
        }
    }

    async function setDetectionResultEnabled(ids, enabled, $popup) {
        if (detectionResults.scope !== 'frontend' || state.batchToggling || state.batchUpdating || state.checking) return;
        const selected = new Set(ids || []);
        const targets = detectionResultEntities().filter(extension => selected.has(folderOf(extension)) && extension.enabled !== enabled);
        if (!targets.length) return;
        state.batchToggling = true;
        detectionResults.action = enabled ? 'enabling' : 'disabling';
        renderDetectionResults($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                const extension = targets[index];
                detectionResults.message = '正在' + (enabled ? '启用 ' : '禁用 ') + (index + 1) + ' / ' + targets.length + '：' + extension.displayName;
                state.togglingExtensions.add(folderOf(extension));
                renderDetectionResults($popup);
                try {
                    await toggleExtensionHot(extension, enabled);
                    completed += 1;
                } catch (error) { if (window.toastr) toastr.error(extension.displayName + ' 处理失败：' + (error.message || error)); }
                finally { state.togglingExtensions.delete(folderOf(extension)); }
            }
            if (window.toastr) toastr.success('批量' + (enabled ? '启用' : '禁用') + '完成：' + completed + ' / ' + targets.length + '，已在当前页面热切换');
        } finally {
            state.batchToggling = false;
            detectionResults.action = '';
            detectionResults.message = '';
            renderList($popup);
            renderDetectionResults($popup);
        }
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

    function whitelistInstalled(scope = whitelistState.scope) {
        if (scope === 'backend') {
            const allowed = new Set(state.whitelist.backend);
            return backendUpdateState.plugins.filter(plugin => allowed.has(plugin.id));
        }
        const allowed = new Set(state.whitelist.frontend);
        return state.extensions.filter(extension => isExternal(extension) && allowed.has(folderOf(extension)));
    }

    function whitelistEntries(scope = whitelistState.scope) {
        const installed = whitelistInstalled(scope);
        const byId = new Map(installed.map(item => [scope === 'backend' ? item.id : folderOf(item), item]));
        return state.whitelist[scope].map(id => {
            const entity = byId.get(id) || null;
            return {
                id,
                entity,
                name: entity ? (scope === 'backend' ? entity.name : entity.displayName) : id,
                detail: entity ? (scope === 'backend' ? (entity.description || entity.id) : (entity.description || folderOf(entity))) : '当前未检测到安装',
                group: entity ? (scope === 'backend' ? backendGroupOf(entity) : groupOf(entity)) : '未安装',
            };
        });
    }

    function knownWhitelistIds(scope) {
        const installedIds = scope === 'backend'
            ? backendUpdateState.plugins.map(plugin => plugin.id)
            : state.extensions.filter(isExternal).map(folderOf);
        return new Set([...installedIds, ...state.whitelist[scope]]);
    }

    async function changeWhitelist(scope, ids, add, $popup) {
        if (!['frontend', 'backend'].includes(scope)) return;
        const validIds = knownWhitelistIds(scope);
        const current = new Set(state.whitelist[scope]);
        const selectedIds = Array.from(new Set(ids || [])).filter(id => validIds.has(id) && (add ? !current.has(id) : current.has(id)));
        if (!selectedIds.length) {
            if (window.toastr) toastr.info(add ? '所选插件已在白名单中' : '所选插件不在白名单中');
            return;
        }
        selectedIds.forEach(id => add ? current.add(id) : current.delete(id));
        await saveWhitelist(normalizeWhitelist({ ...state.whitelist, [scope]: Array.from(current) }));
        selectedIds.forEach(id => whitelistState.selected.delete(id));
        if (scope === 'frontend') {
            selectedIds.forEach(folder => state.updates.delete(folder));
            if (selectedIds.includes(getInstalledExtensionName())) {
                selfUpdateState.canUpdate = false;
                selfUpdateState.phase = add ? 'ignored' : 'idle';
                selfUpdateState.message = add ? '本体已加入白名单，跳过更新检测' : '点击按钮检查本体更新';
            }
            renderList($popup);
            renderSelfUpdate($popup);
        } else {
            selectedIds.forEach(pluginId => {
                backendUpdateState.checkedPlugins.delete(pluginId);
                const plugin = backendUpdateState.plugins.find(item => item.id === pluginId);
                if (plugin && add) {
                    plugin.error = '';
                    plugin.updateSupported = null;
                    plugin.isUpToDate = null;
                }
            });
            renderBackendUpdate($popup);
        }
        renderWhitelistPanel($popup);
        renderInstallPanel($popup);
        if (window.toastr) toastr.success(`${add ? '已加入' : '已移出'}${scope === 'frontend' ? '前端' : '后端'}白名单：${selectedIds.length} 个`);
    }

    function whitelistStatusRank(entry, scope) {
        if (!entry.entity) return 4;
        if (scope === 'backend') {
            if (backendUpdateState.checkingPlugins.has(entry.id) || entry.entity.updating) return -1;
            if (entry.entity.error) return 0;
            if (backendUpdateState.checkedPlugins.has(entry.id) && entry.entity.isUpToDate === false) return 1;
            if (backendUpdateState.checkedPlugins.has(entry.id)) return 2;
            return 3;
        }
        const update = state.updates.get(entry.id);
        if (state.checkingExtensions.has(entry.id) || state.updating.has(entry.id)) return -1;
        if (update?.error) return 0;
        if (update?.isUpToDate === false) return 1;
        if (state.updates.has(entry.id)) return 2;
        return 3;
    }

    function filteredWhitelistEntries() {
        const scope = whitelistState.scope;
        const filter = whitelistState.filter.toLowerCase();
        return whitelistEntries(scope).filter(entry => {
            const matchesCategory = !whitelistState.category || entry.group === whitelistState.category;
            const matchesText = !filter || [entry.name, entry.id, entry.detail, entry.group].join(' ').toLowerCase().includes(filter);
            return matchesCategory && matchesText;
        }).sort((a, b) => compareWhitelistEntries(a, b));
    }

    function renderMissingWhitelistCard(entry) {
        const selected = whitelistState.selected.has(entry.id);
        const leading = whitelistState.selectionMode
            ? `<label class="em-card-choice ${selected ? 'is-selected' : ''}" title="选择 ${escapeHtml(entry.name)}"><input class="em-whitelist-card-choice" type="checkbox" data-whitelist-id="${escapeHtml(entry.id)}" ${selected ? 'checked' : ''}><i class="fa-solid fa-check"></i></label>`
            : '<div class="em-card-icon"><i class="fa-solid fa-circle-question"></i></div>';
        return `<article class="em-card is-disabled ${selected ? 'is-selected' : ''}" data-whitelist-id="${escapeHtml(entry.id)}">${leading}<div class="em-card-body"><div class="em-card-head"><div class="em-card-title">${escapeHtml(entry.name)}</div><span class="em-status">未安装</span></div><div class="em-card-sub"><span class="em-private">${escapeHtml(entry.id)}</span></div><div class="em-card-note">当前没有检测到此插件，可以保留记录或移出白名单。</div><div class="em-card-actions"><button type="button" class="em-action em-whitelist-remove-one" data-scope="${escapeHtml(whitelistState.scope)}" data-whitelist-id="${escapeHtml(entry.id)}"><i class="fa-solid fa-shield"></i> 移出白名单</button></div></div></article>`;
    }

    function renderWhitelistGroupPicker(group) {
        const scope = whitelistState.scope;
        const candidates = whitelistEntries(scope).filter(entry => entry.entity && entry.group !== group);
        const choices = candidates.length
            ? candidates.map(entry => `<label class="em-group-choice em-whitelist-group-choice"><input type="checkbox" data-whitelist-id="${escapeHtml(entry.id)}" ${whitelistState.groupPickerSelections.has(entry.id) ? 'checked' : ''}><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.group)}</small></span></label>`).join('')
            : '<div class="em-group-picker-empty">没有可添加的白名单插件</div>';
        return `<div class="em-group-picker"><div class="em-group-picker-list">${choices}</div><div class="em-group-picker-actions"><button type="button" class="em-action em-whitelist-group-cancel"><i class="fa-solid fa-xmark"></i> 取消</button><button type="button" class="em-action primary em-whitelist-group-add-save" data-group="${escapeHtml(group)}" ${candidates.length ? '' : 'disabled'}><i class="fa-solid fa-folder-plus"></i> 添加选中</button></div></div>`;
    }

    function renderWhitelistGroup(group, entries) {
        const scope = whitelistState.scope;
        const expandedSet = whitelistState.expandedGroups[scope];
        const expanded = Boolean(whitelistState.filter.trim()) || expandedSet.has(group) || whitelistState.groupPicker === group;
        const custom = !["内置", "未分组", "未安装"].includes(group);
        const groupBusy = whitelistState.groupAction.group === group;
        const groupOperationBusy = scope === "backend" ? backendUpdateState.batchUpdating || ["loading", "checking", "updating"].includes(backendUpdateState.phase) : state.checking || state.batchUpdating || state.batchToggling;
        const installed = entries.filter(entry => entry.entity);
        const groupAvailable = scope === 'backend'
            ? installed.some(entry => backendUpdateState.checkedPlugins.has(entry.id) && entry.entity.updateSupported === true && entry.entity.isUpToDate === false)
            : installed.some(entry => state.updates.get(entry.id)?.isUpToDate === false);
        const groupCheck = `<button type="button" class="em-icon em-whitelist-group-check" data-group="${escapeHtml(group)}" title="检测此分组" aria-label="检测白名单分组 ${escapeHtml(group)}" ${groupBusy || (scope === 'backend' ? ['loading', 'checking', 'updating'].includes(backendUpdateState.phase) : state.checking || state.batchUpdating) ? 'disabled' : ''}><i class="fa-solid ${groupBusy && whitelistState.groupAction.phase === 'checking' ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}"></i></button>`;
        const groupUpdate = groupAvailable || (groupBusy && whitelistState.groupAction.phase === 'updating') ? `<button type="button" class="em-icon em-whitelist-group-update" data-group="${escapeHtml(group)}" title="更新此分组" aria-label="更新白名单分组 ${escapeHtml(group)}" ${groupOperationBusy ? 'disabled' : ''}><i class="fa-solid ${groupBusy && whitelistState.groupAction.phase === 'updating' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i></button>` : '';
        const groupRemove = `<button type="button" class="em-icon em-whitelist-group-remove" data-group="${escapeHtml(group)}" title="整组移出白名单" aria-label="将白名单分组 ${escapeHtml(group)} 整组移出白名单" ${groupOperationBusy ? 'disabled' : ''}><i class="fa-solid fa-shield"></i></button>`;
        const groupUninstall = scope === "frontend" && group === "内置" ? `<button type="button" class="em-icon muted" disabled title="内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-lock"></i></button>` : `<button type="button" class="em-icon em-whitelist-group-uninstall" data-group="${escapeHtml(group)}" title="卸载此分组插件" aria-label="卸载白名单分组" ${installed.length && !groupOperationBusy ? "" : "disabled"}><i class="fa-solid fa-trash"></i></button>`;
        const actions = custom
            ? groupCheck + groupUpdate + groupRemove + `<div class="em-group-actions"><button type="button" class="em-icon em-whitelist-group-add" data-group="${escapeHtml(group)}" title="添加插件" aria-label="向 ${escapeHtml(group)} 添加插件"><i class="fa-solid fa-folder-plus"></i></button><button type="button" class="em-icon em-whitelist-group-rename" data-group="${escapeHtml(group)}" title="重命名分组" aria-label="重命名 ${escapeHtml(group)}"><i class="fa-solid fa-pen"></i></button><button type="button" class="em-icon em-whitelist-group-dissolve" data-group="${escapeHtml(group)}" title="解散分组" aria-label="解散 ${escapeHtml(group)}"><i class="fa-solid fa-folder-minus"></i></button></div>`
            : groupCheck + groupUpdate + groupRemove;
        const cards = entries.map(entry => {
            if (!entry.entity) return renderMissingWhitelistCard(entry);
            return scope === 'backend'
                ? renderBackendPluginCard(entry.entity, { whitelistView: true })
                : renderCard(entry.entity, { whitelistView: true });
        }).join('');
        const picker = whitelistState.groupPicker === group ? renderWhitelistGroupPicker(group) : '';
        const icon = group === '内置' ? 'fa-box-archive' : (expanded ? 'fa-folder-open' : 'fa-folder');
        return `<section class="em-group em-whitelist-group" data-whitelist-group="${escapeHtml(group)}"><header class="em-group-head"><button type="button" class="em-icon em-whitelist-group-toggle" data-group="${escapeHtml(group)}" title="${expanded ? '收起' : '展开'}分组" aria-label="${expanded ? '收起' : '展开'} ${escapeHtml(group)}" aria-expanded="${expanded}"><i class="fa-solid fa-chevron-${expanded ? 'down' : 'right'}"></i></button><i class="fa-solid ${icon} em-group-folder"></i><strong>${escapeHtml(group)}</strong><span class="em-group-count">${entries.length}</span>${groupUninstall}${actions}</header><div class="em-group-content" ${expanded ? '' : 'hidden'}><div class="em-group-cards">${cards}</div>${picker}</div></section>`;
    }

    function renderWhitelistCategoryOptions($popup, entries) {
        const categories = Array.from(new Set(entries.map(entry => entry.group))).sort((a, b) => {
            if (a === '内置') return -1;
            if (b === '内置') return 1;
            if (a === '未安装') return 1;
            if (b === '未安装') return -1;
            if (a === '未分组') return 1;
            if (b === '未分组') return -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        if (whitelistState.category && !categories.includes(whitelistState.category)) whitelistState.category = '';
        $popup.find('.em-whitelist-category').html(['<option value="">全部分组</option>', ...categories.map(group => `<option value="${escapeHtml(group)}" ${whitelistState.category === group ? 'selected' : ''}>${escapeHtml(group)}</option>`)].join(''));
    }

    function renderWhitelistBatchSelection($popup, allEntries) {
        const $toolbar = $popup.find('.em-whitelist-batch-toolbar');
        const selectedEntries = allEntries.filter(entry => whitelistState.selected.has(entry.id));
        const installed = selectedEntries.filter(entry => entry.entity);
        const uninstallable = installed.filter(entry => whitelistState.scope === "backend" ? !isManagerBackendPlugin(entry.entity) : typeOf(entry.entity) !== "system" && folderOf(entry.entity).toLowerCase() !== getInstalledExtensionName().toLowerCase());
        const scope = whitelistState.scope;
        const detected = installed.filter(entry => scope === 'backend' ? backendUpdateState.checkedPlugins.has(entry.id) : state.updates.has(entry.id));
        const available = installed.filter(entry => scope === 'backend'
            ? backendUpdateState.checkedPlugins.has(entry.id) && entry.entity.isUpToDate === false
            : state.updates.get(entry.id)?.isUpToDate === false);
        const undetected = installed.length - detected.length;
        const busy = scope === 'backend'
            ? backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase)
            : state.checking || state.batchUpdating || state.batchToggling;
        const groups = Array.from(new Set(allEntries.map(entry => entry.group).filter(group => !['内置', '未分组', '未安装'].includes(group)))).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
        const groupOptions = ['<option value="">未分组</option>', ...groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`), '<option value="__new__">新建分组...</option>'].join('');
        const enabled = scope === 'frontend' ? installed.filter(entry => entry.entity.enabled) : [];
        const disabled = scope === 'frontend' ? installed.filter(entry => !entry.entity.enabled) : [];
        const status = selectedEntries.length
            ? `已选 ${selectedEntries.length} 个 · 已检测 ${detected.length} 个${available.length ? ` · 可更新 ${available.length} 个` : ''}${undetected ? ` · 未检测 ${undetected} 个` : ''}`
            : '请选择白名单插件';
        $popup.find('.em-whitelist-multi-toggle').toggleClass('active', whitelistState.selectionMode).attr('aria-pressed', String(whitelistState.selectionMode)).find('span').text(whitelistState.selectionMode ? '退出多选' : '多选');
        $toolbar.prop('hidden', !whitelistState.selectionMode);
        if (!whitelistState.selectionMode) return;
        $toolbar.toggleClass("em-processing", busy);
        $toolbar.attr("data-action", whitelistState.batchAction || "");
        const uninstallButton = `<button type="button" class="em-action em-whitelist-uninstall-selected" ${uninstallable.length && !busy ? "" : "disabled"} title="仅可卸载第三方扩展；内置扩展不允许删除，以免出现不可逆错误"><i class="fa-solid fa-trash"></i> 卸载选中</button>`;
        $toolbar.html(`<div class="em-batch-summary"><strong>批量操作</strong><span>${status}</span></div><div class="em-batch-controls"><button type="button" class="em-action em-whitelist-select-visible"><i class="fa-solid fa-list-check"></i> 全选当前</button><button type="button" class="em-action em-whitelist-clear" ${selectedEntries.length ? '' : 'disabled'}><i class="fa-solid fa-xmark"></i> 清空</button><select class="em-batch-group em-whitelist-batch-group" aria-label="目标分组">${groupOptions}</select><button type="button" class="em-action em-whitelist-batch-group-save" ${installed.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-folder-plus"></i> 分组</button>${scope === 'frontend' ? `<button type="button" class="em-action em-whitelist-enable-selected" ${disabled.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-toggle-on"></i> 启用选中</button><button type="button" class="em-action em-whitelist-disable-selected" ${enabled.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-toggle-off"></i> 禁用选中</button>` : ''}<button type="button" class="em-action em-whitelist-remove-selected" ${selectedEntries.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-shield"></i> 移出白名单</button><button type="button" class="em-action em-whitelist-check-selected" ${installed.length && !busy ? '' : 'disabled'}><i class="fa-solid fa-magnifying-glass"></i> 检测选中</button>${uninstallButton}<button type="button" class="em-action primary em-whitelist-update-selected" ${busy || !available.length || undetected ? 'disabled' : ''} title="${undetected ? '请先检测全部选中插件' : (available.length ? '更新检测到的新版本' : '没有检测到可用更新')}"><i class="fa-solid fa-cloud-arrow-down"></i> 更新选中</button></div><div class="em-whitelist-batch-status"></div>`);
    }

    function failedWhitelistEntries(scope = whitelistState.scope) {
        return whitelistEntries(scope).filter(entry => {
            if (!entry.entity) return false;
            if (scope === 'backend') return backendUpdateState.checkedPlugins.has(entry.id) && Boolean(entry.entity.error);
            return Boolean(state.updates.get(entry.id)?.error);
        });
    }

    async function retryFailedWhitelist($popup) {
        const ids = failedWhitelistEntries().map(entry => entry.id);
        if (!ids.length) {
            if (window.toastr) toastr.info('当前白名单没有检测失败的插件');
            return;
        }
        await checkWhitelistPlugins(ids, $popup, { showResults: true, resultTitle: '白名单检测失败项重试结果' });
        const failed = failedWhitelistEntries().length;
        if (window.toastr) toastr.info(failed ? `重试完成，仍有 ${failed} 个白名单插件检测失败` : '白名单检测失败项已全部重试成功');
    }

    function renderWhitelistPanel($popup) {
        const scope = whitelistState.scope;
        const allEntries = whitelistEntries(scope);
        const visibleEntries = filteredWhitelistEntries();
        const validIds = new Set(allEntries.map(entry => entry.id));
        Array.from(whitelistState.selected).forEach(id => { if (!validIds.has(id)) whitelistState.selected.delete(id); });
        $popup.find('.em-whitelist-scope').each(function () {
            const active = String($(this).attr('data-scope')) === scope;
            $(this).toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
        });
        syncSearchInput($popup.find('.em-whitelist-search'), whitelistState.filter);
        $popup.find('.em-whitelist-search-clear').prop('hidden', !whitelistState.filter);
        $popup.find('.em-whitelist-sort').val(whitelistState.sort);
        renderWhitelistCategoryOptions($popup, allEntries);
        $popup.find('.em-whitelist-count').text(`${visibleEntries.length} / ${allEntries.length}`);
        const installed = allEntries.filter(entry => entry.entity);
        const detected = installed.filter(entry => scope === 'backend' ? backendUpdateState.checkedPlugins.has(entry.id) : state.updates.has(entry.id));
        const available = installed.filter(entry => scope === 'backend'
            ? backendUpdateState.checkedPlugins.has(entry.id) && entry.entity.isUpToDate === false
            : state.updates.get(entry.id)?.isUpToDate === false);
        const undetected = installed.length - detected.length;
        const busy = scope === 'backend'
            ? backendUpdateState.batchUpdating || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase)
            : state.checking || state.batchUpdating || state.batchToggling;
        const progressMessage = scope === "backend" && busy
            ? backendUpdateState.message
            : scope === "frontend" && state.checking
                ? `正在检测白名单前端扩展 ${state.frontendCheckProgress.completed} / ${state.frontendCheckProgress.total}`
                : scope === "frontend" && state.batchUpdating
                    ? "正在依次更新白名单前端扩展"
                    : "";
        $popup.find('.em-whitelist-update-status').text(progressMessage || (installed.length
            ? `已检测 ${detected.length} / ${installed.length}${available.length ? ` · 可更新 ${available.length} 个` : ''}`
            : '白名单中没有已安装插件')).toggleClass('update', available.length > 0);
        const failed = failedWhitelistEntries(scope);
        $popup.find('.em-whitelist-check-all').prop('disabled', busy || !installed.length);
        const checkingAll = scope === "frontend" ? state.checking : backendUpdateState.phase === "checking";
        const updatingAll = scope === "frontend" ? state.batchUpdating : backendUpdateState.phase === "updating";
        $popup.find(".em-whitelist-check-all").html(checkingAll ? `<i class="fa-solid fa-spinner fa-spin"></i> 检测中${scope === "frontend" ? ` ${state.frontendCheckProgress.completed} / ${state.frontendCheckProgress.total}` : ""}` : `<i class="fa-solid fa-magnifying-glass"></i> 检测全部`);
        $popup.find(".em-whitelist-update-all").html(updatingAll ? `<i class="fa-solid fa-spinner fa-spin"></i> 更新中` : `<i class="fa-solid fa-cloud-arrow-down"></i> 更新全部`);
        $popup.find(".em-whitelist-retry").prop("hidden", failed.length === 0).prop("disabled", busy).html(checkingAll ? `<i class="fa-solid fa-spinner fa-spin"></i> 重试中` : `<i class="fa-solid fa-rotate-right"></i> 重试失败${failed.length ? ` (${failed.length})` : ""}`);
        $popup.find('.em-whitelist-update-all').prop('hidden', !available.length).prop('disabled', busy || undetected > 0);
        const groups = new Map();
        visibleEntries.forEach(entry => {
            if (!groups.has(entry.group)) groups.set(entry.group, []);
            groups.get(entry.group).push(entry);
        });
        const names = Array.from(groups.keys()).sort((a, b) => {
            if (a === '内置') return -1;
            if (b === '内置') return 1;
            if (a === '未安装') return 1;
            if (b === '未安装') return -1;
            if (a === '未分组') return 1;
            if (b === '未分组') return -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        $popup.find('.em-whitelist-list').html(visibleEntries.length
            ? names.map(group => renderWhitelistGroup(group, groups.get(group))).join('')
            : '<div class="em-empty"><i class="fa-solid fa-shield-halved"></i><span>白名单中没有匹配的插件</span></div>');
        renderWhitelistBatchSelection($popup, allEntries);
        $popup.find('.em-whitelist-legacy').prop('hidden', state.backend.supportsWhitelist);
    }

    async function checkWhitelistPlugins(ids, $popup, options = {}) {
        const scope = whitelistState.scope;
        const targets = whitelistInstalled(scope).filter(item => ids.includes(scope === "backend" ? item.id : folderOf(item)));
        if (!targets.length) {
            if (window.toastr) toastr.info("白名单中没有可检测的已安装插件");
            return;
        }
        if (scope === "backend") {
            await checkBackendPlugins(targets.map(plugin => plugin.id), $popup, { allowWhitelisted: true, whitelistView: true, showResults: options.showResults === true, returnPanel: 'whitelist', resultTitle: options.resultTitle || '白名单后端插件检测结果' });
            renderWhitelistPanel($popup);
            return;
        }
        if (state.checking || state.batchUpdating || state.batchToggling) return;
        state.checking = true;
        state.frontendCheckProgress = { completed: 0, total: targets.length };
        beginDetection($popup);
        renderWhitelistPanel($popup);
        try {
            await mapDetectionTargets(targets, async extension => {
                const result = await checkOne(extension, undefined, { allowWhitelisted: true });
                state.frontendCheckProgress.completed += 1;
                renderWhitelistPanel($popup);
                return result;
            });
        } finally {
            state.checking = false;
            if (!state.detectionCancelled) state.frontendCheckProgress = { completed: state.frontendCheckProgress.total, total: state.frontendCheckProgress.total };
            renderWhitelistPanel($popup);
            renderList($popup);
            const showResults = options.showResults === true && !state.detectionCancelled;
            state.statusSortActive = options.showResults === true || state.statusSortActive;
            whitelistState.statusSortActive = options.showResults === true || whitelistState.statusSortActive;
            finishDetection($popup);
            if (showResults) openDetectionResults('frontend', targets.map(folderOf), $popup, { allowWhitelisted: true, returnPanel: 'whitelist', title: options.resultTitle || '白名单前端扩展检测结果' });
        }
    }

    async function updateWhitelistPlugins(ids, $popup) {
        const scope = whitelistState.scope;
        const targets = whitelistInstalled(scope).filter(item => ids.includes(scope === 'backend' ? item.id : folderOf(item)));
        const undetected = targets.filter(item => scope === 'backend' ? !backendUpdateState.checkedPlugins.has(item.id) : !state.updates.has(folderOf(item)));
        if (undetected.length) {
            if (window.toastr) toastr.warning(`还有 ${undetected.length} 个白名单插件未检测，请先检测`);
            return;
        }
        if (scope === 'backend') {
            await updateBackendPluginsSequentially(targets.map(plugin => plugin.id), $popup, { allowWhitelisted: true, whitelistView: true });
            renderWhitelistPanel($popup);
            return;
        }
        const available = targets.filter(extension => state.updates.get(folderOf(extension))?.isUpToDate === false);
        if (!available.length) {
            if (window.toastr) toastr.info('检测完成，白名单插件暂无可更新项');
            return;
        }
        if (state.batchUpdating || state.batchToggling || state.checking) return;
        state.batchUpdating = true;
        renderWhitelistPanel($popup);
        let completed = 0;
        try {
            for (let index = 0; index < available.length; index++) {
                $popup.find('.em-whitelist-batch-status').text(`正在更新 ${index + 1} / ${available.length}：${available[index].displayName}`);
                if (await updateOne(available[index], $popup, { quiet: true, deferRender: true, deferSelectionRender: true, allowWhitelisted: true })) completed += 1;
                renderWhitelistPanel($popup);
            }
            if (window.toastr) toastr.success(`白名单更新完成：${completed} / ${available.length}，已依次热加载`);
        } finally {
            state.batchUpdating = false;
            renderWhitelistPanel($popup);
            renderList($popup);
        }
    }

    async function setWhitelistFrontendEnabled(ids, enabled, $popup) {
        if (whitelistState.scope !== 'frontend' || state.batchToggling || state.batchUpdating || state.checking) return;
        const targets = whitelistInstalled('frontend').filter(extension => ids.includes(folderOf(extension)) && extension.enabled !== enabled);
        if (!targets.length) return;
        state.batchToggling = true;
        renderWhitelistPanel($popup);
        let completed = 0;
        try {
            for (let index = 0; index < targets.length; index++) {
                $popup.find('.em-whitelist-batch-status').text(`正在${enabled ? '启用' : '禁用'} ${index + 1} / ${targets.length}：${targets[index].displayName}`);
                try {
                    await toggleExtensionHot(targets[index], enabled);
                    completed += 1;
                } catch (error) {
                    if (window.toastr) toastr.error(`${targets[index].displayName} ${enabled ? '启用' : '禁用'}失败：${error.message || error}`);
                }
            }
            if (window.toastr) toastr.success(`批量${enabled ? '启用' : '禁用'}完成：${completed} / ${targets.length}，已在当前页面热切换`);
        } finally {
            state.batchToggling = false;
            renderWhitelistPanel($popup);
            renderList($popup);
        }
    }

    async function openWhitelistPanel($popup) {
        whitelistState.selected.clear();
        whitelistState.filter = '';
        whitelistState.category = '';
        whitelistState.selectionMode = false;
        whitelistState.groupPicker = '';
        whitelistState.groupPickerSelections.clear();
        $popup.find('.em-tab').removeClass('active');
        $popup.find('.em-panel').removeClass('active');
        $popup.find('[data-panel="whitelist"]').addClass('active');
        if (state.backend.available && !backendUpdateState.plugins.length) await loadBackendPlugins($popup);
        renderWhitelistPanel($popup);
    }

    function closeWhitelistPanel($popup) {
        whitelistState.selected.clear();
        whitelistState.selectionMode = false;
        whitelistState.groupPicker = '';
        whitelistState.groupPickerSelections.clear();
        $popup.find('.em-tab').removeClass('active').filter('[data-tab="install"]').addClass('active');
        $popup.find('.em-panel').removeClass('active').filter('[data-panel="install"]').addClass('active');
        renderInstallPanel($popup);
    }

    async function saveDetectionSettings($popup, $button) {
        const $status = $popup.find(".em-network-setting-status");
        const privacyMasking = $popup.find('.em-privacy-masking').prop('checked');
        const networkOptimization = $popup.find(".em-network-optimization").prop("checked");
        let gitProxy;
        try {
            gitProxy = normalizeGitProxy($popup.find(".em-git-proxy").val(), true);
        } catch (error) {
            $status.addClass("error").text(error.message || "代理地址无效");
            return;
        }
        const original = $button.html();
        $button.prop("disabled", true).html("<i class=\"fa-solid fa-spinner fa-spin\"></i> 保存中");
        $status.removeClass("error ok").text("正在保存设置");
        try {
            const enabledFirst = $popup.find('.em-enabled-first').prop('checked');
            await saveServerSettings({ privacyMasking, networkOptimization, enabledFirst, gitProxy });
            renderInstallPanel($popup);
            renderList($popup);
            renderBackendPluginList($popup);
            if (whitelistState.scope) renderWhitelistPanel($popup);
            if (detectionResults.active) renderDetectionResults($popup);
            const backendHint = gitProxy && !state.backend.supportsNetworkOptimization
                ? "；更新并重启管理后端后代理才会用于后端检测"
                : "";
            $status.removeClass("error").addClass("ok").text("设置已保存" + backendHint);
            if (window.toastr) toastr.success("设置已保存");
        } catch (error) {
            $status.removeClass("ok").addClass("error").text("保存失败：" + (error.message || error));
        } finally {
            $button.prop("disabled", false).html(original);
        }
    }

    function renderInstallPanel($popup) {
        const $button = $popup.find('.em-copy-backend-command');
        const $status = $popup.find('.em-manager-backend-status');
        if (!$button.length) return;
        const isWindows = state.backendInstallPlatform === 'windows';
        $popup.find('.em-platform-option[data-platform]').each(function () {
            const active = String($(this).data('platform')) === state.backendInstallPlatform;
            $(this).toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
        });
        $popup.find('.em-backend-command').text(backendInstallCommand());
        $popup.find('.em-backend-install-note').text(isWindows
            ? '请在 PowerShell 中粘贴执行。命令不会自动重启，完成后请手动重启 SillyTavern。'
            : '请在 Termux 中粘贴执行。命令不会自动重启，完成后请手动重启 SillyTavern。');
        const $connect = $popup.find('.em-connect-backend');
        const backendBusy = state.backendConnecting || ['loading', 'checking', 'updating'].includes(backendUpdateState.phase) || ['checking', 'updating'].includes(backendSelfUpdateState.phase);
        $connect.prop('disabled', backendBusy).toggleClass('is-installed', state.backend.available);
        $connect.html(state.backend.available ? '<i class="fa-solid fa-arrows-rotate"></i> 重新连接' : '<i class="fa-solid fa-plug"></i> 连接后端');
        $button.prop('disabled', state.backend.available);
        $button.toggleClass('is-installed', state.backend.available);
        $button.html(state.backend.available
            ? '<i class="fa-solid fa-circle-check"></i> 管理后端已安装'
            : `<i class="fa-solid fa-terminal"></i> 复制${isWindows ? ' PowerShell' : ' Termux'} 一键命令`);
        $status.removeClass('error').toggleClass('ok', state.backend.available).text(state.backend.available
            ? `已连接扩展管理器后端${state.backend.version ? ` v${state.backend.version}` : ''}`
            : '尚未连接扩展管理器后端');
        const whitelistCount = state.whitelist.frontend.length + state.whitelist.backend.length;
        $popup.find('.em-open-whitelist').prop('disabled', !state.backend.supportsWhitelist);
        $popup.find('.em-whitelist-setting-status').toggleClass('error', state.backend.available && !state.backend.supportsWhitelist).text(state.backend.supportsWhitelist
            ? `已忽略 ${whitelistCount} 个插件`
            : (state.backend.available ? '请先更新管理后端并手动重启' : '连接管理后端后可使用'));
        $popup.find('.em-privacy-masking').prop('checked', state.settings.privacyMasking);
        applyPrivacyMasking($popup);
        $popup.find('.em-network-optimization').prop('checked', state.settings.networkOptimization);
        $popup.find('.em-enabled-first').prop('checked', state.settings.enabledFirst);
        $popup.find('.em-git-proxy').val(state.settings.gitProxy);
        const proxyNeedsBackendUpdate = Boolean(state.settings.gitProxy && state.backend.available && !state.backend.supportsNetworkOptimization);
        const networkSummary = state.settings.networkOptimization
            ? '已开启：前端检测最多 2 个并发并自动重试'
            : '已关闭：前端检测最多 6 个并发且不自动重试';
        const proxySummary = state.settings.gitProxy
            ? (state.backend.supportsNetworkOptimization ? '；后端 Git 代理已启用' : '；代理需更新并重启管理后端后生效')
            : '；未设置后端 Git 代理';
        $popup.find('.em-network-setting-status').toggleClass('error', proxyNeedsBackendUpdate).toggleClass('ok', !proxyNeedsBackendUpdate).text(networkSummary + proxySummary);
    }

    async function reconnectBackend($popup) {
        const $button = $popup.find(".em-connect-backend");
        if (state.backendConnecting) return;
        state.backendConnecting = true;
        try {
            await withButtonBusy($button, "连接中", async () => {
                backendUpdateState.phase = "loading";
                backendUpdateState.message = "正在连接管理后端";
                renderBackendUpdate($popup);
                await loadServerMeta();
                renderBackendState($popup);
                if (!state.backend.available) {
                    backendUpdateState.phase = "error";
                    backendUpdateState.message = "管理后端未连接：" + (state.backend.error || "请先重启酒馆并确认服务端插件已启用");
                    renderBackendUpdate($popup);
                    throw new Error(backendUpdateState.message);
                }
                backendUpdateState.plugins = [];
                backendUpdateState.checkedPlugins.clear();
                backendUpdateState.selectedPlugins.clear();
                await loadBackendPlugins($popup, { force: true });
                await discover();
                renderList($popup);
                renderBackendUpdate($popup);
                if ($popup.find("[data-panel=whitelist]").hasClass("active")) renderWhitelistPanel($popup);
                const count = regularBackendPlugins().length;
                $popup.find(".em-manager-backend-status").removeClass("error").addClass("ok").text("已连接并读取 " + count + " 个其他后端插件");
                if (window.toastr) toastr.success("后端已连接，状态已重新读取，无需刷新网页");
            });
        } catch (error) {
            $popup.find(".em-manager-backend-status").removeClass("ok").addClass("error").text(error.message || String(error));
            if (window.toastr) toastr.error(error.message || String(error));
        } finally {
            state.backendConnecting = false;
            renderBackendState($popup);
            renderBackendUpdate($popup);
        }
    }

    async function installFrontendExtension($popup) {
        const $button = $popup.find('.em-install-frontend');
        const originalButton = $button.html();
        const $status = $popup.find('.em-frontend-install-status');
        const url = String($popup.find('.em-install-url').val() || '').trim();
        const branch = String($popup.find('.em-install-branch').val() || '').trim();
        const global = $popup.find('.em-install-scope').val() === 'global';
        const repositoryUrl = url.replace(/\.git\/?$/i, "");
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 HTTP 或 HTTPS 仓库地址');
        } catch (error) {
            $status.addClass('error').text(error.message || '请输入有效的 Git 仓库地址');
            return;
        }
        if (!window.confirm(`确认安装此前端扩展？\n${repositoryUrl}`)) return;
        $button.prop("disabled", true).html("<i class=\"fa-solid fa-spinner fa-spin\"></i> 安装中");
        $status.removeClass('error ok').text('正在克隆仓库并加载扩展');
        try {
            const installed = await request('/api/extensions/install', {
                method: 'POST',
                body: JSON.stringify({ url: repositoryUrl, global, branch }),
            });
            const api = await getExtensionApi();
            if (typeof api.loadExtensionSettings === 'function') { extensionHotRuntime.beginCapture?.(); await api.loadExtensionSettings({}, false, false); }
            await discover();
            const extension = state.extensions.find(item => folderOf(item) === normalizeName(installed?.folderName || ''));
            if (extension) {
                extension.installedAt = Date.now();
                state.expandedGroups.add(groupOf(extension));
            }
            renderList($popup);
            const name = installed?.display_name || installed?.folderName || '前端扩展';
            $status.addClass('ok').text(`${name} 已安装并动态加载，无需刷新网页`);
            if (window.toastr) toastr.success(`${name} 安装完成`);
        } catch (error) {
            $status.addClass('error').text(`安装失败：${error.message || error}`);
            if (window.toastr) toastr.error(`安装失败：${error.message || error}`);
        } finally {
            $button.prop("disabled", false).html(originalButton);
        }
    }

    function renderBackendPanel($popup) {
        const $status = $popup.find('.em-backend-panel-state');
        if (!$status.length) return;
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        const pluginCount = regularBackendPlugins().length;
        const connected = '管理后端已连接' +
            (state.backend.version ? ' · v' + state.backend.version : '') +
            (pluginCount ? ' · 已发现 ' + pluginCount + ' 个其他后端插件' : '') +
            (state.backend.supportsBackendMeta ? '' : ' · 更新并重启后可保存分组');
        $status.text(state.backend.available ? connected : '管理后端未连接');
        $popup.find('.em-backend-install-help').prop('hidden', state.backend.available);
    }

    function renderBackendState($popup) {
        const $status = $popup.find('.em-backend-state');
        $status.toggleClass('ok', state.backend.available).toggleClass('error', !state.backend.available);
        $status.text(state.backend.available ? `服务端存储已连接${state.backend.version ? ` v${state.backend.version}` : ''}` : '后端未连接 · 前端标注使用浏览器本地存储');
        if (!state.backend.available && state.backend.error) $status.attr('title', state.backend.error);
        renderBackendPanel($popup);
        renderInstallPanel($popup);
    }

    async function loadExtensions($popup) {
        $popup.find('#em-list').html('<div class="em-empty"><i class="fa-solid fa-spinner fa-spin"></i><span>正在读取酒馆前端扩展</span></div>');
        if (!state.backend.available) state.meta = readLocalFrontendMeta();
        state.settings = writeLocalSettings(normalizeSettings({ ...state.settings, ...readLocalSettings() }));
        applyFloatingBallSize($popup);
        const serverMetaPromise = loadServerMeta();
        try {
            await discover();
            renderList($popup);
        } catch (error) {
            $popup.find('#em-list').html(`<div class="em-empty em-error"><i class="fa-solid fa-triangle-exclamation"></i><span>读取失败：${escapeHtml(error.message || error)}</span></div>`);
        }
        void serverMetaPromise.then(() => {
            if (!$popup.closest('body').length) return;
            state.extensions.forEach(extension => applyFrontendMetadata(extension));
            renderBackendState($popup);
            applyFloatingBallSize($popup);
            renderList($popup);
            if ($popup.find('[data-panel=whitelist]').hasClass('active')) renderWhitelistPanel($popup);
        });
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
                --em-accent: #2d6784;
                --em-primary: #286987;
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
            #st-extension-manager-overlay .em-search-clear { width: auto; min-width: 92px; min-height: 36px; flex: 0 0 auto; padding: 7px 10px; white-space: nowrap; }
            #st-extension-manager-overlay .em-search-clear[hidden] { display: none; }
            #st-extension-manager-overlay input[type="search"]::-webkit-search-cancel-button { display: none; }
            #st-extension-manager-overlay .em-search,
            #st-extension-manager-overlay .em-backend-search,
            #st-extension-manager-overlay .em-whitelist-search {
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
            #st-extension-manager-overlay .em-backend-multi-toggle.active,
            #st-extension-manager-overlay .em-whitelist-multi-toggle.active {
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
            #st-extension-manager-overlay .em-group-toggle,
            #st-extension-manager-overlay .em-backend-group-toggle,
            #st-extension-manager-overlay .em-whitelist-group-toggle,
            #st-extension-manager-overlay .em-group-check,
            #st-extension-manager-overlay .em-backend-group-check,
            #st-extension-manager-overlay .em-whitelist-group-check,
            #st-extension-manager-overlay .em-group-update,
            #st-extension-manager-overlay .em-backend-group-update,
            #st-extension-manager-overlay .em-whitelist-group-update { color: var(--em-accent) !important; display: inline-flex !important; align-items: center; justify-content: center; visibility: visible !important; }
            #st-extension-manager-overlay .em-group-toggle i,
            #st-extension-manager-overlay .em-backend-group-toggle i,
            #st-extension-manager-overlay .em-whitelist-group-toggle i { display: block !important; visibility: visible !important; }
            @keyframes em-spin { to { transform: rotate(360deg); } }
            #st-extension-manager-overlay [data-action="checking"] .em-check-selected i,
            #st-extension-manager-overlay [data-action="checking"] .em-check-selected-backend i,
            #st-extension-manager-overlay [data-action="checking"] .em-whitelist-check-selected i,
            #st-extension-manager-overlay [data-action="checking"] .em-results-check-selected i,
            #st-extension-manager-overlay [data-action="updating"] .em-update-selected i,
            #st-extension-manager-overlay [data-action="updating"] .em-update-selected-backend i,
            #st-extension-manager-overlay [data-action="updating"] .em-whitelist-update-selected i,
            #st-extension-manager-overlay [data-action="updating"] .em-results-update-selected i,
            #st-extension-manager-overlay [data-action="enabling"] .em-enable-selected i,
            #st-extension-manager-overlay [data-action="enabling"] .em-whitelist-enable-selected i,
            #st-extension-manager-overlay [data-action="enabling"] .em-results-enable-selected i,
            #st-extension-manager-overlay [data-action="disabling"] .em-disable-selected i,
            #st-extension-manager-overlay [data-action="disabling"] .em-whitelist-disable-selected i,
            #st-extension-manager-overlay [data-action="disabling"] .em-results-disable-selected i,
            #st-extension-manager-overlay .em-save-meta:disabled i,
            #st-extension-manager-overlay .em-backend-card .em-action.primary:disabled i { animation: em-spin .8s linear infinite; }

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
            #st-extension-manager-overlay .em-card.is-error {
                border-color: rgba(185, 78, 85, .55);
                border-left: 4px solid #b94e55;
                background: color-mix(in srgb, #b94e55 9%, var(--em-surface));
                box-shadow: 0 4px 16px rgba(130, 37, 45, .1);
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
            #st-extension-manager-overlay.em-privacy-enabled .em-private { filter: blur(5px); user-select: none; pointer-events: none; }
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
            #st-extension-manager-overlay .em-save-meta.primary { border-color: var(--em-primary); background: var(--em-primary); color: #fff; }
            #st-extension-manager-overlay .em-action.primary:hover,
            #st-extension-manager-overlay .em-save-meta.primary:hover { filter: brightness(1.08); color: #fff; }
            #st-extension-manager-overlay .em-action.muted { cursor: default; opacity: .48; }
            #st-extension-manager-overlay button:disabled { cursor: wait; opacity: .68; }

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

            #st-extension-manager-overlay .em-card.is-ignored {
                border-color: rgba(88, 99, 112, .22);
                background: rgba(88, 99, 112, .06);
            }
            #st-extension-manager-overlay .em-status.ignored {
                color: #596875;
                background: rgba(88, 99, 112, .12);
            }
            #st-extension-manager-overlay .em-whitelist-page {
                width: 100%;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            #st-extension-manager-overlay .em-whitelist-head {
                display: flex;
                align-items: center;
                gap: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--em-line-soft);
            }
            #st-extension-manager-overlay .em-whitelist-head > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
            #st-extension-manager-overlay .em-whitelist-head strong { font-size: .94em; }
            #st-extension-manager-overlay .em-whitelist-head span { font-size: .75em; opacity: .65; }
            #st-extension-manager-overlay .em-whitelist-tools { margin-bottom: 0; }
            #st-extension-manager-overlay .em-whitelist-list-head { margin-top: 0; }
            #st-extension-manager-overlay .em-whitelist-search-field {
                width: auto;
                min-height: 36px;
                flex: 1 1 280px;
            }
            #st-extension-manager-overlay .em-whitelist-list {
                min-height: 0;
                max-height: none;
                overflow: visible;
            }
            #st-extension-manager-overlay .em-whitelist-update-status.update { color: #278d50; font-weight: 700; opacity: 1; }
            #st-extension-manager-overlay .em-whitelist-group .em-group-content { min-width: 0; }
            #st-extension-manager-overlay .em-settings .em-whitelist-setting-status { font-size: .76em; opacity: .7; }
            #st-extension-manager-overlay .em-settings .em-whitelist-setting-status.error { color: #b94e55; opacity: 1; }
            #st-extension-manager-overlay .em-network-settings { padding-bottom: 12px; border-bottom: 1px solid var(--em-line-soft); display: flex; flex-direction: column; gap: 10px; }
            #st-extension-manager-overlay .em-install label.em-setting-toggle { position: relative; width: 100%; min-height: 42px; display: grid; grid-template-columns: minmax(0, 1fr) 42px; grid-template-rows: auto; align-items: center; column-gap: 12px; cursor: pointer; opacity: 1; }
            #st-extension-manager-overlay .em-setting-toggle > input { position: absolute; z-index: 2; inset-block-start: 50%; inset-inline-end: 0; inline-size: 42px; block-size: 24px; margin: 0; opacity: 0; cursor: pointer; transform: translateY(-50%); }
            #st-extension-manager-overlay .em-setting-toggle > .em-setting-copy { grid-column: 1; grid-row: 1; text-align: left; }
            #st-extension-manager-overlay .em-setting-toggle > .em-switch-track { grid-column: 2; grid-row: 1; box-sizing: border-box; width: 42px; min-width: 42px; max-width: 42px; height: 24px; min-height: 24px; max-height: 24px; margin: 0; padding: 3px; border: 1px solid var(--em-line); border-radius: 999px; background: var(--em-control); justify-self: end; overflow: hidden; transition: background-color .16s ease, border-color .16s ease; }
            #st-extension-manager-overlay .em-switch-track > span { display: block; box-sizing: border-box; width: 16px; min-width: 16px; max-width: 16px; height: 16px; min-height: 16px; max-height: 16px; margin: 0; border-radius: 50%; background: currentColor; opacity: .68; transition: transform .16s ease, opacity .16s ease; }
            #st-extension-manager-overlay .em-setting-toggle > input:checked + .em-switch-track { border-color: var(--em-primary); background: var(--em-primary); color: #fff; }
            #st-extension-manager-overlay .em-setting-toggle > input:checked + .em-switch-track > span { transform: translateX(18px); opacity: 1; }
            #st-extension-manager-overlay .em-setting-toggle > input:focus-visible + .em-switch-track { outline: 2px solid var(--em-accent); outline-offset: 2px; }
            #st-extension-manager-overlay .em-setting-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
            #st-extension-manager-overlay .em-setting-copy strong { font-size: 1.05em; }
            #st-extension-manager-overlay .em-setting-copy small { line-height: 1.4; opacity: .7; }
            #st-extension-manager-overlay .em-proxy-setting { opacity: 1; }
            #st-extension-manager-overlay .em-network-setting-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
            #st-extension-manager-overlay .em-network-setting-actions .em-action { min-height: 36px; flex: 0 0 auto; }
            #st-extension-manager-overlay .em-network-setting-status { min-width: 0; flex: 1 1 260px; font-size: .74em; line-height: 1.45; opacity: .72; }
            #st-extension-manager-overlay .em-network-setting-status.ok { color: #278d50; font-weight: 600; opacity: 1; }
            #st-extension-manager-overlay .em-network-setting-status.error { color: #b94e55; font-weight: 600; opacity: 1; }
            #st-extension-manager-overlay .em-network-setting-note { margin: 0; font-size: .72em; line-height: 1.5; opacity: .62; }
            #st-extension-manager-overlay .em-toolbar > .em-cancel-detection { flex: 0 0 auto; min-height: 34px; margin-left: auto; border-color: #b94e55; color: #b94e55; }
            #st-extension-manager-overlay .em-status.error { color: #b94e55; background: rgba(185, 78, 85, .12); font-weight: 700; opacity: 1; }
            #st-extension-manager-overlay .em-detection-error { width: 100%; margin-top: 8px; }
            #st-extension-manager-overlay .em-error-toggle { border-color: rgba(185, 78, 85, .42); color: #b94e55; }
            #st-extension-manager-overlay .em-error-details { margin-top: 7px; padding: 10px; border: 1px solid rgba(185, 78, 85, .32); border-radius: 6px; background: rgba(185, 78, 85, .07); display: flex; flex-direction: column; gap: 8px; }
            #st-extension-manager-overlay .em-error-details[hidden] { display: none; }
            #st-extension-manager-overlay .em-error-details pre { max-height: 180px; margin: 0; padding: 9px; border-radius: 5px; background: var(--em-control); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: inherit; font: .72em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
            #st-extension-manager-overlay .em-error-details .em-copy-error { align-self: flex-start; }
            #st-extension-manager-overlay .em-results-page { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
            #st-extension-manager-overlay .em-results-tools { margin-bottom: 0; }
            #st-extension-manager-overlay .em-results-list-head { margin-top: 0; }
            #st-extension-manager-overlay .em-results-list { display: flex; flex-direction: column; gap: 8px; }
            #st-extension-manager-overlay .em-results-summary { overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-results-multi-toggle.active { border-color: var(--em-accent); background: color-mix(in srgb, var(--em-accent) 12%, var(--em-control)); color: var(--em-accent); }
            #st-extension-manager-overlay .em-faq-page,
            #st-extension-manager-overlay .em-tutorial-page { width: 100%; max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
            #st-extension-manager-overlay .em-tutorial-list { display: flex; flex-direction: column; gap: 8px; }
            #st-extension-manager-overlay .em-tutorial-open-category strong { font-size: .92em; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-tutorial-category-meta { margin-left: auto; flex: 0 0 auto; align-items: center !important; color: var(--em-accent); font-size: .74em; opacity: .75; white-space: nowrap; }
            #st-extension-manager-overlay .em-tutorial-category-meta > i { margin: 0 !important; color: inherit !important; }
            #st-extension-manager-overlay .em-faq-list { display: flex; flex-direction: column; gap: 8px; }
            #st-extension-manager-overlay .em-faq-item { border: 1px solid var(--em-line-soft); border-radius: 7px; background: var(--em-surface); overflow: hidden; }
            #st-extension-manager-overlay .em-faq-question { width: 100%; min-height: 48px; padding: 11px 13px; border: 0; background: transparent; color: inherit; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; cursor: pointer; }
            #st-extension-manager-overlay .em-faq-question > span { min-width: 0; display: flex; align-items: flex-start; gap: 8px; line-height: 1.45; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-faq-question > span > i { margin-top: 3px; color: var(--em-accent); }
            #st-extension-manager-overlay .em-faq-chevron { flex: 0 0 auto; opacity: .65; }
            #st-extension-manager-overlay .em-faq-answer { padding: 13px; border-top: 1px solid var(--em-line-soft); background: rgba(0, 0, 0, .025); }
            #st-extension-manager-overlay .em-faq-answer[hidden] { display: none; }
            #st-extension-manager-overlay .em-faq-post-label { margin-bottom: 7px; color: var(--em-accent); font-size: .75em; font-weight: 700; }
            #st-extension-manager-overlay .em-faq-rich { font-size: .82em; line-height: 1.7; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-faq-rich p { margin: 0 0 10px; }
            #st-extension-manager-overlay .em-faq-rich p:last-child { margin-bottom: 0; }
            #st-extension-manager-overlay .em-faq-rich strong { color: var(--em-accent); font-weight: 750; }
            #st-extension-manager-overlay .em-faq-rich u { text-decoration-color: var(--em-accent); text-decoration-thickness: 2px; text-underline-offset: 3px; }
            #st-extension-manager-overlay .em-faq-rich del { opacity: .62; }
            #st-extension-manager-overlay .em-faq-rich mark { padding: 1px 4px; border-radius: 3px; background: color-mix(in srgb, #ffd54f 46%, var(--em-surface)); color: inherit; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
            #st-extension-manager-overlay .em-faq-rich blockquote { margin: 10px 0; padding: 8px 11px; border-left: 3px solid var(--em-accent); background: color-mix(in srgb, var(--em-accent) 9%, var(--em-surface)); color: inherit; }
            #st-extension-manager-overlay .em-faq-answer code { padding: 1px 4px; border-radius: 4px; background: var(--em-control); color: inherit; font-size: .94em; }
            #st-extension-manager-overlay .em-changelog-item { padding: 13px; }
            #st-extension-manager-overlay .em-changelog-head { display: flex; align-items: flex-start; gap: 10px; }
            #st-extension-manager-overlay .em-changelog-head > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
            #st-extension-manager-overlay .em-changelog-head strong { color: var(--em-accent); font-size: .9em; overflow-wrap: anywhere; }
            #st-extension-manager-overlay .em-changelog-head span { font-size: .72em; opacity: .62; }
            #st-extension-manager-overlay .em-changelog-summary { margin-top: 7px; font-size: .8em; line-height: 1.55; }
            #st-extension-manager-overlay .em-changelog-summary p { margin: 0; }
            #st-extension-manager-overlay .em-changelog-content { display: block; margin: 11px 0 0; padding: 11px 0 0; border-top: 1px solid var(--em-line-soft); background: transparent; }

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
            #st-extension-manager-overlay .em-platform-option.active { background: var(--em-primary); color: #fff; font-weight: 700; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12); }
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
            #st-extension-manager-overlay .em-backend-self-update-status,
            #st-extension-manager-overlay .em-backend-update-status { min-height: 34px; margin: 0; font-size: .8em; line-height: 1.45; opacity: .7; }
            #st-extension-manager-overlay .em-self-update-status.update,
            #st-extension-manager-overlay .em-backend-self-update-status.update,
            #st-extension-manager-overlay .em-backend-self-update-status.restart,
            #st-extension-manager-overlay .em-backend-update-status.update,
            #st-extension-manager-overlay .em-backend-update-status.restart { color: #a96613; font-weight: 700; opacity: 1; }
            #st-extension-manager-overlay .em-self-update-status.error,
            #st-extension-manager-overlay .em-backend-self-update-status.error,
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
            #st-extension-manager-overlay .em-box:not(.em-dark) .em-action,
            #st-extension-manager-overlay .em-box:not(.em-dark) .em-save-meta { color: #29313a; }
            #st-extension-manager-overlay .em-box:not(.em-dark) .em-action.primary,
            #st-extension-manager-overlay .em-box:not(.em-dark) .em-save-meta.primary { color: #fff; }
            #st-extension-manager-overlay .em-box.em-dark .em-action,
            #st-extension-manager-overlay .em-box.em-dark .em-save-meta { color: #eef0f2; background: var(--em-control); border-color: var(--em-line); }
            #st-extension-manager-overlay .em-box.em-dark .em-action.primary,
            #st-extension-manager-overlay .em-box.em-dark .em-save-meta.primary { color: #fff; background: var(--em-primary); border-color: var(--em-primary); }
            #st-extension-manager-overlay .em-box.em-dark .em-platform-option { color: #eef0f2; }
            #st-extension-manager-overlay .em-box.em-dark .em-platform-option.active { color: #fff; }
            #st-extension-manager-overlay .em-box:not(.em-dark) .em-copy-backend-command.is-installed.primary:disabled { background: #e3e9ee; border-color: #aab6c1; color: #26323d; opacity: 1; cursor: default; filter: none; }
            #st-extension-manager-overlay .em-box.em-dark .em-copy-backend-command.is-installed.primary:disabled { background: #343c46; border-color: #687482; color: #f5f7f9; opacity: 1; cursor: default; filter: none; }
            #st-extension-manager-overlay .em-empty i { font-size: 1.8em; }

            #st-extension-manager-overlay .em-box.em-dark {
                --em-accent: #72b7d3;
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
            #st-extension-manager-overlay .em-box.em-dark .em-status.error,
            #st-extension-manager-overlay .em-box.em-dark .em-error-toggle { color: #ff9299; }
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
                #st-extension-manager-overlay .em-toolbar > .em-cancel-detection { width: 34px; min-width: 34px; padding: 0; margin-left: 2px; }
                #st-extension-manager-overlay .em-toolbar > .em-cancel-detection span { display: none; }
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
                border: 2px solid rgba(255, 255, 255, .92) !important;
                border-radius: 50% !important;
                background: #245f7b !important;
                box-shadow: 0 0 0 2px rgba(9, 18, 25, .42), 0 5px 16px rgba(8, 14, 22, .38) !important;
                color: #fff !important;
                display: grid !important;
                place-items: center;
                box-sizing: border-box;
                transform: none !important;
                opacity: 1 !important;
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
                color: #fff !important;
                text-shadow: 0 1px 2px rgba(0, 0, 0, .42);
                font-size: clamp(11px, calc(var(--em-float-size, 34px) * .38), 19px);
                pointer-events: none;
            }
            #st-extension-manager-float:hover,
            #st-extension-manager-float:focus-visible {
                background: #1d526b !important;
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
        const $popup = $(`<div id="${OVERLAY_ID}" class="em-overlay" role="dialog" aria-modal="true" aria-label="扩展管理器" tabindex="-1"><div class="em-box ${dark ? 'em-dark' : ''}"><header class="em-header"><div><div class="em-title"><i class="fa-solid fa-wand-magic-sparkles"></i>${SCRIPT_NAME}<span class="em-version">v${SCRIPT_VERSION}</span></div><div class="em-subtitle"><span class="em-backend-state">服务端存储检测中</span></div></div><div class="em-head-actions"><button type="button" class="em-icon em-minimize" title="收起面板" aria-label="收起面板" aria-expanded="true"><i class="fa-solid fa-window-minimize"></i></button><button type="button" class="em-icon em-night" title="切换夜间模式" aria-label="切换夜间模式"><i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}"></i></button><button type="button" class="em-icon em-close" title="关闭" aria-label="关闭面板"><i class="fa-solid fa-xmark"></i></button></div></header><nav class="em-toolbar" aria-label="扩展管理器页面"><button type="button" class="em-tab active" data-tab="installed"><i class="fa-solid fa-layer-group"></i> 前端扩展</button><button type="button" class="em-tab" data-tab="backend"><i class="fa-solid fa-server"></i> 后端管理</button><button type="button" class="em-tab" data-tab="install"><i class="fa-solid fa-download"></i> 安装扩展</button><button type="button" class="em-action em-cancel-detection" hidden><i class="fa-solid fa-ban"></i><span>取消检测</span></button></nav><main class="em-content"><section class="em-panel active" data-panel="installed"><div class="em-frontend-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>扩展管理器本体</strong><span class="em-self-update-status">点击按钮检查本体更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-self"><i class="fa-solid fa-arrows-rotate"></i> 检测</button><button type="button" class="em-action primary em-update-self" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button></div></div><div class="em-tool-row"><div class="em-tool-copy"><strong>前端扩展更新</strong><span class="em-frontend-update-status">检测后显示可用更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-all"><i class="fa-solid fa-magnifying-glass"></i> 检测更新</button><button type="button" class="em-action em-retry-frontend" hidden><i class="fa-solid fa-rotate-right"></i> 重试失败</button><button type="button" class="em-action primary em-update-all" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部</button></div></div><label class="em-float-size-control"><span>悬浮球大小</span><input class="em-float-size" type="range" min="25" max="56" step="1" value="34"><output class="em-float-size-value">34px</output></label></div><div class="em-list-head"><div class="em-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-search" type="search" placeholder="搜索扩展、仓库、分组或备注" aria-label="搜索扩展"></div><button type="button" class="em-action em-search-clear em-frontend-search-clear" aria-label="取消前端搜索" hidden><i class="fa-solid fa-xmark"></i><span>取消搜索</span></button><select class="em-category-filter" aria-label="按分组筛选"><option value="">全部分组</option></select><select class="em-select em-sort" aria-label="扩展排序方式"><option value="name">按首字母</option><option value="updated">按安装/更新时间</option><option value="enabled">按启用状态</option><option value="type">按类型</option><option value="status">按检测状态</option></select><span id="em-count" class="em-count"></span><button type="button" class="em-action em-multi-toggle" aria-pressed="false"><i class="fa-solid fa-square-check"></i><span>多选</span></button><button type="button" class="em-action em-refresh" title="重新读取" aria-label="重新读取扩展"><i class="fa-solid fa-arrows-rotate"></i></button></div><div class="em-batch-toolbar" hidden></div><div id="em-list" class="em-list"></div></section><section class="em-panel" data-panel="backend"><div class="em-frontend-tools em-backend-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>扩展管理器后端</strong><span class="em-backend-self-update-status">点击按钮检查后端更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-backend-self"><i class="fa-solid fa-arrows-rotate"></i> 检测</button><button type="button" class="em-action primary em-update-backend-self" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新</button></div></div><div class="em-tool-row"><div class="em-tool-copy"><strong>后端插件管理</strong><span class="em-backend-panel-state">正在检测管理后端连接</span></div><button type="button" class="em-action em-backend-refresh" title="重新读取" aria-label="重新读取后端插件"><i class="fa-solid fa-arrows-rotate"></i> 读取插件</button></div><div class="em-tool-row"><div class="em-tool-copy"><strong>后端插件更新</strong><span class="em-backend-update-status">读取后端插件后可检测更新</span></div><div class="em-tool-actions"><button type="button" class="em-action em-check-backend"><i class="fa-solid fa-magnifying-glass"></i> 检测全部</button><button type="button" class="em-action em-retry-backend" hidden><i class="fa-solid fa-rotate-right"></i> 重试失败</button><button type="button" class="em-action primary em-update-backend" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部</button></div></div></div><div class="em-list-head em-backend-list-head"><div class="em-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-backend-search" type="search" placeholder="搜索后端插件、分组或备注" aria-label="搜索后端插件"></div><button type="button" class="em-action em-search-clear em-backend-search-clear" aria-label="取消后端搜索" hidden><i class="fa-solid fa-xmark"></i><span>取消搜索</span></button><select class="em-backend-category-filter" aria-label="按后端分组筛选"><option value="">全部分组</option></select><select class="em-select em-backend-sort" aria-label="后端插件排序方式"><option value="name">按首字母</option><option value="updated">按更新时间</option><option value="status">按检测状态</option></select><span class="em-count em-backend-count"></span><button type="button" class="em-action em-backend-multi-toggle" aria-pressed="false"><i class="fa-solid fa-square-check"></i><span>多选</span></button></div><div class="em-batch-toolbar em-backend-batch-toolbar" hidden></div><div class="em-list em-backend-plugin-list"><div class="em-backend-plugin-empty"><i class="fa-solid fa-server"></i><span>等待读取</span></div></div><div class="em-backend-install-help" hidden><p>未检测到扩展管理器后端，请在“安装扩展”页选择 Termux 或 Windows 并复制对应的一键命令。</p><p>命令会启用 <code>enableServerPlugins: true</code>，但不会自动重启 SillyTavern。</p></div><p class="em-backend-update-note">后端检测只查询固定插件目录中的 Git 仓库；更新按检测结果依次执行 <code>git pull --ff-only</code>，不会自动重启，完成后请手动重启。</p></section><section class="em-panel" data-panel="install"><div class="em-install-page"><div class="em-install"><h3><i class="fa-solid fa-puzzle-piece"></i> 安装前端扩展</h3><label>Git 仓库地址<input class="em-install-url" type="url" inputmode="url" placeholder="https://github.com/user/repository"></label><div class="em-install-row"><label>分支或标签（可选）<input class="em-install-branch" type="text" placeholder="main"></label><label>安装范围<select class="em-install-scope"><option value="user">当前用户</option><option value="global">全部用户</option></select></label></div><button type="button" class="em-action primary em-install-frontend"><i class="fa-solid fa-download"></i> 安装并加载</button><p class="em-install-status em-frontend-install-status">等待输入仓库地址</p></div><div class="em-install"><h3><i class="fa-solid fa-server"></i> 安装后端扩展</h3><div class="em-install-backend-head"><strong>扩展管理器后端</strong><span class="em-manager-backend-status">正在检测连接</span><button type="button" class="em-action em-connect-backend"><i class="fa-solid fa-plug"></i> 连接后端</button></div><div class="em-platform-switch" role="group" aria-label="选择运行环境"><button type="button" class="em-platform-option active" data-platform="termux" aria-pressed="true"><i class="fa-solid fa-mobile-screen"></i><span>Termux</span></button><button type="button" class="em-platform-option" data-platform="windows" aria-pressed="false"><i class="fa-solid fa-desktop"></i><span>Windows</span></button></div><pre class="em-backend-command">${escapeHtml(backendInstallCommand())}</pre><button type="button" class="em-action primary em-copy-backend-command"><i class="fa-solid fa-terminal"></i> 复制 Termux 一键命令</button><p class="em-install-status em-backend-install-note">请在 Termux 中粘贴执行。命令不会自动重启，完成后请手动重启 SillyTavern。</p><div class="em-install-placeholder">其他后端插件安装暂未开放</div></div><div class="em-install em-settings"><h3><i class="fa-solid fa-gear"></i> 设置</h3><div class="em-network-settings"><label class="em-setting-toggle"><input class="em-privacy-masking" type="checkbox"><span class="em-switch-track" aria-hidden="true"><span></span></span><span class="em-setting-copy"><strong>隐私打码</strong><small>模糊插件 ID、GitHub 用户名和提交号，截图时避免泄露来源信息</small></span></label><label class="em-setting-toggle"><input class="em-network-optimization" type="checkbox"><span class="em-switch-track" aria-hidden="true"><span></span></span><span class="em-setting-copy"><strong>弱网检测优化</strong><small>限制前端检测并发，并对临时网络错误自动退避重试</small></span></label><label class="em-setting-toggle"><input class="em-enabled-first" type="checkbox"><span class="em-switch-track" aria-hidden="true"><span></span></span><span class="em-setting-copy"><strong>启用扩展优先</strong><small>打开后列表和检测结果都把已启用扩展排在已禁用扩展前面；检测结果仍先按失败红色、可更新绿色分层</small></span></label><label class="em-proxy-setting"><span>Git 代理（可选）</span><input class="em-git-proxy" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:7890"></label><div class="em-network-setting-actions"><button type="button" class="em-action primary em-save-network-settings"><i class="fa-solid fa-floppy-disk"></i> 保存设置</button><span class="em-network-setting-status">正在读取设置</span></div><p class="em-network-setting-note">代理仅临时用于后端插件 Git 检测，不修改全局 Git 配置或仓库地址；前端扩展使用限并发和自动重试。</p></div><button type="button" class="em-action em-open-tutorial"><i class="fa-solid fa-graduation-cap"></i> 新手教程</button><button type="button" class="em-action em-open-faq"><i class="fa-solid fa-circle-question"></i> 常见问题</button><button type="button" class="em-action em-open-changelog"><i class="fa-solid fa-clock-rotate-left"></i> 更新日志</button><div class="em-install-backend-head"><strong>更新检测白名单</strong><span class="em-whitelist-setting-status">正在读取</span></div><button type="button" class="em-action em-open-whitelist"><i class="fa-solid fa-shield-halved"></i> 白名单管理</button></div></div></section><section class="em-panel" data-panel="results"><div class="em-results-page"><div class="em-whitelist-head"><button type="button" class="em-icon em-results-back" title="返回管理页面" aria-label="返回管理页面"><i class="fa-solid fa-arrow-left"></i></button><div><strong class="em-results-title">检测结果</strong><span class="em-results-summary">正在整理本次检测结果</span></div></div><div class="em-frontend-tools em-results-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>本次检测</strong><span class="em-results-status">失败项优先，其次为可更新项</span></div><div class="em-tool-actions"><button type="button" class="em-action em-results-recheck"><i class="fa-solid fa-magnifying-glass"></i> 重新检测</button><button type="button" class="em-action primary em-results-update-all" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部</button></div></div></div><div class="em-list-head em-results-list-head"><div class="em-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-results-search" type="search" placeholder="搜索本次检测的插件" aria-label="搜索检测结果"></div><button type="button" class="em-action em-search-clear em-results-search-clear" aria-label="取消结果搜索" hidden><i class="fa-solid fa-xmark"></i><span>取消搜索</span></button><span class="em-count em-results-count"></span><select class="em-select em-results-sort" aria-label="检测结果排序方式"><option value="status">按检测状态</option><option value="enabled">按启用状态</option><option value="updated">按安装/更新时间</option><option value="name">按首字母</option></select><button type="button" class="em-action em-results-multi-toggle" aria-pressed="false"><i class="fa-solid fa-square-check"></i><span>多选</span></button></div><div class="em-batch-toolbar em-results-batch-toolbar" hidden></div><div class="em-list em-results-list"></div></div></section><section class="em-panel" data-panel="tutorial"><div class="em-tutorial-page">${renderTutorialHome()}</div></section><section class="em-panel" data-panel="faq"><div class="em-faq-page"><div class="em-whitelist-head"><button type="button" class="em-icon em-faq-back" title="返回安装扩展" aria-label="返回安装扩展"><i class="fa-solid fa-arrow-left"></i></button><div><strong>常见问题</strong><span>点击问题查看解决方案</span></div></div><div class="em-faq-list">${renderFaqItems()}</div></div></section><section class="em-panel" data-panel="changelog"><div class="em-faq-page em-changelog-page"><div class="em-whitelist-head"><button type="button" class="em-icon em-changelog-back" title="返回安装扩展" aria-label="返回安装扩展"><i class="fa-solid fa-arrow-left"></i></button><div><strong>更新日志</strong><span>每次版本更新都会用简单的话说明改了什么</span></div></div><div class="em-faq-list">${renderChangelogItems()}</div></div></section><section class="em-panel" data-panel="whitelist"><div class="em-whitelist-page"><div class="em-whitelist-head"><button type="button" class="em-icon em-whitelist-back" title="返回安装扩展" aria-label="返回安装扩展"><i class="fa-solid fa-arrow-left"></i></button><div><strong>白名单管理</strong><span>主列表自动检测会跳过这些插件，可在此页手动检测和更新</span></div></div><div class="em-platform-switch em-whitelist-switch" role="group" aria-label="选择白名单类型"><button type="button" class="em-platform-option em-whitelist-scope active" data-scope="frontend" aria-pressed="true"><i class="fa-solid fa-puzzle-piece"></i><span>前端扩展</span></button><button type="button" class="em-platform-option em-whitelist-scope" data-scope="backend" aria-pressed="false"><i class="fa-solid fa-server"></i><span>后端插件</span></button></div><div class="em-frontend-tools em-whitelist-tools"><div class="em-tool-row"><div class="em-tool-copy"><strong>白名单插件更新</strong><span class="em-whitelist-update-status">等待检测白名单插件</span></div><div class="em-tool-actions"><button type="button" class="em-action em-whitelist-check-all"><i class="fa-solid fa-magnifying-glass"></i> 检测全部</button><button type="button" class="em-action em-whitelist-retry" hidden><i class="fa-solid fa-rotate-right"></i> 重试失败</button><button type="button" class="em-action primary em-whitelist-update-all" hidden><i class="fa-solid fa-cloud-arrow-down"></i> 更新全部</button></div></div></div><div class="em-list-head em-whitelist-list-head"><div class="em-search-field em-whitelist-search-field"><i class="fa-solid fa-magnifying-glass"></i><input class="em-whitelist-search" type="search" placeholder="搜索白名单插件、分组或备注" aria-label="搜索白名单插件"></div><button type="button" class="em-action em-search-clear em-whitelist-search-clear" aria-label="取消白名单搜索" hidden><i class="fa-solid fa-xmark"></i><span>取消搜索</span></button><select class="em-category-filter em-whitelist-category" aria-label="按白名单分组筛选"><option value="">全部分组</option></select><select class="em-select em-whitelist-sort" aria-label="白名单排序方式"><option value="name">按首字母</option><option value="updated">按安装/更新时间</option><option value="enabled">按启用状态</option><option value="status">按检测状态</option></select><span class="em-count em-whitelist-count"></span><button type="button" class="em-action em-whitelist-multi-toggle" aria-pressed="false"><i class="fa-solid fa-square-check"></i><span>多选</span></button></div><div class="em-batch-toolbar em-whitelist-batch-toolbar" hidden></div><div class="em-list em-whitelist-list"></div><p class="em-install-status em-whitelist-legacy" hidden>当前管理后端不支持白名单，请更新后端并手动重启 SillyTavern。</p></div></section></main></div></div>`);
        const $float = $(`<button type="button" id="${FLOAT_ID}" class="em-float" title="点击展开扩展管理器，拖动调整位置" aria-label="点击展开扩展管理器，拖动调整位置" hidden><i class="em-float-state fa-solid fa-wand-magic-sparkles"></i></button>`);
        $('body').append($popup, $float);
        applyFloatingBallSize($popup);
        applyPrivacyMasking($popup);
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
        $popup.on('click', '.em-cancel-detection', function () { cancelDetection($popup); });
        $popup.on('click', '.em-error-toggle', function () {
            const $details = $(this).siblings('.em-error-details');
            const expanded = $details.prop('hidden');
            $details.prop('hidden', !expanded);
            $(this).attr('aria-expanded', expanded ? 'true' : 'false').html(`<i class="fa-solid fa-circle-exclamation"></i> ${expanded ? '收起报错' : '查看报错'}`);
        });
        $popup.on('click', '.em-copy-error', async function () {
            const scope = String($(this).attr('data-error-scope') || 'frontend');
            const id = String($(this).attr('data-error-id') || '');
            const report = buildErrorReport(scope, id);
            if (!report) return;
            try {
                await withButtonBusy($(this), '复制中', () => copyText(report));
                if (window.toastr) toastr.success('报错信息已复制');
            } catch (error) {
                if (window.toastr) toastr.error('复制失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-results-back', function () { closeDetectionResults($popup); });
        $popup.on('input', '.em-results-search', function () { detectionResults.filter = String($(this).val() || ''); renderDetectionResults($popup); });
        $popup.on('click', '.em-results-search-clear', function () { const $input = $popup.find('.em-results-search').val(''); detectionResults.filter = ''; renderDetectionResults($popup); $input.trigger('focus'); });
        $popup.on('click', '.em-results-multi-toggle', function () { detectionResults.selectionMode = !detectionResults.selectionMode; if (!detectionResults.selectionMode) detectionResults.selected.clear(); renderDetectionResults($popup); });
        $popup.on('change', '.em-result-card-choice', function () { const id = String($(this).attr('data-result-id') || ''); if (this.checked) detectionResults.selected.add(id); else detectionResults.selected.delete(id); renderDetectionResults($popup); });
        $popup.on('click', '.em-results-select-visible', function () { filteredDetectionResults().filter(entity => detectionResults.scope === 'backend' ? !isManagerBackendPlugin(entity) : typeOf(entity) !== 'system' && folderOf(entity).toLowerCase() !== getInstalledExtensionName().toLowerCase()).forEach(entity => detectionResults.selected.add(detectionResults.scope === 'backend' ? entity.id : folderOf(entity))); renderDetectionResults($popup); });
        $popup.on('click', '.em-results-clear', function () { detectionResults.selected.clear(); renderDetectionResults($popup); });
        $popup.on('click', '.em-results-recheck', function () { void checkDetectionResultIds(detectionResults.ids, $popup); });
        $popup.on('click', '.em-results-check-selected', function () { void checkDetectionResultIds(Array.from(detectionResults.selected), $popup); });
        $popup.on("click", ".em-results-uninstall-selected", function () { const targets = detectionResults.scope === "backend" ? backendUpdateState.plugins.filter(plugin => detectionResults.selected.has(plugin.id)) : state.extensions.filter(extension => detectionResults.selected.has(folderOf(extension))); if (detectionResults.scope === "backend") void uninstallBackendPluginsSequentially(targets, $popup); else void uninstallFrontendExtensionsSequentially(targets, $popup); });
        $popup.on('click', '.em-results-update-all', function () { void updateDetectionResultIds(detectionResults.ids, $popup); });
        $popup.on('click', '.em-results-update-selected', function () { void updateDetectionResultIds(Array.from(detectionResults.selected), $popup); });
        $popup.on('click', '.em-results-enable-selected', function () { void setDetectionResultEnabled(Array.from(detectionResults.selected), true, $popup); });
        $popup.on('click', '.em-results-disable-selected', function () { void setDetectionResultEnabled(Array.from(detectionResults.selected), false, $popup); });
        $popup.on('click', '.em-result-check-one', function () { void checkDetectionResultIds([String($(this).attr('data-result-id') || '')], $popup); });
        $popup.on('click', '.em-result-update-one', async function () {
            const id = String($(this).attr('data-result-id') || '');
            if (detectionResults.scope === 'backend') await updateBackendPlugin(id, $popup, { allowWhitelisted: detectionResults.allowWhitelisted });
            else {
                const extension = state.extensions.find(item => folderOf(item) === id);
                if (extension) await updateOne(extension, $popup, { allowWhitelisted: detectionResults.allowWhitelisted });
            }
            renderDetectionResults($popup);
        });
        $popup.on('click', '.em-result-toggle-one', function () { void setDetectionResultEnabled([String($(this).attr('data-result-id') || '')], String($(this).attr('data-enable')) === 'true', $popup); });
        $popup.on('click', '.em-open-tutorial', function () {
            $popup.find('.em-tutorial-page').html(renderTutorialHome());
            $popup.find('.em-tab').removeClass('active');
            $popup.find('.em-panel').removeClass('active');
            $popup.find('[data-panel="tutorial"]').addClass('active');
        });
        $popup.on('click', '.em-tutorial-open-category', function () {
            const sectionId = String($(this).attr('data-tutorial-section') || '');
            $popup.find('.em-tutorial-page').html(renderTutorialCategory(sectionId));
            const content = $popup.find('.em-content')[0];
            if (content) content.scrollTop = 0;
        });
        $popup.on('click', '.em-tutorial-category-back', function () {
            $popup.find('.em-tutorial-page').html(renderTutorialHome());
            const content = $popup.find('.em-content')[0];
            if (content) content.scrollTop = 0;
        });
        $popup.on('click', '.em-tutorial-back', function () {
            $popup.find('.em-panel').removeClass('active');
            $popup.find('[data-panel="install"]').addClass('active');
            $popup.find('.em-tab[data-tab="install"]').addClass('active');
            renderInstallPanel($popup);
        });
        $popup.on('click', '.em-open-faq', function () {
            $popup.find('.em-tab').removeClass('active');
            $popup.find('.em-panel').removeClass('active');
            $popup.find('[data-panel="faq"]').addClass('active');
        });
        $popup.on('click', '.em-open-changelog', function () {
            $popup.find('.em-tab').removeClass('active');
            $popup.find('.em-panel').removeClass('active');
            $popup.find('[data-panel="changelog"]').addClass('active');
        });
        $popup.on('click', '.em-changelog-back', function () {
            $popup.find('.em-panel').removeClass('active');
            $popup.find('[data-panel="install"]').addClass('active');
            $popup.find('.em-tab[data-tab="install"]').addClass('active');
            renderInstallPanel($popup);
        });
        $popup.on('click', '.em-faq-back', function () {
            $popup.find('.em-panel').removeClass('active');
            $popup.find('[data-panel="install"]').addClass('active');
            $popup.find('.em-tab[data-tab="install"]').addClass('active');
            renderInstallPanel($popup);
        });
        $popup.on('click', '.em-faq-question', function () {
            if ($(this).hasClass('em-tutorial-open-category')) return;
            const $answer = $(this).siblings('.em-faq-answer');
            const expanded = $answer.prop('hidden');
            $answer.prop('hidden', !expanded);
            $(this).attr('aria-expanded', expanded ? 'true' : 'false').find('.em-faq-chevron').toggleClass('fa-chevron-right', !expanded).toggleClass('fa-chevron-down', expanded);
        });
        $popup.on('click', '.em-tab', function () { detectionResults.active = false; detectionResults.selected.clear(); detectionResults.selectionMode = false; const tab = $(this).data('tab'); $popup.find('.em-tab').removeClass('active'); $(this).addClass('active'); $popup.find('.em-panel').removeClass('active'); $popup.find(`[data-panel="${tab}"]`).addClass('active'); if (tab === 'backend') void loadBackendPlugins($popup); });
        $popup.on('input', '.em-search', function () { state.filter = String($(this).val() || ''); renderList($popup); });
        $popup.on('click', '.em-frontend-search-clear', function () { const $input = $popup.find('.em-search').val(''); state.filter = ''; renderList($popup); $input.trigger('focus'); });
        $popup.on('change', '.em-sort', function () { state.sort = $(this).val(); state.statusSortActive = false; renderList($popup); });
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
        $popup.on("click", ".em-group-check", function () {
            void checkFrontendGroup(String($(this).attr("data-group") || ""), $popup);
        });
        $popup.on("click", ".em-group-update", function () { void updateFrontendGroup(String($(this).attr("data-group") || ""), $popup); });
        $popup.on('click', '.em-group-whitelist', async function () {
            const group = String($(this).attr('data-group') || '');
            const ids = state.extensions.filter(extension => isExternal(extension) && groupOf(extension) === group).map(folderOf);
            try {
                await withButtonBusy($(this), '处理中', () => changeWhitelist('frontend', ids, true, $popup));
            } catch (error) {
                if (window.toastr) toastr.error('整组加入白名单失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-group-add', function () { const group = $(this).data('group'); state.groupPicker = group; state.groupPickerSelections.clear(); state.expandedGroups.add(group); renderList($popup); });
        $popup.on('click', '.em-group-cancel', function () { state.groupPicker = ''; state.groupPickerSelections.clear(); renderList($popup); });
        $popup.on('change', '.em-group-choice input[data-folder]', function () { const folder = $(this).data('folder'); if (this.checked) state.groupPickerSelections.add(folder); else state.groupPickerSelections.delete(folder); });
        $popup.on('click', '.em-group-add-save', async function () {
            const group = String($(this).data('group') || '');
            if (!state.groupPickerSelections.size) { if (window.toastr) toastr.info('请选择要加入分组的扩展'); return; }
            const assignments = Object.fromEntries(Array.from(state.groupPickerSelections, folder => [folder, group]));
            try {
                await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
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
                await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
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
                await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
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
        $popup.on('click', '.em-backend-search-clear', function () {
            const $input = $popup.find('.em-backend-search').val('');
            backendUpdateState.filter = '';
            renderBackendPluginList($popup);
            $input.trigger('focus');
        });
        $popup.on('change', '.em-backend-category-filter', function () {
            backendUpdateState.category = String($(this).val() || '');
            renderBackendPluginList($popup);
        });
        $popup.on('change', '.em-backend-sort', function () {
            backendUpdateState.sort = String($(this).val() || 'name');
            backendUpdateState.statusSortActive = false;
            renderBackendPluginList($popup);
        });
        $popup.on('change', '.em-results-sort', function () {
            detectionResults.sort = String($(this).val() || 'status');
            renderDetectionResults($popup);
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
        $popup.on("click", ".em-check-selected-backend", () => { void withBatchAction(backendUpdateState, "checking", () => renderBackendPluginList($popup), () => checkSelectedBackendPlugins($popup)); });
        $popup.on("click", ".em-update-selected-backend", () => { void withBatchAction(backendUpdateState, "updating", () => renderBackendPluginList($popup), () => updateSelectedBackendPlugins($popup)); });
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
            const selected = regularBackendPlugins().filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id));
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
                await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
                backendUpdateState.expandedGroups.add(group || '未分组');
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success(group ? '已将 ' + selected.length + ' 个后端插件加入分组：' + group : '已将 ' + selected.length + ' 个后端插件移至未分组');
            } catch (error) {
                $button.prop('disabled', false);
                if (window.toastr) toastr.error('批量分组失败：' + (error.message || error));
            }
        });
        $popup.on("click", ".em-backend-group-check", function () {
            void checkBackendGroup(String($(this).attr("data-group") || ""), $popup);
        });
        $popup.on("click", ".em-backend-group-update", function () {
            void updateBackendGroup(String($(this).attr("data-group") || ""), $popup);
        });
        $popup.on('click', '.em-backend-group-whitelist', async function () {
            const group = String($(this).attr('data-group') || '');
            const ids = regularBackendPlugins().filter(plugin => backendGroupOf(plugin) === group).map(plugin => plugin.id);
            try {
                await withButtonBusy($(this), '处理中', () => changeWhitelist('backend', ids, true, $popup));
            } catch (error) {
                if (window.toastr) toastr.error('整组加入白名单失败：' + (error.message || error));
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
                await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
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
            const assignments = Object.fromEntries(regularBackendPlugins().filter(plugin => backendGroupOf(plugin) === group).map(plugin => [plugin.id, nextGroup]));
            try {
                await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
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
            const assignments = Object.fromEntries(regularBackendPlugins().filter(plugin => backendGroupOf(plugin) === group).map(plugin => [plugin.id, '']));
            try {
                await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
                backendUpdateState.expandedGroups.delete(group);
                backendUpdateState.expandedGroups.add('未分组');
                if (backendUpdateState.category === group) backendUpdateState.category = '';
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success('后端分组已解散：' + group);
            } catch (error) {
                if (window.toastr) toastr.error('解散失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-check-backend-self', () => { void checkBackendSelfUpdate($popup); });
        $popup.on('click', '.em-update-backend-self', () => { void updateBackendSelf($popup); });
        $popup.on('click', '.em-check-backend', () => checkBackendUpdate($popup));
        $popup.on('click', '.em-retry-backend', () => retryFailedBackend($popup));
        $popup.on('click', '.em-update-backend', () => updateBackend($popup));
        $popup.on('click', '.em-update-backend-plugin', function () { void updateBackendPlugin(String($(this).attr('data-plugin-id') || ''), $popup); });
        $popup.on('click', '.em-check-all', () => checkAll($popup));
        $popup.on('click', '.em-retry-frontend', () => retryFailedFrontend($popup));
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
                await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
                renderList($popup);
                if (window.toastr) toastr.success(group ? `已将 ${selected.length} 个扩展加入分组：${group}` : `已将 ${selected.length} 个扩展移至未分组`);
            } catch (error) {
                if (window.toastr) toastr.error(`批量分组失败：${error.message || error}`);
                $button.prop('disabled', false);
            }
        });
        $popup.on('click', '.em-whitelist-frontend-selected', async function () {
            const ids = state.extensions.filter(extension => state.selectedExtensions.has(folderOf(extension)) && typeOf(extension) !== 'system').map(folderOf);
            try { await withButtonBusy($(this), "处理中", () => changeWhitelist('frontend', ids, true, $popup)); }
            catch (error) { if (window.toastr) toastr.error(`加入白名单失败：${error.message || error}`); }
        });
        $popup.on('click', '.em-whitelist-backend-selected', async function () {
            const ids = regularBackendPlugins().filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id)).map(plugin => plugin.id);
            try { await withButtonBusy($(this), "处理中", () => changeWhitelist('backend', ids, true, $popup)); }
            catch (error) { if (window.toastr) toastr.error(`加入白名单失败：${error.message || error}`); }
        });
        $popup.on("click", ".em-enable-selected", () => { void withBatchAction(state, "enabling", () => renderBatchSelection($popup), () => setSelectedEnabled($popup, true)); });
        $popup.on("click", ".em-disable-selected", () => { void withBatchAction(state, "disabling", () => renderBatchSelection($popup), () => setSelectedEnabled($popup, false)); });
        $popup.on("click", ".em-check-selected", () => { void withBatchAction(state, "checking", () => renderBatchSelection($popup), () => checkSelected($popup)); });
        $popup.on("click", ".em-update-all", () => updateAll($popup));
        $popup.on("click", ".em-uninstall-selected", function () { const targets = selectedExternalExtensions(); void uninstallFrontendExtensionsSequentially(targets, $popup); });
        $popup.on("click", ".em-uninstall-selected-backend", function () { const targets = regularBackendPlugins().filter(plugin => backendUpdateState.selectedPlugins.has(plugin.id)); void uninstallBackendPluginsSequentially(targets, $popup); });
        $popup.on("click", ".em-update-selected", () => { void withBatchAction(state, "updating", () => renderBatchSelection($popup), () => updateSelectedSequentially($popup)); });
        $popup.on('click', '.em-open-whitelist', () => openWhitelistPanel($popup));
        $popup.on('click', '.em-whitelist-back', () => closeWhitelistPanel($popup));
        $popup.on('click', '.em-whitelist-scope', async function (event) {
            event.preventDefault();
            event.stopPropagation();
            whitelistState.scope = String($(this).attr('data-scope')) === 'backend' ? 'backend' : 'frontend';
            whitelistState.selected.clear();
            whitelistState.filter = '';
            whitelistState.category = '';
            whitelistState.sort = 'name';
            whitelistState.selectionMode = false;
            whitelistState.groupPicker = '';
            whitelistState.groupPickerSelections.clear();
            if (whitelistState.scope === 'backend' && state.backend.available && !backendUpdateState.plugins.length) await loadBackendPlugins($popup);
            renderWhitelistPanel($popup);
        });
        $popup.on('input', '.em-whitelist-search', function () {
            whitelistState.filter = String($(this).val() || '');
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-search-clear', function () {
            const $input = $popup.find('.em-whitelist-search').val('');
            whitelistState.filter = '';
            renderWhitelistPanel($popup);
            $input.trigger('focus');
        });
        $popup.on('change', '.em-whitelist-category', function () {
            whitelistState.category = String($(this).val() || '');
            renderWhitelistPanel($popup);
        });
        $popup.on('change', '.em-whitelist-sort', function () {
            whitelistState.sort = String($(this).val() || 'name');
            whitelistState.statusSortActive = false;
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-multi-toggle', function () {
            whitelistState.selectionMode = !whitelistState.selectionMode;
            if (!whitelistState.selectionMode) whitelistState.selected.clear();
            renderWhitelistPanel($popup);
        });
        $popup.on('change', '.em-whitelist-card-choice', function () {
            const id = String($(this).attr('data-whitelist-id') || '');
            if (this.checked) whitelistState.selected.add(id);
            else whitelistState.selected.delete(id);
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-select-visible', function () {
            filteredWhitelistEntries().forEach(entry => whitelistState.selected.add(entry.id));
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-clear', function () {
            whitelistState.selected.clear();
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-check-all', function () {
            void checkWhitelistPlugins(whitelistEntries().filter(entry => entry.entity).map(entry => entry.id), $popup, { showResults: true, resultTitle: '白名单' + (whitelistState.scope === 'backend' ? '后端插件' : '前端扩展') + '检测结果' });
        });
        $popup.on('click', '.em-whitelist-retry', function () {
            void retryFailedWhitelist($popup);
        });
        $popup.on('click', '.em-whitelist-update-all', function () {
            void updateWhitelistPlugins(whitelistEntries().filter(entry => entry.entity).map(entry => entry.id), $popup);
        });
        $popup.on("click", ".em-whitelist-check-selected", function () { void withBatchAction(whitelistState, "checking", () => renderWhitelistPanel($popup), () => checkWhitelistPlugins(Array.from(whitelistState.selected), $popup, { showResults: true, resultTitle: '所选白名单' + (whitelistState.scope === 'backend' ? '后端插件' : '前端扩展') + '检测结果' })); });
        $popup.on("click", ".em-whitelist-uninstall-selected", function () { const targets = whitelistState.scope === "backend" ? backendUpdateState.plugins.filter(plugin => whitelistState.selected.has(plugin.id)) : state.extensions.filter(extension => whitelistState.selected.has(folderOf(extension))); if (whitelistState.scope === "backend") void uninstallBackendPluginsSequentially(targets, $popup); else void uninstallFrontendExtensionsSequentially(targets, $popup); });
        $popup.on("click", ".em-whitelist-update-selected", function () { void withBatchAction(whitelistState, "updating", () => renderWhitelistPanel($popup), () => updateWhitelistPlugins(Array.from(whitelistState.selected), $popup)); });
        $popup.on('click', '.em-whitelist-check-frontend', function () {
            void checkWhitelistPlugins([String($(this).attr('data-folder') || '')], $popup);
        });
        $popup.on('click', '.em-whitelist-update-frontend', function () {
            void updateWhitelistPlugins([String($(this).attr('data-folder') || '')], $popup);
        });
        $popup.on('click', '.em-whitelist-check-backend', function () {
            void checkWhitelistPlugins([String($(this).attr('data-plugin-id') || '')], $popup);
        });
        $popup.on('click', '.em-whitelist-update-backend', function () {
            void updateWhitelistPlugins([String($(this).attr('data-plugin-id') || '')], $popup);
        });
        $popup.on('click', '.em-whitelist-remove-one', async function () {
            const scope = String($(this).attr('data-scope') || whitelistState.scope);
            const id = String($(this).attr('data-whitelist-id') || '');
            try { await withButtonBusy($(this), "处理中", () => changeWhitelist(scope, [id], false, $popup)); }
            catch (error) { if (window.toastr) toastr.error(`移出白名单失败：${error.message || error}`); }
        });
        $popup.on('click', '.em-whitelist-remove-selected', async function () {
            try { await withButtonBusy($(this), "处理中", () => changeWhitelist(whitelistState.scope, Array.from(whitelistState.selected), false, $popup)); }
            catch (error) { if (window.toastr) toastr.error(`移出白名单失败：${error.message || error}`); }
        });
        $popup.on("click", ".em-whitelist-enable-selected", function () { void withBatchAction(whitelistState, "enabling", () => renderWhitelistPanel($popup), () => setWhitelistFrontendEnabled(Array.from(whitelistState.selected), true, $popup)); });
        $popup.on("click", ".em-whitelist-disable-selected", function () { void withBatchAction(whitelistState, "disabling", () => renderWhitelistPanel($popup), () => setWhitelistFrontendEnabled(Array.from(whitelistState.selected), false, $popup)); });
        $popup.on('click', '.em-whitelist-batch-group-save', async function () {
            const selected = whitelistEntries().filter(entry => entry.entity && whitelistState.selected.has(entry.id));
            if (!selected.length) {
                if (window.toastr) toastr.info('请先选择要分组的已安装插件');
                return;
            }
            let group = String($popup.find('.em-whitelist-batch-group').val() || '');
            if (group === '__new__') group = String(window.prompt('新分组名称') || '').trim();
            if (group === '__new__' || group === '内置' || group === '未安装') {
                if (window.toastr) toastr.error('该名称为系统保留分组');
                return;
            }
            if ($popup.find('.em-whitelist-batch-group').val() === '__new__' && !group) return;
            const assignments = Object.fromEntries(selected.map(entry => [entry.id, group === '未分组' ? '' : group]));
            try {
                if (whitelistState.scope === 'backend') await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
                else await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
                whitelistState.expandedGroups[whitelistState.scope].add(group || '未分组');
                renderWhitelistPanel($popup);
                renderList($popup);
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success(group ? `已加入分组：${group}` : '已移至未分组');
            } catch (error) {
                if (window.toastr) toastr.error(`批量分组失败：${error.message || error}`);
            }
        });
        $popup.on("click", ".em-whitelist-group-check", function () {
            const group = String($(this).attr("data-group") || "");
            if (whitelistState.scope === "backend") void checkBackendGroup(group, $popup, { allowWhitelisted: true, whitelistView: true });
            else void checkFrontendGroup(group, $popup, { allowWhitelisted: true, whitelistView: true });
        });
        $popup.on("click", ".em-whitelist-group-update", function () {
            const group = String($(this).attr("data-group") || "");
            if (whitelistState.scope === "backend") void updateBackendGroup(group, $popup, { allowWhitelisted: true, whitelistView: true });
            else void updateFrontendGroup(group, $popup, { allowWhitelisted: true, whitelistView: true });
        });
        $popup.on("click", ".em-whitelist-group-uninstall", function () { const group = String($(this).attr("data-group") || ""); const entries = whitelistEntries(whitelistState.scope).filter(entry => entry.group === group && entry.entity); const targets = entries.map(entry => entry.entity); if (whitelistState.scope === "backend") void uninstallBackendPluginsSequentially(targets, $popup); else void uninstallFrontendExtensionsSequentially(targets, $popup); });
        $popup.on('click', '.em-whitelist-group-remove', async function () {
            const group = String($(this).attr('data-group') || '');
            const ids = whitelistEntries(whitelistState.scope).filter(entry => entry.group === group).map(entry => entry.id);
            try {
                await withButtonBusy($(this), '处理中', () => changeWhitelist(whitelistState.scope, ids, false, $popup));
            } catch (error) {
                if (window.toastr) toastr.error('整组移出白名单失败：' + (error.message || error));
            }
        });
        $popup.on('click', '.em-whitelist-group-toggle', function () {
            const group = String($(this).attr('data-group') || '');
            const expanded = whitelistState.expandedGroups[whitelistState.scope];
            if (expanded.has(group)) expanded.delete(group);
            else expanded.add(group);
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-group-add', function () {
            whitelistState.groupPicker = String($(this).attr('data-group') || '');
            whitelistState.groupPickerSelections.clear();
            whitelistState.expandedGroups[whitelistState.scope].add(whitelistState.groupPicker);
            renderWhitelistPanel($popup);
        });
        $popup.on('click', '.em-whitelist-group-cancel', function () {
            whitelistState.groupPicker = '';
            whitelistState.groupPickerSelections.clear();
            renderWhitelistPanel($popup);
        });
        $popup.on('change', '.em-whitelist-group-choice input', function () {
            const id = String($(this).attr('data-whitelist-id') || '');
            if (this.checked) whitelistState.groupPickerSelections.add(id);
            else whitelistState.groupPickerSelections.delete(id);
        });
        $popup.on('click', '.em-whitelist-group-add-save', async function () {
            const group = String($(this).attr('data-group') || '');
            if (!whitelistState.groupPickerSelections.size) {
                if (window.toastr) toastr.info('请选择要加入分组的插件');
                return;
            }
            const assignments = Object.fromEntries(Array.from(whitelistState.groupPickerSelections, id => [id, group]));
            try {
                if (whitelistState.scope === 'backend') await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
                else await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
                whitelistState.groupPicker = '';
                whitelistState.groupPickerSelections.clear();
                whitelistState.expandedGroups[whitelistState.scope].add(group);
                renderWhitelistPanel($popup);
                renderList($popup);
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success(`已添加到分组：${group}`);
            } catch (error) {
                if (window.toastr) toastr.error(`添加失败：${error.message || error}`);
            }
        });
        $popup.on('click', '.em-whitelist-group-rename', async function () {
            const group = String($(this).attr('data-group') || '');
            const nextGroup = String(window.prompt('新的分组名称', group) || '').trim();
            if (!nextGroup || nextGroup === group) return;
            if (['内置', '未分组', '未安装'].includes(nextGroup)) {
                if (window.toastr) toastr.error('该名称为系统保留分组');
                return;
            }
            const assignments = whitelistState.scope === 'backend'
                ? Object.fromEntries(backendUpdateState.plugins.filter(plugin => backendGroupOf(plugin) === group).map(plugin => [plugin.id, nextGroup]))
                : Object.fromEntries(state.extensions.filter(extension => typeOf(extension) !== 'system' && groupOf(extension) === group).map(extension => [folderOf(extension), nextGroup]));
            try {
                if (whitelistState.scope === 'backend') await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
                else await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
                const expanded = whitelistState.expandedGroups[whitelistState.scope];
                expanded.delete(group);
                expanded.add(nextGroup);
                if (whitelistState.category === group) whitelistState.category = nextGroup;
                renderWhitelistPanel($popup);
                renderList($popup);
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success(`分组已重命名为：${nextGroup}`);
            } catch (error) {
                if (window.toastr) toastr.error(`重命名失败：${error.message || error}`);
            }
        });
        $popup.on('click', '.em-whitelist-group-dissolve', async function () {
            const group = String($(this).attr('data-group') || '');
            if (!window.confirm(`解散分组“${group}”？插件本身不会被修改。`)) return;
            const assignments = whitelistState.scope === 'backend'
                ? Object.fromEntries(backendUpdateState.plugins.filter(plugin => backendGroupOf(plugin) === group).map(plugin => [plugin.id, '']))
                : Object.fromEntries(state.extensions.filter(extension => typeOf(extension) !== 'system' && groupOf(extension) === group).map(extension => [folderOf(extension), '']));
            try {
                if (whitelistState.scope === 'backend') await withButtonBusy($(this), "处理中", () => updateBackendPluginGroups(assignments));
                else await withButtonBusy($(this), "处理中", () => updateExtensionGroups(assignments));
                const expanded = whitelistState.expandedGroups[whitelistState.scope];
                expanded.delete(group);
                expanded.add('未分组');
                if (whitelistState.category === group) whitelistState.category = '';
                renderWhitelistPanel($popup);
                renderList($popup);
                renderBackendPluginList($popup);
                if (window.toastr) toastr.success(`分组已解散：${group}`);
            } catch (error) {
                if (window.toastr) toastr.error(`解散失败：${error.message || error}`);
            }
        });
        $popup.on('pointerdown', '.em-setting-toggle', function () {
            const content = $popup.find('.em-content')[0];
            if (content) $popup.data('em-settings-scroll-top', content.scrollTop);
        });
        $popup.on('change', '.em-setting-toggle > input', function () {
            const content = $popup.find('.em-content')[0];
            const scrollTop = Number($popup.data('em-settings-scroll-top'));
            if (content && Number.isFinite(scrollTop)) requestAnimationFrame(() => { content.scrollTop = scrollTop; });
        });
        $popup.on('change', '.em-privacy-masking', function () {
            state.settings = writeLocalSettings(normalizeSettings({ ...state.settings, privacyMasking: this.checked }));
            applyPrivacyMasking($popup);
        });
        $popup.on('click', '.em-save-network-settings', function () { void saveDetectionSettings($popup, $(this)); });
        $popup.on('click', '.em-connect-backend', () => { void reconnectBackend($popup); });
        $popup.on('click', '.em-install-frontend', () => installFrontendExtension($popup));
        $popup.on('click', '.em-platform-option[data-platform]', function () {
            const platform = String($(this).data('platform') || 'termux');
            if (!Object.prototype.hasOwnProperty.call(BACKEND_INSTALL_COMMANDS, platform)) return;
            state.backendInstallPlatform = platform;
            renderInstallPanel($popup);
        });
        $popup.on("click", ".em-copy-backend-command", async function () {
            const $button = $(this);
            await withButtonBusy($button, "复制中", async () => {
                try {
                    await copyText(backendInstallCommand());
                    $popup.find(".em-manager-backend-status").removeClass("error").addClass("ok").text("安装命令已复制");
                    const target = state.backendInstallPlatform === "windows" ? "PowerShell" : "Termux";
                    if (window.toastr) toastr.success(`已复制，请粘贴到 ${target} 执行`);
                } catch (error) {
                    $popup.find(".em-manager-backend-status").removeClass("ok").addClass("error").text(`复制失败：${error.message || error}`);
                }
            });
        });
        $popup.on('click', '.em-check', async function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (!extension || state.checkingExtensions.has(folderOf(extension))) return; beginDetection($popup); try { const checking = checkOne(extension); renderList($popup); await checking; renderList($popup); } finally { finishDetection($popup); } });
        $popup.on('click', '.em-update', function () { const extension = state.extensions.find(item => folderOf(item) === $(this).data('folder')); if (extension) updateOne(extension, $popup); });
        $popup.on("click", ".em-uninstall", function () { const extension = state.extensions.find(item => folderOf(item) === String($(this).attr("data-folder") || "")); if (extension) void uninstallFrontendExtension(extension, $popup); });
        $popup.on("click", ".em-group-uninstall", function () { void uninstallFrontendGroup(String($(this).attr("data-group") || ""), $popup); });
        $popup.on("click", ".em-uninstall-backend", function () { void uninstallBackendPlugin(String($(this).attr("data-plugin-id") || ""), $popup); });
        $popup.on("click", ".em-backend-group-uninstall", function () { void uninstallBackendGroup(String($(this).attr("data-group") || ""), $popup); });
        $popup.on("click", ".em-toggle", async function () {
            const folder = String($(this).attr("data-folder") || "");
            const extension = state.extensions.find(item => folderOf(item) === folder);
            if (!extension || state.togglingExtensions.has(folder)) return;
            state.togglingExtensions.add(folder);
            renderList($popup);
            try {
                const enabled = $(this).attr("data-enable") === "true";
                await toggleExtensionHot(extension, enabled);
                if (window.toastr) toastr.success(extension.displayName + ' 已' + (enabled ? '启用' : '禁用') + '并在当前页面生效');
            } catch (error) {
                if (window.toastr) toastr.error(`切换失败：${error.message || error}`);
            } finally {
                state.togglingExtensions.delete(folder);
                renderList($popup);
                if ($popup.find("[data-panel=whitelist]").hasClass("active")) renderWhitelistPanel($popup);
            }
        });
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
                await saveFrontendMeta(nextMeta);
                const saved = state.meta[folder] || {};
                extension.zhName = saved.name || chineseValue(extension.manifest, ['display_name_zh', 'displayNameZh', 'zh_name', 'name_zh']);
                extension.note = saved.note || chineseValue(extension.manifest, ['description_zh', 'descriptionZh', 'zh_description', 'note_zh', 'remarks_zh']);
                extension.category = typeOf(extension) === 'system' ? '' : (saved.category || '');
                state.expandedGroups.add(groupOf(extension));
                extension.displayName = extension.zhName || extension.manifest.display_name || folder;
                extension.description = extension.note || extension.manifest.description || '暂无备注';
                renderList($popup);
                if (window.toastr) toastr.success(state.backend.available ? '中文资料已保存到酒馆后端' : '中文资料已保存到浏览器本地');
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
