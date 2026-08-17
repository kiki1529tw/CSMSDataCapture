(function (global) {
    'use strict';

    const App = global.MOHW_APP = global.MOHW_APP || {};
    App.UI = App.UI || {};

    (function () {
        const $ = s => document.querySelector(s);
        const $$ = s => [...document.querySelectorAll(s)];
        const STORAGE = {
            theme: 'mohw-theme',
            minimized: 'mohw-minimized',
            position: 'mohw-position'
        };
        const MARGIN = 10;
        const themes = {
            pink: { main: '#bda6a6', hover: '#a88f8f', border: '#d1c0c0', light: '#f4eeee' },
            green: { main: '#a3b18a', hover: '#8a9a5b', border: '#ccd5ae', light: '#f0f4e8' },
            purple: { main: '#a5a5bb', hover: '#8e8eab', border: '#c7c7d7', light: '#f0f0f5' },
            orange: { main: '#d9a986', hover: '#cc9266', border: '#ead1bf', light: '#fcf6f2' },
            yellow: { main: '#e3cc8a', hover: '#d9bc66', border: '#f0e3bf', light: '#fefaf0' },
            lightgreen: { main: '#bbbba5', hover: '#abab8e', border: '#d7d7c7', light: '#f5f5f0' },
            blue: { main: '#8ca6bd', hover: '#7592ad', border: '#b7c7d6', light: '#eff4f8' },
            redbrown: { main: '#bbaea5', hover: '#ab9b8e', border: '#d7cec7', light: '#f5f2f0' },
            graybrown: { main: '#b0b0b0', hover: '#9e9e9e', border: '#d0d0d0', light: '#f2f2f2' },
            gray: { main: '#a5b4bb', hover: '#8ea1ab', border: '#c7d1d7', light: '#f0f3f5' }
        };

        let currentTheme = null;
        let elapsedTimerId = null;
        let elapsedStart = 0;
        let elapsedPausedAt = 0; // 非0代表目前暫停中，記錄暫停當下的時間點

        App.UI.setTheme = function (name) {
            const theme = themes[name];
            if (!theme) return;
            currentTheme = name;
            const root = document.documentElement.style;
            root.setProperty('--theme-main', theme.main);
            root.setProperty('--theme-hover', theme.hover);
            root.setProperty('--theme-border', theme.border);
            root.setProperty('--theme-light', theme.light);
            localStorage.setItem(STORAGE.theme, name);
        };

        App.UI.randomTheme = function () {
            const keys = Object.keys(themes);
            let name;
            do {
                name = keys[Math.floor(Math.random() * keys.length)];
            } while (name === currentTheme && keys.length > 1);
            App.UI.setTheme(name);
        };

        App.UI.loadTheme = function () {
            const save = localStorage.getItem(STORAGE.theme);
            if (save && themes[save]) App.UI.setTheme(save);
            else App.UI.setTheme('blue');
        };

        App.UI.injectStyles = function () {
            if ($('#mohw-ui-style')) return;
            const style = document.createElement('style');
            style.id = 'mohw-ui-style';
            style.innerHTML = `
#mohw-panel {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 320px;
    z-index: 99999;
    background: #fdfcfc;
    border: 3px solid var(--theme-border);
    border-radius: 14px;
    padding: 18px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .08);
    font-family: "Microsoft JhengHei", "consolas";
    color: #5a5a5a;
    transition: width .3s ease, height .3s ease, border-radius .3s ease, padding .3s ease;
}
#mohw-panel.dragging { opacity: .95; cursor: move; }
#mohw-panel.minimized {
    width: 58px; height: 58px; padding: 0; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
}
#mohw-panel.minimized .mohw-content { display: none; }
.mohw-mini { display: none; font-size: 22px; font-weight: bold; color: var(--theme-main); }
#mohw-panel.minimized .mohw-mini { display: block; }
.mohw-header { display: flex; justify-content: space-between; align-items: center; font-size: 18px; cursor: move; }
#mohw-title { cursor: pointer; }
#mohw-title:hover { color: var(--theme-main); }
#mohw-collapse { border: none; background: none; cursor: pointer; font-size: 24px; color: #888; }
.mohw-item { margin-bottom: 12px; font-size: 14px; display: flex; align-items: center; }
.mohw-item label { margin-right: 5px; cursor: pointer; }
.mohw-input { width: 9rem; padding: 4px 8px; border-radius: 5px; text-align: center; border: 1px solid var(--theme-border); }
.mohw-date { width: 9rem; padding: 4px 8px; border-radius: 5px; text-align: center; border: 1px solid var(--theme-border); }
.mohw-date.mohw-input-error { border-color: #b06b6b; background: #fdf2f2; }
.mohw-type, .mohw-exporttype {
    margin-right: 5px !important; accent-color: var(--theme-main);
    width: 16px; height: 16px; vertical-align: text-bottom; cursor: pointer;
}
.mohw-exportbtn { margin-bottom: 12px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
.mohw-exportbtn button {
    width: 100%; padding: 12px; background: var(--theme-main); color: white;
    border: none; border-radius: 8px; cursor: pointer; font-size: 14px;
    letter-spacing: 1px; transition: background .3s, transform .3s;
}
.mohw-exportbtn button:hover { background: var(--theme-hover); transform: translateY(-1px); }
.mohw-exportbtn button:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.mohw-controlbtn { display: flex; gap: 8px; margin-bottom: 12px; }
.mohw-controlbtn button {
    flex: 1; padding: 10px; background: var(--theme-main); color: white;
    border: none; border-radius: 8px; cursor: pointer; font-size: 13px;
    transition: background .3s;
}
.mohw-controlbtn button:hover:not(:disabled) { background: var(--theme-hover); }
.mohw-controlbtn button:disabled { opacity: .5; cursor: not-allowed; }
#mohw-status { margin-top: 10px; font-size: 16px; font-weight: bold; }
.status-info { color: var(--theme-main); }
.status-success { color: #6c9a7e; }
.status-error { color: #b06b6b; }
hr { border: none; border-top: 1px solid var(--theme-border); margin: 1rem 0; }

.hidden { display:none; }
            `;
            document.head.appendChild(style);
        };

        App.UI.createPanel = function () {
            if ($('#mohw-panel')) return;
            App.UI.injectStyles();
            App.UI.loadTheme();

            const div = document.createElement('div');
            div.id = 'mohw-panel';
            div.innerHTML = `
        <div class="mohw-mini">📄</div>
        <div class="mohw-content">
            <div class="mohw-header">
                <b id="mohw-title">🗂️個案資料匯出</b>
                <button id="mohw-collapse">−</button>
            </div>
            <hr>
            <div class="mohw-item hidden">TOP筆數：<input id="mohw-top" class="mohw-input hidden" type="number"></div>
            <div class="mohw-item">
                日期：<input id="mohw-date" class="mohw-date">&nbsp;~&nbsp;<input id="mohw-date2" class="mohw-date">
            </div>
            <div class="mohw-item">
                計畫類型：
                <label><input class="mohw-type" type="checkbox" value="初評" checked>初評</label>
                <label><input class="mohw-type" type="checkbox" value="複評" checked>複評</label>
                <label><input class="mohw-type" type="checkbox" value="AA01" checked>重新擬定</label>
            </div>
            <div class="mohw-item">
                匯出類型：
                <label><input class="mohw-exporttype" type="checkbox" value="A" checked>照顧計畫</label>
                <label><input class="mohw-exporttype" type="checkbox" value="B" checked>電訪記錄</label>
            </div>
            <div class="mohw-item">併發數：<input id="mohw-concurrency" class="mohw-input" type="number" value="10" min="1" max="30"></div>
            <div class="mohw-item">已耗時：<span id="mohw-elapsed">00:00</span></div>
            <div class="mohw-exportbtn"><button id="mohw-start" disabled>匯出紀錄</button></div>
            <div class="mohw-controlbtn">
                <button id="mohw-pause" disabled>暫停</button>
                <button id="mohw-stop" disabled>停止</button>
            </div>
            <div id="mohw-status"></div>
        </div>
    `;
            document.body.appendChild(div);

            $('#mohw-date').value = MOHW_CORE.DateUtils.todayFirstDay();
            $('#mohw-date2').value = MOHW_CORE.DateUtils.todayLastDay();
            App.UI.bindDateValidation();

            App.UI.restorePosition();
            App.UI.pickAnchor();

            const minimized = localStorage.getItem(STORAGE.minimized);
            if (minimized === null || minimized === 'true') div.classList.add('minimized');

            div.addEventListener('click', () => {
                if (div.classList.contains('minimized')) App.UI.expand();
            });

            $('#mohw-collapse').addEventListener('click', e => {
                e.stopPropagation();
                App.UI.minimize();
            });

            $('#mohw-title').addEventListener('click', e => {
                e.stopPropagation();
                App.UI.randomTheme();
            });

            App.UI.enableDrag(div);
            window.addEventListener('resize', () => App.UI.clampToViewport());
        };

        App.UI.minimize = function () {
            const panel = $('#mohw-panel');
            if (!panel) return;
            panel.classList.add('minimized');
            localStorage.setItem(STORAGE.minimized, 'true');
        };

        App.UI.expand = function () {
            const panel = $('#mohw-panel');
            if (!panel) return;
            panel.classList.remove('minimized');
            localStorage.setItem(STORAGE.minimized, 'false');
        };

        App.UI.toggle = function () {
            const panel = $('#mohw-panel');
            if (panel.classList.contains('minimized')) App.UI.expand();
            else App.UI.minimize();
        };

        App.UI.pickAnchor = function () {
            const panel = $('#mohw-panel');
            if (!panel) return;
            const rect = panel.getBoundingClientRect();

            const distLeft = rect.left;
            const distRight = window.innerWidth - rect.right;
            if (distRight < distLeft) {
                panel.style.right = Math.max(MARGIN, distRight) + 'px';
                panel.style.left = 'auto';
            } else {
                panel.style.left = Math.max(MARGIN, distLeft) + 'px';
                panel.style.right = 'auto';
            }

            const distTop = rect.top;
            const distBottom = window.innerHeight - rect.bottom;
            if (distBottom < distTop) {
                panel.style.bottom = Math.max(MARGIN, distBottom) + 'px';
                panel.style.top = 'auto';
            } else {
                panel.style.top = Math.max(MARGIN, distTop) + 'px';
                panel.style.bottom = 'auto';
            }
        };

        App.UI.enableDrag = function (panel) {
            let startX = 0, startY = 0, startLeft = 0, startTop = 0;
            let dragging = false;
            let rafId = null;
            let pendingX = 0, pendingY = 0;

            panel.addEventListener('mousedown', e => {
                if (['BUTTON', 'INPUT', 'LABEL'].includes(e.target.tagName)) return;

                const isMinimized = panel.classList.contains('minimized');
                const grabbedHeader = e.target.closest('.mohw-header');
                if (!isMinimized && !grabbedHeader) return;

                dragging = true;
                const rect = panel.getBoundingClientRect();
                startX = e.clientX;
                startY = e.clientY;
                startLeft = rect.left;
                startTop = rect.top;
                panel.style.left = startLeft + 'px';
                panel.style.top = startTop + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.classList.add('dragging');
                e.preventDefault();
            });

            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                pendingX = startLeft + (e.clientX - startX);
                pendingY = startTop + (e.clientY - startY);
                if (rafId === null) {
                    rafId = requestAnimationFrame(() => {
                        panel.style.left = pendingX + 'px';
                        panel.style.top = pendingY + 'px';
                        rafId = null;
                    });
                }
            }, { passive: true });

            document.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                panel.classList.remove('dragging');
                App.UI.pickAnchor();
                App.UI.savePosition();
            });
        };

        App.UI.savePosition = function () {
            const panel = $('#mohw-panel');
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            localStorage.setItem(STORAGE.position, JSON.stringify({ left: rect.left, top: rect.top }));
        };

        App.UI.restorePosition = function () {
            const panel = $('#mohw-panel');
            const save = localStorage.getItem(STORAGE.position);
            if (!save) return;
            try {
                const pos = JSON.parse(save);
                if (typeof pos.left === 'number') {
                    panel.style.left = pos.left + 'px';
                    panel.style.right = 'auto';
                }
                if (typeof pos.top === 'number') {
                    panel.style.top = pos.top + 'px';
                    panel.style.bottom = 'auto';
                }
            } catch (e) {
                console.error('restore position error', e);
            }
        };

        App.UI.clampToViewport = function () {
            const panel = $('#mohw-panel');
            if (!panel) return;
            const rect = panel.getBoundingClientRect();

            if (panel.style.right && panel.style.right !== 'auto') {
                const maxRight = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
                const current = window.innerWidth - rect.right;
                panel.style.right = Math.min(Math.max(current, MARGIN), maxRight) + 'px';
            } else if (panel.style.left && panel.style.left !== 'auto') {
                const maxLeft = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
                panel.style.left = Math.min(Math.max(rect.left, MARGIN), maxLeft) + 'px';
            }

            if (panel.style.bottom && panel.style.bottom !== 'auto') {
                const maxBottom = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
                const current = window.innerHeight - rect.bottom;
                panel.style.bottom = Math.min(Math.max(current, MARGIN), maxBottom) + 'px';
            } else if (panel.style.top && panel.style.top !== 'auto') {
                const maxTop = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
                panel.style.top = Math.min(Math.max(rect.top, MARGIN), maxTop) + 'px';
            }
        };

        App.UI.status = function (msg, type) {
            type = type || 'info';
            const el = $('#mohw-status');
            if (!el) return;
            el.className = 'status-' + type;
            el.innerText = msg;
        };

        App.UI.setLoading = function (loading) {
            const btn = $('#mohw-start');
            if (!btn) return;
            btn.disabled = loading;
            btn.innerText = loading ? '抓取中...' : '開始抓取';
        };

        App.UI.getConfig = function () {
            return {
                top: parseInt($('#mohw-top').value) || 'hidden',
                date: $('#mohw-date').value,
                date2: $('#mohw-date2').value,
                concurrency: parseInt($('#mohw-concurrency').value) || 10,
                types: $$('.mohw-type').filter(x => x.checked).map(x => x.value)
            };
        };

        /********************
         * 執行狀態控制：idle / running / paused 三種狀態切換按鈕的可用性與文字
         ********************/
        App.UI.setRunningState = function (state) {
            const startBtn = $('#mohw-start');
            const pauseBtn = $('#mohw-pause');
            const stopBtn = $('#mohw-stop');
            if (!startBtn || !pauseBtn || !stopBtn) return;

            if (state === 'idle') {
                startBtn.disabled = !TimeLimit.Holidays.isReady();
                startBtn.innerText = '匯出紀錄';
                pauseBtn.disabled = true;
                pauseBtn.innerText = '暫停';
                stopBtn.disabled = true;
            } else if (state === 'running') {
                startBtn.disabled = true;
                startBtn.innerText = '抓取中...';
                pauseBtn.disabled = false;
                pauseBtn.innerText = '暫停';
                stopBtn.disabled = false;
            } else if (state === 'paused') {
                pauseBtn.innerText = '繼續';
            }
        };

        // 相容舊呼叫：部分文件/流程仍會呼叫 setLoading，這裡轉呼叫新的狀態機
        App.UI.setLoading = function (loading) {
            App.UI.setRunningState(loading ? 'running' : 'idle');
        };

        /********************
         * 國定假日就緒狀態：影響「開始抓取」按鈕能不能按
         ********************/
        App.UI.setHolidaysReady = function (ready, message) {
            const startBtn = $('#mohw-start');
            if (!startBtn) return;
            startBtn.disabled = !ready;
            if (!ready && message) App.UI.status(message, 'error');
        };

        /********************
         * 已耗時計時器
         ********************/
        App.UI.startElapsedTimer = function () {
            elapsedStart = Date.now();
            elapsedPausedAt = 0;
            App.UI.updateElapsed();
            elapsedTimerId = setInterval(App.UI.updateElapsed, 1000);
        };

        // 暫停時：停止累加，記下暫停的當下時間點
        App.UI.pauseElapsedTimer = function () {
            if (elapsedTimerId) {
                clearInterval(elapsedTimerId);
                elapsedTimerId = null;
            }
            elapsedPausedAt = Date.now();
        };

        // 繼續時：把「暫停期間經過的時間」直接平移到 elapsedStart 上，
        // 這樣暫停的這段時間就不會被算進已耗時，畫面上的數字會停在暫停當下，不會跳動。
        App.UI.resumeElapsedTimer = function () {
            if (elapsedPausedAt) {
                elapsedStart += (Date.now() - elapsedPausedAt);
                elapsedPausedAt = 0;
            }
            App.UI.updateElapsed();
            elapsedTimerId = setInterval(App.UI.updateElapsed, 1000);
        };

        App.UI.stopElapsedTimer = function () {
            if (elapsedTimerId) clearInterval(elapsedTimerId);
            elapsedTimerId = null;
            elapsedPausedAt = 0;
        };

        App.UI.updateElapsed = function () {
            const el = $('#mohw-elapsed');
            if (!el) return;
            const sec = Math.floor((Date.now() - elapsedStart) / 1000);
            const mm = String(Math.floor(sec / 60)).padStart(2, '0');
            const ss = String(sec % 60).padStart(2, '0');
            el.innerText = `${mm}:${ss}`;
        };

        /********************
         * 日期輸入防呆：失焦時驗證，民國/西元皆可、全形數字自動轉換
         ********************/
        App.UI.bindDateValidation = function () {
            ['#mohw-date', '#mohw-date2'].forEach(sel => {
                const input = $(sel);
                if (!input) return;
                input.addEventListener('blur', () => {
                    const normalized = MOHW_CORE.DateUtils.normalizeDateInput(input.value);
                    if (normalized === null) {
                        input.classList.add('mohw-input-error');
                        App.UI.status('日期輸入錯誤，請重新輸入(範例：114/06/02)', 'error');
                    } else {
                        input.value = normalized;
                        input.classList.remove('mohw-input-error');
                    }
                });
            });
        };
    })();
})(window);