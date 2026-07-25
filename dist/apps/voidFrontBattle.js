import { rulePrefix } from "../lib/common.js";
import { ZZZPlugin } from "../lib/plugin.js";
import settings from "../lib/settings.js";
import { saveVoidFrontBattleData } from "../lib/db.js";
import { isGroupRankAllowed, isUserRankAllowed, addUserToGroupRank, setUidAndQQ, } from "../lib/rank.js";
export class VoidFrontBattle extends ZZZPlugin {
    isGroupRankAllowed;
    constructor() {
        super({
            name: "[ZZZ-Plugin]voidFrontBattle",
            dsc: "zzz临界推演",
            event: "message",
            priority: settings.getConfig("priority")?.voidFrontBattle ?? -10000,
            rule: [
                {
                    // 避免 %zzz临界 被其它插件/别名链抢走，提供 ZZZ-Plugin 专用短前缀。
                    reg: `^(?:%z|#绝区零z|#绝区z)(上期|往期)?(临界推演|临界|推演)$`,
                    fnc: "voidFrontBattle",
                },
                {
                    reg: `${rulePrefix}(上期|往期)?(临界推演|临界|推演)$`,
                    fnc: "voidFrontBattle",
                },
            ],
        });
        this.isGroupRankAllowed = isGroupRankAllowed;
    }
    async voidFrontBattle() {
        const { api, deviceFp } = await this.getAPI();
        await this.getPlayerInfo();
        const isPeriod = this.e.msg.match(`(上期|往期)`);
        const method = isPeriod ? 'zzzVoidFrontBattlePeriod' : 'zzzVoidFrontBattle';
        const voidFrontBattleDetail = await api
            .getFinalData(method, {
            deviceFp,
        })
            .catch((e) => {
            this.reply(e.message);
            throw e;
        });
        if (!voidFrontBattleDetail?.void_front_battle_detail) {
            return this.reply("暂无临界推演数据");
        }
        const rank_type = "VOID_FRONT_BATTLE";
        const uid = await this.getUID();
        let userRankAllowed = null;
        if (!isPeriod && uid) {
            if (this.e?.group_id) {
                await addUserToGroupRank(rank_type, uid, this.e.group_id);
                const qq = this.e.at && !this.e.atBot ? this.e.at : this.e.user_id;
                await setUidAndQQ(this.e.group_id, uid, qq);
                userRankAllowed = !!(await isUserRankAllowed(rank_type, uid, this.e.group_id));
            }
            if (this.isGroupRankAllowed()) {
                saveVoidFrontBattleData(uid, {
                    player: this.e.playerCard,
                    result: voidFrontBattleDetail.void_front_battle_detail,
                });
            }
        }
        const voidFrontBattle = processVoidFrontBattleData(voidFrontBattleDetail.void_front_battle_detail);
        const genshinTplData = toGenshinVoidFrontData(voidFrontBattle, uid, this.e?.playerCard?.player);
        const finalData = {
            voidFrontBattle,
            ...genshinTplData,
            userRankAllowed,
            isPeriod,
        };
        await this.render("ZZZero/html/voidFront/voidFront.html", finalData, this);
    }
}
function pad(num) {
    return String(num || 0).padStart(2, "0");
}
function fmtDate(o) {
    if (!o)
        return "";
    return `${o.year}.${pad(o.month)}.${pad(o.day)} ${pad(o.hour)}:${pad(o.minute)}:${pad(o.second)}`;
}
function clearHtml(txt = "") {
    return String(txt).replace(/<[^>]+>/g, "").replace(/\\n/g, " ");
}
function parseAvatars(list = []) {
    return list.map(a => ({ ...a }));
}
function parseBuddy(b = {}) {
    return { ...b };
}
function parseBuffer(b = {}) {
    return {
        icon: b.icon || "",
        name: b.name || "",
        desc: clearHtml(b.desc || b.text || ""),
    };
}
function toGenshinVoidFrontData(d, uid, player = {}) {
    const brief = d?.void_front_battle_abstract_info_brief || {};
    const bossRec = d?.boss_challenge_record?.main_challenge_record || {};
    const bossInfo = d?.boss_challenge_record?.boss_info || {};
    const roleInfo = d?.role_basic_info || {};
    let endTime = "";
    if (brief.end_ts && !brief.end_ts_over_42_days) {
        const endDate = new Date(brief.end_ts * 1000);
        const diff = endDate - new Date();
        if (diff > 0) {
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            endTime = `${days}天${hours}小时${minutes}分钟`;
        }
        else {
            endTime = "已结束";
        }
    }
    else if (brief.end_time) {
        endTime = fmtDate(brief.end_time);
    }
    const parseRecord = (m = {}) => ({
        battle_id: m.battle_id,
        node_id: m.node_id,
        name: m.name,
        score: m.score,
        star: m.star,
        score_ratio: m.score_ratio,
        max_score: m.max_score,
        challenge_time: fmtDate(m.challenge_time),
        buffer: parseBuffer(m.buffer || {}),
        avatars: parseAvatars(m.avatar_list || []),
        buddy: parseBuddy(m.buddy || {}),
        sub: (m.sub_challenge_record || []).map(s => ({
            battle_id: s.battle_id,
            name: s.name,
            star: s.star,
            avatars: parseAvatars(s.avatar_list || []),
            buddy: parseBuddy(s.buddy || {}),
            buffer: parseBuffer(s.buffer || {}),
        })),
    });
    const mainBoss = {
        ...parseRecord(bossRec),
        boss: {
            name: bossInfo.name || "",
            icon: bossInfo.icon || "",
            race_icon: bossInfo.race_icon || "",
            bg_icon: bossInfo.bg_icon || "",
        },
    };
    return {
        uid,
        total_score: brief.total_score || 0,
        rank_percent: (Number(brief.rank_percent || 0) / 100).toFixed(2),
        void_front_battle_abstract_info_brief: {
            end_ts_over_42_days: !!brief.end_ts_over_42_days,
            void_front_id: brief.void_front_id,
        },
        end_time: endTime,
        ending_record_name: brief.ending_record_name || "",
        ending_record_bg_pic: brief.ending_record_bg_pic || "",
        boss_main: mainBoss,
        stages: (d?.main_challenge_record_list || []).map(parseRecord),
        role: {
            ...roleInfo,
            nickname: roleInfo.nickname || player?.nickname || "",
            icon: roleInfo.icon || player?.avatar || "",
        },
    };
}
function processVoidFrontBattleData(voidFrontBattle) {
    const rankPercent = voidFrontBattle.void_front_battle_abstract_info_brief.rank_percent / 100;
    if (rankPercent < 1) {
        voidFrontBattle.rankBg = 1;
    }
    else if (rankPercent < 5) {
        voidFrontBattle.rankBg = 2;
    }
    else if (rankPercent < 10) {
        voidFrontBattle.rankBg = 3;
    }
    else if (rankPercent < 50) {
        voidFrontBattle.rankBg = 4;
    }
    else {
        voidFrontBattle.rankBg = 5;
    }
    voidFrontBattle.formatTime = function (time) {
        const pad = (num) => num.toString().padStart(2, "0");
        return `${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
    };
    return voidFrontBattle;
}
//# sourceMappingURL=voidFrontBattle.js.map
