'use strict';
/* ============================================================
   env.js 问题级测试（本文件以 _ 开头，验收脚本会自动跳过，不会当页面）
   运行：node frontend/pages/_env.test.js
   职责：每个问题完成时添加对应测试并运行，通过后再 Git 提交。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'env.js');
const code = fs.readFileSync(file, 'utf8');

const sandbox = { console: console };
sandbox.window = sandbox;
sandbox.PAGES = {};
sandbox.API = {
  resolve: function (v, cb) { cb(v); },
  sites: function () {
    return [
      { site_id: 'site_01', site_name: '模拟养殖站点', kind: 'farm' },
      { site_id: 'site_02', site_name: '墨西哥湾中部', kind: 'obs', station_id: '42001' },
      { site_id: 'site_03', site_name: '阿拉斯加湾西部', kind: 'obs', station_id: '46001' },
      { site_id: 'site_04', site_name: '夏威夷西北', kind: 'obs', station_id: '51001' }
    ];
  },
  /* 水温规则（与后端同口径）：≥28 红（上限）、≥25.5 黄（提示） */
  ruleCheck: function (r) {
    if (r.water_temp != null && r.water_temp >= 28) {
      return { risk_level: 'red', rule_name: 'R-TEMP-01 水温上限', trigger_value: r.water_temp };
    }
    if (r.water_temp != null && r.water_temp >= 25.5) {
      return { risk_level: 'yellow', rule_name: 'R-TEMP-02 水温偏高提示', trigger_value: r.water_temp };
    }
    return null;
  }
};
/* 导出 CSV 需要的最小 DOM mock（downloadCsv 会创建 <a> 并点击） */
sandbox.document = {
  createElement: function () { return { click: function () {}, remove: function () {} }; },
  body: { appendChild: function () {} }
};
sandbox.URL = { createObjectURL: function () { return 'blob:mock'; }, revokeObjectURL: function () {} };
sandbox.Blob = function () {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'env.js' });

(async function () {
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); }
  else { console.error('  FAIL ' + msg); failed++; }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const H = sandbox.__ENV_HELPERS__;
const sea = sandbox.PAGES['/env/sea'];
const water = sandbox.PAGES['/env/water'];

section('PAGES 注册');
assert(!!sea, "PAGES['/env/sea'] 已注册");
assert(!!water, "PAGES['/env/water'] 已注册");
assert(typeof sea.data === 'function' && typeof sea.mounted === 'function', '海况页含 data/mounted');
assert(typeof water.data === 'function' && typeof water.mounted === 'function', '水质页含 data/mounted');

section('问题1：两页布局（数值卡 → 时序 → 原始数据 → 调试面板）');
assert(sea.template.indexOf('<page-head') >= 0, '海况页使用 page-head（验收第 4 条）');
assert(water.template.indexOf('<page-head') >= 0, '水质页使用 page-head（验收第 4 条）');
assert(sea.template.indexOf('原始数据') >= 0, '海况页包含原始数据区');
assert(sea.template.indexOf('调试面板') >= 0, '海况页包含调试面板');
assert(sea.template.indexOf('站点切换') >= 0, '海况页包含顶部站点切换');
assert(water.template.indexOf('光照强度') >= 0, '水质页保留光照强度');
assert(water.template.indexOf('盐度') >= 0, '水质页保留盐度/pH');
/* 布局顺序：异常界定指标 → 原始数据 → 调试面板（自上而下） */
const iIndicator = sea.template.indexOf('异常界定指标');
const iRaw = sea.template.indexOf('原始数据');
const iDebug = sea.template.indexOf('调试面板');
assert(iIndicator >= 0 && iIndicator < iRaw && iRaw < iDebug, '海况页顺序：指标表 → 原始数据 → 调试面板');
assert(iRaw < iDebug, '水质页顺序：原始数据 → 调试面板');

section('验收第 2 条关键字（一条竖线，不能删）');
const all = sea.template + water.template;
assert(all.indexOf('水温上限') >= 0, '模板含「水温上限」');
assert(all.indexOf('28.0') >= 0 || all.indexOf('28') >= 0, '模板含 28.0 / 28');
assert(all.indexOf('#/trace') >= 0, '模板含 #/trace');

section('问题1：调试面板/原始数据所需方法已定义');
['ensurePer', 'load', 'setSite', 'onMinutes', 'onCustomMin', 'togglePause', 'exportCsv', 'srcCn', 'qCn', 'fmtTs']
  .forEach(function (m) { assert(typeof sea.methods[m] === 'function', '海况页 methods.' + m); });
['ensurePer', 'load', 'setSite', 'onMinutes', 'onCustomMin', 'togglePause', 'toggleHeat', 'toggleOffline', 'exportCsv', 'srcCn', 'qCn', 'fmtTs']
  .forEach(function (m) { assert(typeof water.methods[m] === 'function', '水质页 methods.' + m); });

section('共享纯函数');
{
  const d = new Date(2026, 9, 7, 12, 34, 56); /* 本地时间 2026-10-07 12:34:56 */
  assert(H.fmtTs(d.getTime()) === '2026年10月07日 12:34:56', 'fmtTs 输出「年/月/日 时:分:秒」，无字母');
  assert(H.fmtTs(null) === '—', 'fmtTs(null) 显示 —');
  assert(H.minutesBetween(1000 * 60 * 5, 0) === 5, 'minutesBetween 5 分钟');
  assert(H.minutesBetween(0, 0) === 1, 'minutesBetween 至少 1 分钟');
  const csv = H.toCsv(['时间', '来源'], [['a,b', '"x"'], ['2026年', 'simulated']]);
  assert(csv.charCodeAt(0) === 0xFEFF, 'CSV 带 UTF-8 BOM');
  assert(csv.indexOf('"a,b"') >= 0, 'CSV 逗号字段加引号');
  assert(csv.indexOf('"x"') >= 0, 'CSV 引号字段正确转义');
  assert(csv.indexOf('simulated') >= 0, 'CSV 正常字段原样输出');
}
{
  const per = H.buildPer(sandbox.API.sites());
  assert(Object.keys(per).length === 4, 'buildPer 覆盖全部 4 个站点');
  assert(per.site_01.paused === false && per.site_01.storm === false, '默认状态：运行中、无风暴');
  assert(H.pausedText(per) === '', '无暂停站点时聚合文本为空');
  per.site_01.paused = true;
  per.site_03.paused = true;
  assert(H.pausedText(per) === 'site_01、site_03（共2个）', '暂停聚合列出所有被暂停站点（不是最后一个）');
  per.site_02.paused = true;
  assert(H.pausedText(per) === 'site_01、site_02、site_03（共3个）', '三个暂停站点按 id 顺序列出');
  per.site_01.paused = false;
  assert(H.pausedText(per) === 'site_02、site_03（共2个）', '恢复后只列仍暂停的站点');
}

