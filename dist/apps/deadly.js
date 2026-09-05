import { isGroupRankAllowed, isUserRankAllowed, addUserToGroupRank, setUidAndQQ } from '../lib/rank.js';
import { rulePrefix } from '../lib/common.js';
import { saveDeadlyData } from '../lib/db.js';
import { ZZZPlugin } from '../lib/plugin.js';
import { Deadly } from '../model/deadly.js';
import settings from '../lib/settings.js';
import { getMonsterMeta, toElementTags } from '../lib/monsterMeta.js';
import moment from 'moment';
export class deadly extends ZZZPlugin {
    isGroupRankAllowed;
    constructor() {
        super({
            name: '[ZZZ-Plugin]deadly',
            dsc: 'zzz危局强袭战',
            event: 'message',
            priority: settings.getConfig('priority')?.deadly ?? 70,
            rule: [
                {
                    reg: `${rulePrefix}(上期|往期)?(危局强袭战|危局|强袭|强袭战)$`,
                    fnc: 'deadly'
                }
            ]
        });
        this.isGroupRankAllowed = isGroupRankAllowed;
    }
    async deadly() {
        const { api, deviceFp } = await this.getAPI();
        await this.getPlayerInfo();
        const method = this.e.msg.match(`(上期|往期)`) ? 'zzzDeadlyPeriod' : 'zzzDeadly';
        const deadlyData = await api.getFinalData(method, {
            deviceFp
        }).catch((e) => {
            this.reply(e.message);
            throw e;
        });
        if (!deadlyData?.has_data) {
            return this.reply('没有危局强袭战数据');
        }
        const rank_type = 'DEADLY';
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
                saveDeadlyData(uid, {
                    player: this.e.playerCard,
                    result: deadlyData
                });
            }
        }
        const deadly = new Deadly(deadlyData);
        const timer = setTimeout(() => {
            if (this?.reply) {
                this.reply('查询成功，正在下载图片资源，请稍候。');
            }
        }, 5000);
        await deadly.get_assets();
        clearTimeout(timer);
        const nanokaBosses = await fetchDeadlyBosses(method === 'zzzDeadlyPeriod' ? -1 : 0);
        const finalData = {
            deadly,
            ...toGenshinMemDetailData(deadly, uid, this.e?.playerCard?.player, nanokaBosses),
            userRankAllowed
        };
        await this.render('ZZZero/html/memDetail/memDetail.html', finalData, this);
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
function getBossBgNum(boss = {}) {
    const m = String(boss.bg_icon || '').match(/boss_bg_(\d)/);
    return m?.[1] ? Number(m[1]) : 1;
}
function clearHtml(txt = '') {
    return String(txt).replace(/<[^>]+>/g, '').replace(/\\n/g, '\n');
}
function toGenshinMemDetailData(deadly, uid, player = {}, nanokaBosses = null) {
    const start = `${deadly.start_time.year}.${pad(deadly.start_time.month)}.${pad(deadly.start_time.day)}`;
    const end = `${deadly.end_time.year}.${pad(deadly.end_time.month)}.${pad(deadly.end_time.day)}`;
    return {
        uid,
        nickname: deadly.nick_name || player?.nickname || '',
        avatar_icon: deadly.avatar_icon || player?.avatar || '',
        total_score: deadly.total_score,
        total_star: deadly.total_star,
        rank_percent: (Number(deadly.rank_percent || 0) / 100).toFixed(2),
        period: `${start} - ${end}`,
        list: (deadly.list || []).map(v => {
            const boss = v.boss?.[0] || {};
            const buff = v.buffer?.[0] || {};
            const nanokaBoss = nanokaBosses?.find(b => b.name && b.name === boss.name);
            const bossMeta = nanokaBoss || getMonsterMeta({ ...boss, monster_pic: boss.monster_pic || boss.boss_pic || boss.image || boss.pic });
            return {
                score: v.score,
                star: v.star,
                total_star: v.total_star,
                challenge_time: fmtDate(v.challenge_time),
                boss: {
                    ...boss,
                    bg_num: getBossBgNum(boss),
                    monster_weakness_tags: toElementTags(bossMeta.weakness),
                    monster_resistance_tags: toElementTags(bossMeta.resistance),
                },
                buffer: { ...buff, desc: clearHtml(buff.desc || '') },
                avatars: (v.avatar_list || []).map(a => ({ ...a })),
                buddy: v.buddy || {}
            };
        })
    };
}
const NANOKA_BASE = 'https://static.nanoka.cc';
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
async function fetchDeadlyBosses(periodOffset = 0) {
    try {
        const manifest = await fetchJson(`${NANOKA_BASE}/manifest.json`, 6000);
        const nv = manifest?.zzz?.latest;
        if (!nv) return null;
        const list = await fetchJson(`${NANOKA_BASE}/zzz/${nv}/boss.json`, 8000);
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
        const detail = await fetchJson(`${NANOKA_BASE}/zzz/${nv}/zh/boss/${id}.json`, 10000);
        if (!detail?.modes) return null;
        const bosses = [];
        for (const mode of detail.modes || []) {
            for (const z of Object.values(mode.zone || {})) {
                for (const room of Object.values(z.layer_room || {})) {
                    const monsterEntries = Object.entries(room.monster_list || {})
                        .sort(([a], [b]) => Number(a) - Number(b));
                    const mon = (monsterEntries.length ? monsterEntries[monsterEntries.length - 1][1] : {}) || {};
                    if (!mon.name) continue;
                    bosses.push({
                        name: mon.name,
                        weakness: pickElementsBySign(mon.element, 1),
                        resistance: pickElementsBySign(mon.element, -1),
                    });
                }
            }
        }
        return bosses.length ? bosses : null;
    }
    catch (e) {
        logger?.debug?.(`[ZZZ-Plugin] nanoka 危局强袭战数据获取失败：${e?.message || e}`);
        return null;
    }
}
//# sourceMappingURL=deadly.js.map
