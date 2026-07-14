"use strict";
/* ================= 三国自走棋 v4（V2：羁绊/武将/经验/装备） =================
   对局：15回合生存战。商店(具名武将) → 三合一升星 → 羁绊加成 → 自动战斗
   羁绊：势力(魏/蜀/吴/群) × 职业(步/骑/弓/道/武)，按场上不重名武将数激活
   经济：工资5+利息+连胜奖；4金买4经验，等级=人口上限
   装备：3/6/9/12/15回合胜利掉落，点装备再点棋子穿戴（每人2件）
   素材：《曹操传》雪碧图/头像/魔法特效plist/物品图标/音效BGM
   帧序：移动条 f0-1下 f2-3上 f4-5左 f6/7/8站 f9-10亡；攻击条 a0-3下 a4-7上 a8-11左；右=左镜像
========================================================================== */

// ---------- 常量（竖版：敌方上3行，我方下3行部署）----------
const COLS = 6, ROWS = 9, TILE = 64;
const DEPLOY_ROWS = 3;
const MAX_ROUND = 15;
const BENCH_SIZE = 6;
// 逐个行动的节奏：每种动作的停留时长(ms)
const ACT_WAIT = { skill: 620, attack: 420, move: 220, idle: 40 };
let speedMult = 1;        // 加速开关：1 → 0.5
let battleCycles = 0;     // 全场行动轮数，超过10轮伤害递增（加时决胜）
const SPR = 48, ATK_SPR = 64;
const RAGE_MAX = 100, RAGE_START = 40;
const STAR_MULT = { 1: 1, 2: 1.9, 3: 3.4 };

const BENCH_TILE = 56, BENCH_GAP = 8;
const BENCH_X0 = (COLS * TILE - (BENCH_SIZE * BENCH_TILE + (BENCH_SIZE - 1) * BENCH_GAP)) / 2;
const BENCH_Y0 = ROWS * TILE + 12;
const CANVAS_H = BENCH_Y0 + BENCH_TILE + 6;

const MOVE_FRAMES  = { down: [0, 1], up: [2, 3], left: [4, 5], right: [4, 5] };
const STAND_FRAMES = { down: 6, up: 7, left: 8, right: 8 };
const DEAD_FRAMES  = [9, 10];
const ATK_FRAMES   = { down: [0, 1, 2, 3], up: [4, 5, 6, 7], left: [8, 9, 10, 11], right: [8, 9, 10, 11] };

// ---------- 职业（战斗数值与技能载体）----------
const CLASSES = {
  infantry: { name: "步兵",   hp: 150, atk: 15, def: 10, rng: 1, step: 1, skill: "旋风斩" },
  cavalry:  { name: "骑兵",   hp: 120, atk: 19, def: 7,  rng: 1, step: 2, skill: "冲锋" },
  archer:   { name: "弓兵",   hp: 75,  atk: 16, def: 3,  rng: 3, step: 1, skill: "连珠箭" },
  priest:   { name: "道士",   hp: 70,  atk: 9,  def: 3,  rng: 2, step: 1, heal: 13, skill: "大补给" },
  brawler:  { name: "武道家", hp: 95,  atk: 10, def: 5,  rng: 1, step: 1, hits: 2, dodge: 0.20, skill: "连环拳" },
};
const COUNTERS = {
  infantry: ["cavalry"], cavalry: ["archer", "priest"],
  archer: ["infantry", "brawler"], priest: [], brawler: ["priest"],
  commander: [],   // 主帅技能伤害无克制
};

// ---------- 棋子池：5基础兵（常规版：武将不上场，做场外主帅）----------
const ROSTER = [
  { id: "daodun",   name: "刀盾兵", cls: "infantry", cost: 1, pool: true, head: "18",  anim: { me: "1",   foe: "3"   } },
  { id: "wuzhe",    name: "武者",   cls: "brawler",  cost: 1, pool: true, head: "103", anim: { me: "43",  foe: "45"  } },
  { id: "gongshou", name: "弓手",   cls: "archer",   cost: 2, pool: true, head: "19",  anim: { me: "19",  foe: "21"  } },
  { id: "fangshi",  name: "方士",   cls: "priest",   cost: 2, pool: true, head: "46",  anim: { me: "88",  foe: "90"  } },
  { id: "tieqi",    name: "铁骑",   cls: "cavalry",  cost: 3, pool: true, head: "55",  anim: { me: "16",  foe: "18"  } },
];
const R_MAP = Object.fromEntries(ROSTER.map(r => [r.id, r]));

// ---------- 主帅（场外统军：被动光环 + 能量大招手动释放）----------
const COMMANDERS = {
  guanyu:    { name: "关羽",   head: "13",  passiveDesc: "全军攻击+10%",     skillName: "青龙斩",   skillDesc: "横劈敌方兵力最多的一行" },
  zhangfei:  { name: "张飞",   head: "40",  passiveDesc: "全军血量+12%",     skillName: "燕人咆哮", skillDesc: "全场敌人眩晕一轮" },
  zhaoyun:   { name: "赵云",   head: "41",  passiveDesc: "全军暴击+10%",     skillName: "七进七出", skillDesc: "冲击敌方全体" },
  zhugeliang:{ name: "诸葛亮", head: "42",  passiveDesc: "全军怒气获取+30%", skillName: "锦囊妙计", skillDesc: "全军回血30%并充能" },
  lvbu:      { name: "吕布",   head: "126", passiveDesc: "全军攻+6%防+2",    skillName: "无双乱舞", skillDesc: "随机轰击敌人5次" },
};
let commander = null;
let cmdEnergy = 0;   // 战斗中积攒，满100手动释放

// ---------- 羁绊：职业数量 ----------
const SYNERGIES = [
  { key: "infantry", type: "cls", th: [2, 3], desc: ["步兵防御+4", "步兵防御+8"] },
  { key: "cavalry",  type: "cls", th: [2, 4], desc: ["骑兵攻击+15%", "骑兵攻击+35%"] },
  { key: "archer",   type: "cls", th: [2, 3], desc: ["弓兵射程+1攻+10%", "弓兵射程+1攻+25%"] },
  { key: "priest",   type: "cls", th: [2, 3], desc: ["道士技能+35%", "道士技能+70%"] },
  { key: "brawler",  type: "cls", th: [2, 4], desc: ["武道家连击+1", "武道家连击+2"] },
];

// ---------- 装备（图标=原版物品编号）----------
const ITEMS = {
  sword: { name: "精钢大剑", icon: "1",  desc: "攻击+20%" },
  armor: { name: "连环铠", icon: "46", desc: "血量+20% 防御+3" },
  horse: { name: "的卢", icon: "63", desc: "移动+1 先手" },
  book:  { name: "孙子兵法", icon: "73", desc: "怒气获取+60%" },
};

// ---------- 等级/经验 ----------
const LEVEL_MAX = 10;               // 人口：开局5 → 后期10
const XP_NEED = { 5: 8, 6: 12, 7: 16, 8: 20, 9: 24 };
const SHOP_ODDS = {   // 各等级刷出 1/2/3/4 费的概率(%)
  5: [60, 28, 10, 2], 6: [50, 30, 15, 5], 7: [40, 32, 20, 8],
  8: [32, 30, 26, 12], 9: [26, 28, 29, 17], 10: [20, 26, 32, 22],
};

