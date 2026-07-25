import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import _ from 'lodash';
import { dataPath } from '../lib/path.js';
import { char } from '../lib/convert.js';
import { baseValueData } from '../lib/score.js';
import { idToName } from '../lib/convert/property.js';
import { getSquareAvatar, getWeaponImage, getSuitImage } from '../lib/download.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
import { isRankPermissionAllowed } from '../lib/rank.js';
import { ZZZAvatarInfo } from '../model/avatar.js';
import { Enka2Mys } from '../model/Enka/formater.js';
import { getPlayerInfo } from '../lib/db.js?t=1';

const require = createRequire(import.meta.url);

const PREFIX = '^(#|%|/)?(?:zzz|ZZZ|绝区零)?\\s*';
const ZZZ_ALIAS_PREFIX = /^(?:zzz|ZZZ|绝区零)+\s*/;
const BATTLE_RANK_WORDS = /^(式舆防卫战|式舆|深渊|防卫战|防卫|危局强袭战|危局|强袭|强袭战|临界推演|临界|推演|爬塔|鏖战|爬塔S\\d|爬塔s\\d)/;


const uidQqCache = new Map();
function qqAvatarUrl(qq) {
  qq = String(qq || '').trim();
  return /^\d{5,12}$/.test(qq) ? `https://q.qlogo.cn/g?b=qq&s=100&nk=${qq}` : '';
}

async function findQqByZzzUid(uid) {
  uid = String(uid || '').trim();
  if (!uid) return '';
  if (uidQqCache.has(uid)) return uidQqCache.get(uid);
  const dbFile = path.join(dataPath, '../../..', 'data', 'db', 'data.db');
  if (!fs.existsSync(dbFile)) {
    uidQqCache.set(uid, '');
    return '';
  }
  try {
    const sqlite3 = require('sqlite3');
    const qq = await new Promise(resolve => {
      const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, err => {
        if (err) return resolve('');
        const like = `%"uid":"${uid}"%`;
        db.get(
          `select id from Users
             where games like ?
               and (games like '%"zzz"%' or games like '%"nap"%')
             order by updatedAt desc
             limit 1`,
          [like],
          (e, row) => {
            db.close(() => {});
            resolve(e ? '' : (row?.id || ''));
          }
        );
      });
    });
    uidQqCache.set(uid, qq || '');
    return qq || '';
  } catch (err) {
    logger?.debug?.(`[ZZZ-Plugin]读取用户QQ映射失败: ${err.message}`);
    uidQqCache.set(uid, '');
    return '';
  }
}

