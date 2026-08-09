// ==UserScript==
// @name         LCMS 資料抓取工具
// @namespace    mohw-lcms-tool
// @version      1.0.0
// @description  依業務功能拆分：utils / ui / app / care / call
// @match        https://csms.mohw.gov.tw/lcms/saTree/*
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

// 開發模式：把下面網址換成你的 Live Server 位址（例如 D:/CSMSDataCapture/...）
// 載入順序：utils(共用工具) -> ui(面板) -> care/call(業務規則) -> app(共用外殼/進入點，依賴前面全部)
//
// @require D:/CSMSDataCapture/utils.js
// @require D:/CSMSDataCapture/ui.js
// @require D:/CSMSDataCapture/care.js
// @require D:/CSMSDataCapture/call.js
// @require D:/CSMSDataCapture/app.js
//
// 測試用（正式環境可移除）：
// @require D:/CSMSDataCapture/test/workdayCalculator.test.js
