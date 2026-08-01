/// <reference path="./src/@types/yunzai/index.d.ts"/>
import { configPath, dataPath, appPath } from './dist/lib/path.js'
import { migrateLegacyData } from './dist/lib/migrateData.js'
import fs from 'fs'

try {
  await import('source-map-support/register.js')
} catch {
  //
}

logger.info('*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*')
logger.info('ZZZ-Plugin 加载中')
logger.info('仓库地址 https://github.com/ZZZure/ZZZ-plugin')
logger.info('Created By ZZZure Project (MIHOMO)')
logger.info('*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*')

migrateLegacyData()

void [configPath, dataPath].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
})

const files = fs.readdirSync(appPath).filter(file => file.endsWith('.js'))

const ret = []

files.forEach(file => {
  ret.push(import(`./dist/apps/${file}`))
})

const retPromise = await Promise.allSettled(ret)

const apps = {}

for (const i in files) {
  const name = files[i].replace('.js', '')

  if (retPromise[i].status != 'fulfilled') {
    logger.error(`[ZZZ-Plugin] 载入模块${logger.red(name)}错误`)
    logger.error(retPromise[i].reason)
    continue
  }

  apps[name] = retPromise[i].value[Object.keys(retPromise[i].value)[0]]
}

// 绝区零极限面板独立入口：放在 ZZZ-Plugin 自己的 index.js 内，确保重启后一定注册到全局插件列表。
// 只拦截 % / 绝区零 / zzz 前缀，不影响喵喵的 #雷神极限面板 等原神/星铁指令。
apps.panelRankBridge = class PanelRankBridge extends plugin {
  constructor() {
    super({
      name: '[ZZZ-Plugin]极限面板',
      dsc: '绝区零角色极限面板/面板排名入口',
      event: 'message',
      priority: -30000,
      rule: [
        { reg: '^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\\s*.+极限面板\\s*$', fnc: 'limitPanel' },
        { reg: '^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\\s*.+(面板)?排名\\s*$', fnc: 'panelRank' }
      ]
    })
  }

  isBattleRankMsg(msg = '') {
    const text = String(msg || '').replace(/^[%％#\/\\]?(?:zzz|ZZZ|绝区零|绝区)?\s*/, '').trim()
    return /^(?:式舆防卫战|式舆|深渊|防卫战|防卫|危局强袭战|危局|强袭|强袭战|临界推演|临界|推演|爬塔|鏖战|爬塔S\d|爬塔s\d)(?:群内|群)?(?:排名|排行)$/.test(text)
  }

  isPanelRankMsg(msg = '') {
    return /^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\s*.+(?:极限面板|(面板)?排名)\s*$/.test(String(msg || ''))
  }

  async accept(e) {
    let msg = String(e?.msg || '')
    const isAtBot = e?.atBot || /\[CQ:at,qq=\d+\]/.test(msg)
    if (isAtBot) {
      msg = msg.replace(/\[CQ:at,qq=\d+\]/g, '').trim()
      if (!/^[%#/\\]/.test(msg)) msg = '%' + msg
    }
    if (this.isBattleRankMsg(msg)) return false
    if (!this.isPanelRankMsg(msg)) return false
    this.e = e
    this.e.msg = msg
    if (/极限面板\s*$/.test(msg)) {
      await this.limitPanel(e)
    } else {
      await this.panelRank(e)
    }
    return 'return'
  }

  async getPanelRankApp() {
    const { PanelRank } = await import(`./dist/apps/panelRank.js?bridge=${Date.now()}`)
    const app = new PanelRank()
    app.e = this.e
    return app
  }

  async panelRank(e) {
    if (this.isBattleRankMsg(this.e?.msg || e?.msg || '')) return false
    const ret = await (await this.getPanelRankApp()).panelRank(e)
    return ret === false ? this.reply('未识别到绝区零角色，请确认角色名或别名。') : ret
  }

  async limitPanel(e) {
    if (this.isBattleRankMsg(this.e?.msg || e?.msg || '')) return false
    const ret = await (await this.getPanelRankApp()).limitPanel(e)
    return ret === false ? this.reply('未识别到绝区零角色，请确认角色名或别名。') : ret
  }
}

logger.mark?.('[ZZZ-Plugin]极限面板入口已注册 priority=-30000')

// ZZZ-Plugin 专用短指令桥接：避免 %临界 / %zzz临界 被 genshin/bbb-plugin 的别名链抢走。
apps.zzzShortBridge = class ZzzShortBridge extends plugin {
  constructor() {
    super({
      name: '[ZZZ-Plugin]短指令桥接',
      dsc: 'ZZZ-Plugin专用短指令入口',
      event: 'message',
      priority: -30000,
      rule: [
        { reg: '^(?:[%％]z|#绝区零z|#绝区z).*$', fnc: 'voidFrontBattle' }
      ]
    })
  }

  async voidFrontBattle(e) {
    this.e = e
    const msg = String(e?.msg || '').trim()
    if (!/^(?:[%％]z|#绝区零z|#绝区z)\s*(?:上期|往期)?(?:临界推演|临界|推演)$/.test(msg)) return false
    logger.mark?.(`[ZZZ-Plugin]短指令命中：${msg}`)
    const { VoidFrontBattle } = await import(`./dist/apps/voidFrontBattle.js?short=${Date.now()}`)
    const app = new VoidFrontBattle()
    app.e = e
    await app.voidFrontBattle()
    return 'return'
  }
}

logger.mark?.('[ZZZ-Plugin]短指令入口已注册：%z临界')

export { apps }
