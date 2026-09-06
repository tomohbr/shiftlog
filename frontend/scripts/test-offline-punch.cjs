// 通信と端末保存を差し替え、オンライン送信・再送順序・通知の取りこぼしを検証する。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function setup(native) {
  let stored = '[]', post = async () => ({ data: { record: { id: 1 } } }), interval
  const calls = []
  const dependencies = {
    '@capacitor/preferences': { Preferences: {
      get: async () => ({ value: stored }), set: async ({ value }) => { stored = value },
    } },
    '@capacitor/network': { Network: { addListener() {} } },
    '@capacitor/app': { App: { addListener() {} } },
    '../api/client': { api: { post: async (...args) => { calls.push(args); return post(...args) } } },
    './platform': { isNative: native },
  }
  const context = vm.createContext({ exports: {}, require: name => dependencies[name],
    localStorage: { getItem: () => 'token' }, setInterval: fn => { interval = fn }, Date, console })
  const source = fs.readFileSync(path.resolve(__dirname, '../src/native/offlinePunch.ts'), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { api: context.exports, calls, setPost: fn => { post = fn }, tick: () => interval(), queue: () => JSON.parse(stored) }
}
const ctx = { userId: 1, userName: 'テスト', companyId: 7 }
const drain = () => new Promise(resolve => setImmediate(resolve))
async function main() {
  const web = setup(false)
  await web.api.punch('clock_in', ctx)
  assert.equal(web.calls[0][1].recorded_at, undefined)
  assert.equal(web.calls[0][1].client_uuid, undefined)
  const app = setup(true)
  await app.api.punch('clock_in', ctx)
  assert.equal(typeof app.calls[0][1].client_uuid, 'string')
  assert.equal(app.calls[0][1].recorded_at, undefined)
  app.setPost(async () => { throw Error('通信不可') })
  const first = await app.api.punch('break_start', ctx)
  await app.api.punch('break_end', ctx)
  assert.equal(app.calls.length, 2)
  assert.equal(app.queue().length, 2)
  let release
  app.setPost(() => new Promise(resolve => { release = resolve }))
  const flush = app.api.flushQueue()
  await drain()
  await app.api.punch('clock_out', ctx)
  assert.equal(app.queue().length, 3)
  assert.equal(app.calls.at(-1)[1].recorded_at, first.queued.recorded_at)
  assert.equal(app.calls.at(-1)[2].headers['X-Company-Id'], '7')
  app.setPost(async () => ({ data: {} }))
  release({ data: {} })
  assert.equal((await flush).synced, 3)
  assert.equal(app.queue().length, 0)
  assert.deepEqual(app.calls.slice(2).map(c => c[0]), ['/timecards/break-start', '/timecards/break-end', '/timecards/clock-out'])
  app.setPost(async () => { throw Error('通信不可') })
  await app.api.punch('clock_in', ctx)
  app.setPost(async () => ({ data: {} }))
  await app.api.initOfflinePunch()
  await drain()
  const results = []
  app.api.setFlushHandler(result => results.push(result))
  app.api.setFlushHandler(result => results.push(result))
  assert.equal(results.length, 1)
  assert.equal(results[0].synced, 1)
  console.log('Web/オンライン打刻・再送時刻・会社ID・同期中の追加順序・結果の一度だけ通知: OK')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