section('问题2：时序增强（缩放/框选/红点）+ 异常界定指标');
assert(sea.template.indexOf('ref="chartEl"') >= 0, '海况页有自绘时序容器 chartEl');
assert(water.template.indexOf('ref="chartEl"') >= 0, '水质页有自绘时序容器 chartEl');
assert(sea.template.indexOf('dataZoom') >= 0 || sea.methods.renderChart.toString().indexOf('dataZoom') >= 0,
  '海况页时序支持 dataZoom（缩放/框选）');
assert(sea.methods.renderChart.toString().indexOf('markPoint') >= 0, '海况页时序支持 markPoint（异常点）');
assert(typeof sea.computed.waveDots === 'function' && typeof sea.computed.windDots === 'function',
  '海况页有浪高/风速异常点计算');
assert(typeof water.computed.waterDots === 'function' && typeof water.computed.waterLines === 'function',
  '水质页有水温异常点/阈值线计算');
assert(sea.watch.fast && sea.watch.fast.deep, '海况页数据更新自动重绘');
assert(water.watch.fast && water.watch.fast.deep, '水质页数据更新自动重绘');

/* 红点分级逻辑（直接调用 computed 函数验证） */
{
  const fast = [
    { ts: 1, wave_height: 2.0, wind_speed: 10.0 },   /* 正常：不标 */
    { ts: 2, wave_height: 2.5, wind_speed: 17.1 },   /* 浪高蓝标；风速不到 8 级 */
    { ts: 3, wave_height: 4.0, wind_speed: 17.2 },   /* 浪高黄标；风速红标 */
    { ts: 4, wave_height: 6.0, wind_speed: null },   /* 浪高橙标；风速空不标 */
    { ts: 5, wave_height: 9.0, wind_speed: 20.0 },   /* 浪高红标；风速红标 */
    { ts: 6, wave_height: null, wind_speed: 30.0 }   /* 浪高空不标；风速红标 */
  ];
  const dots = sea.computed.waveDots.call({ fast: fast });
  const colors = dots.map(function (d) { return d.itemStyle.color; });
  assert(colors.join(',') === '#1D4ED8,#D97706,#EA580C,#991B1B',
    '浪高异常点按国标四色分级（蓝/黄/橙/红），正常与空值不标（实际：' + colors.join(',') + '）');
  const wd = sea.computed.windDots.call({ fast: fast });
  assert(wd.length === 3, '风速 ≥17.2 m/s 全部标红（含 null 跳过），实际 ' + wd.length + ' 个');
  const wf = [
    { ts: 1, water_temp: 25.4 }, { ts: 2, water_temp: 25.5 },
    { ts: 3, water_temp: 28.0 }, { ts: 4, water_temp: null }
  ];
  const wt = water.computed.waterDots.call({ fast: wf });
  const wc = wt.map(function (d) { return d.itemStyle.color; });
  assert(wc.join(',') === '#D97706,#991B1B', '水温异常点：25.5 黄、28.0 红，空值跳过（实际：' + wc.join(',') + '）');
  const wl = water.computed.waterLines.call({});
  assert(wl.length === 2 && wl[0].yAxis === 28.0 && wl[1].yAxis === 25.5, '水温阈值线 28.0 / 25.5');
}
assert(sea.template.indexOf('异常界定指标') >= 0, '海况页含异常界定指标表');
assert(water.template.indexOf('异常界定指标') >= 0, '水质页含异常界定指标表');
assert(sea.template.indexOf('GB/T 19721.2') >= 0, '指标表标注浪高依据（国标）');
assert(sea.template.indexOf('蒲福风级') >= 0, '指标表标注风速依据（蒲福风级）');
assert(water.template.indexOf('R-TEMP-01') >= 0, '水质指标表标注规则 R-TEMP-01');
assert(sea.template.indexOf('help-dot') >= 0 && sea.template.indexOf(':info=') >= 0,
  'help-dot 使用正确的 :info 对象写法');

section('问题3：原始数据区（时间窗 / CSV 导出 / 公开数据可见）');
assert(sea.template.indexOf('<time-range') >= 0, '海况页有 time-range 时间窗');
assert(sea.template.indexOf('自定义分钟数') >= 0, '海况页有自定义分钟输入');
assert(sea.template.indexOf('导出 CSV') >= 0, '海况页有导出 CSV 按钮');
assert(sea.template.indexOf('fmtTs(r.ts)') >= 0, '原始数据表时间用年/月/日格式（无字母混用）');
/* 标题改为 computed rawTitle（历史区间/实时窗口动态标注），源码须同时含两种数据来源文案 */
{
  const rt = sea.computed.rawTitle.toString();
  assert(rt.indexOf('NOAA NDBC 公开历史数据') >= 0 && rt.indexOf('仿真数据') >= 0,
    '原始数据标题动态标注公开历史数据/仿真');
}
assert(sea.template.indexOf('backend/api/env.py') >= 0, '精确历史日期接口的降级说明已展示');
assert(water.template.indexOf('快变量') >= 0 && water.template.indexOf('慢变量（盐度 / pH）') >= 0,
  '水质页原始数据分快变量/慢变量两张表');
assert(water.template.indexOf('导出 CSV') >= 0, '水质页有导出 CSV 按钮');

/* 功能级验证：mock DOM 捕获实际导出的 CSV 与文件名 */
{
  let capturedCsv = null, capturedName = null;
  sandbox.Blob = function (parts) { capturedCsv = parts[0]; };
  sandbox.URL.createObjectURL = function () { return 'blob:mock'; };
  sandbox.URL.revokeObjectURL = function () {};
  sandbox.document.createElement = function () {
    const el = { click: function () {}, remove: function () {} };
    Object.defineProperty(el, 'download', { set: function (v) { capturedName = v; } });
    return el;
  };
  const seaInst = {
    site: 'site_01',
    fast: [{ ts: 1760000000000, site_id: 'site_01', source: 'simulated', quality: 'good',
             wave_height: 1.5, wind_speed: 8.3, current_speed: 0.6, air_temp: 22.4 }]
  };
  seaInst.siteName = function () { return sea.methods.siteName.call(seaInst); };
  seaInst.exportCsv = sea.methods.exportCsv;
  seaInst.exportCsv();
  assert(capturedCsv && capturedCsv.indexOf('\ufeff时间,站点,来源,质量,浪高 (m),风速 (m/s),流速 (m/s),气温 (℃)') === 0,
    '海况导出 CSV 表头完整且带 UTF-8 BOM');
  assert(capturedCsv && capturedCsv.indexOf('仿真数据') >= 0 && capturedCsv.indexOf('良好') >= 0,
    '海况导出 CSV 来源/质量为中文（无裸英文）');
  assert(capturedName === '海况原始数据_模拟养殖站点.csv',
    '海况导出文件名用中文站点名（实际：' + capturedName + '）');
}
{
  const wInst = {
    site: 'site_01',
    fast: [{ ts: 1760000000000, site_id: 'site_01', source: 'simulated', quality: 'good',
             water_temp: 18.6, dissolved_oxygen: 9.2, light_intensity: 12000 }]
  };
  wInst.siteName = function () { return water.methods.siteName.call(wInst); };
  wInst.exportCsv = water.methods.exportCsv;
  let csv2 = null, name2 = null;
  sandbox.Blob = function (parts) { csv2 = parts[0]; };
  sandbox.document.createElement = function () {
    const el = { click: function () {}, remove: function () {} };
    Object.defineProperty(el, 'download', { set: function (v) { name2 = v; } });
    return el;
  };
  wInst.exportCsv();
  assert(csv2 && csv2.indexOf('\ufeff时间,站点,来源,质量,水温 (℃),溶解氧 (mg/L),光照 (lux)') === 0,
    '水质导出 CSV 表头完整且带 UTF-8 BOM');
  assert(name2 === '水质原始数据_模拟养殖站点.csv', '水质导出文件名用中文站点名（实际：' + name2 + '）');
}