const FX_NEEDED = ["Meff_3", "Meff_4", "Meff_5", "Meff_13"];

// ---------- 资源 ----------
const images = {}, effects = {}, itemImgs = {};
function loadRawImage(src) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { console.warn("图片缺失:", src); res(null); };
    im.src = src;
  });
}
function loadKeyedImage(src) {
  return loadRawImage(src).then(im => {
    if (!im) return null;
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    const idata = g.getImageData(0, 0, c.width, c.height);
    const d = idata.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) d[i + 3] = 0;
    }
    g.putImageData(idata, 0, 0);
    return c;
  });
}
const parseRect = s => s.match(/-?\d+/g).map(Number);
async function loadEffect(name) {
  const [xml, img] = await Promise.all([
    fetch(`assets/fx/${name}.plist`).then(r => r.text()),
    loadRawImage(`assets/fx/${name}.png`),
  ]);
  if (!img) return [];
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const framesDict = doc.querySelector("dict > dict");
  const keys = framesDict.querySelectorAll(":scope > key");
  const frames = [];
  for (const k of keys) {
    const d = k.nextElementSibling;
    const get = n => {
      const kk = Array.from(d.querySelectorAll(":scope > key")).find(x => x.textContent === n);
      return kk && kk.nextElementSibling;
    };
    const [fx, fy, fw, fh] = parseRect(get("frame").textContent);
    const rotated = get("rotated").tagName === "true";
    const [ox, oy] = parseRect(get("sourceColorRect").textContent);
    const [sw, sh] = parseRect(get("sourceSize").textContent);
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    const g = c.getContext("2d");
    if (rotated) {
      g.translate(ox + fw / 2, oy + fh / 2);
      g.rotate(-Math.PI / 2);
      g.drawImage(img, fx, fy, fh, fw, -fh / 2, -fw / 2, fh, fw);
    } else {
      g.drawImage(img, fx, fy, fw, fh, ox, oy, fw, fh);
    }
    const num = parseInt((k.textContent.match(/_(\d+)\.png$/) || [0, 0])[1], 10);
    frames.push({ num, c });
  }
  frames.sort((a, b) => a.num - b.num);
  return frames.map(f => f.c);
}
async function loadAssets() {
  const jobs = [];
  const animIds = new Set();
  for (const r of ROSTER) { animIds.add(r.anim.me); animIds.add(r.anim.foe); }
  for (const id of animIds) {
    jobs.push(loadKeyedImage(`assets/move/${id}.png`).then(im => images[`m${id}`] = im));
    jobs.push(loadKeyedImage(`assets/attack/${id}.png`).then(im => images[`a${id}`] = im));
  }
  for (const n of FX_NEEDED) jobs.push(loadEffect(n).then(f => effects[n] = f));
  for (const [k, it] of Object.entries(ITEMS)) {
    jobs.push(loadKeyedImage(`assets/items/${it.icon}.png`).then(im => itemImgs[k] = im));
  }
  await Promise.all(jobs);
}

// ---------- 音频 ----------
let soundOn = true, bgm = null, actx = null;
function playSfx(file, vol = 0.7) {
  if (!soundOn) return;
  const a = new Audio(`assets/sfx/${file}.wav`);
  a.volume = vol;
  a.play().catch(() => {});
}
function startBgm() {
  if (!soundOn || bgm) return;
  bgm = new Audio("assets/sfx/battle_bgm.mp3");
  bgm.loop = true; bgm.volume = 0.32;
  bgm.play().catch(() => {});
}
function stopBgm() { if (bgm) { bgm.pause(); bgm = null; } }
function thock(freq = 160, dur = 0.07, vol = 0.25) {
  if (!soundOn) return;
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = "triangle"; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur);
}

// ---------- 对局状态 ----------
let phase = "pick";          // pick(点将) | shop | fight | over
let round = 1, playerHp = 100, gold = 12;
let level = 5, xp = 0;
let winStreak = 0, loseStreak = 0;
let units = [];
let bench = new Array(BENCH_SIZE).fill(null);
let shop = new Array(5).fill(null);
let inventory = [];              // 装备库：item key 数组
let selected = null, selItem = -1;
let fieldSnapshot = null;
let uidSeq = 0, fightToken = 0;

const popups = [], activeFx = [], projectiles = [];
let shake = { mag: 0, until: 0 };

const cv = document.getElementById("cv");
cv.width = COLS * TILE; cv.height = CANVAS_H;
const ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = false;

const popCap = () => level;
const fieldUnits = () => units.filter(u => u.side === "me" && u.state !== "dead");
const fieldCount = () => fieldUnits().length;
const interest = () => Math.min(5, Math.floor(gold / 10));
const sellValue = u => u.R.cost * Math.pow(3, u.star - 1);

// ---------- 单位 ----------
function makeUnit(rosterId, side, col, row, star = 1, items = []) {
  const R = R_MAP[rosterId], C = CLASSES[R.cls];
  const m = STAR_MULT[star] * (1 + (R.cost - 1) * 0.18);
  const base = {
    hp: Math.round(C.hp * m), atk: Math.round(C.atk * m),
    def: C.def + (R.cost >= 3 ? 1 : 0), rng: C.rng, step: C.step,
    hits: C.hits || 1, dodge: C.dodge || 0, heal: C.heal ? Math.round(C.heal * m) : 0,
  };
  const u = {
    uid: ++uidSeq, rosterId, R, cls: R.cls, C, side, star,
    col, row, x: col, y: row,
    base, items: items.slice(0, 2),
    rage: RAGE_START, stun: 0,
    dir: side === "me" ? "up" : "down",
    state: "stand", animStart: 0, deadAt: 0, flashUntil: 0,
  };
  bakeStats(u, null);
  u.hp = u.maxHp;
  return u;
}
// 把 羁绊buff+装备 烘焙成实际战斗数值（syn 为 null 时仅算装备）
function bakeStats(u, syn) {
  let atkM = 0, hpM = 0, defA = 0, dodgeA = 0, critA = 0, rageM = 1, rngA = 0, hitsA = 0, stepA = 0, skillM = 1;
  for (const k of u.items) {
    if (k === "sword") atkM += 0.20;
    if (k === "armor") { hpM += 0.20; defA += 3; }
    if (k === "horse") stepA += 1;
    if (k === "book") rageM += 0.6;
  }
  // 主帅被动光环（仅我方）
  if (u.side === "me" && commander) {
    if (commander === "guanyu") atkM += 0.10;
    if (commander === "zhangfei") hpM += 0.12;
    if (commander === "zhaoyun") critA += 0.10;
    if (commander === "zhugeliang") rageM += 0.3;
    if (commander === "lvbu") { atkM += 0.06; defA += 2; }
  }
  if (syn) {
    const t = (key) => syn[key] || 0;   // 0未激活 1低档 2高档
    if (u.cls === "infantry" && t("infantry")) defA += t("infantry") === 1 ? 4 : 8;
    if (u.cls === "cavalry" && t("cavalry")) atkM += t("cavalry") === 1 ? 0.15 : 0.35;
    if (u.cls === "archer" && t("archer")) { rngA += 1; atkM += t("archer") === 1 ? 0.10 : 0.25; }
    if (u.cls === "priest" && t("priest")) skillM += t("priest") === 1 ? 0.35 : 0.70;
    if (u.cls === "brawler" && t("brawler")) hitsA += t("brawler") === 1 ? 1 : 2;
  }
  const hpRatio = u.maxHp ? u.hp / u.maxHp : 1;
  u.atk = Math.round(u.base.atk * (1 + atkM));
  u.maxHp = Math.round(u.base.hp * (1 + hpM));
  u.hp = Math.round(u.maxHp * hpRatio);
  u.def = u.base.def + defA;
  u.dodge = u.base.dodge + dodgeA;
  u.crit = 0.12 + critA;
  u.rageMul = rageM;
  u.rng = u.base.rng + rngA;
  u.step = u.base.step + stepA;
  u.hits = u.base.hits + hitsA;
  u.heal = Math.round(u.base.heal * skillM);
  u.skillMult = skillM;
}
const alive = side => units.filter(u => u.state !== "dead" && (!side || u.side === side));
const dist = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const cheby = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
function faceTo(u, c, r) {
  const dc = c - u.col, dr = r - u.row;
  u.dir = Math.abs(dc) >= Math.abs(dr) ? (dc >= 0 ? "right" : "left") : (dr >= 0 ? "down" : "up");
}
function popup(u, text, color, big) {
  popups.push({ x: u.col, y: u.row, text, color, born: performance.now(), big });
}
function spawnFx(name, col, row, scale = 1.4) {
  if (effects[name] && effects[name].length) {
    activeFx.push({ frames: effects[name], col, row, born: performance.now(), scale });
  }
}
function doShake(mag) {
  shake.mag = Math.max(shake.mag, mag);
  shake.until = performance.now() + 320;
}

