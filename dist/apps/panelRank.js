import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { dataPath } from '../lib/path.js';
import { char } from '../lib/convert.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';

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

function getScore(data) {
  const raw = _.get(data, 'equip_plan_info.equip_rating_score', 0);
  return Number(raw) || 0;
}

function getRating(data) {
  return String(_.get(data, 'equip_plan_info.equip_rating', 'ER_Default')).replace(/^ER_/, '').replace(/_/g, '+');
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
    const clean = String(name || '').replace(/代理人|角色/g, '').trim();
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
      .sort((a, b) => b.score - a.score || b.valid - a.valid || parseNum(prop(b.data, '攻击力')) - parseNum(prop(a.data, '攻击力')));
    return { resolved, list };
  }

  async panelRank() {
    const name = queryName(this.e.msg, '排名');
    const { resolved, list } = this.getRoleRecords(name);
    if (!resolved) return false;
    if (!list.length) return this.reply(`暂无【${resolved.name}】面板排名数据，请先让大家使用 %zzz更新面板 或 %zzz更新展柜面板。`);
    const maxDisplay = Math.max(1, Math.min(Number(_.get(settings.getConfig('rank'), 'max_display', 15)) || 15, 20));
    const lines = list.slice(0, maxDisplay).map((v, i) => {
      const weapon = v.data?.weapon?.name ? `｜${v.data.weapon.name}` : '';
      return `${i + 1}. UID ${v.uid}｜${v.score.toFixed(2)}分 ${v.rating}${weapon}\n   ${statLine(v.data)}`;
    });
    return this.reply(`【${resolved.name}面板排名】共 ${list.length} 份本地面板\n${lines.join('\n')}\n\n说明：按米游社养成方案评分排序；没有更新面板的人不会参与排名。`);
  }

  async limitPanel() {
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
    const ownText = own
      ? `当前：第 ${ownIndex + 1}/${list.length}｜${own.score.toFixed(2)}分 ${own.rating}\n${statLine(own.data)}`
      : `当前：未找到你的【${resolved.name}】本地面板，以下展示本地最高参考。`;
    return this.reply(`【${resolved.name}极限面板】\n${ownText}\n\n本地最高：UID ${best.uid}｜${best.score.toFixed(2)}分 ${best.rating}\n${statLine(best.data)}\n\n简版极限目标：100分 S+\n当前参考还可提升：约 ${improve.toFixed(2)} 分\n说明：先按米游社养成方案评分估算，后续可以继续细化成每个代理人的专属权重。`);
  }
}