section('问题4：站点独立 + 切换（per-site 状态互不影响）');
{
  const per = H.buildPer(sandbox.API.sites());
  assert(per.site_01 !== per.site_02, '每个站点是独立状态对象（互不引用）');
  per.site_01.paused = true;
  per.site_01.minutes = 1440;
  assert(per.site_02.paused === false && per.site_02.minutes === 60,
    '修改 site_01 不影响 site_02 / site_03 / site_04 的状态与时间窗');
  assert(per.site_03.paused === false && per.site_04.paused === false, '其余站点保持运行中');
}
{
  assert(H.shouldRefresh(null, 'site_01') === true, 'per 未初始化时默认刷新（运行）');
  assert(H.shouldRefresh({ site_01: { paused: false } }, 'site_01') === true, '运行中站点刷新');
  assert(H.shouldRefresh({ site_01: { paused: true } }, 'site_01') === false, '暂停站点不刷新（冻结）');
  assert(H.shouldRefresh({ site_01: { paused: true } }, 'site_02') === true,
    'site_01 暂停不影响 site_02 刷新');
}
assert(String(sea.mounted).indexOf('setInterval') >= 0 && String(sea.mounted).indexOf('5000') >= 0,
  '海况页有 5 秒轮询');
assert(String(water.mounted).indexOf('setInterval') >= 0 && String(water.mounted).indexOf('5000') >= 0,
  '水质页有 5 秒轮询');
assert(String(sea.watch.site).indexOf('shouldRefresh') >= 0, '海况页切换站点时跳过已暂停站点');
assert(String(water.watch.site).indexOf('shouldRefresh') >= 0, '水质页切换站点时跳过已暂停站点');
assert(sea.template.indexOf('pauseText') >= 0, '调试面板显示暂停聚合文本');

section('问题5：调试面板（暂停聚合 + 风暴细化 + 状态显示）');
assert(sea.template.indexOf('调试面板 · 仿真控制') >= 0, '海况页调试面板标题');
assert(sea.template.indexOf('仅风速异常') >= 0 && sea.template.indexOf('仅浪高异常') >= 0,
  '海况页有风暴细化选项（整体/仅风速/仅浪高）');
assert(sea.template.indexOf('stormNote') >= 0, '海况页显示细化降级提示');
assert(typeof sea.methods.setStormType === 'function', '海况页 methods.setStormType 已定义');
{
  const note = sea.computed.stormNote;
  assert(note.call({ per: null, site: 'site_01' }) === '', 'per 未初始化时无细化提示');
  assert(note.call({ per: { site_01: { stormType: 'all' } }, site: 'site_01' }) === '',
    '整体大风大浪无细化提示');
  const w = note.call({ per: { site_01: { stormType: 'wind' } }, site: 'site_01' });
  assert(w.indexOf('仅风速异常') >= 0 && w.indexOf('已生效') >= 0,
    '仅风速异常提示说明细化模式已生效（前端流式生成器直接实现，无需后端挂载）');
  const v = note.call({ per: { site_01: { stormType: 'wave' } }, site: 'site_01' });
  assert(v.indexOf('仅浪高异常') >= 0 && v.indexOf('已生效') >= 0, '仅浪高异常细化提示');
}
assert(water.template.indexOf('触发水温骤升') >= 0 && water.template.indexOf('模拟设备离线') >= 0,
  '水质页调试面板含水温骤升/设备离线');
assert(sea.template.indexOf('暂停生成') >= 0 && water.template.indexOf('暂停生成') >= 0,
  '两页调试面板含暂停生成按钮');

section('新问题1：真实站点（公开数据）不参与仿真控制');
{
  assert(sea.template.indexOf('公开数据不参与仿真控制') >= 0, '海况调试面板：观测站点无暂停/风暴操作按钮');
  assert(sea.template.indexOf('实时实测（不可模拟）') >= 0, '海况调试面板：观测站点模式为实时实测');
  assert(water.template.indexOf('公开数据不参与仿真控制') >= 0, '水质调试面板：观测站点无暂停/骤升/离线按钮');
  assert(water.template.indexOf('实时实测（不可模拟）') >= 0, '水质调试面板：观测站点模式为实时实测');
  const stormZone = sea.template.slice(sea.template.indexOf('大风大浪细化'));
  assert(stormZone.indexOf('v-if="!isObs"') >= 0, '风暴细化选项仅养殖站点显示（观测站点不可模拟）');
  assert(typeof sea.methods.isObsSite === 'function' && typeof water.methods.isObsSite === 'function',
    '两页都有 isObsSite 判断方法');
}
{
  const noop = function () {};
  const per = { site_01: { paused: false, storm: false, heat: false, offline: false },
                site_02: { paused: false, storm: false, heat: false, offline: false },
                site_03: { paused: false, storm: false, heat: false, offline: false } };
  const seaInst = { site: 'site_01', per: per, load: noop, isObsSite: sea.methods.isObsSite };
  sea.methods.togglePause.call(seaInst, 'site_02');
  sea.methods.toggleStorm.call(seaInst, 'site_03');
  assert(per.site_02.paused === false, '真实站点 site_02 不可暂停');
  assert(per.site_03.storm === false, '真实站点 site_03 不可模拟大风大浪');
  sea.methods.togglePause.call(seaInst, 'site_01');
  assert(per.site_01.paused === true, '养殖站点 site_01 可正常暂停');
  const waterInst = { site: 'site_01', per: per, load: noop, isObsSite: water.methods.isObsSite };
  water.methods.toggleHeat.call(waterInst, 'site_02');
  water.methods.toggleOffline.call(waterInst, 'site_02');
  assert(per.site_02.heat === false && per.site_02.offline === false, '真实站点不可触发骤升/离线');
}

section('问题6：per 空值安全（首渲染不抛错 —— 修复 Cannot read properties of null (reading site_01)）');
{
  const re = /(?<!per && )per\[(site|s\.site_id)\] &&/g;
  const hits1 = sea.template.match(re);
  assert(!hits1, '海况模板所有 per[...] 读取都有 per && 空值防护（无裸读）');
  const hits2 = water.template.match(re);
  assert(!hits2, '水质模板所有 per[...] 读取都有 per && 空值防护（无裸读）');
  assert(sea.template.indexOf('per && per[site] && per[site].stormType') >= 0,
    '风暴细化 radio 有 per 空值防护');
  assert(sea.template.indexOf('per && per[s.site_id] && per[s.site_id].paused') >= 0,
    '调试面板状态/按钮有 per 空值防护');
  assert(water.template.indexOf('per && per[s.site_id] && (per[s.site_id].heat') >= 0,
    '水质调试面板骤升/离线有 per 空值防护');
}

