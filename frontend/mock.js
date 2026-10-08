/* ============================================================
   mock.js —— 统一数据接口的「假实现」
   ============================================================
   依据：统一数据接口文档 v1.2（2026-10-05 冻结）

   ★★★ 换真接口时，只改这一个文件 ★★★
   页面与组件只调用本文件暴露的 API.*，不直接造数据。
   刘伟豪的仿真数据出来后，把 API 里对应函数改成 fetch('/api/...') 即可，
   页面一行都不用动 —— 这就是「先把接口冻结」换来的东西。

   建立：2026-10-05
   ============================================================ */
(function (global) {
  'use strict';

  /* 曲线自动刷新的订阅表（对应 api-remote.js 里的 _seriesSubs）。
     ⚠️ 这个声明曾经漏掉过一次：批量改代码的脚本按 `const M = {` 找锚点往里插，
        但本文件里对象叫 `const API = {` —— 于是用到它的代码全在、声明却没有，
        运行时报 MOCK_SERIES_SUBS is not defined（而且是每 3 秒报一次，刷满控制台）。
        教训：**批量改代码时，锚点没匹配上必须报错，不能静默跳过。** */
  const MOCK_SERIES_SUBS = [];

  /* ---------- 站点（接口文档 8.1） ---------- */
  const SITES = [
    { site_id: 'site_01', site_name: '模拟养殖站点',   kind: 'farm',   latitude: 26.10, longitude: 119.90, farming_depth_m: 20 },
    { site_id: 'site_02', site_name: 'NDBC 观测站点 42001', kind: 'obs', latitude: 25.92, longitude: -89.64, farming_depth_m: 0 },
    { site_id: 'site_03', site_name: 'NDBC 观测站点 46001', kind: 'obs', latitude: 56.30, longitude: -148.02, farming_depth_m: 0 },
    { site_id: 'site_04', site_name: 'NDBC 观测站点 51001', kind: 'obs', latitude: 24.45, longitude: -162.00, farming_depth_m: 0 }
  ];

  /* ---------- 确定性伪随机：保证不同人打开看到的曲线一致 ---------- */
  let _seed = 20261005;
  function rnd() { _seed = (_seed * 1103515245 + 12345) % 2147483648; return _seed / 2147483648; }
  function rndn(mean, sd) { return mean + (rnd() + rnd() + rnd() - 1.5) * 2 * sd; }
  function resetSeed() { _seed = 20261005; }

  const STEP_FAST = 5 * 1000;        // 快变量 5 秒
  const STEP_SLOW = 30 * 1000;       // 慢变量 30 秒（盐度/pH，裁定 3）
  const NOW = Math.floor(Date.now() / 1000) * 1000;

  /* ---------- 环境时序（接口文档 4.1 / 4.2 / 4.3） ---------- */
  function envSeries(siteId, minutes, opts) {
    opts = opts || {};
    const n = Math.max(2, Math.round(minutes * 60 * 1000 / STEP_FAST));
    const slowN = Math.max(2, Math.round(minutes * 60 * 1000 / STEP_SLOW));
    const t0 = NOW - minutes * 60 * 1000;
    const storm = !!opts.storm;              // 造故障：大风大浪（sim_mode = storm）
    const heat = !!opts.heat;                // 造故障：水温骤升（演示「一条竖线」用）
    /* 造故障：设备离线 —— 从时段 60% 起所有值给 null。
       验收第 4 条：离线必须显示「—」，不给上一个值（通用规范 4.2 硬纪律）。 */
    const offlineFrom = opts.offline ? Math.floor(n * 0.6) : opts.offlineFrom;
    resetSeed();

    const fast = [];
    for (let i = 0; i < n; i++) {
      const ts = t0 + i * STEP_FAST;
      const h = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
      const diurnal = Math.sin((h - 6) / 24 * 2 * Math.PI);       // 昼夜变化
      const offline = offlineFrom != null && i >= offlineFrom;

      const wave  = storm ? rndn(4.6, .55) : rndn(1.4, .25);
      const wind  = storm ? rndn(19, 2.5) : rndn(8.3, 1.2);
      /* 造故障「水温骤升」：朝一个**绝对目标温度**爬，不是「在基线上加几度」。
         ⚠️ 为什么必须这样：水温基线带昼夜项 18.6 + sin((h-6)/24·2π)×1.8，
            夜里 22 点时 diurnal≈-0.87、基线只有 17.0℃ —— 加 4.2 也只到 21.4℃，
            刚好差 0.1 够不到告警阈值。2026-10-06 目标上调到 30.5℃ —— 水温告警改为按鱼种取值后，大黄鱼告警线是 28.0℃。
            结果就是「白天点造故障会报警、晚上点没反应」，现场答辩排在晚上就当场失败。 */
      const baseWater = 18.6 + diurnal * 1.8;
      const prog = heat ? Math.max(0, (i / n - 0.55) / 0.45) : 0;
      const water = baseWater + (heat ? (30.5 - baseWater) * prog : 0) + rndn(0, .15);
      const air   = 22.4 + diurnal * 3.2 + rndn(0, .4) + (water - baseWater) * .6;
      const light = Math.max(0, (storm ? 4000 : 12000) * Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) + rndn(0, 400));

      fast.push({
        ts: ts,
        site_id: siteId,
        source: 'simulated',
        quality: offline ? 'stale' : 'good',
        wave_height: offline ? null : +wave.toFixed(1),
        wind_speed: offline ? null : +wind.toFixed(1),
        current_speed: offline ? null : +rndn(storm ? 1.4 : .6, .12).toFixed(1),
        air_temp: offline ? null : +air.toFixed(1),
        water_temp: offline ? null : +water.toFixed(1),
        // 溶氧与水温负相关（任务拆解 1.3 要求"仿真数据要像真的"）
        dissolved_oxygen: offline ? null : +(9.2 - (water - 18.6) * .45 + rndn(0, .12)).toFixed(1),
        light_intensity: offline ? null : +light.toFixed(0)
      });
    }

    // 慢变量（盐度 / pH）：30 秒一条，单独一条序列
    // 离线要同样置空 —— 慢变量也是设备测出来的，设备断了它就没有读数
    const offTs = (offlineFrom != null) ? t0 + offlineFrom * STEP_FAST : null;
    const slow = [];
    for (let i = 0; i < slowN; i++) {
      const ts = t0 + i * STEP_SLOW;
      const off = offTs !== null && ts >= offTs;
      slow.push({
        ts: ts,
        site_id: siteId,
        quality: off ? 'stale' : 'good',
        salinity: off ? null : +rndn(32.1, .15).toFixed(1),   // 单位 ‰（裁定 10）
        ph: off ? null : +rndn(8.1, .06).toFixed(1)           // 1 位小数（精度表）
      });
    }

    return { fast: fast, slow: slow };
  }

  /* ---------- 鱼类（接口文档 第三节；4 项指标本期不做） ---------- */
  function fishSeries(minutes) {
    const n = Math.max(2, Math.round(minutes * 60 * 1000 / STEP_FAST));
    const t0 = NOW - minutes * 60 * 1000;
    resetSeed();
    const out = [];
    let count = 1200;
    for (let i = 0; i < n; i++) {
      count += Math.round(rndn(0, .6));
      const avgW = 420 + i / n * 6 + rndn(0, 3);
      out.push({
        ts: t0 + i * STEP_FAST,
        site_id: 'site_01',
        source: 'public',
        quality: 'good',
        fish_count: count,
        fish_density: +(count / 285).toFixed(1),          // ÷ 网箱有效水体
        avg_length_cm: +(Math.pow(avgW / 0.0218, 1 / 3.02)).toFixed(1),
        avg_weight_g: +avgW.toFixed(1),
        total_biomass_kg: +(count * avgW / 1000).toFixed(1),
        feeding_intensity: ['none', 'weak', 'mid', 'strong'][Math.floor(rnd() * 4)]
      });
    }
    return out;
  }

  /* 热力图 10×10（拍板问题单 问题 5，建议 A） */
  function heatGrid() {
    resetSeed();
    const g = [];
    for (let y = 0; y < 10; y++) {
      const row = [];
      for (let x = 0; x < 10; x++) {
        const d = Math.hypot(x - 4.5, y - 5.2);
        row.push(+Math.max(0, 12 - d * 2.2 + rndn(0, 1.4)).toFixed(1));
      }
      g.push(row);
    }
    return g;
  }

  /* ---------- 结构安全（接口文档 第五节） ---------- */
  function structSeries(minutes) {
    const n = Math.max(2, Math.round(minutes * 60 * 1000 / STEP_FAST));
    const t0 = NOW - minutes * 60 * 1000;
    resetSeed();
    const out = [];
    const designTension = 60;     // kN，手工配置（design_tension）
    let soc = 68;
    for (let i = 0; i < n; i++) {
      const ts = t0 + i * STEP_FAST;
      const h = new Date(ts).getHours();
      const day = Math.max(0, Math.sin((h - 6) / 12 * Math.PI));

      /* 姿态与张力：平时平稳，每 10 分钟来一次持续约 70 秒的「涌浪 / 阵风」事件。
         为什么要这样建模：原来俯仰角是 gauss(2.4, .4) —— 长期骑在阈值上，
         噪声反复穿越阈值，一小时刷出上千条告警，界面上看着像系统坏了。
         真实养殖场平时就是平稳的，倾斜是「事件」，不是常态。

         🔴 2026-10-06 改：阈值从 2°/3° 改为 5°/15° 后，原来的幅值（峰 ~3.4°）永远触不到。
            同时把倾斜与「大风大浪」造故障**联动** —— 物理上说得通（海况差 → 网箱倾斜），
            演示时也有明确路径：点「触发大风大浪」→ 倾角抬升 → 红色预警。 */
      const per = 120;                      // 120 个点 = 10 分钟
      const phase = i % per;
      let excursion = 0;
      if (phase < 14) {
        // mag 5.5 → 峰值约 6.7°，越过 5° 黄色线；台风级 15 → 峰值约 16°，越过 15° 红色线
        // 平常幅值刻意压在 5° 提示线**下方**（峰 4.2° + 噪声 ≈ 4.9°），避免「狼来了」
        const mag = storm ? 15.0 : ((Math.floor(i / per) % 2 === 0) ? 3.0 : 1.6);
        excursion = mag * Math.sin(phase / 14 * Math.PI);
      }

      const roll = 1.1 + excursion * 0.5 + rndn(0, .18);
      const pitch = 1.2 + excursion + rndn(0, .22);
      /* 海况差 → 张力跟着涨（大浪对锚泊的载荷是非线性的，造故障时耦合更强）。
         配着 designTension=60 kN 调：平常约 77% **不越 80% 黄线**（避免"狼来了"）；
         造故障约 105%，越 95% 红线。 */
      const tension = 37.5 + excursion * (storm ? 1.6 : 1.15) + rndn(0, 1.2);   // 海况差 → 张力跟着涨
      soc = Math.min(100, Math.max(8, soc + (day > .2 ? .18 : -.22) + rndn(0, .12)));
      out.push({
        ts: t0 + i * STEP_FAST,
        site_id: 'site_01',
        anchor_tension: +tension.toFixed(1),
        design_tension: designTension,
        tension_pct: +(tension / designTension * 100).toFixed(1),
        net_tension: +rndn(18.3, .8).toFixed(1),
        tilt_roll: +roll.toFixed(1),
        tilt_pitch: +pitch.toFixed(1),
        tilt_angle: +Math.max(Math.abs(roll), Math.abs(pitch)).toFixed(1),
        accel_x: +rndn(0.12, .05).toFixed(2),
        accel_y: +rndn(-0.08, .05).toFixed(2),
        accel_z: +rndn(9.79, .06).toFixed(2),
        pv_power: +(day * 4.6).toFixed(2),
        pv_energy_today: +(day * 14).toFixed(1),
        battery_soc: +soc.toFixed(1),
        battery_capacity_kwh: 30,
        battery_energy: +(soc / 100 * 30).toFixed(1),
        total_power: +rndn(2.1, .2).toFixed(2),
        energy_self_sufficiency: +(day * 130).toFixed(0)
      });
    }
    return out;
  }

  /* ---------- 设备与指令（接口文档 6.3 / 6.4） ---------- */
  const devices = [
    { device_id: 'feeder_01', device_type: 'feeder', device_online: true, device_state: 'standby',
      device_params: { feed_remain_kg: 62.5, feed_remain_pct: 62.5 }, site_id: 'site_01' },
    { device_id: 'light_01',  device_type: 'light',  device_online: true, device_state: 'standby',
      device_params: { light_dimming_pct: 0 }, site_id: 'site_01' },
    { device_id: 'tension_01', device_type: 'sensor', device_online: true, device_state: 'running',
      device_params: {}, site_id: 'site_01' },
    { device_id: 'pv_01',      device_type: 'sensor', device_online: true, device_state: 'running',
      device_params: {}, site_id: 'site_01' }
  ];

  /* 指令状态机（接口文档 7.6）—— 答辩演示重点 */
  const COMMAND_FLOW = ['created', 'sent', 'acknowledged', 'success'];
  let cmdSeq = 0;
  const commands = [];
  const listeners = [];

  function newCommandId() {
    const d = new Date();
    const ymd = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    cmdSeq += 1;
    return 'cmd_' + ymd + '_' + String(cmdSeq).padStart(4, '0');
  }

  /* 命令失败必须进告警中心 —— 「不允许静默失败」的落地。
     界面上写着"这条已经进告警中心"，那它就必须真的进去，不能只是文案。 */
  function raiseCommandAlarm(cmd) {
    const now = Date.now();
    alarms.unshift({
      alarm_event_id: 'ALM-' + String(alarms.length + 1).padStart(4, '0'),
      alarm_type: cmd.command_type === 'light' ? 'power_supply' : 'tension',
      risk_level: 'red',
      alarm_status: 'active',
      alarm_ts: now,
      trigger_field: 'command_status',
      trigger_value: cmd.command_status,
      trigger_threshold: 'success',
      rule_id: 'R-CMD-01',
      rule_name: '指令未获回执（升级报警）',
      rule_condition: 'command_status == failed 且 重试耗尽',
      combine_condition: null,
      trigger_snapshot: {
        command_id: cmd.command_id, device_id: cmd.device_id,
        retry_count: cmd.retry_count, ts: now
      },
      handling_advice: '检查设备与链路；确认设备是否真的没动',
      handle_status: 'pending',
      confirm_status: 'unconfirmed'
    });
  }

  /* 发一条命令，按状态机推进；timeout_ms=5000 / max_retry=3（裁定 8） */
  function sendCommand(deviceId, type, params, opts) {
    opts = opts || {};
    const cmd = {
      command_id: newCommandId(),
      device_id: deviceId,
      command_type: type,
      params: params || {},
      timeout_ms: 5000,
      max_retry: 3,
      command_status: 'created',
      retry_count: 0,
      state_changed_ts: Date.now(),
      ts: Date.now(),
      fail_reason: null,
      receipt_result: null,
      history: []
    };
    commands.unshift(cmd);
    emit();
    /* 造故障：inject = 'timeout'（不回复）| 'offline'（设备离线）
       ⚠️ 注入故障时**不能走完成功链** —— 超时的命令根本没收到回执，
          不可能出现 acknowledged / success。这里曾经先走完整成功链再补失败链，
          导致命令历史里同时有 success 和 escalated，自相矛盾。 */
    const inject = opts.inject || null;
    const steps = (inject === 'offline' || inject === 'timeout')
      ? ['created', 'sent']
      : COMMAND_FLOW;
    let i = 0;
    const tick = function () {
      if (i >= steps.length) return;
      const st = steps[i];
      cmd.command_status = st;
      cmd.state_changed_ts = Date.now();
      cmd.history.push({ status: st, ts: Date.now() });
      if (st === 'success') {
        cmd.receipt_result = { success: true, result: 'executed', actual_ts: Date.now(), error_code: null };
      }
      i += 1;
      emit();
      if (i < steps.length) {
        setTimeout(tick, 700);
      } else if (inject === 'timeout') {
        /* 等超时 → 重试 → 失败 → 升级报警（绝对不允许"悄悄地失败"） */
        setTimeout(function () {
          cmd.command_status = 'timeout'; cmd.history.push({ status: 'timeout', ts: Date.now() }); emit();
          setTimeout(function () {
            cmd.command_status = 'retrying'; cmd.retry_count = 1;
            cmd.history.push({ status: 'retrying', ts: Date.now() }); emit();
            setTimeout(function () {
              cmd.command_status = 'failed'; cmd.fail_reason = '超时未收到回执，重试 3 次后失败';
              cmd.history.push({ status: 'failed', ts: Date.now() }); emit();
              setTimeout(function () {
                cmd.command_status = 'escalated'; cmd.fail_reason = '已升级报警';
                cmd.history.push({ status: 'escalated', ts: Date.now() });
                raiseCommandAlarm(cmd);
                emit();
              }, 600);
            }, 600);
          }, 600);
        }, 1200);
      } else if (inject === 'offline') {
        setTimeout(function () {
          cmd.command_status = 'failed'; cmd.fail_reason = '设备离线，命令未能送达';
          cmd.history.push({ status: 'failed', ts: Date.now() });
          raiseCommandAlarm(cmd);
          emit();
        }, 1200);
      }
    };
    setTimeout(tick, 60);
    return cmd;
  }

  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function subscribe(f) { listeners.push(f); return function () { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; }

  /* ---------- 告警与追溯（接口文档 5.10）—— 答辩必答题 ---------- */
  resetSeed();
  const alarms = [
    { alarm_event_id: 'ALM-0001', alarm_type: 'tension', risk_level: 'yellow', alarm_status: 'active',
      alarm_ts: NOW - 8 * 60 * 1000, trigger_field: 'tension_pct', trigger_value: 83.2, trigger_threshold: 80,
      rule_id: 'R-TENSION-01', rule_name: '锚泊张力黄色预警',
      rule_condition: 'tension_pct > 80', combine_condition: null,
      trigger_snapshot: { anchor_tension: 49.9, design_tension: 60, tension_pct: 83.2, ts: NOW - 8 * 60 * 1000 },
      handling_advice: '检查锚链受力，必要时降低流速影响', handle_status: 'pending', confirm_status: 'unconfirmed' },
    { alarm_event_id: 'ALM-0002', alarm_type: 'tilt', risk_level: 'orange', alarm_status: 'acknowledged',
      alarm_ts: NOW - 26 * 60 * 1000, trigger_field: 'tilt_pitch', trigger_value: 6.2, trigger_threshold: 5,
      rule_id: 'R-TILT-01', rule_name: '网箱倾斜橙色预警',
      rule_condition: 'tilt_pitch > 5 且 wave_height > 1.5', combine_condition: 'AND(wave_height>1.5)',
      trigger_snapshot: { tilt_pitch: 6.2, tilt_roll: 2.4, wave_height: 1.8, ts: NOW - 26 * 60 * 1000 },
      handling_advice: '关注网箱姿态，检查配重', handle_status: 'handling', confirm_status: 'confirmed' },
    { alarm_event_id: 'ALM-0003', alarm_type: 'low_battery', risk_level: 'yellow', alarm_status: 'recovered',
      alarm_ts: NOW - 55 * 60 * 1000, trigger_field: 'battery_soc', trigger_value: 19.4, trigger_threshold: 20,
      rule_id: 'R-BAT-01', rule_name: '储能低电量黄色预警',
      rule_condition: 'battery_soc < 20', combine_condition: null,
      trigger_snapshot: { battery_soc: 19.4, battery_energy: 5.8, ts: NOW - 55 * 60 * 1000 },
      handling_advice: '优先保障关键设备供电', handle_status: 'handled', confirm_status: 'confirmed', recover_ts: NOW - 31 * 60 * 1000 }
  ];

  /* ---------- API 门面（页面只用这个） ---------- */
  const API = {
    remote: false,
    /* 同步/异步兼容：本地 mock 立刻回调；有后端时 api-remote.js 会把它换成等 Promise 的版本。
       页面统一写 API.resolve(API.xxx(...), function (d) { ... })，两种模式共用一份代码。 */
    resolve: function (v, cb) { cb(v); },

    sites: function () { return SITES.slice(); },
    /* 鱼种体长体重参数库住在后端（data/鱼种体长体重参数.json）。
       纯前端演示模式（后端没起）时这里返回空数组，页面会提示「需要后端」，
       而不是编一份假参数 —— 参数带文献出处，编出来就是学术不端。 */
    species: function () { return []; },
    /* NDBC 直连同理：纯前端模式没有后端，拿不到浮标数据，返回 null 让页面提示。
       绝不编造「浮标实测」数据 —— 那是最容易被戳穿的一类造假。 */
    ndbcStatus: function () { return null; },
    ndbcRefresh: function () {
      return { ok: false, error: '纯前端演示模式没有后端，无法拉取 NDBC 数据' };
    },
    /* 管理板块同理：养殖生产配置住在后端（data/farm.json）。
       纯前端模式拿不到，返回 null 让页面提示「需要后端」——
       绝不在这里编一份假的网箱/台账数据，那会让"配置驱动"变成演戏。 */
    farm: function () { return null; },
    speciesTemp: function () { return null; },
    farmLedger: function () { return null; },
    farmDevices: function () { return null; },
    setCageSpecies: function () {
      return { ok: false, error: '纯前端演示模式没有后端，改不了网箱鱼种' };
    },
    addLedger: function () {
      return { ok: false, error: '纯前端演示模式没有后端，记不了台账' };
    },
    calibrate: function () {
      return { ok: false, error: '纯前端演示模式没有后端，记不了标定' };
    },
    reloadFarm: function () { return null; },
    /* 纯前端模式没有真状态机，取消命令办不到 —— 明确报错，不假装成功 */
    cancelCommand: function () {
      return { ok: false, error: '纯前端演示模式没有后端，停不了命令' };
    },

    /* 曲线自动刷新 —— mock 模式的数据是本地现算的，定时重算就是"活的"。
       与 api-remote.js 的 API.bind 行为保持一致，页面代码两边通用。 */
    SERIES_REFRESH_MS: 3000,
    onSeriesRefresh: function (fn) {
      MOCK_SERIES_SUBS.push(fn);
      return function () {
        var i = MOCK_SERIES_SUBS.indexOf(fn);
        if (i >= 0) MOCK_SERIES_SUBS.splice(i, 1);
      };
    },
    /* 页面标准接法：订阅数据变化 + 定时重算曲线，返回一个取消函数 */
    bind: function (vm, load) {
      var s1 = API.subscribe(function () { vm.tick++; });
      var s2 = API.onSeriesRefresh(function () { try { load.call(vm); } catch (e) {} });
      return function () { s1(); s2(); };
    },
    now: function () { return Date.now(); },

    env: function (siteId, minutes, opts) { return envSeries(siteId, minutes || 60, opts); },
    fish: function (minutes) { return fishSeries(minutes || 60); },
    heatGrid: function () { return heatGrid(); },
    struct: function (minutes) { return structSeries(minutes || 60); },

    devices: function () { return devices.slice(); },
    commands: function () { return commands.slice(); },
    sendCommand: sendCommand,
    subscribe: subscribe,

    alarms: function () { return alarms.slice(); },
    alarm: function (id) {
      for (let i = 0; i < alarms.length; i++) if (alarms[i].alarm_event_id === id) return alarms[i];
      return null;
    },

    /* 「一条竖线」用的判定：水温越限 → 出告警 */
    ruleCheck: function (row) {
      if (!row || row.water_temp == null) return null;
      if (row.water_temp >= 28.0) {
        return { alarm_type: 'tilt', risk_level: 'red', trigger_field: 'water_temp',
                 trigger_value: row.water_temp, trigger_threshold: 28.0,
                 rule_id: 'R-TEMP-01', rule_name: '水温上限告警',
                 rule_condition: 'water_temp >= 28.0（大黄鱼高告警线）' };
      }
      if (row.water_temp >= 25.5) {
        return { alarm_type: 'tilt', risk_level: 'yellow', trigger_field: 'water_temp',
                 trigger_value: row.water_temp, trigger_threshold: 25.5,
                 rule_id: 'R-TEMP-02', rule_name: '水温偏高提示',
                 rule_condition: 'water_temp >= 25.5（大黄鱼高提示线）' };
      }
      return null;
    },

    /* ---------- 投喂决策（裁定 1：投喂量归智能算，鱼类只出观测指标） ---------- */
    feedDecision: function () {
      const fish = fishSeries(5);
      const last = fish[fish.length - 1];
      const water = envSeries('site_01', 5, {}).fast.slice(-1)[0].water_temp;

      /* 摄食强度按真实规律给：鱼类在晨昏两个窗口摄食最旺。
         不用随机数 —— 随机到「无」会让建议投喂量变成 0，演示时没东西可投。 */
      const h = new Date().getHours();
      const intensity = ((h >= 5 && h <= 9) || (h >= 16 && h <= 19)) ? 'strong'
                      : (h >= 10 && h <= 15) ? 'mid' : 'weak';
      const w = { none: 0, weak: 0.45, mid: 0.75, strong: 1 }[intensity];
      const cn = { none: '无', weak: '弱', mid: '中', strong: '强' }[intensity];

      const perDay = last.total_biomass_kg * 0.012;      // 日投饲率 1.2%
      const times = 4;
      const suggest = perDay / times * w;

      return {
        ts: last.ts,
        biomass_kg: last.total_biomass_kg,
        feeding_intensity: intensity,
        feeding_intensity_cn: cn,
        water_temp: water,
        /* 智能板块算出来的建议值 —— 不再要鱼类提供 suggest_feed_kg_h */
        suggest_kg_h: +Math.max(0.1, suggest).toFixed(1),
        day_total_kg: +(perDay * w).toFixed(1),
        times_per_day: times,
        basis: [
          '依据 1：生物量 ' + last.total_biomass_kg + ' kg × 日投饲率 1.2% = ' + perDay.toFixed(1) + ' kg/日',
          '依据 2：当前时段（' + h + ' 时）摄食强度「' + cn + '」→ 折算系数 ' + w,
          '依据 3：水温 ' + water + ' ℃ 处于适宜摄食区间（15–25 ℃）',
          '分 ' + times + ' 次投喂，单次上限 ' + (perDay / times).toFixed(1) + ' kg'
        ],
        mode: 'manual'
      };
    },

    /* 投喂记录（时间线用） */
    feedRecords: function () {
      resetSeed();
      const out = [];
      const now = Date.now();
      for (let i = 8; i >= 0; i--) {
        const amt = +rndn(11.5, 2).toFixed(1);
        out.push({
          ts: now - i * 3 * 3600 * 1000,
          amount_kg: amt,
          trigger_by: i % 3 === 0 ? 'manual' : 'auto',
          task_status: i === 0 ? 'running' : 'done',
          command_id: 'cmd_20261005_' + String(100 - i).padStart(4, '0')
        });
      }
      return out;
    },

    /* 冻结口径（接口文档 8.2 / 8.3）—— 界面上必须照这个显示 */
    sourceText: {
      real: '真实数据', public: '公开数据', simulated: '仿真数据', demo: '演示数据'
    },
    disclaimer: '采用 NDBC 真实浮标海域数据作为环境驱动，站点为模拟养殖站点。'
  };

  global.API = API;

  /* 每 SERIES_REFRESH_MS 毫秒把所有订阅的页面重算一次曲线 */
  setInterval(function () {
    MOCK_SERIES_SUBS.slice().forEach(function (f) {
      try { f(); } catch (e) { /* 单个页面异常不影响其他页面 */ }
    });
  }, API.SERIES_REFRESH_MS);

})(window);
