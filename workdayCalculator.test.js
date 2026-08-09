(function (global) {
    'use strict';

    function assertEqual(name, actual, expected, results) {
        const pass = actual === expected;
        results.push({ name, actual, expected, pass });
        if (!pass) {
            console.error(`[FAIL] ${name}: 預期 ${expected}, 實際 ${actual}`);
        } else {
            console.info(`[PASS] ${name}`);
        }
    }

    async function run() {
        const Calculator = global.TimeLimit.WorkdayCalculator;
        const Holidays = global.TimeLimit.Holidays;

        Object.assign(Holidays.manualHolidays, {
            '20251010': true,
            '20251011': true,
            '20251012': true,
            '20250208': false
        });

        const results = [];

        assertEqual('新北市-同一天上午到下午',
            Calculator.newTaipei('2025-06-02 09:00:00', '2025-06-02 15:00:00'), 1, results);

        assertEqual('新北市-起日下午到訖日上午(相鄰工作日)',
            Calculator.newTaipei('2025-06-02 15:00:00', '2025-06-03 09:00:00'), 1, results);
        assertEqual('新北市-起訖皆上午(相鄰工作日)',
            Calculator.newTaipei('2025-06-02 09:00:00', '2025-06-03 09:00:00'), 2, results);
        assertEqual('新北市-起訖皆下午(相鄰工作日)',
            Calculator.newTaipei('2025-06-02 15:00:00', '2025-06-03 15:00:00'), 2, results);
        assertEqual('新北市-12:00:00精確邊界不算超過中午',
            Calculator.newTaipei('2025-06-02 12:00:00', '2025-06-03 12:00:00'), 2, results);
        assertEqual('新北市-12:00:01觸發超過中午',
            Calculator.newTaipei('2025-06-02 12:00:01', '2025-06-03 09:00:00'), 1, results);

        assertEqual('新北市-跨週五到週一(扣六日)',
            Calculator.newTaipei('2025-06-06 09:00:00', '2025-06-09 09:00:00'), 2, results);

        assertEqual('新北市-跨國定假日(10/10國慶+10/11六+10/12日皆放假)',
            Calculator.newTaipei('2025-10-09 09:00:00', '2025-10-13 09:00:00'), 2, results);

        assertEqual('新北市-跨補班日(2/8六照常上班)',
            Calculator.newTaipei('2025-02-07 09:00:00', '2025-02-09 09:00:00'), 3, results);

        assertEqual('新北市-(d)保護-起訖僅相差六日兩天全為假日仍不為0',
            Calculator.newTaipei('2025-06-07 09:00:00', '2025-06-08 09:00:00'), 1, results);

        assertEqual('臺北市-同一天', Calculator.taipei('2025-06-02', '2025-06-02'), 0, results);
        assertEqual('臺北市-隔一個工作日', Calculator.taipei('2025-06-02', '2025-06-03'), 1, results);
        assertEqual('臺北市-跨週五到週一(扣六日)', Calculator.taipei('2025-06-06', '2025-06-09'), 1, results);
        assertEqual('臺北市-跨國定假日', Calculator.taipei('2025-10-09', '2025-10-13'), 1, results);

        const failCount = results.filter((r) => !r.pass).length;
        console.info(`\n測試完成：共 ${results.length} 筆，通過 ${results.length - failCount} 筆，失敗 ${failCount} 筆`);
        return results;
    }

    global.TimeLimit = global.TimeLimit || {};
    global.TimeLimit.Test = { run };
})(window);