section('新问题2：真实站点自定义时间历史 + 数据时间范围');
{
  assert(sea.template.indexOf('datetime-local') >= 0, '海况页有自定义起止时间输入（年/月/日 时:分）');
  assert(sea.template.indexOf('查询历史') >= 0 && sea.template.indexOf('返回实时') >= 0, '海况页有查询历史/返回实时按钮');
  assert(water.template.indexOf('datetime-local') >= 0 && water.template.indexOf('查询历史') >= 0,
    '水质页有自定义起止时间输入与查询按钮');
  assert(sea.template.indexOf('数据时间范围') >= 0, '浮标表头改为「数据时间范围」');
  assert(typeof sea.methods.queryRange === 'function' && typeof sea.methods.exitRange === 'function',
    '海况页有 queryRange / exitRange 方法');
  assert(typeof sea.methods.loadRanges === 'function' && typeof water.methods.loadRanges === 'function',
    '两页都有 loadRanges（精确时间范围）');
  assert(typeof sea.computed.rawRows === 'function' && typeof sea.computed.rawTitle === 'function',
    '海况页有 rawRows / rawTitle');
  assert(typeof water.computed.slowRows === 'function', '水质页有 slowRows（慢变量倒序）');
}
{
  /* 无效时间提示（同步） */
  const inst = { site: 'site_01', rangeStart: '2026-10-08T12:00', rangeEnd: '2026-10-08T10:00', rangeMsg: '' };
  sea.methods.queryRange.call(inst);
  assert(inst.rangeMsg.indexOf('结束时间需晚于开始时间') >= 0, '结束时间早于开始时间 → 提示错误');
}
/* 成功 / 失败路径：mock fetch（Promise），异步断言 */
{
  const inst = { site: 'site_02', rangeStart: '2026-09-01T00:00', rangeEnd: '2026-09-02T00:00',
                 rangeMode: false, rangeSeries: null, rangeMsg: '', ranges: {},
                 loadRanges: sea.methods.loadRanges };
  let firstUrl = '', calledUrl = '';
  sandbox.fetch = function (url) {
    if (!firstUrl) firstUrl = url;
    calledUrl = url;
    if (url.indexOf('/api/env/ndbc-ranges') >= 0) {
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve({ ranges: [
          { station_id: '42001', first_ts_utc: '2026-08-25 00:10', latest_ts_utc: '2026-10-08 03:30' }
        ] });
      } });
    }
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve({ count: 2, records: [
        { ts: 1700000000000, site_id: 'site_02', source: 'public' },
        { ts: 1700000000100, site_id: 'site_02', source: 'public' }
      ] });
    } });
  };
  sea.methods.queryRange.call(inst);
  await new Promise(function (r) { setTimeout(r, 0); });
  await new Promise(function (r) { setTimeout(r, 0); });
  assert(firstUrl.indexOf('/api/env/historical?site_id=site_02&start_ts=') === 0,
    'queryRange 先请求 historical 接口（含站点与起止时间戳）');
  assert(inst.rangeMode === true && inst.rangeSeries.length === 2, '查询成功后进入历史区间模式并保存数据');
  assert(inst.rangeMsg.indexOf('已加载 2 条公开历史数据') >= 0, '成功提示含条数与区间');
  assert(inst.ranges['42001'] && inst.ranges['42001'].first_ts_utc === '2026-08-25 00:10',
    '查询历史成功后惰性请求 ndbc-ranges，数据时间范围变精确');
  assert(calledUrl.indexOf('/api/env/ndbc-ranges') >= 0, '成功路径会请求精确范围接口（不产生未挂载 404）');
  /* 失败降级（接口未挂载） */
  const failInst = { site: 'site_02', rangeStart: '2026-09-01T00:00', rangeEnd: '2026-09-02T00:00',
                     rangeMode: false, rangeSeries: null, rangeMsg: '' };
  sandbox.fetch = function () {
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  };
  sea.methods.queryRange.call(failInst);
  await new Promise(function (r) { setTimeout(r, 0); });
  assert(failInst.rangeMode === false && failInst.rangeMsg.indexOf('需队长在 server.py 挂载') >= 0,
    '接口未挂载（404）→ 诚实降级提示，不假装成功');
  /* exitRange 复位并回到实时 */
  let loadCalled = 0;
  failInst.load = function () { loadCalled++; };
  sea.methods.exitRange.call(failInst);
  assert(failInst.rangeMode === false && failInst.rangeSeries === null && failInst.rangeMsg === '' && loadCalled === 1,
    'exitRange 复位历史区间并回到实时');
}
{
  /* ndbcRangeText：精确（挂载）/ 估算（未挂载）/ 无数据 */
  const inst = { ranges: { '42001': { first_ts_utc: '2026-08-25 00:10', latest_ts_utc: '2026-10-08 03:30' } } };
  inst.ndbcRangeText = sea.methods.ndbcRangeText;
  const exact = inst.ndbcRangeText({ station_id: '42001' });
  assert(exact.indexOf('2026-08-25 00:10 ~ 2026-10-08 03:30 UTC') >= 0, '挂载后显示精确数据时间范围');
  const est = sea.methods.ndbcRangeText.call({ ranges: {} },
    { station_id: '46001', latest_ts: 1700000000000, count: 6373 });
  assert(est.indexOf('估算') >= 0 && est.indexOf('~') >= 0, '未挂载时按缓存估算并诚实标注「估算」');
  const none = sea.methods.ndbcRangeText.call({ ranges: {} },
    { station_id: '51001', latest_ts_utc: '2026-10-08 03:30' });
  assert(none === '2026-10-08 03:30', '仅有 latest 时显示原值');
}

