// ============ 调校场（lab.html 专用，不进正式游戏）============
// 用真游戏代码跑"不死擂台"单挑对峙：这里调出来的参数就是游戏参数，零转译。
// 流程：选场景 → 拖滑杆实时看效果 → 「复制参数」把 JSON 发给 Claude 固化进正式版。
(function () {
  const LAB = { me: null, foe: null, foeFight: true, scene: "dao" };

  const SCENES = {
    dao:   { label: "刀 vs 卒", me: { id: "dao",   col: 2, row: 4 }, foe: { col: 2, row: 3 } },
    qiang: { label: "枪 vs 卒", me: { id: "qiang", col: 2, row: 4 }, foe: { col: 2, row: 3 } },
    gong:  { label: "弓 vs 卒", me: { id: "gong",  col: 2, row: 5 }, foe: { col: 2, row: 0 } },
    qi:    { label: "骑 vs 卒", me: { id: "qi",    col: 2, row: 4 }, foe: { col: 2, row: 3 } },
  };

  function clearStage() {
    units = [];
    popups.length = 0; activeFx.length = 0; projectiles.length = 0;
    shreds.length = 0; ghosts.length = 0; inkSlashes.length = 0;
    weaponDoodles.length = 0; inkBursts.length = 0; inkSpecks.length = 0;
    phase = "fight"; tutorialHold = false; battleSlowUntil = 0;
    spawnQueue = []; wave = 1; waveTotal = 999;
    nextWaveAt = 9e12; nextSpawnAt = 9e12;
    stopBgm();
    const b = document.getElementById("banner");
    if (b) b.classList.remove("show");
  }

  function startDuel(key) {
    LAB.scene = key;
    clearStage();
    const sc = SCENES[key];
    const cc = CLASS_CHARS.find(c => c.id === sc.me.id);
    const me = makeUnit(defOfClassChar(cc), "me", sc.me.col, sc.me.row);
    const foe = makeUnit(defOfFoeType(FOE_TYPES[0]), "foe", sc.foe.col, sc.foe.row);
    me.maxHp = me.hp = 9e6; foe.maxHp = foe.hp = 9e6;   // 不死擂台：只看手感不看数值
    me.nextActAt = performance.now() + 500;
    units.push(me, foe);
    LAB.me = me; LAB.foe = foe;
    applyFoeFight();
    refreshStats();
    document.querySelectorAll("#labPanel .sceneBtn").forEach(b =>
      b.classList.toggle("on", b.dataset.scene === key));
  }

  function applyFoeFight() {
    if (!LAB.foe) return;
    LAB.foe.nextActAt = LAB.foeFight ? performance.now() + 700 : 9e12;
  }

  // ---------- 可调参数表（get/set 直连游戏内实参）----------
  const KNOBS = [
    { g: "刀光 slash", items: [
      { label: "时长", unit: "ms", min: 300, max: 1800, step: 50,
        get: () => FX_TRACKS.slash.dur, set: v => FX_TRACKS.slash.dur = v },
      { label: "大小", unit: "px", min: 60, max: 200, step: 4,
        get: () => FX_TRACKS.slash.size, set: v => FX_TRACKS.slash.size = v },
    ] },
    { g: "枪芒 stab", items: [
      { label: "时长", unit: "ms", min: 300, max: 1800, step: 50,
        get: () => FX_TRACKS.stab.dur, set: v => FX_TRACKS.stab.dur = v },
      { label: "大小", unit: "px", min: 60, max: 200, step: 4,
        get: () => FX_TRACKS.stab.size, set: v => FX_TRACKS.stab.size = v },
    ] },
    { g: "弓箭 arrow", items: [
      { label: "大小", unit: "px", min: 30, max: 130, step: 2,
        get: () => FX_TRACKS.arrow.size, set: v => FX_TRACKS.arrow.size = v },
      { label: "箭速", unit: "x", min: 0.5, max: 3, step: 0.1,
        get: () => FX_TRACKS.arrow.speed, set: v => FX_TRACKS.arrow.speed = v },
    ] },
    { g: "蹄尘 hoof（骑移动）", items: [
      { label: "时长", unit: "ms", min: 300, max: 1800, step: 50,
        get: () => FX_TRACKS.hoof.dur, set: v => FX_TRACKS.hoof.dur = v },
      { label: "大小", unit: "px", min: 50, max: 160, step: 4,
        get: () => FX_TRACKS.hoof.size, set: v => FX_TRACKS.hoof.size = v },
    ] },
    { g: "节奏", items: [
      { label: "攻击间隔", unit: "ms", min: 400, max: 2400, step: 50,
        get: () => RT_DELAY.attack, set: v => RT_DELAY.attack = v },
    ] },
  ];

  function paramsJSON() {
    return JSON.stringify({
      slash: { dur: FX_TRACKS.slash.dur, size: FX_TRACKS.slash.size },
      stab: { dur: FX_TRACKS.stab.dur, size: FX_TRACKS.stab.size },
      arrow: { size: FX_TRACKS.arrow.size, speed: FX_TRACKS.arrow.speed },
      hoof: { dur: FX_TRACKS.hoof.dur, size: FX_TRACKS.hoof.size },
      attackDelay: RT_DELAY.attack,
    }, null, 2);
  }

  // ---------- 面板 ----------
  const style = document.createElement("style");
  style.textContent = `
    #labPanel {
      position: fixed; right: 10px; top: 54px; z-index: 99; width: 236px;
      background: rgba(24,23,18,.96); border: 1px solid #746446; border-radius: 12px;
      color: #e6d9ba; font: 12px/1.5 -apple-system, "PingFang SC", sans-serif;
      padding: 10px 12px; box-shadow: 0 10px 40px rgba(0,0,0,.5);
      max-height: calc(100vh - 70px); overflow-y: auto;
    }
    #labPanel h3 { margin: 0 0 6px; font-size: 13px; color: #f0dfae; letter-spacing: 2px; }
    #labPanel .grp { margin: 8px 0 2px; color: #b8a670; font-weight: 600; }
    #labPanel .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
    #labPanel .row label { flex: 0 0 52px; color: #cbbf9e; }
    #labPanel .row input[type=range] { flex: 1; accent-color: #c7a355; }
    #labPanel .row .val { flex: 0 0 58px; text-align: right; color: #f0dfae; font-variant-numeric: tabular-nums; }
    #labPanel .sceneBtn, #labPanel .act {
      border: 1px solid #766646; border-radius: 7px; background: #2a2821; color: #d7c8aa;
      font: 600 12px/1 inherit; padding: 7px 9px; cursor: pointer; margin: 2px 3px 2px 0;
    }
    #labPanel .sceneBtn.on { background: #e7dcc5; color: #30291d; border-color: #c7a355; }
    #labPanel .act.primary { background: #e7dcc5; color: #30291d; border-color: #c7a355; width: 100%; margin-top: 8px; padding: 9px 0; }
    #labPanel .chk { margin: 5px 0; display: flex; gap: 6px; align-items: center; }
    #labToggle {
      position: fixed; right: 10px; top: 12px; z-index: 100;
      border: 1px solid #c7a355; border-radius: 8px; background: #2a2821; color: #f0dfae;
      font: 600 13px/1 -apple-system, "PingFang SC", sans-serif; padding: 8px 12px; cursor: pointer;
    }
    #labPanel.hide { display: none; }
    #labCopyTip { color: #8fbf7a; margin-left: 8px; }
  `;
  document.head.appendChild(style);

  const P = document.createElement("div");
  P.id = "labPanel";
  let html = `<h3>调 校 场</h3><div>`;
  for (const [key, sc] of Object.entries(SCENES)) {
    html += `<button class="sceneBtn" data-scene="${key}">${sc.label}</button>`;
  }
  html += `</div>`;
  KNOBS.forEach((grp, gi) => {
    html += `<div class="grp">${grp.g}</div>`;
    grp.items.forEach((it, ii) => {
      const v = it.get();
      html += `<div class="row"><label>${it.label}</label>
        <input type="range" id="k_${gi}_${ii}" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}">
        <span class="val" id="v_${gi}_${ii}">${v}${it.unit}</span></div>`;
    });
  });
  html += `
    <div class="chk"><input type="checkbox" id="labFoe" checked><label for="labFoe">敌方还手（对峙感）</label></div>
    <div class="chk"><input type="checkbox" id="labSnd" checked><label for="labSnd">音效</label></div>
    <button class="act primary" id="labCopy">复制当前参数 → 发给 Claude</button>
    <span id="labCopyTip"></span>`;
  P.innerHTML = html;
  document.body.appendChild(P);

  const T = document.createElement("button");
  T.id = "labToggle"; T.textContent = "⚙ 调参";
  T.onclick = () => P.classList.toggle("hide");
  document.body.appendChild(T);
  if (window.innerWidth < 700) P.classList.add("hide");   // 手机默认收起

  KNOBS.forEach((grp, gi) => grp.items.forEach((it, ii) => {
    const s = document.getElementById(`k_${gi}_${ii}`);
    const val = document.getElementById(`v_${gi}_${ii}`);
    s.oninput = () => { it.set(+s.value); val.textContent = s.value + it.unit; };
  }));
  P.querySelectorAll(".sceneBtn").forEach(b => b.onclick = () => startDuel(b.dataset.scene));
  document.getElementById("labFoe").onchange = e => { LAB.foeFight = e.target.checked; applyFoeFight(); };
  document.getElementById("labSnd").onchange = e => { soundOn = e.target.checked; if (!soundOn) stopBgm(); };
  document.getElementById("labCopy").onclick = async () => {
    const tip = document.getElementById("labCopyTip");
    try { await navigator.clipboard.writeText(paramsJSON()); tip.textContent = "已复制✓"; }
    catch (e) { window.prompt("手动复制：", paramsJSON()); }
    setTimeout(() => tip.textContent = "", 1800);
  };

  // 等游戏启动完毕（资产+字体异步加载）再开擂台
  const boot = setInterval(() => {
    if (typeof units !== "undefined" && document.getElementById("banner")) {
      clearInterval(boot);
      setTimeout(() => startDuel("dao"), 500);
    }
  }, 200);
})();
