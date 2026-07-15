"use strict";
/* ================= 汉字三国自走棋 v1 =================
   棋子=汉字牌。兵种字（刀枪弓医骑）三合一升星；
   姓名字两两拼名合体成武将（金牌，专属技能）；一字多将：张→飞/辽，黄→忠/盖，关→羽/平
   引擎沿用像素版：逐个行动战斗/经济/人口/羁绊/装备/敌方成长
   特效音效仍用《曹操传》素材（Meff plist 图集 / Se_m wav / Track18）
======================================================= */

// ---------- 常量 ----------
const COLS = 5, ROWS = 7, TILE = 64;   // 5车道×7行（敌区3+缓冲1+部署3=经典三排阵）
const WALL_H = 14;                      // 城墙带（画在战场底部与备战条之间）
const DEPLOY_ROWS = 3;   // 部署3行×5列=15格，人口10自由布阵
const MAX_ROUND = 10;   // 闯关：10关通关
const BENCH_SIZE = 8;   // 囤字位加大
const ACT_WAIT = { heroskill: 980, skill: 620, attack: 420, move: 220, idle: 40 };
let speedMult = 1;
let battleCycles = 0;
const RAGE_MAX = 100, RAGE_START = 40;
const STAR_MULT = { 1: 1, 2: 1.9, 3: 3.4 };
const LEVEL_MAX = 10;
const XP_NEED = { 5: 8, 6: 12, 7: 16, 8: 20, 9: 24 };
const SHOP_ODDS = {
  5: [60, 28, 10, 2], 6: [50, 30, 15, 5], 7: [40, 32, 20, 8],
  8: [32, 30, 26, 12], 9: [26, 28, 29, 17], 10: [20, 26, 32, 22],
};
const BENCH_TILE = 32, BENCH_GAP = 4;
const BENCH_X0 = (COLS * TILE - (9 * BENCH_TILE + 8 * BENCH_GAP)) / 2;   // 含回收桶共9格
const WALL_Y = ROWS * TILE;
const BENCH_Y0 = WALL_Y + WALL_H + 8;
const BIN_SLOT = 8;   // 备战条第9格=回收桶
// 回收条：选中棋子后点这里卖出
const CANVAS_H = BENCH_Y0 + BENCH_TILE + 8;

// ---------- 职业 ----------
// PvZ功能化兵种：刀=贴脸坦伤 枪=直线贯穿 弓=守列狙击 医=药雾毒奶 骑=自动堵漏游骑
const CLASSES = {
  infantry: { name: "刀兵", hp: 200, atk: 24, def: 10, rng: 1, step: 1, mode: "front",  skill: "旋风斩" },
  lancer:   { name: "枪兵", hp: 100, atk: 15, def: 6,  rng: 2, step: 1, mode: "pierce", skill: "贯穿突刺" },
  archer:   { name: "弓手", hp: 65,  atk: 15, def: 3,  rng: 9, step: 1, mode: "column", skill: "连珠箭" },
  priest:   { name: "医师", hp: 75,  atk: 8,  def: 3,  rng: 9, step: 1, heal: 6, mode: "mist", skill: "回春" },
  cavalry:  { name: "铁骑", hp: 110, atk: 14, def: 7,  rng: 1, step: 2, mode: "rover",  skill: "冲锋" },
  namechar: { name: "字",   hp: 65,  atk: 8,  def: 2,  rng: 1, step: 1, skill: "" },   // 姓名字：弱单位，等待合体
};
// 药雾区域效果 {col,row,born,until,side}
let mists = [];
let nextMistTickAt = 0;
// 克制：枪→骑→弓→刀→枪 循环 + 骑兵克医
const COUNTERS = {
  infantry: ["lancer"], lancer: ["cavalry"], cavalry: ["archer", "priest"],
  archer: ["infantry"], priest: [], namechar: [],
};

// ---------- 字池 ----------
// 兵种字（可升星）
const CLASS_CHARS = [
  { id: "dao",   char: "刀", cls: "infantry", cost: 1 },
  { id: "qiang", char: "枪", cls: "lancer",   cost: 1 },
  { id: "gong",  char: "弓", cls: "archer",   cost: 2 },
  { id: "yi",    char: "医", cls: "priest",   cost: 2 },
  { id: "qi",    char: "骑", cls: "cavalry",  cost: 3 },
];
// 姓名字（字盘材料）。一字多将：张→飞/辽 黄→忠/盖 关→羽/平；三字名：诸葛亮
const NAME_CHARS = ["刘", "备", "关", "羽", "平", "张", "飞", "辽", "赵", "云", "吕", "布", "黄", "忠", "盖", "诸", "葛", "亮"];
// 前3关随机池只出二流武将的字（一流专属字"羽飞赵云忠吕布诸葛亮"第4关起入池）——武将稀缺曲线的地基
const NAME_CHARS_T2 = ["刘", "备", "关", "平", "张", "辽", "黄", "盖"];
// 武将表：两字合体
// tier1=一流名将(6金,强力,第4关起入盘) tier2=二流武将(4金,过渡,前期主力)
const HEROES = {
  liubei:   { name: "刘备", chars: ["刘", "备"], cls: "priest",   faction: "蜀", tier: 2, skillName: "仁德济世" },
  guanyu:   { name: "关羽", chars: ["关", "羽"], cls: "infantry", faction: "蜀", tier: 1, skillName: "青龙偃月斩" },
  guanping: { name: "关平", chars: ["关", "平"], cls: "infantry", faction: "蜀", tier: 2, skillName: "随父征战" },
  zhangfei: { name: "张飞", chars: ["张", "飞"], cls: "lancer",   faction: "蜀", tier: 1, skillName: "燕人咆哮" },
  zhangliao:{ name: "张辽", chars: ["张", "辽"], cls: "cavalry",  faction: "魏", tier: 2, skillName: "威震逍遥津" },
  zhaoyun:  { name: "赵云", chars: ["赵", "云"], cls: "cavalry",  faction: "蜀", tier: 1, skillName: "七进七出" },
  lvbu:     { name: "吕布", chars: ["吕", "布"], cls: "cavalry",  faction: "群", tier: 1, skillName: "无双乱舞" },
  huangzhong:{name: "黄忠", chars: ["黄", "忠"], cls: "archer",   faction: "蜀", tier: 1, skillName: "百步穿杨" },
  huanggai: { name: "黄盖", chars: ["黄", "盖"], cls: "infantry", faction: "吴", tier: 2, skillName: "苦肉计" },
  zhugeliang:{name: "诸葛亮", chars: ["诸", "葛", "亮"], cls: "priest", tier: 1, faction: "蜀", skillName: "锦囊妙计" },
};
const HERO_LIST = Object.entries(HEROES).map(([id, h]) => ({ id, ...h }));
// 敌军=曹军：小兵挂"曹"军旗，末波出曹将讨阵，第10关曹操亲征
const CAO_GENERALS = [
  { id: "xiahoudun",  name: "夏侯惇", cls: "infantry", faction: "魏", skillName: "拔矢啖睛" },
  { id: "xiahouyuan", name: "夏侯渊", cls: "archer",   faction: "魏", skillName: "神速急袭" },
  { id: "caoren",     name: "曹仁",   cls: "infantry", faction: "魏", skillName: "八门金锁" },
  { id: "caohong",    name: "曹洪",   cls: "cavalry",  faction: "魏", skillName: "舍马救主" },
  { id: "xuchu",      name: "许褚",   cls: "infantry", faction: "魏", skillName: "裸衣恶战" },
  { id: "dianwei",    name: "典韦",   cls: "infantry", faction: "魏", skillName: "古之恶来" },
  { id: "xuhuang",    name: "徐晃",   cls: "lancer",   faction: "魏", skillName: "长驱直入" },
  { id: "zhanghe",    name: "张郃",   cls: "cavalry",  faction: "魏", skillName: "巧变行军" },
  { id: "simayi",     name: "司马懿", cls: "priest",   faction: "魏", skillName: "深谋远虑" },
];
const CAO_BOSS = { id: "caocao", name: "曹操", cls: "lancer", faction: "魏", skillName: "挟天子令诸侯" };
// 敌方专用小兵（字库与我方刀枪弓医骑分离）：卒=杂兵海 马=快速兵 校=血厚精英
const FOE_TYPES = [
  { id: "zu",   char: "卒", cls: "infantry", cost: 1, hpB: 70,  atkB: 10 },
  { id: "ma",   char: "马", cls: "cavalry",  cost: 2, hpB: 55,  atkB: 9 },
  { id: "xiao", char: "校", cls: "infantry", cost: 3, hpB: 200, atkB: 12, slow: true },
];
const defOfFoeType = t => ({ kind: "class", id: "f_" + t.id, char: t.char, cls: t.cls, cost: t.cost, hpB: t.hpB, atkB: t.atkB, slow: !!t.slow });
// 神兵：连出武器名获得装备；装给本命武将触发共鸣
const WEAPONS = [
  { id: "shemao",    name: "丈八蛇矛",   icon: "26", wchar: "矛", hero: "zhangfei" },
  { id: "qinglong",  name: "青龙偃月刀", icon: "25", wchar: "偃", hero: "guanyu" },
  { id: "fangtian",  name: "方天画戟",   icon: "27", wchar: "戟", hero: "lvbu" },
  { id: "cixiong",   name: "雌雄双剑",   icon: "21", wchar: "剑", hero: "liubei" },
  { id: "shenshan",  name: "五火神焰扇", icon: "34", wchar: "扇", hero: "zhugeliang" },
].map(w => ({ ...w, chars: w.name.split("") }));
// 神兵备战牌：占一个备战格可见，本命到位自动飞装
const makeWeaponToken = w => ({ isWeapon: true, wkey: "w_" + w.id, char: w.wchar, icon: w.icon, name: w.name, heroId: w.hero });
const weaponImgs = {};
function weaponImg(icon) {
  if (!weaponImgs[icon]) {
    weaponImgs[icon] = { complete: false, naturalWidth: 0 };
    loadKeyedImage(`assets/items/${icon}.png`).then(c => {   // 复用抠黑底逻辑
      if (c) weaponImgs[icon] = Object.assign(c, { complete: true, naturalWidth: c.width });
    });
  }
  return weaponImgs[icon];
}
function stashWeapon(k) {
  const w = WEAPONS.find(x => "w_" + x.id === k);
  const slot = bench.indexOf(null);
  if (w && slot >= 0) { bench[slot] = makeWeaponToken(w); return true; }
  inventory.push(k);
  return false;
}
function weaponByString(str) {
  const rev = str.split("").reverse().join("");
  return WEAPONS.find(w => w.name === str || w.name === rev) || null;
}
// char → 可参与的武将
const CHAR_TO_HEROES = {};
for (const h of HERO_LIST) for (const c of h.chars) (CHAR_TO_HEROES[c] = CHAR_TO_HEROES[c] || []).push(h);

// ---------- 羁绊 ----------
const SYNERGIES = [
  { key: "infantry", type: "cls", th: [2, 3], desc: ["刀兵防御+4", "刀兵防御+8"] },
  { key: "lancer",   type: "cls", th: [2, 3], desc: ["枪兵攻击+15%", "枪兵攻击+30%"] },
  { key: "archer",   type: "cls", th: [2, 3], desc: ["弓手射程+1攻+10%", "弓手射程+1攻+25%"] },
  { key: "priest",   type: "cls", th: [2, 3], desc: ["医师技能+35%", "医师技能+70%"] },
  { key: "cavalry",  type: "cls", th: [2, 4], desc: ["铁骑攻击+15%", "铁骑攻击+35%"] },
  { key: "蜀", type: "faction", th: [2, 4], desc: ["全军血量+15%", "全军血量+30%"] },
  { key: "魏", type: "faction", th: [1, 2], desc: ["全军攻击+8%", "全军攻击+18%"] },
  { key: "吴", type: "faction", th: [1, 2], desc: ["全军闪避+8%", "全军闪避+15%"] },
  { key: "群", type: "faction", th: [1, 1], desc: ["怒气获取+50%", "怒气获取+50%"] },
  { key: "taoyuan", type: "special", th: [3, 3], desc: ["桃园结义：全军攻血+25%", "桃园结义：全军攻血+25%"] },
];

// ---------- 装备 ----------
const ITEMS = {
  sword: { name: "精钢大剑", icon: "1",  desc: "攻击+20%" },
  armor: { name: "连环铠", icon: "46", desc: "血量+20% 防御+3" },
  horse: { name: "的卢", icon: "63", desc: "移动+1 先手" },
  book:  { name: "孙子兵法", icon: "73", desc: "怒气获取+60%" },
};
// 神兵注册为装备（金框）
for (const w of WEAPONS) {
  ITEMS["w_" + w.id] = {
    name: w.name, icon: w.icon, weapon: w,
    desc: `攻+15%；交予【${(HEROES[w.hero] || {}).name}】触发神兵共鸣（攻+40% 技能+50% 怒气+30%）`,
  };
}

const FX_NEEDED = ["Meff_3", "Meff_4", "Meff_5", "Meff_13"];

// ---------- 资源（仅特效/音效，字牌无需图）----------
const effects = {}, itemImgs = {};
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
let phase = "ready";   // ready(待出征) | fight(实时战斗+买将布阵) | over(结算)
let round = 1, playerHp = 100, gold = 20;   // playerHp 已废弃，城墙制见 walls
let walls = [2, 2, 2, 2, 2];   // 每列城墙：2=完好(有滚木) 1=缺口(可花钱修) 0=城破
const WALL_FIX_COST = 8;
let rollLogs = [];             // 滚木演出 {col, born}
let wave = 0, waveTotal = 0, lastWin = false;
let spawnQueue = [];        // 待入场敌人描述 {def, star}
let nextSpawnAt = 0;        // 下一个敌人入场时刻
let nextWaveAt = 0;         // 下一波开始时刻
let level = 5, xp = 0;
let winStreak = 0, loseStreak = 0;
let units = [];
let bench = new Array(BENCH_SIZE).fill(null);
let shop = new Array(8).fill(null);   // 8槽：出字管够
let inventory = [];
let selected = null, selItem = -1;
let fieldSnapshot = null;
let uidSeq = 0;
let actQueue = [], nextActAt = 0;

const popups = [], activeFx = [], projectiles = [];
const shreds = [];       // 碎纸片 {x,y,vx,vy,rot,vr,w,h,color,border,born,life}
const ghosts = [];       // 英雄残影 {x,y,S,born}
const inkSlashes = [];   // 墨迹刀光 {x0,y0,x1,y1,born,dur}

