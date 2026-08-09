(function (global) {
    'use strict';

    const App = global.MOHW_APP = global.MOHW_APP || {};
    const D = global.MOHW_CORE.DateUtils;
    const Dom = global.MOHW_CORE.DomUtils;
    const Http = global.MOHW_CORE.HttpClient;
    const log = global.MOHW_CORE.Common.log;

    global.TimeLimit = global.TimeLimit || {};
    App.API = App.API || {};
    App.Parser = App.Parser || {};
    App.Filter = App.Filter || {};
    App.Export = App.Export || {};
    App.Service = App.Service || {};

    /********************
     * WorkdayCalculator（業務規則：新北市/臺北市審核時效認定，非單純日期差）
     ********************/
    (function () {
        function isWorkday(date) {
            return !global.TimeLimit.Holidays.isHoliday(date);
        }

        const WorkdayCalculator = {};

        // 新北市：計畫核定時間 = 訖日 - 起日
        // (a) 工作日 = (訖-起自然日曆天數+1) - 起訖內假日天數 + 起訖內補班天數
        // (b) 起日若超過12:00, 工作日-1
        // (c) 訖日若超過12:00, 工作日+1
        // (d) 最後檢核 工作日 若等於0, 設定為1
        // (e) 若起訖為同一天, 設定為1 (最終覆寫，優先權最高)
        WorkdayCalculator.newTaipei = function (start, end) {
            start = D.toDate(start);
            end = D.toDate(end);

            const startDay = D.atMidnight(start);
            const endDay = D.atMidnight(end);

            const totalCalendarDays = Math.round((endDay.getTime() - startDay.getTime()) / D.MS_PER_DAY) + 1;

            let holidayCount = 0;
            let makeupWorkdayCount = 0;
            for (let d = new Date(startDay); d <= endDay; d = D.addDays(d, 1)) {
                const holiday = global.TimeLimit.Holidays.isHoliday(d);
                if (holiday) {
                    holidayCount++;
                } else if (D.isWeekend(d)) {
                    makeupWorkdayCount++; // 六日但要上班 = 補班
                }
            }

            let workDays = totalCalendarDays - holidayCount + makeupWorkdayCount;

            if (D.isAfterNoon(start)) workDays -= 1;
            if (D.isAfterNoon(end)) workDays += 1;
            if (workDays === 0) workDays = 1;
            if (D.sameCalendarDay(start, end)) workDays = 1;

            console.log(`[結案日期差計算] newTaipei: ${workDays}`);
            return workDays;
        };

        // 臺北市：評估完成日 vs 審核通過日，以「日」為單位，同天=0，其餘按工作日天數累加
        WorkdayCalculator.taipei = function (start, end) {
            let s = D.atMidnight(D.toDate(start));
            const e = D.atMidnight(D.toDate(end));

            let count = 0;
            while (s.getTime() < e.getTime()) {
                s = D.nextWorkday(s, isWorkday);
                count++;
            }
            console.log(`[結案日期差計算] taipei: ${count}`);
            return count;
        };

        WorkdayCalculator.calculate = function (city, start, end) {
            switch (city) {
                case '新北市':
                    return WorkdayCalculator.newTaipei(start, end);
                case '臺北市':
                case '台北市':
                    return WorkdayCalculator.taipei(start, end);
                default:
                    return '';
            }
        };

        global.TimeLimit.WorkdayCalculator = WorkdayCalculator;
    })();

    /********************
     * API：照顧計畫相關頁面
     ********************/
    (function () {
        App.API.fetchEdit28 = id => Http.fetchHtmlDoc('/lcms/ca/edit28/' + id);
        App.API.fetchShowCa110 = ca110id => Http.fetchHtmlDoc('/lcms/ca/showCa110/' + ca110id);
        App.API.fetchSubmitLog = ca110id => Http.fetchHtmlDoc('/lcms/ca/showCa110AunitSubmitL?ca110id=' + ca110id);
    })();

    /********************
     * Parser：照顧計畫列表 / 個管員 / 送退審紀錄
     ********************/
    (function () {
        // 抓A單位個管員
        App.Parser.parseManager = function (doc) {
            const tds = Dom.findRowByKeyword(doc, '主責A單位');
            const result = { aUnit: '', manager: '' };
            if (tds && tds.length) {
                const value = Dom.getLines(tds[1]);
                result.aUnit = value[0] || '';
                result.manager = value[1] || '';
            }
            log('Manager:', result);
            return result;
        };

        // 照顧計畫列表
        App.Parser.parsePlans = async function (doc) {
            const plans = [];
            const table = doc.querySelector('table.ca110-table');
            if (!table) return plans;

            const rows = [...table.querySelectorAll('tbody tr')];
            for (const tr of rows) {
                const td = [...tr.querySelectorAll('td')];
                if (td.length < 10) continue;

                const status = td[1].innerText.replace(/\s+/g, '').trim();
                const period = td[2].innerText.replace(/\s+/g, '').trim();
                const type = td[3].querySelector('.helpQtips')?.textContent?.trim()
                    || td[3].innerText?.replace(/\s+/g, '')?.trim() || '';

                const btn = td[10].querySelector('[title="檢視評估及計畫"]');
                const onclickStr = btn?.getAttribute('onclick');
                const match = onclickStr?.match(/showCa110\/(\d+)/);
                const id = match ? match[1] : null;

                let evaluatedate = '';
                let city = '';
                if (id) {
                    const ca110doc = await App.API.fetchShowCa110(id);
                    const resultcare = Dom.getCarePlanData(ca110doc, '照顧計畫', '評估完成日-評估人');
                    const cityLine = Dom.getCarePlanData(ca110doc, 'A.個案基本資料', '居住地');
                    city = cityLine?.[0]?.split('-')[0]?.trim() ?? '';

                    const resultcareStr = typeof resultcare === 'string' ? resultcare : String(resultcare || '');
                    evaluatedate = resultcareStr ? resultcareStr.split('-')[0].trim() : '';
                }

                plans.push({ status, period, type, ca110id: id || '', city, evaluatedate });
            }

            log('Plans:', plans);
            return plans;
        };

        // 送審 & 通過日期 & 退件次數
        App.Parser.parseSubmitLog = function (doc) {
            const result = { submitDate: '', passDate: '', rejectCount: 0 };
            let submitTime = 0, passTime = 0;

            doc.querySelectorAll('.table-embed tr').forEach((tr, index) => {
                if (index === 0) return; // header
                const td = tr.querySelectorAll('td');
                if (td.length < 2) return;

                const time = td[0].innerText.trim();
                const action = td[1].innerText.trim();
                const date = D.parseROCDateTime(time);
                if (!date) return;

                if (action.includes('待A單位擬照顧計畫') && date > submitTime) {
                    submitTime = date;
                    result.submitDate = time;
                }
                if (action.includes('審核通過') && date > passTime) {
                    passTime = date;
                    result.passDate = time;
                }
                if (action.includes('退件')) result.rejectCount++;
            });

            return result;
        };
    })();

    /********************
     * Filter：計畫類型 + 日期篩選
     ********************/
    (function () {
        App.Filter.carematch = function (plan) {
            const types = [...document.querySelectorAll('.mohw-type:checked')].map(x => x.value);
            if (types.length && !types.some(t => plan.type.includes(t))) return false;

            const start = document.querySelector('#mohw-date').value;
            const end = document.querySelector('#mohw-date2').value;

            if (start && plan.period) {
                const planStart = plan.period.split('~')[0];
                if (!D.isDateAfter(planStart, start) || !D.isDateBefore(planStart, end)) return false;
            }

            return true;
        };
    })();

    /********************
     * Export：照顧計畫時效 CSV
     ********************/
    (function () {
        const careColumnsByCity = {
            '新北市': [
                { title: '待A單位擬照顧計畫日期', field: x => x.submitDate },
                { title: '待A單位擬照顧計畫時間', field: x => x.submitTime },
                { title: '審核通過日期', field: x => x.passDate },
                { title: '審核通過時間', field: x => x.passTime }
            ],
            '臺北市': [
                { title: '評估完成日', field: x => x.evaluatedate },
                { title: '審核通過日期', field: x => x.passDate }
            ]
        };

        App.Export.csvcare = function (data, city) {
            const columns = careColumnsByCity[city];
            if (!columns) {
                log(`未定義 ${city} 的照顧計畫匯出欄位`);
                return;
            }

            const header = [
                '案號', '姓名', '狀態', '有效期間', '計畫類型', '主責A單位', '個管員',
                ...columns.map(c => c.title), '審核通過時效', '退件紀錄'
            ];
            const rows = [header, ...data.map(x => [
                x.caseno, x.name, x.status, x.period, x.type, x.aUnit, x.manager,
                ...columns.map(c => c.field(x)), x.passDays, x.rejectCount
            ])];

            MOHW_CORE.Csv.download(`照顧計畫時效_${MOHW_CORE.Csv.todayFileTag()}.csv`, rows);
        };
    })();

    /********************
     * Service：逐案處理照顧計畫時效
     ********************/
    (function () {
        App.Service.processCareCase = async function (item) {
            const result = [];
            const doc = await App.API.fetchEdit28(item.id);
            const manager = App.Parser.parseManager(doc);
            const plans = await App.Parser.parsePlans(doc);

            for (const p of plans.filter(App.Filter.carematch)) {
                if (!p.ca110id) continue;

                const html = await App.API.fetchSubmitLog(p.ca110id);
                const submitLog = App.Parser.parseSubmitLog(html);

                const [submitDatePart, submitTimePart] = submitLog.submitDate.split(' ');
                const [passDatePart, passTimePart] = submitLog.passDate.split(' ');

                const startTime = p.city === '新北市'
                    ? D.parseROCDateTime(submitLog.submitDate)
                    : D.parseROCDate(p.evaluatedate);
                const endTime = p.city === '新北市'
                    ? D.parseROCDateTime(submitLog.passDate)
                    : D.parseROCDate(passDatePart);

                const passDays = (startTime && endTime)
                    ? global.TimeLimit.WorkdayCalculator.calculate(p.city, startTime, endTime)
                    : '';

                result.push({
                    caseno: item.caseno, name: item.name, status: p.status, period: p.period,
                    type: p.type, aUnit: manager.aUnit, manager: manager.manager,
                    ca110id: p.ca110id, city: p.city, evaluatedate: p.evaluatedate,
                    submitDate: submitDatePart, submitTime: submitTimePart,
                    passDate: passDatePart, passTime: passTimePart,
                    passDays, rejectCount: submitLog.rejectCount
                });
            }
            return result;
        };
    })();
})(window);