// ---------- 羁绊计算 ----------
function synergyCounts(sideUnits) {
  const cls = {};
  const seen = new Set();
  for (const u of sideUnits) {
    if (seen.has(u.rosterId)) continue;
    seen.add(u.rosterId);
    cls[u.cls] = (cls[u.cls] || 0) + 1;
  }
  return { cls };
}
function synergyTiers(sideUnits) {
  const { cls } = synergyCounts(sideUnits);
  const tiers = {};
  for (const s of SYNERGIES) {
    const n = cls[s.key] || 0;
    tiers[s.key] = n >= s.th[1] ? 2 : n >= s.th[0] ? 1 : 0;
  }
  return tiers;
}
function applyFightBuffs() {
  for (const side of ["me", "foe"]) {
    const su = alive(side);
    const tiers = synergyTiers(su);
    for (const u of su) bakeStats(u, tiers);
  }
}

// ---------- 战斗结算 ----------
function gainRage(u, amount) {
  if (u.state === "dead") return;
  u.rage = Math.min(RAGE_MAX, u.rage + amount * (u.rageMul || 1));
}
function dealDamage(att, tgt, mult, opt = {}) {
  if (tgt.state === "dead") return;
  if (tgt.dodge && Math.random() < tgt.dodge && !opt.noDodge) {
    popup(tgt, "闪避", "#9adcff");
    return;
  }
  const counter = COUNTERS[att.cls].includes(tgt.cls);
  const crit = Math.random() < (att.crit || 0.12);
  let dmg = Math.max(3, att.atk * mult * 1.3 - (opt.trueDmg ? 0 : tgt.def * 0.5));
  dmg *= (0.9 + Math.random() * 0.2);
  dmg *= 1 + Math.max(0, battleCycles - 10) * 0.15;   // 加时决胜

  if (counter) dmg *= 1.35;
  if (crit) dmg *= 1.8;
  dmg = Math.round(dmg);
  tgt.hp -= dmg;
  tgt.flashUntil = performance.now() + 130;
  gainRage(tgt, 16);
  if (tgt.side === "me") gainCmdEnergy(5);
  const label = (counter ? "克制 " : "") + (crit ? "暴击 " : "-") + dmg;
  popup(tgt, label, counter ? "#ffa245" : crit ? "#ffd24a" : "#ff7a5a", counter || crit);
  if (crit) doShake(3);
  thock(crit ? 110 : 160);
  if (tgt.hp <= 0) {
    tgt.hp = 0; tgt.state = "dead"; tgt.deadAt = performance.now();
    thock(70, 0.18, 0.3);
  }
}
function knockback(att, tgt) {
  if (tgt.state === "dead") return;
  const dc = Math.sign(tgt.col - att.col), dr = Math.sign(tgt.row - att.row);
  const nc = tgt.col + dc, nr = tgt.row + dr;
  if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
  if (alive().some(u => u !== tgt && u.col === nc && u.row === nr)) return;
  tgt.col = nc; tgt.row = nr;
}
function shootArrow(att, tgt, mult) {
  const now = performance.now();
  projectiles.push({
    x0: att.col, y0: att.row, x1: tgt.col, y1: tgt.row,
    born: now, dur: 90 * dist(att, tgt) + 60, done: false,
    onHit: () => dealDamage(att, tgt, mult),
  });
  thock(320, 0.05, 0.15);
}

// ---------- 寻路 ----------
function bfsNextStep(unit, goalCells) {
  const occupied = new Set(alive().filter(u => u !== unit).map(u => u.col + "," + u.row));
  const goals = new Set(goalCells.map(([c, r]) => c + "," + r));
  const prev = new Map();
  const q = [[unit.col, unit.row]];
  prev.set(unit.col + "," + unit.row, null);
  while (q.length) {
    const [c, r] = q.shift();
    if (goals.has(c + "," + r)) {
      let cur = c + "," + r, back = prev.get(cur);
      while (back && prev.get(back) !== null) { cur = back; back = prev.get(cur); }
      const [nc, nr] = cur.split(",").map(Number);
      return { c: nc, r: nr };
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr, k = nc + "," + nr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS || prev.has(k) || occupied.has(k)) continue;
      prev.set(k, c + "," + r);
      q.push([nc, nr]);
    }
  }
  return null;
}
function stepToward(u, foes, maxStep) {
  const goals = [];
  for (const f of foes) {
    for (let dc = -u.rng; dc <= u.rng; dc++) {
      const rest = u.rng - Math.abs(dc);
      for (let dr = -rest; dr <= rest; dr++) {
        const c = f.col + dc, r = f.row + dr;
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) goals.push([c, r]);
      }
    }
  }
  let moved = false;
  for (let s = 0; s < maxStep; s++) {
    const nxt = bfsNextStep(u, goals);
    if (!nxt) break;
    faceTo(u, nxt.c, nxt.r);
    u.col = nxt.c; u.row = nxt.r;
    moved = true;
    if (foes.some(f => dist(u, f) <= u.rng)) break;
  }
  return moved;
}

