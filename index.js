/// <reference path="./src/@types/yunzai/index.d.ts"/>
import { configPath, dataPath, appPath } from './dist/lib/path.js'
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

void [configPath, dataPath].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir)
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

  async getPanelRankApp() {
    const { PanelRank } = await import(`./dist/apps/panelRank.js?bridge=${Date.now()}`)
    const app = new PanelRank()
    app.e = this.e
    return app
  }

  async panelRank(e) {
    const ret = await (await this.getPanelRankApp()).panelRank(e)
    return ret === false ? this.reply('未识别到绝区零角色，请确认角色名或别名。') : ret
  }

  async limitPanel(e) {
    const ret = await (await this.getPanelRankApp()).limitPanel(e)
    return ret === false ? this.reply('未识别到绝区零角色，请确认角色名或别名。') : ret
  }
}

logger.mark?.('[ZZZ-Plugin]极限面板入口已注册 priority=-30000')

export { apps }
