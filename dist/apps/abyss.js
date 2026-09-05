import { isGroupRankAllowed, isUserRankAllowed, addUserToGroupRank, setUidAndQQ } from '../lib/rank.js';
import { rulePrefix } from '../lib/common.js';
import { saveAbyssData } from '../lib/db.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
import moment from 'moment';
export class Abyss extends ZZZPlugin {
    isGroupRankAllowed;
    constructor() {
        super({
            name: '[ZZZ-Plugin]abyss',
            dsc: 'zzz式舆防卫战',
            event: 'message',
            priority: settings.getConfig('priority')?.abyss ?? 70,
            rule: [
                {
                    reg: `${rulePrefix}(上期|往期)?(式舆防卫战|式舆|深渊|防卫战|防卫)$`,
                    fnc: 'abyss'
                }
            ]
        });
        this.isGroupRankAllowed = isGroupRankAllowed;
    }
    async abyss() {
        const { api, deviceFp } = await this.getAPI();
        await this.getPlayerInfo();
        const isPrev = !!(this.e.msg || '').match(`(上期|往期)`);
        const method = isPrev ? 'zzzChallengePeriod' : 'zzzChallenge';
        const abyssData = await api.getFinalData(method, {
            deviceFp,
        }).catch((e) => {
            this.reply(e.message);
            throw e;
        });
        if (abyssData?.hadal_ver !== 'v2') {
            return this.reply('式舆防卫战数据不是最新版本，可能为之前的深渊');
        }
        const data = abyssData?.hadal_info_v2;
        if (['fitfh', 'fourth', 'third', 'second', 'first'].every(layer => !data?.[`${layer}_layer_detail`])) {
            return this.reply('式舆防卫战数据为空');
        }
        const rank_type = 'ABYSS';
        const uid = await this.getUID();
        let userRankAllowed = null;
        if (uid) {
            if (this.e?.group_id) {
                await addUserToGroupRank(rank_type, uid, this.e.group_id);
                const qq = (this.e.at && !this.e.atBot) ? this.e.at : this.e.user_id;
                await setUidAndQQ(this.e.group_id, uid, qq);
                userRankAllowed = !!(await isUserRankAllowed(rank_type, uid, this.e.group_id));
            }
            if (this.isGroupRankAllowed()) {
                saveAbyssData(uid, {
                    player: this.e.playerCard,
                    result: abyssData
                });
            }
        }
        const abyss = processAbyssData(data);
        // Boss 名称/弱点/抗性优先取 nanoka（随版本自动更新），失败则回退到 abyss_boss_*.yaml
        const nanokaBosses = await fetchShiyuBosses(isPrev ? -1 : 0);
        const genshinTplData = toGenshinChallengeData(abyss, uid, this.e?.playerCard?.player, abyssData, nanokaBosses);
        const finalData = {
            abyss,
            ...genshinTplData,
            userRankAllowed
        };
        await this.render('ZZZero/html/challenge/challenge.html', finalData, this);
    }
}
function pad(num) {
    return String(num || 0).padStart(2, '0');
}
function fmtDate(o) {
    if (!o)
        return '';
    return `${o.year}.${pad(o.month)}.${pad(o.day)} ${pad(o.hour)}:${pad(o.minute)}:${pad(o.second)}`;
}
function parseBuffText(t) {
    if (!t)
        return '';
    return String(t)
        .replace(/<color=#([0-9A-Fa-f]+)>([^<]*)<\/color>/g, '<span style="color:#$1">$2</span>')
        .replace(/\\n/g, '<br>')
        .replace(/\n/g, '<br>');
}
function getMonsterName(item = {}) {
    return getMonsterMeta(item).name;
}
function normalizeMonsterMeta(meta = '') {
    if (typeof meta === 'string')
        return { name: meta, weakness: '', resistance: '' };
    if (meta && typeof meta === 'object') {
        return {
            name: meta.name || meta.title || '',
            weakness: meta.weakness || meta.weak || meta.weaknesses || '',
            resistance: meta.resistance || meta.resist || meta.resistances || '',
        };
    }
    return { name: '', weakness: '', resistance: '' };
}
const defaultBossNameMap = {
    '280944f4e04dea73a92605a2f4ad2469': '秽蚀·多佩冈亚·「变节者」',
    'eeb1ad4ab2be38f802e96d67f5ab3c97': '秽蚀·蛮横力士',
    'a9f598219354ce6189e61be35e5e309b': '秽蚀·多佩冈亚·狛野真斗',
    '17f5e0c39d34640f98da76cec5f70704': '秽蚀·多佩冈亚·「变节者」',
    '0e155bf60bb8cb2a865b636e659cb768': '秽蚀·蛮横力士',
    '88f46b168ebffe88b028d39a3a349ec5': '秽蚀·多佩冈亚·狛野真斗',
    '4dba90f6c3dc64842c9321dec3bc44d9': '黑比利',
    '8fcca877f246fdb1b978314e0df07c06': '缄枢',
    'a409ce5bed844ede7d25b0cf2b0e4497': '蜕生·阿瓦鲁斯',
    '6b32f90beb8e567a4d1e5dc14919a977': '多佩冈亚·星徽·比利',
    'b54d5e9aefc998cf1a4956c875804086': '盘岳',
};
const defaultBossMetaMap = {
    '280944f4e04dea73a92605a2f4ad2469': { weakness: '火 / 物理', resistance: '以太' },
    'eeb1ad4ab2be38f802e96d67f5ab3c97': { weakness: '以太 / 风', resistance: '电' },
    'a9f598219354ce6189e61be35e5e309b': { weakness: '冰', resistance: '物理' },
    '17f5e0c39d34640f98da76cec5f70704': { weakness: '火 / 物理', resistance: '以太' },
    '0e155bf60bb8cb2a865b636e659cb768': { weakness: '以太 / 风', resistance: '电' },
    '88f46b168ebffe88b028d39a3a349ec5': { weakness: '冰', resistance: '物理' },
    '4dba90f6c3dc64842c9321dec3bc44d9': { weakness: '火 / 以太', resistance: '电' },
    '8fcca877f246fdb1b978314e0df07c06': { weakness: '电 / 以太', resistance: '火' },
    'a409ce5bed844ede7d25b0cf2b0e4497': { weakness: '物理 / 风', resistance: '火' },
    '6b32f90beb8e567a4d1e5dc14919a977': { weakness: '火 / 电', resistance: '物理' },
    'b54d5e9aefc998cf1a4956c875804086': { weakness: '冰 / 电', resistance: '火' },
};
function getMonsterMeta(item = {}) {
    const direct = normalizeMonsterMeta(item.monster || item.boss || {});
    const name = item.monster_name || item.boss_name || item.name || direct.name;
    const weakness = item.weakness || item.weak || item.weaknesses || direct.weakness;
    const resistance = item.resistance || item.resist || item.resistances || direct.resistance;
    const hash = String(item.monster_pic || '').match(/[a-f0-9]{32}/i)?.[0] || String(item.monster_pic || '').split('/').pop()?.replace(/\.[^.]+$/, '');
    if ((name || weakness || resistance) && (!hash || (name && name !== 'BOSS' && name !== '暂未标注')))
        return { name, weakness, resistance };
    if (!hash)
        return { name: '', weakness: '', resistance: '' };
    const configuredNameMap = settings.getConfig('abyss_boss_name') || {};
    const configuredMetaMap = settings.getConfig('abyss_boss_meta') || {};
    const rawName = configuredNameMap[hash] || configuredNameMap[String(item.monster_pic || '')] || '';
    const fallbackName = defaultBossNameMap[hash] || defaultBossNameMap[String(item.monster_pic || '')] || '';
    const nameMeta = normalizeMonsterMeta(rawName && rawName !== 'BOSS' ? rawName : fallbackName || rawName);
    const extraMeta = normalizeMonsterMeta(configuredMetaMap[hash] || configuredMetaMap[String(item.monster_pic || '')] || defaultBossMetaMap[hash] || defaultBossMetaMap[String(item.monster_pic || '')] || '');
    return {
        name: nameMeta.name || extraMeta.name,
        weakness: extraMeta.weakness || nameMeta.weakness,
        resistance: extraMeta.resistance || nameMeta.resistance,
    };
}
const NANOKA_BASE = 'https://static.nanoka.cc';
// nanoka 的 monster.element 字段：1 表示弱点，-1 表示抗性
const NANOKA_ELEMENT_ZH = {
    physical: '物理',
    fire: '火',
    ice: '冰',
    electric: '电',
    ether: '以太',
    wind: '风',
};

async function fetchJson(url, timeout = 8000) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) return null;
        return await res.json();
    }
    catch (e) {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}

