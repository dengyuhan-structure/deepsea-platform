/* ============================================================
   pages/global.js —— 跨板块全局页
   ============================================================
   负责人：队长（顶层统一）

   【这个文件归谁】
     归上面写的那个人（以及他的 AI）。**别人不要改这个文件。**

   【怎么加页面】
     照抄本文件里已有页面的结构，往 PAGES 上注册一个新路由就行：
         PAGES['/trace/xxx'] = { data: ..., computed: ..., methods: ..., template: [...] };

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

  PAGES['/trace'] = {
    data: function () { return { id: '', picked: null }; },
    computed: {
      alarms: function () { return API.alarms(); },
      list: function () { return this.alarms; },
      /* 快照不要直接甩原始 JSON —— 里面的 ts 是毫秒数，
         通用规范第三节要求「界面显示 2026-10-02 12:00:00，精确到秒」。
         拆成键值行，时间字段一律格式化。 */
      snapRows: function () {
        const s = this.picked && this.picked.trigger_snapshot;
        if (!s) return [];
        const self = this;
        return Object.keys(s).map(function (k) {
          let v = s[k];
          if (typeof v === 'number' && (k === 'ts' || /_ts$/.test(k))) {
            v = new Date(v).toLocaleString('zh-CN', { hour12: false });
          }
          return { k: k, v: v };
        });
      }
    },
    methods: {
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); },
      lvCn: function (lv) { return { blue: '蓝色', yellow: '黄色', orange: '橙色', red: '红色' }[lv] || lv; },
      lvCls: function (lv) { return 'bg-' + (lv || 'blue'); },
      /* 枚举一律显示中文（通用规范 第五节给了每个枚举的中文标签）——
         不许把 tension / active / pending 这种原始值漏到界面上。 */
      typeCn: function (t) {
        return { tension: '锚泊张力', tilt: '网箱倾斜', net_damage: '网衣破损',
                 deformation: '结构形变', low_battery: '低电量', power_supply: '供电异常' }[t] || t;
      },
      stCn: function (s) { return { active: '活跃', acknowledged: '已确认', recovered: '已恢复' }[s] || s; },
      hdCn: function (s) { return { pending: '待处置', handling: '处置中', handled: '已处置', failed: '处置失败' }[s] || s; },
      cfCn: function (s) { return { unconfirmed: '未确认', confirmed: '已确认' }[s] || s; },
      pick: function (a) { this.picked = a; this.id = a.alarm_event_id; },
      find: function () {
        const a = API.alarm(this.id.trim());
        this.picked = a;
        if (!a) this.picked = null;
      }
    },
    mounted: function () { if (this.list.length) this.pick(this.list[0]); },
    template: [
      '<div>',
      '  <page-head title="跨板块 · 追溯查询"',
      '    desc="答辩必答题：<b>哪条数据 → 命中哪条规则 → 结果如何</b>。抽 20 条要 100% 能反查"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="card">',
      '    <div class="row" style="align-items:center">',
      '      <span class="small muted">告警事件编号</span>',
      '      <input type="text" v-model="id" placeholder="ALM-0001" style="width:200px" @keyup.enter="find">',
      '      <button class="primary" @click="find">反查全链路</button>',
      '      <span v-if="id && !picked" class="small" style="color:#991B1B">查不到这个编号</span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="row" style="margin-top:12px;align-items:flex-start">',
      '    <div class="card" style="flex:0 0 340px">',
      '      <div class="card-title">现有告警（点一条直接追溯）</div>',
      '      <div class="events">',
      '        <div v-for="a in list" :key="a.alarm_event_id" class="row-item" @click="pick(a)"',
      '             :style="{ background: picked && picked.alarm_event_id === a.alarm_event_id ? \'#F1F5F9\' : \'\' }">',
      '          <span class="dot" :class="lvCls(a.risk_level)"></span>',
      '          <span class="d"><span class="mono">{{ a.alarm_event_id }}</span> · {{ a.rule_name }}</span>',
      '        </div>',
      '      </div>',
      '    </div>',
      '',
      '    <div style="flex:1;min-width:0">',
      '      <div v-if="!picked" class="todo">左侧点一条告警，或输入编号反查</div>',
      '      <div v-else>',
      '        <div class="card">',
      '          <div class="card-title">',
      '            <span class="dot" :class="lvCls(picked.risk_level)"></span>',
      '            {{ picked.alarm_event_id }} · {{ picked.rule_name }}',
      '          </div>',
      '          <div class="kv">',
      '            <span class="k">规则编号</span><span class="mono">{{ picked.rule_id }}</span>',
      '            <span class="k">规则条件</span><span class="mono">{{ picked.rule_condition }}</span>',
      '            <span class="k">组合条件</span><span class="mono">{{ picked.combine_condition || \'—\' }}</span>',
      '            <span class="k">预警类型</span><span>{{ typeCn(picked.alarm_type) }}</span>',
      '            <span class="k">预警等级</span><span>{{ lvCn(picked.risk_level) }}预警</span>',
      '            <span class="k">预警时间</span><span>{{ time(picked.alarm_ts) }}</span>',
      '            <span class="k">预警状态</span><span>{{ stCn(picked.alarm_status) }}</span>',
      '          </div>',
      '        </div>',
      '',
      '        <div class="card">',
      '          <div class="card-title">① 哪条数据触发的</div>',
      '          <div class="kv">',
      '            <span class="k">触发字段</span><span class="mono">{{ picked.trigger_field }}</span>',
      '            <span class="k">触发值</span><span><b>{{ picked.trigger_value }}</b></span>',
      '            <span class="k">触发阈值</span><span>{{ picked.trigger_threshold }}</span>',
      '          </div>',
      '        </div>',
      '',
      '        <div class="card">',
      '          <div class="card-title">② 触发数据快照（trigger_snapshot）</div>',
      '          <div class="kv">',
      '            <template v-for="r in snapRows" :key="r.k">',
      '              <span class="k mono">{{ r.k }}</span><span>{{ r.v }}</span>',
      '            </template>',
      '          </div>',
      '          <div class="small muted" style="margin-top:8px">',
      '            时间字段已按通用规范第三节格式化显示（原值为毫秒数）。',
      '          </div>',
      '        </div>',
      '',
      '        <div class="card">',
      '          <div class="card-title">③ 结果如何</div>',
      '          <div class="kv">',
      '            <span class="k">处置建议</span><span>{{ picked.handling_advice }}</span>',
      '            <span class="k">处置状态</span><span>{{ hdCn(picked.handle_status) }}</span>',
      '            <span class="k">确认状态</span><span>{{ cfCn(picked.confirm_status) }}</span>',
      '            <span class="k">恢复时间</span><span>{{ picked.recover_ts ? time(picked.recover_ts) : \'尚未恢复\' }}</span>',
      '          </div>',
      '          <div class="row" style="margin-top:12px">',
      '            <a href="#/handle"><button>去处置中心 →</button></a>',
      '            <a href="#/alarm"><button>去告警中心 →</button></a>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/handle'] = {
    data: function () { return { tick: 0, picked: null, unsub: null }; },
    computed: {
      alarms: function () { return API.alarms(); },
      pending: function () {
        return this.alarms.filter(function (a) { return a.handle_status !== 'handled'; });
      },
      commands: function () { this.tick; return API.commands(); }
    },
    methods: {
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); },
      lvCls: function (lv) { return 'bg-' + (lv || 'blue'); },
      statusCn: function (s) {
        return { pending: '待处置', handling: '处置中', handled: '已处置', failed: '处置失败' }[s] || s;
      },
      confirmCn: function (s) { return s === 'confirmed' ? '已确认' : '未确认'; },
      pick: function (a) { this.picked = a; },
      /* 处置动作 = 下发一条命令，走同一套状态机 */
      act: function (a, type) {
        this.picked = a;
        a.handle_status = 'handling';
        API.sendCommand('feeder_01', type, { from_alarm: a.alarm_event_id }, {});
      },
      confirmAlarm: function (a) {
        a.confirm_status = 'confirmed';
        a.confirm_ts = Date.now();
        a.alarm_status = 'acknowledged';
        a.handle_status = 'handled';
      }
    },
    mounted: function () {
      const self = this;
      this.unsub = API.subscribe(function () { self.tick++; });
      if (this.pending.length) this.picked = this.pending[0];
    },
    beforeUnmount: function () { if (this.unsub) this.unsub(); },
    template: [
      '<div>',
      '  <page-head title="跨板块 · 处置中心"',
      '    desc="所有处置动作走智能板块的<b>同一套指令状态机</b>（裁定 11 B 案：顶层统一）"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="row" style="align-items:flex-start">',
      '    <div class="card" style="flex:0 0 380px">',
      '      <div class="card-title">待处置（{{ pending.length }} 条）</div>',
      '      <div v-if="!pending.length" class="todo">没有待处置的告警</div>',
      '      <div class="events">',
      '        <div v-for="a in pending" :key="a.alarm_event_id" class="row-item" @click="pick(a)"',
      '             :style="{ background: picked && picked.alarm_event_id === a.alarm_event_id ? \'#F1F5F9\' : \'\' }">',
      '          <span class="dot" :class="lvCls(a.risk_level)"></span>',
      '          <span class="d">',
      '            <span class="mono">{{ a.alarm_event_id }}</span> {{ a.rule_name }}',
      '            <div class="small muted">{{ statusCn(a.handle_status) }} · {{ confirmCn(a.confirm_status) }}</div>',
      '          </span>',
      '        </div>',
      '      </div>',
      '    </div>',
      '',
      '    <div style="flex:1;min-width:0">',
      '      <div v-if="!picked" class="todo">左侧选一条告警</div>',
      '      <div v-else>',
      '        <div class="card">',
      '          <div class="card-title">处置：{{ picked.alarm_event_id }}</div>',
      '          <div class="kv">',
      '            <span class="k">告警</span><span>{{ picked.rule_name }}</span>',
      '            <span class="k">建议</span><span>{{ picked.handling_advice }}</span>',
      '            <span class="k">处置状态</span><span>{{ statusCn(picked.handle_status) }}</span>',
      '            <span class="k">确认状态</span><span>{{ confirmCn(picked.confirm_status) }}</span>',
      '          </div>',
      '          <div class="row" style="margin-top:12px">',
      '            <button class="primary" @click="act(picked, \'feed\')">执行处置（下发命令）</button>',
      '            <button @click="confirmAlarm(picked)">确认告警（人工）</button>',
      '            <a href="#/ai/feed"><button>看状态机详情 →</button></a>',
      '          </div>',
      '          <div class="small muted" style="margin-top:8px">',
      '            处置动作不是"点一下就当做完" —— 它下发一条命令，<b>走状态机、等回执</b>，链路与自动投喂完全一致。',
      '          </div>',
      '        </div>',
      '',
      '        <div class="card">',
      '          <div class="card-title">本次会话下发的命令（{{ commands.length }} 条）</div>',
      '          <div v-if="!commands.length" class="todo">还没有下发过命令</div>',
      '          <div v-else class="dt-wrap" style="max-height:300px">',
      '            <table class="dt">',
      '              <thead><tr><th>命令号</th><th>类型</th><th>状态</th><th>重试</th><th>失败原因</th></tr></thead>',
      '              <tbody>',
      '                <tr v-for="c in commands" :key="c.command_id">',
      '                  <td class="mono">{{ c.command_id }}</td><td>{{ CN.commandType(c.command_type) }}</td>',
      '                  <td>{{ statusCn(c.command_status) }}</td><td>{{ c.retry_count }}</td>',
      '                  <td :style="{ color: c.fail_reason ? \'#991B1B\' : \'#6B7280\' }">{{ c.fail_reason || \'—\' }}</td>',
      '                </tr>',
      '              </tbody>',
      '            </table>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/alarm'] = {
    data: function () { return { tick: 0, fLevel: '', fStatus: '', fType: '', unsub: null }; },
    computed: {
      all: function () { this.tick; return API.alarms(); },
      types: function () {
        const s = {};
        this.all.forEach(function (a) { s[a.alarm_type] = 1; });
        return Object.keys(s);
      },
      rows: function () {
        const self = this;
        return this.all.filter(function (a) {
          if (self.fLevel && a.risk_level !== self.fLevel) return false;
          if (self.fStatus && a.alarm_status !== self.fStatus) return false;
          if (self.fType && a.alarm_type !== self.fType) return false;
          return true;
        });
      },
      counts: function () {
        const c = { red: 0, orange: 0, yellow: 0, blue: 0 };
        this.all.forEach(function (a) { if (c[a.risk_level] !== undefined) c[a.risk_level]++; });
        return c;
      }
    },
    methods: {
      lvCn: function (l) { return { blue: '蓝色', yellow: '黄色', orange: '橙色', red: '红色' }[l] || l; },
      lvCls: function (l) { return 'bg-' + (l || 'blue'); },
      typeCn: function (t) {
        return { tension: '锚泊张力', tilt: '网箱倾斜', net_damage: '网衣破损',
                 deformation: '结构形变', low_battery: '低电量', power_supply: '供电异常' }[t] || t;
      },
      stCn: function (s) { return { active: '活跃', acknowledged: '已确认', recovered: '已恢复' }[s] || s; },
      hdCn: function (s) { return { pending: '待处置', handling: '处置中', handled: '已处置', failed: '处置失败' }[s] || s; },
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); },
      go: function (a) { window.location.hash = '/trace'; }
    },
    mounted: function () {
      const self = this;
      this.unsub = API.subscribe(function () { self.tick++; });
    },
    beforeUnmount: function () { if (this.unsub) this.unsub(); },
    template: [
      '<div>',
      '  <page-head title="跨板块 · 告警中心"',
      '    desc="顶层统一做一套（裁定 11 B 案），各板块只提供 <code>alarm_event</code> —— 灾害预警、投喂动作、鱼类异常都进这里"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="红色预警" unit="条" :value="counts.red" :digits="0" source="simulated" />',
      '    <stat-card name="橙色预警" unit="条" :value="counts.orange" :digits="0" source="simulated" />',
      '    <stat-card name="黄色预警" unit="条" :value="counts.yellow" :digits="0" source="simulated" />',
      '    <stat-card name="蓝色预警" unit="条" :value="counts.blue" :digits="0" source="simulated" />',
      '  </div>',
      '',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="row" style="align-items:center">',
      '      <span class="small muted">等级</span>',
      '      <select v-model="fLevel"><option value="">全部</option><option value="red">红色</option><option value="orange">橙色</option><option value="yellow">黄色</option><option value="blue">蓝色</option></select>',
      '      <span class="small muted">状态</span>',
      '      <select v-model="fStatus"><option value="">全部</option><option value="active">活跃</option><option value="acknowledged">已确认</option><option value="recovered">已恢复</option></select>',
      '      <span class="small muted">类型</span>',
      '      <select v-model="fType"><option value="">全部</option><option v-for="t in types" :key="t" :value="t">{{ typeCn(t) }}</option></select>',
      '      <span style="flex:1"></span>',
      '      <span class="small muted">共 {{ rows.length }} 条</span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="card">',
      '    <div class="card-title">告警列表（点一行去追溯查询）</div>',
      '    <div v-if="!rows.length" class="todo">没有符合条件的告警</div>',
      '    <div v-else class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>事件编号</th><th>等级</th><th>类型</th><th>规则</th><th>预警时间</th><th>状态</th><th>处置</th><th></th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="a in rows" :key="a.alarm_event_id">',
      '            <td class="mono">{{ a.alarm_event_id }}</td>',
      '            <td><span class="dot" :class="lvCls(a.risk_level)"></span>{{ lvCn(a.risk_level) }}</td>',
      '            <td>{{ typeCn(a.alarm_type) }}</td>',
      '            <td><span class="mono small">{{ a.rule_id }}</span> {{ a.rule_name }}</td>',
      '            <td>{{ time(a.alarm_ts) }}</td>',
      '            <td>{{ stCn(a.alarm_status) }}</td>',
      '            <td>{{ hdCn(a.handle_status) }}</td>',
      '            <td><a href="#/trace">追溯 →</a></td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px">',
      '    <b>答辩卖点</b>：一个告警中心能看到所有板块的异常。',
      '    告警分级规则由结构安全提供，页面与通用组件由顶层统一维护 —— 避免出现四个告警页。',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/config'] = {
    data: function () {
      return {
        /* 每个阈值都带一份「依据」—— 页面上显示为数值旁的灰色问号，悬停可看。
           任务书要求逐项说明"阈值从哪来（标准？文献？自己设的？）"，
           所以 basis.level 必须如实标注证据强度，不许含糊。
           ⚠️ 改这里的依据时，必须同步改 项目记录.md 与 统一数据接口文档，
              三处口径不一致是答辩硬伤（裁定 2）。 */
        thresholds: [
          { field: 'tension_pct', name: '锚泊张力占设计值', warn: 80, alarm: 95, unit: '%', owner: '结构安全',
            basis: {
              level: '间接支持',
              text: '标准给的是【设计安全系数】，不是运营预警线，两者层次不同。本平台定义 张力利用率 R = T_max / T_design，其中 T_design = PB / F，F 按 CCS《海上单点系泊装置入级规范》(2021) 表4.4.4.3「完整自存工况·动力分析法」取 1.67，即 T_design = 60% PB。据此 R=80% 对应 48% PB、R=95% 对应 57% PB，均低于 60% PB 的许用上限，逻辑自洽。另：CCS《海上渔业养殖设施检验指南》4.4.1.2 明确「定位系泊系统在业主/设计者规定的作业限制和程序的基础上考虑入级」—— 运营限值由业主定义是有规范依据的。',
              source: 'CCS《海上单点系泊装置入级规范》(2021) 表4.4.4.3；CCS《海上渔业养殖设施检验指南》(初稿2023) 4.4.1.2；王斌等. 养殖网箱锚泊系统结构设计与性能分析研究进展. 上海海洋大学学报, 2025, 34(1):176-187 (表4 给出极限张力 50/60/70/80 %MBS)',
              url: 'https://www.ccs.org.cn/ccswz//file/download?fileid=202310130967039404'
            } },
          { field: 'tilt_pitch', name: '网箱俯仰角', warn: 5, alarm: 15, unit: '°', owner: '结构安全',
            basis: {
              level: '间接支持',
              text: '⚠️ 原用 2°/3°，查不到任何标准或文献出处，而且量级偏小 —— 波浪作用下网箱常态横摇就可能超过 2°，会持续误报，现场一定会把告警关掉（"狼来了"）。2026-10-06 改为 5°/15°：① 15° 有规范出处 —— CCS《海上渔业养殖设施检验指南》(初稿2023) 3.2.1.7 完整稳性衡准「复原力臂从正浮至 15 度内，应均为正值」；② 5° 为自设提示线，取在常态横摇之上、稳性衡准角之下的合理位置，可现场标定。中间 10° 可作为「关注」档（平台目前只有两档）。参考：可查到的网箱角度量级是 15°/45°/90°（渔业现代化 2023,50(6):33-40 的控制系统效果分档）。',
              source: 'CCS《海上渔业养殖设施检验指南》(初稿2023) 3.2.1.7（15° 稳性衡准角，官方 PDF）；《沉浮式养殖网箱自动化控制与管理系统研究》渔业现代化 2023,50(6):33-40（15/45/90° 分档）；5° 为自设，待现场标定',
              url: 'https://www.ccs.org.cn/ccswz/file/download?fileid=202305310555635104'
            } },
          { field: 'tilt_roll', name: '网箱横滚角', warn: 5, alarm: 15, unit: '°', owner: '结构安全',
            basis: {
              level: '间接支持',
              text: '同俯仰角 —— 横滚与俯仰共用同一组阈值（同一个完整稳性衡准，不区分横滚与俯仰）。见俯仰角那一条的说明。',
              source: '同俯仰角',
              url: 'https://www.ccs.org.cn/ccswz/file/download?fileid=202305310555635104'
            } },
          { field: 'battery_soc', name: '储能电量', warn: 20, alarm: 10, unit: '%', owner: '结构安全',
            basis: {
              level: '间接支持',
              text: '红色线 <10% 有据：① JFPA 0007—2021《电化学储能电站消防安全评估》附录示例中，镇江新坝储能电站的 SOC 下限阈值就取 10%；② 阳光电源储能 EMS 用户手册明确写「It is advised to define the discharge cut-off SOC higher than 10% to prevent the battery from harm caused by over-discharge」。黄色线 <20% 没找到出处 —— 更站得住的做法是按【剩余续航时间】定义（如「低于可支撑 2 小时关键负荷的 SOC」），这是可解释、可现场标定的自设值。',
              source: 'JFPA 0007—2021《电化学储能电站消防安全评估》（江苏省消防协会团体标准）附录；阳光电源 Sungrow 储能 EMS 用户手册',
              url: 'https://www.ttbz.org.cn/upload/file/20211231/6377655856356791481341645.pdf'
            } },
          { field: 'water_temp', name: '水温上限（按鱼种）', warn: 25.5, alarm: 28.0, unit: '℃', owner: '环境',
            basis: {
              level: '官方/标准',
              text: '🔴 原用统一阈值 20.5/21.5℃ —— 这是错的：大黄鱼「最适生长水温为 18～25℃」，20.5℃ 正落在最适区间中间，拿它当上限告警，等于鱼长得最好的时候平台一直报警；对大菱鲆（最适 15~18℃）更是常年误报。现已改为**按网箱养殖鱼种取值**，数据见 data/鱼种温度参数.json（30 个种，22 个给出告警线）。当前站点主养大黄鱼，取高提示 25.5℃ / 高告警 28.0℃（最适上限 25℃ 外推 0.5℃，告警线在 30℃ 摄食明显下降点前留 2℃ 余量）。各鱼种差异极大：大菱鲆 22.0℃、虹鳟 22.0℃、罗非鱼 36.0℃ —— 统一的阈值在物理上不可能对。',
              source: '《温岭市坞根镇养殖片区整体海域使用论证报告表》p.44（引 DB3303/T 019—2020《大黄鱼生态养殖技术规范》）—— 原文「大黄鱼对水温的适应范围为 10～32℃，最适生长水温为 18～25℃…而当温度上升到 30℃ 时又明显下降」',
              url: ''
            } },
          { field: 'dissolved_oxygen', name: '溶解氧下限', warn: 5.0, alarm: 4.0, unit: 'mg/L', owner: '环境',
            basis: {
              level: '直接支持',
              text: '六项里证据最强。① GB 11607—1989《渔业水质标准》表1：「溶解氧 连续24h中，16h以上必须大于5，其余任何时候不得低于3」——直接支持 5.0 提示线；② GB 3097—1997《海水水质标准》表1 序号9：第二类（适用于水产养殖区）溶解氧 >5 mg/L——跌破即不再满足养殖区水质；③ 大黄鱼「对溶解氧的要求较高，一般在 4mg/L 以上，幼鱼的溶解氧临界值为 3mg/L 左右」——直接支持 4.0 告警线，并提示可再加一档 <3.0 紧急。注意措辞：GB 3097 的 5 mg/L 是【水质类别标准值】，不是告警阈值，引用时写「参照…设定」。',
              source: 'GB 11607—1989《渔业水质标准》表1 序号5；GB 3097—1997《海水水质标准》表1 序号9；浙江省温岭市养殖水域滩涂规划 1.4.3.2.5（大黄鱼）',
              url: 'http://www.scsio.ac.cn/gczx/xzzx_197139/xgxyjszlk/hp/202309/P020230921577460708530.pdf'
            } }
        ],
        rules: [],
        saved: '',
        /* ⚠️ tick 必须显式声明并读一次（见下面 species 计算属性）。
           原因：参数库是后端异步拉来的，而 Vue 对「没有响应式依赖的 computed」会永久缓存 ——
           不读一次 tick，拉回来也不会重算，页面上永远是 0 个鱼种。这个坑踩过两次了。 */
        tick: 0,
        unsub: null
      };
    },
    computed: {
      /* 鱼种体长体重参数库（后端 data/鱼种体长体重参数.json）。
         全项目唯一一处硬编码参数原来藏在后端 `(avg_w / 0.0218) ** (1/3.02)`
         —— 没鱼种、没出处。现在参数连同出处一起显示在这里，答辩能当场翻。 */
      species: function () { this.tick; return API.species() || []; },
      /* 有几个种的参数不是按全长拟合的 —— 页面上要显式警告，不能让人误用 */
      diffLenType: function () {
        return (this.species || []).filter(function (s) {
          return s.length_type && s.length_type !== 'total length';
        }).length;
      },
      primaryCount: function () {
        const s = this.species;
        return s.filter(function (r) { return r.source && r.source !== 'FishBase'; }).length;
      },
      ruleList: function () {
        return [
          { id: 'R-TENSION-01', name: '锚泊张力黄色预警', cond: '张力利用率 R > 80%（R = T_max / T_design，T_design = PB/1.67）', level: 'yellow', from: 'tension_pct' },
          { id: 'R-TENSION-02', name: '锚泊张力红色预警', cond: '张力利用率 R > 95%（等价约 57% PB，低于 60% PB 许用上限）', level: 'red', from: 'tension_pct' },
          { id: 'R-TILT-01', name: '网箱倾斜橙色预警', cond: 'tilt_pitch > 5 且 wave_height > 1.5', level: 'orange', from: 'tilt_pitch + wave_height' },
          { id: 'R-TILT-02', name: '网箱倾斜红色预警', cond: 'tilt_pitch > 15（CCS 完整稳性衡准角）', level: 'red', from: 'tilt_pitch' },
          { id: 'R-BAT-01', name: '储能低电量黄色预警', cond: 'battery_soc < 20', level: 'yellow', from: 'battery_soc' },
          { id: 'R-BAT-02', name: '储能严重低电量预警', cond: 'battery_soc < 10', level: 'red', from: 'battery_soc' },
          { id: 'R-TEMP-01', name: '水温上限告警', cond: 'water_temp >= 21.5', level: 'red', from: 'water_temp' }
        ];
      }
    },
    methods: {
      lvCls: function (l) { return 'bg-' + (l || 'blue'); },
      lvCn: function (l) { return { blue: '蓝色', yellow: '黄色', orange: '橙色', red: '红色' }[l] || l; },
      /* 证据强度配色 —— 与 HelpDot 里的配色保持一致，一眼看出哪几项底气不足 */
      basisColor: function (t) {
        const lv = (t.basis && t.basis.level) || '未标注';
        return {
          '直接支持': { bg: '#F0FDF4', br: '#86EFAC', fg: '#166534' },
          '间接支持': { bg: '#EFF6FF', br: '#BFDBFE', fg: '#1D4ED8' },
          '仅类比':   { bg: '#FFFBEB', br: '#FDE68A', fg: '#92400E' },
          '没找到':   { bg: '#FEF2F2', br: '#FECACA', fg: '#991B1B' }
        }[lv] || { bg: '#F3F4F6', br: '#E5E7EB', fg: '#6B7280' };
      },
      /* 体长类型必须显示中文 —— 界面不许出现裸英文枚举（通用规范第五节）。
         但缩写要留着：TL/FL/SL 是行业通用符号，去掉反而不好交流。 */
      lenTypeCn: function (t) {
        return { 'total length': '全长 TL', 'fork length': '叉长 FL',
                 'standard length': '标准长 SL' }[t] || t || '—';
      },
      save: function () {
        this.saved = '已保存（' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) +
                     '）—— 规则引擎下一轮生效。真实系统此处会写配置并通知各板块。';
      }
    },
    mounted: function () {
      const self = this;
      this.unsub = API.subscribe(function () { self.tick++; });
    },
    beforeUnmount: function () {
      if (this.unsub) { this.unsub(); this.unsub = null; }
    },
    template: [
      '<div>',
      '  <page-head title="跨板块 · 参数配置"',
      '    desc="阈值由各板块提，判断规则挂在结构安全的规则引擎上（裁定 11 B 案）"',
      '    :sources="[\'demo\']" />',
      '',
      '  <div class="hint" style="margin-bottom:12px;background:#FFFBEB;border-color:#FDE68A">',
      '    ⚠️ 下面这些阈值一律是 <b>「经验阈值，未经现场标定」</b>，出处为「参考文献区间 + 经验设定」。',
      '    <b>查不到出处就不编</b> —— 页面、文档、答辩口径三处必须一致（裁定 2）。',
      '  </div>',
      '',
      '  <div class="card">',
      '    <div class="card-title">阈值配置</div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>字段</th><th>含义</th><th>拥有者</th><th>黄色阈值</th><th>红色阈值</th><th>单位</th><th>来源标注</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="t in thresholds" :key="t.field">',
      '            <td class="mono">{{ t.field }}</td><td>{{ t.name }}</td><td>{{ t.owner }}</td>',
      '            <td style="white-space:nowrap">',
      '              <input type="text" v-model.number="t.warn" style="width:64px">',
      '              <help-dot :info="t.basis" :label="t.name + \' · 黄色预警线 \' + t.warn + t.unit" />',
      '            </td>',
      '            <td style="white-space:nowrap">',
      '              <input type="text" v-model.number="t.alarm" style="width:64px">',
      '              <help-dot :info="t.basis" :label="t.name + \' · 红色预警线 \' + t.alarm + t.unit" />',
      '            </td>',
      '            <td>{{ t.unit }}</td>',
      '            <td class="small">',
      '              <span class="hd-badge"',
      '                    :style="{ background: basisColor(t).bg, borderColor: basisColor(t).br, color: basisColor(t).fg }">',
      '                {{ (t.basis && t.basis.level) || \'未标注\' }}',
      '              </span>',
      '            </td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <div class="row" style="margin-top:12px;align-items:center">',
      '      <button class="primary" @click="save">保存阈值</button>',
      '      <span class="small muted">{{ saved }}</span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="card">',
      '    <div class="card-title">判断规则（挂在结构安全的规则引擎上）</div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>规则编号</th><th>规则名称</th><th>条件</th><th>等级</th><th>取数字段</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="r in ruleList" :key="r.id">',
      '            <td class="mono">{{ r.id }}</td><td>{{ r.name }}</td>',
      '            <td class="mono small">{{ r.cond }}</td>',
      '            <td><span class="dot" :class="lvCls(r.level)"></span>{{ lvCn(r.level) }}</td>',
      '            <td class="mono small">{{ r.from }}</td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="card">',
      '    <div class="card-title">鱼种体长体重参数库（{{ species.length }} 个鱼种）</div>',
      '    <div class="hint" style="margin-bottom:10px">',
      '      生长估算用的是水产界标准幂函数 <b>W(g) = a × L(cm)<sup>b</sup></b>。',
      '      每条参数都有出处 —— <b>用前必须核对「体长类型」</b>：',
      '      全长 TL / 叉长 FL / 标准长 SL 之间能差 10~20%，口径不一致算出来的体重会系统性偏掉。',
      '      <div v-if="diffLenType" style="margin-top:6px;color:#991B1B">',
      '        🔴 表里有 <b>{{ diffLenType }}</b> 个种的参数是<b>按标准长 SL 拟合</b>的（标了「⚠ 口径不同」）——',
      '        拿全长代入这些公式会算错，必须先换算或另找按 TL 拟合的参数。',
      '      </div>',
      '    </div>',
      '    <div class="dt-wrap" style="max-height:320px">',
      '      <table class="dt">',
      '        <thead><tr>',
      '          <th>鱼种</th><th>拉丁学名</th><th>a</th><th>b</th>',
      '          <th>体长类型</th><th>证据等级</th><th>出处</th>',
      '        </tr></thead>',
      '        <tbody>',
      '          <tr v-for="s in species" :key="s.species_cn">',
      '            <td><b>{{ s.species_cn }}</b></td>',
      '            <td class="small" style="font-style:italic">{{ s.species_latin }}</td>',
      '            <td class="mono">{{ s.lw_a }}</td>',
      '            <td class="mono">{{ s.lw_b }}</td>',
      '            <td class="small">{{ lenTypeCn(s.length_type) }}',
      '              <b v-if="s.length_type && s.length_type !== \'total length\'"',
      '                 style="color:#991B1B" title="该参数按标准长/叉长拟合，不能直接代全长">',
      '                ⚠ 口径不同',
      '              </b>',
      '            </td>',
      '            <td class="small" :style="{ color: s.used_source === \'原始研究\' ? \'#166534\' : \'#92400E\', fontWeight: s.used_source === \'原始研究\' ? 600 : 400 }">',
      '              {{ s.evidence_cn || \'—\' }}',
      '            </td>',
      '            <td class="small">',
      '              <a v-if="s.source_url" :href="s.source_url" target="_blank" rel="noopener">',
      '                {{ s.source_ref || \'FishBase\' }} ↗',
      '              </a>',
      '              <span v-else>{{ s.source_ref || \'FishBase\' }}</span>',
      '            </td>',
      '          </tr>',
      '          <tr v-if="!species.length">',
      '            <td colspan="7" class="muted small">',
      '              参数库需要后端 —— 请双击 <b>启动平台.bat</b> 打开。',
      '              纯前端演示模式下不提供，因为参数必须带文献出处，不能凭空生成。',
      '            </td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  /* ==========================================================================
     管理板块 —— 养殖生产视角（场长用）
     ==========================================================================
     与「跨板块 · 参数配置」的分工：
       参数配置 = 阈值/规则（工程师改，很少动）
       管理板块 = 哪个网箱养什么鱼、放了多少、设备标定到没到期（每批鱼都变）

     这一块是「配置驱动」的落点 ——
       网箱说"我养大黄鱼" → 水温阈值 25.5/28.0℃、体长体重参数 a/b 全平台自动取值。
       改一处，全平台跟着变。这正是踩过两次硬编码坑（0.0218、20.5℃）之后要根治的事。
     ========================================================================== */

})(window);
