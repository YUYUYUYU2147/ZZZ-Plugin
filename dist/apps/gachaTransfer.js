/**
 * 抽卡记录导入/导出（UIGF v2）。
 *
 * ZZZ-Plugin 原版只有「抽卡链接 / 刷新抽卡记录 / 抽卡分析」，没有导入导出，
 * 数据只靠反复刷新在本地累积（data/ZZZ-Plugin/gacha/{uid}.json），
 * 换机、迁移或误删文件后无从恢复。本文件补上这条链路：
 *
 *   %绝区零导出抽卡记录     导出 UIGF v2 JSON（文件或链接均可）
 *   %绝区零导入抽卡记录     发指令后把 JSON 文件/链接发回来，按 id 去重并入
 *
 * 与小花火（xhh）插件导出的格式一致，两边导出的文件可互相导入。
 * 注册方式是 index.js 扫描 dist/apps/*.js 自动装载，无需改动原插件其它文件。
 */
import { getGachaLog, saveGachaLog } from '../lib/db.js';
import { rulePrefix } from '../lib/common.js';
import { ZZZPlugin } from '../lib/plugin.js';
import { dataPath, mapResourcesPath } from '../lib/path.js';
import settings from '../lib/settings.js';
import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// 池名 -> UIGF gacha_type（官方 getGachaLog 编号）
const POOL_TYPE = {
  独家频段: '1',
  独家重映: '2',
  音擎频段: '3',
  音擎回响: '4',
  常驻频段: '5',
  邦布频段: '6',
};
// UIGF gacha_type -> 池名
const TYPE_POOL = Object.fromEntries(Object.entries(POOL_TYPE).map(([ name, type ]) => [ type, name ]));
// UIGF rank_type -> 本插件制式（4=S 5星 3=A 4星 2=B 3星）
const RANK_MAP = { 5: '4', 4: '3', 3: '2' };

/**
 * 名称 -> item_id 映射。
 *
 * 卡片是靠 item_id 去 getSquareAvatar / getWeaponImage 换图标的，导入的记录若没有
 * item_id（UIGF 允许为空），渲染出来就是一片空白格子。这里用插件自带的资源映射表
 * 按名称反查补齐：代理人取 name/full_name，音擎取 Name，邦布取 CHS。
 */
let nameIdMapCache = null;
function getNameIdMap() {
  if (nameIdMapCache) return nameIdMapCache;
  const map = new Map();
  const read = file => {
    try {
      return JSON.parse(fs.readFileSync(path.join(mapResourcesPath, file), 'utf-8'));
    } catch {
      return null;
    }
  };
  const partner = read('PartnerId2Data.json');
  for (const [ id, v ] of Object.entries(partner || {})) {
    for (const n of [ v?.name, v?.full_name ]) {
      if (n && !map.has(n)) map.set(n, String(id));
    }
  }
  const weapon = read('WeaponId2Data.json');
  for (const [ id, v ] of Object.entries(weapon || {})) {
    if (v?.Name && !map.has(v.Name)) map.set(v.Name, String(id));
  }
  const bangboo = read('BangbooId2Data.json');
  for (const [ id, v ] of Object.entries(bangboo || {})) {
    if (v?.CHS && !map.has(v.CHS)) map.set(v.CHS, String(id));
  }
  nameIdMapCache = map;
  return map;
}

/** 用映射表回填缺失的 item_id，返回补了多少条 */
function fillItemId(rows, map) {
  let n = 0;
  for (const row of rows) {
    if (row?.item_id) continue;
    const id = map.get(String(row?.name || '').trim());
    if (id) {
      row.item_id = id;
      n++;
    }
  }
  return n;
}

const IMPORT_SUFFIX = '导入';

export class GachaTransfer extends ZZZPlugin {
  constructor() {
    super({
      name: '[ZZZ-Plugin]抽卡记录导入导出',
      dsc: '导出/导入绝区零抽卡记录（UIGF v2）',
      event: 'message',
      priority: _.get(settings.getConfig('priority'), 'gachalog', 70),
      rule: [
        { reg: `${rulePrefix}导出(抽卡)?(记录|json)$`, fnc: 'exportGacha' },
        { reg: `${rulePrefix}导入(抽卡)?(记录|json)$`, fnc: 'importGacha' }
      ]
    });
  }