function parseNum(val = '') {
  const str = String(val ?? '').replace(/,/g, '').trim();
  const m = str.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function prop(data, name) {
  const item = (data?.properties || []).find(v => v.property_name === name || String(v.property_name || '').includes(name));
  return item?.final || item?.add || item?.base || '-';
}

function damageBonus(data) {
  const item = (data?.properties || []).find(v => /伤害加成$/.test(v.property_name || ''));
  return item ? `${item.property_name.replace('伤害加成', '伤')} ${item.final || '-'}` : '';
}

function damageItem(data) {
  const text = damageBonus(data);
  if (!text) return null;
  const idx = text.lastIndexOf(' ');
  return idx > 0
    ? { name: text.slice(0, idx), value: text.slice(idx + 1) }
    : { name: '伤害加成', value: text };
}

function getRating(data) {
  const score = Number(data?._rankScore || 0);
  // 排名按 ZZZAvatarInfo 重新计算的数值分排序，评级也必须用同一套数值分换算。
  // 否则旧缓存里的米游社 equip_rating 可能显示 SS+，而新算分兜底显示 ACE，造成“SS+ 排在 ACE 前面”的错觉。
  if (score > 0) return ratingByScore(score);
  const raw = String(_.get(data, 'equip_plan_info.equip_rating', 'ER_Default'));
  return raw
    .replace(/^ER_/, '')
    .replace(/_Plus$/i, '+')
    .replace(/_/g, '');
}

function ratingByScore(score = 0) {
  if (score < 80) return 'C';
  if (score < 120) return 'B';
  if (score < 160) return 'A';
  if (score < 180) return 'S';
  if (score < 200) return 'SS';
  if (score < 220) return 'SSS';
  if (score < 280) return 'ACE';
  return 'MAX';
}

function formatDamage(num = 0) {
  num = Number(num || 0);
  if (!num) return '-';
  if (num >= 10000) return `${(num / 10000).toFixed(num >= 1000000 ? 1 : 2)}万`;
  return String(Math.round(num));
}

function calcDamageInfo(data) {
  try {
    const avatar = new ZZZAvatarInfo(data);
    const list = Array.isArray(avatar.damages) ? avatar.damages : [];
    const valid = list
      .filter(v => v?.result?.expectDMG && !v?.skill?.isHide)
      .sort((a, b) => Number(b.result.expectDMG || 0) - Number(a.result.expectDMG || 0));
    const best = valid[0];
    return {
      equipScore: Number(avatar.equip_score || 0),
      damage: Number(best?.result?.expectDMG || 0),
      critDamage: Number(best?.result?.critDMG || 0),
      skill: best?.skill?.name || best?.skill?.type || '',
    };
  } catch (err) {
    logger?.debug?.(`[ZZZ-Plugin]排行伤害计算失败: ${getName(data)} ${err.message}`);
    return { equipScore: 0, damage: 0, critDamage: 0, skill: '' };
  }
}

function getName(data) {
  return data?.name_mi18n || data?.full_name_mi18n || data?.name || '-';
}

function statLine(data) {
  const parts = [
    `攻 ${prop(data, '攻击力')}`,
    `暴 ${prop(data, '暴击率')}/${prop(data, '暴击伤害')}`,
    `异 ${prop(data, '异常掌控')}/${prop(data, '异常精通')}`,
    `冲 ${prop(data, '冲击力')}`,
    damageBonus(data),
  ].filter(Boolean);
  return parts.join('｜');
}

function statItems(data) {
  const effectiveText = (data?.equip_plan_info?.plan_effective_property_list || [])
    .map(v => `${v.full_name || ''}${v.name || ''}`)
    .join('/');
  const items = [];
  const add = (name, value) => {
    if (value === undefined || value === null || value === '') return;
    if (!items.some(v => v.name === name)) items.push({ name, value });
  };
  const dmg = damageItem(data);
  const has = reg => reg.test(effectiveText);
  if (has(/生命/)) {
    add('生命', prop(data, '生命值'));
    add('攻击', prop(data, '攻击力'));
    add('暴击率', prop(data, '暴击率'));
    add('暴击伤害', prop(data, '暴击伤害'));
  } else if (has(/异常/)) {
    add('攻击', prop(data, '攻击力'));
    add('异常掌控', prop(data, '异常掌控'));
    add('异常精通', prop(data, '异常精通'));
    if (dmg) add(dmg.name, dmg.value);
    add('穿透值', prop(data, '穿透值'));
  } else if (has(/冲击/)) {
    add('冲击', prop(data, '冲击力'));
    add('攻击', prop(data, '攻击力'));
    add('暴击率', prop(data, '暴击率'));
    add('暴击伤害', prop(data, '暴击伤害'));
  } else {
    add('攻击', prop(data, '攻击力'));
    add('暴击率', prop(data, '暴击率'));
    add('暴击伤害', prop(data, '暴击伤害'));
  }
  if (dmg) add(dmg.name, dmg.value);
  add('穿透值', prop(data, '穿透值'));
  add('冲击', prop(data, '冲击力'));
  return items.slice(0, 5);
}

function viewRecord(v, rank, selfUid = '') {
  const skills = (v.data?.skills || [])
    .slice()
    .sort((a, b) => Number(a.skill_type ?? 0) - Number(b.skill_type ?? 0))
    .map(s => Number(s.level || 0))
    .filter(Boolean)
    .slice(0, 6);
  const equips = (v.data?.equip || [])
    .slice()
    .sort((a, b) => Number(a.equipment_type || 0) - Number(b.equipment_type || 0))
    .map(e => ({
      id: e.id,
      type: e.equipment_type,
      icon: e.icon || '',
      name: e.name || '',
      level: e.level || '',
      score: e.score || '',
    }))
    .slice(0, 6);
  return {
    rank,
    uid: v.uid,
    self: !!selfUid && String(v.uid) === String(selfUid),
    player: v.player || {},
    data: v.data,
    cons: Number(v.data?.rank ?? 0),
    // 优先米游社/游戏头像；没有游戏头像时用 QQ 头像兜底，避免空白认不出是谁。
    icon: v.player?.gameAvatar || v.player?.game_avatar || v.player?.avatar || v.data?.role_square_url || v.data?.role_square_avatar_url || v.data?.avatar_icon || v.data?.icon || v.data?.skin_list?.find(s => s.unlocked)?.skin_square_url || '',
    skills,
    weaponData: {
      name: v.data?.weapon?.name || '',
      icon: v.data?.weapon?.icon || '',
      level: v.data?.weapon?.level || '',
      star: v.data?.weapon?.star || '',
      rarity: v.data?.weapon?.rarity || '',
    },
    equips,
    score: v.score.toFixed(2),
    damage: formatDamage(v.damage),
    damageRaw: v.damage || 0,
    damagePercent: v.damagePercent || '0.0',
    compositeScore: v.compositeScore?.toFixed?.(2) || '0.00',
    damageSkill: v.damageSkill || '',
    rating: v.rating,
    weapon: v.data?.weapon?.name || '',
    stats: statItems(v.data),
  };
}

async function hydrateRecordAssets(record) {
  if (!record.icon) {
    const qq = await findQqByZzzUid(record.uid);
    record.player = record.player || {};
    if (qq) record.player.qq = qq;
    record.icon = qqAvatarUrl(qq);
  }
  if (!record.icon) record.icon = await getSquareAvatar(record.data?.id).catch(() => '') || '';
  if (!record.weaponData.icon && record.data?.weapon?.id) {
    record.weaponData.icon = await getWeaponImage(record.data.weapon.id).catch(() => '') || '';
  }
  await Promise.all((record.equips || []).map(async eq => {
    if (!eq.icon && eq.id) eq.icon = await getSuitImage(eq.id).catch(() => '') || '';
  }));
  return record;
}


function parseValue(val = '') {
  const str = String(val ?? '').replace(/,/g, '').trim();
  const m = str.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function formatPanelValue(prop, value) {
  const id = Number(prop.property_id);
  if ([201, 211, 231].includes(id) || id >= 315 && id <= 319) return `${value.toFixed(1)}%`;
  if (id === 305) return value.toFixed(2);
  return `${Math.round(value)}`;
}

function getBasePanelValue(data, target) {
  const p = (data.properties || []).find(v => Number(v.property_id) === Number(target));
  return parseValue(p?.base || p?.final || 0);
}

function addEquipPropTotal(totals, data, propID, rawValue) {
  const id = Number(propID);
  const value = parseValue(rawValue);
  if (!value) return;
  const add = (target, val) => { totals[target] = (totals[target] || 0) + val; };
  if (id === 11103) return add(1, value);
  if (id === 11102) return add(1, getBasePanelValue(data, 1) * value / 100);
  if (id === 12103) return add(2, value);
  if (id === 12102) return add(2, getBasePanelValue(data, 2) * value / 100);
  if (id === 13103) return add(3, value);
  if (id === 13102) return add(3, getBasePanelValue(data, 3) * value / 100);
  if (id === 12202) return add(4, getBasePanelValue(data, 4) * value / 100);
  if (id === 20103) return add(5, value);
  if (id === 21103) return add(6, value);
  if (id === 31203) return add(8, value);
  if (id === 23103) return add(9, value);
  if (id === 23203) return add(232, value);
  if (id >= 31503 && id <= 31903) return add(Math.trunc(id / 100), value);
}

function getEquipPropTotals(data, equips = data.equip || []) {
  const totals = {};
  for (const equip of equips || []) {
    for (const prop of equip.main_properties || []) addEquipPropTotal(totals, data, prop.property_id, prop.base);
    for (const prop of equip.properties || []) addEquipPropTotal(totals, data, prop.property_id, prop.base);
  }
  return totals;
}

function equipTotalKey(propID) {
  const id = Number(propID);
  if ([11103, 11102].includes(id)) return 1;   // ATK
  if ([12103, 12102].includes(id)) return 2;   // HP
  if ([13103, 13102].includes(id)) return 3;   // DEF
  if (id === 12202) return 4;                  // 异常掌控
  if (id === 20103) return 5;                  // 暴击率
  if (id === 21103) return 6;                  // 暴击伤害
  if (id === 31203) return 8;                  // 穿透率
  if (id === 23103) return 9;                  // 冲击力
  if (id === 23203) return 232;                // 冲击力百分比
  if (id >= 31503 && id <= 31903) return Math.trunc(id / 100); // 属性伤害加成
  return id;
}

function propTotalKey(propID) {
  const id = Number(propID);
  // properties 的 property_id 和 equip 的编码不同，需映射到 totals key
  if (id === 111) return 1;    // 生命值
  if (id === 121) return 2;    // 攻击力
  if (id === 131) return 3;    // 防御力
  if (id === 314) return 4;    // 异常掌控 (equip 12202)
  if (id === 201) return 5;    // 暴击率
  if (id === 211) return 6;    // 暴击伤害
  if (id === 231) return 8;    // 穿透率
  if (id === 122) return 9;    // 冲击力 (equip 23103)
  if (id === 232) return 232;  // 穿透值 (equip 23203)
  if (id >= 315 && id <= 319) return id;  // 属性伤害加成
  return null; // 无驱动盘贡献的属性
}

function applyPanelPropertyDelta(data, beforeTotals, afterTotals) {
  if (!Array.isArray(data.properties)) return;
  data.properties = data.properties.map(prop => {
    const key = propTotalKey(prop.property_id);
    if (key == null) return prop;
    const delta = (afterTotals[key] || 0) - (beforeTotals[key] || 0);
    if (!delta) return prop;
    const final = parseValue(prop.final) + delta;
    const add = prop.add === '' || prop.add === undefined ? prop.add : parseValue(prop.add) + delta;
    return {
      ...prop,
      add: add === prop.add ? prop.add : formatPanelValue(prop, add),
      final: formatPanelValue(prop, final),
    };
  });
}

function clonePanelData(data) {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}


const DRIVE_MAIN_VALUE = {
  12102: '30%',
  12202: '30%',
  20103: '24%',
  21103: '48%',
  23103: '18%',
  23203: '24',
  31203: '24%',
  31503: '30%',
  31603: '30%',
  31703: '30%',
  31803: '30%',
  31903: '30%',
};


const ENKA_PROP_VALUE = {
  11103: 550,
  12103: 79,
  13103: 46,
  12102: 750,
  12202: 750,
  20103: 600,
  21103: 1200,
  23103: 450,
  23203: 6,
  31503: 750,
  31603: 750,
  31703: 750,
  31803: 750,
  31903: 750,
  31203: 750,
  31402: 750,
};

const ENKA_SUB_VALUE = {
  11103: 112,
  12103: 19,
  13103: 15,
  11102: 300,
  12102: 300,
  13102: 480,
  20103: 240,
  21103: 480,
  23203: 9,
  31203: 9,
  31402: 300,
};

function buildSuperPanelData(cfg = {}, resolved = {}) {
  const charID = Number(cfg.char_id || cfg.charId || resolved.id || 0);
  const weaponID = Number(cfg.weapon_id || cfg.weaponId || 0);
  if (!charID || !weaponID) return null;
  const main = cfg.drive_main || cfg.driveMain || {};
  const sub = cfg.drive_sub || cfg.driveSub || {};
  const suits = cfg.drive_suits || cfg.driveSuits || {};
  const defaultMain = { 1: 11103, 2: 12103, 3: 13103, 4: 21103, 5: 31803, 6: 12102 };
  const defaultSuit = { 1: 327, 2: 327, 3: 324, 4: 327, 5: 324, 6: 327 };
  const defaultSub = [
    { id: 21103, level: 6 },
    { id: 20103, level: 4 },
    { id: 12102, level: 1 },
    { id: 12103, level: 1 },
  ];
  const equipped = [];
  for (let slot = 1; slot <= 6; slot++) {
    const mainID = Number(main[slot] || main[`slot${slot}`] || defaultMain[slot]);
    const suit = Number(suits[slot] || suits[`slot${slot}`] || defaultSuit[slot]);
    const subs = Array.isArray(sub[slot] || sub[`slot${slot}`]) ? (sub[slot] || sub[`slot${slot}`]) : defaultSub;
    equipped.push({
      Slot: slot,
      Equipment: {
        Id: Number(`${suit}4${slot}`),
        Level: 15,
        MainPropertyList: [{ PropertyId: mainID, PropertyValue: ENKA_PROP_VALUE[mainID] || 0, PropertyLevel: 1 }],
        RandomPropertyList: subs.map(item => {
          const id = Number(item.id || item.property_id || item[0]);
          const level = Number(item.level || item.count || item[1] || 1);
          return { PropertyId: id, PropertyValue: ENKA_SUB_VALUE[id] || 0, PropertyLevel: level };
        }).filter(v => v.PropertyId && v.PropertyValue && v.PropertyLevel),
      },
    });
  }
  const skillLevel = Number(cfg.skill_level || 16);
  const coreLevel = Number(cfg.core_level || 6);
  const enka = {
    Id: charID,
    Level: Number(cfg.level || 60),
    PromotionLevel: Number(cfg.promotion || 6),
    CoreSkillEnhancement: coreLevel,
    TalentLevel: Number(cfg.rank ?? 6),
    SkinId: 0,
    Weapon: {
      Id: weaponID,
      Level: Number(cfg.weapon_level || 60),
      BreakLevel: Number(cfg.weapon_break || 5),
      UpgradeLevel: Number(cfg.weapon_star || 5),
    },
    SkillLevelList: [0, 1, 2, 3, 4, 5].map(Index => ({ Index, Level: skillLevel })),
    EquippedList: equipped,
  };
  return Enka2Mys(enka);
}

function driveMainProp(propID) {
  propID = Number(propID);
  const name = (idToName(propID) || '属性').replace('百分比', '');
  return {
    property_name: name,
    property_id: propID,
    base: DRIVE_MAIN_VALUE[propID] || `${Number(baseValueData[propID] || 0)}${/暴击|百分比|冲击力|异常掌控/.test(name) ? '%' : ''}`,
    level: 1,
    valid: false,
    system_id: 0,
    add: 0,
  };
}

function applyDriveMainOverrides(data, cfg = {}) {
  const main = cfg.drive_main || cfg.driveMain || cfg.main || {};
  if (!main || typeof main !== 'object' || !Array.isArray(data.equip)) return;
  data.equip = data.equip.map(equip => {
    const slot = String(equip.equipment_type || '');
    const propID = main[slot] || main[`slot${slot}`];
    if (!propID) return equip;
    return { ...equip, main_properties: [driveMainProp(propID)] };
  });
}

function superProp(propID, count) {
  const base = Number(baseValueData[propID] || 0);
  const name = idToName(propID) || '属性';
  const isPct = /百分比|暴击|冲击力|异常掌控/.test(name);
  const value = +(base * count).toFixed(1);
  return {
    property_name: name.replace('百分比', ''),
    property_id: Number(propID),
    base: `${value}${isPct ? '%' : ''}`,
    level: count,
    valid: true,
    system_id: Math.trunc(Number(propID) / 100),
    add: Math.max(0, count - 1),
  };
}

function superCounts(candidates, weight) {
  const counts = candidates.map(() => 1);
  const maxWeight = Math.max(...candidates.map(id => Number(weight[id] || 0)));
  const topIdx = candidates
    .map((id, idx) => ({ id, idx }))
    .filter(v => Number(weight[v.id] || 0) === maxWeight)
    .map(v => v.idx);
  // ZZZ-Plugin 原生 Score 的理论上限是 4 个初始词条 + 5 次强化。
  // 如果暴击率/暴击伤害等权重并列，就把 5 次强化在并列最高词条里轮流分配，
  // 评分仍是满分，但不会出现“全中暴击率、没有爆伤/攻击”的奇怪面板。
  for (let i = 0; i < 5; i++) counts[topIdx[i % topIdx.length]] += 1;
  return counts;
}

function applyMaxDriveScore(data, cfg = {}) {
  if (!Array.isArray(data.equip)) return data;
  let weight = {};
  try {
    weight = new ZZZAvatarInfo(data).scoreWeight || {};
  } catch (err) {
    logger.warn?.('[ZZZ-Plugin]理论极限面板获取评分权重失败，跳过满词条覆盖', err);
    return data;
  }
  // 角色特化：叶瞬光精确控制暴击=50%，其余爆伤
  const charName = getName(data);
  if (charName === '叶瞬光' && weight[20103]) {
    const existing = parseNum(prop(data, '暴击率')) - getEquipPropTotal(data, 20103);
    if (existing >= 50) {
      weight[20103] = 0;
    } else {
      weight[20103] = Math.min(weight[20103], 0.3);
    }
    weight[21103] = Math.max(weight[21103] || 0, 10);
  }
  // 面板已有暴击较高时压驱动盘暴击率权重，使其出词条但不吃强化
  const existing = parseNum(prop(data, '暴击率')) - getEquipPropTotal(data, 20103);
  if (existing > 0 && weight[20103] && existing >= 30) {
    weight[20103] = Math.min(weight[20103], 0.3);
  }
  // 保存原始非驱动盘暴击（含套装效果），后面改完equip就取不到了
  const existingNonDriveCR = parseNum(prop(data, '暴击率')) - getEquipPropTotal(data, 20103);
  const beforeTotals = getEquipPropTotals(data);
  applyDriveMainOverrides(data, cfg);
  data.equip = data.equip.map(equip => {
    const mainID = Number(equip.main_properties?.[0]?.property_id || 0);
    let candidates = Object.keys(baseValueData)
      .map(Number)
      .filter(id => id !== mainID && Number(weight[id] || 0) > 0)
      .sort((a, b) => Number(weight[b] || 0) - Number(weight[a] || 0) || a - b)
      .slice(0, 4);
    if (!candidates.length) return equip;
    const counts = superCounts(candidates, weight);
    return {
      ...equip,
      level: 15,
      rarity: 'S',
      properties: candidates.map((id, idx) => superProp(id, counts[idx])),
      invalid_property_cnt: 0,
      all_hit: true,
    };
  });
  // 叶瞬光后处理：暴击精确到 50%，套装暴击爆伤已含在 existingNonDriveCR 中
  if (charName === '叶瞬光' && weight[20103]) {
    const crPerRoll = Number(baseValueData[20103] || 2.4);
    const baseDriveCR = data.equip.reduce((s, e) => {
      const p = e.properties?.find(p => Number(p.property_id) === 20103);
      return s + (p ? crPerRoll * (p.add + 1) : 0);
    }, 0);
    const currentCR = existingNonDriveCR + baseDriveCR;
    const neededCR = 50 - currentCR;
    if (neededCR > 0.5) {
      const extraCRolls = Math.max(0, Math.min(Math.round(neededCR / crPerRoll), data.equip.length * 5));
      let added = 0, prevAdded = -1;
      while (added < extraCRolls) {
        if (added === prevAdded) break;
        prevAdded = added;
        for (const equip of data.equip) {
          if (added >= extraCRolls) break;
          const cdIdx = equip.properties.findIndex(p => Number(p.property_id) === 21103);
          const crIdx = equip.properties.findIndex(p => Number(p.property_id) === 20103);
          if (cdIdx === -1 || crIdx === -1) continue;
          const cdCount = equip.properties[cdIdx].add + 1;
          if (cdCount <= 1) continue;
          equip.properties[cdIdx] = superProp(21103, cdCount - 1);
          equip.properties[crIdx] = superProp(20103, (equip.properties[crIdx].add + 1) + 1);
          added++;
        }
      }
    }
  }
  applyPanelPropertyDelta(data, beforeTotals, getEquipPropTotals(data));
  return data;
}

function getEquipPropTotal(data, propID) {
  let total = 0;
  for (const equip of data.equip || []) {
    for (const p of equip.main_properties || []) {
      if (Number(p.property_id) === Number(propID)) total += parseValue(p.base || 0);
    }
    for (const p of equip.properties || []) {
      if (Number(p.property_id) === Number(propID)) total += parseValue(p.base || 0);
    }
  }
  return total;
}

async function applySuperOverrides(data, cfg = {}) {
  const ret = clonePanelData(data);
  const rank = Number(cfg.rank ?? 6);
  if (Number.isFinite(rank)) {
    ret.rank = rank;
    if (Array.isArray(ret.ranks)) {
      ret.ranks = ret.ranks.map(v => ({ ...v, is_unlocked: Number(v.pos ?? v.id ?? 0) <= rank }));
    }
  }
  const skillLevel = Number(cfg.skill_level || 0);
  const coreLevel = Number(cfg.core_level || 0);
  if (Array.isArray(ret.skills)) {
    ret.skills = ret.skills.map(v => {
      const isCore = Number(v.skill_type) === 5 || /核心/.test(String(v.name || v.skill_type_name || ''));
      if (isCore && coreLevel) return { ...v, level: coreLevel };
      if (!isCore && skillLevel) return { ...v, level: skillLevel };
      return v;
    });
  }
  const weaponStar = Number(cfg.weapon_star || 0);
  if (ret.weapon && weaponStar) ret.weapon = { ...ret.weapon, star: weaponStar };
  if (cfg.max_drive) applyMaxDriveScore(ret, cfg);
  return ret;
}

const WEAPON_PASSIVE_MAP = {
  '暴击率': 20103,
  '暴击伤害': 21103,
  '攻击力': 11103,
  '生命值': 12103,
  '防御力': 13103,
  '穿透率': 31203,
  '冲击力': 23103,
  '异常掌控': 12202,
};

async function applyWeaponPassive(ret) {
  const wName = ret.weapon?.name;
  if (!wName) return;
  try {
    const mod = await import(`../model/damage/weapon/${wName}.js`);
    if (!mod?.buffs?.length) return;
    const star = ret.weapon?.star || 1;
    const beforeTotals = getEquipPropTotals(ret);
    const afterTotals = { ...beforeTotals };
    for (const b of mod.buffs) {
      const pid = WEAPON_PASSIVE_MAP[b.type];
      if (!pid) continue;
      const val = Array.isArray(b.value) ? b.value[Math.min(star - 1, b.value.length - 1)] : (b.value || 0);
      if (!val) continue;
      addEquipPropTotal(afterTotals, ret, pid, val * 100);
    }
    applyPanelPropertyDelta(ret, beforeTotals, afterTotals);
  } catch (_) {}
}


function readJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return null;
}

function pickCachedGamePlayer(uid) {
  const dirs = ['voidFrontBattle', 'deadly', 'abyss', 'climbingTower', 'monthly'];
  const result = {};
  const noteData = readJson(path.join(dataPath, '../../..', 'data', 'NoteData', 'zzz', `${uid}.json`));
  if (noteData) {
    for (const year of Object.values(noteData || {})) {
      for (const month of Object.values(year || {})) {
        const role = month?.role_info || {};
        if (role.nickname && !result.nickname) result.nickname = role.nickname;
        if (role.avatar && !result.gameAvatar) result.gameAvatar = role.avatar;
      }
    }
  }
  for (const dir of dirs) {
    const data = readJson(path.join(dataPath, dir, `${uid}.json`));
    if (!data) continue;
    const player = data.player?.player || data.player || {};
    const basic = data.result?.role_basic_info || data.role_basic_info || {};
    const nickname = basic.nickname || player.nickname;
    const gameAvatar = basic.icon || data.result?.avatar_icon || data.result?.icon || data.avatar_icon || data.icon;
    if (nickname && !result.nickname) result.nickname = nickname;
    if (gameAvatar && !result.gameAvatar) result.gameAvatar = gameAvatar;
    if (result.nickname && result.gameAvatar) break;
  }
  return result;
}

function loadRankPlayer(uid) {
  let player = {};
  try { player = getPlayerInfo(uid) || {}; } catch (_) {}
  const cached = pickCachedGamePlayer(uid);
  return {
    ...cached,
    ...player,
    nickname: player.nickname || cached.nickname || '',
    // 排名图要米游社/游戏头像，QQ头像只保存在 avatar，不参与展示。
    gameAvatar: player.gameAvatar || player.game_avatar || cached.gameAvatar || '',
  };
}

function loadAllPanelRecords() {
  const dir = path.join(dataPath, 'panel');
  if (!fs.existsSync(dir)) return [];
  const records = [];
  for (const file of fs.readdirSync(dir).filter(v => v.endsWith('.json'))) {
    const uid = file.replace(/\.json$/, '');
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!Array.isArray(list)) continue;
      const player = loadRankPlayer(uid);
      for (const data of list) records.push({ uid, data, player });
    } catch (err) {
      logger.warn?.(`[ZZZ-Plugin]读取面板数据失败: ${file}`, err);
    }
  }
  return records;
}