section('新问题3：原始数据最新在最上面（倒序显示，导出保持正序）');
{
  assert(sea.template.indexOf('v-for="r in rawRows"') >= 0, '海况原始数据表使用 rawRows（倒序）');
  assert(water.template.indexOf('v-for="r in rawRows"') >= 0, '水质快变量表使用 rawRows（倒序）');
  assert(water.template.indexOf('v-for="r in slowRows"') >= 0, '水质慢变量表使用 slowRows（倒序）');
  assert(sea.template.indexOf('最新在上') >= 0 && water.template.indexOf('最新在上') >= 0,
    '两页原始数据区说明「最新在上」');
}
{
  const inst = { rangeMode: false, rangeSeries: null, fast: [{ ts: 1 }, { ts: 2 }, { ts: 3 }] };
  const rr = sea.computed.rawRows.call(inst);
  assert(rr[0].ts === 3 && rr[2].ts === 1, '实时窗口：最新数据排最上面（倒序），数量不变');
  const inst2 = { rangeMode: true, rangeSeries: [{ ts: 10 }, { ts: 20 }], fast: [{ ts: 1 }] };
  const rr2 = sea.computed.rawRows.call(inst2);
  assert(rr2[0].ts === 20 && rr2[1].ts === 10, '历史区间：最新数据排最上面');
  const sr = water.computed.slowRows.call({ slow: [{ ts: 1 }, { ts: 2 }, { ts: 3 }] });
  assert(sr[0].ts === 3 && sr[2].ts === 1, '慢变量表倒序显示');
  assert(sea.methods.exportCsv.toString().indexOf('rangeMode ? (this.rangeSeries || []) : this.fast') >= 0,
    '导出 CSV 使用正序数据源（页面倒序、导出正序）');
}
/* CSV 实际导出内容按时间正序（模拟站点 + 真实站点同规则） */
{
  let capturedCsv = null;
  sandbox.Blob = function (parts) { capturedCsv = parts[0]; };
  sandbox.URL.createObjectURL = function () { return 'blob:mock'; };
  sandbox.URL.revokeObjectURL = function () {};
  sandbox.document.createElement = function () {
    const el = { click: function () {}, remove: function () {} };
    Object.defineProperty(el, 'download', { set: function () {} });
    return el;
  };
  const inst = { site: 'site_01', rangeMode: false, rangeSeries: null,
                 fast: [{ ts: 1000, site_id: 'site_01', source: 'simulated', quality: 'good',
                          wave_height: 1.0, wind_speed: 5.0, current_speed: 0.3, air_temp: 20.0 },
                        { ts: 2000, site_id: 'site_01', source: 'simulated', quality: 'good',
                          wave_height: 1.5, wind_speed: 8.0, current_speed: 0.5, air_temp: 21.0 }] };
  inst.siteName = function () { return '模拟养殖站点'; };
  inst.exportCsv = sea.methods.exportCsv;
  inst.exportCsv();
  const H = sandbox.__ENV_HELPERS__;
  assert(capturedCsv.indexOf(H.fmtTs(1000)) < capturedCsv.indexOf(H.fmtTs(2000)),
    'CSV 按时间正序导出（最早在前），页面显示为最新在上');
}

section('新问题4：水质时序补盐度 + 光照强度纵轴完整显示');
{
  const wData = water.data();
  assert(wData.show.salinity === true, '水质页默认显示盐度曲线开关（salinity=true）');
  assert(water.template.indexOf('v-model="show.salinity"') >= 0, '模板有盐度曲线 checkbox');
  const rc = water.methods.renderChart.toString();
  assert(rc.indexOf('盐度（‰）') >= 0, '时序图新增盐度曲线');
  assert(rc.indexOf('this.slow.map') >= 0, '盐度曲线数据来自慢变量（30 秒一条）');
  assert(rc.indexOf('max: 14000') >= 0 && rc.indexOf('光照(lux)') >= 0,
    '光照右轴固定量程 0–14000 lux 并带轴名，刻度完整显示');
  assert(rc.indexOf('grid: needAxis2') >= 0 && rc.indexOf('right: 58') >= 0,
    '右轴有轴名/标签时留足右侧空间（grid right 58），避免纵轴被裁');
}

section('新问题5：所有异常数据进事件列表（含时间/站点/数据，真实站点同列）');
{
  /* 海况：浪高警报 + 风速 ≥17.2 都进事件；每条含 站点名 · 时间 · 数据 */
  const H = sandbox.__ENV_HELPERS__;
  const fast = [
    { ts: 1000, wave_height: 1.0, wind_speed: 8.0 },     /* 正常：不出事件 */
    { ts: 2000, wave_height: 4.0, wind_speed: 17.2 },    /* 浪高黄 + 风速红 */
    { ts: 3000, wave_height: null, wind_speed: 20.0 },   /* 风速红（浪高空） */
    { ts: 4000, wave_height: 9.0, wind_speed: null }     /* 浪高红（风速空） */
  ];
  const inst = { fast: fast, allFast: fast, siteName: function () { return '墨西哥湾中部'; } };
  const evs = sea.computed.events.call(inst);
  assert(evs.length === 4, '浪高警报 + 风速异常全部列为事件（实际 ' + evs.length + ' 条）');
  assert(evs[0].ts === 4000 && evs[evs.length - 1].ts === 2000, '事件按时间降序（最新在上）');
  const joined = evs.map(function (e) { return e.text; }).join('\n');
  assert(joined.indexOf('墨西哥湾中部') >= 0, '事件包含站点名（真实站点公开数据异常同样列入）');
  assert(joined.indexOf(H.fmtTs(4000)) >= 0, '事件包含时间');
  assert(joined.indexOf('浪高 9 m') >= 0 && joined.indexOf('红色警报级') >= 0, '浪高事件含数据与分级');
  assert(joined.indexOf('风速 17.2 m/s') >= 0 && joined.indexOf('8 级及以上大风') >= 0,
    '风速 ≥17.2 事件含数据与依据');
}
{
  /* 水质：水温越限事件含 站点 · 时间 · 数据 · 规则（真实站点同口径） */
  const inst = { fast: [{ ts: 1, water_temp: 28.5 }, { ts: 2, water_temp: 20.0 }],
                 allFast: [{ ts: 1, water_temp: 28.5 }, { ts: 2, water_temp: 20.0 }] };
  inst.alarms = water.computed.alarms.call(inst);
  inst.siteName = function () { return '阿拉斯加湾西部'; };
  const evs = water.computed.events.call(inst);
  assert(evs.length === 1, '仅水温越限出事件（实际 ' + evs.length + ' 条）');
  const t = evs[0].text;
  assert(t.indexOf('阿拉斯加湾西部') >= 0 && t.indexOf('水温 28.5 ℃') >= 0 &&
         t.indexOf('R-TEMP-01 水温上限') >= 0, '水质事件含 站点 · 时间 · 数据 · 规则名');
}

section('新问题6：页面切换不丢站点选择；仿真控制状态两页各自独立');
{
  /* 海况页初始化自己的 per（seaPer） */
  const i1 = { per: null, site: 'site_01', chart: null, pageKey: 'sea' };
  sea.methods.ensurePer.call(i1);
  assert(!!i1.per.site_01 && i1.per.site_01.paused === false, 'ensurePer 补齐全部站点状态');
  /* 海况页在 site_01 暂停、site_03 调时间窗与风暴细化，然后切到水质页 */
  i1.per.site_01.paused = true;
  i1.per.site_03.minutes = 240;
  i1.per.site_03.stormType = 'wind';
  const S = sandbox.__ENV_SESSION__;
  S.site = 'site_02';
  const wd = water.data();
  assert(wd.site === 'site_02', '水质页打开恢复上次选择的站点（site_02）');
  const i2 = { per: wd.per, site: wd.site, chart: null, pageKey: 'water' };
  water.methods.ensurePer.call(i2);
  assert(i2.per !== i1.per, '两页 per 各自独立（海况 seaPer / 水质 waterPer，非同一对象）');
  assert(i2.per.site_01.paused === false, '海况页暂停 site_01 → 水质页不受影响（仍运行中）');
  assert(i2.per.site_03.minutes === 60, '水质页时间窗独立（海况调的 240 不影响水质页）');
  assert(i2.per.site_03.stormType === 'all', '风暴细化选择两页独立（海况选 wind 不影响水质页）');
  /* 水质页暂停 site_01 → 海况页也不受影响（反向） */
  i2.per.site_01.paused = true;
  assert(i1.per.site_01.paused === true, '水质页暂停不覆盖海况页（海况页保持自己的暂停状态）');
  i1.per.site_01.paused = false;
  assert(i2.per.site_01.paused === true, '海况页恢复暂停 → 水质页保持自己的暂停状态');
  /* watch.site 写回全局（静态验证：切换站点后另一页也能恢复） */
  assert(sea.watch.site.toString().indexOf('S.site = this.site') >= 0 &&
         water.watch.site.toString().indexOf('S.site = this.site') >= 0,
    '两页 watch.site 都把站点选择写回全局');
}

