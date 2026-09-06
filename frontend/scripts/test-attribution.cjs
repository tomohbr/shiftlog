// 依存追加なしで、ブラウザの保存制限・期限・GA4未設定を検証する。
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const key = 'shiftlog_attribution'
function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
function setup({ blocked = false, id = '' } = {}) {
  const scripts = [], events = [], debug = []
  const window = { location: { search: '?utm_source=note&utm_medium=article&utm_campaign=cost', pathname: '/', href: 'https://example.test/?utm_source=note' } }
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(window, name, { get: () => { if (blocked) throw Error('保存拒否'); return stores[name] } })
  }
  const stores = { localStorage: storage(), sessionStorage: storage() }
  const context = vm.createContext({ window, document: { referrer: 'https://note.com/', createElement: () => ({}), head: { appendChild: s => scripts.push(s) } }, URLSearchParams, Date, console: { debug: (...args) => debug.push(args) } })
  function load(name, dependencies = {}) {
    const source = readFileSync(resolve(__dirname, `../src/lib/${name}.ts`), 'utf8').replaceAll('import.meta.env', JSON.stringify({ DEV: true, VITE_GA_MEASUREMENT_ID: id }))
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    context.exports = {}
    context.require = name => dependencies[name]
    vm.runInContext(js, context)
    return context.exports
  }
  const attribution = load('attribution')
  const analytics = load('analytics', { './attribution': attribution })
  return { attribution, analytics, window, stores, scripts, events, debug }
}
{
  const { attribution: a, window: w, stores } = setup()
  assert.equal(a.getAttribution().source, 'direct')
  assert.equal(a.captureAttribution().source, 'note')
  assert.equal(a.getAttribution().referrer, 'https://note.com/')
  assert.equal(stores.localStorage.getItem(key), stores.sessionStorage.getItem(key))
  w.location.search = '?utm_source=x'
  assert.equal(a.captureAttribution().source, 'note')
  stores.sessionStorage.removeItem(key)
  assert.equal(a.captureAttribution().source, 'note')
}
{
  const { attribution: a, window: w, stores } = setup()
  const expired = JSON.stringify({ source: 'old', medium: 'article', campaign: 'old', content: 'none', landing_path: '/', referrer: '', expires_at: Date.now() - 1 })
  stores.localStorage.setItem(key, expired)
  stores.sessionStorage.setItem(key, '{broken')
  assert.equal(a.captureAttribution().source, 'note')
  w.location.search = ''
  assert.equal(a.getAttribution().source, 'note')
}
{
  const { attribution: a, analytics: g, scripts, debug } = setup({ blocked: true })
  assert.equal(a.captureAttribution().source, 'note')
  g.initializeAnalytics()
  assert.equal(scripts.length, 0)
  g.track('register_complete')
  g.trackCampaignLanding()
  g.trackCampaignLanding()
  assert.equal(debug.length, 2)
}
{
  const { attribution: a, analytics: g, window: w, scripts } = setup({ id: 'G-TEST' })
  a.captureAttribution()
  g.initializeAnalytics()
  g.initializeAnalytics()
  assert.equal(scripts.length, 1)
  assert.equal(w.dataLayer[0][0], 'js')
  assert.equal(w.dataLayer[1][1], 'G-TEST')
  g.trackCampaignLanding()
  g.trackCampaignLanding()
  assert.equal(w.dataLayer.length, 3)
  g.track('cta_click', { campaign_source: 'override', label: '登録', location: 'hero' })
  assert.equal(w.dataLayer[3][2].campaign_source, 'override')
  w.gtag = () => { throw Error('送信失敗') }
  assert.doesNotThrow(() => g.track('register_complete'))
}

{
  const { attribution: a, stores } = setup()
  const saved = JSON.stringify({ source: 'threads', medium: 'profile', campaign: 'shiba', content: 'threads-profile', landing_path: '/', referrer: '', expires_at: Date.now() + 86400000 })
  stores.localStorage.setItem(key, saved)
  assert.equal(a.captureAttribution().source, 'threads')
  assert.equal(stores.sessionStorage.getItem(key), saved)
}
console.log('流入保存・破損/期限切れ・保存拒否・GA4未設定・キュー・重複防止: OK')

// direct訪問の後にUTMが判明したら更新し、以降はfirst-touchを保つ。
{
  const { attribution: a, window: w } = setup()
  w.location.search = ''
  assert.equal(a.captureAttribution().source, 'direct')
  w.location.search = '?utm_source=note'
  assert.equal(a.captureAttribution().source, 'note')
  w.location.search = '?utm_source=x'
  assert.equal(a.captureAttribution().source, 'note')
}
