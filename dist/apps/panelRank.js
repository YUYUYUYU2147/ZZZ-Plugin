import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { dataPath } from '../lib/path.js';
import { char } from '../lib/convert.js';
import { baseValueData } from '../lib/score.js';
import { idToName } from '../lib/convert/property.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
import { isRankPermissionAllowed } from '../lib/rank.js';
import { ZZZAvatarInfo } from '../model/avatar.js';

const PREFIX = '^(#|%|/)?(?:zzz|ZZZ|绝区零)?\\s*';
const ZZZ_ALIAS_PREFIX = /^(?:zzz|ZZZ|绝区零)+\s*/;
const BATTLE_RANK_WORDS = /^(式舆防卫战|式舆|深渊|防卫战|防卫|危局强袭战|危局|强袭|强袭战|临界推演|临界|推演|爬塔|鏖战|爬塔S\\d|爬塔s\\d)/;

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

function getScore(data) {
  const raw = _.get(data, 'equip_plan_info.equip_rating_score', 0);
  return Number(raw) || 0;
}

function getRating(data) {
  return String(_.get(data, 'equip_plan_info.equip_rating', 'ER_Default'))
    .replace(/^ER_/, '')
    .replace(/_Plus$/i, '+')
    .replace(/_/g, '');
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
  return {
    rank,
    uid: v.uid,
    self: !!selfUid && String(v.uid) === String(selfUid),
    score: v.score.toFixed(2),
    rating: v.rating,
    weapon: v.data?.weapon?.name || '',
    icon: v.data?.role_square_url || v.data?.skin_list?.find(s => s.unlocked)?.skin_square_url || '',
    stats: statItems(v.data),
  };
}

function clonePanelData(data) {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
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

function applyMaxDriveScore(data) {
  if (!Array.isArray(data.equip)) return data;
  let weight = {};
  try {
    // 用 ZZZ-Plugin 原生 Avatar/Score 规则决定每个角色该堆哪些词条，避免手写假评分。
    weight = new ZZZAvatarInfo(data).scoreWeight || {};
  } catch (err) {
    logger.warn?.('[ZZZ-Plugin]理论极限面板获取评分权重失败，跳过满词条覆盖', err);
    return data;
  }
  data.equip = data.equip.map(equip => {
    const mainID = Number(equip.main_properties?.[0]?.property_id || 0);
    const candidates = Object.keys(baseValueData)
      .map(Number)
      .filter(id => id !== mainID && Number(weight[id] || 0) > 0)
      .sort((a, b) => Number(weight[b] || 0) - Number(weight[a] || 0) || a - b)
      .slice(0, 4);
    if (!candidates.length) return equip;
    return {
      ...equip,
      level: 15,
      rarity: 'S',
      properties: candidates.map((id, idx) => superProp(id, idx === 0 ? 6 : 1)),
      invalid_property_cnt: 0,
      all_hit: true,
    };
  });
  return data;
}

function applySuperOverrides(data, cfg = {}) {
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
  if (cfg.max_drive) applyMaxDriveScore(ret);
  return ret;
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
      for (const data of list) records.push({ uid, data });
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
    const list = loadAllPanelRecords()
      .filter(v => Number(v.data?.id) === Number(resolved.id))
      .map(v => ({
        ...v,
        score: getScore(v.data),
        rating: getRating(v.data),
        valid: _.get(v.data, 'equip_plan_info.valid_property_cnt', 0),
      }))
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score || b.valid - a.valid || parseNum(prop(b.data, '攻击力')) - parseNum(prop(a.data, '攻击力')));
    return { resolved, list };
  }

  async panelRank() {
    if (!isRankPermissionAllowed(this.e)) return this.reply('当前排名系统仅主人或白名单可用。');
    const name = queryName(this.e.msg, '排名');
    const { resolved, list } = this.getRoleRecords(name);
    if (!resolved) return false;
    if (!list.length) return this.reply(`暂无【${resolved.name}】面板排名数据，请先让大家使用 %zzz更新面板 或 %zzz更新展柜面板。`);
    const maxDisplay = Math.max(1, Math.min(Number(_.get(settings.getConfig('rank'), 'max_display', 15)) || 15, 20));
    const uid = '';
    const records = list.slice(0, maxDisplay).map((v, i) => viewRecord(v, i + 1, uid));
    return this.render('panelRank/index.html', {
      mode: 'rank',
      title: `${resolved.name}面板排名`,
      subtitle: '按米游社养成方案评分排序；未更新面板不参与排名',
      count: list.length,
      records,
      notes: [
        '排名数据来自本地已保存面板，请先使用 %zzz更新面板 或 %zzz更新展柜面板。',
        '同分时按有效词条数、攻击力做简易排序。'
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
    if (superData?.source_uid) {
      const preset = loadAllPanelRecords()
        .find(v => String(v.uid) === String(superData.source_uid) && Number(v.data?.id) === Number(resolved.id));
      if (!preset) return this.reply(`【${resolved.name}】理论极限预设源 UID ${superData.source_uid} 未找到面板数据。`);
      const { Panel } = await import('./panel.js');
      const app = new Panel();
      app.e = this.e;
      return app.getCharPanelTool(this.e, {
        uid: '100000000',
        data: applySuperOverrides(preset.data, superData),
        needSave: false,
        reply: true,
        needImg: true
      });
    }

    return this.reply(`暂无【${resolved.name}】理论极限面板预设。需要先在 ZZZ-Plugin/config/super_panel.yaml 配置 source_uid。`);
  }
}
