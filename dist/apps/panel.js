import { mergePanel, getPanelList, refreshPanel as refreshPanelFunction, getPanelOrigin, updatePanelData, formatPanelData, getPanelListOrigin, } from '../lib/avatar.js';
import { parsePlayerInfo, refreshPanelFromEnka } from '../model/Enka/enkaApi.js';
import { savePlayerInfo } from '../lib/db.js?t=1';
import { rulePrefix } from '../lib/common.js';
import { ZZZPlugin } from '../lib/plugin.js';
import { dataPath } from '../lib/path.js';
import settings from '../lib/settings.js';
import { getCk } from '../lib/common.js';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';

function pickGameAvatar(data, depth = 0) {
    if (!data || depth > 4)
        return '';
    if (typeof data === 'string') {
        if (/^https?:\/\//.test(data) && /(avatar|head|icon|role|profile|face)/i.test(data))
            return data;
        return '';
    }
    if (Array.isArray(data)) {
        for (const item of data) {
            const ret = pickGameAvatar(item, depth + 1);
            if (ret)
                return ret;
        }
        return '';
    }
    if (typeof data === 'object') {
        const preferred = ['avatar_url', 'avatarUrl', 'avatar_icon', 'avatarIcon', 'head_icon', 'headIcon', 'icon_url', 'iconUrl', 'profile_icon', 'profileIcon'];
        for (const key of preferred) {
            const ret = pickGameAvatar(data[key], depth + 1);
            if (ret)
                return ret;
        }
        for (const key in data) {
            if (!/(avatar|head|icon|profile|face)/i.test(key))
                continue;
            const ret = pickGameAvatar(data[key], depth + 1);
            if (ret)
                return ret;
        }
    }
    return '';
}

export class Panel extends ZZZPlugin {
    constructor() {
        super({
            name: '[ZZZ-Plugin]Panel',
            dsc: 'zzzpanel',
            event: 'message',
            priority: _.get(settings.getConfig('priority'), 'panel', 70),
            rule: [
                {
                    reg: `${rulePrefix}(?:更新|刷新)(?:全部|全局|所有|全服|本地)(?:展柜)?面板$`,
                    fnc: 'refreshAllPanel'
                },
                {
                    reg: `${rulePrefix}(.*)面板(展柜)?(刷新|更新|列表)?$`,
                    fnc: 'handleRule'
                },
                {
                    reg: `${rulePrefix}练度(统计)?$`,
                    fnc: 'proficiency'
                },
                {
                    reg: `${rulePrefix}原图$`,
                    fnc: 'getCharOriImage'
                }
            ],
            handler: [
                { key: 'zzz.tool.panel', fn: 'getCharPanelTool' },
                { key: 'zzz.tool.panelList', fn: 'getCharPanelListTool' }
            ]
        });
    }
    getAllPanelUids() {
        const dirs = ['panel', 'player', 'abyss', 'deadly', 'voidFrontBattle', 'climbingTower', 'monthly'];
        const uids = new Set();
        for (const dir of dirs) {
            const full = path.join(dataPath, dir);
            if (!fs.existsSync(full))
                continue;
            for (const file of fs.readdirSync(full)) {
                const m = file.match(/^(\d+)\.json$/);
                if (m)
                    uids.add(m[1]);
            }
        }
        return [...uids].sort((a, b) => Number(a) - Number(b));
    }
    async refreshAllPanel() {
        if (!this.e.isMaster) {
            return this.reply('仅限主人批量更新绝区零面板', false, { at: true, recallMsg: 100 });
        }
        const uids = this.getAllPanelUids();
        if (!uids.length)
            return this.reply('暂无可批量更新的本地 UID。');
        const limit = Math.max(1, Math.min(Number(this.e.msg.match(/\d+/)?.[0] || uids.length), uids.length));
        const list = uids.slice(0, limit);
        await this.reply(`开始批量更新绝区零展柜面板：${list.length}/${uids.length} 个 UID。\n说明：批量更新走公开展柜/Enka，不需要群友在线；未公开展柜会失败。`);
        let ok = 0, fail = 0, empty = 0;
        const errors = [];
        for (let i = 0; i < list.length; i++) {
            const uid = list[i];
            try {
                const data = await refreshPanelFromEnka(uid);
                if (typeof data === 'number') {
                    fail++;
                    errors.push(`${uid}: HTTP ${data}`);
                    continue;
                }
                const { playerInfo, panelList } = data || {};
                if (!Array.isArray(panelList) || !panelList.length) {
                    empty++;
                    errors.push(`${uid}: 展柜为空`);
                    continue;
                }
                await mergePanel(uid, panelList);
                if (playerInfo?.nickname) {
                    savePlayerInfo(uid, {
                        nickname: playerInfo.nickname,
                        gameAvatar: pickGameAvatar(playerInfo),
                    });
                }
                ok++;
            }
            catch (err) {
                fail++;
                errors.push(`${uid}: ${err?.message || err}`);
            }
            if ((i + 1) % 10 === 0 || i + 1 === list.length) {
                await this.reply(`批量更新进度 ${i + 1}/${list.length}\n成功:${ok} 失败:${fail} 空展柜:${empty}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1200));
        }
        const msg = [
            `绝区零全局面板批量更新完成`,
            `成功：${ok}`,
            `失败：${fail}`,
            `空展柜：${empty}`,
            errors.length ? `失败示例：\n${errors.slice(0, 12).join('\n')}` : ''
        ].filter(Boolean).join('\n');
        return this.reply(msg);
    }
    async handleRule() {
        if (!this.e.msg)
            return;
        // “雨果极限面板”会先命中普通面板规则，这里直接转交给 PanelRank，避免被当成“雨果极限”的普通面板。
        if (/极限面板$/.test(this.e.msg)) {
            const { PanelRank } = await import('./panelRank.js');
            const app = new PanelRank();
            app.e = this.e;
            app.reply = this.reply.bind(this);
            return app.limitPanel();
        }
        // 其它排名类指令交给 PanelRank/Rank 处理。
        if (/(面板排名|排名)$/.test(this.e.msg))
            return false;
        const reg = new RegExp(`${rulePrefix}(.*?)(?:展柜)?面板(?:展柜)?(刷新|更新|列表)?$`);
        const match = this.e.msg.match(reg);
        if (!match)
            return false;
        const pre = match[4]?.trim();
        const suf = match[5]?.trim();
        if (['刷新', '更新'].includes(pre || '') || ['刷新', '更新'].includes(suf || ''))
            return await this.refreshPanel();
        if (!pre || suf === '列表')
            return await this.getCharPanelList();
        const queryPanelReg = new RegExp(`${rulePrefix}(.*)面板$`);
        if (queryPanelReg.test(this.e.msg))
            return await this.getCharPanel();
        return false;
    }
    async refreshPanel() {
        const uid = await this.getUID();
        const lastQueryTime = await redis.get(`ZZZ:PANEL:${uid}:LASTTIME`);
        const panelSettings = settings.getConfig('panel');
        const coldTime = _.get(panelSettings, 'interval', 300);
        if (lastQueryTime && Date.now() - Number(lastQueryTime) < 1000 * coldTime) {
            return this.reply(`${coldTime}秒内只能更新一次，请稍后再试`);
        }
        const isEnka = this.e.msg.includes('展柜') || !(await getCk(this.e));
        let result = null;
        if (isEnka) {
            const data = await refreshPanelFromEnka(uid)
                .catch(err => err);
            if (data instanceof Error) {
                logger.warn(`Enka服务调用失败：`, data);
                return this.reply(`Enka服务调用失败：${data.message}`);
            }
            if (typeof data === 'object') {
                await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
                const { playerInfo, panelList } = data;
                if (!panelList.length) {
                    return this.reply('面板列表为空，请确保已于游戏中展示角色');
                }
                result = await mergePanel(uid, panelList);
                await this.getPlayerInfo(playerInfo);
            }
            else if (typeof data === 'number') {
                return this.reply(`Enka服务调用失败，状态码：${data}`);
            }
        }
        else {
            const oriReply = this.reply.bind(this);
            let errorMsg = '';
            this.reply = (msg) => {
                errorMsg += '\n' + msg;
                return Promise.resolve(null);
            };
            try {
                const { api, deviceFp } = await this.getAPI();
                await oriReply('正在更新面板列表，请稍候...');
                await this.getPlayerInfo();
                await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
                result = await refreshPanelFunction(api, deviceFp);
            }
            catch (err) {
                logger.error('面板列表更新失败：', err);
                errorMsg = (err.message || '') + errorMsg;
            }
            this.reply = oriReply;
            if (errorMsg && !result) {
                return this.reply(`面板列表更新失败，请稍后再试或尝试%更新展柜面板：\n${errorMsg.trim()}`);
            }
        }
        if (!result)
            return false;
        const pc = this.e?.playerCard;
        if (pc?.player?.nickname) {
            savePlayerInfo(uid, {
                nickname: pc.player.nickname,
                gameAvatar: pickGameAvatar(pc.player),
                avatar: pc.avatar || '',
            });
        }
        const newChar = result.filter(item => item.isNew);
        const finalData = {
            newChar: newChar.length,
            list: result
        };
        await this.render('panel/refresh.html', finalData);
    }
    async getCharPanelList() {
        const uid = await this.getUID();
        const result = getPanelList(uid);
        if (!result.length) {
            return this.reply(`UID:${uid}无本地面板数据，请先%更新面板 或 %更新展柜面板`);
        }
        const hasCk = !!(await getCk(this.e));
        await this.getPlayerInfo(hasCk ? undefined : parsePlayerInfo({ uid }));
        const timer = setTimeout(() => {
            if (this?.reply) {
                this.reply('查询成功，正在下载图片资源，请稍候。');
            }
        }, 5000);
        for (const item of result) {
            await item.get_basic_assets();
        }
        clearTimeout(timer);
        const finalData = {
            count: result?.length || 0,
            list: result
        };
        await this.render('panel/list.html', finalData);
    }
    async getCharPanelListTool(uid, origin = false) {
        if (!uid) {
            return false;
        }
        if (origin) {
            const result = getPanelListOrigin(uid);
            return result;
        }
        const result = getPanelList(uid);
        return result;
    }
    async getCharPanel() {
        const uid = await this.getUID();
        const reg = new RegExp(`${rulePrefix}(.+)面板$`);
        const match = this.e.msg.match(reg);
        if (!match)
            return false;
        const name = match[4];
        const data = getPanelOrigin(uid, name);
        if (data === false) {
            return this.reply(`角色${name}不存在，请确保角色名称/别称存在`);
        }
        else if (data === null) {
            return this.reply(`暂无角色${name}面板数据，请先%更新面板`);
        }
        const handler = this.e.runtime.handler || {};
        if (handler.has('zzz.tool.panel')) {
            await handler.call('zzz.tool.panel', this.e, {
                uid,
                data: data,
                needSave: false
            });
        }
    }
    async getCharPanelTool(e, _data = {}) {
        if (e)
            this.e = e;
        if (e?.reply)
            this.reply = e.reply;
        const { uid = undefined, data = undefined, needSave = true, reply = true, needImg = true } = _data;
        if (!uid) {
            return this.reply('UID为空');
        }
        if (!data) {
            return this.reply('数据为空');
        }
        if (needSave) {
            updatePanelData(uid, [data]);
        }
        const timer = setTimeout(() => {
            const msg = '查询成功，正在下载图片资源，请稍候。';
            if (this?.reply && needImg) {
                this.reply(msg);
            }
            else {
                logger.mark(msg);
            }
        }, 5000);
        const parsedData = formatPanelData(data);
        await parsedData.get_detail_assets();
        clearTimeout(timer);
        const finalData = {
            uid,
            charData: parsedData
        };
        const image = needImg ? await this.render('panel/card.html', finalData, {
            retType: 'base64'
        }) : needImg;
        if (reply) {
            const res = await this.reply(image);
            const messageId = res?.message_id || res?.messageId || res?.data?.message_id || res?.[0]?.message_id || res?.[0]?.data?.message_id;
            if (parsedData.role_icon && !_.get(settings.getConfig('panel'), 'disableOriginalImage', false)) {
                if (messageId)
                    await redis.set(`ZZZ:PANEL:IMAGE:${messageId}`, parsedData.role_icon, {
                        EX: 3600 * 3
                    });
                if (this.e?.group_id && this.e?.user_id)
                    await redis.set(`ZZZ:PANEL:IMAGE:GROUP:${this.e.group_id}:USER:${this.e.user_id}`, parsedData.role_icon, { EX: 3600 * 3 });
            }
            return {
                message: res,
                image
            };
        }
        return image;
    }
    async proficiency() {
        const uid = await this.getUID();
        const result = getPanelList(uid);
        if (!result) {
            return this.reply('未找到面板数据，请先%更新面板 或 %更新展柜面板');
        }
        await this.getPlayerInfo();
        result.sort((a, b) => {
            return b.proficiency_score - a.proficiency_score;
        });
        const WeaponCount = result.filter(item => item?.weapon).length;
        const SWeaponCount = result.filter(item => item?.weapon && item.weapon.rarity === 'S').length;
        const general = {
            total: result.length,
            SCount: result.filter(item => item.rarity === 'S').length,
            SWeaponRate: (SWeaponCount / WeaponCount) * 100,
            SSSCount: result.reduce((acc, item) => {
                if (item.equip) {
                    acc += item.equip.filter(equip => ['SSS', 'ACE', 'MAX'].includes(String(equip.comment))).length;
                }
                return acc;
            }, 0),
            highRank: result.filter(item => item.rank > 4).length
        };
        const timer = setTimeout(() => {
            if (this?.reply) {
                this.reply('查询成功，正在下载图片资源，请稍候。');
            }
        }, 5000);
        for (const item of result) {
            await item.get_small_basic_assets();
        }
        clearTimeout(timer);
        const finalData = {
            general,
            list: result
        };
        await this.render('proficiency/index.html', finalData);
    }
    async getCharOriImage() {
        if (_.get(settings.getConfig('panel'), 'disableOriginalImage', false)) {
            return this.reply('已禁止获取绝区零面板原图');
        }
        if (!this.e.isMaster) {
            return this.reply('仅限主人获取绝区零面板原图', false, { at: true, recallMsg: 100 });
        }
        let source;
        if (this.e.getReply) {
            source = await this.e.getReply();
        }
        else if (this.e.source) {
            if (this.e.group?.getChatHistory) {
                source = (await this.e.group.getChatHistory(this.e.source?.seq, 1)).pop();
            }
            else if (this.e.friend?.getChatHistory) {
                source = (await this.e.friend.getChatHistory(this.e.source?.time + 1, 1)).pop();
            }
        }
        const id = source?.message_id;
        if (!id) {
            return this.reply('未找到消息源，请引用要查看的图片');
        }
        let image = await redis.get(`ZZZ:PANEL:IMAGE:${id}`);
        if (!image && this.e?.group_id && this.e?.user_id) {
            image = await redis.get(`ZZZ:PANEL:IMAGE:GROUP:${this.e.group_id}:USER:${this.e.user_id}`);
        }
        if (!image) {
            return this.reply('未找到原图');
        }
        await this.reply(segment.image(image));
    }
}
//# sourceMappingURL=panel.js.map
