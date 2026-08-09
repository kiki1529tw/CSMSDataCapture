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
     * API：電訪記錄相關頁面
     ********************/
    (function () {
        App.API.fetchCall = async function (id) {
            const { date: start, date2: end } = App.UI.getConfig();
            const url = `/lcms/qd/filterQd130/${id}?&doQuery=yes&ca100id=${id}&perms=true&servDt1=${start}&servDt2=${end}&offset=0&limit=10`;
            const json = await Http.fetchJson(url);
            return json.rows || [];
        };

        App.API.fetchCallEdit = qd130id => Http.fetchHtmlDoc('/lcms/qd/editQd130?qd130id=' + qd130id);
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
     * Service：逐案處理電訪紀錄
     ********************/
    (function () {
        App.Service.processCallCase = async function (item) {
            const result = [];
            const calls = await App.API.fetchCall(item.id);
            if (!calls.length) return result;

            const start = document.querySelector('#mohw-date').value;
            const end = document.querySelector('#mohw-date2').value;

            for (const c of calls.filter(c => D.isDateAfter(c.servDt, start) && D.isDateBefore(c.servDt, end))) {
                const html = await App.API.fetchCallEdit(c.id);
                const calledit = App.Parser.parseCallEdit(html);

                result.push({
                    caseno: item.caseno, name: item.name, servitem: c.servItem, servdt: c.servDt,
                    ...calledit
                });
            }
            return result;
        };
    })();
})(window);