  async exportGacha() {
    const uid = await this.getUID();
    const data = getGachaLog(uid);
    if (!data || !Object.keys(data).length) {
      return this.reply('暂无抽卡记录，请先发送%刷新抽卡记录');
    }
    const list = [];
    for (const [ name, rows ] of Object.entries(data)) {
      const type = POOL_TYPE[name];
      if (!type || !Array.isArray(rows)) continue;
      for (const row of rows) {
        const id = String(row?.id ?? '');
        if (!id) continue;
        list.push({
          uid: String(uid),
          gacha_id: '2c1f5692fdfbb733a08733f9eb69d32aed1d37',
          gacha_type: type,
          item_id: String(row?.item_id ?? ''),
          count: String(row?.count ?? '1'),
          time: String(row?.time ?? ''),
          name: String(row?.name ?? '未知'),
          lang: String(row?.lang || 'zh-cn'),
          item_type: String(row?.item_type ?? ''),
          rank_type: String(row?.rank_type ?? ''),
          id
        });
      }
    }
    if (!list.length) return this.reply('本地没有可导出的逐抽记录');
    list.sort((a, b) => Number(b.id) - Number(a.id));
    const payload = {
      info: {
        uid: String(uid),
        lang: 'zh-cn',
        uigf_version: 'v2.3',
        export_time: new Date().toLocaleString('zh-CN'),
        export_app: 'ZZZ-Plugin'
      },
      list
    };
    const dir = path.join(dataPath, 'gacha');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${uid}_uigf.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, '\t'));
    await this.reply(`UID:${uid} 导出成功：${uid}_uigf.json，共 ${list.length} 条\n请接收文件`);
    const send = this.e.group?.sendFile || this.e.friend?.sendFile;
    if (send) await send.call(this.e.group || this.e.friend, file);
    else await this.reply('导出失败：当前适配器不支持发送文件');
    fs.unlink(file, () => {});
  }

  async importGacha() {
    if (!this.e.file && !/^[\s]*[{[]/.test(String(this.e.msg || '')) && !/https?:\/\//.test(String(this.e.msg || ''))) {
      this.setContext('importGachaFile');
      return this.reply('请发送抽卡记录文件（UIGF v2 JSON，支持文件、文件链接，或直接把 JSON 文本贴出来）');
    }
    return this.importGachaFile();
  }

  /**
   * 读取用户发来的文件内容。
   *
   * 各适配器给的字段差别很大：QQ/NTQQ 常常只给文件名不给本地路径（file.path 为空），
   * 早期实现只认 path，于是必然回「未读取到文件内容」。这里按
   * 本地路径 -> http 链接 -> base64 data URI -> 直接把 JSON 贴在消息里 逐级兜底。
   */
  async readFileContent() {
    const file = this.e.file;
    if (file) {
      const p = file?.path || file?.file || file?.name;
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p, 'utf8');
      let url = String(file?.url || '');
      // 群/好友文件只给 fid 时要换下载地址；部分适配器的 getFileUrl 会抛
      // （实测报 real fileUUID not found），失败不能带崩整条导入
      if (!/^(https?:|base64:|data:)/.test(url) && file?.fid) {
        try {
          if (this.e.group?.getFileUrl) url = await this.e.group.getFileUrl(file.fid);
          else if (this.e.friend?.getFileUrl) url = await this.e.friend.getFileUrl(file.fid);
        } catch (err) {
          logger.warn(`[zzz-gacha]取文件下载地址失败：${err?.message || err}`);
          url = '';
        }
      }
      if (url.startsWith('base64://')) return Buffer.from(url.slice(9), 'base64').toString('utf8');
      if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
      if (url.startsWith('http')) {
        const res = await fetch(url, { method: 'GET' });
        return await res.text();
      }
      // 换不到地址时把可用字段打出来，便于判断该适配器给的是什么
      logger.warn(`[zzz-gacha]无法定位文件内容，file 字段：${Object.keys(file).join(',')}`);
    }
    const text = String(this.e.msg || '').trim();
    if (text.startsWith('{') || text.startsWith('[')) return text;
    const link = text.match(/https?:\/\/\S+/)?.[0];
    if (link) {
      const res = await fetch(link, { method: 'GET' });
      return await res.text();
    }
    return '';
  }

  async importGachaFile() {
    this.finish('importGachaFile');
    let text = '';
    try {
      text = await this.readFileContent();
    } catch (err) {
      return this.reply(`读取失败：${err?.message || err}`);
    }
    if (!text) return this.reply([
      '没能读到文件内容（当前适配器不支持取群文件）。',
      '请改用下面任一方式：',
      '1. 把 json 文件上传到网盘，取直链后发给我；',
      '2. 直接把 json 文本贴在聊天里。',
    ].join('\n'));
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return this.reply('不是合法的 JSON 文件');
    }
    const list = json?.list || json?.gachaLog?.list || json?.hkrpg?.[0]?.list;
    if (!Array.isArray(list) || !list.length) return this.reply('文件里没有可导入的抽卡记录（缺少 list）');
    const uid = json?.info?.uid || await this.getUID();
    const old = getGachaLog(uid) || {};
    const nameIdMap = getNameIdMap();
    // 导入的记录单独存一份，键名加「导入」后缀，绝不与官方记录混在同一序列里。
    // 原因：抽数是按「同池相邻两条 S 级的下标差」算的，外部来源的记录一旦插进官方
    // 序列中间（尤其是没有中间逐抽记录的纯 S 级行），前后两条会紧挨着，抽数直接变成 1，
    // 平均值也被带偏。独立区段既保留了数据，又不影响官方统计。
    const grouped = {};
    for (const row of list) {
      const name = TYPE_POOL[String(row?.gacha_type)];
      if (!name) continue;
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push(row);
    }
    const detail = [];
    let added = 0;
    for (const [ name, rows ] of Object.entries(grouped)) {
      const key = name + IMPORT_SUFFIX;
      // 已存在的条目也要看抽数：早先导入的 count 一律是 1（来源没带垫抽数），
      // 后来来源补上了真实抽数时必须更新，否则卡片永远停在 1 抽
      const exist = new Map((old[key] || []).map(i => [String(i?.id ?? ''), i]));
      let updated = 0;
      for (const i of rows) {
        const hit = exist.get(String(i?.id ?? ''));
        if (!hit) continue;
        const num = Number(i?.count) > 1 ? i.count : (i?.gacha_count > 1 ? i.gacha_count : 0);
        if (num && Number(hit.count) !== num) {
          hit.count = String(num);
          updated++;
        }
        if (!hit.item_id && i?.item_id) hit.item_id = String(i.item_id);
      }
      const fresh = rows.filter(i => !exist.has(String(i?.id ?? '')))
        .map(i => ({
          ...i,
          gacha_id: String(i?.gacha_id ?? '2c1f5692fdfbb733a08733f9eb69d32aed1d37'),
          gacha_type: String(i?.gacha_type ?? POOL_TYPE[name]),
          item_id: String(i?.item_id ?? ''),
          // count 保留来源给的值（>1 即该S 级的垫抽数），后面卡片直接显示它
          count: String(Number(i?.count) > 1 ? i.count : (i?.gacha_count > 1 ? i.gacha_count : '1')),
          time: String(i?.time ?? ''),
          name: String(i?.name ?? '未知'),
          lang: String(i?.lang || 'zh-cn'),
          rank_type: RANK_MAP[String(i?.rank_type)] ?? String(i?.rank_type ?? ''),
          uid: String(i?.uid ?? uid),
          id: String(i?.id ?? '')
        }));
      if (!fresh.length) {
        if (updated) detail.push(`【${name}】更新抽数${updated}条`);
        continue;
      }
      added += fresh.length;
      old[key] = [...old[key] || [], ...fresh].sort((a, b) => Number(b.id) - Number(a.id));
      detail.push(`【${name}】+${fresh.length}${updated ? `，更新抽数${updated}条` : ''}`);
    }
    // 导入的记录往往没有 item_id（UIGF 允许为空），缺了它卡片就渲染不出图标，
    // 顺带把本地已有的缺项一并回填，免得每次导入都要重来一遍
    const filled = fillItemId(Object.values(old).flat(), nameIdMap);
    const updatedTotal = Number(String(old).match(/更新抽数(\d+)条/)?.[1] || 0);
    if (!added && !filled && !updatedTotal) return this.reply('没有新记录可导入（按 id 判重后已全部存在）');
    saveGachaLog(uid, old);
    await this.reply([
      `UID:${uid}`,
      added ? `导入完成：新增 ${added} 条\n${detail.join('，')}` : (updatedTotal ? '没有新记录，已更新既有记录的抽数' : '没有新记录（按 id 判重后已全部存在）'),
      filled ? `已按名称回填 item_id ${filled} 条（补上后卡片才有图标）` : '',
    ].filter(Boolean).join('\n'));
  }
}
