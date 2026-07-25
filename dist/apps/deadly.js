import { isGroupRankAllowed, isUserRankAllowed, addUserToGroupRank, setUidAndQQ } from '../lib/rank.js';
import { rulePrefix } from '../lib/common.js';
import { saveDeadlyData } from '../lib/db.js';
import { ZZZPlugin } from '../lib/plugin.js';
import { Deadly } from '../model/deadly.js';
import settings from '../lib/settings.js';
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
        const finalData = {
            deadly,
            ...toGenshinMemDetailData(deadly, uid, this.e?.playerCard?.player),
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
    return String(txt).replace(/<[^>]+>/g, '').replace(/\\n/g, ' ');
}
function toGenshinMemDetailData(deadly, uid, player = {}) {
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
            return {
                score: v.score,
                star: v.star,
                total_star: v.total_star,
                challenge_time: fmtDate(v.challenge_time),
                boss: { ...boss, bg_num: getBossBgNum(boss) },
                buffer: { ...buff, desc: clearHtml(buff.desc || '') },
                avatars: (v.avatar_list || []).map(a => ({ ...a })),
                buddy: v.buddy || {}
            };
        })
    };
}
//# sourceMappingURL=deadly.js.map
