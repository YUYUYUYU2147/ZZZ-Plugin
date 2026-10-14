import { gacha_type_meta_data, gacha_type_meta_data_ck, item_type_ck, rarity_ck, FLOORS_MAP, HOMO_TAG, EMOJI, NORMAL_LIST, CUSTOM_FM_LEAK_LIMIT_LIST, CUSTOM_FM_CURRENT_UP_LIST, } from './gacha/const.js';
import { getZZZGachaLogByAuthkey } from './gacha/core.js';
import { getGachaLog, saveGachaLog } from './db.js';
import { getLevelFromList } from './gacha/tool.js';
import { SingleGachaLog } from '../model/gacha.js';
import { sleep } from '../utils/time.js';
import { rank } from './convert.js';
import { isUpBySchedule, isUpByLegacy } from './gacha/isup.js';
export const updateGachaLog = async (authKey, uid, region, game_biz) => {
    const previousLog = getGachaLog(uid) || {};
    const newCount = {};
    for (const name of Object.keys(gacha_type_meta_data)) {
        if (!previousLog[name]) {
            previousLog[name] = [];
        }
        newCount[name] = 0;
        previousLog[name] = previousLog[name].map(i => new SingleGachaLog(i));
        const lastSaved = previousLog[name]?.[0];
        let page = 1;
        let endId = '0';
        const newData = [];
        for (const type of gacha_type_meta_data[name]) {
            queryLabel: while (true) {
                const log = await getZZZGachaLogByAuthkey(authKey, type, type[0], page, endId, region, game_biz);
                if (!log || !log?.list || log?.list?.length === 0) {
                    break;
                }
                for (const item of log.list) {
                    if (lastSaved && lastSaved.equals(item)) {
                        break queryLabel;
                    }
                    newData.push(item);
                    newCount[name]++;
                }
                endId = log.list[log.list.length - 1]?.id || endId;
                page++;
                await sleep(1000);
            }
        }
        previousLog[name] = [...newData, ...previousLog[name]];
    }
    saveGachaLog(uid, previousLog);
    return {
        data: previousLog,
        count: newCount,
    };
};
export const updateGachaLog_ck = async (api, uid, deviceFp) => {
    const previousLog = getGachaLog(uid) || {};
    const newCount = {};
    for (const name of Object.keys(gacha_type_meta_data_ck)) {
        if (!previousLog[name]) {
            previousLog[name] = [];
        }
        newCount[name] = 0;
        previousLog[name] = previousLog[name].map(i => new SingleGachaLog(i));
        const lastSaved = previousLog[name]?.[0];
        let endId = '0';
        const newData = [];
        for (const type of gacha_type_meta_data_ck[name]) {
            queryLabel: while (true) {
                const log = await api.getFinalData('zzzGacha_Record', {
                    deviceFp,
                    type,
                    endId,
                });
                if (!log || !log?.gacha_item_list || log?.gacha_item_list?.length === 0) {
                    break;
                }
                for (let item of log.gacha_item_list) {
                    const date = item.date;
                    item = {
                        uid: uid,
                        gacha_id: '0',
                        gacha_type: '2',
                        item_id: item.item_id,
                        count: '1',
                        time: `${date.year}-${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')} ${date.hour.toString().padStart(2, '0')}:${date.minute.toString().padStart(2, '0')}:${date.second.toString().padStart(2, '0')}`,
                        name: item.item_name,
                        lang: 'zh-cn',
                        item_type: item_type_ck[item.item_type],
                        rank_type: rarity_ck[item.rarity],
                        id: item.id,
                        square_icon: '',
                    };
                    if (lastSaved && lastSaved.equals(item)) {
                        break queryLabel;
                    }
                    newData.push(item);
                    newCount[name]++;
                }
                endId = log.gacha_item_list[log.gacha_item_list.length - 1]?.id || endId;
                await sleep(1000);
            }
        }
        previousLog[name] = [...newData, ...previousLog[name]];
    }
    saveGachaLog(uid, previousLog);
    return {
        data: previousLog,
        count: newCount,
    };
};
export const anaylizeGachaLog = async (uid) => {
    const savedData = getGachaLog(uid);
    if (!savedData) {
        return null;
    }
    const result = [];
    // 「XX导入」是导入指令存下的记录：按 id 并回对应主池一起展示。
    // 先扫一遍收集完再处理主池 —— Object.keys 的顺序是「主池在前、导入区段在后」。
    const importMap = {};
    for (const name of Object.keys(savedData)) {
        if (!name.endsWith('导入')) continue;
        importMap[name.replace(/导入$/, '')] = savedData[name] || [];
    }
    for (const name of Object.keys(savedData)) {
        if (name.endsWith('导入')) continue;
        // 导入记录按 id 并回主序列（统一倒序），与官方数据同池展示。
        // 它们的抽数用自带 count，不用下标差 —— 外部来源没有完整逐抽行，
        // 下标差算出来必然是 1。
        // 按「名称+时间」去重：xhh 导出的历史条目与官方数据大量重叠，
        // 不去重会出现同一颗五星级两次、相邻显示 1 抽。
        // 同一颗若两边都有，取带真实垫抽数（count>1）的那条 —— 官方序列里
        // 那些只标了 S 级、没有逐抽行的记录 count 恒为 1。
        const official = savedData[name] || [];
        // 去重只针对「导入 vs 官方」，官方自身必须原样保留 ——
        // 官方一次十连里同名的四星可能撞在同一秒（实测独家重映 90 条里有 17 条被误并），
        // 用 name+time 建 Map 会把官方自己的重复行也吃掉，抽卡总数凭空少一截。
        const seenKey = new Set(official.map(item => `${item?.name}|${item?.time}`));
        const merged = [...official];
        for (const item of importMap[name] || []) {
            // 只并入 S 级：卡片上只画 S 级格子，四星并进来既看不见又会打乱下标差
            if (item?.rank_type !== '4') continue;
            const k = `${item?.name}|${item?.time}`;
            if (seenKey.has(k)) {
                // 同一颗官方也有：保留官方那条（统计要用），但把真实垫抽数借过来
                const hit = official.find(o => `${o?.name}|${o?.time}` === k);
                if (hit && Number(hit.count) <= 1 && Number(item?.count) > 1) hit.count = item.count;
                continue;
            }
            seenKey.add(k);
            merged.push(item);
        }
        const mergedList = merged.map(item => new SingleGachaLog(item));
        mergedList.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
        // 区分来源：导入条目没有对应的逐抽行，混进统计分母会把
        // 「平均出金 / 平均UP / 不歪率」全部算低（分母多一颗五星、分子没多抽数）
        const officialIds = new Set(official.map(item => String(item?.id ?? '')));
        for (const item of mergedList) item.is_imported = !officialIds.has(String(item.id));
        const data = mergedList;
        // 统计口径另走官方序列：lastFive/总抽数/五星数都只按官方逐抽行算，
        // 导入条目只进展示列表，否则分母多一颗五星、分子没多抽数，平均值会整体偏低
        const officialData = data.filter(item => !item.is_imported);
        const earliest = data[data.length - 1];
        const latest = data[0];
        const list = [];
        let lastFive = null;
        let preIndex = 0;
        let i = 0;
        for (const item of data) {
            let isUp = true;
            if (item.rank_type === '4') {
                await item.get_assets();
                // 优先按卡池日程表判：重映池抽到当期 UP 就该标 UP，
                // 而 3.1 定制调频的硬编码名单会把往期角色一律判歪
                const bySchedule = isUpBySchedule(name, item.name, item.time);
                if (bySchedule !== undefined) {
                    isUp = bySchedule;
                } else if (!isUpByLegacy(item)) {
                    isUp = false;
                }
                // 「已垫 N 抽未出S级」= 最新一颗 S 级**之后新抽了多少**（序列按 id 倒序，
                // 即它在官方序列里的下标），只能按官方行算，导入条目不占抽数
                if (lastFive === null && !item.is_imported) {
                    const firstS = officialData.findIndex(it => it.rank_type === '4');
                    lastFive = firstS >= 0 ? firstS : 0;
                }
                if (list.length > 0) {
                    // 上一条 S 级的抽数：自带 count 优先（导入来源），否则用下标差。
                    // 配色必须跟着「实际显示的抽数」走，否则导入来源的条目会一律判成
                    // 下标差 1、全部染成绿色（小保底色），与显示的数字自相矛盾。
                    const prev = list[list.length - 1];
                    const own = Number(prev.count) > 1 ? Number(prev.count) : null;
                    const draws = own || (i - preIndex);
                    list[list.length - 1]['totalCount'] = String(draws);
                    if (draws <= FLOORS_MAP[name][0]) {
                        list[list.length - 1]['color'] = 'rgb(63, 255, 0)';
                    }
                    else if (draws >= FLOORS_MAP[name][1]) {
                        list[list.length - 1]['color'] = 'rgb(255, 20, 20)';
                    }
                    else {
                        list[list.length - 1]['color'] = 'white';
                    }
                }
                list.push({
                    ...item,
                    rank_type_label: rank.getRankChar(item.rank_type),
                    isUp: isUp,
                    totalCount: '-',
                    color: 'white',
                });
                preIndex = i;
            }
            if (i === data.length - 1 && list.length > 0) {
                // 列表最后一条 S 级：它后面没有下一颗来触发赋值，只能在此处收尾。
                // 同样优先用自带 count —— 否则导入来源的最后一条会恒显示 1 抽。
                const last = list[list.length - 1];
                const ownLast = Number(last.count) > 1 ? Number(last.count) : null;
                const drawsLast = ownLast || (i - preIndex + 1);
                list[list.length - 1]['totalCount'] = String(drawsLast);
                if (drawsLast <= FLOORS_MAP[name][0]) {
                    list[list.length - 1]['color'] = 'rgb(63, 255, 0)';
                }
                else if (drawsLast >= FLOORS_MAP[name][1]) {
                    list[list.length - 1]['color'] = 'rgb(255, 20, 20)';
                }
                else {
                    list[list.length - 1]['color'] = 'white';
                }
            }
            i++;
        }
        // 抽卡总数 = 每颗 S 级的垫抽数之和 + 当前已垫的抽数。
        // 不能用「逐抽行条数」—— 导入来源的 S 级没有对应的逐抽行，按行数算会凭空少一截
        // （独家重映 1+9+80=90 就是这么来的）。
        const officialList = list.filter(i => !i.is_imported);
        const upCount = list.filter(i => i.isUp).length;
        const fiveStars = list.length;
        const pitySum = list.reduce((sum, i) => sum + (Number(i.totalCount) > 0 ? Number(i.totalCount) : 0), 0);
        const totalCount = pitySum + (typeof lastFive === 'number' ? lastFive : 0);
        let timeRange = '还没有抽卡';
        let avgFive = '-';
        let avgUp = '-';
        let noWai = '-';
        let level = 2;
        if (data.length > 0) {
            timeRange = `${latest.time} ～ ${earliest.time}`;
            if (lastFive !== null) {
                if (fiveStars > 0)
                    avgFive = ((totalCount - lastFive) / fiveStars).toFixed(1);
                if (upCount > 0)
                    avgUp = ((totalCount - lastFive) / upCount).toFixed(1);
                if (+avgFive && +avgUp) {
                    noWai = ((2 - +avgUp / +avgFive) * 100).toFixed(0) + '%';
                }
            }
        }
        if (lastFive === null && fiveStars === 0) {
            if (totalCount > 0)
                lastFive = totalCount;
            else
                lastFive = '-';
        }
        if (avgUp !== '-') {
            if ('音擎频段' === name) {
                level = getLevelFromList(+avgUp, [62, 75, 88, 99, 111]);
            }
            else if ('音擎回响' === name) {
                level = getLevelFromList(+avgUp, [62, 75, 88, 99, 111]);
            }
            else if ('邦布频段' === name) {
                level = getLevelFromList(+avgUp, [51, 55, 61, 68, 70]);
            }
            else if ('独家频段' === name) {
                level = getLevelFromList(+avgUp, [74, 87, 99, 105, 120]);
            }
            else if ('独家重映' === name) {
                level = getLevelFromList(+avgUp, [74, 87, 99, 105, 120]);
            }
        }
        if (avgFive !== '-') {
            if ('常驻频段' === name) {
                level = getLevelFromList(+avgFive, [53, 60, 68, 73, 75]);
            }
        }
        const tag = HOMO_TAG[level];
        const emojis = EMOJI[level];
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        result.push({
            name,
            timeRange,
            list,
            lastFive,
            fiveStars,
            upCount,
            totalCount,
            avgFive,
            avgUp,
            noWai,
            level,
            tag,
            emoji,
        });
    }
    const order = ['独家频段', '独家重映', '音擎频段', '音擎回响', '常驻频段', '邦布频段'];
    result.sort((a, b) => {
        const ai = order.indexOf(a.name);
        const bi = order.indexOf(b.name);
        const aIdx = ai === -1 ? order.length : ai;
        const bIdx = bi === -1 ? order.length : bi;
        return aIdx - bIdx;
    });
    return result;
};
//# sourceMappingURL=gacha.js.map