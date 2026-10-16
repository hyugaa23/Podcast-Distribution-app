// Frontend contract checks with controlled API fixtures, not live backend acceptance tests.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_ADMIN_URL || 'http://localhost:3001';
const session = { access_token: 'qa-fixture', user: { id: 1, email: 'qa@example.com', name: 'QA', role: 'SUPER_ADMIN', tenant_id: null } };
const episode = { id: 1, podcast_id: 1, title: 'QA draft', slug: 'qa-draft', episode_type: 'full', status: 'DRAFT', tags: [], hosts: [], description: '', transcript: '', published_at: null, audio_url: '', artwork_url: '' };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === '/api/auth/refresh' ? session : path === '/api/tenants' ? [] : path === '/api/notifications' ? { items: [], unread: 0 } : null;
      await route.fulfill({ status: data === null ? 503 : 200, json: data === null ? { error: { code: 'qa_unavailable', message: 'QA simulated backend unavailable' } } : { data } });
    });
    const routes = ['/', '/analytics', '/podcasts', '/podcasts/new', '/podcasts/1', '/episodes', '/episodes/new', '/episodes/1', '/hosts', '/collections', '/categories', '/imports', '/distribution', '/distribution/platforms', '/distribution/1', '/distribution/1/wizard', '/rss-health', '/tenants', '/tenants/new', '/tenants/1', '/domains', '/redirects', '/users', '/api-keys', '/webhooks', '/audit', '/system', '/account'];
    for (const route of routes) {
      await page.goto(base + route);
      await page.waitForTimeout(350);
      await page.locator('h1').first().waitFor({ timeout: 2000 }).catch(() => {});
      assert.equal(await page.getByText('Application error', { exact: false }).count(), 0, route);
      console.log('ROUTE', route, 'heading:', (await page.locator('h1').allTextContents()).join(' / '));
    }
    assert.deepEqual(errors, [], 'No uncaught frontend exceptions under API failures');
    await context.close();

    const offline = await browser.newContext();
    const offlinePage = await offline.newPage();
    const offlineErrors = [];
    offlinePage.on('pageerror', e => offlineErrors.push(e.message));
    await offline.route('**/api/auth/refresh', route => route.abort('failed'));
    await offlinePage.goto(base + '/login');
    await offlinePage.getByLabel('Email', { exact: true }).waitFor();
    await offlinePage.waitForTimeout(300);
    assert.deepEqual(offlineErrors, []);
    console.log('PASS refresh network failure leaves login usable without unhandled rejection');
    await offline.close();

    const edit = await browser.newContext();
    const calls = [];
    let savedEpisode = { ...episode };
    await edit.route('**/api/**', async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      calls.push(req.method() + ' ' + path);
      let data = [];
      if (path === '/api/auth/refresh') data = session;
      else if (path === '/api/notifications') data = { items: [], unread: 0 };
      else if (path === '/api/podcasts/1') data = { id: 1, title: 'QA podcast', owner_tenant_id: null, can_edit: true };
      else if (path === '/api/episodes/1/preview-token') data = { token: 'qa', url: base + '/login' };
      else if (path === '/api/episodes/1') {
        if (req.method() === 'PUT') savedEpisode = { ...savedEpisode, ...req.postDataJSON() };
        return route.fulfill({ json: { data: savedEpisode, audio: null } });
      }
      await route.fulfill({ json: { data } });
    });
    const editor = await edit.newPage();
    await editor.goto(base + '/episodes/1');
    await editor.getByLabel(/^Title/).fill('Edited before preview');
    await editor.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await editor.waitForTimeout(750);
    const saveIndex = calls.indexOf('PUT /api/episodes/1');
    const previewIndex = calls.indexOf('POST /api/episodes/1/preview-token');
    assert.ok(saveIndex >= 0 && previewIndex > saveIndex, 'Save must precede preview generation');
    assert.equal(savedEpisode.title, 'Edited before preview');
    console.log('PASS preview saves current edits before requesting token');
    assert.equal(await editor.getByLabel('Episode number', { exact: true }).getAttribute('min'), '1');
    console.log('PASS episode number excludes backend-invalid zero');
    await edit.close();

    const scope = await browser.newContext();
    await scope.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let data = [];
      if (url.pathname === '/api/auth/refresh') data = session;
      else if (url.pathname === '/api/notifications') data = { items: [], unread: 0 };
      else if (url.pathname === '/api/tenants') data = [
        { id: 1, name: 'QA first', slug: 'qa-first', primary_domain: 'podcastbusiness.43-156-240-174.sslip.io' },
        { id: 2, name: 'QA second', slug: 'qa-second', primary_domain: 'editorialaudio.43-156-240-174.sslip.io' },
      ];
      else if (url.pathname === '/api/platforms') data = [{ id: 1, name: 'QA platform', key: 'qa', submission_type: 'MANUAL', instructions: 'Copy the feed URL' }];
      else if (url.pathname === '/api/distribution/1') data = {
        platforms: [{ platform_id: 1, podcast_id: 1, platform_name: 'QA platform', status: 'NOT_STARTED' }], live: 0, total: 1, progress_percent: 0, can_manage: true,
        readiness: { ready: true, percent: 100, missing: [], feed_url: 'https://qa.example.invalid/feed/qa.xml' },
      };
      else if (['/api/podcasts', '/api/episodes'].includes(url.pathname)) {
        const id = Number(url.searchParams.get('tenant_id')) || 1;
        return route.fulfill({ json: { data: [{ ...episode, id, title: `QA item ${id}`, can_edit: true, episode_count: 1 }], meta: { total: 1, page: 1, per_page: 25, pages: 1 } } });
      }
      await route.fulfill({ json: { data } });
    });
    const scoped = await scope.newPage();
    for (const route of ['/podcasts', '/episodes']) {
      await scoped.goto(base + route);
      await scoped.getByRole('checkbox', { name: 'Select QA item 1', exact: true }).check();
      await scoped.getByText('1 selected', { exact: true }).waitFor();
      await scoped.getByLabel('Tenant scope').selectOption('2');
      await scoped.getByRole('checkbox', { name: 'Select QA item 2', exact: true }).waitFor();
      assert.equal(await scoped.getByText('1 selected', { exact: true }).count(), 0);
      console.log('PASS scope change clears bulk selection on ' + route);
      // Restore the initial scope for the next page.
      await scoped.getByLabel('Tenant scope').selectOption('');
      await scoped.getByRole('checkbox', { name: 'Select QA item 1', exact: true }).waitFor();
    }
    await scoped.setViewportSize({ width: 390, height: 844 });
    await scoped.goto(base + '/distribution/1/wizard');
    await scoped.getByRole('heading', { name: 'Distribution Wizard' }).waitFor();
    const width = await scoped.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport, `Wizard overflow: ${JSON.stringify(width)}`);
    console.log('PASS distribution wizard fits a 390px mobile viewport');
    await scope.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
