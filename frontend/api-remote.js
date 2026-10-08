/* ============================================================
   api-remote.js —— 把 API 门面指向真实后端
   ============================================================
   机制：
     index.html 里先加载 /api/boot.js
       · 由后端托管时 → 该文件存在，设置 window.__API_BASE__ = ""
       · 由普通静态服务器托管时 → 该文件 404，什么都不发生
     于是本文件自动判断：有后端就走后端，没有就继续用本地 mock。

   本文件**覆盖 mock.js 暴露的 API 门面的方法**，页面代码一行不用改
   （这正是"先把接口冻结"换来的东西）。

   建立：2026-10-05
   ============================================================ */
(function (global) {
  'use strict';

  if (typeof global.__API_BASE__ === 'undefined') return;   // 没有后端 → 保持 mock
  const M = global.API;
  if (!M) return;

  const B = global.__API_BASE__ || '';
  M.remote = true;

  function qs(params) {
    if (!params) return '';
    const parts = [];
    Object.keys(params).forEach(function (k) {
      const v = params[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function get(path, params) {
    return fetch(B + path + qs(params)).then(function (r) { return r.json(); });
  }

  function post(path, body) {
    return fetch(B + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  /* ---------- 同步/异步兼容 ----------
     页面里 load() 的写法是 API.resolve(API.env(...), function (d) { ... })
     本地 mock 返回普通值 → 直接回调
     远端返回 Promise      → 等回来再回调
     两种模式共用同一份页面代码。 */
  M.resolve = function (v, cb) {
    if (v && typeof v.then === 'function') { v.then(cb); return; }
    cb(v);
  };

  /* ---------- 指令与告警：轮询保持新鲜 ----------
     后端的状态机是在服务端跑的，前端拿不到推送，所以定时拉。
     （WebSocket 是后续优化项，不是本期硬线） */
  let _cmds = [], _alarms = [];
  const POLL_MS = 900;

  function poll() {
    get('/api/commands').then(function (d) {
      if (Array.isArray(d)) { _cmds = d; M._bump(); }
    }).catch(function () {});
    get('/api/alarms').then(function (d) {
      if (Array.isArray(d)) { _alarms = d; M._bump(); }
    }).catch(function () {});
  }
  M._bump = function () { (M._subs || []).forEach(function (f) { try { f(); } catch (e) {} }); };
  M._subs = [];

  M.subscribe = function (f) {
    M._subs.push(f);
    return function () {
      const i = M._subs.indexOf(f);
      if (i >= 0) M._subs.splice(i, 1);
    };
  };

  poll();
  setInterval(poll, POLL_MS);

  /* ---------- 覆盖各接口 ---------- */
  M.sites = function () { return M._sites || []; };
  M.env = function (site, minutes, opts) {
    opts = opts || {};
    return get('/api/env', { site_id: site, minutes: minutes || 60,
                             storm: opts.storm ? 1 : 0, heat: opts.heat ? 1 : 0,
                             offline: opts.offline ? 1 : 0 });
  };
  M.fish = function (m) { return get('/api/fish', { minutes: m || 60 }); };
  M.struct = function (m) { return get('/api/struct', { minutes: m || 60 }); };
  M.heatGrid = function () { return get('/api/heatmap').then(function (d) { return d.grid; }); };
  M.feedDecision = function () { return get('/api/feed/decision'); };
  M.feedRecords = function () { return get('/api/feed/records'); };
  M.devices = function () { return M._devices || []; };
  M.commands = function () { return _cmds.slice(); };
  M.alarms = function () { return _alarms.slice(); };
  M.alarm = function (id) {
    for (let i = 0; i < _alarms.length; i++) if (_alarms[i].alarm_event_id === id) return _alarms[i];
    return null;
  };
  /* 手动停止一条还没到终态的命令（组员反馈：投喂要能中途停）。
     只对「未到终态」的命令有效 —— 已成功/已失败的改不了，那是历史事实。 */
  M.cancelCommand = function (commandId, reason) {
    return post('/api/commands/' + encodeURIComponent(commandId) + '/cancel',
                { reason: reason || '值班人手动停止' })
      .then(function (r) { poll(); return r; });
  };

  M.sendCommand = function (deviceId, type, params, opts) {
    const body = { device_id: deviceId, command_type: type, params: params || {} };
    if (opts && opts.inject) body.inject = opts.inject;
    return post('/api/commands', body).then(function (c) { poll(); return c; });
  };

  /* 站点与设备：一次性拉，之后当静态配置用 */
  get('/api/sites').then(function (d) { if (Array.isArray(d)) { M._sites = d; M._bump(); } });
  get('/api/devices').then(function (d) { if (Array.isArray(d)) { M._devices = d; M._bump(); } });
  setInterval(function () {
    get('/api/devices').then(function (d) { if (Array.isArray(d)) { M._devices = d; M._bump(); } });
  }, 3000);

  /* 鱼种体长体重参数库：静态配置，拉一次就够。
     页面上要能看到「这个 a、b 是哪来的」—— 出处必须跟着数据一起过来。 */
  M.species = function () { return M._species || []; };
  get('/api/species').then(function (d) {
    if (d && Array.isArray(d.species)) {
      M._species = d.species;
      M._speciesFormula = d.formula || '';
      M._bump();
    }
  });

  /* NDBC 直连状态。**只读缓存状态，不在渲染时联网** ——
     联网只在用户点「立即拉取最新」时发生（M.ndbcRefresh）。 */
  M.ndbcStatus = function () { return M._ndbc || null; };
  function pullNdbcStatus() {
    get('/api/ndbc/status').then(function (d) {
      if (d && Array.isArray(d.stations)) { M._ndbc = d; M._bump(); }
    });
  }
  pullNdbcStatus();

  M.ndbcRefresh = function (stations) {
    var body = {};
    if (stations && stations.length) body.stations = stations;
    return post('/api/ndbc/refresh', body).then(function (r) {
      if (r && r.status) { M._ndbc = r.status; M._bump(); }
      return r;
    });
  };

  /* ---------- 管理板块：养殖生产配置 ----------
     这一块是"配置驱动"的落点：网箱养什么鱼，全平台的阈值与参数就跟着变。
     所以每次写操作成功都要 _bump()，让所有页面立刻重算。 */

  /* 鱼种温度参数库（30 个种）—— 管理板块的鱼种档案要用，
     网箱改鱼种时也要靠它判断"这个种有没有温度参数、能不能养" */
  M.speciesTemp = function () { return M._speciesTemp || null; };
  get('/api/species/temp').then(function (d) {
    if (d && Array.isArray(d.species)) { M._speciesTemp = d; M._bump(); }
  });

  M.farm = function () { return M._farm || null; };
  function pullFarm() {
    get('/api/farm').then(function (d) {
      if (d && d.cages) { M._farm = d; M._bump(); }
    });
  }
  pullFarm();

  M.farmLedger = function () { return M._ledger || null; };
  function pullLedger(cageId) {
    var q = cageId ? ('?cage_id=' + encodeURIComponent(cageId)) : '';
    return get('/api/farm/ledger' + q).then(function (d) {
      if (d && d.ledger) { M._ledger = d; M._bump(); }
      return d;
    });
  }
  pullLedger();

  M.farmDevices = function () { return M._farmDevices || null; };
  function pullFarmDevices() {
    return get('/api/farm/devices').then(function (d) {
      if (d && d.devices) { M._farmDevices = d; M._bump(); }
      return d;
    });
  }
  pullFarmDevices();

  /* 改网箱养的鱼 —— 全平台阈值随之重算 */
  M.setCageSpecies = function (cageId, species) {
    return post('/api/farm/cage/species', { cage_id: cageId, species: species })
      .then(function (r) {
        return pullFarm().then(function () { pullFarmDevices(); return r; });
      });
  };

  /* 记一笔台账 */
  M.addLedger = function (entry) {
    return post('/api/farm/ledger', entry).then(function (r) {
      return pullLedger().then(function () { pullFarm(); return r; });
    });
  };

  /* 记一次标定 */
  M.calibrate = function (deviceId, inst, cert) {
    return post('/api/farm/calibrate',
                { device_id: deviceId, institution: inst, cert_no: cert })
      .then(function (r) { return pullFarmDevices().then(function () { return r; }); });
  };

  M.reloadFarm = function () {
    return Promise.all([pullFarm(), pullLedger(), pullFarmDevices()]);
  };

  /* ==========================================================================
     曲线数据的自动刷新
     ==========================================================================
     🔴 为什么要有这个（2026-10-07 组员反馈发现的平台级问题）：
        原来只有「命令 / 告警 / 设备状态」在轮询（每 900ms），
        **曲线数据（/api/env、/api/struct、/api/fish）只在进页面时拉一次** ——
        之后就不动了。结果是：全平台所有曲线都是「进页面那一刻的快照」。

        李志成在补光页发现的（「调了档位图不动，刷新一下才变」），
        但根子不在补光页，**在每个有曲线的页面**。

     【怎么用】页面里这样接：
         mounted: function () {
           this.unsub = API.bind(this, this.load);   // 一行搞定
           this.load();
         },
         beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } }
     ========================================================================== */
  M.SERIES_REFRESH_MS = 3000;      // 3 秒。够看出"在动"，又不会把本地服务打爆

  var _seriesSubs = [];
  M.onSeriesRefresh = function (fn) {
    _seriesSubs.push(fn);
    return function () {
      var i = _seriesSubs.indexOf(fn);
      if (i >= 0) _seriesSubs.splice(i, 1);
    };
  };
  setInterval(function () {
    _seriesSubs.slice().forEach(function (f) {
      se(function () { f(); });          // 一个页面报错不影响其他页面
    });
  }, M.SERIES_REFRESH_MS);

  /* 页面标准接法：一个取消函数管两件事（数据变化 + 定时刷新）。
     用法见上面的注释。 */
  M.bind = function (vm, load) {
    var s1 = M.subscribe(function () { vm.tick++; });
    var s2 = M.onSeriesRefresh(function () { load.call(vm); });
    return function () { s1(); s2(); };
  };

  /* 吞掉异常的小工具 —— 定时器里抛错会中断整轮刷新 */
  function se(fn) { try { fn(); } catch (e) { /* 忽略单个页面的异常 */ } }

})(window);
