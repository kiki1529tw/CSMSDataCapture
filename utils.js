(function (global) {
    'use strict';

    global.MOHW_CORE = global.MOHW_CORE || {};
    global.TimeLimit = global.TimeLimit || {};

    /********************
     * Common：log / sleep / 全域設定
     ********************/
    (function () {
        const Config = { debug: true, delay: 100 };

        function log(...args) {
            if (Config.debug) console.log('[LCMS]', ...args);
        }

        function sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        global.MOHW_CORE.Common = { Config, log, sleep };
    })();

    /********************
     * DateUtils：ROC日期解析 + 通用日期運算 + 日期比較
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

        // "114/06/02 13:05:00" -> Date
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

        global.MOHW_CORE.DateUtils = {
            MS_PER_DAY, toDate, atMidnight, addDays, isWeekend, sameCalendarDay,
            isAfterNoon, nextWorkday,
            parseROCDate, parseROCDateTime, formatROC, todayFirstDay, todayLastDay,
            compareROCDate, isDateAfter, isDateBefore
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
     * HttpClient：統一的 fetch + credentials 處理
     ********************/
    (function () {
        async function fetchHtmlDoc(url) {
            global.MOHW_CORE.Common.log('Fetch HTML:', url);
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error(`fetchHtmlDoc ${url} -> ${res.status}`);
            const html = await res.text();
            return new DOMParser().parseFromString(html, 'text/html');
        }

        async function fetchJson(url) {
            global.MOHW_CORE.Common.log('Fetch JSON:', url);
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error(`fetchJson ${url} -> ${res.status}`);
            return res.json();
        }

        global.MOHW_CORE.HttpClient = { fetchHtmlDoc, fetchJson };
    })();

    /********************
     * XhrCapture：XHR hook + 單次認領 capture 機制
     ********************/
    (function () {
        let pendingCapture = null; // 單次認領物件，取代全域布林開關，避免競態問題

        function initHook(root) {
            if (root.LCMS_XHR_HOOKED) return;
            root.LCMS_XHR_HOOKED = true;
            const open = root.XMLHttpRequest.prototype.open;
            const send = root.XMLHttpRequest.prototype.send;

            root.XMLHttpRequest.prototype.open = function (method, url) {
                this._lcmsUrl = url;
                if (pendingCapture && url.includes(pendingCapture.urlMatch)) {
                    this._lcmsCapture = pendingCapture;
                    pendingCapture = null; // 用掉即清空，只認領最先符合的請求
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
     * Csv：陣列轉CSV blob並觸發下載。它不知道自己在存什麼業務資料，
     * care.js 的 csvcare 跟 call.js 的 csvcall 都呼叫這支共用函式。
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
     * Holidays（外部工具：純日期查詢，資料來源與LCMS系統無關，不含任何業務規則）
     * 判斷順序：手動維護清單 > 政府開放資料(快取) > 找不到資料時預設「平日=上班、六日=放假」並印出警告
     * 資料來源：ruyut/TaiwanCalendar（中華民國政府行政機關辦公日曆表 的逐年 JSON 鏡像）
     ********************/
    (function () {
        const manualHolidays = {
            // '20250208': false, // 補行上班
            // '20250101': true,  // 開國紀念日
        };

        const DATA_URL_TEMPLATE = 'https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/{year}.json';
        const govCache = {};
        const fetchFailedYears = new Set();
        const warnedDates = new Set();

        function pad2(n) { return String(n).padStart(2, '0'); }

        function toDateKey(date) {
            return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
        }

        async function fetchYear(year) {
            if (govCache[year] || fetchFailedYears.has(year)) return;
            const url = DATA_URL_TEMPLATE.replace('{year}', year);
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const list = await res.json();
                const map = {};
                list.forEach((item) => { map[item.date] = !!item.isHoliday; });
                govCache[year] = map;
                console.info(`[假日資料] 已成功抓取 ${year} 年政府行政機關辦公日曆表`);
            } catch (err) {
                fetchFailedYears.add(year);
                console.warn(
                    `[假日資料] 無法自動抓取 ${year} 年政府假日資料 (${err.message})，` +
                    `該年度日期若非手動清單登記者，將以「平日上班、六日放假」為預設值計算，` +
                    `請確認是否需要在 manualHolidays 手動補登該年度的國定假日/補班日。`
                );
            }
        }

        async function preload(years) {
            const list = Array.isArray(years) ? years : [years];
            await Promise.all([...new Set(list)].map(fetchYear));
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
                console.warn(
                    `[假日資料] 日期 ${key} 查無手動清單或政府假日資料，` +
                    `已依「平日上班、六日放假」預設值計算，建議手動確認並補登 manualHolidays。`
                );
            }
            return undefined;
        }

        function isHoliday(date) {
            const result = lookup(date);
            if (result !== undefined) return result;
            const day = date.getDay();
            return day === 0 || day === 6;
        }

        global.TimeLimit.Holidays = { manualHolidays, preload, isHoliday };
    })();

})(window);