// ---------- 技能 ----------
function announce(u, name, color) {
  // 名将使用专属技能名
  popup(u, u.R.name + "【" + (u.R.skillName || name) + "】", color || (u.R.hero ? "#ffb830" : "#ffd24a"), true);
}
const SKILLS = {
  infantry(u, foes) {
    const targets = foes.filter(f => cheby(u, f) <= 1);
    if (!targets.length) return false;
    announce(u, "旋风斩");
    playSfx("Se_m_04");
    spawnFx("Meff_3", u.col, u.row, 1.9);
    u.state = "attack"; u.animStart = performance.now();
    doShake(5);
    for (const f of targets) { dealDamage(u, f, 1.5); knockback(u, f); }
    return true;
  },
  cavalry(u, foes) {
    const far = foes.filter(f => dist(u, f) >= 2).sort((a, b) => dist(u, a) - dist(u, b))[0];
    const tgt = far || foes.sort((a, b) => dist(u, a) - dist(u, b))[0];
    if (!tgt) return false;
    announce(u, "冲锋");
    playSfx("Se_m_28");
    spawnFx("Meff_13", u.col, u.row, 1.5);
    const goals = [];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = tgt.col + dc, r = tgt.row + dr;
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) goals.push([c, r]);
    }
    for (let s = 0; s < 4 && dist(u, tgt) > 1; s++) {
      const nxt = bfsNextStep(u, goals);
      if (!nxt) break;
      faceTo(u, nxt.c, nxt.r);
      u.col = nxt.c; u.row = nxt.r;
    }
    if (dist(u, tgt) <= 1) {
      faceTo(u, tgt.col, tgt.row);
      u.state = "attack"; u.animStart = performance.now();
      doShake(8);
      dealDamage(u, tgt, 2.2);
      knockback(u, tgt);
      if (tgt.state !== "dead") { tgt.stun = 1; popup(tgt, "晕眩", "#e8c8ff"); }
    }
    return true;
  },
  archer(u, foes) {
    const inR = foes.filter(f => dist(u, f) <= u.rng + 2).sort((a, b) => dist(u, a) - dist(u, b));
    if (!inR.length) return false;
    announce(u, "连珠箭");
    u.state = "attack"; u.animStart = performance.now();
    faceTo(u, inR[0].col, inR[0].row);
    for (let i = 0; i < 3; i++) {
      const tgt = inR[i % inR.length];
      setTimeout(() => { if (tgt.state !== "dead" && u.state !== "dead") shootArrow(u, tgt, 1.1); }, i * 140);
    }
    return true;
  },
  priest(u, foes) {
    const wounded = alive(u.side).filter(a => a.hp < a.maxHp * 0.75);
    if (wounded.length) {
      announce(u, "大补给", "#7de87d");
      playSfx("Se_m_25");
      u.state = "attack"; u.animStart = performance.now();
      for (const a of alive(u.side)) {
        if (a.hp >= a.maxHp) continue;
        const amt = Math.min(a.maxHp - a.hp, Math.round(a.maxHp * 0.25 * u.skillMult));
        a.hp += amt;
        spawnFx("Meff_5", a.col, a.row, 1.3);
        popup(a, "+" + amt, "#7de87d");
      }
      return true;
    }
    const tgt = foes.filter(f => dist(u, f) <= 4).sort((a, b) => dist(u, a) - dist(u, b))[0];
    if (!tgt) return false;
    announce(u, "爆焰", "#ff9040");
    playSfx("Se_m_01");
    faceTo(u, tgt.col, tgt.row);
    u.state = "attack"; u.animStart = performance.now();
    spawnFx("Meff_4", tgt.col, tgt.row, 1.7);
    doShake(5);
    dealDamage(u, tgt, 2.4 * u.skillMult, { trueDmg: true, noDodge: true });
    return true;
  },
  brawler(u, foes) {
    const tgt = foes.filter(f => dist(u, f) <= 1)[0];
    if (!tgt) return false;
    announce(u, "连环拳");
    playSfx("Se_m_28", 0.4);
    faceTo(u, tgt.col, tgt.row);
    u.state = "attack"; u.animStart = performance.now();
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (tgt.state !== "dead" && u.state !== "dead") {
          dealDamage(u, tgt, 0.55, { noDodge: true });
          if (i === 4) { knockback(u, tgt); doShake(4); }
        }
      }, i * 110);
    }
    return true;
  },
};

// ---------- 单位行动（返回动作类型，决定停顿时长）----------
function unitAct(u) {
  if (u.state === "dead" || phase !== "fight") return "idle";
  if (u.stun > 0) { u.stun--; popup(u, "晕眩中", "#e8c8ff"); return "idle"; }
  const foes = alive(u.side === "me" ? "foe" : "me");
  if (!foes.length) return "idle";

  if (u.rage >= RAGE_MAX) {
    if (SKILLS[u.cls](u, foes)) { u.rage = 0; return "skill"; }
  }
  if (u.heal) {
    const hurt = alive(u.side).filter(a => a !== u && a.hp < a.maxHp && dist(u, a) <= u.rng)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    if (hurt) {
      faceTo(u, hurt.col, hurt.row);
      u.state = "attack"; u.animStart = performance.now();
      hurt.hp = Math.min(hurt.maxHp, hurt.hp + u.heal);
      popup(hurt, "+" + u.heal, "#7de87d");
      gainRage(u, 30);
      return "attack";
    }
  }
  const inRange = foes.filter(f => dist(u, f) <= u.rng).sort((a, b) => dist(u, a) - dist(u, b));
  if (inRange.length) {
    const tgt = inRange[0];
    faceTo(u, tgt.col, tgt.row);
    u.state = "attack"; u.animStart = performance.now();
    if (u.rng > 1) {
      shootArrow(u, tgt, 1);
    } else {
      for (let i = 0; i < u.hits; i++) {
        setTimeout(() => { if (tgt.state !== "dead" && u.state !== "dead") dealDamage(u, tgt, 1); }, i * 130);
      }
    }
    gainRage(u, 26);
    return "attack";
  }
  const moved = stepToward(u, foes, u.step || 1);
  u.state = moved ? "walk" : "stand";
  if (moved) u.animStart = performance.now();
  return moved ? "move" : "idle";
}

// ---------- 逐个行动的战斗主循环（由渲染帧驱动，不受后台定时器限流影响）----------
let actQueue = [], nextActAt = 0;
function checkBattleEnd() {
  if (phase !== "fight") return true;
  const me = alive("me").length, foe = alive("foe").length;
  if (me > 0 && foe > 0) return false;
  phase = "over";
  stopBgm();
  updateCmdBtn();
  playSfx(me > 0 ? "Se_m_28" : "Se_m_19");
  setTimeout(() => endCombat(me > 0), 700);
  return true;
}
function runBattleStep(now) {
  if (phase !== "fight" || now < nextActAt) return;
  while (actQueue.length && actQueue[0].state === "dead") actQueue.shift();
  if (!actQueue.length) {                    // 新一轮
    battleCycles++;
    if (battleCycles === 11) {
      popups.push({ x: COLS / 2 - 0.5, y: 0.5, text: "加时决胜！伤害递增", color: "#ff9040", born: now, big: true });
    }
    actQueue = alive().slice().sort((a, b) => (b.step - a.step) || (a.uid - b.uid));
    if (!actQueue.length) return;
  }
  const u = actQueue.shift();
  u.actingUntil = now + 450 * speedMult;
  const kind = unitAct(u);
  if (u.side === "me" && kind !== "idle") gainCmdEnergy(7);
  refreshStats();
  nextActAt = now + (ACT_WAIT[kind] || 400) * speedMult;
  checkBattleEnd();
}