function cleanZzzQuery(msg = '') {
  return String(msg || '')
    // 兼容 TRSS/机器人别名场景，日志里可能显示成 q%xxx，但真正指令从 %/#/ 开始。
    .replace(/^[^#%/]*(?=[#%/])/, '')
    .replace(new RegExp(PREFIX), '')
    // TRSS 的 only_reply_at 会把 “%zzz雨果...” 先改成 “#绝区零zzz雨果...”，这里再清一次残留前缀。
    .replace(ZZZ_ALIAS_PREFIX, '')
    .trim();
}

function queryName(msg = '', suffix = '排名') {
  return cleanZzzQuery(msg)
    .replace(/^(面板)?排名/, '')
    .replace(new RegExp(`(面板)?${suffix}$`), '')
    .replace(ZZZ_ALIAS_PREFIX, '')
    .trim();
}

export class PanelRank extends ZZZPlugin {
  constructor() {
    super({
      name: '[ZZZ-Plugin]PanelRank',
      dsc: '绝区零角色面板排名/极限面板',
      event: 'message',
      // 需要比普通“xx面板”更早处理，否则“雨果极限面板”会被面板指令当成“雨果极限”的普通面板吃掉。
      priority: _.get(settings.getConfig('priority'), 'panelRank', -10000),
      rule: [
        // 明确的 zzz/绝区零前缀规则放最前面，并用极高优先级抢在喵喵/xhh 的通用“极限面板”前处理。
        {
          reg: '^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\\s*.+极限面板\\s*$',
          fnc: 'limitPanel'
        },
        {
          reg: '^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\\s*.+(面板)?排名\\s*$',
          fnc: 'panelRank'
        }
      ]
    });
  }

  resolveChar(name) {
    const clean = String(name || '')
      .replace(/^[^#%/]*(?=[#%/])/, '')
      .replace(new RegExp(PREFIX), '')
      .replace(ZZZ_ALIAS_PREFIX, '')
      .replace(/代理人|角色/g, '')
      .trim();
    if (!clean || BATTLE_RANK_WORDS.test(clean)) return null;
    const id = char.aliasToId(clean);
    if (!id) return null;
    return { id, name: char.aliasToName(clean) || clean };
  }

  getRoleRecords(name) {
    const resolved = this.resolveChar(name);
    if (!resolved) return { resolved: null, list: [] };
    let list = loadAllPanelRecords()
      .filter(v => Number(v.data?.id) === Number(resolved.id))
      .map(v => {
        const dmg = calcDamageInfo(v.data);
        let score = Number(dmg.equipScore || 0);
        // 兼容旧/不完整面板：本地数据里有些记录能显示米游社养成方案分，
        // 但重新实例化 ZZZAvatarInfo 可能因为资源/字段缺失算不出驱动盘分，不能直接丢掉。
        const mysScore = Number(_.get(v.data, 'equip_plan_info.equip_rating_score', 0)) || 0;
        if (!score && mysScore) score = mysScore;
        return {
          ...v,
          score,
          damage: dmg.damage,
          critDamage: dmg.critDamage,
          damageSkill: dmg.skill,
          rating: getRating({ ...v.data, _rankScore: score }),
          valid: _.get(v.data, 'equip_plan_info.valid_property_cnt', 0),
        };
      })
      .filter(v => v.score > 0 || v.damage > 0);
    const maxDamage = Math.max(...list.map(v => Number(v.damage || 0)), 0);
    const maxScore = Math.max(...list.map(v => Number(v.score || 0)), 0);
    list = list
      .map(v => {
        const damageRatio = maxDamage ? Number(v.damage || 0) / maxDamage : 0;
        const driveRatio = maxScore ? Number(v.score || 0) / maxScore : 0;
        // 综合排名：伤害 60% + 驱动盘 40%。同角色内归一化，避免伤害数值量级碾压驱动评分。
        const compositeScore = damageRatio * 60 + driveRatio * 40;
        return {
          ...v,
          damagePercent: maxDamage ? (damageRatio * 100).toFixed(1) : '0.0',
          compositeScore,
        };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore || b.damage - a.damage || b.score - a.score || b.valid - a.valid || parseNum(prop(b.data, '攻击力')) - parseNum(prop(a.data, '攻击力')));
    return { resolved, list };
  }

  async panelRank() {
    const name = queryName(this.e.msg, '排名');
    // %防卫战排名 / %危局排名 等属于 ZZZ 群战绩排行，不是角色面板排名。
    // 先放行给 rank.js，避免被这里当成“防卫战”角色或权限判断拦截。
    if (BATTLE_RANK_WORDS.test(String(name || '').trim())) return false;
    if (!isRankPermissionAllowed(this.e)) return this.reply('当前排名系统仅主人或白名单可用。');
    const { resolved, list } = this.getRoleRecords(name);
    if (!resolved) return false;
    if (!list.length) return this.reply(`暂无【${resolved.name}】面板排名数据，请先让大家使用 %zzz更新面板 或 %zzz更新展柜面板。`);
    const maxDisplay = Math.max(1, Math.min(Number(_.get(settings.getConfig('rank'), 'max_display', 15)) || 15, 20));
    const uid = '';
    const records = await Promise.all(list.slice(0, maxDisplay).map((v, i) => hydrateRecordAssets(viewRecord(v, i + 1, uid))));
    return this.render('panelRank/index.html', {
      mode: 'rank',
      title: `${resolved.name}面板排名`,
      subtitle: '按伤害与驱动盘综合排序；未更新面板不参与排名',
      count: list.length,
      records,
      notes: [
        '排名数据来自本地已保存面板，请先使用 %zzz更新面板 或 %zzz更新展柜面板。',
        '综合分=同角色最高伤害占比×60 + 驱动盘评分占比×40；同分时按伤害、驱动分、有效词条数排序。'
      ]
    });
  }

  async limitPanel() {
    if (!isRankPermissionAllowed(this.e)) return this.reply('当前排名系统仅主人或白名单可用。');
    const name = queryName(this.e.msg, '极限面板');
    const { resolved, list } = this.getRoleRecords(name);
    if (!resolved) return false;

    const superCfg = settings.getConfig('super_panel') || {};
    const superData = superCfg[resolved.name];
    let data = null;
    if (superData?.source_uid) {
      const preset = loadAllPanelRecords()
        .find(v => String(v.uid) === String(superData.source_uid) && Number(v.data?.id) === Number(resolved.id));
      if (!preset) return this.reply(`【${resolved.name}】理论极限预设源 UID ${superData.source_uid} 未找到面板数据。`);
      data = await applySuperOverrides(preset.data, superData);
    } else if (superData?.char_id || superData?.weapon_id) {
      data = buildSuperPanelData(superData, resolved);
      if (!data) return this.reply(`【${resolved.name}】理论极限面板生成失败，请检查 super_panel.yaml 配置。`);
      data = await applySuperOverrides(data, { ...superData, max_drive: false });
    }

    if (data) {
      const { Panel } = await import('./panel.js');
      const app = new Panel();
      app.e = this.e;
      return app.getCharPanelTool(this.e, {
        uid: '100000000',
        data,
        needSave: false,
        reply: true,
        needImg: true
      });
    }

    return this.reply(`暂无【${resolved.name}】理论极限面板预设。需要先在 ZZZ-Plugin/config/super_panel.yaml 配置 source_uid 或 char_id/weapon_id。`);
  }
}
