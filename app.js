(function (global) {
    'use strict';

    const App = global.MOHW_APP = global.MOHW_APP || {};
    App.Main = App.Main || {};
    App.Service = App.Service || {};
    App.API = App.API || {};

    /********************
     * Main：iframe尋找工具、按鈕綁定、頁面載入時的初始化流程、暫停/繼續/停止的按鈕邏輯
     ********************/
    (function () {
        function findElement(selector, root = document) {
            const el = root.querySelector(selector);
            if (el) return el;
            for (const iframe of root.querySelectorAll('iframe')) {
                try {
                    const result = findElement(selector, iframe.contentDocument);
                    if (result) return result;
                } catch (e) { /* 跨網域 iframe，略過 */ }
            }
            return null;
        }

        // controller 是可選參數：頁面載入階段(等tree130出現)還沒有controller，維持原本行為；
        // 執行批次流程中(例如等查詢按鈕出現)如果有傳controller，等待迴圈也能響應暫停/停止，
        // 不會出現「暫停按了沒反應、因為卡在這個等待迴圈裡」的情況。
        async function waitElement(selector, controller) {
            while (true) {
                const el = findElement(selector);
                if (el) return el;
                if (controller) await controller.checkpoint();
                await MOHW_CORE.Common.sleep(300);
            }
        }
        App.Main.waitElement = waitElement;

        App.Main.running = false;
        App.Main.controller = null; // 執行中的 ExecutionControl 實例，idle 時為 null

        App.Main.start = async function () {
            if (App.Main.running) {
                App.UI.status('執行中，無須重複點擊', 'error');
                return;
            }

            if (!TimeLimit.Holidays.isReady()) {
                App.UI.status('國定假日資料尚未就緒，請稍候', 'error');
                return;
            }

            // 日期防呆：兩個欄位都要能正確解析成合法日期，格式錯誤直接擋下、不執行查詢
            const dateInput = document.querySelector('#mohw-date');
            const date2Input = document.querySelector('#mohw-date2');
            const normDate = MOHW_CORE.DateUtils.normalizeDateInput(dateInput.value);
            const normDate2 = MOHW_CORE.DateUtils.normalizeDateInput(date2Input.value);
            if (normDate === null || normDate2 === null) {
                App.UI.status('日期輸入錯誤，請重新輸入(範例：114/06/02 或 2025/06/02)', 'error');
                return;
            }
            dateInput.value = normDate;
            date2Input.value = normDate2;

            App.Main.running = true;
            const controller = MOHW_CORE.ExecutionControl.createController();
            App.Main.controller = controller;
            App.UI.setRunningState('running');
            App.UI.startElapsedTimer();

            try {
                App.UI.status('準備查詢...');
                const result = await App.Service.exportCases(controller);

                let message = '';
                if (result.resultcare.length > 0) {
                    App.Export.csvcare(result.resultcare, result.resultcare[0].city);
                    message += `照顧計畫共 ${result.resultcare.length} 筆`;
                }
                if (result.resultcall.length > 0) {
                    App.Export.csvcall(result.resultcall);
                    message += (message ? '、' : '') + `電訪記錄共 ${result.resultcall.length} 筆`;
                }

                if (result.failError) {
                    // 有任務真正失敗(重試1次後仍失敗)，已依規則中止全部批次
                    const name = result.failedTask?.item?.name || '(不明個案)';
                    const kind = result.failedTask?.type === 'care' ? '照顧計畫' : '電訪記錄';
                    App.UI.status(
                        `[${kind}] 於「${name}」處理失敗已中止批次：${result.failError.message}。` +
                        (message ? `失敗前已完成並匯出：${message}` : '失敗前尚無已完成資料可匯出'),
                        'error'
                    );
                } else if (controller.isStopped()) {
                    // 使用者主動按停止
                    App.UI.status(
                        `已依使用者要求停止。` + (message ? `已完成並匯出：${message}` : '尚無已完成資料可匯出'),
                        'info'
                    );
                } else {
                    App.UI.status(message ? `匯出完成，${message}` : '無資料需匯出', 'success');
                }
            } catch (e) {
                console.error(e);
                App.UI.status('執行失敗：' + e.message, 'error');
            } finally {
                App.Main.running = false;
                App.Main.controller = null;
                App.UI.stopElapsedTimer();
                App.UI.setRunningState('idle');
            }
        };

        window.addEventListener('load', async () => {
            MOHW_CORE.XhrCapture.observeFrames();

            // 維持原本的頁面判斷：只有進到對的頁籤(tree130出現)才建立面板
            const tree130 = await waitElement('#TREE-351013527');
            const tree100 = await waitElement('#TREE-278270613');
            if (!tree130 && !tree100) return;

            App.UI.createPanel();

            document.addEventListener('click', e => {
                if (e.target.closest('#mohw-start')) {
                    App.Main.start();
                }
                if (e.target.closest('#mohw-pause')) {
                    const c = App.Main.controller;
                    if (!c) return;
                    if (c.isPaused()) {
                        c.resume();
                        App.UI.setRunningState('running');
                        App.UI.resumeElapsedTimer();
                    } else {
                        c.pause();
                        App.UI.setRunningState('paused');
                        App.UI.pauseElapsedTimer();
                        App.UI.status('已暫停，按「繼續」恢復執行');
                    }
                }
                if (e.target.closest('#mohw-stop')) {
                    const c = App.Main.controller;
                    if (!c) return;
                    c.stop();
                    App.UI.status('正在停止...');
                }
            });

            // 必須等國定假日載入完成才能開始查詢：載入期間鎖住「開始抓取」按鈕
            App.UI.status('國定假日資料載入中...');
            const y = new Date().getFullYear();
            const holidaysOk = await TimeLimit.Holidays.preload([y - 1, y, y + 1]);

            if (holidaysOk) {
                App.UI.setHolidaysReady(true);
                App.UI.status('就緒', 'success');
            } else {
                App.UI.setHolidaysReady(false, '國定假日載入失敗，請重新整理頁面再試一次');
            }
        });
    })();

    /********************
     * Service：抓案件清單、care/call併發批次處理(共用同一個併發池)、失敗中止
     ********************/
    (function () {
        // 分頁抓取所有個案清單，跟 care/call 都無關，是共用的案件來源。
        // 註：改吃 controller 而不是只吃 signal，每頁之間加 checkpoint，
        // 讓「個案抓取」這個階段的分頁迴圈也能被暫停/停止，不會等到抓完全部案件才反應。
        App.API.getAllCases = async function (firstJson, firstUrl, controller) {
            const result = [...(firstJson.rows || [])];
            const url = new URL(firstUrl, location.origin);
            const limit = 50;
            const total = firstJson.total || 0;

            for (let offset = result.length; offset < total; offset += limit) {
                await controller.checkpoint();
                url.searchParams.set('limit', limit);
                url.searchParams.set('offset', offset);
                App.UI.status(`個案取得進度 : ${offset}/${total}`);
                const json = await MOHW_CORE.HttpClient.fetchJson(url.toString(), controller.signal);
                result.push(...(json.rows || []));
            }

            MOHW_CORE.Common.log('全部案件', result);
            return result;
        };

        App.Service.searchCases = async function (controller) {
            const capture = MOHW_CORE.XhrCapture.waitForRequest('/lcms/ca/filter');

            // 讓「停止」在等待查詢結果的當下也能生效
            const stopped = new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new MOHW_CORE.ExecutionControl.StopError()));
            });

            const searchBtn = await App.Main.waitElement('#search', controller);
            if (!searchBtn) throw new Error('找不到查詢按鈕');

            // 查詢按鈕本身有節流限制：短時間內重複點擊，第二次點擊會被系統忽略、不會真的送出查詢。
            // 如果使用者剛好在按下「開始抓取」之前，自己手動點過一次查詢，我們這裡的點擊可能剛好落在
            // 節流視窗內完全沒生效，導致 capture 永遠等不到 XHR、卡死。
            // 這裡改成：點擊後等一段時間(比節流時間3秒稍長)，沒等到查詢結果就再點一次，最多重試幾次。
            const maxAttempts = 5;
            const attemptTimeoutMs = 4000;
            const TIMEOUT_TOKEN = Symbol('timeout');

            let outcome = null;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                await controller.checkpoint();
                searchBtn.click();

                const timeout = new Promise(resolve => setTimeout(() => resolve(TIMEOUT_TOKEN), attemptTimeoutMs));
                const raced = await Promise.race([capture, stopped, timeout]);

                if (raced !== TIMEOUT_TOKEN) {
                    outcome = raced;
                    break;
                }
                MOHW_CORE.Common.log(`查詢按鈕第 ${attempt} 次點擊未偵測到查詢請求，可能撞上節流限制，重試...`);
            }

            if (!outcome) {
                throw new Error('查詢按鈕多次點擊都未觸發查詢，請確認頁面狀態後再試一次');
            }

            const { json, url } = outcome;
            return App.API.getAllCases(json, url, controller);
        };

        // 註：care/call 兩條線的任務混在同一份清單裡，交給 BatchRunner 用同一個併發數同時處理，
        // 而不是各自獨立開一份併發池——這樣「併發數10」才是兩條線加起來共用10，不是各10共20。
        App.Service.exportCases = async function (controller) {
            const config = App.UI.getConfig();
            const exporttypes = [...document.querySelectorAll('.mohw-exporttype:checked')].map(x => x.value);

            const all = await App.Service.searchCases(controller);
            const cases = config.top == 'hidden' ? all : all.slice(0, config.top);

            // 逐案交錯排列 care/call 任務(而不是「全部care接全部call」)，
            // 因為 BatchRunner 是照陣列順序遞補空出來的併發位置，
            // 如果 care 全部排在前面，併發位置會一直被 care 佔滿，call 要等 care 全部處理完才輪得到，
            // 交錯排列才能讓兩種任務從一開始就混在同一批併發裡執行。
            const tasks = [];
            cases.forEach(item => {
                if (exporttypes.includes('A')) tasks.push({ type: 'care', item });
                if (exporttypes.includes('B')) tasks.push({ type: 'call', item });
            });

            const careTotal = exporttypes.includes('A') ? cases.length : 0;
            const callTotal = exporttypes.includes('B') ? cases.length : 0;
            let careDone = 0, callDone = 0;

            const worker = async (task) => {
                const value = task.type === 'care'
                    ? await App.Service.processCareCase(task.item, controller)
                    : await App.Service.processCallCase(task.item, controller);

                if (task.type === 'care') careDone++; else callDone++;
                App.UI.status(`處理進度 - 照顧計畫撈撈 ${careDone}/${careTotal}，電訪撈撈 ${callDone}/${callTotal}`);
                return value;
            };

            const { results, firstError, firstErrorTask } =
                await MOHW_CORE.BatchRunner.run(tasks, worker, config.concurrency, controller);

            const resultcare = [];
            const resultcall = [];
            results.forEach((r, i) => {
                if (!r || !r.ok) return; // 未完成或失敗的任務不列入匯出，只匯出真正成功的部分
                const task = tasks[i];
                if (task.type === 'care') resultcare.push(...r.value);
                else resultcall.push(...r.value);
            });

            return { resultcare, resultcall, failError: firstError, failedTask: firstErrorTask };
        };
    })();
})(window);
