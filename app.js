(function (global) {
    'use strict';

    const App = global.MOHW_APP = global.MOHW_APP || {};
    App.Main = App.Main || {};
    App.Service = App.Service || {};
    App.API = App.API || {};

    /********************
     * Main：iframe尋找工具、按鈕綁定、頁面載入時的初始化流程
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

        async function waitElement(selector) {
            while (true) {
                const el = findElement(selector);
                if (el) return el;
                await MOHW_CORE.Common.sleep(300);
            }
        }
        App.Main.waitElement = waitElement;

        App.Main.running = false;
        App.Main.start = async function () {
            if (App.Main.running) {
                App.UI.status('執行中，無須重複點擊', 'error');
                return;
            }
            App.Main.running = true;

            try {
                App.UI.status('準備查詢...');
                const result = await App.Service.exportCases();

                let message = '';
                if (result.resultcare.length > 0) {
                    App.Export.csvcare(result.resultcare, result.resultcare[0].city);
                    message = `照顧計畫共 ${result.resultcare.length} 筆`;
                }
                if (result.resultcall.length > 0) {
                    App.Export.csvcall(result.resultcall);
                    message += (message ? '、' : '') + `電訪記錄共 ${result.resultcall.length} 筆`;
                }
                App.UI.status(message ? `匯出完成，${message}` : '無資料需匯出', 'success');
            } catch (e) {
                console.error(e);
                App.UI.status('執行失敗', 'error');
            } finally {
                App.Main.running = false;
            }
        };

        window.addEventListener('load', async () => {
            const y = new Date().getFullYear();
            await TimeLimit.Holidays.preload([y - 1, y, y + 1]);

            MOHW_CORE.XhrCapture.observeFrames();

            const tree130 = await waitElement('#TREE-351013527');
            if (tree130) {
                App.UI.createPanel();
                document.addEventListener('click', e => {
                    if (e.target.closest('#mohw-start')) App.Main.start();
                });
            }
        });
    })();

    /********************
     * Service：抓案件清單、依勾選的匯出類型分派給 care/call
     * (processCareCase / processCallCase 分別定義在 care.js / call.js)
     ********************/
    (function () {
        // 分頁抓取所有個案清單。跟 care/call 都無關，是共用的案件來源。
        App.API.getAllCases = async function (firstJson, firstUrl) {
            const result = [...(firstJson.rows || [])];
            const url = new URL(firstUrl, location.origin);
            const limit = 50;
            const total = firstJson.total || 0;

            for (let offset = result.length; offset < total; offset += limit) {
                url.searchParams.set('limit', limit);
                url.searchParams.set('offset', offset);
                App.UI.status(`個案取得進度 : ${offset}/${total}`);
                const json = await MOHW_CORE.HttpClient.fetchJson(url.toString());
                result.push(...(json.rows || []));
            }

            MOHW_CORE.Common.log('全部案件', result);
            return result;
        };

        App.Service.searchCases = async function () {
            const capture = MOHW_CORE.XhrCapture.waitForRequest('/lcms/ca/filter');

            const searchBtn = await App.Main.waitElement('#search');
            if (!searchBtn) throw new Error('找不到查詢按鈕');
            searchBtn.click();

            const { json, url } = await capture;
            return App.API.getAllCases(json, url);
        };

        App.Service.exportCases = async function () {
            const exporttypes = [...document.querySelectorAll('.mohw-exporttype:checked')].map(x => x.value);
            const all = await App.Service.searchCases();
            const top = parseInt(document.querySelector('#mohw-top').value) || 'hidden';
            let cases = all;
            if (top !== 'hidden') {
                cases = all.slice(0, top);
            }               

            const resultcare = [];
            const resultcall = [];

            for (let i = 0; i < cases.length; i++) {
                const item = cases[i];
                if (exporttypes.includes('A')) {
                    App.UI.status(`時效撈撈進度 : ${i + 1}/${cases.length} ${item.name}`);
                    resultcare.push(...await App.Service.processCareCase(item));
                }
                if (exporttypes.includes('B')) {
                    App.UI.status(`電訪撈撈進度 : ${i + 1}/${cases.length} ${item.name}`);
                    resultcall.push(...await App.Service.processCallCase(item));
                }
                await MOHW_CORE.Common.sleep(MOHW_CORE.Common.Config.delay);
            }

            return { resultcare, resultcall };
        };
    })();
})(window);