function pickElementsBySign(element = {}, sign) {
    return Object.entries(element || {})
        .filter(([, v]) => Number(v) === sign)
        .map(([k]) => NANOKA_ELEMENT_ZH[k])
        .filter(Boolean);
}

// 把 nanoka zone.name 解析成防线序号(1-5)。
// 例：剧变节点第一防线→1；房间一/房间二/房间三→第5防线被拆出的子房间，归到第5防线。
const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
function lineFromZoneName(name = '') {
    if (!name) return null;
    const m = String(name).match(/第([一二三四五六七八九十]+)防线/);
    if (m) return CN_NUM[m[1]];
    if (/房间/.test(name)) return 5; // 第5防线常被拆成 房间一/二/三
    return null;
}

/**
 * 从 nanoka 拉取式舆防卫战的 Boss 信息（名称 / 弱点 / 抗性）
 * periodOffset: 0 当期，-1 上期
 * 按防线编号(1-5)分组返回 { [line]: [{name,weakness,resistance,...}] }，失败返回 null
 */
async function fetchShiyuBosses(periodOffset = 0) {
    try {
        const manifest = await fetchJson(`${NANOKA_BASE}/manifest.json`, 6000);
        const nv = manifest?.zzz?.latest;
        if (!nv) return null;

        // 从 shiyu.json 列表按时间窗找当期，避免 version.json 最后一个可能是占位/测试期。
        // 兼容 live_begin/live_end 与 begin/end 两种字段命名。
        const list = await fetchJson(`${NANOKA_BASE}/zzz/${nv}/shiyu.json`, 8000);
        const items = Object.entries(list || {})
            .map(([k, v]) => ({ id: Number(k), ...v }))
            .filter(v => Number.isFinite(v.id) && ((v.live_begin || v.begin) && (v.live_end || v.end)))
            .sort((a, b) => a.id - b.id);
        if (!items.length) return null;

        const now = moment();
        let idx = items.findIndex(v => {
            const begin = moment(v.live_begin || v.begin);
            const end = moment(v.live_end || v.end);
            return now.isBetween(begin, end, undefined, '[]');
        });
        if (idx < 0) idx = items.length - 1;
        idx += periodOffset;
        if (idx < 0) idx = 0;
        if (idx >= items.length) idx = items.length - 1;

        const id = items[idx].id;
        const detail = await fetchJson(`${NANOKA_BASE}/zzz/${nv}/zh/shiyu/${id}.json`, 10000);
        if (!detail?.zone) return null;

        // 按 zone.name 把房间归到对应防线(1-5)。nanoka 第5防线常被拆成
        // 「房间一/房间二/房间三」等子 zone，不能简单平铺后按序套用，
        // 否则玩家只打后面防线时会整体错位，把 Boss 张冠李戴。
        const byLine = {};
        for (const [zk, z] of Object.entries(detail.zone || {})) {
            const line = lineFromZoneName(z.name);
            if (!line) continue;
            const rooms = Object.entries(z.layer_room || {})
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, v]) => v);
            for (const room of rooms) {
                const monsterEntries = Object.entries(room.monster_list || {})
                    .sort(([a], [b]) => Number(a) - Number(b));
                const mon = (monsterEntries.length ? monsterEntries[monsterEntries.length - 1][1] : {}) || {};
                if (!mon.name) continue;
                // Boss 自身的弱点/抗性以 monster.element 为准（1=弱点，-1=抗性）。
                // 不再合并 room.monster_weakness，避免某些房间把「推荐属性」或数据错误混入 Boss 属性。
                (byLine[line] = byLine[line] || []).push({
                    name: mon.name,
                    image: mon.image || '',
                    weakness: pickElementsBySign(mon.element, 1),
                    resistance: pickElementsBySign(mon.element, -1),
                    stats: mon.stats || {},
                });
            }
        }
        return Object.keys(byLine).length ? byLine : null;
    }
    catch (e) {
        logger?.debug?.(`[ZZZ-Plugin] nanoka 式舆防卫战数据获取失败：${e?.message || e}`);
        return null;
    }
}