section('问题一：两页仿真控制互不影响（暂停 / 大风大浪 / 骤升 数据隔离）');
{
  const G = sandbox.__ENV_GEN__;
  vm.runInContext('__origRandom = Math.random; Math.random = function () { return 0.5; }; ' +
    '__origDateNow = Date.now; Date.now = function () { return new Date(2026, 9, 8, 12, 0, 0).getTime(); };', sandbox);
  try {
    /* site_01 是唯一养殖站点；清掉本段要用的序列键并重置 per 状态，
       避免与他段（新问题6 段 / 问题一段）的全局状态互相污染 */
    delete G.series['site_01::sea'];
    delete G.series['site_01::water'];
    const s1 = { per: null, site: 'site_01', chart: null, pageKey: 'sea', isObsSite: sea.methods.isObsSite,
                 load: function () {} };
    sea.methods.ensurePer.call(s1);
    const w1 = { per: null, site: 'site_01', chart: null, pageKey: 'water', isObsSite: water.methods.isObsSite,
                 load: function () {} };
    water.methods.ensurePer.call(w1);
    s1.per.site_01.paused = false; s1.per.site_01.storm = false; s1.per.site_01.heat = false;
    w1.per.site_01.paused = false; w1.per.site_01.storm = false; w1.per.site_01.heat = false;
    assert(s1.per !== w1.per, '海况页与水质页的仿真控制状态对象不同（seaPer / waterPer）');
    /* 海况页暂停 site_01 → 水质页 per 不受影响 */
    sea.methods.togglePause.call(s1, 'site_01');
    assert(s1.per.site_01.paused === true, '海况页暂停 site_01 生效');
    assert(w1.per.site_01.paused === false, '水质页 site_01 仍运行中（不受海况页影响）');
    /* 海况页触发大风大浪 → 海况序列新点异常；水质序列新点正常 */
    sea.methods.toggleStorm.call(s1, 'site_01');
    assert(s1.per.site_01.storm === true, '海况页触发大风大浪生效');
    assert(w1.per.site_01.storm === false, '水质页 per 无风暴（不受影响）');
    let seaSt = G.ensure('site_01', 5, s1.per.site_01, 'sea');
    const seaLast = seaSt.fast[seaSt.fast.length - 1];
    seaSt = G.appendTo('site_01', seaLast.ts + 5 * 1000, s1.per.site_01, 5, 'sea');
    const seaNew = seaSt.fast[seaSt.fast.length - 1];
    assert(seaNew.wave_height >= 4.0 && seaNew.wind_speed >= 17.2 && seaNew.quality === 'suspect',
      '海况页自己的序列：风暴后新点浪高≥4.0、风速≥17.2（异常）');
    let wSt = G.ensure('site_01', 5, w1.per.site_01, 'water');
    const wLast = wSt.fast[wSt.fast.length - 1];
    wSt = G.appendTo('site_01', wLast.ts + 5 * 1000, w1.per.site_01, 5, 'water');
    const wNew = wSt.fast[wSt.fast.length - 1];
    assert(wNew.wave_height < 2.5 && wNew.wind_speed < 17.2 && wNew.quality === 'good',
      '水质页自己的序列：无风暴影响，新点浪高/风速正常、质量良好');
    assert(wNew.light_intensity >= 10000,
      '水质页光照强度正常（≥10000 lux，未受海况风暴 4000 影响）');
    assert(seaSt !== wSt, '两页序列独立（站点+页面双键，非同一份序列）');
    /* 水质页触发水温骤升 → 水质序列水温异常；海况序列水温正常 */
    water.methods.toggleHeat.call(w1, 'site_01');
    assert(w1.per.site_01.heat === true && s1.per.site_01.heat === false,
      '水质页骤升生效，海况页 per 无骤升');
    const wSt2 = G.appendTo('site_01', wNew.ts + 5 * 1000, w1.per.site_01, 5, 'water');
    const wNew2 = wSt2.fast[wSt2.fast.length - 1];
    assert(wNew2.water_temp >= 28.0 && wNew2.quality === 'suspect',
      '水质序列骤升后水温≥28.0（异常）');
    const seaSt2 = G.appendTo('site_01', seaNew.ts + 5 * 1000, s1.per.site_01, 5, 'sea');
    const seaNew2 = seaSt2.fast[seaSt2.fast.length - 1];
    assert(seaNew2.water_temp < 25.5, '海况序列水温正常（未受水质页骤升影响）');
    /* allFast 分页读取：海况读 site_01::sea，水质读 site_01::water */
    const seaInst = { fast: seaSt2.fast.slice(-10), isObs: false, site: 'site_01', pageKey: 'sea' };
    const seaAll = sea.computed.allFast.call(seaInst);
    assert(seaAll[seaAll.length - 1] === seaNew2, '海况页 allFast 读本页序列（site_01::sea）');
    const wInst = { fast: wSt2.fast.slice(-10), isObs: false, site: 'site_01', pageKey: 'water' };
    const wAll = water.computed.allFast.call(wInst);
    assert(wAll[wAll.length - 1] === wNew2, '水质页 allFast 读本页序列（site_01::water）');
  } finally {
    delete G.series['site_01::sea'];
    delete G.series['site_01::water'];
    vm.runInContext('Math.random = __origRandom; Date.now = __origDateNow;', sandbox);
  }
}