// 受击碎纸：从牌上撕落碎片；死亡整牌裂散
function spawnShreds(u, n) {
  if (shreds.length > 70) shreds.splice(0, n);
  const px = u.x * TILE + TILE / 2, py = u.y * TILE + TILE / 2;
  let colors, border;
  if (u.hero) { colors = ["#f8ecc8", "#eeddae"]; border = "#8a6a1c"; }
  else if (u.side === "me") { colors = ["#f7efdd", "#eee1c2"]; border = "#3a2f24"; }
  else { colors = ["#e6d9cd", "#dbcabc"]; border = "#6a4038"; }
  for (let i = 0; i < n; i++) {
    shreds.push({
      x: px + (Math.random() - 0.5) * 26, y: py + (Math.random() - 0.5) * 26,
      vx: (Math.random() - 0.5) * 110, vy: -40 - Math.random() * 60,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 7,
      w: 6 + Math.random() * 9, h: 5 + Math.random() * 8,
      color: colors[i % 2], border,
      born: performance.now(), life: 650 + Math.random() * 450,
    });
  }
}
function drawShreds(now) {
  for (let i = shreds.length - 1; i >= 0; i--) {
    const p = shreds[i];
    const t = (now - p.born) / p.life;
    if (t >= 1) { shreds.splice(i, 1); continue; }
    const dt = (now - p.born) / 1000;
    const x = p.x + p.vx * dt, y = p.y + p.vy * dt + 170 * dt * dt;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.translate(x, y);
    ctx.rotate(p.rot + p.vr * dt);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-p.w / 2, -p.h / 2);
    ctx.lineTo(p.w / 2, -p.h / 2 * 0.55);
    ctx.lineTo(p.w / 2 * 0.78, p.h / 2);
    ctx.lineTo(-p.w / 2 * 0.9, p.h / 2 * 0.68);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
// 英雄残影（纸质虚牌，逐级透明）
function drawGhosts(now) {
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const g = ghosts[i];
    const t = (now - g.born) / 320;
    if (t >= 1) { ghosts.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = 0.38 * (1 - t);
    ctx.fillStyle = "#eeddae";
    ctx.strokeStyle = "#8a6a1c";
    ctx.lineWidth = 2;
    roundRectU(g.x - g.S / 2, g.y - g.S / 2, g.S, g.S, [8, 7, 9, 6]);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
// 墨迹刀光：粗墨主笔 + 墨晕 + 飞白 + 金点飞溅
function spawnInkSlash(a, b) {
  if (inkSlashes.length > 8) inkSlashes.shift();
  inkSlashes.push({
    x0: a.x * TILE + TILE / 2, y0: a.y * TILE + TILE / 2,
    x1: b.x * TILE + TILE / 2, y1: b.y * TILE + TILE / 2,
    born: performance.now(), dur: 340,
  });
}
function spawnInkSlashAt(c0, r0, c1, r1) {
  if (inkSlashes.length > 8) inkSlashes.shift();
  inkSlashes.push({
    x0: c0 * TILE + TILE / 2, y0: r0 * TILE + TILE / 2,
    x1: c1 * TILE + TILE / 2, y1: r1 * TILE + TILE / 2,
    born: performance.now(), dur: 340,
  });
}
function drawInkSlashes(now) {
  for (let i = inkSlashes.length - 1; i >= 0; i--) {
    const k = inkSlashes[i];
    const t = (now - k.born) / k.dur;
    if (t >= 1) { inkSlashes.splice(i, 1); continue; }
    const fade = t < 0.14 ? t / 0.14 : t > 0.55 ? (1 - t) / 0.45 : 1;
    // 弧线控制点：中点沿法线抬起
    const dx = k.x1 - k.x0, dy = k.y1 - k.y0;
    const len = Math.max(24, Math.hypot(dx, dy));
    const nx = -dy / len, ny = dx / len;
    const bend = Math.min(44, len * 0.5);
    const mx = (k.x0 + k.x1) / 2 + nx * bend, my = (k.y0 + k.y1) / 2 + ny * bend;
    ctx.save();
    ctx.lineCap = "round";
    // 墨晕（随时间晕开）
    ctx.globalAlpha = fade * 0.3;
    ctx.strokeStyle = "rgba(70,55,35,.9)";
    ctx.lineWidth = 18 + 14 * t;
    ctx.beginPath(); ctx.moveTo(k.x0, k.y0); ctx.quadraticCurveTo(mx, my, k.x1, k.y1); ctx.stroke();
    // 粗墨主笔
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = "rgba(30,22,14,.9)";
    ctx.lineWidth = 11 * (1 - t * 0.35);
    ctx.beginPath(); ctx.moveTo(k.x0, k.y0); ctx.quadraticCurveTo(mx, my, k.x1, k.y1); ctx.stroke();
    // 飞白
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#f4e6c2";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(k.x0 + nx * 3, k.y0 + ny * 3); ctx.quadraticCurveTo(mx + nx * 3, my + ny * 3, k.x1 + nx * 3, k.y1 + ny * 3); ctx.stroke();
    // 金点飞溅（沿弧线）
    for (const pt of [0.35, 0.62, 0.85]) {
      const gx = (1 - pt) * (1 - pt) * k.x0 + 2 * (1 - pt) * pt * mx + pt * pt * k.x1;
      const gy = (1 - pt) * (1 - pt) * k.y0 + 2 * (1 - pt) * pt * my + pt * pt * k.y1;
      ctx.fillStyle = pt > 0.6 ? "#fff4d0" : "#f0c060";
      ctx.beginPath();
      ctx.arc(gx + nx * (8 + 14 * t), gy + ny * (8 + 14 * t), pt > 0.6 ? 2 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
let shake = { mag: 0, until: 0 };

const cv = document.getElementById("cv");
cv.width = COLS * TILE; cv.height = CANVAS_H;
const ctx = cv.getContext("2d");

const popCap = () => 10;
const fieldUnits = () => units.filter(u => u.side === "me" && u.state !== "dead");
const fieldCount = () => fieldUnits().length;
const interest = () => Math.min(5, Math.floor(gold / 10));
const sellValue = u => u.isWeapon ? 3 : (u.hero ? 6 : u.cost) * Math.pow(3, u.star - 1);

// ---------- 单位 ----------
// kind: "class"(兵种字) | "name"(姓名字) | "hero"(武将)
function makeUnit(def, side, col, row, star = 1, items = []) {
  // def: {kind, id, char/name, cls, cost, faction?, skillName?}
  const C = CLASSES[def.cls];
  const heroMult = def.kind === "hero" ? (def.tier === 1 ? 1.8 : 1.45) : 1;
  const m = STAR_MULT[star] * (1 + ((def.cost || 2) - 1) * 0.18) * heroMult;
  // 敌人是耗材：数值远低于我方，随关卡爬升，第10关才追平
  const foeHpM = side === "foe" ? Math.min(1, 0.5 + round * 0.05) : 1;
  const foeAtkM = side === "foe" ? Math.min(1, 0.55 + round * 0.045) : 1;
  const base = {
    hp: Math.round((def.hpB || C.hp) * m * foeHpM), atk: Math.round((def.atkB || C.atk) * m * foeAtkM),
    def: C.def + (def.kind === "hero" ? 2 : 0), rng: C.rng, step: C.step,
    hits: C.hits || 1, dodge: C.dodge || 0, heal: C.heal ? Math.round(C.heal * m) : 0,
  };
  const u = {
    uid: ++uidSeq,
    kind: def.kind, defId: def.id, char: def.char || null,
    name: def.kind === "hero" ? def.name : def.char,
    cls: def.cls, cost: def.cost || 2, faction: def.faction || null,
    skillName: def.skillName || null, hero: def.kind === "hero", slow: !!def.slow,
    side, star, col, row, x: col, y: row,
    base, items: items.slice(0, 2),
    rage: RAGE_START, stun: 0,
    dir: side === "me" ? "up" : "down",
    state: "stand", animStart: 0, deadAt: 0, flashUntil: 0,
    atkNudge: 0,
  };
  bakeStats(u, null);
  u.hp = u.maxHp;
  return u;
}
const defOfClassChar = c => ({ kind: "class", id: c.id, char: c.char, cls: c.cls, cost: c.cost });
const defOfNameChar = ch => ({ kind: "name", id: "n_" + ch, char: ch, cls: "namechar", cost: 2 });
const defOfHero = h => ({ kind: "hero", id: h.id, name: h.name, cls: h.cls, cost: 4, faction: h.faction, tier: h.tier || 2, skillName: h.skillName });
const heroPriceOf = h => (h.tier === 1 ? 6 : 4);

function bakeStats(u, syn) {
  let atkM = 0, hpM = 0, defA = 0, dodgeA = 0, critA = 0, rageM = 1, rngA = 0, hitsA = 0, stepA = 0, skillM = 1;
  u.resonant = false;
  for (const k of u.items) {
    if (k === "sword") atkM += 0.20;
    if (k === "armor") { hpM += 0.20; defA += 3; }
    if (k === "horse") stepA += 1;
    if (k === "book") rageM += 0.6;
    const it = ITEMS[k];
    if (it && it.weapon) {
      if (u.hero && u.defId === it.weapon.hero) {   // 本命共鸣
        atkM += 0.40; skillM += 0.50; rageM += 0.30;
        u.resonant = true;
      } else atkM += 0.15;
    }
  }
  if (syn) {
    const t = (key) => syn[key] || 0;
    if (t("蜀")) hpM += t("蜀") === 1 ? 0.15 : 0.30;
    if (t("魏")) atkM += t("魏") === 1 ? 0.08 : 0.18;
    if (t("吴")) dodgeA += t("吴") === 1 ? 0.08 : 0.15;
    if (t("群")) rageM += 0.5;
    if (t("taoyuan")) { atkM += 0.25; hpM += 0.25; }
    if (u.cls === "infantry" && t("infantry")) defA += t("infantry") === 1 ? 4 : 8;
    if (u.cls === "lancer" && t("lancer")) atkM += t("lancer") === 1 ? 0.15 : 0.30;
    if (u.cls === "archer" && t("archer")) { rngA += 1; atkM += t("archer") === 1 ? 0.10 : 0.25; }
    if (u.cls === "priest" && t("priest")) skillM += t("priest") === 1 ? 0.35 : 0.70;
    if (u.cls === "cavalry" && t("cavalry")) atkM += t("cavalry") === 1 ? 0.15 : 0.35;
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

// ---------- 羁绊 ----------
function synergyCounts(sideUnits) {
  const cls = {}, fac = {};
  const seen = new Set(), names = new Set();
  for (const u of sideUnits) {
    if (seen.has(u.defId)) continue;
    seen.add(u.defId);
    if (u.kind !== "name") cls[u.cls] = (cls[u.cls] || 0) + 1;
    if (u.faction) fac[u.faction] = (fac[u.faction] || 0) + 1;
    if (u.hero) names.add(u.name);
  }
  const taoyuan = ["刘备", "关羽", "张飞"].every(n => names.has(n)) ? 3 : 0;
  return { cls, fac, taoyuan };
}
function synergyTiers(sideUnits) {
  const { cls, fac, taoyuan } = synergyCounts(sideUnits);
  const tiers = {};
  for (const s of SYNERGIES) {
    const n = s.type === "special" ? taoyuan : s.type === "faction" ? (fac[s.key] || 0) : (cls[s.key] || 0);
    tiers[s.key] = n >= s.th[1] ? 2 : n >= s.th[0] ? 1 : 0;
  }
  return tiers;
}
function applyFightBuffs() {   // 羁绊已删：只重算基础+神兵
  for (const u of alive()) bakeStats(u, null);
}

// ---------- 战斗结算 ----------
function gainRage(u, amount) {
  if (u.state === "dead" || u.kind === "name") return;
  u.rage = Math.min(RAGE_MAX, u.rage + amount * (u.rageMul || 1));
}
function dealDamage(att, tgt, mult, opt = {}) {
  if (tgt.state === "dead") return;
  if (tgt.dodge && Math.random() < tgt.dodge && !opt.noDodge) {
    popup(tgt, "闪避", "#4a7a9a");
    return;
  }
  const counter = false;
  const crit = Math.random() < (att.crit || 0.12);
  let dmg = Math.max(3, att.atk * mult * 1.3 - (opt.trueDmg ? 0 : tgt.def * 0.5));
  dmg *= (0.9 + Math.random() * 0.2);
  dmg *= 1 + Math.max(0, battleCycles - 10) * 0.15;
  if (counter) dmg *= 1.35;
  if (crit) dmg *= 1.8;
  dmg = Math.round(dmg);
  tgt.hp -= dmg;
  tgt.flashUntil = performance.now() + 130;
  if (phase === "fight") spawnShreds(tgt, 2);   // 受击碎纸
  gainRage(tgt, 16);
  const isHeroHit = !!att.hero;
  const label = (counter ? "克制 " : "") + (crit ? "暴击 " : "-") + dmg;
  popup(tgt, label, counter ? "#b83420" : (crit || isHeroHit) ? "#b8891c" : "#a04030", counter || crit || isHeroHit);
  if (crit) doShake(3);
  thock(crit ? 110 : 160);
  if (tgt.hp <= 0) {
    tgt.hp = 0; tgt.state = "dead"; tgt.deadAt = performance.now();
    thock(70, 0.18, 0.3);
    spawnShreds(tgt, 7);   // 死亡：整牌裂成碎片散落
    // 击杀掉金币（塔防式战场经济）
    if (tgt.side === "foe" && att.side === "me" && phase === "fight") {
      gold += 1;
      popup(tgt, "+1金", "#8a6a10");
      refreshStats();
    }
    // 英雄击杀：斩字特写 + 全场顿帧
    if (isHeroHit) {
      popups.push({ x: tgt.col, y: tgt.row, text: "斩！", color: "#8a2818", born: performance.now(), big: true });
      nextActAt = Math.max(nextActAt, performance.now() + 380);
      doShake(6);
    }
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
// 英雄弹道：刀气 / 金箭 / 光球
function shootHero(att, tgt, mult, type) {
  projectiles.push({
    x0: att.col, y0: att.row, x1: tgt.col, y1: tgt.row, type,
    born: performance.now(), dur: 75 * dist(att, tgt) + 60, done: false,
    onHit: () => dealDamage(att, tgt, mult),
  });
  thock(type === "orb" ? 300 : 230, 0.09, 0.25);
}
// 英雄平A：每一下都有戏
function heroBasic(u, tgt) {
  switch (u.cls) {
    case "infantry":                       // 墨迹刀光劈斩
      spawnInkSlash(u, tgt);
      dealDamage(u, tgt, 1.15);
      break;
    case "lancer":                         // 长枪突刺：刀光+震屏
      spawnInkSlash(u, tgt);
      dealDamage(u, tgt, 1.15);
      doShake(3);
      break;
    case "cavalry":                        // 铁蹄冲击：刀光+小震
      spawnInkSlash(u, tgt);
      dealDamage(u, tgt, 1.1);
      doShake(2.5);
      break;
    case "archer":                         // 金色大箭
      shootHero(u, tgt, 1.2, "bigarrow");
      break;
    case "priest":                         // 金色光球
      shootHero(u, tgt, 1.1, "orb");
      break;
    default:
      dealDamage(u, tgt, 1);
  }
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
  popup(u, u.name + "【" + (u.skillName || name) + "】", color || (u.hero ? "#ffb830" : "#ffd24a"), true);
}
const SKILLS = {
  infantry(u, foes) {
    const targets = foes.filter(f => cheby(u, f) <= 1);
    if (!targets.length) return false;
    announce(u, "旋风斩");
    playSfx("Se_m_04");
    spawnFx("Meff_3", u.col, u.row, 1.9);
    spawnInkSlashAt(u.col - 1, u.row - 0.7, u.col + 1, u.row + 0.7);
    spawnInkSlashAt(u.col + 1, u.row - 0.7, u.col - 1, u.row + 0.7);
    u.state = "attack"; u.animStart = performance.now();
    doShake(5);
    for (const f of targets) { dealDamage(u, f, 1.5); knockback(u, f); }
    return true;
  },
  lancer(u, foes) {   // 贯穿突刺：直线2格穿透
    const tgt = foes.filter(f => dist(u, f) <= 2).sort((a, b) => dist(u, a) - dist(u, b))[0];
    if (!tgt) return false;
    announce(u, "贯穿突刺");
    playSfx("Se_m_04", 0.5);
    faceTo(u, tgt.col, tgt.row);
    u.state = "attack"; u.animStart = performance.now();
    doShake(4);
    const dc = Math.sign(tgt.col - u.col), dr = Math.sign(tgt.row - u.row);
    for (let s = 1; s <= 2; s++) {
      const c = u.col + dc * s, r = u.row + dr * s;
      const hit = foes.find(f => f.col === c && f.row === r);
      if (hit) dealDamage(u, hit, 1.8);
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
      announce(u, "回春", "#5a9a52");
      playSfx("Se_m_25");
      u.state = "attack"; u.animStart = performance.now();
      for (const a of alive(u.side)) {
        if (a.hp >= a.maxHp) continue;
        const amt = Math.min(a.maxHp - a.hp, Math.round(a.maxHp * 0.25 * u.skillMult));
        a.hp += amt;
        spawnFx("Meff_5", a.col, a.row, 1.3);
        popup(a, "+" + amt, "#5a9a52");
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
      if (tgt.state !== "dead") { tgt.stun = 1; popup(tgt, "晕眩", "#8a5aa0"); }
    }
    return true;
  },
  namechar() { return false; },   // 姓名字无大招
};

// ---------- 单位行动（实时制：各单位独立冷却） ----------
// 返回动作类型，决定该单位下次行动间隔
function unitActRT(u) {
  if (u.state === "dead" || phase !== "fight") return "idle";
  if (u.stun > 0) { u.stun--; popup(u, "晕眩中", "#8a5aa0"); return "stun"; }
  const foes = alive(u.side === "me" ? "foe" : "me");

  // 怒气大招（敌我通用）
  const engaged = u.side !== "foe" || foes.some(f => dist(u, f) <= 1);
  if (u.rage >= RAGE_MAX && u.hero && foes.length && engaged) {
    if (SKILLS[u.cls](u, foes)) {
      u.rage = 0;
      if (u.hero) { heroCast(u); return "heroskill"; }
      return "skill";
    }
  }
  // 医师治疗（旧逻辑，仅名将 priest 用）
  if (u.heal && (u.hero || u.side === "foe")) {
    const hurt = alive(u.side).filter(a => a !== u && a.hp < a.maxHp && dist(u, a) <= u.rng)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    if (hurt) {
      faceTo(u, hurt.col, hurt.row);
      u.state = "attack"; u.animStart = performance.now();
      hurt.hp = Math.min(hurt.maxHp, hurt.hp + u.heal);
      popup(hurt, "+" + u.heal, "#5a9a52");
      gainRage(u, 30);
      return "heal";
    }
  }
  // ── 我方功能化兵种行为（PvZ式）──
  if (u.side === "me" && !u.hero) {
    const mode = CLASSES[u.cls] && CLASSES[u.cls].mode;
    if (mode === "front") {          // 刀：只打正前1格（同列上方）
      const tgt = foes.find(f => f.col === u.col && f.row === u.row - 1);
      if (tgt) {
        faceTo(u, tgt.col, tgt.row);
        u.state = "attack"; u.animStart = performance.now();
        dealDamage(u, tgt, 1);
        gainRage(u, 26);
        return "attack";
      }
      u.state = "stand"; return "idle";
    }
    if (mode === "pierce") {         // 枪：贯穿正前直线2格，全部命中
      const hits = foes.filter(f => f.col === u.col && f.row < u.row && f.row >= u.row - 2);
      if (hits.length) {
        faceTo(u, u.col, u.row - 1);
        u.state = "attack"; u.animStart = performance.now();
        for (const f of hits) dealDamage(u, f, 1);
        gainRage(u, 26);
        return "attack";
      }
      u.state = "stand"; return "idle";
    }
    if (mode === "column") {         // 弓：守整条竖列，射最近的
      const tgt = foes.filter(f => f.col === u.col && f.row < u.row).sort((a, b) => b.row - a.row)[0];
      if (tgt) {
        faceTo(u, tgt.col, tgt.row);
        u.state = "attack"; u.animStart = performance.now();
        shootArrow(u, tgt, 1);
        gainRage(u, 26);
        return "attack";
      }
      u.state = "stand"; return "idle";
    }
    if (mode === "mist") {           // 医：向敌人最密集处投药雾（敌中毒/友回血）
      if (foes.length && !mists.some(m => m.side === "me" && performance.now() < m.until)) {
        let best = null, bestN = -1;
        for (const f of foes) {
          const n = foes.filter(g => Math.abs(g.col - f.col) <= 1 && Math.abs(g.row - f.row) <= 1).length;
          if (n > bestN) { bestN = n; best = f; }
        }
        faceTo(u, best.col, best.row);
        u.state = "attack"; u.animStart = performance.now();
        mists.push({ col: best.col, row: best.row, born: performance.now(), until: performance.now() + 3200, side: "me", pow: u.atk });
        playSfx("Se_m_25", 0.3);
        gainRage(u, 20);
        return "skill";
      }
      u.state = "stand"; return "idle";
    }
    if (mode === "rover") {          // 骑：只守内线(缓冲区+部署区)，敌人进内线才追杀
      const tgt = foes.filter(f => f.row >= 3).sort((a, b) => b.row - a.row)[0];
      if (tgt) {
        if (dist(u, tgt) <= 1) {
          faceTo(u, tgt.col, tgt.row);
          u.state = "attack"; u.animStart = performance.now();
          dealDamage(u, tgt, 1);
          gainRage(u, 26);
          return "attack";
        }
        const dc = Math.sign(tgt.col - u.col), dr = Math.sign(tgt.row - u.row);
        const stepTo = [[u.col + dc, u.row + dr], [u.col + dc, u.row], [u.col, u.row + dr]]
          .find(([c, r]) => c >= 0 && c < COLS && r >= 3 && r < ROWS && !alive().some(v => v !== u && v.col === c && v.row === r));
        if (stepTo) {
          u.col = stepTo[0]; u.row = stepTo[1];
          faceTo(u, u.col, u.row);
          u.state = "walk"; u.animStart = performance.now();
          return "move";
        }
      }
      u.state = "stand"; return "idle";
    }
  }
  // 攻击射程内目标
  let inRange = foes.filter(f => dist(u, f) <= u.rng);
  // 敌军以突围为先（PvZ式）：一律压到贴脸才动手，远程射程只属于我方
  if (u.side === "foe") inRange = inRange.filter(f => dist(u, f) <= 1);
  inRange.sort((a, b) => dist(u, a) - dist(u, b));
  if (inRange.length) {
    const tgt = inRange[0];
    faceTo(u, tgt.col, tgt.row);
    u.state = "attack"; u.animStart = performance.now();
    if (u.hero) {
      heroBasic(u, tgt);
    } else if (u.rng > 1 && u.cls === "archer") {
      shootArrow(u, tgt, 1);
    } else {
      for (let i = 0; i < u.hits; i++) {
        setTimeout(() => { if (tgt.state !== "dead" && u.state !== "dead") dealDamage(u, tgt, 1); }, i * 130);
      }
    }
    gainRage(u, 26);
    return "attack";
  }
  // 敌人：向下推进（我方站桩不移动）
  if (u.side === "foe") {
    const nr = u.row + 1;
    if (nr >= ROWS) { breach(u); return "move"; }
    const blockAt = (c, r) => alive().some(v => v !== u && v.col === c && v.row === r);
    if (!blockAt(u.col, nr)) {
      u.row = nr; faceTo(u, u.col, nr);
      u.state = "walk"; u.animStart = performance.now();
      return "move";
    }
    // 纯车道制：被堵就地等待（不换列）
    u.state = "stand";
    return "idle";
  }
  u.state = "stand";
  return "idle";
}
// 各动作的冷却间隔(ms)
const RT_DELAY = { heroskill: 1500, skill: 1400, attack: 1050, heal: 1250, move: 1350, stun: 900, idle: 420 };
function actDelay(u, kind) {
  let d = RT_DELAY[kind] || 800;
  if (u.side === "foe" && kind === "move") d = (3800 - Math.min(1600, round * 160)) * (u.slow ? 1.3 : 1);
  if (u.cls === "cavalry" && kind === "move") d *= 0.7;
  return d * speedMult;
}

// ---------- 战斗主循环（实时塔防：渲染帧驱动） ----------
function checkBattleEnd() {
  if (phase !== "fight") return true;
  if (walls.some(w => w === 0)) {      // 城破
    phase = "over";
    stopBgm();
    playSfx("Se_m_19");
    setTimeout(() => endCombat(false), 700);
    return true;
  }
  if (!spawnQueue.length && !alive("foe").length && wave >= waveTotal) {   // 全部波清空
    phase = "over";
    stopBgm();
    playSfx("Se_m_28");
    setTimeout(() => endCombat(true), 700);
    return true;
  }
  return false;
}
function runBattleStep(now) {
  if (phase !== "fight") return;
  // 刷怪滴灌
  if (spawnQueue.length) {
    if (now >= nextSpawnAt) {
      if (spawnOneEnemy(spawnQueue[0] && spawnQueue.shift())) {
        nextSpawnAt = now + 1800 + Math.random() * 900 - Math.min(900, round * 90);
      } else {
        nextSpawnAt = now + 700;   // 顶行满，稍后再试
      }
    }
  } else if (!alive("foe").length && wave < waveTotal) {
    if (!nextWaveAt) nextWaveAt = now + 3600;      // 波间喘息
    if (now >= nextWaveAt) { nextWaveAt = 0; queueWave(); }
  }
  // 药雾结算：每600ms一跳，雾区(±1格)敌中毒/友回血
  if (now >= nextMistTickAt) {
    nextMistTickAt = now + 600;
    mists = mists.filter(m => now < m.until);
    for (const m of mists) {
      for (const v of alive()) {
        if (Math.abs(v.col - m.col) > 1 || Math.abs(v.row - m.row) > 1) continue;
        if (v.side !== m.side) {
          v.hp -= Math.max(2, Math.round(m.pow * 0.7));
          popup(v, "毒", "#7a5a9a");
          if (v.hp <= 0) { v.hp = 0; v.state = "dead"; v.deadAt = now; if (v.side === "foe") gold += 1; }
        } else if (v.hp < v.maxHp) {
          v.hp = Math.min(v.maxHp, v.hp + Math.max(2, Math.round(m.pow * 0.5)));
          popup(v, "+" + Math.max(2, Math.round(m.pow * 0.5)), "#5a9a52");
        }
      }
    }
  }
  // 各单位独立冷却行动
  for (const u of alive()) {
    if (now < (u.nextActAt || 0)) continue;
    u.actingUntil = now + 350;
    const kind = unitActRT(u);
    u.nextActAt = now + actDelay(u, kind);
  }
  refreshStats();
  checkBattleEnd();
}

// ---------- 回合结算 ----------
function endCombat(win) {
  lastWin = win;
  const lines = [];
  if (win && breachCount > 0) lines.push(`本关 ${breachCount} 次险情，城墙缺口可花 ${WALL_FIX_COST} 金修复`);
  if (win) lines.push("守住了！击杀金已实时入账");

  refreshStats(); renderInv();

  const b = document.getElementById("banner");
  const txt = document.getElementById("bannerText");
  const nextBtn = document.getElementById("next");
  if (!win) {
    txt.textContent = "城 破"; txt.style.color = "#c05040";
    lines.push(`止步第 ${round} 关`);
    nextBtn.textContent = "重 新 开 局";
    nextBtn.onclick = () => location.reload();
  } else if (round >= MAX_ROUND && win) {
    txt.textContent = "天 下 平 定"; txt.style.color = "#f0c060";
    lines.push("十关全破！");
    nextBtn.textContent = "重 新 开 局";
    nextBtn.onclick = () => location.reload();
  } else {
    txt.textContent = `第 ${round} 关 · 告捷`;
    txt.style.color = "#f0c060";
    nextBtn.textContent = "进 军 下 一 关";
    nextBtn.onclick = nextRound;
  }
  document.getElementById("bannerSub").innerHTML = lines.join("<br>");
  b.classList.add("show");
}

function nextRound() {
  round++;
  document.getElementById("banner").classList.remove("show");
  // 存活者原地保留、满血清怒；阵亡的真的没了
  units = units.filter(u => u.side === "me" && u.state !== "dead");
  for (const u of units) {
    u.hp = u.maxHp; u.rage = RAGE_START; u.stun = 0;
    u.nextActAt = performance.now() + 600 + Math.random() * 500;
  }
  popups.length = 0; activeFx.length = 0; projectiles.length = 0;
  shreds.length = 0; ghosts.length = 0; inkSlashes.length = 0;
  waveTotal = wavesFor(round); wave = 0;
  refreshCount = 0;
  regenGrid(true);
  selected = null; selItem = -1;
  // 直接开打：下一关无备战
  phase = "fight"; breachCount = 0;
  spawnQueue = []; nextWaveAt = 0;
  queueWave();
  setStatus();
  nextSpawnAt = performance.now() + 1200;
  startBgm();
  refreshStats(); renderShop(); renderSyn(); renderInv();
}

// ---------- 敌方军团 ----------
function defById(defId) {
  if (defId.startsWith("n_")) return defOfNameChar(defId.slice(2));
  const cc = CLASS_CHARS.find(c => c.id === defId);
  if (cc) return defOfClassChar(cc);
  const h = HERO_LIST.find(h => h.id === defId);
  return h ? defOfHero(h) : null;
}
function unitDef(u) { return defById(u.defId); }
function wavesFor(stage) { return Math.min(6, 2 + Math.floor((stage - 1) / 2)); }
// 生成一波敌人描述，入队后按时间滴灌进场
let mainCols = [];
function queueWave() {
  wave++;
  battleCycles = 0;
  mainCols = [round === 1 ? 2 : Math.floor(Math.random() * COLS)];
  if (round >= 3) mainCols.push(Math.floor(Math.random() * COLS));
  let budget = Math.round((4 + round * 2.6) * (1 + (wave - 1) * 0.45) * (round === 1 ? 0.7 : 1));
  const countCap = Math.min(12, 3 + round);
  const pool = FOE_TYPES.filter(t => t.cost <= Math.min(3, 1 + Math.floor(round / 2)));
  let guard = 60, placed = 0;
  while (budget >= 1 && placed < countCap && guard--) {
    const C = pool[Math.floor(Math.random() * pool.length)];
    let star = 1, cost = C.cost;
    if (round >= 5 && wave >= 2 && budget >= C.cost * 9 && Math.random() < 0.3) { star = 3; cost = C.cost * 9; }
    else if (round >= 2 && budget >= C.cost * 3 && Math.random() < 0.5) { star = 2; cost = C.cost * 3; }
    if (cost > budget) continue;
    budget -= cost; placed++;
    spawnQueue.push({ def: defOfFoeType(C), star });
  }
  if (wave === waveTotal && round >= 10) {
    spawnQueue.push({ def: defOfHero(CAO_BOSS), star: 2 });
  } else if (wave === waveTotal && round >= 2 && (round >= 5 || Math.random() < 0.8)) {
    const h = CAO_GENERALS[Math.floor(Math.random() * CAO_GENERALS.length)];
    spawnQueue.push({ def: defOfHero(h), star: round >= 8 ? 2 : 1 });
  }
  if (phase === "fight") {
    popups.push({ x: COLS / 2 - 0.5, y: 1, text: `曹军第 ${wave}/${waveTotal} 波来袭！`, color: "#b83420", born: performance.now(), big: true });
    playSfx("Se_m_06", 0.5);
  }
  refreshStats();
}
// 从顶部入场一个敌人（随机空位列，自上滑入）
function spawnOneEnemy(q) {
  const cols = [];
  for (let c = 0; c < COLS; c++) if (!alive().some(v => v.col === c && v.row === 0)) cols.push(c);
  if (!cols.length) { spawnQueue.unshift(q); return false; }   // 顶行满，稍后再试
  // 第1关教学：敌人只走中间3列
  const laneOk = round === 1 ? cols.filter(x => x >= 1 && x <= 3) : cols;
  const useCols = laneOk.length ? laneOk : cols;
  // 导演：60%概率压主攻列
  let c;
  const openMain = mainCols.filter(m => useCols.includes(m));
  if (openMain.length && Math.random() < 0.6) c = openMain[Math.floor(Math.random() * openMain.length)];
  else c = useCols[Math.floor(Math.random() * useCols.length)];
  const u = makeUnit(q.def, "foe", c, 0, q.star);
  u.y = -1.1;                       // 自上滑入
  if (u.hero) {
    popups.push({ x: c, y: 1, text: `曹将 ${u.name} 讨阵！`, color: "#8a2818", born: performance.now(), big: true });
    playSfx("Se_m_06", 0.5);
  }
  u.nextActAt = performance.now() + 900 + Math.random() * 500;
  units.push(u);
  return true;
}
// 敌人触底：扣玩家血
let breachCount = 0;
let bottomFlashUntil = 0;
function breach(u) {
  const col = u.col;
  u.state = "dead"; u.deadAt = performance.now() - 9999;   // 冲到墙下，不播阵亡动画
  breachCount++;
  bottomFlashUntil = performance.now() + 450;
  if (walls[col] === 2) {
    // 首次触底：滚木反杀，整列敌人全灭（不给击杀金），墙留缺口
    walls[col] = 1;
    rollLogs.push({ col, born: performance.now() });
    for (const v of alive("foe")) {
      if (v.col !== col) continue;
      v.hp = 0; v.state = "dead"; v.deadAt = performance.now();
      spawnShreds(v, 5);
    }
    popups.push({ x: col, y: ROWS - 2, text: "滚木出击！", color: "#8a5a10", born: performance.now(), big: true });
    setStatus(`第${col + 1}路城墙破口！点缺口花${WALL_FIX_COST}金可修复`);
    playSfx("Se_m_28", 0.5);
    doShake(10);
  } else if (walls[col] === 1) {
    // 缺口再破：城破，游戏失败
    walls[col] = 0;
    popups.push({ x: col, y: ROWS - 1, text: "城 破 ！", color: "#8a1810", born: performance.now(), big: true });
    doShake(14);
  }
  thock(60, 0.2, 0.35);
  refreshStats();
}
function fixWall(col) {
  if (walls[col] !== 1) return;
  if (gold < WALL_FIX_COST) { showGridToast(`修墙还差 ${WALL_FIX_COST - gold} 金`); playSfx("Se_m_19", 0.3); return; }
  gold -= WALL_FIX_COST;
  walls[col] = 2;
  popups.push({ x: col, y: ROWS - 1, text: "城墙修复", color: "#5a7a3a", born: performance.now(), big: true });
  playSfx("Se_m_25", 0.5);
  refreshStats();
}

// ---------- 字盘：多排连线找名字 ----------
const GRID_COLS = 8, GRID_ROWS = 3;
const G_CELL = 45, G_GAP = 3, G_PAD = 3;
const HERO_PRICE = 5;
const DEPLOY_ROWS_N = 2;   // 新制部署行数
let grid = [];                 // grid[r][c] = {type:"name"|"class", char, clsId?}
let gridPath = [];             // 选字序列 [{r,c}]
let gridShakeUntil = 0;
let hintChars = new Set();     // （废弃字段，保留避免残留引用报错）
let hintCells = new Set();     // 存在相邻可连路径的格子 "r,c"（微光提示）
let gridToast = null;          // 字盘中央大提示 {text, born}
function showGridToast(text) { gridToast = { text, born: performance.now() }; }
// 当前选字组合的价格（无效组合返回 null）
function pathCost(path) {
  if (!path.length) return null;
  const cells = path.map(p => grid[p.r][p.c]);
  if (cells.some(x => !x)) return null;
  const h = heroByString(pathString(path));
  if (h) return heroPriceOf(h);
  if (cells.every(x => x.type === "class" && x.clsId === cells[0].clsId)) {
    const C = CLASS_CHARS.find(x => x.id === cells[0].clsId);
    return C.cost * path.length;
  }
  return null;
}
function computeHints() {
  hintCells = new Set();
  const dirs = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) dirs.push([dr, dc]);
  const charAt = (r, c) => (grid[r] && grid[r][c]) ? grid[r][c].char : null;
  function dfs(seq, idx, r, c, visited, path) {
    if (charAt(r, c) !== seq[idx]) return null;
    const key = r + "," + c;
    if (visited.has(key)) return null;
    if (idx === seq.length - 1) return [...path, key];
    visited.add(key);
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      const got = dfs(seq, idx + 1, nr, nc, visited, [...path, key]);
      if (got) { visited.delete(key); return got; }
    }
    visited.delete(key);
    return null;
  }
  const WORD_SEQS = HERO_LIST.map(h => h.chars).concat(WEAPONS.map(w => w.chars));
  for (const chars of WORD_SEQS) {
    let found = null;
    for (const seq of [chars, [...chars].slice().reverse()]) {
      for (let r = 0; r < GRID_ROWS && !found; r++) for (let c = 0; c < GRID_COLS && !found; c++) {
        found = dfs(seq, 0, r, c, new Set(), []);
      }
      if (found) break;
    }
    if (found) found.forEach(k => hintCells.add(k));
  }
}

function randGridCell() {
  // 第1关只出姓字（连不成任何名，武将绝对为0，但预告系统存在）
  const namePool = round <= 1 ? ["刘", "关", "张", "黄"] : round <= 3 ? NAME_CHARS_T2 : NAME_CHARS;
  const nameProb = round <= 1 ? 0.15 : round === 2 ? 0.35 : 0.5;
  if (Math.random() < nameProb) {
    return { type: "name", char: namePool[Math.floor(Math.random() * namePool.length)] };
  }
  const odds = SHOP_ODDS[level];
  let roll = Math.random() * 100, cost = 1;
  for (let c = 0; c < 4; c++) { roll -= odds[c]; if (roll <= 0) { cost = c + 1; break; } }
  if (cost > 3) cost = 3;
  const pool = CLASS_CHARS.filter(r => r.cost === cost);
  const C = pool[Math.floor(Math.random() * pool.length)];
  return { type: "class", char: C.char, clsId: C.id };
}
// 保底埋名（wordfind式重叠最大化：路径与已有字重合越多越优先）
function tryWalkPath(len) {
  const path = [[Math.floor(Math.random() * GRID_ROWS), Math.floor(Math.random() * GRID_COLS)]];
  while (path.length < len) {
    const [r, c] = path[path.length - 1];
    const opts = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if ((dr || dc) && nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS &&
          !path.some(p => p[0] === nr && p[1] === nc)) opts.push([nr, nc]);
    }
    if (!opts.length) return null;
    path.push(opts[Math.floor(Math.random() * opts.length)]);
  }
  return path;
}
function overlapScore(path, chars) {
  let sc = 0;
  path.forEach(([r, c], i) => {
    const cell = grid[r][c];
    if (cell && cell.char === chars[i]) sc += 2;   // 复用已有字：盘面密度up
  });
  return sc;
}
function buryHeroName() {
  const owned = new Set();
  for (const u of units) if (u.side === "me" && u.hero) owned.add(u.name);
  for (const u of bench) if (u && u.hero) owned.add(u.name);
  // tier门槛：第3关前只埋二流；4-6关一半概率出一流；第7关起七成一流
  const t1Chance = round <= 3 ? 0 : round <= 6 ? 0.5 : 0.7;
  const wantT1 = Math.random() < t1Chance;
  let pool = HERO_LIST.filter(h => !owned.has(h.name) && (wantT1 ? h.tier === 1 : h.tier === 2));
  if (!pool.length) pool = HERO_LIST.filter(h => !owned.has(h.name));
  if (!pool.length) pool = HERO_LIST;
  const h = pool[Math.floor(Math.random() * pool.length)];
  let best = null, bestScore = -1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const path = tryWalkPath(h.chars.length);
    if (!path) continue;
    const sc = overlapScore(path, h.chars);
    if (sc > bestScore) { bestScore = sc; best = path; }
  }
  if (best) best.forEach(([r, c], i) => grid[r][c] = { type: "name", char: h.chars[i] });
}
// 神兵埋词：只沿直线埋（横竖斜，5字仅横），武器字不进随机池
function buryWeaponName() {
  const ownedW = new Set(inventory.filter(k => k.startsWith("w_")));
  for (const u of [...units, ...bench]) if (u) for (const k of (u.items || [])) if (k.startsWith("w_")) ownedW.add(k);
  const pool = WEAPONS.filter(w => !ownedW.has("w_" + w.id));
  if (!pool.length) return;
  const w = pool[Math.floor(Math.random() * pool.length)];
  const L = w.chars.length;
  const dirs = [[0, 1], [0, -1]];
  if (L <= GRID_ROWS) dirs.push([1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]);
  let best = null, bestScore = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)];
    const r0 = Math.floor(Math.random() * GRID_ROWS), c0 = Math.floor(Math.random() * GRID_COLS);
    const rEnd = r0 + dr * (L - 1), cEnd = c0 + dc * (L - 1);
    if (rEnd < 0 || rEnd >= GRID_ROWS || cEnd < 0 || cEnd >= GRID_COLS) continue;
    const path = [];
    for (let i = 0; i < L; i++) path.push([r0 + dr * i, c0 + dc * i]);
    const sc = overlapScore(path, w.chars);
    if (sc > bestScore) { bestScore = sc; best = path; }
  }
  if (best) best.forEach(([r, c], i) => grid[r][c] = { type: "wep", char: w.chars[i] });
}
let refreshCount = 0;      // 本关已手动换盘次数
let panLines = 0;          // 本盘成功连线次数
let panCleared = false;    // 本盘清盘奖已发
const refreshCost = () => Math.min(4, 1 + refreshCount);
function regenGrid(free) {
  if (!free) {
    if (phase !== "fight") return;
    const c = refreshCost();
    if (gold < c) { showGridToast(`还差 ${c - gold} 金`); playSfx("Se_m_19", 0.3); return; }
    gold -= c;
    refreshCount++;
  }
  panLines = 0; panCleared = false;
  grid = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < GRID_COLS; c++) grid[r].push(randGridCell());
  }
  // 武将稀缺曲线：第1关零武将纯学兵种，第2关50%出二流，第3关起必埋
  const heroChance = round <= 1 ? 0 : round === 2 ? 0.5 : 1;
  if (Math.random() < heroChance) buryHeroName();
  if (round >= 5 && Math.random() < 0.35) buryHeroName();
  if (round >= 4 && Math.random() < 0.3) buryWeaponName();   // 神兵第4关起现世（与一流将同步）
  gridPath = [];
  computeHints();
  refreshStats();
}
// 消掉路径上的字：列内带缓动下落，顶部补新字滑入，消位留金墨印痕
const gridMarks = [];   // 消字印痕 {x,y,born}
let gridWave = null;   // {born, cr, cc} 成名波浪
function consumePath(path) {
  const now = performance.now();
  panLines++;
  if (path.length >= 2) {
    const mid = path[Math.floor(path.length / 2)];
    gridWave = { born: now, cr: mid.r, cc: mid.c };
  }
  path.forEach((p, i) => {
    const { x, y } = cellXY(p.r, p.c);
    gridMarks.push({ x: x + G_CELL / 2, y: y + G_CELL / 2, born: now + i * 45 });
    grid[p.r][p.c] = null;
  });
  for (let c = 0; c < GRID_COLS; c++) {
    const col = [];
    for (let r = GRID_ROWS - 1; r >= 0; r--) if (grid[r][c]) col.push({ cell: grid[r][c], fromR: r });
    for (let r = GRID_ROWS - 1; r >= 0; r--) {
      const k = GRID_ROWS - 1 - r;
      if (col[k]) {
        grid[r][c] = col[k].cell;
        if (col[k].fromR !== r) grid[r][c].drop = { dy: (col[k].fromR - r) * (G_CELL + G_GAP), born: now };
        else delete grid[r][c].drop;
      } else {
        grid[r][c] = randGridCell();
        grid[r][c].drop = { dy: -(r + 1.6) * (G_CELL + G_GAP), born: now + 60 };
      }
    }
  }
  computeHints();
  // 清盘奖：盘中可连名字全部挖尽（至少连过2次）→ 奖金+免费新盘
  if (phase === "fight" && !panCleared && panLines >= 2 && hintCells.size === 0) {
    panCleared = true;
    gold += 2;
    showGridToast("一盘挖尽！+2金 · 免费新盘");
    playSfx("Se_m_28", 0.45);
    setTimeout(() => { if (phase === "fight") regenGrid(true); refreshStats(); }, 900);
  }
}
function pathString(path) { return path.map(p => grid[p.r][p.c].char).join(""); }
function heroByString(s) {
  const rev = s.split("").reverse().join("");
  return HERO_LIST.find(h => h.chars.join("") === s || h.chars.join("") === rev) || null;
}
// 连线结算
// 一笔直线判定（横/竖/斜等步进）→ 8折奖励
function isStraightPath(path) {
  if (path.length < 2) return false;
  const dr = Math.sign(path[1].r - path[0].r), dc = Math.sign(path[1].c - path[0].c);
  for (let i = 1; i < path.length; i++) {
    if (path[i].r - path[i - 1].r !== dr || path[i].c - path[i - 1].c !== dc) return false;
  }
  return true;
}
function commitPath(path) {
  if (!path.length) return "invalid";
  const straight = isStraightPath(path);
  const disc = c => straight ? Math.max(1, Math.ceil(c * 0.8)) : c;
  const cells = path.map(p => grid[p.r][p.c]);
  // 单点兵种字：直接买1星
  if (path.length === 1) {
    const cell = cells[0];
    if (cell.type !== "class") { setStatus("单字不能上场——点其他字凑出名将！"); gridShakeUntil = performance.now() + 300; return "invalid"; }
    const C = CLASS_CHARS.find(x => x.id === cell.clsId);
    if (gold < C.cost) { setStatus(`军资不足（${C.cost}金）`); showGridToast(`还差 ${C.cost - gold} 金`); playSfx("Se_m_19", 0.3); return "keep"; }
    const slot = bench.indexOf(null);
    if (slot === -1) { setStatus("备战席已满！先上阵或回收"); showGridToast("备战席已满"); playSfx("Se_m_19", 0.3); return "keep"; }
    gold -= C.cost;
    bench[slot] = makeUnit(defOfClassChar(C), "me", null, null, 1);
    consumePath(path);
    checkMerge("" + C.id, 1);
    playSfx("Se_m_21", 0.35);
    refreshStats(); renderSyn();
    return "ok";
  }
  // 同兵种字连线：合成高星兵（2字=2星 3字=3星）
  if (cells.every(x => x.type === "class" && x.clsId === cells[0].clsId) && path.length <= 3) {
    const C = CLASS_CHARS.find(x => x.id === cells[0].clsId);
    const star = path.length;
    const cost = disc(C.cost * path.length);
    if (gold < cost) { setStatus(`军资不足（${star}星${CLASSES[C.cls].name}需${cost}金）`); showGridToast(`还差 ${cost - gold} 金`); playSfx("Se_m_19", 0.3); return "keep"; }
    const slot = bench.indexOf(null);
    if (slot === -1) { setStatus("备战席已满！先上阵或回收"); showGridToast("备战席已满"); playSfx("Se_m_19", 0.3); return "keep"; }
    gold -= cost;
    bench[slot] = makeUnit(defOfClassChar(C), "me", null, null, star);
    consumePath(path);
    popups.push({ x: COLS / 2 - 0.5, y: ROWS - 2, text: `${star}星${CLASSES[C.cls].name}成军！${straight ? "（一线贯通·8折）" : ""}`, color: "#8a2818", born: performance.now(), big: true });
    playSfx("Se_m_28", 0.4);
    refreshStats(); renderSyn();
    return "ok";
  }
  // 连成武将名
  const h = heroByString(pathString(path));
  if (h) {
    const hp = disc(heroPriceOf(h));
    if (gold < hp) { setStatus(`军资不足（征募${h.name}需${hp}金）`); showGridToast(`还差 ${hp - gold} 金`); playSfx("Se_m_19", 0.3); return "keep"; }
    const slot = bench.indexOf(null);
    if (slot === -1) { setStatus("备战席已满！先上阵或回收"); showGridToast("备战席已满"); playSfx("Se_m_19", 0.3); return "keep"; }
    gold -= hp;
    if (straight) showGridToast("一线贯通 · 8折征募！");
    const nu = makeUnit(defOfHero(h), "me", null, null, 1);
    bench[slot] = nu;
    consumePath(path);
    heroAnim = { name: h.name, chars: h.chars, born: performance.now() };
    playSfx("Se_m_28", 0.7);
    doShake(h.tier === 1 ? 9 : 5);
    if (h.tier === 1) showGridToast(`一流名将 ${h.name} 应募！`);
    claimWeapons(nu);
    checkMerge(nu.defId, 1);
    setStatus(`${h.name} 应募登场！`);
    refreshStats(); renderSyn(); renderInv();
    return "ok";
  }
  // 连成神兵：自动认主（本命在场即装，不在则待其上阵自动装）
  const w = weaponByString(pathString(path));
  if (w) {
    consumePath(path);
    const k = "w_" + w.id;
    const owner = [...units, ...bench].find(v => v && v.side === "me" && v.hero && v.defId === w.hero && v.state !== "dead" && v.items.length < 2);
    popups.push({ x: COLS / 2 - 0.5, y: ROWS - 2, text: `⚔ ${w.name} 出世！`, color: "#8a6a10", born: performance.now(), big: true });
    playSfx("Se_m_28", 0.7);
    doShake(5);
    if (owner) {
      owner.items.push(k);
      bakeStats(owner, null);
      popup(owner, `⚔ ${w.name} 认主！`, "#8a6a10", true);
      showGridToast(`${w.name} 认主 ${owner.name}！`);
      setStatus(`${w.name} 认主 ${owner.name}——神兵共鸣！`);
    } else {
      stashWeapon(k);
      showGridToast(`神兵【${w.name}】出世！`);
      setStatus(`${w.name} 出世！待 ${(HEROES[w.hero] || {}).name} 应募自动认主`);
    }
    refreshStats();
    return "ok";
  }
  gridShakeUntil = performance.now() + 300;
  setStatus(`「${pathString(path)}」不成名字，再找找`);
  return "invalid";
}
// 三合一升星（兵种字/姓名字通用；武将同名也可）
function checkMerge(defId, star) {
  if (star >= 3) return;
  const isHero = HERO_LIST.some(h => h.id === defId);
  const need = isHero ? 2 : 3;   // 英雄 2 合 1，小兵字 3 合 1
  const mine = [];
  for (const u of units) if (u.side === "me" && u.defId === defId && u.star === star && u.state !== "dead") mine.push({ u, from: "field" });
  bench.forEach((u, i) => { if (u && u.defId === defId && u.star === star) mine.push({ u, from: "bench", idx: i }); });
  if (mine.length < need) return;
  const three = mine.slice(0, need);
  const allItems = three.flatMap(x => x.u.items);
  const fieldOne = three.find(x => x.from === "field");
  for (const x of three) {
    if (x.from === "field") units = units.filter(u => u !== x.u);
    else bench[x.idx] = null;
  }
  const keep = allItems.slice(0, 2);
  inventory.push(...allItems.slice(2));
  const def = defById(defId);
  const nu = makeUnit(def, "me", fieldOne ? fieldOne.u.col : null, fieldOne ? fieldOne.u.row : null, star + 1, keep);
  if (fieldOne) {
    units.push(nu);
    spawnFx("Meff_13", nu.col, nu.row, 1.6);
    popup(nu, nu.name + " ★" + nu.star, "#8a2818", true);
  } else {
    bench[bench.indexOf(null)] = nu;
  }
  playSfx("Se_m_28", 0.5);
  if (selected && three.some(x => x.u === selected)) selected = null;
  checkMerge(defId, star + 1);
  setStatus(`${nu.name} 升到 ${star + 1} 星！`);
  renderInv();
}

// ---------- 拼名合体 ----------
let heroAnim = null;    // 合体演出 {name, born}
function myCharUnits() {
  const arr = [];
  for (const u of units) if (u.side === "me" && u.kind === "name" && u.state !== "dead") arr.push(u);
  for (const u of bench) if (u && u.kind === "name") arr.push(u);
  return arr;
}
// 检查两个字能否合体，返回英雄def
function comboOf(a, b) {
  if (!a || !b || a.kind !== "name" || b.kind !== "name") return null;
  for (const h of HERO_LIST) {
    const need = h.chars.slice();
    if ((need[0] === a.char && need[1] === b.char) || (need[0] === b.char && need[1] === a.char)) {
      // 同名武将已在阵中则不能重复合
      if (units.some(v => v.side === "me" && v.hero && v.name === h.name) ||
          bench.some(v => v && v.hero && v.name === h.name)) continue;
      return h;
    }
  }
  return null;
}
function tryCombine(a, b) {
  if (!a || !b || a.isWeapon || b.isWeapon) return false;
  const h = comboOf(a, b);
  if (!h) return false;
  const star = Math.min(a.star, b.star);
  const items = [...a.items, ...b.items];
  // 位置优先取场上者（b优先，因为是玩家后点的）
  const spot = b.col !== null ? b : (a.col !== null ? a : null);
  const col = spot ? spot.col : null, row = spot ? spot.row : null;
  // 移除两字
  for (const x of [a, b]) {
    const bi = bench.indexOf(x);
    if (bi >= 0) bench[bi] = null;
    units = units.filter(v => v !== x);
  }
  inventory.push(...items.slice(2));
  const nu = makeUnit(defOfHero(h), "me", col, row, star, items.slice(0, 2));
  if (col !== null) {
    units.push(nu);
    spawnFx("Meff_13", col, row, 1.8);
    spawnFx("Meff_5", col, row, 1.5);
  } else {
    const slot = bench.indexOf(null);
    bench[slot] = nu;
  }
  heroAnim = { name: h.name, chars: h.chars, born: performance.now() };
  playSfx("Se_m_28", 0.7);
  doShake(6);
  selected = null;
  setStatus(`「${h.chars[0]}」「${h.chars[1]}」合体，${h.name} 登场！`);
  refreshStats(); renderSyn(); renderInv();
  return true;
}
// 提示当前可合体的组合
function hintCombos() {
  const chars = myCharUnits();
  for (let i = 0; i < chars.length; i++) for (let j = i + 1; j < chars.length; j++) {
    if (comboOf(chars[i], chars[j])) {
      setStatus(`「${chars[i].char}」+「${chars[j].char}」可合体！点选一个再点另一个`);
      return;
    }
  }
}
function sellSelected() {
  if (!selected || phase !== "fight") return;
  gold += sellValue(selected);
  const su = selected;
  for (const k of (su.items || [])) { if (k.startsWith("w_")) setTimeout(() => stashWeapon(k), 0); else inventory.push(k); }
  units = units.filter(u => u !== selected);
  const bi = bench.indexOf(selected);
  if (bi >= 0) bench[bi] = null;
  selected = null;
  refreshStats(); renderShop(); renderSyn(); renderInv();
}
function sellWeaponToken(t, slot) {
  bench[slot] = null;
  gold += 3;
  popups.push({ x: COLS / 2 - 0.5, y: ROWS - 2, text: `${t.name} 折卖 +3金`, color: "#8a6a10", born: performance.now() });
  playSfx("Se_m_19", 0.4);
  refreshStats();
}

// ---------- 经验 ----------
function buyXp() {
  if (phase !== "fight" || gold < 4 || level >= LEVEL_MAX) return;
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

// ---------- 字盘 UI（独立小画布，主渲染循环里每帧画） ----------
const gridCv = document.getElementById("gridCv");
gridCv.width = G_PAD * 2 + GRID_COLS * G_CELL + (GRID_COLS - 1) * G_GAP;
gridCv.height = G_PAD * 2 + GRID_ROWS * G_CELL + (GRID_ROWS - 1) * G_GAP;
const gtx = gridCv.getContext("2d");

const cellXY = (r, c) => ({
  x: G_PAD + c * (G_CELL + G_GAP),
  y: G_PAD + r * (G_CELL + G_GAP),
});
function gridCellAt(px, py) {
  for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) {
    const { x, y } = cellXY(r, c);
    if (px >= x && px < x + G_CELL && py >= y && py < y + G_CELL) return { r, c };
  }
  return null;
}
function drawGrid(now) {
  gtx.save();
  if (now < gridShakeUntil) gtx.translate((Math.random() - 0.5) * 8, 0);
  gtx.clearRect(-8, -8, gridCv.width + 16, gridCv.height + 16);
  const inPath = (r, c) => gridPath.some(p => p.r === r && p.c === c);
  const pcost = pathCost(gridPath);
  const poor = pcost !== null && pcost > gold;   // 凑得出但买不起
  // 墨迹连线：红墨主笔 + 金细线（买不起=灰红）
  if (gridPath.length > 1) {
    const straightNow = isStraightPath(gridPath);
    const inks = poor
      ? [["rgba(120,80,72,.7)", straightNow ? 8 : 5], ["rgba(190,150,140,.55)", 1.6]]
      : straightNow
        ? [["rgba(184,137,28,.5)", 14], ["rgba(160,40,24,.9)", 6], ["rgba(255,225,150,.95)", 2]]
        : [["rgba(160,40,24,.85)", 5], ["rgba(255,210,120,.9)", 1.6]];
    for (const [color, width] of inks) {
      gtx.strokeStyle = color;
      gtx.lineWidth = width; gtx.lineCap = "round"; gtx.lineJoin = "round";
      gtx.beginPath();
      gridPath.forEach((p, i) => {
        const { x, y } = cellXY(p.r, p.c);
        if (i === 0) gtx.moveTo(x + G_CELL / 2, y + G_CELL / 2);
        else gtx.lineTo(x + G_CELL / 2, y + G_CELL / 2);
      });
      gtx.stroke();
    }
  }
  // 消字印痕：金环+墨圈扩散
  for (let i = gridMarks.length - 1; i >= 0; i--) {
    const m = gridMarks[i];
    if (now < m.born) continue;
    const t = (now - m.born) / 400;
    if (t >= 1) { gridMarks.splice(i, 1); continue; }
    gtx.globalAlpha = 1 - t;
    gtx.strokeStyle = "rgba(184,137,28,.7)";
    gtx.lineWidth = 2.5;
    gtx.beginPath(); gtx.arc(m.x, m.y, 10 + 26 * t, 0, Math.PI * 2); gtx.stroke();
    gtx.strokeStyle = "rgba(90,70,40,.4)";
    gtx.lineWidth = 5;
    gtx.beginPath(); gtx.arc(m.x, m.y, 5 + 18 * t, 0, Math.PI * 2); gtx.stroke();
    gtx.globalAlpha = 1;
  }
  for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) {
    const cell = grid[r] && grid[r][c];
    if (!cell) continue;
    let { x, y } = cellXY(r, c);
    // 成名波浪：金光从路径中心扩散，全盘字块依次弹跳
    if (gridWave) {
      const wAge = (now - gridWave.born) / 1000;
      if (wAge > 1.4) gridWave = null;
      else {
        const wDist = Math.hypot(r - gridWave.cr, c - gridWave.cc);
        const wt = wAge * 7 - wDist * 0.8;
        if (wt > 0 && wt < 1.1) y -= Math.sin(Math.min(1, wt) * Math.PI) * 7 * Math.max(0, 1 - wAge * 0.6);
      }
    }
    // 掉落动画：缓动+轻微回弹
    if (cell.drop) {
      const dt = (now - cell.drop.born) / 320;
      if (dt >= 1) delete cell.drop;
      else if (dt > 0) {
        const q = dt - 1;
        const e = 1 + 2.2 * q * q * q + 1.2 * q * q;   // easeOutBack 轻过冲
        y += cell.drop.dy * (1 - e);
      } else {
        y += cell.drop.dy;
      }
    }
    const sel = inPath(r, c);
    const hinted = (cell.type === "name" || cell.type === "wep") && hintCells.has(r + "," + c);
    const rs = TILE_CORNERS[(r * GRID_COLS + c) % 4];
    // 硬阴影
    gtx.fillStyle = "rgba(58,47,36,.2)";
    roundRectGU(x + 2, y + 2, G_CELL, G_CELL, rs);
    gtx.fill();
    if ((hinted || sel)) {
      gtx.shadowColor = (sel && poor) ? "#a05040" : "#d4a434";
      gtx.shadowBlur = sel ? 12 : 7 + 5 * Math.sin(now / 260);
    }
    // 牌底
    const g = gtx.createLinearGradient(x, y, x + G_CELL, y + G_CELL);
    if (sel) { g.addColorStop(0, "#fff6da"); g.addColorStop(1, "#f6e6b4"); }
    else if (cell.type === "name") { g.addColorStop(0, "#faf3e4"); g.addColorStop(1, "#f0e6cc"); }
    else if (cell.type === "wep") { g.addColorStop(0, "#faf0d4"); g.addColorStop(1, "#f0dfae"); }
    else { g.addColorStop(0, "#f7efdd"); g.addColorStop(1, "#eee1c2"); }
    gtx.fillStyle = g;
    roundRectGU(x, y, G_CELL, G_CELL, rs);
    gtx.fill();
    gtx.shadowBlur = 0;
    gtx.lineWidth = sel ? 2.5 : 2;
    gtx.strokeStyle = sel ? (poor ? "#a05040" : "#b8891c") : (cell.type === "name" ? "#8a7050" : "#3a2f24");
    gtx.stroke();
    // 字
    gtx.fillStyle = cell.type === "name" ? "#4a3020" : "#241b12";
    gtx.font = `bold ${Math.round(G_CELL * 0.56)}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
    gtx.textAlign = "center"; gtx.textBaseline = "middle";
    gtx.fillText(cell.char, x + G_CELL / 2, y + G_CELL / 2 + 1);
    // 兵种字：右下角小数字标价格
    if (cell.type === "class") {
      const C = CLASS_CHARS.find(v => v.id === cell.clsId);
      if (C) {
        gtx.fillStyle = "#9a8050";
        gtx.font = "bold 10px sans-serif";
        gtx.fillText(C.cost, x + G_CELL - 8, y + G_CELL - 8);
      }
    }
  }
  // 中央大提示（军资不足等）
  if (gridToast) {
    const t = (now - gridToast.born) / 950;
    if (t >= 1) gridToast = null;
    else {
      const a = t < 0.12 ? t / 0.12 : t > 0.7 ? (1 - t) / 0.3 : 1;
      gtx.save();
      gtx.globalAlpha = Math.max(0, a);
      const cx = gridCv.width / 2, cy = gridCv.height / 2;
      gtx.font = 'bold 21px "Kaiti SC", "STKaiti", "KaiTi", serif';
      const w = gtx.measureText(gridToast.text).width + 44;
      gtx.fillStyle = "rgba(138,40,24,.94)";
      roundRectGU(cx - w / 2, cy - 22, w, 44, [8, 6, 9, 7]);
      gtx.fill();
      gtx.strokeStyle = "#5a140c"; gtx.lineWidth = 2; gtx.stroke();
      gtx.fillStyle = "#f8e8c8";
      gtx.textAlign = "center"; gtx.textBaseline = "middle";
      gtx.fillText(gridToast.text, cx, cy + 1 + (t < 0.12 ? (1 - a) * 8 : 0));
      gtx.textBaseline = "alphabetic";
      gtx.restore();
    }
  }
  gtx.textBaseline = "alphabetic";
  gtx.restore();
}
function roundRectGU(x, y, w, h, rs) {
  gtx.beginPath();
  gtx.moveTo(x + rs[0], y);
  gtx.arcTo(x + w, y, x + w, y + h, rs[1]);
  gtx.arcTo(x + w, y + h, x, y + h, rs[2]);
  gtx.arcTo(x, y + h, x, y, rs[3]);
  gtx.arcTo(x, y, x + w, y, rs[0]);
  gtx.closePath();
}
function roundRectG(x, y, w, h, r) {
  gtx.beginPath();
  gtx.moveTo(x + r, y);
  gtx.arcTo(x + w, y, x + w, y + h, r);
  gtx.arcTo(x + w, y + h, x, y + h, r);
  gtx.arcTo(x, y + h, x, y, r);
  gtx.arcTo(x, y, x + w, y, r);
  gtx.closePath();
}
// ---------- 选字交互：点选凑名（无需相邻）+ 拖划兼容 ----------
let gridDragging = false, dragMoved = false, downCell = null;
let confirmAt = 0;   // 同字选中后自动合成的倒计时（rAF 检查）
function armAutoConfirm() {
  confirmAt = 0;
  if (gridPath.length >= 2) {
    const cells = gridPath.map(p => grid[p.r][p.c]);
    if (cells.every(x => x.type === "class" && x.clsId === cells[0].clsId)) {
      confirmAt = performance.now() + 950;
    }
  }
}
function gridPos(e) {
  const rect = gridCv.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (gridCv.width / rect.width),
    y: (e.clientY - rect.top) * (gridCv.height / rect.height),
  };
}
// 当前序列是否是某个目标的合法前缀
function isPrefixValid(path) {
  if (!path.length) return false;
  const s = pathString(path);
  const rev = s.split("").reverse().join("");
  for (const h of HERO_LIST) {
    const full = h.chars.join("");
    if (full.startsWith(s) || full.startsWith(rev)) return true;
  }
  for (const w of WEAPONS) {
    if (w.name.startsWith(s) || w.name.startsWith(rev)) return true;
  }
  const cells = path.map(p => grid[p.r][p.c]);
  if (cells.every(x => x.type === "class" && x.clsId === cells[0].clsId) && path.length <= 3) return true;
  return false;
}
function candidatesFor(path) {
  const s = pathString(path);
  const rev = s.split("").reverse().join("");
  const names = HERO_LIST.filter(h => {
    const full = h.chars.join("");
    return (full.startsWith(s) || full.startsWith(rev)) && full.length > s.length;
  }).map(h => h.name);
  const weps = WEAPONS.filter(w =>
    (w.name.startsWith(s) || w.name.startsWith(rev)) && w.name.length > s.length
  ).map(w => "⚔" + w.name);
  return names.concat(weps);
}
function gridPathPreview() {
  if (!gridPath.length) { setStatus(); return; }
  const s = pathString(gridPath);
  const h = heroByString(s);
  const cells = gridPath.map(p => grid[p.r][p.c]);
  if (h) { setStatus(`「${s}」→ ${h.name}！`); return; }
  const sameClass = cells.every(x => x.type === "class" && x.clsId === cells[0].clsId);
  const cand = candidatesFor(gridPath);
  if (gridPath.length === 1) {
    if (cells[0].type === "class") {
      const C = CLASS_CHARS.find(v => v.id === cells[0].clsId);
      setStatus(`「${s}」${cand.length ? "可组：" + cand.join("/") + "；" : ""}再点一次单买1星（${C.cost}金）`);
    } else setStatus(`「${s}」可组：${cand.join("/") || "—"}`);
  } else if (sameClass) {
    const C = CLASS_CHARS.find(v => v.id === cells[0].clsId);
    setStatus(`${gridPath.length}个${C.char}：稍候自动合成${gridPath.length}星（${C.cost * gridPath.length}金）${gridPath.length < 3 ? " · 快点第三个合3星" : ""}`);
  } else setStatus(`「${s}」可组：${cand.join("/")}`);
}
function resetPath() { gridPath = []; setStatus(); }
// 点选一个字（无需相邻）：前缀合法就加入，完整名字自动结算；点已选末字=确认出手
function tapCell(cell) {
  confirmAt = 0;
  const last = gridPath[gridPath.length - 1];
  if (last && last.r === cell.r && last.c === cell.c) {   // 重复点末字：立即确认
    if (commitPath(gridPath) !== "keep") gridPath = [];
    else armAutoConfirm();
    return;
  }
  if (gridPath.some(p => p.r === cell.r && p.c === cell.c)) {   // 点了序列中其他字：移出
    gridPath = gridPath.filter(p => !(p.r === cell.r && p.c === cell.c));
    gridPathPreview(); armAutoConfirm();
    return;
  }
  // 消消乐规则：必须与序列末尾相邻（横竖斜八方向）
  if (gridPath.length) {
    const lastP = gridPath[gridPath.length - 1];
    if (Math.abs(cell.r - lastP.r) > 1 || Math.abs(cell.c - lastP.c) > 1) {
      if (gridPath.length >= 2) {           // 已有连线：抖动保留，避免误触丢串
        gridShakeUntil = performance.now() + 260;
        setStatus("要点相邻的字才能连（横竖斜都行）");
        return;
      }
      gridPath = [cell];                    // 只有一个字：直接换起点
      if (!isPrefixValid(gridPath)) gridPath = [];
      gridPathPreview();
      return;
    }
  }
  const trial = [...gridPath, cell];
  if (isPrefixValid(trial)) {
    gridPath = trial;
    const s = pathString(gridPath);
    if (heroByString(s) || weaponByString(s)) {   // 凑成名字/神兵：自动结算
      if (commitPath(gridPath) !== "keep") gridPath = [];
      return;
    }
    const cs = gridPath.map(p => grid[p.r][p.c]);
    if (gridPath.length === 3 && cs.every(x => x.type === "class" && x.clsId === cs[0].clsId)) {
      if (commitPath(gridPath) !== "keep") gridPath = [];   // 三同字：自动合成
      return;
    }
    gridPathPreview();
    armAutoConfirm();               // 两同字：约1秒后自动合成
    playSfx("Se_m_21", 0.15);
  } else {
    gridShakeUntil = performance.now() + 260;
    gridPath = [cell];              // 无效组合：以新字重新开始
    if (!isPrefixValid(gridPath)) gridPath = [];
    gridPathPreview();
  }
}
gridCv.addEventListener("pointerdown", e => {
  if (phase === "ready") { setStatus("先点「出征」——开战后边打边买将！"); return; }
  if (phase !== "fight") return;
  e.preventDefault();
  try { gridCv.setPointerCapture(e.pointerId); } catch (err) {}
  const { x, y } = gridPos(e);
  downCell = gridCellAt(x, y);
  gridDragging = true;
  dragMoved = false;
});
gridCv.addEventListener("pointermove", e => {
  if (!gridDragging || phase !== "fight") return;
  const { x, y } = gridPos(e);
  const cell = gridCellAt(x, y);
  if (!cell) return;
  // 首次移动出起点格才进入拖划模式（拖划=相邻路径，起点为按下格）
  if (!dragMoved) {
    if (downCell && (cell.r !== downCell.r || cell.c !== downCell.c)) {
      dragMoved = true;
      gridPath = [downCell];
    } else return;
  }
  const last = gridPath[gridPath.length - 1];
  if (cell.r === last.r && cell.c === last.c) return;
  if (gridPath.length >= 2) {
    const prev = gridPath[gridPath.length - 2];
    if (cell.r === prev.r && cell.c === prev.c) { gridPath.pop(); gridPathPreview(); return; }
  }
  // 快速拖动跳格：尝试补中间格
  if ((Math.abs(cell.r - last.r) > 1 || Math.abs(cell.c - last.c) > 1) && gridPath.length < 4) {
    const mr = Math.round((cell.r + last.r) / 2), mc = Math.round((cell.c + last.c) / 2);
    if (Math.abs(mr - last.r) <= 1 && Math.abs(mc - last.c) <= 1 &&
        Math.abs(cell.r - mr) <= 1 && Math.abs(cell.c - mc) <= 1 &&
        !gridPath.some(p => p.r === mr && p.c === mc)) {
      gridPath.push({ r: mr, c: mc });
    }
  }
  const nl = gridPath[gridPath.length - 1];
  if (Math.abs(cell.r - nl.r) <= 1 && Math.abs(cell.c - nl.c) <= 1 &&
      !gridPath.some(p => p.r === cell.r && p.c === cell.c) && gridPath.length < 5) {
    gridPath.push(cell);
    gridPathPreview();
  }
});
gridCv.addEventListener("pointerup", () => {
  if (!gridDragging) return;
  gridDragging = false;
  if (dragMoved) {                  // 拖划：松手结算
    if (commitPath(gridPath) !== "keep") gridPath = [];
    else armAutoConfirm();
  } else if (downCell) {            // 原地抬起：点选
    tapCell(downCell);
  }
  downCell = null;
});
function renderShop() {   // 换盘钮状态（字盘右上角）
  const btn = document.getElementById("refresh");
  btn.textContent = `换盘${refreshCost()}金`;
  btn.disabled = phase !== "fight" || gold < refreshCost();
}
function renderSyn() {
  const tiers = synergyTiers(fieldUnits());
  const { cls, fac, taoyuan } = synergyCounts(fieldUnits());
  const rows = [];
  for (const s of SYNERGIES) {
    const n = s.type === "special" ? taoyuan : s.type === "faction" ? (fac[s.key] || 0) : (cls[s.key] || 0);
    if (!n) continue;
    const t = tiers[s.key];
    const label = s.type === "special" ? "桃园" : s.type === "faction" ? s.key : CLASSES[s.key].name;
    const next = t >= 1 ? s.th[Math.min(1, t)] : s.th[0];
    rows.push(`<div class="badge ${t ? "on" : ""}">${label} ${n}/${next}${t ? `<small>${s.desc[t - 1]}</small>` : ""}</div>`);
  }
  const el = document.getElementById("synBadges");
  if (el) el.innerHTML = "";
}
function claimWeapons(u) {
  if (!u || !u.hero || u.side !== "me") return;
  for (let i = 0; i < bench.length; i++) {
    const t = bench[i];
    if (!t || !t.isWeapon || t.heroId !== u.defId || u.items.length >= 2) continue;
    bench[i] = null;
    u.items.push(t.wkey);
    bakeStats(u, null);
    popup(u, `⚔ ${t.name} 认主！`, "#8a6a10", true);
    playSfx("Se_m_25", 0.5);
  }
  for (let i = inventory.length - 1; i >= 0; i--) {
    const k = inventory[i];
    if (!k.startsWith("w_")) continue;
    const w = WEAPONS.find(x => "w_" + x.id === k);
    if (!w || w.hero !== u.defId || u.items.length >= 2) continue;
    inventory.splice(i, 1);
    u.items.push(k);
    bakeStats(u, null);
    popup(u, `⚔ ${w.name} 认主！`, "#8a6a10", true);
    playSfx("Se_m_25", 0.5);
  }
}
function renderInv() { return;
  const row = document.getElementById("invRow");
  row.classList.toggle("show", inventory.length > 0);
  row.innerHTML = "<span>装备▶</span>";
  inventory.forEach((k, i) => {
    const img = document.createElement("img");
    img.src = `assets/items/${ITEMS[k].icon}.png`;
    img.title = ITEMS[k].name + "：" + ITEMS[k].desc;
    img.className = selItem === i ? "sel" : "";
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
  document.getElementById("gold").textContent = gold;
  document.getElementById("waveInfo").textContent = phase === "fight" ? `波${wave}/${waveTotal}` : phase === "ready" ? "备战" : "结算";
  const ok = walls.filter(w => w === 2).length, gap = walls.filter(w => w === 1).length;
  document.getElementById("wallN").textContent = ok + (gap ? `+${gap}缺` : "");
  renderShop();
  renderHint();
}
const GRID_HINT_DEF = "👆 连相邻字凑名将 · ⚔连兵器名得神兵 · 直线8折 · 发光有路";
let lastHintMsg = GRID_HINT_DEF;
function renderHint() {
  const gh = document.getElementById("gridHint");
  if (!gh) return;
  gh.textContent = `💰${gold} 人${fieldCount()}/${popCap()} · ${lastHintMsg}`;
  gh.classList.toggle("err", /不足|已满/.test(lastHintMsg));
}
function setStatus(msg) {
  lastHintMsg = (phase === "fight" && msg) ? msg : GRID_HINT_DEF;
  renderHint();
}

// ---------- 装备穿戴 ----------
function tryEquip(u) {
  if (selItem < 0 || !u || u.side !== "me") return false;
  const k = inventory[selItem];
  if (u.items.length >= 2) { setStatus(`${u.name} 已有两件装备`); return true; }
  inventory.splice(selItem, 1);
  u.items.push(k);
  bakeStats(u, null);
  selItem = -1;
  popup(u, "装备" + ITEMS[k].name, "#4a7a9a", true);
  playSfx("Se_m_25", 0.4);
  setStatus();
  renderInv(); refreshStats();
  return true;
}

// ---------- 点击交互 ----------
function canvasPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
}
function benchSlotAt(x, y) {
  if (y < BENCH_Y0 - 6 || y > BENCH_Y0 + BENCH_TILE + 10) return -1;
  const pitch = BENCH_TILE + BENCH_GAP;
  const i = Math.round((x - BENCH_X0 - BENCH_TILE / 2) / pitch);
  if (i < 0 || i > BIN_SLOT) return -1;
  return i;
}
function handlePick(u) {
  if (u && u.isWeapon) { setStatus(`${u.name}——拖到本命 ${(HEROES[u.heroId] || {}).name} 身上装备，拖进桶折卖3金`); return; }
  // 选中另一个字时优先尝试合体
  if (selected && selected !== u && tryCombine(selected, u)) return;
  selected = selected === u ? null : u;
}
let bDragU = null, bDragPos = null, bDragStart = null, bDragMoved = false, suppressClick = false;
let bDragFrom = null;   // {type:"bench",slot} | {type:"field"}
cv.addEventListener("pointerdown", e => {
  if (phase !== "fight" || selItem >= 0) return;
  const p = canvasPos(e);
  const bi = benchSlotAt(p.x, p.y);
  if (bi >= 0 && bench[bi]) {
    bDragU = bench[bi]; bDragFrom = { type: "bench", slot: bi };
  } else {
    const col = Math.floor(p.x / TILE), row = Math.floor(p.y / TILE);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
      const u = units.find(v => v.col === col && v.row === row && v.side === "me" && v.state !== "dead");
      if (u) { bDragU = u; bDragFrom = { type: "field" }; }
    }
  }
  if (bDragU) {
    bDragPos = p; bDragStart = p; bDragMoved = false;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  }
});
cv.addEventListener("pointermove", e => {
  if (!bDragU) return;
  bDragPos = canvasPos(e);
  if (Math.abs(bDragPos.x - bDragStart.x) > 14 || Math.abs(bDragPos.y - bDragStart.y) > 14) bDragMoved = true;
  e.preventDefault();
});
function unfield(u) {                 // 场上单位离场（不结算金币）
  units = units.filter(v => v !== u);
  u.col = null; u.row = null;
}
function placeOnField(u, col, row) {   // 直接落位（调用方保证格子归属）
  u.col = col; u.row = row; u.x = col; u.y = row;
  if (!units.includes(u)) units.push(u);
  u.nextActAt = performance.now() + 500;
  spawnFx("Meff_13", col, row, 1.2);
}
cv.addEventListener("pointerup", e => {
  if (!bDragU) return;
  const p = canvasPos(e);
  const u = bDragU, from = bDragFrom;
  bDragU = null; bDragPos = null; bDragFrom = null;
  if (!bDragMoved) return;             // 未拖动：让 click 走点选流程
  suppressClick = true;
  const col = Math.floor(p.x / TILE), row = Math.floor(p.y / TILE);
  const bi = benchSlotAt(p.x, p.y);
  const inDeploy = col >= 0 && col < COLS && row >= ROWS - DEPLOY_ROWS && row < ROWS;
  if (bi === BIN_SLOT) {
    if (u.isWeapon) { sellWeaponToken(u, from.slot); setStatus(`${u.name} 折卖 +3金`); }
    else { selected = u; playSfx("Se_m_19", 0.4); sellSelected(); setStatus("已回收，金币入账"); }
  } else if (bi >= 0) {
    if (from.type === "field") {
      if (!bench[bi]) {                // 拖回备战席=下阵
        unfield(u); bench[bi] = u;
        applyFightBuffs(); renderSyn(); playSfx("Se_m_21", 0.25);
        setStatus(`${u.name} 已下阵回备战席`);
      } else setStatus("该备战位已有棋子，放旁边空位");
    } else if (bi !== from.slot) {     // 备战席内挪位/换位
      const t = bench[bi]; bench[bi] = u; bench[from.slot] = t || null;
    }
  } else if (inDeploy) {
    const occ = units.find(v => v !== u && v.col === col && v.row === row && v.side === "me" && v.state !== "dead");
    const foeOcc = units.some(v => v !== u && v.col === col && v.row === row && v.state !== "dead" && v.side === "foe");
    if (foeOcc) { setStatus("敌人占着这格，先打退它！"); }
    else if (from.type === "bench") {
      if (u.isWeapon) {                // 神兵拖到武将=装备（只认本命）
        if (occ && occ.hero && occ.defId === u.heroId && occ.items.length < 2) {
          bench[from.slot] = null;
          occ.items.push(u.wkey);
          bakeStats(occ, null);
          popup(occ, `⚔ ${u.name} 认主！`, "#8a6a10", true);
          playSfx("Se_m_25", 0.5);
        } else if (occ) setStatus(`${u.name} 只认本命 ${(HEROES[u.heroId] || {}).name}`);
        else setStatus(`${u.name} 是神兵——拖到 ${(HEROES[u.heroId] || {}).name} 身上装备`);
      } else if (occ) {                // 拖到己方棋子头上=替换：旧的回拖出的空槽
        bench[from.slot] = null;
        unfield(occ); bench[from.slot] = occ;
        placeOnField(u, col, row);
        applyFightBuffs(); renderSyn(); playSfx("Se_m_21", 0.3);
        setStatus(`${u.name} 替下 ${occ.name}`);
      } else if (tryDeploy(u, col, row)) { selected = null; playSfx("Se_m_21", 0.3); }
    } else {                           // 场上拖场上
      if (occ) {                       // 换位
        const c0 = u.col, r0 = u.row;
        occ.col = c0; occ.row = r0; occ.x = c0; occ.y = r0;
        occ.nextActAt = performance.now() + 400;
        placeOnField(u, col, row);
        playSfx("Se_m_21", 0.25);
      } else {                         // 移动
        placeOnField(u, col, row);
      }
    }
  } else if (from.type === "field") {
    setStatus("拖到部署区换位，或拖到备战席下阵、回收区卖出");
  } else {
    setStatus("只能放进部署区（下三行虚线框内）");
  }
  refreshStats();
});
cv.addEventListener("pointercancel", () => { bDragU = null; bDragPos = null; });
cv.addEventListener("click", e => {
  if (suppressClick) { suppressClick = false; return; }
  if (phase !== "fight") return;
  const { x, y } = canvasPos(e);

  if (y >= WALL_Y && y <= WALL_Y + WALL_H + 8) {
    const wc = Math.floor(x / TILE);
    if (wc >= 0 && wc < COLS && walls[wc] === 1) fixWall(wc);
    return;
  }
  const bi = benchSlotAt(x, y);
  if (bi === BIN_SLOT) {
    if (selected) { playSfx("Se_m_19", 0.4); sellSelected(); setStatus("已回收，金币入账"); }
    else setStatus("先点棋子再点桶=卖出，或直接拖进桶");
    return;
  }
  if (bi >= 0) {
    const u = bench[bi];
    if (u && tryEquip(u)) return;
    if (u) {
      handlePick(u);
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
    selected = selected === here ? null : here;   // 选中场上单位：可回收/穿装备，不可移动
    refreshStats();
    return;
  } else if (selected && row >= ROWS - DEPLOY_ROWS && !units.some(u => u.col === col && u.row === row)) {
    const fromBench = bench.indexOf(selected) >= 0;
    if (!fromBench) { setStatus("阵上单位不能移动——可点回收区卖掉重摆"); selected = null; refreshStats(); return; }
    if (tryDeploy(selected, col, row)) selected = null;
  }
  refreshStats();
});
function tryDeploy(u, col, row) {
  if (u && u.isWeapon) { setStatus(`${u.name} 是神兵——拖到本命武将身上装备`); return false; }
  if (bench.indexOf(u) < 0) return false;
  if (col < 0 || col >= COLS || row < ROWS - DEPLOY_ROWS || row >= ROWS) return false;
  if (units.some(v => v.col === col && v.row === row && v.state !== "dead")) return false;
  if (fieldCount() >= popCap()) { setStatus(`人口已满（${popCap()}），买经验升人口`); showGridToast("人口已满"); return false; }
  bench[bench.indexOf(u)] = null;
  u.col = col; u.row = row; u.x = col; u.y = row;
  units.push(u);
  u.nextActAt = performance.now() + 500;
  spawnFx("Meff_13", col, row, 1.2);
  applyFightBuffs();               // 新上场单位吃羁绊
  renderSyn();
  return true;
}

// ---------- 渲染：字牌 ----------
function drawBoard() {
  const now = performance.now();
  // 宣纸棋格
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const even = (c + r) % 2 === 0;
    ctx.fillStyle = even ? "#e9dcbc" : "#e1d2ad";
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
    ctx.fillStyle = "rgba(90,70,40,.16)";
    ctx.fillRect(c * TILE + TILE - 1, r * TILE, 1, TILE);
    ctx.fillRect(c * TILE, r * TILE + TILE - 1, TILE, 1);
  }
  // 敌区冷灰罩染
  let g = ctx.createLinearGradient(0, 0, 0, DEPLOY_ROWS * TILE);
  g.addColorStop(0, "rgba(120,105,110,.16)");
  g.addColorStop(1, "rgba(120,105,110,.04)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, COLS * TILE, DEPLOY_ROWS * TILE);
  drawDecor();
  if (performance.now() < bottomFlashUntil) {
    const fa = (bottomFlashUntil - performance.now()) / 450;
    ctx.fillStyle = `rgba(176,48,32,${0.45 * fa})`;
    ctx.fillRect(0, (ROWS - 1) * TILE, COLS * TILE, TILE);
  }
  // 城墙带：每列一段（完好=石垛+滚木待命；缺口=黑洞裂纹+修缮价）
  for (let c = 0; c < COLS; c++) {
    const wx = c * TILE;
    if (walls[c] >= 1) {
      ctx.fillStyle = walls[c] === 2 ? "#8a8072" : "#6a6058";
      ctx.fillRect(wx, WALL_Y, TILE, WALL_H);
      ctx.fillStyle = "rgba(40,32,24,.4)";
      for (let i = 0; i < 4; i++) ctx.fillRect(wx + i * 16 + ((c % 2) * 8), WALL_Y + (i % 2 === 0 ? 0 : 7), 15, 1.5);
      if (walls[c] === 2) {
        ctx.fillStyle = "#7a5a30";
        ctx.fillRect(wx + 6, WALL_Y + 4, TILE - 12, 6);
        ctx.strokeStyle = "#4a3618"; ctx.lineWidth = 1;
        ctx.strokeRect(wx + 6.5, WALL_Y + 4.5, TILE - 13, 5);
      } else {
        ctx.fillStyle = "#1c140c";
        ctx.fillRect(wx + 14, WALL_Y, TILE - 28, WALL_H);
        ctx.fillStyle = "#f0c860";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`修${WALL_FIX_COST}金`, wx + TILE / 2, WALL_Y + WALL_H / 2 + 0.5);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
    } else {
      ctx.fillStyle = "#12100c";
      ctx.fillRect(wx, WALL_Y, TILE, WALL_H);
    }
  }
  if (((selected && bench.indexOf(selected) >= 0) || (bDragU && bDragMoved)) && phase === "fight") {
    const ga = 0.4 + 0.25 * Math.sin(performance.now() / 280);
    ctx.strokeStyle = `rgba(184,137,28,${ga})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    for (let c = 0; c < COLS; c++) for (let r = ROWS - DEPLOY_ROWS; r < ROWS; r++) {
      if (units.some(v => v.col === c && v.row === r && v.state !== "dead")) continue;
      ctx.strokeRect(c * TILE + 5, r * TILE + 5, TILE - 10, TILE - 10);
    }
    ctx.setLineDash([]);
  }
  // 部署区暖罩
  const dy = (ROWS - DEPLOY_ROWS) * TILE;
  g = ctx.createLinearGradient(0, ROWS * TILE, 0, dy);
  g.addColorStop(0, "rgba(190,120,70,.14)");
  g.addColorStop(1, "rgba(190,120,70,.05)");
  ctx.fillStyle = g;
  ctx.fillRect(0, dy, COLS * TILE, DEPLOY_ROWS * TILE);
  if (phase !== "over") {
    // 描金流动虚线
    ctx.strokeStyle = "rgba(160,110,30,.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -now / 60;
    ctx.strokeRect(4, dy + 4, COLS * TILE - 8, DEPLOY_ROWS * TILE - 8);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.fillStyle = "rgba(140,95,30,.75)";
    ctx.font = '14px "Kaiti SC", "STKaiti", "KaiTi", serif';
    ctx.textAlign = "center";
    "部署区".split("").forEach((ch, i) => ctx.fillText(ch, COLS * TILE - 14, dy + 24 + i * 16));
    ctx.textAlign = "left";
  }
  // 战斗暗角
  if (phase === "fight") {
    const v = ctx.createRadialGradient(COLS * TILE / 2, ROWS * TILE * 0.45, ROWS * TILE * 0.34,
                                       COLS * TILE / 2, ROWS * TILE * 0.45, ROWS * TILE * 0.78);
    v.addColorStop(0, "rgba(40,25,10,0)");
    v.addColorStop(1, "rgba(40,25,10,.35)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
  }
  // 备战抽屉：亮色木案 + 8棋格 + 回收桶格
  ctx.fillStyle = "#cdbb96";
  ctx.fillRect(0, BENCH_Y0 - 8, cv.width, BENCH_TILE + 16);
  ctx.fillStyle = "rgba(58,47,36,.35)";
  ctx.fillRect(0, BENCH_Y0 - 8, cv.width, 2);
  for (let i = 0; i < BENCH_SIZE; i++) {
    const bx = BENCH_X0 + i * (BENCH_TILE + BENCH_GAP);
    ctx.fillStyle = "#b7a37c";
    ctx.fillRect(bx, BENCH_Y0, BENCH_TILE, BENCH_TILE);
    ctx.strokeStyle = "#8a7550";
    ctx.strokeRect(bx + 0.5, BENCH_Y0 + 0.5, BENCH_TILE - 1, BENCH_TILE - 1);
  }
  {
    const bx = BENCH_X0 + BIN_SLOT * (BENCH_TILE + BENCH_GAP);
    const hot = !!selected || !!bDragU;
    ctx.fillStyle = hot ? "#a02818" : "#8a7458";
    ctx.fillRect(bx, BENCH_Y0, BENCH_TILE, BENCH_TILE);
    ctx.strokeStyle = hot ? "#5a140c" : "#6a5a40";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + 0.75, BENCH_Y0 + 0.75, BENCH_TILE - 1.5, BENCH_TILE - 1.5);
    ctx.lineWidth = 1;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = 'bold 17px "Kaiti SC", "STKaiti", "KaiTi", serif';
    ctx.fillStyle = "#f4e4c4";
    ctx.fillText("卖", bx + BENCH_TILE / 2, BENCH_Y0 + BENCH_TILE / 2 - 5);
    ctx.font = "9px sans-serif";
    ctx.fillText(hot && selected ? `+${sellValue(selected)}金` : "回收", bx + BENCH_TILE / 2, BENCH_Y0 + BENCH_TILE - 9);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  }
}
// 地面点缀：草丛 / 石块 / 墨点（固定位置）
const DECOR = [
  { t: "g", x: 92, y: 200 }, { t: "g", x: 300, y: 252 }, { t: "g", x: 34, y: 322 }, { t: "g", x: 214, y: 128 },
  { t: "s", x: 158, y: 276 }, { t: "s", x: 330, y: 192 },
  { t: "m", x: 62, y: 100 }, { t: "m", x: 252, y: 366 },
];
function drawDecor() {
  for (const d of DECOR) {
    if (d.t === "g") {
      ctx.strokeStyle = "#6f7d4d"; ctx.lineWidth = 1.7; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(d.x + 4, d.y + 14); ctx.quadraticCurveTo(d.x + 4, d.y + 6, d.x + 3, d.y + 2);
      ctx.moveTo(d.x + 9, d.y + 14); ctx.quadraticCurveTo(d.x + 10, d.y + 6, d.x + 13, d.y + 2);
      ctx.moveTo(d.x + 14, d.y + 14); ctx.quadraticCurveTo(d.x + 16, d.y + 7, d.x + 20, d.y + 4);
      ctx.stroke();
      ctx.lineCap = "butt";
    } else if (d.t === "s") {
      ctx.fillStyle = "#c9bda2"; ctx.strokeStyle = "#7a6a4c"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(d.x + 9, d.y + 9, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(d.x + 19, d.y + 11, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(90,80,55,.22)";
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// 字牌绘制核心（宣纸水墨版）
const TILE_CORNERS = [[7, 9, 6, 8], [8, 6, 9, 7], [6, 8, 7, 9], [9, 7, 8, 6]];
function roundRectU(x, y, w, h, rs) {
  ctx.beginPath();
  ctx.moveTo(x + rs[0], y);
  ctx.arcTo(x + w, y, x + w, y + h, rs[1]);
  ctx.arcTo(x + w, y + h, x, y + h, rs[2]);
  ctx.arcTo(x, y + h, x, y, rs[3]);
  ctx.arcTo(x, y, x + w, y, rs[0]);
  ctx.closePath();
}
function drawTile(u, px, py, now, sizeBase) {
  const S = Math.round(((sizeBase || 52) + (u.star - 1) * 3) * (u.hero ? 1.18 : 1));
  const half = S / 2;
  const whiten = now < u.flashUntil;
  const rs = TILE_CORNERS[u.uid % 4];

  // 待机呼吸浮动（错拍）
  let breathe = 0;
  if (u.state === "stand" && phase !== "over") breathe = Math.sin(now / 470 + u.uid * 1.7) * 1.6;

  // 攻击顶牌动画：朝目标方向位移
  let ox = 0, oy = 0;
  if (u.state === "attack") {
    const el = now - u.animStart;
    const k = el < 150 ? el / 150 : el < 300 ? (300 - el) / 150 : 0;
    const d = 9 * k;
    if (u.dir === "up") oy = -d; else if (u.dir === "down") oy = d;
    else if (u.dir === "left") ox = -d; else ox = d;
    if (el > 440) u.state = "stand";
  }
  // 死亡：灰化下沉淡出
  let alpha = 1, deadShift = 0, grey = false;
  if (u.state === "dead") {
    const el = now - u.deadAt;
    alpha = Math.max(0, 1 - el / 1200);
    if (alpha <= 0) return;
    deadShift = el * 0.02;
    grey = true;
  }
  const X = px + ox - half, Y = py + oy - half + deadShift + breathe;
  const CY = py + oy + deadShift + breathe;

  ctx.save();
  ctx.globalAlpha = alpha;
  // 硬阴影（手作感）
  if (!grey) {
    ctx.fillStyle = "rgba(58,47,36,.24)";
    roundRectU(X + 2, Y + 3, S, S, rs);
    ctx.fill();
  }
  // 英雄常驻金晕（呼吸）
  if (u.hero && !grey) {
    ctx.shadowColor = "#d4a434";
    ctx.shadowBlur = 12 + 5 * Math.sin(now / 280);
  }
  // 牌底
  let g1, g2, border, txt;
  if (u.hero) { g1 = "#f8ecc8"; g2 = "#eeddae"; border = "#8a6a1c"; txt = "#241b0e"; }
  else if (u.kind === "name") { g1 = "#faf3e4"; g2 = "#f0e6cc"; border = "#8a7050"; txt = "#4a3020"; }
  else if (u.side === "me") { g1 = "#f7efdd"; g2 = "#eee1c2"; border = "#3a2f24"; txt = "#241b12"; }
  else if (u.side === "foe") { g1 = "#c9998a"; g2 = "#b47f70"; border = "#4a140c"; txt = "#3f0e06"; }
  else { g1 = "#e6d9cd"; g2 = "#dbcabc"; border = "#6a4038"; txt = "#3a2420"; }
  if (grey) { g1 = g2 = "#9a9186"; border = "#6a6258"; txt = "#4a453c"; }
  const grad = ctx.createLinearGradient(X, Y, X + S, Y + S);
  grad.addColorStop(0, g1); grad.addColorStop(1, g2);
  ctx.fillStyle = grad;
  roundRectU(X, Y, S, S, rs);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = u.hero ? 2.5 : 2;
  ctx.strokeStyle = border;
  ctx.stroke();
  if (whiten) {
    ctx.fillStyle = "rgba(255,255,255,.65)";
    roundRectU(X, Y, S, S, rs);
    ctx.fill();
  }
  // 字
  ctx.fillStyle = txt;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (u.hero) {
    const n = u.name.length;
    const fs = n >= 3 ? Math.round(S * 0.3) : Math.round(S * 0.42);
    ctx.font = `bold ${fs}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
    u.name.split("").forEach((ch, i) => {
      ctx.fillText(ch, px + ox, CY + (i - (n - 1) / 2) * fs * 1.02);
    });
  } else {
    ctx.font = `bold ${Math.round(S * 0.62)}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
    ctx.fillText(u.char, px + ox, CY + 1);
  }
  // 敌军"曹"军旗角标
  if (u.side === "foe" && !u.hero && !grey) {
    ctx.save();
    ctx.translate(X + S - 8, Y + 8);
    ctx.rotate(-0.1);
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(-6.5, -6.5, 13, 13);
    ctx.strokeStyle = "#8a2818"; ctx.lineWidth = 1;
    ctx.strokeRect(-6.5, -6.5, 13, 13);
    ctx.fillStyle = "#d8b060";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("曹", 0, 1);
    ctx.restore();
  }
  // 兵种印（英雄牌角标：黄忠→弓 赵云→骑）
  if ((u.kind === "name" || u.hero) && !grey) {
    const cc = CLASS_CHARS.find(v => v.cls === u.cls);
    ctx.save();
    ctx.translate(X + S - 7, Y + 8);
    ctx.rotate(0.12);
    ctx.fillStyle = "#a02818";
    ctx.fillRect(-6.5, -6.5, 13, 13);
    ctx.fillStyle = "#f0e0c0";
    ctx.font = "bold 9px sans-serif";
    ctx.fillText(cc ? cc.char : "将", 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";
  ctx.restore();
  if (u.state === "dead") { ctx.textAlign = "left"; return; }

  // 选中框 / 可合体提示
  if (selected === u) {
    ctx.strokeStyle = "#b8891c"; ctx.lineWidth = 3;
    roundRectU(X - 3, Y - 3, S + 6, S + 6, [10, 8, 11, 9]);
    ctx.stroke();
  } else if (phase === "shop" && selected && selected.kind === "name" && comboOf(selected, u)) {
    ctx.strokeStyle = "rgba(200,80,40," + (0.6 + 0.4 * Math.sin(now / 130)) + ")";
    ctx.lineWidth = 3;
    roundRectU(X - 3, Y - 3, S + 6, S + 6, [10, 8, 11, 9]);
    ctx.stroke();
  }
  // 行动者白圈
  if (phase === "fight" && u.actingUntil && now < u.actingUntil) {
    ctx.strokeStyle = "rgba(255,252,240,.85)"; ctx.lineWidth = 2;
    roundRectU(X - 2, Y - 2, S + 4, S + 4, [9, 7, 10, 8]);
    ctx.stroke();
  }
  // 怒气满金圈
  if (u.rage >= RAGE_MAX && phase === "fight" && u.kind !== "name") {
    ctx.strokeStyle = "rgba(184,137,28," + (0.55 + 0.4 * Math.sin(now / 120)) + ")";
    ctx.lineWidth = 2.5;
    roundRectU(X - 2, Y - 2, S + 4, S + 4, [9, 7, 10, 8]);
    ctx.stroke();
  }

  // 血条（牌顶）：黑底 + 敌红/我蓝渐变 + 金怒气线
  const w = S - 8, bx = px - w / 2, by = Y - 9;
  ctx.fillStyle = "rgba(30,20,16,.55)";
  ctx.fillRect(bx - 1, by - 1, w + 2, 8);
  const hg = ctx.createLinearGradient(bx, 0, bx + w, 0);
  if (u.side === "me") { hg.addColorStop(0, "#3a78b8"); hg.addColorStop(1, "#5a98d0"); }
  else { hg.addColorStop(0, "#b8483a"); hg.addColorStop(1, "#d0604a"); }
  ctx.fillStyle = hg;
  ctx.fillRect(bx, by, w * (u.hp / u.maxHp), 4);
  ctx.fillStyle = "#e0b83a";
  ctx.fillRect(bx, by + 5, w * (u.rage / RAGE_MAX), 2);
  if (u.star > 1) {
    ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "#caa23a";
    ctx.fillText("\u2605".repeat(u.star), px, by - 3);
  }
  u.items.forEach((k, i) => {
    const im = itemImgs[k];
    if (im) ctx.drawImage(im, X + S - 1, Y + i * 13, 11, 11);
  });
  if (u.stun > 0) {
    ctx.fillStyle = "#8a5aa0"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("\u2726\u6655", px, by - 13);
  }
  ctx.textAlign = "left";
}
function drawUnit(u, now) {
  u.x += (u.col - u.x) * 0.2; u.y += (u.row - u.y) * 0.2;
  // 英雄疾行：纸质残影
  if (u.hero && u.state !== "dead" &&
      (Math.abs(u.x - u.col) > 0.12 || Math.abs(u.y - u.row) > 0.12) &&
      now - (u.lastGhost || 0) > 75) {
    u.lastGhost = now;
    if (ghosts.length > 18) ghosts.shift();
    ghosts.push({ x: u.x * TILE + TILE / 2, y: u.y * TILE + TILE / 2, S: 56, born: now });
  }
  drawTile(u, u.x * TILE + TILE / 2, u.y * TILE + TILE / 2, now);
}
function drawBench(now) {
  bench.forEach((u, i) => {
    if (!u) return;
    const px = BENCH_X0 + i * (BENCH_TILE + BENCH_GAP) + BENCH_TILE / 2;
    if (u.isWeapon) {
      const S = 30, X = px - S / 2, Y = BENCH_Y0 + BENCH_TILE / 2 - S / 2;
      ctx.save();
      ctx.shadowColor = "#d4a434";
      ctx.shadowBlur = 6 + 4 * Math.sin(now / 300);
      const g = ctx.createLinearGradient(X, Y, X + S, Y + S);
      g.addColorStop(0, "#f8ecc0"); g.addColorStop(1, "#e8d090");
      ctx.fillStyle = g;
      roundRect(X, Y, S, S, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#8a6a10"; ctx.lineWidth = 2;
      ctx.stroke();
      const im = weaponImg(u.icon);
      if (im.complete && im.naturalWidth) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(im, px - 12, BENCH_Y0 + BENCH_TILE / 2 - 12, 24, 24);
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.fillStyle = "#5a4008";
        ctx.font = 'bold 18px "Kaiti SC", "STKaiti", "KaiTi", serif';
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(u.char, px, BENCH_Y0 + BENCH_TILE / 2 + 1);
        ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      }
      ctx.restore();
      return;
    }
    drawTile(u, px, BENCH_Y0 + BENCH_TILE / 2, now, 38);
  });
}
function drawFx(now) {
  for (let i = activeFx.length - 1; i >= 0; i--) {
    const f = activeFx[i];
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
    if (p.type === "slash") {              // 刀气弧光
      ctx.strokeStyle = "rgba(150,255,210,.9)"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(-6, 0, 20, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(-6, 0, 20, -0.9, 0.9); ctx.stroke();
    } else if (p.type === "bigarrow") {    // 金色大箭
      ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = "#fff0b0";
      ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(4, -5); ctx.lineTo(4, 5); ctx.fill();
      ctx.strokeStyle = "rgba(255,210,74,.4)"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-10, 0); ctx.stroke();
    } else if (p.type === "orb") {         // 金色光球
      const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, 9);
      grad.addColorStop(0, "#fff8d0"); grad.addColorStop(0.6, "#f0c060"); grad.addColorStop(1, "rgba(240,192,96,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    } else {                                // 普通箭矢
      ctx.strokeStyle = "#e8d9b0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3); ctx.fill();
    }
    ctx.restore();
  }
}
function drawPopups(now) {
  ctx.textAlign = "center";
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i], life = p.big ? 1300 : 900, el = now - p.born;
    if (el > life) { popups.splice(i, 1); continue; }
    if (p.rot === undefined) p.rot = (Math.random() * 10 - 5) * Math.PI / 180;
    ctx.save();
    ctx.globalAlpha = 1 - el / life;
    ctx.translate(p.x * TILE + TILE / 2, p.y * TILE + 6 - el * 0.03);
    ctx.rotate(p.rot);
    ctx.font = (p.big ? "bold 21px" : "bold 16px") + ' "Kaiti SC", "STKaiti", "KaiTi", serif';
    ctx.fillStyle = "rgba(60,40,8,.4)";
    ctx.fillText(p.text, 1.5, 2);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
  ctx.textAlign = "left";
}
// 英雄大招横幅（暗幕+名字大字+技能名，约0.9秒）
let heroCastAnim = null;
function heroCast(u) {
  heroCastAnim = { name: u.name, skillName: u.skillName || "绝技", born: performance.now() };
  playSfx("Se_m_28", 0.6);
}
function drawHeroCast(now) {
  if (!heroCastAnim) return;
  const el = now - heroCastAnim.born;
  if (el > 900) { heroCastAnim = null; return; }
  const a = el < 150 ? el / 150 : el > 700 ? (900 - el) / 200 : 1;
  const slideX = el < 150 ? -40 * (1 - el / 150) : 0;   // 横幅自左推入
  ctx.save();
  ctx.globalAlpha = Math.max(0, a * 0.5);
  ctx.fillStyle = "#1a1208";
  ctx.fillRect(0, 0, cv.width, ROWS * TILE);
  const by = ROWS * TILE * 0.58, bh = 84;
  ctx.globalAlpha = Math.max(0, a * 0.96);
  ctx.translate(slideX, 0);
  // 绢帛横幅
  const bg = ctx.createLinearGradient(0, by, 0, by + bh);
  bg.addColorStop(0, "rgba(26,18,10,.95)");
  bg.addColorStop(1, "rgba(38,26,14,.95)");
  ctx.fillStyle = bg;
  ctx.fillRect(-40, by, cv.width + 80, bh);
  ctx.fillStyle = "#b8891c";
  ctx.fillRect(-40, by - 3, cv.width + 80, 3);
  ctx.fillRect(-40, by + bh, cv.width + 80, 3);
  // 左侧红名牌
  ctx.save();
  ctx.translate(46, by + bh / 2);
  ctx.rotate(-0.05);
  ctx.fillStyle = "#a02818";
  ctx.strokeStyle = "#6a180e"; ctx.lineWidth = 2;
  ctx.fillRect(-27, -27, 54, 54);
  ctx.strokeRect(-27, -27, 54, 54);
  ctx.fillStyle = "#f8e8c8";
  const n = heroCastAnim.name.length;
  const nfs = n >= 3 ? 15 : 21;
  ctx.font = `bold ${nfs}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  heroCastAnim.name.split("").forEach((ch, i) => {
    ctx.fillText(ch, 0, (i - (n - 1) / 2) * (nfs + 1));
  });
  ctx.restore();
  // 技能名金字
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = 'bold 32px "Kaiti SC", "STKaiti", "KaiTi", serif';
  ctx.fillStyle = "#ffe9a8";
  ctx.shadowColor = "#f0c060"; ctx.shadowBlur = 18;
  ctx.fillText(heroCastAnim.skillName, 92, by + bh / 2 + 2);
  ctx.shadowBlur = 0;
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}
// 合体演出：两字飞聚金光爆开
function drawHeroAnim(now) {
  if (!heroAnim) return;
  const el = now - heroAnim.born;
  if (el > 1700) { heroAnim = null; return; }
  const a = el < 250 ? el / 250 : el > 1350 ? (1700 - el) / 350 : 1;
  ctx.save();
  // 深色底
  ctx.globalAlpha = Math.max(0, a * 0.92);
  const bg = ctx.createRadialGradient(cv.width / 2, cv.height * 0.4, 60, cv.width / 2, cv.height * 0.4, cv.height * 0.75);
  bg.addColorStop(0, "#4a3822");
  bg.addColorStop(0.55, "#241a0e");
  bg.addColorStop(1, "#140e06");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cv.width, cv.height);
  const cx = cv.width / 2, cy = cv.height * 0.4;
  ctx.globalAlpha = Math.max(0, a);
  // 金色放射线
  ctx.strokeStyle = "rgba(240,192,96,.28)";
  ctx.lineWidth = 9; ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + el / 1400;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * 60, cy + Math.sin(ang) * 60);
    ctx.lineTo(cx + Math.cos(ang) * 230, cy + Math.sin(ang) * 230);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
  // 虚线圆环
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = "rgba(240,192,96,.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 88, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([4, 10]);
  ctx.strokeStyle = "rgba(240,192,96,.22)"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, 118, el / 900, el / 900 + Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // 墨晕
  const halo = ctx.createRadialGradient(cx, cy, 8, cx, cy, 120);
  halo.addColorStop(0, "rgba(240,192,96,.3)");
  halo.addColorStop(0.55, "rgba(240,192,96,.06)");
  halo.addColorStop(1, "transparent");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, 120, 0, Math.PI * 2); ctx.fill();
  // 名字各字飞聚（带拖尾虚影）
  const t = Math.min(1, el / 500);
  const gap = 90 * (1 - t);
  const n = heroAnim.chars.length;
  const fs = n >= 3 ? 56 : 74;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  heroAnim.chars.forEach((ch, i) => {
    const off = i - (n - 1) / 2;
    const x = cx + off * (fs + 8) + off * gap * 2;
    const rot = (i % 2 === 0 ? -1 : 1) * 0.08;
    // 拖尾虚影
    ctx.save();
    ctx.translate(x + off * 34 * (1 - t), cy);
    ctx.rotate(rot * 1.8);
    ctx.font = `bold ${fs}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
    ctx.fillStyle = "rgba(255,233,168,.2)";
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    // 主字
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(rot);
    ctx.font = `bold ${fs}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
    ctx.shadowColor = "rgba(240,192,96,.85)"; ctx.shadowBlur = 24;
    ctx.fillStyle = "#ffe9a8";
    ctx.fillText(ch, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  });
  // 金粒子
  for (let i = 0; i < 5; i++) {
    const ang = i * 1.3 + el / 300;
    const rr = 100 + 26 * Math.sin(el / 200 + i * 2);
    ctx.fillStyle = i % 2 ? "#fff0b0" : "#ffd24a";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * 0.7, i % 2 ? 2.2 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 名帖：盖印落下
  if (t >= 1) {
    const ts = Math.min(1, (el - 500) / 260);
    const scale = 1.3 - 0.3 * ts;
    ctx.save();
    ctx.translate(cx, cv.height * 0.66);
    ctx.rotate(-0.026);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.max(0, a) * ts;
    const pw = 105 + heroAnim.name.length * 21, ph = 74;
    const pg = ctx.createLinearGradient(-pw, -ph / 2, pw, ph / 2);
    pg.addColorStop(0, "#f8eed2"); pg.addColorStop(1, "#ecdcb2");
    ctx.shadowColor = "rgba(240,192,96,.45)"; ctx.shadowBlur = 26;
    ctx.fillStyle = pg;
    roundRectU(-pw / 2, -ph / 2, pw, ph, [9, 7, 10, 8]);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#8a6a1c"; ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#241b0e";
    ctx.font = 'bold 30px "Kaiti SC", "STKaiti", "KaiTi", serif';
    ctx.fillText(heroAnim.name + " \u767b\u573a", 0, 2);
    // 红印章
    ctx.translate(pw / 2 - 2, -ph / 2 + 2);
    ctx.rotate(0.16);
    ctx.fillStyle = "#a02818";
    ctx.fillRect(-14, -14, 28, 28);
    ctx.fillStyle = "#f4e0c0";
    ctx.font = 'bold 15px "Kaiti SC", "STKaiti", "KaiTi", serif';
    ctx.fillText("\u5c06", 0, 1);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.restore();
}
function render(now) {
  try {
    runBattleStep(now);
    ctx.save();
    if (now < shake.until && shake.mag > 0) {
      const k = (shake.until - now) / 320;
      ctx.translate((Math.random() - 0.5) * shake.mag * 2 * k, (Math.random() - 0.5) * shake.mag * 2 * k);
    } else { shake.mag = 0; }
    ctx.clearRect(-10, -10, cv.width + 20, cv.height + 20);
    drawBoard();
    drawGhosts(now);
    const sorted = units.slice().sort((a, b) =>
      (a.state === "dead" ? -1 : 1) - (b.state === "dead" ? -1 : 1) || a.y - b.y);
    for (const u of sorted) drawUnit(u, now);
    drawBench(now);
    drawFx(now);
    drawProjectiles(now);
    drawInkSlashes(now);
    drawShreds(now);
    drawPopups(now);
    drawHeroCast(now);
    drawHeroAnim(now);
    ctx.restore();
    if (phase === "fight" && confirmAt && now >= confirmAt) {
      confirmAt = 0;
      if (gridPath.length >= 2) {
        if (commitPath(gridPath) !== "keep") gridPath = [];
      }
    }
    drawGrid(now);
  } catch (e) {
    console.error("渲染帧异常(已跳过):", e);
    try { ctx.restore(); } catch (e2) {}
  }
  try { drawDragGhost(); drawRollLogs(); } catch (e) {}
  requestAnimationFrame(render);
}
// 滚木反杀演出：木桩从城墙沿列碾到顶
function drawRollLogs() {
  const now = performance.now();
  rollLogs = rollLogs.filter(l => now - l.born < 850);
  for (const l of rollLogs) {
    const t = (now - l.born) / 850;
    const y = WALL_Y - t * WALL_Y;
    const x = l.col * TILE;
    ctx.save();
    ctx.fillStyle = "#7a5a30";
    ctx.strokeStyle = "#3a2a12"; ctx.lineWidth = 2;
    ctx.fillRect(x + 3, y - 10, TILE - 6, 20);
    ctx.strokeRect(x + 3, y - 10, TILE - 6, 20);
    for (let i = 1; i < 4; i++) {
      const lx = x + 3 + ((i * 17 + t * 90) % (TILE - 6));
      ctx.beginPath(); ctx.moveTo(lx, y - 10); ctx.lineTo(lx, y + 10); ctx.strokeStyle = "rgba(58,42,18,.5)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#c8b088";
    ctx.fillRect(x + 6, y + 12, TILE - 12, 26 * (1 - t));
    ctx.restore();
  }
}
// 拖拽浮影与落点高亮（在 render 中每帧调用）
function drawDragGhost() {
  if (!bDragU || !bDragPos || !bDragMoved) return;
  const col = Math.floor(bDragPos.x / TILE), row = Math.floor(bDragPos.y / TILE);
  const inDeploy = col >= 0 && col < COLS && row >= ROWS - DEPLOY_ROWS && row < ROWS;
  const free = inDeploy && !units.some(v => v !== bDragU && v.col === col && v.row === row && v.state !== "dead" && v.side === "foe");
  if (inDeploy) {
    ctx.fillStyle = free ? "rgba(184,137,28,.25)" : "rgba(160,40,24,.22)";
    ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
    ctx.strokeStyle = free ? "#b8891c" : "#a02818";
    ctx.lineWidth = 3;
    ctx.strokeRect(col * TILE + 2, row * TILE + 2, TILE - 4, TILE - 4);
  }
  const S = 52;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = "#f7efdd";
  ctx.strokeStyle = "#8a6a1c"; ctx.lineWidth = 2.5;
  roundRectU(bDragPos.x - S / 2, bDragPos.y - S - 14, S, S, [7, 5, 8, 6]);
  ctx.fill(); ctx.stroke();
  if (bDragU.isWeapon && weaponImg(bDragU.icon).complete) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(weaponImg(bDragU.icon), bDragPos.x - 18, bDragPos.y - S / 2 - 30, 36, 36);
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.fillStyle = "#241b12";
    ctx.font = 'bold 32px "Kaiti SC", "STKaiti", "KaiTi", serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(bDragU.char || bDragU.name[0], bDragPos.x, bDragPos.y - S / 2 - 12);
  }
  ctx.restore();
}

// ---------- 流程 ----------
function startFight() {
  if (phase !== "ready") return;
  phase = "fight";
  selected = null; selItem = -1;
  setStatus();
  refreshStats(); renderShop(); renderInv();
  startBgm();
  popups.push({ x: COLS / 2 - 0.5, y: ROWS / 2 - 1, text: "敌 军 来 袭 !", color: "#8a2818", born: performance.now(), big: true });
  battleCycles = 0; breachCount = 0;
  spawnQueue = []; nextWaveAt = 0;
  queueWave();
  setStatus();
  nextSpawnAt = performance.now() + 800;
  for (const u of alive("me")) u.nextActAt = performance.now() + Math.random() * 600;
}
document.getElementById("refresh").onclick = () => regenGrid(false);
function showStartBanner() {
  const b = document.getElementById("banner");
  document.getElementById("bannerText").textContent = "守 城";
  document.getElementById("bannerText").style.color = "#ffe9a8";
  document.getElementById("bannerSub").innerHTML = "曹军压境！连相邻字招兵买将，守住五路城墙<br>每路一根滚木：首次失守自动反杀清路，缺口花钱可修";
  const nextBtn = document.getElementById("next");
  nextBtn.textContent = "出 征";
  nextBtn.onclick = () => { b.classList.remove("show"); startFight(); };
  b.classList.add("show");
}

// ---------- 启动 ----------
loadAssets().then(() => {
  waveTotal = wavesFor(round); wave = 0;
  spawnQueue = []; nextSpawnAt = 0; nextWaveAt = 0;
  regenGrid(true);
  setStatus();
  refreshStats(); renderSyn(); renderInv();
  requestAnimationFrame(render);
  showStartBanner();
});

// ---------- 手机一屏化：整页等比缩放，杜绝滚动 ----------
function fitScreen() {
  const app = document.getElementById("app");
  if (!app) return;
  app.style.transform = "none";
  const vv = window.visualViewport;
  const vw = vv ? vv.width : window.innerWidth;
  const vh = vv ? vv.height : window.innerHeight;
  const h = app.scrollHeight;
  const sc = Math.min(vw / 375, vh / h, 1.25);
  app.style.transform = `scale(${sc})`;
}
window.addEventListener("resize", fitScreen);
if (window.visualViewport) window.visualViewport.addEventListener("resize", fitScreen);
window.addEventListener("orientationchange", () => setTimeout(fitScreen, 120));
setTimeout(fitScreen, 60);
setTimeout(fitScreen, 600);   // 字体/素材加载后高度可能微变，再校一次
// iOS Safari 无视 user-scalable=no：显式拦截捏合与双指手势，防止页面被放大挤出屏
["gesturestart", "gesturechange", "gestureend"].forEach(ev =>
  document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
