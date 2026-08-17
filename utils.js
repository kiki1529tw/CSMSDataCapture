(function (global) {
    'use strict';

    global.MOHW_CORE = global.MOHW_CORE || {};
    global.TimeLimit = global.TimeLimit || {};

    /********************
     * Common：log / sleep / 全域設定 / retryOnce（通用「失敗重試一次」包裝）
     ********************/
    (function () {
        const Config = { debug: true, delay: 100 };

        function log(...args) {
            if (Config.debug) console.log('[LCMS]', ...args);
        }

        function sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        // 通用的「失敗重試一次」包裝。
        // 使用者主動停止(AbortError / StopError)不算「失敗」，不重試，直接往上丟讓呼叫端知道是被中止的。
        // 這支函式本身不知道自己在重試「照顧計畫」還是「電訪」，純粹是執行策略，屬於共用工具。
        async function retryOnce(fn) {
            try {
                return await fn();
            } catch (e) {
                if (isAbortLike(e)) throw e;
                log('第一次執行失敗，自動重試一次:', e);
                return await fn();
            }
        }

        function isAbortLike(e) {
            if (!e) return false;
            if (e.name === 'AbortError') return true;
            // ExecutionControl 定義在本檔案稍後的區塊，這裡用延遲讀取避免模組順序問題
            const StopError = global.MOHW_CORE.ExecutionControl && global.MOHW_CORE.ExecutionControl.StopError;
            return StopError && e instanceof StopError;
        }

        global.MOHW_CORE.Common = { Config, log, sleep, retryOnce };
    })();

    /********************
     * DateUtils：ROC日期解析 + 通用日期運算 + 日期比較 + 使用者輸入防呆
     ********************/
    (function () {
        const MS_PER_DAY = 24 * 60 * 60 * 1000;

        function toDate(input) {
            return input instanceof Date ? new Date(input.getTime()) : new Date(input);
        }

        function atMidnight(date) {
            const d = toDate(date);
            d.setHours(0, 0, 0, 0);
            return d;
        }

        function addDays(date, n) {
            const d = toDate(date);
            d.setDate(d.getDate() + n);
            return d;
        }

        function isWeekend(date) {
            const day = toDate(date).getDay();
            return day === 0 || day === 6;
        }

        function sameCalendarDay(a, b) {
            return atMidnight(a).getTime() === atMidnight(b).getTime();
        }

        // 嚴格超過中午12:00:00 (12:00:01以後才算)
        function isAfterNoon(date) {
            const d = toDate(date);
            const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
            return h > 12 || (h === 12 && (m > 0 || s > 0));
        }

        // 找下一個「工作日」。是否為工作日的判斷方式由外部傳入，
        // 避免 DateUtils（純日期運算）反過來依賴 Holidays 或業務規則。
        function nextWorkday(date, isWorkdayFn) {
            let d = addDays(date, 1);
            while (!isWorkdayFn(d)) {
                d = addDays(d, 1);
            }
            return d;
        }

        // "114/06/02" -> Date
        function parseROCDate(str) {
            if (!str) return null;
            const m = String(str).match(/(\d{3})\/(\d{2})\/(\d{2})/);
            if (!m) return null;
            return new Date(Number(m[1]) + 1911, Number(m[2]) - 1, Number(m[3]));
        }

        // "114/06/02 13:05:00" -> DateTime
        function parseROCDateTime(str) {
            if (!str) return null;
            const m = String(str).match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/);
            if (!m) return null;
            return new Date(
                Number(m[1]) + 1911, Number(m[2]) - 1, Number(m[3]),
                Number(m[4]), Number(m[5]), Number(m[6])
            );
        }

        function formatROC(date, day) {
            const y = date.getFullYear() - 1911;
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(day ?? date.getDate()).padStart(2, '0');
            return `${y}/${mm}/${dd}`;
        }

        function todayFirstDay() {
            return formatROC(new Date(), 1);
        }

        function todayLastDay() {
            const d = new Date();
            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            return formatROC(d, lastDay);
        }

        // 統一的 ROC 日期比較：回傳 -1 / 0 / 1，任一邊解析失敗回傳 null
        function compareROCDate(str1, str2) {
            const a = parseROCDate(str1);
            const b = parseROCDate(str2);
            if (!a || !b) return null;
            if (a.getTime() === b.getTime()) return 0;
            return a > b ? 1 : -1;
        }

        function isDateAfter(str1, str2) { // date1 >= date2
            const c = compareROCDate(str1, str2);
            return c !== null && c >= 0;
        }

        function isDateBefore(str1, str2) { // date1 <= date2
            const c = compareROCDate(str1, str2);
            return c !== null && c <= 0;
        }

        // 全形數字/全形斜線轉半形，供使用者輸入防呆使用
        function toHalfWidth(str) {
            return String(str)
                .replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
                .replace(/\uFF0F/g, '/');
        }

        // 使用者輸入防呆：接受民國(3碼年)或西元(4碼年)，格式必須是 年/月/日(以 / 分隔)。
        // 全形數字會自動轉半形；文字、其他分隔符號、不存在的日期(例如2/30)一律視為無效，回傳 null。
        // 驗證通過一律正規化回內部統一使用的民國格式字串，之後的比較函式完全不用改。
        function normalizeDateInput(str) {
            if (!str) return null;
            const half = toHalfWidth(str).trim();
            const m = half.match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/);
            if (!m) return null;

            const rawYear = Number(m[1]);
            const month = Number(m[2]);
            const day = Number(m[3]);
            if (month < 1 || month > 12) return null;

            // 4碼年一律視為西元，換算成民國；3碼年視為民國原值
            const rocYear = rawYear >= 1000 ? rawYear - 1911 : rawYear;
            if (rocYear < 1) return null;

            // 用 Date 物件的自動進位特性反查：如果輸入的日期本身不存在(例如2/30、13月)，
            // 轉出來的年月日會跟輸入不一致，藉此擋掉不合法的日期
            const gYear = rocYear + 1911;
            const check = new Date(gYear, month - 1, day);
            if (check.getFullYear() !== gYear || check.getMonth() !== month - 1 || check.getDate() !== day) {
                return null;
            }

            return `${rocYear}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        }

        global.MOHW_CORE.DateUtils = {
            MS_PER_DAY, toDate, atMidnight, addDays, isWeekend, sameCalendarDay,
            isAfterNoon, nextWorkday,
            parseROCDate, parseROCDateTime, formatROC, todayFirstDay, todayLastDay,
            compareROCDate, isDateAfter, isDateBefore,
            normalizeDateInput
        };
    })();

    /********************
     * DomUtils：表格/頁籤內容擷取的共用小工具
     ********************/
    (function () {
        function getLines(td) {
            return [...td.childNodes].map(n => n.textContent.trim()).filter(Boolean);
        }

        function findRowByKeyword(doc, keyword) {
            const rows = [...doc.querySelectorAll('tr')];
            const row = rows.find(tr => tr.innerText.replace(/\s+/g, ' ').trim().includes(keyword));
            if (!row) return null;
            return [...row.querySelectorAll('td')];
        }

        function getFirstLineByKeyword(doc, keyword, tdIndex = 0) {
            const tds = findRowByKeyword(doc, keyword);
            if (!tds || !tds[tdIndex]) return '';
            const lines = getLines(tds[tdIndex]);
            return lines[0] ? lines[0].trim() : '';
        }

        function getCarePlanData(doc, tab, filtertext) {
            const links = [...doc.querySelectorAll('li[role="presentation"] a')];
            const targetLink = links.find(a => a.innerText.trim() === tab);
            if (!targetLink) {
                global.MOHW_CORE.Common.log(`找不到「${tab}」頁籤標籤`);
                return null;
            }

            const href = targetLink.getAttribute('href');
            if (!href || !href.startsWith('#')) {
                global.MOHW_CORE.Common.log(`「${tab}」標籤未包含有效的 hash href:${href}`);
                return null;
            }

            const targetId = href.substring(1);
            const targetDiv = doc.getElementById(targetId) || doc.querySelector(href);
            if (!targetDiv) {
                global.MOHW_CORE.Common.log(`找不到 ID 為 ${targetId} 的 div 容器`);
                return null;
            }

            const matchedElement = [...targetDiv.querySelectorAll('tr')]
                .find(el => el.textContent.includes(filtertext));

            if (matchedElement) {
                const tds = [...matchedElement.querySelectorAll('td')];
                if (tds.length >= 1) return getLines(tds[0]);
                return matchedElement.innerText.replace(/\s+/g, ' ').trim();
            }

            global.MOHW_CORE.Common.log(`在 ID ${targetId} 容器內找不到文字「${filtertext}」`);
            return null;
        }

        global.MOHW_CORE.DomUtils = { getLines, findRowByKeyword, getFirstLineByKeyword, getCarePlanData };
    })();

    /********************
     * HttpClient：統一的 fetch + credentials 處理，支援 AbortSignal 讓「停止」可以真正中止飛行中的請求
     ********************/
    (function () {
        async function fetchHtmlDoc(url, signal) {
            global.MOHW_CORE.Common.log('Fetch HTML:', url);
            const res = await fetch(url, { credentials: 'include', signal });
            if (!res.ok) throw new Error(`fetchHtmlDoc ${url} -> ${res.status}`);
            const html = await res.text();
            return new DOMParser().parseFromString(html, 'text/html');
        }

        async function fetchJson(url, signal) {
            global.MOHW_CORE.Common.log('Fetch JSON:', url);
            const res = await fetch(url, { credentials: 'include', signal });
            if (!res.ok) throw new Error(`fetchJson ${url} -> ${res.status}`);
            return res.json();
        }

        global.MOHW_CORE.HttpClient = { fetchHtmlDoc, fetchJson };
    })();

    /********************
     * XhrCapture：XHR hook + 單次認領 capture 機制
     ********************/
    (function () {
        let pendingCapture = null;

        function initHook(root) {
            if (root.LCMS_XHR_HOOKED) return;
            root.LCMS_XHR_HOOKED = true;
            const open = root.XMLHttpRequest.prototype.open;
            const send = root.XMLHttpRequest.prototype.send;

            root.XMLHttpRequest.prototype.open = function (method, url) {
                this._lcmsUrl = url;
                if (pendingCapture && url.includes(pendingCapture.urlMatch)) {
                    this._lcmsCapture = pendingCapture;
                    pendingCapture = null;
                }
                return open.apply(this, arguments);
            };

            root.XMLHttpRequest.prototype.send = function () {
                this.addEventListener('load', () => {
                    if (!this._lcmsCapture) return;
                    try {
                        const json = JSON.parse(this.responseText);
                        this._lcmsCapture.resolve({ json, url: this._lcmsUrl });
                    } catch (e) {
                        this._lcmsCapture.reject(e);
                    }
                });
                return send.apply(this, arguments);
            };
        }

        function hookFrames() {
            initHook(window);
            document.querySelectorAll('iframe').forEach(frame => {
                try { initHook(frame.contentWindow); } catch (e) { /* 跨網域 iframe，略過 */ }
            });
        }

        function observeFrames() {
            hookFrames();
            new MutationObserver(hookFrames).observe(document.body, { childList: true, subtree: true });
        }

        function waitForRequest(urlMatch) {
            return new Promise((resolve, reject) => {
                pendingCapture = { urlMatch, resolve, reject };
            });
        }

        global.MOHW_CORE.XhrCapture = { observeFrames, waitForRequest };
    })();

    /********************
     * Csv：陣列轉CSV blob並觸發下載
     ********************/
    (function () {
        function download(title, rows) {
            const csv = rows.map(r =>
                r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
            ).join('\r\n');

            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
            GM_download({ url: URL.createObjectURL(blob), name: title });
        }

        function todayFileTag() {
            return new Date().toISOString().slice(0, 10);
        }

        global.MOHW_CORE.Csv = { download, todayFileTag };
    })();

    /********************
     * ExecutionControl：暫停 / 繼續 / 停止。
     * 停止是「真中止」：內含一個真正的 AbortController，外部的 HTTP 請求把 controller.signal
     * 傳進去，按下停止時連飛行中的請求都會被砍斷，不用等它自然結束。
     ********************/
    (function () {
        class StopError extends Error {
            constructor(msg) {
                super(msg || '已停止');
                this.name = 'StopError';
            }
        }

        function createController() {
            let paused = false;
            let stopped = false;
            let resumeWaiters = [];
            const abortController = new AbortController();

            function pause() {
                if (stopped) return;
                paused = true;
            }

            function resume() {
                if (stopped) return;
                paused = false;
                resumeWaiters.forEach(r => r());
                resumeWaiters = [];
            }

            function stop() {
                if (stopped) return;
                stopped = true;
                paused = false;
                resumeWaiters.forEach(r => r());
                resumeWaiters = [];
                abortController.abort();
            }

            // 業務流程在每個「合理的中斷點」呼叫這支函式：
            // 若已停止直接丟出 StopError；若暫停中則卡住直到 resume() 或 stop() 被呼叫。
            async function checkpoint() {
                if (stopped) throw new StopError();
                while (paused) {
                    await new Promise(resolve => resumeWaiters.push(resolve));
                    if (stopped) throw new StopError();
                }
            }

            return {
                get signal() { return abortController.signal; },
                pause, resume, stop, checkpoint,
                isPaused: () => paused,
                isStopped: () => stopped
            };
        }

        global.MOHW_CORE.ExecutionControl = { createController, StopError };
    })();

    /********************
     * BatchRunner：併發數限制的批次任務執行器。
     * 不知道自己在跑「照顧計畫」還是「電訪」，只認得「任務清單 + 怎麼跑一個任務 + 同時跑幾個」。
     * 任一任務丟出非中止類的錯誤，視為「真的失敗」，記錄下來並呼叫 controller.stop() 中止全部。
     ********************/
    (function () {
        async function run(tasks, worker, concurrency, controller) {
            let index = 0;
            let firstError = null;
            let firstErrorTask = null;
            const results = new Array(tasks.length);
            const StopError = global.MOHW_CORE.ExecutionControl.StopError;

            async function runSlot() {
                while (true) {
                    if (controller.isStopped()) return;
                    try {
                        await controller.checkpoint();
                    } catch (e) {
                        return; // 在暫停中被要求停止
                    }

                    const i = index++;
                    if (i >= tasks.length) return;
                    const task = tasks[i];

                    try {
                        const value = await worker(task, i);
                        results[i] = { task, ok: true, value };
                    } catch (e) {
                        if (e && (e.name === 'AbortError' || e instanceof StopError)) {
                            return; // 使用者主動停止造成的中止，不算失敗
                        }
                        results[i] = { task, ok: false, error: e };
                        if (!firstError) {
                            firstError = e;
                            firstErrorTask = task;
                            controller.stop(); // 一個真正的失敗，中止其餘所有任務
                        }
                        return;
                    }
                }
            }

            const slots = Array.from({ length: Math.min(concurrency, tasks.length) }, () => runSlot());
            await Promise.all(slots);
            return { results, firstError, firstErrorTask };
        }

        global.MOHW_CORE.BatchRunner = { run };
    })();

    /********************
     * Holidays（外部工具：純日期查詢）
     * 每個年度最多重試 3 次，全部年度都成功才算「就緒」；重試用完仍失敗的年度改用預設規則(平日上班六日放假)。
     ********************/
    (function () {
        const manualHolidays = {
            // '20250208': false, // 補行上班
            // '20250101': true,  // 開國紀念日
        };

        const DATA_URL_TEMPLATE = 'https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/{year}.json';
        const govCache = {};
        const warnedDates = new Set();
        const inFlightFetches = {}; // year -> Promise<boolean>，避免同一年度被併發的多個案件同時重複抓
        let ready = false;

        function pad2(n) { return String(n).padStart(2, '0'); }

        function toDateKey(date) {
            return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
        }

        async function fetchYearOnce(year) {
            if (govCache[year]) return;
            const url = DATA_URL_TEMPLATE.replace('{year}', year);
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const list = await res.json();
            const map = {};
            list.forEach((item) => { map[item.date] = !!item.isHoliday; });
            govCache[year] = map;
            console.info(`[假日資料] 已成功抓取 ${year} 年政府行政機關辦公日曆表`);
        }

        async function fetchYearWithRetry(year, maxAttempts = 3) {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    await fetchYearOnce(year);
                    return true;
                } catch (err) {
                    console.warn(`[假日資料] ${year} 年第 ${attempt}/${maxAttempts} 次抓取失敗 (${err.message})`);
                }
            }
            console.warn(`[假日資料] ${year} 年重試 ${maxAttempts} 次後仍失敗，該年度將改用「平日上班、六日放假」預設規則計算`);
            return false;
        }

        // 帶「同年度併發去重」的版本：如果好幾個案件同時發現缺同一年度的資料，
        // 只會真的送出一次請求，其他呼叫端等同一個 Promise，不會對同一年度重複打好幾次。
        function fetchYearWithRetryDeduped(year) {
            if (govCache[year]) return Promise.resolve(true);
            if (inFlightFetches[year]) return inFlightFetches[year];
            const p = fetchYearWithRetry(year).finally(() => { delete inFlightFetches[year]; });
            inFlightFetches[year] = p;
            return p;
        }

        // 回傳 boolean：本次所有年度是否都成功抓到政府資料。
        // 只要有一年失敗，就代表當年度的假日/補班判斷退回預設規則，需要提醒使用者。
        async function preload(years) {
            const list = Array.isArray(years) ? years : [years];
            const outcomes = await Promise.all([...new Set(list)].map(y => fetchYearWithRetryDeduped(y)));
            ready = outcomes.every(Boolean);
            return ready;
        }

        function isReady() {
            return ready;
        }

        // 執行時才發現需要某個(通常是查詢區間比預載範圍更長導致的)年度資料：
        // 只抓「目前還沒有資料」的年度，已經有的年度不重複打。
        // 回傳 { ok, failedYears }，failedYears 是重試3次後仍失敗的年度清單。
        async function ensureYears(years) {
            const list = [...new Set(Array.isArray(years) ? years : [years])];
            const missing = list.filter(y => !govCache[y]);
            if (missing.length === 0) return { ok: true, failedYears: [] };

            const outcomes = await Promise.all(
                missing.map(async y => ({ year: y, ok: await fetchYearWithRetryDeduped(y) }))
            );
            const failedYears = outcomes.filter(o => !o.ok).map(o => o.year);
            return { ok: failedYears.length === 0, failedYears };
        }

        function lookup(date) {
            const key = toDateKey(date);
            if (Object.prototype.hasOwnProperty.call(manualHolidays, key)) {
                return manualHolidays[key];
            }
            const year = date.getFullYear();
            if (govCache[year] && Object.prototype.hasOwnProperty.call(govCache[year], key)) {
                return govCache[year][key];
            }
            if (!warnedDates.has(key)) {
                warnedDates.add(key);
                console.warn(`[假日資料] 日期 ${key} 查無手動清單或政府假日資料，已依「平日上班、六日放假」預設值計算。`);
            }
            return undefined;
        }

        function isHoliday(date) {
            const result = lookup(date);
            if (result !== undefined) return result;
            const day = date.getDay();
            return day === 0 || day === 6;
        }

        global.TimeLimit.Holidays = { manualHolidays, preload, isReady, isHoliday, ensureYears };
    })();

})(window);