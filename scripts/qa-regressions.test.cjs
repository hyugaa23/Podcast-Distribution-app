const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function load(file, globals = {}, suffix = '') {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8') + suffix;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, FormData, AbortSignal, setTimeout, clearTimeout, ...globals };
  vm.runInNewContext(code, context, { filename: file });
  return context.exports;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('failed CSV export retains the backend error instead of returning a raw response', async () => {
  const api = load('apps/admin/lib/api.ts', { fetch: async () => json({ error: { code: 'export_failed', message: 'Export temporarily unavailable' } }, 503) });
  await assert.rejects(api.api('/exports/episodes', { raw: true }), error => error.status === 503 && error.message === 'Export temporarily unavailable');
});

test('successful export still returns its response', async () => {
  const api = load('apps/admin/lib/api.ts', { fetch: async () => new Response('title\nEpisode\n') });
  assert.equal(await (await api.api('/exports/episodes', { raw: true })).text(), 'title\nEpisode\n');
});

test('concurrent session refreshes share one bounded request', async () => {
  let calls = 0;
  const api = load('apps/admin/lib/api.ts', { fetch: async (_url, opts) => {
    calls++;
    assert.ok(opts.signal instanceof AbortSignal);
    await new Promise(resolve => setTimeout(resolve, 5));
    return json({ data: { access_token: 'fresh', user: {} } });
  } });
  const [a, b] = await Promise.all([api.refreshSession(), api.refreshSession()]);
  assert.equal(calls, 1);
  assert.equal(a.access_token, b.access_token);
});

test('failed refresh clears the expired access token', async () => {
  const api = load('apps/admin/lib/api.ts', { fetch: async (url, opts) => {
    if (url.includes('/refresh')) return json({}, 401);
    assert.equal(opts.headers.Authorization, undefined);
    return json({ data: true });
  } });
  api.setAccessToken('expired');
  assert.equal(await api.refreshSession(), null);
  await api.get('/tenants');
});

for (const event of ['ontimeout', 'onabort']) {
  test(`upload rejects on ${event} so the loading indicator can finish`, async () => {
    class XHR {
      upload = {};
      open() {}
      setRequestHeader() {}
      send() { assert.equal(this.timeout, 1800000); queueMicrotask(() => this[event]()); }
    }
    const api = load('apps/admin/lib/api.ts', {
      XMLHttpRequest: XHR,
      fetch: async () => json({ data: { upload_id: 'qa', url: '/upload', method: 'PUT', headers: {} } }),
    });
    await assert.rejects(api.uploadFile('episode_audio', 1, { name: 'qa.mp3', type: 'audio/mpeg', size: 10 }), /Upload (timed out|cancelled)/);
  });
}

test('corrupt player preferences cannot crash audio initialization', () => {
  for (const [stored, volume, rate] of [['{"volume":7,"rate":-1}', 1, 1], ['{"volume":-3,"rate":2}', 0, 2], ['null', 1, 1], ['{"volume":0.5,"rate":1.5}', 0.5, 1.5]]) {
    const player = load('packages/player/src/PlayerProvider.tsx', {
      localStorage: { getItem: () => stored },
      require: name => name === '@podcast/config' ? { PLAYBACK_SPEEDS: [0.75, 1, 1.25, 1.5, 1.75, 2] } : { createContext: () => ({}) },
    }, '\nexports.qaLoadPrefs = loadPrefs;');
    const prefs = player.qaLoadPrefs();
    assert.equal(prefs.volume, volume);
    assert.equal(prefs.rate, rate);
  }
});