section('问题一：触发异常只影响「接下来实时生成」的数据（已生成点不变）');
{
  const G = sandbox.__ENV_GEN__;
  assert(!!G && typeof G.appendTo === 'function' && typeof G.ensure === 'function',
    '流式仿真生成器 __ENV_GEN__ 已挂载（ensure / appendTo）');
  /* 清键：防止前面测试段（两页隔离段）留下的序列污染本段首填 */
  delete G.series['site_01::sea'];
  /* Math 是 vm 沙箱内建全局，须在沙箱上下文内替换（测试确定性：rndn → 均值） */
  vm.runInContext('__origRandom = Math.random; Math.random = function () { return 0.5; };', sandbox);
  try {
    const per = { minutes: 5, paused: false, storm: false, heat: false, offline: false,
                  stormType: 'all', heatSince: null };
    const st = G.ensure('site_01', 5, per);            /* 首填 5 分钟窗口：正常值 */
    const beforeLen = st.fast.length;
    const before0 = st.fast[0];
    const lastNormal = st.fast[beforeLen - 1];
    assert(lastNormal.wave_height < 2.5 && lastNormal.wind_speed < 17.2 &&
           lastNormal.quality === 'good', '正常状态下生成的点：浪高/风速正常、质量良好');
    /* 触发大风大浪 → 追加下一个 5 秒生成的点 */
    per.storm = true;
    G.appendTo('site_01', lastNormal.ts + 5 * 1000, per, 5);
    const abn = st.fast[st.fast.length - 1];
    assert(abn.wave_height >= 4.0 && abn.wind_speed >= 17.2 && abn.quality === 'suspect',
      '触发大风大浪后：接下来生成的点浪高≥4.0（黄标）且风速≥17.2（8级大风），质量疑似异常');
    assert(st.fast.length === beforeLen + 1, '触发只追加新点，没有重生成历史窗口');
    assert(st.fast[0] === before0 && st.fast[beforeLen - 1] === lastNormal,
      '已生成的点未被改写（对象引用不变：首点与最后一个正常点都保持原对象）');
    /* 触发水温骤升 → 追加点直接到目标 30.5℃ */
    per.storm = false;
    per.heat = true; per.heatSince = Date.now();
    G.appendTo('site_01', abn.ts + 5 * 1000, per, 5);
    const h = st.fast[st.fast.length - 1];
    assert(h.water_temp >= 28.0 && h.quality === 'suspect',
      '触发水温骤升：接下来生成的点水温≥28.0（上限），质量疑似异常');
    /* 恢复（风暴关 / 骤升关）→ 新点回正常，异常期间的点保留 */
    per.heat = false; per.heatSince = null;
    G.appendTo('site_01', h.ts + 5 * 1000, per, 5);
    const norm = st.fast[st.fast.length - 1];
    assert(norm.wave_height < 2.5 && norm.water_temp < 25.5 && norm.quality === 'good',
      '恢复正常后：接下来生成的点回正常值，质量良好');
    assert(st.fast[st.fast.length - 2] === h && st.fast[beforeLen] === abn,
      '异常期间生成的点永久保留（对象引用不变，未随恢复被重写）');
  } finally {
    vm.runInContext('Math.random = __origRandom;', sandbox);
  }
}

section('问题二：异常事件记录保留（恢复正常后，异常期间的数据与事件不消除）');
{
  const G = sandbox.__ENV_GEN__;
  /* 清键：本段自给自足（正常首填 → 风暴追加 → 恢复追加） */
  delete G.series['site_01::sea'];
  /* 回归断言：events/alarms 必须显式依赖 this.fast.length ——
     若只经 allFast（computed 返回同一数组引用），Vue 不通知下游，
     事件/告警列表会停留在旧数据（2026-10-08 浏览器实测踩坑） */
  assert(sea.computed.events.toString().indexOf('this.fast.length') >= 0,
    '海况 events 显式依赖 fast.length（series 更新时事件列表实时重算）');
  assert(water.computed.alarms.toString().indexOf('this.fast.length') >= 0,
    '水质 alarms 显式依赖 fast.length（series 更新时告警列表实时重算）');
  vm.runInContext('__origRandom = Math.random; Math.random = function () { return 0.5; };', sandbox);
  try {
    const per = { minutes: 5, paused: false, storm: false, heat: false, offline: false,
                  stormType: 'all', heatSince: null };
    const st = G.ensure('site_01', 5, per);
    const lastNormal = st.fast[st.fast.length - 1];
    per.storm = true;
    G.appendTo('site_01', lastNormal.ts + 5 * 1000, per, 5);
    const abn = st.fast[st.fast.length - 1];
    per.storm = false;
    G.appendTo('site_01', abn.ts + 5 * 1000, per, 5);
    const norm = st.fast[st.fast.length - 1];
    assert(norm.wave_height < 2.5, '恢复后新生成点浪高回正常');
    /* 事件基于全量序列（allFast）—— 异常点仍在序列 → 事件仍列出 */
    const evInst = { fast: st.fast.slice(-10), allFast: st.fast, isObs: false, site: 'site_01',
                     siteName: function () { return '模拟养殖站点'; } };
    const evs = sea.computed.events.call(evInst);
    const joined = evs.map(function (e) { return e.text; }).join('\n');
    assert(joined.indexOf('浪高 ' + abn.wave_height + ' m') >= 0,
      '恢复正常后，异常期间生成的浪高事件仍存在于事件列表（不消除）');
    assert(joined.indexOf('风速 ' + abn.wind_speed + ' m/s') >= 0,
      '恢复正常后，异常期间生成的风速事件仍存在于事件列表（不消除）');
  } finally {
    vm.runInContext('Math.random = __origRandom;', sandbox);
  }
}

section('问题三：正常状态偶发「较异常」数据并计入事件');
{
  const G = sandbox.__ENV_GEN__;
  /* 清键：本段独立首填（可控序列第 1 次调用命中偶发注入） */
  delete G.series['site_01::sea'];
  /* 在沙箱上下文内注入可控随机序列：第 1 次调用返回 0.001（命中偶发注入），之后返回 0.5（rndn → 均值） */
  vm.runInContext('__origRandom = Math.random; __calls = 0; Math.random = function () { __calls += 1; return __calls === 1 ? 0.001 : 0.5; };', sandbox);
  try {
    const per = { minutes: 5, paused: false, storm: false, heat: false, offline: false,
                  stormType: 'all', heatSince: null };
    const st = G.ensure('site_01', 5, per);
    const H = sandbox.__ENV_HELPERS__;
    const abn = st.fast.filter(function (r) { return r.quality === 'suspect'; })[0];
    assert(!!abn, '正常模式下出现了质量「疑似异常」的点（偶发注入）');
    assert(!!abn && ((abn.wave_height != null && abn.wave_height >= 2.5) ||
                     (abn.wind_speed != null && abn.wind_speed >= 17.2) ||
                     (abn.water_temp != null && abn.water_temp >= 25.5)),
      '偶发异常点命中异常界定指标（浪高≥2.5 蓝标 / 风速≥17.2 / 水温≥25.5 黄标）');
    const evInst = { fast: st.fast, allFast: st.fast, isObs: false, site: 'site_01',
                     siteName: function () { return '模拟养殖站点'; } };
    const evs = sea.computed.events.call(evInst);
    const joined = evs.map(function (e) { return e.text; }).join('\n');
    /* 可控序列下注入类型固定为 wind（k=floor(0.5*3)=1），风速 = rndn(17.6,.5) 均值 17.6 */
    assert(joined.indexOf('风速 ' + abn.wind_speed + ' m/s') >= 0,
      '偶发异常点被记录进海况事件（含时间/站点/数据）');
  } finally {
    vm.runInContext('Math.random = __origRandom;', sandbox);
  }
}

