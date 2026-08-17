(function (global) {
    'use strict';

    const App = global.MOHW_APP = global.MOHW_APP || {};
    const D = global.MOHW_CORE.DateUtils;
    const Dom = global.MOHW_CORE.DomUtils;
    const Http = global.MOHW_CORE.HttpClient;

    App.API = App.API || {};
    App.Parser = App.Parser || {};
    App.Export = App.Export || {};
    App.Service = App.Service || {};

    /********************
     * API：電訪記錄相關頁面（皆改為接受 signal）
     ********************/
    (function () {
        // 觀察到原本網址就寫死 limit=10，但只抓了 offset=0 這一頁，沒有繼續翻頁。
        // 這裡改成跟 care.js 的 ca110List 分頁一樣的策略：用「這頁筆數不滿一頁」判斷是不是最後一頁，
        // 不依賴回傳 JSON 裡是否有 total 欄位，翻到底為止。
        const CALL_PAGE_SIZE = 10;

        App.API.fetchCall = async function (id, controller) {
            const { date: start, date2: end } = App.UI.getConfig();
            const rows = [];
            let offset = 0;

            while (true) {
                await controller.checkpoint();
                const url = `/lcms/qd/filterQd130/${id}?&doQuery=yes&ca100id=${id}&perms=true&servDt1=${start}&servDt2=${end}&offset=${offset}&limit=${CALL_PAGE_SIZE}`;
                const json = await Http.fetchJson(url, controller.signal);
                const pageRows = json.rows || [];

                if (pageRows.length === 0) break;
                rows.push(...pageRows);
                if (pageRows.length < CALL_PAGE_SIZE) break; // 這頁沒滿，代表已經是最後一頁
                offset += CALL_PAGE_SIZE;
            }

            return rows;
        };

        App.API.fetchCallEdit = (qd130id, signal) => Http.fetchHtmlDoc('/lcms/qd/editQd130?qd130id=' + qd130id, signal);
    })();

    /********************
     * Parser：A單位申報紀錄
     ********************/
    (function () {
        App.Parser.parseCallEdit = function (doc) {
            const result = {
                reportTrace: Dom.getFirstLineByKeyword(doc, '追蹤服務適應與介入情形'),
                reportTarget: Dom.getFirstLineByKeyword(doc, '各項服務目標及整體計畫目標達成情形'),
                reportFitting: Dom.getFirstLineByKeyword(doc, '整體計畫的適切性及需求異動'),
                reportOther: Dom.getFirstLineByKeyword(doc, '其他處理事項')
            };
            MOHW_CORE.Common.log('CallEditReport:', result);
            return result;
        };
    })();

    /********************
     * Export：電訪紀錄 CSV
     ********************/
    (function () {
        App.Export.csvcall = function (data) {
            const header = [
                '案號', '姓名', '服務項目', '服務日期',
                '追蹤服務適應與介入情形', '各項服務目標及整體計畫目標達成情形',
                '整體計畫的適切性及需求異動', '其他處理事項'
            ];
            const rows = [header, ...data.map(x => [
                x.caseno, x.name, x.servitem, x.servdt,
                x.reportTrace, x.reportTarget, x.reportFitting, x.reportOther
            ])];

            MOHW_CORE.Csv.download(`電訪紀錄_${MOHW_CORE.Csv.todayFileTag()}.csv`, rows);
        };
    })();

    /********************
     * Service：逐案處理電訪紀錄。
     * 對外的 processCallCase 是 retryOnce 包裝過的版本，跟 care.js 用同一套共用重試工具，
     * 但重試對象是這裡的業務函式，判斷交給業務層決定。
     ********************/
    (function () {
        async function processCallCaseOnce(item, controller) {
            await controller.checkpoint();

            const result = [];
            const calls = await App.API.fetchCall(item.id, controller);
            if (!calls.length) return result;

            const start = document.querySelector('#mohw-date').value;
            const end = document.querySelector('#mohw-date2').value;

            for (const c of calls.filter(c => D.isDateAfter(c.servDt, start) && D.isDateBefore(c.servDt, end))) {
                await controller.checkpoint();

                const html = await App.API.fetchCallEdit(c.id, controller.signal);
                const calledit = App.Parser.parseCallEdit(html);

                result.push({
                    caseno: item.caseno, name: item.name, servitem: c.servItem, servdt: c.servDt,
                    ...calledit
                });
            }
            return result;
        }

        App.Service.processCallCase = function (item, controller) {
            return MOHW_CORE.Common.retryOnce(() => processCallCaseOnce(item, controller));
        };
    })();
})(window);