import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { dataPath } from '../lib/path.js';
import { char } from '../lib/convert.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
import { isRankPermissionAllowed } from '../lib/rank.js';

const PREFIX = '^(#|%|/)?(?:zzz|ZZZ|绝区零)?\\s*';
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

function queryName(msg = '', suffix = '排名') {
  return String(msg || '')
    // 兼容 TRSS/机器人别名场景，日志里可能显示成 q%xxx，但真正指令从 %/#/ 开始。
    .replace(/^[^#%/]*(?=[#%/])/, '')
    .replace(new RegExp(PREFIX), '')
    .replace(/^(面板)?排名/, '')
    .replace(new RegExp(`(面板)?${suffix}$`), '')
    .trim();
}

export class PanelRank extends ZZZPlugin {
  constructor() {
    super({
      name: '[ZZZ-Plugin]PanelRank',
      dsc: '绝区零角色面板排名/极限面板',
      event: 'message',
      // 需要比普通“xx面板”更早处理，否则“雨果极限面板”会被面板指令当成“雨果极限”的普通面板吃掉。
      priority: _.get(settings.getConfig('priority'), 'panelRank', 60),
      rule: [
        {
          reg: `${PREFIX}.+极限面板$`,
          fnc: 'limitPanel'
        },
        {
          reg: `${PREFIX}.+(面板)?排名$`,
          fnc: 'panelRank'
        }
      ]
    });
  }

  resolveChar(name) {
    const clean = String(name || '')
      .replace(/^[^#%/]*(?=[#%/])/, '')
      .replace(new RegExp(PREFIX), '')
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
    if (!list.length) return this.reply(`暂无【${resolved.name}】面板数据，请先 %zzz更新面板。`);
    let uid = '';
    try { uid = await this.getUID(); } catch (_) { uid = ''; }
    const ownIndex = uid ? list.findIndex(v => String(v.uid) === String(uid)) : -1;
    const own = ownIndex >= 0 ? list[ownIndex] : null;
    const best = list[0];
    const targetScore = 100;
    const base = own || best;
    const improve = Math.max(0, targetScore - base.score);
    const records = [];
    if (own) records.push(viewRecord(own, ownIndex + 1, uid));
    if (!own || own.uid !== best.uid) records.push(viewRecord(best, 1, uid));
    return this.render('panelRank/index.html', {
      mode: 'limit',
      title: `${resolved.name}极限面板`,
      subtitle: own ? `当前第 ${ownIndex + 1}/${list.length}，并展示本地最高参考` : '未找到你的本地面板，展示本地最高参考',
      count: list.length,
      records,
      improve: improve.toFixed(2),
      notes: [
        '简版极限面板先按米游社养成方案评分估算。',
        '后续可以继续细化为每个代理人的专属权重与有效词条算法。'
      ]
    });
  }
}