const elementIconMap = {
    '物理': 'Physical',
    '火': 'Fire',
    '冰': 'Ice',
    '电': 'Electric',
    '以太': 'Ether',
    '风': 'Wind',
    '凛刃': 'HonedEdge',
    '烈霜': 'Frost',
    '玄墨': 'AuricInk',
};
function toElementTags(value = '') {
    const list = Array.isArray(value) ? value : String(value || '').split(/[、,/|，\s]+/);
    return list
        .map(v => String(v || '').trim())
        .filter(Boolean)
        .map(name => {
        const icon = elementIconMap[name];
        return icon ? { name, icon: `common/images/element/${icon}.png` } : { name, icon: '' };
    });
}
function toGenshinChallengeData(raw, uid, player = {}, source = {}, nanokaBosses = null) {
    const layerNames = ['first', 'second', 'third', 'fourth', 'fitfh'];
    const layerNameZH = { first: '一', second: '二', third: '三', fourth: '四', fitfh: '五' };
    // 游戏 layer(first~fifth) 与 nanoka 防线(1~5) 一一对应（渲染层会加「剧变节点」前缀）
    const layerLineMap = { first: 1, second: 2, third: 3, fourth: 4, fitfh: 5 };
    const layers = layerNames
        .map(name => ({ name, zh: layerNameZH[name], data: raw?.[`${name}_layer_detail`] }))
        .filter(l => l.data && l.data.layer_challenge_info_list);
    const grade = { S: 0, A: 0, B: 0 };
    for (const layer of layers) {
        // nanoka 按防线分组返回，按 line 精准对位；玩家只打部分防线也不会整段错位
        const lineBosses = (nanokaBosses && nanokaBosses[layerLineMap[layer.name]]) || null;
        let roomIndex = 0;
        for (const item of layer.data.layer_challenge_info_list || []) {
            if (grade[item.rating] !== undefined)
                grade[item.rating]++;
            if (item.buffer?.text)
                item.buffer.text = parseBuffText(item.buffer.text);
            if (item.challenge_time)
                item.challenge_time_fmt = fmtDate(item.challenge_time);
            const monsterMeta = getMonsterMeta(item);
            // nanoka 随版本更新，优先使用；取不到时回退到本地 hash 映射表
            const nb = lineBosses ? lineBosses[roomIndex] : null;
            roomIndex++;
            const weakness = nb?.weakness?.length ? nb.weakness : monsterMeta.weakness;
            const resistance = nb?.resistance?.length ? nb.resistance : monsterMeta.resistance;
            item.monster_name = nb?.name || monsterMeta.name;
            item.monster_weakness = Array.isArray(weakness) ? weakness.join(' / ') : weakness;
            item.monster_resistance = Array.isArray(resistance) ? resistance.join(' / ') : resistance;
            item.monster_weakness_tags = toElementTags(weakness);
            item.monster_resistance_tags = toElementTags(resistance);
        }
    }
    return {
        uid,
        period: raw?.hadal_begin_time ? `${fmtDate(raw.hadal_begin_time).slice(0, 10)} - ${fmtDate(raw.hadal_end_time).slice(0, 10)}` : '',
        grade,
        rank_percent: raw?.brief ? (Number(raw.brief.rank_percent || 0) / 100).toFixed(2) : '0.00',
        layers,
        brief: raw?.brief || {},
        brief_rating: raw?.brief?.rating?.replace('+', 'P') || '',
        nickname: source?.nick_name || player?.nickname || '',
        avatar_icon: source?.icon || player?.avatar || '',
        level: player?.level || '',
    };
}
function processAbyssData(abyss) {
    const rankPercent = (abyss?.brief?.rank_percent || 0) / 100;
    if (rankPercent < 1) {
        abyss.rankBg = 1;
    }
    else if (rankPercent < 5) {
        abyss.rankBg = 2;
    }
    else if (rankPercent < 10) {
        abyss.rankBg = 3;
    }
    else if (rankPercent < 50) {
        abyss.rankBg = 4;
    }
    else {
        abyss.rankBg = 5;
    }
    abyss.formatTime = function (time) {
        const pad = (num) => num.toString().padStart(2, '0');
        return `${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
    };
    abyss.formatBattleTime = function (seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    return abyss;
}
//# sourceMappingURL=abyss.js.map