// ---------- 回合结算 ----------
function endCombat(win) {
  const lines = [];
  if (!win) {
    const foeStars = alive("foe").reduce((s, u) => s + u.star, 0);
    const dmg = 2 + foeStars * 2;
    playerHp -= dmg;
    lines.push(`战败，损失 ${dmg} 点血量（剩 ${Math.max(0, playerHp)}）`);
    winStreak = 0; loseStreak++;
  } else {
    winStreak++; loseStreak = 0;
  }
  const streak = Math.max(winStreak, loseStreak);
  const streakBonus = streak >= 6 ? 3 : streak >= 4 ? 2 : streak >= 2 ? 1 : 0;
  const int = interest();
  const income = 5 + int + streakBonus + (win ? 1 : 0);
  gold += income;
  const parts = ["工资5"];
  if (int) parts.push(`利息${int}`);
  if (win) parts.push("胜利1");
  if (streakBonus) parts.push(`连${win ? "胜" : "败"}${streakBonus}`);
  lines.push(`收入 +${income} 金（${parts.join(" + ")}）`);

  // 掉落：3的倍数回合胜利
  if (win && round % 3 === 0) {
    const keys = Object.keys(ITEMS);
    const k = keys[Math.floor(Math.random() * keys.length)];
    inventory.push(k);
    lines.push(`缴获装备：<b>${ITEMS[k].name}</b>（${ITEMS[k].desc}）`);
    playSfx("Se_m_25", 0.5);
  }
  refreshStats(); renderInv();

  const b = document.getElementById("banner");
  const txt = document.getElementById("bannerText");
  const nextBtn = document.getElementById("next");
  if (playerHp <= 0) {
    txt.textContent = "出 局"; txt.style.color = "#c05040";
    lines.push(`坚持了 ${round} 回合`);
    nextBtn.textContent = "重 新 开 局";
    nextBtn.onclick = () => location.reload();
  } else if (round >= MAX_ROUND && win) {
    txt.textContent = "登 顶"; txt.style.color = "#f0c060";
    lines.push("十五连坐，天下无敌！");
    nextBtn.textContent = "重 新 开 局";
    nextBtn.onclick = () => location.reload();
  } else {
    txt.textContent = win ? "回 合 胜 利" : "回 合 战 败";
    txt.style.color = win ? "#f0c060" : "#c05040";
    nextBtn.textContent = "下 一 回 合";
    nextBtn.onclick = nextRound;
  }
  document.getElementById("bannerSub").innerHTML = lines.join("<br>");
  b.classList.add("show");
}

function nextRound() {
  fightToken++;          // 终止残留的战斗循环
  round++;
  xp += 2;
  levelUpCheck();
  document.getElementById("banner").classList.remove("show");
  units = [];
  for (const s of fieldSnapshot || []) {
    units.push(makeUnit(s.rosterId, "me", s.col, s.row, s.star, s.items));
  }
  popups.length = 0; activeFx.length = 0; projectiles.length = 0;
  spawnEnemies();
  rollShop(true);
  phase = "shop";
  selected = null; selItem = -1;
  setStatus();
  refreshStats(); renderShop(); renderSyn(); renderInv();
}

// ---------- 敌方军团 ----------
function spawnEnemies() {
  // 前期弱后期强：预算缓升，兵力数量随回合解锁（对齐玩家人口 5→10）
  let budget = 5 + Math.round(round * 2.8);
  let countCap = Math.min(10, 3 + Math.ceil(round * 0.5));
  const cells = [];
  for (let c = 0; c < COLS; c++) for (let r = 0; r < DEPLOY_ROWS; r++) cells.push([c, r]);
  cells.sort(() => Math.random() - 0.5);
  // 敌方从与回合相称的基础兵池里抽
  const pool = ROSTER.filter(r => r.pool && r.cost <= Math.min(3, 1 + Math.floor(round / 3)));
  let guard = 60, placed = 0;
  while (budget >= 1 && cells.length && placed < countCap && guard--) {
    const R = pool[Math.floor(Math.random() * pool.length)];
    let star = 1, cost = R.cost;
    if (round >= 9 && budget >= R.cost * 9 && Math.random() < 0.25) { star = 3; cost = R.cost * 9; }
    else if (round >= 4 && budget >= R.cost * 3 && Math.random() < 0.45) { star = 2; cost = R.cost * 3; }
    if (cost > budget) continue;
    const [c, r] = cells.pop();
    budget -= cost;
    placed++;
    units.push(makeUnit(R.id, "foe", c, r, star));
  }
}

// ---------- 商店 / 升星 / 经验 ----------
function rollShop(free) {
  if (!free) {
    if (gold < 2 || phase !== "shop") return;
    gold -= 2;
  }
  const odds = SHOP_ODDS[level];
  for (let i = 0; i < shop.length; i++) {
    let roll = Math.random() * 100, cost = 1;
    for (let c = 0; c < 4; c++) { roll -= odds[c]; if (roll <= 0) { cost = c + 1; break; } }
    if (cost > 3) cost = 3;                    // 商店只有基础兵（1-3费），4费概率并入3费
    const pool = ROSTER.filter(r => r.pool && r.cost === cost);
    shop[i] = pool[Math.floor(Math.random() * pool.length)].id;
  }
  refreshStats(); renderShop();
}
function buyXp() {
  if (phase !== "shop" || gold < 4 || level >= LEVEL_MAX) return;
  gold -= 4; xp += 4;
  levelUpCheck();
  refreshStats(); renderShop();
}
function levelUpCheck() {
  while (level < LEVEL_MAX && xp >= (XP_NEED[level] || 1e9)) {
    xp -= XP_NEED[level];
    level++;
    setStatus(`升到 ${level} 级！人口上限 ${level}`);
    playSfx("Se_m_28", 0.5);
  }
}
function buyFromShop(i) {
  if (phase !== "shop" || !shop[i]) return;
  const R = R_MAP[shop[i]];
  if (gold < R.cost) return;
  const slot = bench.indexOf(null);
  if (slot === -1) { setStatus("备战席已满！"); return; }
  gold -= R.cost;
  bench[slot] = makeUnit(shop[i], "me", null, null, 1);
  const id = shop[i];
  shop[i] = null;
  checkMerge(id, 1);
  refreshStats(); renderShop(); renderSyn();
}
function checkMerge(rosterId, star) {
  if (star >= 3) return;
  const mine = [];
  for (const u of units) if (u.side === "me" && u.rosterId === rosterId && u.star === star && u.state !== "dead") mine.push({ u, from: "field" });
  bench.forEach((u, i) => { if (u && u.rosterId === rosterId && u.star === star) mine.push({ u, from: "bench", idx: i }); });
  if (mine.length < 3) return;
  const three = mine.slice(0, 3);
  const allItems = three.flatMap(x => x.u.items);
  const fieldOne = three.find(x => x.from === "field");
  for (const x of three) {
    if (x.from === "field") units = units.filter(u => u !== x.u);
    else bench[x.idx] = null;
  }
  const keep = allItems.slice(0, 2);
  inventory.push(...allItems.slice(2));
  const nu = makeUnit(rosterId, "me", fieldOne ? fieldOne.u.col : null, fieldOne ? fieldOne.u.row : null, star + 1, keep);
  if (fieldOne) {
    units.push(nu);
    spawnFx("Meff_13", nu.col, nu.row, 1.6);
    popup(nu, nu.R.name + " ★" + nu.star, "#ffd24a", true);
  } else {
    bench[bench.indexOf(null)] = nu;
  }
  playSfx("Se_m_28", 0.5);
  if (selected && three.some(x => x.u === selected)) selected = null;
  checkMerge(rosterId, star + 1);
  setStatus(`${R_MAP[rosterId].name} 升到 ${star + 1} 星！`);
  renderInv();
}
function sellSelected() {
  if (!selected || phase !== "shop") return;
  gold += sellValue(selected);
  inventory.push(...selected.items);       // 装备退回
  units = units.filter(u => u !== selected);
  const bi = bench.indexOf(selected);
  if (bi >= 0) bench[bi] = null;
  selected = null;
  refreshStats(); renderShop(); renderSyn(); renderInv();
}

