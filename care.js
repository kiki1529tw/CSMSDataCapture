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

        // 註：這裡改成非同步。原本假日資料只在頁面載入時預抓近三年(去年/今年/明年)，
        // 如果查詢區間比這個範圍更長，區間涵蓋的年度可能根本沒被抓過，之前是直接靜默套用
        // 「平日上班六日放假」預設規則，使用者不會知道。
        // 現在改成：先檢查區間涵蓋的每個年度有沒有資料，缺的就當場補抓(一樣重試3次)，
        // 真的抓不到才提示使用者，並非直接中止整批——因為這是資料缺口，不是任務本身執行失敗。
        WorkdayCalculator.calculate = async function (city, start, end) {
            const s = D.toDate(start);
            const e = D.toDate(end);
            const years = [];
            for (let y = s.getFullYear(); y <= e.getFullYear(); y++) years.push(y);

            const { ok, failedYears } = await global.TimeLimit.Holidays.ensureYears(years);
            if (!ok) {
                App.UI.status(
                    `假日資料缺少 ${failedYears.join('、')} 年度，該區間已用「平日上班六日放假」預設規則計算，時效可能不準確`,
                    'error'
                );
            }

            switch (city) {
                case '新北市':
                    return WorkdayCalculator.newTaipei(s, e);
                case '臺北市':
                case '台北市':
                    return WorkdayCalculator.taipei(s, e);
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
        App.API.fetchEdit28 = (id, signal) => Http.fetchHtmlDoc('/lcms/ca/edit28/' + id, signal);
        App.API.fetchShowCa110 = (ca110id, signal) => Http.fetchHtmlDoc('/lcms/ca/showCa110/' + ca110id, signal);
        App.API.fetchSubmitLog = (ca110id, signal) => Http.fetchHtmlDoc('/lcms/ca/showCa110AunitSubmitL?ca110id=' + ca110id, signal);

        // 照顧計畫列表分頁 API。
        // 網址規則來自實際 Network 截圖比對：model[0][textpair][offset] 是位移量、
        // model[0][textpair][max] 是每頁筆數(觀察到伺服器固定回傳5筆一頁)。
        App.API.fetchCa110ListPage = (ca100id, offset, max, signal) => {
            const params = new URLSearchParams();
            params.set('template', '/ca/ca110List');
            params.set('model[0][textpair][qca100id]', ca100id);
            params.set('model[0][textpair][perms]', '');
            params.set('model[0][textpair][mperms]', '');
            params.set('model[0][textpair][noteperms]', '');
            params.set('model[0][textpair][servnote]', '');
            params.set('model[0][textpair][adjca116]', '');
            params.set('model[0][textpair][qdperms]', '');
            params.set('model[0][textpair][planByA]', 'true');
            params.set('model[0][textpair][actPage]', 'edit28');
            params.set('model[0][textpair][cmModel]', 'false');
            params.set('model[0][textpair][modelOt01]', '');
            params.set('model[0][textpair][offset]', String(offset));
            params.set('model[0][textpair][max]', String(max));
            params.set('_', String(Date.now()));
            return Http.fetchHtmlDoc(`/lcms/general/render_template?${params.toString()}`, signal);
        };
    })();

    /********************
     * Parser：照顧計畫列表 / 個管員 / 送退審紀錄
     ********************/
    (function () {
        // 觀察到伺服器每頁固定回傳5筆，寫死在這裡；如果之後伺服器改了每頁筆數，這裡要跟著調整。
        const CA110_PAGE_SIZE = 5;

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

        // 翻頁抓出某案件底下「全部」照顧計畫列，不管有幾頁。
        // 用「這頁筆數不滿一頁」判斷是不是最後一頁，不依賴頁面上的總筆數顯示。
        async function fetchAllPlanRows(ca100id, controller) {
            const rows = [];
            let offset = 0;
            while (true) {
                await controller.checkpoint();
                const doc = await App.API.fetchCa110ListPage(ca100id, offset, CA110_PAGE_SIZE, controller.signal);
                const pageRows = [...doc.querySelectorAll('table.ca110-table tbody tr')];
                if (pageRows.length === 0) break;
                rows.push(...pageRows);
                if (pageRows.length < CA110_PAGE_SIZE) break; // 這頁沒滿，代表已經是最後一頁
                offset += CA110_PAGE_SIZE;
            }
            return rows;
        }

        // 照顧計畫列表。三階段：
        // 1) 翻頁抓出所有列，只用表格上「現成看得到」的資料組出候選清單，不打任何請求
        // 2) 用類型+期間篩選(App.Filter.carematch)，先把不符合條件的計畫刷掉
        // 3) 篩選後剩下的計畫，才去打 fetchShowCa110/fetchSubmitLog，且同一筆計畫的這兩個請求
        //    彼此不依賴，用 Promise.all 同時發送；不同計畫之間也用 Promise.all 同時發送，
        //    不再是「一筆打完等回應才打下一筆」的序列寫法。
        App.Parser.parsePlans = async function (ca100id, controller) {
            const rows = await fetchAllPlanRows(ca100id, controller);

            const candidates = rows.map(tr => {
                const td = [...tr.querySelectorAll('td')];
                if (td.length < 10) return null;

                const status = td[1].innerText.replace(/\s+/g, '').trim();
                const period = td[2].innerText.replace(/\s+/g, '').trim();
                const type = td[3].querySelector('.helpQtips')?.textContent?.trim()
                    || td[3].innerText?.replace(/\s+/g, '')?.trim() || '';

                const btn = td[10].querySelector('[title="檢視評估及計畫"]');
                const onclickStr = btn?.getAttribute('onclick');
                const match = onclickStr?.match(/showCa110\/(\d+)/);
                const id = match ? match[1] : null;

                return { status, period, type, ca110id: id || '' };
            }).filter(Boolean);

            const matched = candidates.filter(App.Filter.carematch);

            const finalized = await Promise.all(matched.map(async (p) => {
                if (!p.ca110id) return null;
                await controller.checkpoint();

                const [ca110doc, submitLogDoc] = await Promise.all([
                    App.API.fetchShowCa110(p.ca110id, controller.signal),
                    App.API.fetchSubmitLog(p.ca110id, controller.signal)
                ]);

                const resultcare = Dom.getCarePlanData(ca110doc, '照顧計畫', '評估完成日-評估人');
                const cityLine = Dom.getCarePlanData(ca110doc, 'A.個案基本資料', '居住地');
                const rawCity = cityLine?.[0]?.split('-')[0]?.trim() ?? '';
                const city = rawCity.includes('台北市') ? '臺北市' : rawCity; // 統一為「臺北市」
                const resultcareStr = typeof resultcare === 'string' ? resultcare : String(resultcare || '');
                const evaluatedate = (city === '臺北市' && p.type?.includes('重新擬定(AA01)'))
                    ? (p.period?.split('~')[0]?.trim() ?? '')
                    : (resultcareStr?.split('-')[0]?.trim() ?? '');

                const submitLog = App.Parser.parseSubmitLog(submitLogDoc);
                const [submitDatePart, submitTimePart] = submitLog.submitDate.split(' ');
                const [passDatePart, passTimePart] = submitLog.passDate.split(' ');

                const startTime = city === '新北市'
                    ? D.parseROCDateTime(submitLog.submitDate)
                    : D.parseROCDate(evaluatedate);
                const endTime = city === '新北市'
                    ? D.parseROCDateTime(submitLog.passDate)
                    : D.parseROCDate(passDatePart);

                const passDays = (startTime && endTime)
                    ? await global.TimeLimit.WorkdayCalculator.calculate(city, startTime, endTime)
                    : '';

                return {
                    status: p.status, period: p.period, type: p.type, ca110id: p.ca110id,
                    city, evaluatedate,
                    submitDate: submitDatePart, submitTime: submitTimePart,
                    passDate: passDatePart, passTime: passTimePart,
                    passDays, rejectCount: submitLog.rejectCount
                };
            }));

            const plans = finalized.filter(Boolean);
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
                if (action.includes('照顧計畫審核退件')) result.rejectCount++;
            });

            return result;
        };
    })();

    /********************
     * Filter：計畫類型 + 日期篩選
     * 註：這裡是判斷「候選計畫要不要進一步打API」的依據，只吃 type/period 兩個欄位，
     * 完全不需要 city/evaluatedate 這些要額外打請求才拿得到的資料。
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
     * Service：逐案處理照顧計畫時效。
     * parsePlans 已經把篩選、補資料、時效計算全部做完，這裡只需要把案件層級的資訊(案號/姓名/個管員)
     * 併進每一筆計畫即可。
     ********************/
    (function () {
        async function processCareCaseOnce(item, controller) {
            await controller.checkpoint();

            const doc = await App.API.fetchEdit28(item.id, controller.signal);
            const manager = App.Parser.parseManager(doc);
            const plans = await App.Parser.parsePlans(item.id, controller);

            return plans.map(p => ({
                caseno: item.caseno, name: item.name,
                aUnit: manager.aUnit, manager: manager.manager,
                ...p
            }));
        }

        App.Service.processCareCase = function (item, controller) {
            return MOHW_CORE.Common.retryOnce(() => processCareCaseOnce(item, controller));
        };
    })();
})(window);
