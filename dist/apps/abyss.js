import { isGroupRankAllowed, isUserRankAllowed, addUserToGroupRank, setUidAndQQ } from '../lib/rank.js';
import { rulePrefix } from '../lib/common.js';
import { saveAbyssData } from '../lib/db.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
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
        const method = this.e.msg.match(`(上期|往期)`) ? 'zzzChallengePeriod' : 'zzzChallenge';
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
        const genshinTplData = toGenshinChallengeData(abyss, uid, this.e?.playerCard?.player, abyssData);
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
        return icon ? { name, icon: `common/images/element/${icon}.${icon === 'Wind' ? 'svg' : 'png'}` } : { name, icon: '' };
    });
}
function toGenshinChallengeData(raw, uid, player = {}, source = {}) {
    const layerNames = ['first', 'second', 'third', 'fourth', 'fitfh'];
    const layerNameZH = { first: '一', second: '二', third: '三', fourth: '四', fitfh: '五' };
    const layers = layerNames
        .map(name => ({ name, zh: layerNameZH[name], data: raw?.[`${name}_layer_detail`] }))
        .filter(l => l.data && l.data.layer_challenge_info_list);
    const grade = { S: 0, A: 0, B: 0 };
    for (const layer of layers) {
        for (const item of layer.data.layer_challenge_info_list || []) {
            if (grade[item.rating] !== undefined)
                grade[item.rating]++;
            if (item.buffer?.text)
                item.buffer.text = parseBuffText(item.buffer.text);
            if (item.challenge_time)
                item.challenge_time_fmt = fmtDate(item.challenge_time);
            const monsterMeta = getMonsterMeta(item);
            item.monster_name = monsterMeta.name;
            item.monster_weakness = Array.isArray(monsterMeta.weakness) ? monsterMeta.weakness.join(' / ') : monsterMeta.weakness;
            item.monster_resistance = Array.isArray(monsterMeta.resistance) ? monsterMeta.resistance.join(' / ') : monsterMeta.resistance;
            item.monster_weakness_tags = toElementTags(monsterMeta.weakness);
            item.monster_resistance_tags = toElementTags(monsterMeta.resistance);
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