// ---------- UI ----------
const shopBar = document.getElementById("shopBar");
const slotEls = [];
function buildShopUI() {
  for (let i = 0; i < shop.length; i++) {
    const el = document.createElement("div");
    el.className = "slot";
    el.onclick = () => buyFromShop(i);
    shopBar.appendChild(el);
    slotEls.push(el);
  }
}
function renderShop() {
  slotEls.forEach((el, i) => {
    const id = shop[i];
    if (!id) { el.className = "slot empty"; el.innerHTML = ""; return; }
    const R = R_MAP[id];
    el.className = "slot c" + R.cost + (phase !== "shop" || gold < R.cost ? " locked" : "");
    el.innerHTML = `<img src="assets/head/${R.head}.png">
      <div class="nm">${R.name} <span class="cost">${R.cost}金</span></div>
      <div class="st">${CLASSES[R.cls].name}</div>`;
  });
  document.getElementById("refresh").disabled = phase !== "shop" || gold < 2;
  document.getElementById("buyxp").disabled = phase !== "shop" || gold < 4 || level >= LEVEL_MAX;
}
function renderSyn() {
  const tiers = synergyTiers(fieldUnits());
  const { cls, hero } = synergyCounts(fieldUnits());
  const rows = [];
  for (const s of SYNERGIES) {
    const n = (s.type === "hero" ? hero : cls[s.key]) || 0;
    if (!n) continue;
    const t = tiers[s.key];
    const label = s.type === "hero" ? "名将" : CLASSES[s.key].name;
    const next = t === 2 ? s.th[1] : t === 1 ? s.th[1] : s.th[0];
    rows.push(`<div class="badge ${t ? "on" : ""}" title="${t ? s.desc[t - 1] : "未激活"}">
      ${label} ${n}/${next}${t ? `<small>${s.desc[t - 1]}</small>` : ""}</div>`);
  }
  document.getElementById("synBadges").innerHTML = rows.join("");
}
function renderInv() {
  const row = document.getElementById("invRow");
  row.classList.toggle("show", inventory.length > 0);
  row.innerHTML = "<span>装备▶</span>";
  inventory.forEach((k, i) => {
    const img = document.createElement("img");
    img.src = `assets/items/${ITEMS[k].icon}.png`;
    img.title = ITEMS[k].name + "：" + ITEMS[k].desc;
    img.className = (ITEMS[k].relic ? "relic " : "") + (selItem === i ? "sel" : "");
    img.onclick = () => {
      selItem = selItem === i ? -1 : i;
      selected = null;
      setStatus(selItem >= 0 ? `已选【${ITEMS[k].name}】，点一个棋子穿上` : "");
      renderInv(); refreshStats();
    };
    row.appendChild(img);
  });
}
function refreshStats() {
  document.getElementById("round").textContent = round;
  document.getElementById("php").textContent = Math.max(0, playerHp);
  document.getElementById("gold").textContent = gold;
  document.getElementById("interest").textContent = interest();
  document.getElementById("level").textContent = level;
  document.getElementById("xp").textContent = level >= LEVEL_MAX ? "MAX" : xp + "/" + XP_NEED[level];
  const streakEl = document.getElementById("streak");
  streakEl.textContent = winStreak > 0 ? winStreak + "连胜" : loseStreak > 0 ? loseStreak + "连败" : "—";
  document.getElementById("pop").textContent = fieldCount() + "/" + popCap();
  document.getElementById("fight").disabled = phase !== "shop" || fieldCount() === 0;
  document.getElementById("sell").style.display = selected && phase === "shop" ? "" : "none";
  if (selected) document.getElementById("sell").textContent = `出售 ${selected.R.name}（+${sellValue(selected)}金）`;
}
function setStatus(msg) {
  document.getElementById("statusText").textContent =
    msg || (phase === "shop" ? "买将→点棋子→点下方绿区上场 · 三个同名自动升星" : "战斗进行中……");
}

// ---------- 点击交互 ----------
function canvasPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
}
function benchSlotAt(x, y) {
  if (y < BENCH_Y0 || y > BENCH_Y0 + BENCH_TILE) return -1;
  for (let i = 0; i < BENCH_SIZE; i++) {
    const bx = BENCH_X0 + i * (BENCH_TILE + BENCH_GAP);
    if (x >= bx && x < bx + BENCH_TILE) return i;
  }
  return -1;
}
function tryEquip(u) {
  if (selItem < 0 || !u || u.side !== "me") return false;
  const k = inventory[selItem];
  const it = ITEMS[k];
  if (u.items.length >= 2) { setStatus(`${u.R.name} 已有两件装备`); return true; }
  inventory.splice(selItem, 1);
  u.items.push(k);
  bakeStats(u, null);
  selItem = -1;
  popup(u, "装备" + it.name, "#9adcff", true);
  playSfx("Se_m_25", 0.4);
  setStatus();
  renderInv(); refreshStats();
  return true;
}

