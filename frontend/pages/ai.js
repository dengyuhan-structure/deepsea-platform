/* ============================================================
   pages/ai.js —— 智能板块
   ============================================================
   负责人：李志成

   【这个文件归谁】
     归上面写的那个人（以及他的 AI）。**别人不要改这个文件。**

   【怎么加页面】
     照抄本文件里已有页面的结构，往 PAGES 上注册一个新路由就行：
         PAGES['/ai/xxx'] = { data: ..., computed: ..., methods: ..., template: [...] };

   【三条硬规矩】
     1. 用 components.js 里已有的公共件（stat-card / trend-chart / event-list …），
        不要自己重写一套 —— 全平台要长一个样。
     2. 数据一律走 API.xxx()，不要直接读别的板块的数据，也不要写死数字。
        拿不到就显示「—」，**不许编**。
     3. 界面上不许出现裸英文（比如 quality='good'），必须经 components.js 的 CN 表转成中文。

   【改完必须做】
     双击 验收检查.bat，8 项全过才能发 PR。全过不了就别发 —— 会把别人的页面一起弄坏。

   建立：2026-10-06（从 pages.js 拆出）
   ============================================================ */
(function (global) {
  'use strict';
  /* 自己初始化，不依赖文件加载顺序 —— 这样谁先谁后都不会出错 */
  const PAGES = global.PAGES || (global.PAGES = {});

  PAGES['/ai/feed'] = {
    data: function () {
      return {
        tick: 0,
        /* 先给安全默认值：mounted 之前模板已经渲染一次，
           dec 若是 null 会抛 "Cannot read properties of null" */
        dec: { biomass_kg: null, feeding_intensity_cn: '—', suggest_kg_h: null,
               water_temp: null, basis: [], times_per_day: 4 },
        records: [], inject: '', confirmOpen: false, lastSent: null, unsub: null,
        /* 2026-10-07 按组员反馈新增：
             mode   —— 自动/手动模式切换。自动=按系统算的规则投喂；手动=自己填量
             amount —— 手工投喂量。null 表示"还没填过"，界面上回落显示建议值 */
        mode: 'auto', amount: null, stopMsg: ''
      };
    },
    computed: {
      /* 实际要下发的投喂量：手动模式下用填的值，否则用系统的建议值 */
      targetKg: function () {
        if (this.mode === 'manual' && this.amount !== null && this.amount !== '') {
          return Number(this.amount);
        }
        return this.dec.suggest_kg_h;
      },
      /* 有没有"正在执行中"的任务 —— 决定记录表里那行的「停止」按钮显不显示 */
      runningCount: function () {
        return this.records.filter(function (r) { return r.task_status !== 'done'; }).length;
      },
      feeder: function () {
        const d = API.devices().filter(function (x) { return x.device_id === 'feeder_01'; })[0];
        return d || {};
      },
      commands: function () { this.tick; return API.commands(); },
      latest: function () { this.tick; return this.commands.length ? this.commands[0] : null; },
      steps: function () {
        /* ⚠️ 这里显式读一次 this.tick（而不是只靠 this.latest 传导）。
           实测：命令状态从 created 走到 success、latest 已更新，
           但 steps 仍缓存着旧的空数组 —— computed 链式失效没有传导到第三层。
           命令状态机是答辩重点，宁可多依赖一次，也不能显示过期状态。 */
        this.tick;
        const c = this.latest;
        if (!c) return [];
        return c.history.map(function (h) {
          return { t: new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false }), s: h.status };
        });
      },
      badEnd: function () {
        this.tick;
        const c = this.latest;
        return !!(c && ['failed', 'escalated'].indexOf(c.command_status) >= 0);
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.feedDecision(), function (d) { self.dec = d; });
        API.resolve(API.feedRecords(), function (r) { self.records = r; });
      },
      statusCn: function (s) {
        return { created: '已创建', sent: '已发出', acknowledged: '已收到回执', success: '成功',
                 timeout: '超时', retrying: '重试中', failed: '失败', escalated: '升级报警' }[s] || s;
      },
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); },
      ask: function () { this.confirmOpen = true; },
      cancel: function () { this.confirmOpen = false; },
      confirm: function () {
        this.confirmOpen = false;
        const self = this;
        const cmd = API.sendCommand('feeder_01', 'feed',
          { amount_kg: this.targetKg, duration_s: 60 },
          this.inject ? { inject: this.inject } : {});
        this.lastSent = cmd;
        this.stopMsg = '';
        this.$nextTick(function () { /* 让状态机进度条立刻可见 */ });
        /* 立刻刷一次记录表 —— 否则要等下一个 3 秒周期，
           「停止」按钮才出现，人手早过了那个时间窗。 */
        setTimeout(function () { self.load(); }, 900);
      },
      /* 手动停止一条还没跑完的任务（组员反馈：投喂要能中途停）。
         ⚠️ 后端只允许停「未到终态」的命令 —— 已成功/已失败的改不了，
            那是历史事实。所以这里失败是正常情况，要把原因显示出来。 */
      stop: function (r) {
        const self = this;
        this.stopMsg = '';
        API.resolve(API.cancelCommand(r.command_id, '值班人手动停止投喂'), function (res) {
          if (res && res.ok) {
            self.stopMsg = '已停止 ' + r.command_id;
          } else {
            self.stopMsg = '停不了：' + ((res && (res.error || res.msg)) || '未知原因');
          }
          self.load();
        });
      },
      /* 手动模式：把输入框一键填成建议值 */
      useSuggest: function () { this.amount = this.dec.suggest_kg_h; }
    },
    mounted: function () {
      this.load();
      const self = this;
      /* API.bind = 数据变化时重算 + 每 3 秒自动刷新曲线（见 api-remote.js 的说明）。
         🔴 2026-10-07 加：之前曲线只在进页面时拉一次，是张静止的快照。 */
      this.unsub = API.bind(this, this.load);
    },
    beforeUnmount: function () { if (this.unsub) this.unsub(); },
    template: [
      '<div>',
      '  <page-head title="智能 · 自动投喂"',
      '    desc="投喂决策归智能（裁定 1）；命令状态机是全项目卖点载体 —— <b>我知道设备到底动没动</b>"',
      '    :sources="[\'simulated\',\'public\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="当前生物量" field="total_biomass_kg" unit="kg" :value="dec.biomass_kg" source="public" />',
      '    <stat-card name="鱼群摄食强度" field="feeding_intensity" unit="" :value="dec.feeding_intensity_cn" source="public" />',
      '    <stat-card name="建议投喂量" field="suggest_kg_h" unit="kg/h" :value="dec.suggest_kg_h" source="simulated" />',
      '    <stat-card name="投饵机状态" field="device_state" unit="" :value="CN.deviceState(feeder.device_state)" source="simulated" />',
      '    <stat-card name="饵料剩余" field="feed_remain_pct" unit="%" :value="feeder.device_params && feeder.device_params.feed_remain_pct" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <div>',
      '      <!-- 命令状态机：答辩直接演示这一段 -->',
      '      <div class="card">',
      '        <div class="card-title">命令状态机</div>',
      '        <div v-if="!latest" class="todo">还没有下发过命令</div>',
      '        <div v-else>',
      '          <command-flow :status="latest.command_status" />',
      '          <div class="kv" style="margin-top:12px">',
      '            <span class="k">命令号</span><span class="mono">{{ latest.command_id }}</span>',
      '            <span class="k">设备</span><span class="mono">{{ latest.device_id }}</span>',
      '            <span class="k">超时 / 重试</span><span>{{ latest.timeout_ms }} ms / 最多 {{ latest.max_retry }} 次（裁定 8）</span>',
      '            <span class="k">已重试</span><span>{{ latest.retry_count }} 次</span>',
      '            <span class="k">失败原因</span>',
      '            <span :style="{ color: latest.fail_reason ? \'#991B1B\' : \'#6B7280\' }">',
      '              {{ latest.fail_reason || \'—\' }}',
      '            </span>',
      '          </div>',
      '          <div v-if="badEnd" class="hint" style="margin-top:10px;background:#FEF2F2;border-color:#FECACA">',
      '            <b>命令失败已升级报警</b> —— 这条已经进告警中心。',
      '            <a href="#/alarm">去告警中心看 →</a>',
      '            <div class="small" style="margin-top:4px">「不允许静默失败」：命令发出去没回执，必须报警，绝不许悄悄过去。</div>',
      '          </div>',
      '          <div class="small muted" style="margin-top:10px">状态变更时间线</div>',
      '          <div class="events">',
      '            <div v-for="(s, i) in steps" :key="i" class="row-item" style="cursor:default">',
      '              <span class="t">{{ s.t }}</span><span class="d">{{ statusCn(s.s) }}</span>',
      '            </div>',
      '          </div>',
      '        </div>',
      '      </div>',
      '',
      '      <!-- 投喂模式（2026-10-07 按组员反馈新增） -->',
      '      <div class="card">',
      '        <div class="card-title">投喂模式</div>',
      '        <div class="row" style="gap:8px;align-items:center">',
      '          <button :class="{ primary: mode === \'auto\' }" @click="mode = \'auto\'">自动</button>',
      '          <button :class="{ primary: mode === \'manual\' }" @click="mode = \'manual\'">手动</button>',
      '          <span class="small muted">',
      '            {{ mode === \'auto\' ? \'按系统算出的投喂规则投喂\' : \'自己决定投喂量\' }}',
      '          </span>',
      '        </div>',
      '        <div v-if="mode === \'manual\'" class="row" style="gap:8px;align-items:center;margin-top:10px">',
      '          <span class="small muted">投喂量</span>',
      '          <input type="number" step="0.1" v-model.number="amount"',
      '                 :placeholder="\'建议 \' + dec.suggest_kg_h" style="width:110px">',
      '          <span class="small">kg/h</span>',
      '          <button @click="useSuggest">用建议值（{{ dec.suggest_kg_h }}）</button>',
      '        </div>',
      '        <div class="hint small" style="margin-top:10px">',
      '          <b>系统给的是建议，不是命令。</b>自动模式下按建议值投喂，',
      '          手动模式下由值班人决定 —— <b>最终下发前都要二次确认</b>。',
      '        </div>',
      '      </div>',
      '',
      '      <!-- 投喂记录时间线 -->',
      '      <div class="card">',
      '        <div class="card-title">投喂记录',
      '          <span v-if="runningCount" class="small" style="font-weight:400;color:#92400E">',
      '            · {{ runningCount }} 条正在执行</span>',
      '        </div>',
      '        <div v-if="stopMsg" class="hint small" style="margin-bottom:8px">{{ stopMsg }}</div>',
      '        <div class="dt-wrap" style="max-height:300px">',
      '          <table class="dt">',
      '            <thead><tr><th>时间</th><th>投喂量 (kg)</th><th>触发来源</th><th>任务状态</th><th>命令号</th><th></th></tr></thead>',
      '            <tbody>',
      '              <tr v-for="r in records" :key="r.command_id">',
      '                <td>{{ time(r.ts) }}</td><td>{{ r.amount_kg }}</td>',
      '                <td>{{ r.trigger_by === \'auto\' ? \'自动\' : \'手动\' }}</td>',
      '                <td>{{ r.task_status === \'done\' ? \'已完成\' : \'正在执行\' }}</td>',
      '                <td class="mono">{{ r.command_id }}</td>',
      '                <td style="white-space:nowrap">',
      '                  <button v-if="r.task_status !== \'done\'" @click="stop(r)">停止</button>',
      '                  <span v-else class="small muted">—</span>',
      '                </td>',
      '              </tr>',
      '            </tbody>',
      '          </table>',
      '        </div>',
      '      </div>',
      '    </div>',
      '',
      '    <div>',
      '      <div class="card">',
      '        <div class="card-title">投喂决策依据（可追问）</div>',
      '        <ul style="margin:0;padding-left:18px;line-height:1.9">',
      '          <li v-for="(b, i) in dec.basis" :key="i">{{ b }}</li>',
      '        </ul>',
      '        <div class="hint" style="margin-top:10px">',
      '          投喂量<b>由智能板块计算</b>，鱼类只出观测类指标 —— 裁定 1。',
      '          鱼类不再提供 <code>suggest_feed_kg_h</code>。',
      '        </div>',
      '      </div>',
      '',
      '      <div class="card">',
      '        <div class="card-title">造故障（验证闭环用）</div>',
      '        <div class="row" style="gap:8px">',
      '          <label class="small"><input type="radio" value="" v-model="inject"> 正常</label>',
      '          <label class="small"><input type="radio" value="timeout" v-model="inject"> 命令超时</label>',
      '          <label class="small"><input type="radio" value="offline" v-model="inject"> 设备离线</label>',
      '        </div>',
      '        <div class="small muted" style="margin-top:8px">',
      '          选「命令超时」会走完 <b>超时 → 重试中 → 失败 → 升级报警</b> 整条链。',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <span class="small muted">{{ mode === \'auto\' ? \'自动模式\' : \'手动模式\' }}</span>',
'    <button class="primary" @click="ask">下发投喂命令（{{ targetKg }} kg/h）</button>',
      '    <!-- 就地反馈：命令状态直接显示在按钮旁边，不用滚回页首看状态机 -->',
      '    <span v-if="latest" class="small">',
      '      最近命令 <span class="mono">{{ latest.command_id }}</span> ·',
      '      <b :style="{ color: badEnd ? \'#991B1B\' : \'#166534\' }">{{ statusCn(latest.command_status) }}</b>',
      '      <span v-if="latest.fail_reason" style="color:#991B1B"> · {{ latest.fail_reason }}</span>',
      '    </span>',
      '    <span v-else class="small muted">还没有下发过命令</span>',
      '    <span v-if="inject" class="small" style="color:#991B1B">',
      '      ⚠ 已选造故障「{{ inject === \'timeout\' ? \'命令超时\' : \'设备离线\' }}」—— 下次下发会走失败链',
      '    </span>',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">下发前必须二次确认 —— 不允许一键直接对设备生效</span>',
      '  </div>',
      '',
      '  <!-- 二次确认弹窗 -->',
      '  <div v-if="confirmOpen" style="position:fixed;inset:0;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;z-index:50">',
      '    <div class="card" style="width:420px">',
      '      <div class="card-title">确认下发投喂命令？</div>',
      '      <div class="kv">',
      '        <span class="k">设备</span><span class="mono">feeder_01</span>',
      '        <span class="k">投喂量</span><span><b>{{ targetKg }}</b> kg/h',
      '          <span class="small muted">（{{ mode === \'auto\' ? \'系统建议值\' : \'手动填写\' }}）</span></span>',
      '        <span class="k">时长</span><span>60 s</span>',
      '        <span class="k">超时</span><span>5000 ms，最多重试 3 次</span>',
      '      </div>',
      '      <div class="row" style="justify-content:flex-end;margin-top:14px">',
      '        <button @click="cancel">取消</button>',
      '        <button class="primary" @click="confirm">确认下发</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/ai/light'] = {
    data: function () {
      return {
        tick: 0, minutes: 60, series: null, unsub: null,
        dimming: 60, confirmOpen: false,
        light: { device_id: 'light_01', device_online: true, device_state: 'standby',
                 device_params: { light_dimming_pct: 0 } }
      };
    },
    computed: {
      fast: function () { return this.series ? this.series.fast : []; },
      last: function () { return this.fast.length ? this.fast[this.fast.length - 1] : {}; },
      charts: function () {
        return [
          { name: '环境光照强度', unit: 'lux', data: this.fast.map(function (r) { return [r.ts, r.light_intensity]; }) }
        ];
      },
      commands: function () { this.tick; return API.commands().filter(function (c) { return c.command_type === 'light'; }); },
      latest: function () { this.tick; return this.commands.length ? this.commands[0] : null; },
      /* 当前档位对应的"人话"说明（组员反馈：只给百分比不直观） */
      dimLevel: function () { return this.levelOf(this.dimming); }
    },
    methods: {
      /* 🔴 档位 → 人话。为什么只给"相对光强"而不给 lux 绝对值：
         实际照度 = 灯具额定照度 × 档位，而**我们的灯具没有标定过额定照度**
         （见「管理 · 标定与维护」里 light_01 那条）。
         编一个 lux 数字出来，答辩被问"你哪来的"就答不上 —— 所以只给相对值。 */
      levelOf: function (pct) {
        const p = Number(pct);
        if (p <= 0)   return { name: '关闭', rel: '0', note: '不补光' };
        if (p <= 25)  return { name: '弱',   rel: '约 1/4 额定', note: '阴天 / 清晨补光' };
        if (p <= 50)  return { name: '中',   rel: '约 1/2 额定', note: '常规补光' };
        if (p <= 75)  return { name: '强',   rel: '约 3/4 额定', note: '促生长时段' };
        return { name: '满', rel: '额定出力', note: '最大出力' };
      },
      load: function () {
        const self = this;
        API.resolve(API.env('site_01', this.minutes, {}), function (d) { self.series = d; });
        const d = API.devices().filter(function (x) { return x.device_id === 'light_01'; })[0];
        if (d) this.light = d;
      },
      ask: function () { this.confirmOpen = true; },
      cancel: function () { this.confirmOpen = false; },
      confirm: function () {
        this.confirmOpen = false;
        API.sendCommand('light_01', 'light', { light_dimming_pct: this.dimming }, {});
      },
      statusCn: function (s) {
        return { created: '已创建', sent: '已发出', acknowledged: '已收到回执', success: '成功',
                 timeout: '超时', retrying: '重试中', failed: '失败', escalated: '升级报警',
                 cancelled: '已停止' }[s] || s;
      },
      /* 命令的下发时间（组员反馈：补光历史要能看到下发时间，方便查命令） */
      cmdTime: function (c) {
        const ts = c.created_ts || (c.history && c.history.length ? c.history[0].ts : null);
        return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—';
      }
    },
    mounted: function () {
      this.load();
      const self = this;
      /* API.bind = 数据变化时重算 + 每 3 秒自动刷新曲线（见 api-remote.js 的说明）。
         🔴 2026-10-07 加：之前曲线只在进页面时拉一次，是张静止的快照。 */
      this.unsub = API.bind(this, this.load);
    },
    beforeUnmount: function () { if (this.unsub) this.unsub(); },
    watch: { minutes: function () { this.load(); } },
    template: [
      '<div>',
      '  <page-head title="智能 · 智能补光"',
      '    desc="当前光照 <code>light_intensity</code>（环境提供，lux）；调光档位 <code>light_dimming_pct</code>（%，裁定 N2）"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="hint" style="margin-bottom:12px">',
      '    ⚠️ <b>本期只做手工模式</b>。补光依据（促生长 / 调控繁殖 / 抑制藻类）<b>查不到出处</b>，',
      '    按规矩不编 —— 保留字段、保留接口、保留手工开关，<b>不做自动决策</b>（裁定 7）。',
      '    <div class="small" style="margin-top:4px">',
      '      答辩口径：<i>补光接口已定义并可用，自动决策依据待养殖专家确认，本期只做手动控制。</i>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="环境光照强度" field="light_intensity" unit="lux" :value="last.light_intensity" :quality="last.quality" :ts="last.ts" source="simulated" />',
      '    <stat-card name="灯具在线" field="device_online" unit="" :value="light.device_online ? \'在线\' : \'离线\'" source="simulated" />',
      '    <stat-card name="灯具运行状态" field="device_state" unit="" :value="CN.deviceState(light.device_state)" source="simulated" />',
      '    <stat-card name="当前调光档位" field="light_dimming_pct" unit="%" :value="light.device_params && light.device_params.light_dimming_pct" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="光照强度趋势（白天才有光照，夜间为 0）" :series="charts" />',
      '    <div class="card">',
      '      <div class="card-title">补光命令状态机</div>',
      '      <div v-if="!latest" class="todo">还没有下发过补光命令</div>',
      '      <div v-else>',
      '        <command-flow :status="latest.command_status" />',
      '        <div class="kv" style="margin-top:8px">',
      '          <span class="k">命令号</span><span class="mono">{{ latest.command_id }}</span>',
      '          <span class="k">下发时间</span><span>{{ cmdTime(latest) }}</span>',
      '          <span class="k">目标档位</span>',
      '          <span>{{ latest.params.light_dimming_pct }} %（{{ levelOf(latest.params.light_dimming_pct).name }}）</span>',
      '          <span class="k">失败原因</span>',
      '          <span :style="{ color: latest.fail_reason ? \'#991B1B\' : \'#6B7280\' }">{{ latest.fail_reason || \'—\' }}</span>',
      '        </div>',
      '      </div>',
      '      <!-- 补光历史：2026-10-07 按组员反馈放大（原来状态机占太多、历史看不了几条），',
      '           并加上「下发时间」—— 查命令时最需要的就是时间 -->',
      '      <div class="small muted" style="margin-top:12px">',
      '        补光历史<span v-if="commands.length">（{{ commands.length }} 条）</span>',
      '      </div>',
      '      <div class="events" style="max-height:320px;overflow:auto">',
      '        <div v-for="c in commands" :key="c.command_id" class="row-item" style="cursor:default">',
      '          <span class="t">{{ cmdTime(c) }}</span>',
      '          <span class="d">',
      '            <b>{{ c.params.light_dimming_pct }}%</b>',
      '            <span class="small muted">{{ levelOf(c.params.light_dimming_pct).name }}</span>',
      '            · <span class="mono small">{{ c.command_id }}</span>',
      '            · <span :style="{ color: c.command_status === \'success\' ? \'#166534\' : (c.fail_reason ? \'#991B1B\' : \'#6B7280\') }">{{ statusCn(c.command_status) }}</span>',
      '          </span>',
      '        </div>',
      '        <div v-if="!commands.length" class="empty">暂无记录</div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 档位对照表：组员反馈「只给百分比没法知道是什么样的光照条件」 -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">调光档位对照</div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>档位</th><th>档位名</th><th>相对光强</th><th>典型用途</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="lv in [[0,\'关闭\'],[25,\'弱\'],[50,\'中\'],[75,\'强\'],[100,\'满\']]" :key="lv[0]">',
      '            <td class="mono">≤ {{ lv[0] }} %</td>',
      '            <td><b>{{ lv[1] }}</b></td>',
      '            <td class="small">{{ levelOf(lv[0]).rel }}</td>',
      '            <td class="small">{{ levelOf(lv[0]).note }}</td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <div class="hint small" style="margin-top:10px">',
      '      <b>为什么这里只给「相对光强」而不给 lux 绝对值</b>：',
      '      实际照度 = 灯具额定照度 × 档位，而<b>本站的补光灯具没有做过计量标定</b>',
      '      （见「管理 · 标定与维护」里 light_01 那条）。',
      '      <b>编一个 lux 数字出来，答辩被问「你哪来的」就答不上</b> —— 所以只给相对值。',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="width:12px"></span>',
      '    <span class="small muted">手动设定调光档位</span>',
      '    <input type="range" min="0" max="100" step="5" v-model.number="dimming" style="width:180px"',
      '           class="editable">',
      '    <b>{{ dimming }} %</b>',
      '    <!-- 组员反馈：只给百分比不直观 —— 补上档位名与相对光强 -->',
      '    <span class="small" style="color:#2F5496">',
      '      {{ dimLevel.name }} · {{ dimLevel.rel }}',
      '    </span>',
      '    <span style="flex:1"></span>',
      '    <button class="primary" @click="ask">下发补光命令</button>',
      '  </div>',
      '',
      '  <div v-if="confirmOpen" style="position:fixed;inset:0;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;z-index:50">',
      '    <div class="card" style="width:400px">',
      '      <div class="card-title">确认下发补光命令？</div>',
      '      <div class="kv">',
      '        <span class="k">设备</span><span class="mono">light_01</span>',
      '        <span class="k">调光档位</span><span>{{ dimming }} % （{{ dimLevel.name }} · {{ dimLevel.rel }}）</span>',
      '        <span class="k">超时</span><span>5000 ms，最多重试 3 次</span>',
      '      </div>',
      '      <div class="row" style="justify-content:flex-end;margin-top:14px">',
      '        <button @click="cancel">取消</button>',
      '        <button class="primary" @click="confirm">确认下发</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

})(window);
