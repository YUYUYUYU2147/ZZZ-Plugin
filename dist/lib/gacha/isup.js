/**
 * 按卡池日程表判定「是否当期 UP」。
 *
 * 原判定只靠两份硬编码名单（NORMAL_LIST / CUSTOM_FM_CURRENT_UP_LIST），
 * 对「重映池」这类需要按期数区分的场景不准：3.1 定制调频上线后，
 * 代码会把所有非当期 UP 的代理人/音擎一律判歪，于是往期重映角色即使
 * 抽在它自己的 UP 期里也不给角标。
 *
 * 这里改为查日程表 resources/map/zzz_gacha_pool_history.yaml：
 * 每期记录 type（角色/武器）、timer（起止时间）、s（当期 UP 角色/音擎）。
 * 判定规则与 xhh 的 buildIsUP 保持一致：
 *   · 命中含该记录时间的期数 → 名字在该期 UP 名单里即为 UP；
 *   · 日程表没有覆盖该时间 → 取时间上最接近的一期兜底；
 *   · 常驻/新手池不参与判定（没有 50/50）。
 * 名单判不出来时回落到原来的硬编码判定，两者都不生效才按歪处理。
 */
import fs from 'fs';
import path from 'path';
import { mapResourcesPath } from '../path.js';
import { NORMAL_LIST, CUSTOM_FM_LEAK_LIMIT_LIST, CUSTOM_FM_CURRENT_UP_LIST } from './const.js';

const FAR = Date.UTC(2099, 0, 1);

/** 日程表里「版本更新后」「长期」这类占位不是绝对时间，parseTime 返回 null 由后续补缝 */
function parseTime(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/版本更新后|正式开服后|长期/.test(s)) return null;
  const ms = new Date(s.replace(/-/g, '/')).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function fix(text) {
  return String(text || '').replace(/&amp;/g, '&').trim();
}

/** 名字归一化：去伴随者（琉音&xxx）、统一间隔符，日程表与抽卡记录写法才可比 */
function normName(n) {
  n = fix(n);
  n = n.split(/[&、，,\s]/)[0];
  n = n.replace(/[•·⋅･]/g, '·');
  return n.trim();
}

function nameMatch(a, b) {
  a = normName(a);
  b = normName(b);
  return a === b || a.includes(b) || b.includes(a);
}

let cache = null;

function getPeriods() {
  if (cache) return cache;
  const file = path.join(mapResourcesPath, 'zzz_gacha_pool_history.yaml');
  let txt = '';
  try {
    txt = fs.readFileSync(file, 'utf-8');
  } catch {
    cache = [];
    return cache;
  }
  const blocks = txt.split(/\n- title:/).map((b, i) => (i === 0 ? b : '- title:' + b));
  const periods = [];
  for (const b of blocks) {
    const type = (b.match(/type:\s*(\S+)/) || [])[1];
    const timer = (b.match(/timer:\s*(.+)/) || [])[1]?.trim();
    // s 允许多个名字：重映/回响的「自选频段」当期 UP 有好几位（如 2.5 下半重映是
    // 爱丽丝 / 零号·安比 / 耀嘉音），只记一个会把另外两位误判成歪
    const s = (b.match(/^\s*s:\s*(.+)/m) || [])[1]?.trim();
    if (!type || !timer || !s) continue;
    const [sa, ea] = timer.split('~').map(x => x.trim());
    const p = { start: parseTime(sa), end: parseTime(ea), role: [], weapon: [] };
    const names = s.split(/[,，、]/).map(x => fix(x)).filter(Boolean);
    if (type === '角色') p.role.push(...names);
    else if (type === '武器') p.weapon.push(...names);
    periods.push(p);
  }
  // 起点为空的期（写着「版本更新后」）按上一期结束时间顺延
  periods.sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
  let last = 0;
  for (const p of periods) {
    if (p.start == null) p.start = last + 60000;
    last = p.end ?? FAR;
  }
  cache = periods;
  return periods;
}

/** 池名 -> 判定维度 */
const POOL_TYPE = {
  独家频段: 'role',
  独家重映: 'role',
  音擎频段: 'weapon',
  音擎回响: 'weapon',
  常驻频段: 'role',
  邦布频段: null,
};
/** 重映池：按「除可歪池角色外都是 UP」的宽松口径判，不查日程表 */
const RERUN_POOLS = new Set(['独家重映', '音擎回响']);

/** 可歪池名单：已转入常驻的角色/音擎，在限定/重映池抽到算歪 */
const WAI_ROLES = new Set([
  '格莉丝', '丽娜', '珂蕾妲', '猫又', '11号', '「11号」', '莱卡恩',
  '月城柳', '凯撒', '朱鸢',
]);
const WAI_LIGHT = new Set([
  '硫磺石', '拘缚者', '嵌合编译器', '啜泣摇篮', '燃狱齿轮', '猫爪肉垫',
  '时流贤者', '奔袭獠牙', '防爆者VI型',
]);
/** 3.1（2026-07）起转入常驻的，此前抽到的仍算限定 */
const LATER_COMMON = {
  '月城柳': '2026-07', '凯撒': '2026-07', '朱鸢': '2026-07',
  '时流贤者': '2026-07', '奔袭獠牙': '2026-07', '防爆者VI型': '2026-07',
};

/** 该记录是否可歪（命中名单且已过转入期） */
export function isWaiRecord(name, time) {
  if (!WAI_ROLES.has(name) && !WAI_LIGHT.has(name)) return false;
  const since = LATER_COMMON[name];
  if (!since) return true;
  const month = String(time || '').slice(0, 7);
  return month ? month >= since : false;
}

/**
 * 判定单条五星是否当期 UP。
 * @returns {boolean|undefined} undefined = 日程表给不出结论，交回原硬编码规则
 */
export function isUpBySchedule(poolName, name, time) {
  // 常驻频段没有 50/50，不存在 UP
  if (poolName === '常驻频段') return false;
  // 邦布频段交给原硬编码逻辑（历史条目没有可歪池概念）
  if (!POOL_TYPE[poolName]) return undefined;
  // 限定池（独家/重映）与音擎池（音擎频段/回响）：单期只保当期 UP，
  // 抽到的 S 级要么是当期 UP，要么是可歪池（已转常驻的角色/专武）——后者算歪。
  // 之所以不逐期查日程表：日程表对「版本更新后」这类期次用补缝时间，
  // 叶瞬光/耀嘉音/壳中之灵/云霓孤光/深海访客等缺期记录会被兜底到相邻期而误判为歪，
  // 连带不歪率算出 0% 甚至负数。可歪名单是完整且稳定的判据。
  return !isWaiRecord(name, time);
}

/** 原插件的硬编码判定，保留为日程表给不出结论时的回落 */
export function isUpByLegacy(item) {
  if (NORMAL_LIST.includes(item?.name)) return false;
  if (new Date(item?.time).getTime() > new Date('2026-07-29 00:00:00').getTime()) {
    const leak = CUSTOM_FM_LEAK_LIMIT_LIST.includes(+item?.item_id) ||
      (!NORMAL_LIST.includes(item?.name) && !CUSTOM_FM_CURRENT_UP_LIST.includes(item?.name) && ['代理人', '音擎'].includes(item?.item_type));
    if (leak) return false;
  }
  return true;
}