// ---------- 主帅技能 ----------
function gainCmdEnergy(n) {
  if (phase !== "fight" || !commander) return;
  cmdEnergy = Math.min(100, cmdEnergy + n);
  updateCmdBtn();
}
function updateCmdBtn() {
  const btn = document.getElementById("cmd");
  if (!btn) return;
  if (!commander || phase !== "fight") { btn.style.display = "none"; return; }
  const c = COMMANDERS[commander];
  btn.style.display = "";
  if (cmdEnergy >= 100) {
    btn.textContent = `⚡ ${c.skillName}！`;
    btn.classList.add("ready");
  } else {
    btn.textContent = `${c.skillName} ${Math.floor(cmdEnergy)}%`;
    btn.classList.remove("ready");
  }
}
function castCommander() {
  if (phase !== "fight" || cmdEnergy < 100 || !commander) return;
  cmdEnergy = 0;
  const c = COMMANDERS[commander];
  const foes = alive("foe");
  if (!foes.length) return;
  const base = 30 + round * 3;
  const att = { atk: base, cls: "commander", crit: 0.15, side: "me", name: c.name };
  popups.push({ x: COLS / 2 - 0.5, y: 4, text: c.name + "【" + c.skillName + "】", color: "#ff9040", born: performance.now(), big: true });
  playSfx("Se_m_06", 0.7);
  doShake(9);
  switch (commander) {
    case "guanyu": {   // 横劈敌人最多的一行
      let bestRow = 0, bestN = -1;
      for (let r = 0; r < ROWS; r++) {
        const n = foes.filter(f => f.row === r).length;
        if (n > bestN) { bestN = n; bestRow = r; }
      }
      for (const f of foes.filter(f => f.row === bestRow)) {
        spawnFx("Meff_3", f.col, f.row, 1.5);
        dealDamage(att, f, 2.2, { noDodge: true });
      }
      break;
    }
    case "zhangfei":
      for (const f of foes) { f.stun = 1; popup(f, "晕眩", "#e8c8ff"); }
      spawnFx("Meff_13", 2, 2, 2.4);
      break;
    case "zhaoyun":
      for (const f of foes) {
        spawnFx("Meff_13", f.col, f.row, 1.1);
        dealDamage(att, f, 1.2, { noDodge: true });
      }
      break;
    case "zhugeliang":
      for (const a of alive("me")) {
        const amt = Math.min(a.maxHp - a.hp, Math.round(a.maxHp * 0.3));
        if (amt > 0) { a.hp += amt; popup(a, "+" + amt, "#7de87d"); }
        gainRage(a, 40);
        spawnFx("Meff_5", a.col, a.row, 1.2);
      }
      break;
    case "lvbu":
      for (let i = 0; i < 5; i++) {
        const f = alive("foe")[Math.floor(Math.random() * alive("foe").length)];
        if (!f) break;
        spawnFx("Meff_4", f.col, f.row, 1.4);
        dealDamage(att, f, 1.8, { noDodge: true });
      }
      break;
  }
  updateCmdBtn();
  refreshStats();
}
// 开局三选一
function showCommanderPick() {
  const b = document.getElementById("banner");
  document.getElementById("bannerText").textContent = "点 将";
  document.getElementById("bannerText").style.color = "#f0c060";
  document.getElementById("bannerSub").innerHTML = "选择你的主帅（被动光环 + 战斗中手动放大招）";
  document.getElementById("next").style.display = "none";
  const pick = document.getElementById("cmdPick");
  pick.innerHTML = "";
  const keys = Object.keys(COMMANDERS).sort(() => Math.random() - 0.5).slice(0, 3);
  for (const key of keys) {
    const c = COMMANDERS[key];
    const el = document.createElement("div");
    el.className = "cmdCard";
    el.innerHTML = `<img src="assets/head/${c.head}.png">
      <b>${c.name}</b>
      <span>${c.passiveDesc}</span>
      <span class="sk">【${c.skillName}】${c.skillDesc}</span>`;
    el.onclick = () => {
      commander = key;
      b.classList.remove("show");
      document.getElementById("next").style.display = "";
      pick.innerHTML = "";
      phase = "shop";
      // 被动立即生效
      for (const u of units) if (u.side === "me") bakeStats(u, null);
      for (const u of bench) if (u) bakeStats(u, null);
      setStatus(`主帅${c.name}就位：${c.passiveDesc}`);
      refreshStats(); renderShop();
    };
    pick.appendChild(el);
  }
  b.classList.add("show");
}
cv.addEventListener("click", e => {
  if (phase !== "shop") return;
  const { x, y } = canvasPos(e);

  const bi = benchSlotAt(x, y);
  if (bi >= 0) {
    const u = bench[bi];
    if (u && tryEquip(u)) return;
    if (u) {
      selected = selected === u ? null : u;
    } else if (selected) {
      const oi = bench.indexOf(selected);
      if (oi >= 0) bench[oi] = null;
      units = units.filter(v => v !== selected);
      selected.col = null; selected.row = null;
      bench[bi] = selected;
      selected = null;
      renderSyn();
    }
    refreshStats(); return;
  }

  const col = Math.floor(x / TILE), row = Math.floor(y / TILE);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const here = units.find(u => u.col === col && u.row === row && u.side === "me");
  if (here && tryEquip(here)) return;
  if (here) {
    selected = selected === here ? null : here;
  } else if (selected && row >= ROWS - DEPLOY_ROWS && !units.some(u => u.col === col && u.row === row)) {
    const fromBench = bench.indexOf(selected) >= 0;
    if (fromBench && fieldCount() >= popCap()) { setStatus(`人口已满（${popCap()}），买经验升级或先撤人`); return; }
    if (fromBench) bench[bench.indexOf(selected)] = null;
    selected.col = col; selected.row = row;
    selected.x = col; selected.y = row;
    if (fromBench) units.push(selected);
    selected = null;
    renderSyn();
  }
  refreshStats();
});

