import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
await page.goto('http://localhost:5173/')
const client = await context.newCDPSession(page)
const count = async (expr) => {
  await client.send('HeapProfiler.collectGarbage')
  const proto = await client.send('Runtime.evaluate', { expression: expr, awaitPromise: true })
  if (!proto.result.objectId) return 'n/a ' + JSON.stringify(proto.result).slice(0, 120)
  const { objects } = await client.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId })
  const len = await client.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true })
  await client.send('Runtime.releaseObject', { objectId: objects.objectId })
  return len.result.value
}
for (let i = 0; i < 6; i++) {
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.locator('[data-testid="arena"][data-ready="true"]').waitFor()
  await page.waitForTimeout(800)
  await page.keyboard.press('KeyP'); await page.getByRole('button', { name: 'Main Menu' }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
}
await page.waitForTimeout(500)
const pixiUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('pixi__js')))
const P = `import(${JSON.stringify(pixiUrl)})`
console.log('GameSession', await count(`import('/src/game/GameSession.ts').then(m => m.GameSession.prototype)`))
console.log('Simulation', await count(`import('/src/game/sim/Simulation.ts').then(m => m.Simulation.prototype)`))
console.log('GameRenderer', await count(`import('/src/game/render/GameRenderer.ts').then(m => m.GameRenderer.prototype)`))
console.log('InputController', await count(`import('/src/game/input/InputController.ts').then(m => m.InputController.prototype)`))
for (const cls of ['Application', 'WebGLRenderer', 'Ticker', 'Sprite', 'Container', 'Graphics', 'Texture', 'TextureSource', 'RenderTexture', 'GraphicsContext'])
  console.log('pixi', cls, await count(`${P}.then(m => m.${cls}.prototype)`))
console.log('canvas', await count('HTMLCanvasElement.prototype'), 'webgl2', await count('WebGL2RenderingContext.prototype'))
await browser.close()