section('问题一补充：两页 load() 对养殖站点流式生成、对观测站点走公开接口');
{
  let apiEnvCalled = 0;
  const origEnv = sandbox.API.env;
  sandbox.API.env = function () { apiEnvCalled++; return { fast: [{ ts: 1, source: 'public' }], slow: [] }; };
  try {
    const obsInst = { site: 'site_02', ensurePer: function () {}, activePer: { minutes: 60 },
                      loadSeq: 0, isObsSite: sea.methods.isObsSite };
    sea.methods.load.call(obsInst);
    assert(apiEnvCalled === 1, '观测站点（site_02）仍走 API.env 公开数据接口');
    const farmInst = { site: 'site_01', ensurePer: function () {}, activePer: { minutes: 60 },
                       loadSeq: 0, isObsSite: sea.methods.isObsSite };
    sea.methods.load.call(farmInst);
    assert(apiEnvCalled === 1, '养殖站点（site_01）不再调用 API.env（改由前端流式生成器生成）');
    assert(!!farmInst.series && farmInst.series.fast.length >= 2, '养殖站点 load 后拿到流式生成的窗口数据');
    const wfarm = { site: 'site_01', ensurePer: function () {}, activePer: { minutes: 60 },
                    loadSeq: 0, isObsSite: water.methods.isObsSite };
    water.methods.load.call(wfarm);
    assert(!!wfarm.series && wfarm.series.slow.length >= 2, '水质页养殖站点拿到含慢变量（盐度/pH）的窗口数据');
  } finally {
    sandbox.API.env = origEnv;
  }
}

section('问题四：环境板块不再需要「原始数据明细 / 环境仿真控制」独立页面');
{
  assert(!sandbox.PAGES['/env/records'] && !sandbox.PAGES['/env/simulator'],
    'env.js 未注册 /env/records 与 /env/simulator 页面（功能已并入海况/水质两页）');
  assert(code.indexOf("PAGES['/env/records']") < 0 && code.indexOf("PAGES['/env/simulator']") < 0,
    'env.js 源码无这两个页面的注册（导航入口在公共 app.js，属骨架范围，需 PR 时向队长说明移除）');
}

section('问题一：事件列表默认收起（展示 5 条），其余可点击展开');
{
  const fake = [];
  for (let i = 1; i <= 8; i++) {
    fake.push({ id: 'e' + i, ts: i, level: 'yellow', text: '事件 ' + i });
  }
  const instSea = { evOpen: false, events: fake };
  const vis = sea.computed.visibleEvents.call(instSea);
  assert(vis.length === 5, '海况页事件列表默认只展示前 5 条（实际 ' + vis.length + '）');
  instSea.evOpen = true;
  assert(sea.computed.visibleEvents.call(instSea).length === 8, '点击「展开全部」后显示全部事件（实际 8 条）');
  const instWater = { evOpen: false, events: fake };
  assert(water.computed.visibleEvents.call(instWater).length === 5, '水质页事件列表默认只展示前 5 条');
  instWater.evOpen = true;
  assert(water.computed.visibleEvents.call(instWater).length === 8, '水质页展开后显示全部事件');
  assert(sea.template.indexOf('展开全部') >= 0 && sea.template.indexOf('events.length > 5') >= 0,
    '海况页模板：事件超过 5 条时显示「展开全部（N 条）」按钮，可收起');
  assert(water.template.indexOf('展开全部') >= 0 && water.template.indexOf('events.length > 5') >= 0,
    '水质页模板：事件超过 5 条时显示「展开全部（N 条）」按钮，可收起');
  assert(sea.template.indexOf('event-list') < 0 && water.template.indexOf('event-list') < 0,
    '两页不再使用公共 event-list 全量渲染（改页面内自绘列表，支持收起/展开）');
  const instFew = { evOpen: false, events: fake.slice(0, 3) };
  const visFew = sea.computed.visibleEvents.call(instFew);
  assert(visFew.length === 3, '事件不足 5 条时全部展示（不出现展开按钮）');
  assert(sea.data.toString().indexOf('evOpen') >= 0 && water.data.toString().indexOf('evOpen') >= 0,
    '两页 data 均有 evOpen 展开状态');
}

section('问题二：时序图异常点只标圆点、不显示数字');
{
  const seaChartSrc = sea.methods.renderChart.toString();
  const watChartSrc = water.methods.renderChart.toString();
  assert(seaChartSrc.indexOf("markPoint: { symbol: 'circle', symbolSize: 7, label: { show: false }, data: this.waveDots }") >= 0,
    '海况页浪高异常点：只标圆点、label 关闭（不显示数字）');
  assert(seaChartSrc.indexOf("markPoint: { symbol: 'circle', symbolSize: 7, label: { show: false }, data: this.windDots }") >= 0,
    '海况页风速异常点：只标圆点、label 关闭（不显示数字）');
  assert(watChartSrc.indexOf("series[idx].markPoint = { symbol: 'circle', symbolSize: 7, label: { show: false }, data: this.waterDots }") >= 0,
    '水质页水温异常点：只标圆点、label 关闭（不显示数字）');
  const wd = sea.computed.waveDots.call({ fast: [{ ts: 1, wave_height: 4.5 }, { ts: 2, wave_height: 1.2 }] });
  assert(wd.length === 1 && wd[0].itemStyle.color === '#D97706',
    '浪高异常点仍按颜色分级标记（黄 4.0+ → #D97706，不显示数值）');
  const windDots = sea.computed.windDots.call({ fast: [{ ts: 1, wind_speed: 18.0 }, { ts: 2, wind_speed: 8.0 }] });
  assert(windDots.length === 1 && windDots[0].itemStyle.color === '#991B1B',
    '风速异常点只标红色圆点（≥17.2 八级大风）');
}

section('验收第 6 条相关：模板 {{ }} 内无裸枚举字段（与 acceptance.py 同口径）');
{
  /* 与 scripts/acceptance.py 的 WRAPPED 豁免规则保持一致：
     表达式内有 `.枚举字段`，且整条表达式没有 CN.xxx( / xxCn( / ? 才算裸枚举 */
  const WRAPPED = /(CN\.\w+\(|\w*[Cc]n\(|\?)/;
  const enums = ['quality', 'risk_level', 'device_state', 'device_type', 'alarm_status',
    'handle_status', 'confirm_status', 'command_type', 'command_status', 'task_status',
    'alarm_type', 'trigger_by', 'feeding_intensity'];
  const re = /\{\{([^}]+)\}\}/g;
  const bad = [];
  let m;
  while ((m = re.exec(sea.template + water.template))) {
    const expr = m[1];
    enums.forEach(function (e) {
      if (expr.indexOf('.' + e) >= 0 && !WRAPPED.test(expr)) bad.push(expr.trim());
    });
  }
  assert(bad.length === 0, '模板内无裸枚举字段' + (bad.length ? '（命中：' + bad.join('; ') + '）' : ''));
}

console.log('\n----------------------------------------');
if (failed) { console.error('❌ 失败 ' + failed + ' 项'); process.exit(1); }
console.log('✅ 全部通过');
})().catch(function (e) { console.error('异步测试异常：' + (e && (e.stack || e.message) || e)); process.exit(1); });