// ---------- 渲染 ----------
function drawBoard() {
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const even = (c + r) % 2 === 0;
    ctx.fillStyle = even ? "#2e4020" : "#293a1d";
    if (phase === "shop" && r >= ROWS - DEPLOY_ROWS) ctx.fillStyle = even ? "#3a4a34" : "#334430";
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  }
  if (phase === "shop") {
    ctx.strokeStyle = "rgba(240,192,96,.5)"; ctx.setLineDash([6, 4]);
    ctx.strokeRect(1, (ROWS - DEPLOY_ROWS) * TILE + 1, COLS * TILE - 2, DEPLOY_ROWS * TILE - 2);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "#20180f";
  ctx.fillRect(0, BENCH_Y0 - 6, cv.width, BENCH_TILE + 12);
  for (let i = 0; i < BENCH_SIZE; i++) {
    const bx = BENCH_X0 + i * (BENCH_TILE + BENCH_GAP);
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(bx, BENCH_Y0, BENCH_TILE, BENCH_TILE);
    ctx.strokeStyle = "#4a3a28";
    ctx.strokeRect(bx + 0.5, BENCH_Y0 + 0.5, BENCH_TILE - 1, BENCH_TILE - 1);
  }
}
function blitFrame(im, frame, px, py, size, flip, alpha, whiten) {
  if (!im || !(frame >= 0)) return;
  const half = size / 2;
  ctx.save();
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.translate(px, py);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, 0, frame * im.width, im.width, im.width, -half, -half, size, size);
  if (whiten) {
    ctx.globalAlpha = 0.55; ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(im, 0, frame * im.width, im.width, im.width, -half, -half, size, size);
  }
  ctx.restore();
}
function drawUnitAt(u, px, py, now) {
  const id = u.R.anim[u.side === "me" ? "me" : "foe"];
  const scale = 1.15 + (u.star - 1) * 0.12;
  const flip = u.dir === "right";
  const whiten = now < u.flashUntil;

  if (u.state === "dead") {
    const el = now - u.deadAt;
    const fade = Math.max(0, 1 - el / 1600);
    if (fade <= 0) return;
    blitFrame(images[`m${id}`], el < 260 ? DEAD_FRAMES[0] : DEAD_FRAMES[1], px, py, SPR * scale, false, fade);
    return;
  }
  if (selected === u) {
    ctx.strokeStyle = "#f0c060"; ctx.lineWidth = 2;
    ctx.strokeRect(px - TILE / 2 + 2, py - TILE / 2 + 2, TILE - 4, TILE - 4);
  }
  // 当前行动者：脚下白圈
  if (phase === "fight" && u.actingUntil && now < u.actingUntil) {
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py + SPR * scale * 0.38, 22, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (u.rage >= RAGE_MAX && phase === "fight") {
    ctx.strokeStyle = "rgba(255,210,74," + (0.5 + 0.4 * Math.sin(now / 120)) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py + SPR * scale * 0.38, 20, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (u.state === "attack") {
    const el = now - u.animStart;
    const fs = ATK_FRAMES[u.dir];
    const fi = Math.min(fs.length - 1, Math.max(0, Math.floor(el / 110)));
    blitFrame(images[`a${id}`], fs[fi], px, py, ATK_SPR * scale, flip, undefined, whiten);
    if (el > 440) u.state = "stand";
  } else if (u.state === "walk") {
    const fs = MOVE_FRAMES[u.dir];
    blitFrame(images[`m${id}`], fs[Math.floor(now / 200) % fs.length], px, py, SPR * scale, flip, undefined, whiten);
  } else {
    blitFrame(images[`m${id}`], STAND_FRAMES[u.dir], px, py, SPR * scale, flip, undefined, whiten);
  }
  // 血条+怒气条+星级+装备
  const w = 40, bx = px - w / 2, by = py - SPR * scale / 2 - 10;
  ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(bx - 1, by - 1, w + 2, 9);
  ctx.fillStyle = u.side === "me" ? "#4a90e2" : "#d0453a";
  ctx.fillRect(bx, by, w * (u.hp / u.maxHp), 5);
  ctx.fillStyle = "#ffd24a";
  ctx.fillRect(bx, by + 6, w * (u.rage / RAGE_MAX), 2);
  if (u.star > 1) {
    ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = u.star === 3 ? "#ffd24a" : "#d8d8e8";
    ctx.fillText("★".repeat(u.star), px, by - 3);
    ctx.textAlign = "left";
  }
  u.items.forEach((k, i) => {
    const im = itemImgs[k];
    if (im) ctx.drawImage(im, bx + w + 2, by - 4 + i * 14, 12, 12);
  });
  if (u.stun > 0) {
    ctx.fillStyle = "#e8c8ff"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("✦", px, by - 14);
    ctx.textAlign = "left";
  }
}
function drawUnit(u, now) {
  u.x += (u.col - u.x) * 0.2; u.y += (u.row - u.y) * 0.2;
  drawUnitAt(u, u.x * TILE + TILE / 2, u.y * TILE + TILE / 2, now);
}
function drawBench(now) {
  bench.forEach((u, i) => {
    if (!u) return;
    const px = BENCH_X0 + i * (BENCH_TILE + BENCH_GAP) + BENCH_TILE / 2;
    drawUnitAt(u, px, BENCH_Y0 + BENCH_TILE / 2, now);
  });
}
function drawFx(now) {
  for (let i = activeFx.length - 1; i >= 0; i--) {
    const f = activeFx[i];
    // rAF 时间戳可能略早于 performance.now()（高刷屏常见），负索引必须钳到 0
    const fi = Math.max(0, Math.floor((now - f.born) / 70));
    if (fi >= f.frames.length) { activeFx.splice(i, 1); continue; }
    const frame = f.frames[fi];
    if (!frame) continue;
    const size = 64 * f.scale;
    ctx.drawImage(frame, f.col * TILE + TILE / 2 - size / 2, f.row * TILE + TILE / 2 - size / 2, size, size);
  }
}
function drawProjectiles(now) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const t = Math.min(1, (now - p.born) / p.dur);
    if (t >= 1) {
      if (!p.done) { p.done = true; p.onHit(); }
      projectiles.splice(i, 1);
      continue;
    }
    const x = (p.x0 + (p.x1 - p.x0) * t) * TILE + TILE / 2;
    const y = (p.y0 + (p.y1 - p.y0) * t) * TILE + TILE / 2 - Math.sin(t * Math.PI) * 14;
    const ang = Math.atan2((p.y1 - p.y0), (p.x1 - p.x0));
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.strokeStyle = "#e8d9b0"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3); ctx.fill();
    ctx.restore();
  }
}
function drawPopups(now) {
  ctx.textAlign = "center";
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i], life = p.big ? 1300 : 900, el = now - p.born;
    if (el > life) { popups.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - el / life;
    ctx.font = p.big ? "bold 19px sans-serif" : "bold 15px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.fillText(p.text, p.x * TILE + TILE / 2 + 1, p.y * TILE + 7 - el * 0.03);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x * TILE + TILE / 2, p.y * TILE + 6 - el * 0.03);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}
function render(now) {
  // 保险丝：任何一帧的异常都不能杀死渲染循环
  try {
    runBattleStep(now);
    ctx.save();
    if (now < shake.until && shake.mag > 0) {
      const k = (shake.until - now) / 320;
      ctx.translate((Math.random() - 0.5) * shake.mag * 2 * k, (Math.random() - 0.5) * shake.mag * 2 * k);
    } else { shake.mag = 0; }
    ctx.clearRect(-10, -10, cv.width + 20, cv.height + 20);
    drawBoard();
    const sorted = units.slice().sort((a, b) =>
      (a.state === "dead" ? -1 : 1) - (b.state === "dead" ? -1 : 1) || a.y - b.y);
    for (const u of sorted) drawUnit(u, now);
    drawBench(now);
    drawFx(now);
    drawProjectiles(now);
    drawPopups(now);
    ctx.restore();
  } catch (e) {
    console.error("渲染帧异常(已跳过):", e);
    try { ctx.restore(); } catch (e2) {}
  }
  requestAnimationFrame(render);
}

// ---------- 流程 ----------
document.getElementById("fight").onclick = () => {
  if (phase !== "shop" || fieldCount() === 0) return;
  fieldSnapshot = fieldUnits().map(u => ({ rosterId: u.rosterId, star: u.star, col: u.col, row: u.row, items: u.items.slice() }));
  applyFightBuffs();
  phase = "fight";
  selected = null; selItem = -1;
  setStatus();
  refreshStats(); renderShop(); renderInv();
  startBgm();
  popups.push({ x: COLS / 2 - 0.5, y: ROWS / 2 - 1, text: "开 战 !", color: "#f0c060", born: performance.now(), big: true });
  battleCycles = 0; actQueue = []; nextActAt = 0;
  cmdEnergy = 30;            // 主帅开场自带三成能量
  updateCmdBtn();
};
document.getElementById("cmd").onclick = castCommander;
document.getElementById("sell").onclick = sellSelected;
document.getElementById("refresh").onclick = () => rollShop(false);
document.getElementById("buyxp").onclick = buyXp;
const spdBtn = document.getElementById("speed");
spdBtn.onclick = () => {
  speedMult = speedMult === 1 ? 0.5 : 1;
  spdBtn.textContent = speedMult === 1 ? "⏩ 常速" : "⏩⏩ 二倍速";
};
const sndBtn = document.getElementById("sound");
sndBtn.onclick = () => {
  soundOn = !soundOn;
  if (!soundOn) stopBgm(); else if (phase === "fight") startBgm();
  sndBtn.textContent = soundOn ? "🔊 音效开" : "🔇 音效关";
};

// ---------- 启动 ----------
loadAssets().then(() => {
  buildShopUI();
  rollShop(true);
  spawnEnemies();
  setStatus("先点将，再买兵");
  refreshStats(); renderSyn(); renderInv();
  updateCmdBtn();
  showCommanderPick();
  requestAnimationFrame(render);
});
