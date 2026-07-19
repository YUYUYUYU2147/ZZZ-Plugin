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

// index.js 是 TRSS 直接监听的入口。panelRank.js 属于二级动态导入文件，热重载时可能被 Node 缓存，
// 这里用同名桥接类覆盖 PanelRank：优先抢“极限面板/排名”指令，再动态导入最新 panelRank.js 执行。
if (apps.panelRank) {
  apps.panelRank = class PanelRankHotBridge extends plugin {
    constructor() {
      super({
        name: '[ZZZ-Plugin]PanelRank',
        dsc: '绝区零角色面板排名/极限面板',
        event: 'message',
        priority: -20000,
        rule: [
          { reg: '^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\\s*.+极限面板$', fnc: 'limitPanel' },
          { reg: '^.*?(?:%|％|#?zzz|#?ZZZ|#?绝区零|#?绝区)\\s*.+(面板)?排名$', fnc: 'panelRank' }
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
      return (await this.getPanelRankApp()).panelRank(e)
    }

    async limitPanel(e) {
      return (await this.getPanelRankApp()).limitPanel(e)
    }
  }
}

export { apps }
