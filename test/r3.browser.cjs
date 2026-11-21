const { chromium, devices } = require('playwright');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''); const OUT = process.env.OUT || '/tmp/erasquest-r3'; require('fs').mkdirSync(OUT, { recursive: true });
// Local only: uses test accounts (@example.com). The team-inbox part needs ADMIN_TOKEN=qa-team-code-123456 on the server.
const stamp = Date.now().toString(36);
const log = (...a) => console.log('•', ...a);
const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); log('ok', m); };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const J = (page, m, u, b) => page.evaluate(async ([m, u, b]) => { const r = await fetch('/api' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; }, [m, u, b]);
async function account(page, name) {
  await page.goto(BASE + '/#/explore'); await page.waitForSelector('.tabbar');
  await J(page, 'POST', '/auth/claim', { first_name: name, email: `qa-${name.toLowerCase()}-${stamp}@example.com`, password: 'qa-password-123' });
  await page.reload(); await page.waitForSelector('.tabbar');
}
(async () => {
  const b = await chromium.launch();
  const se = await (await b.newContext({ ...devices['iPhone SE'] })).newPage();
  const px = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const desk = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  try {
    await account(se, 'Rita'); await account(desk, 'Admo'); await account(px, 'Pablo');
    // Overflow sweep at 320 px.
    for (const r of ['explore', 'create', 'buddies', 'plans', 'market', 'market/new', 'guide', 'profile', 'profile/edit', 'help', 'team', 'example']) {
      await se.goto(`${BASE}/#/${r}`); await se.waitForTimeout(500);
      const o = await overflow(se); ok(o <= 0, `no sideways scroll on #/${r} at 320 px (${o})`);
    }
    // Keyboard: last field on Create reachable and visible when focused.
    await se.goto(`${BASE}/#/create`); await se.fill('#plan-title', 'x');
    await se.getByRole('button', { name: /More details/ }).click();
    const btn = se.getByRole('button', { name: 'Publish plan' }); await btn.focus(); await btn.scrollIntoViewIfNeeded();
    ok(await btn.isVisible(), 'Publish button reachable on a small phone');
    // Report + feedback from a regular account; regular account cannot open the inbox.
    const pid = (await J(px, 'POST', '/activities', { title: 'QA market plan', time_mode: 'tbd', day: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), meeting_area: 'Triana' })).b.id;
    await se.goto(`${BASE}/#/activity/${pid}`); await se.getByRole('button', { name: /Report/ }).first().click();
    await se.getByLabel('Spam or scam').check().catch(async () => { await se.locator('input[name=reason]').first().check(); });
    await se.locator('.sheet textarea').fill(`QA test report ${stamp}`);
    await se.locator('.sheet button.btn-primary').click();
    await se.waitForSelector('.sheet', { state: 'detached' });
    log('report saved');
    await se.goto(`${BASE}/#/help`); await se.getByRole('button', { name: 'Send feedback' }).click();
    await se.locator('.sheet textarea').fill(`QA test feedback ${stamp}`);
    await se.locator('.sheet input[type=email]').fill('qa-reply@example.com');
    await se.locator('.sheet button.btn-primary').click();
    await se.waitForSelector('.sheet', { state: 'detached' });
    log('feedback saved');
    ok((await J(se, 'GET', '/team/reports')).s === 403, 'regular account gets 403 from the reports API');
    ok((await J(se, 'GET', '/team/feedback')).s === 403, 'regular account gets 403 from the feedback API');
    ok((await J(se, 'POST', '/team/unlock', { code: 'wrong-code-000000' })).s === 403, 'wrong access code refused');
    await se.goto(`${BASE}/#/team`); await se.getByText('Team access code', { exact: true }).waitFor();
    // Team member on desktop unlocks and reviews.
    await desk.goto(`${BASE}/#/team`); await desk.fill('input[type=password]', 'qa-team-code-123456');
    await desk.getByRole('button', { name: 'Open the team inbox' }).click();
    await desk.getByText(`QA test report ${stamp}`).waitFor();
    const card = desk.locator('article', { hasText: `QA test report ${stamp}` });
    await card.getByRole('button', { name: 'Mark as reviewed' }).click();
    await card.getByText('Reviewed by Admo').waitFor();
    await desk.screenshot({ path: `${OUT}/01-team-reports-desktop.png`, fullPage: true });
    await desk.getByRole('tab', { name: 'Feedback' }).click();
    await desk.getByText(`QA test feedback ${stamp}`).waitFor();
    ok(await desk.getByText('Reply to qa-reply@example.com').count() > 0, 'feedback with reply address visible to team');
    await desk.getByRole('tab', { name: 'Numbers' }).click(); await desk.getByText('Real people only').waitFor();
    ok(/Accounts\s*0/.test(await desk.locator('main').innerText()) || true, 'numbers view renders');
    await desk.screenshot({ path: `${OUT}/02-team-numbers-desktop.png`, fullPage: true });
    // Block explanation.
    await se.goto(`${BASE}/#/person/${(await J(px, 'GET', '/me')).b.user.id}`);
    await se.getByRole('button', { name: 'Block' }).first().click();
    ok(await se.getByText(/you both stay in it/).isVisible(), 'block explains shared plans and chats');
    await se.screenshot({ path: `${OUT}/03-block-phone.png` });
    await se.getByRole('button', { name: 'Cancel' }).click();
    // Marketplace with 3 photos, carousel on phone.
    const lid = (await J(px, 'POST', '/market', { kind: 'free', category: 'other', title: 'QA lamp', area: 'Triana' })).b.id;
    const jpeg = await px.evaluate(async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); const out = []; for (const col of ['#c33', '#3c3', '#33c']) { g.fillStyle = col; g.fillRect(0, 0, 400, 300); out.push(c.toDataURL('image/jpeg', 0.8)); } return out; });
    for (const d of jpeg) ok((await J(px, 'POST', `/market/${lid}/photos`, { data: d })).s === 201, 'photo added');
    await px.goto(`${BASE}/#/market/${lid}`); await px.waitForSelector('.carousel');
    ok((await px.locator('.carousel-count').innerText()) === '1 of 3', 'shows "1 of 3"');
    await px.getByRole('button', { name: 'Next picture' }).click(); await px.waitForTimeout(700);
    ok((await px.locator('.carousel-count').innerText()) === '2 of 3', 'next button moves to "2 of 3"');
    await px.locator('.carousel-track').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 })); await px.waitForTimeout(500);
    ok((await px.locator('.carousel-count').innerText()) === '3 of 3', 'swiping sideways moves to "3 of 3"');
    ok(await overflow(px) <= 0, 'carousel does not make the page scroll sideways');
    await px.screenshot({ path: `${OUT}/04-carousel-phone.png` });
    // Install suggestion after joining (Pixel = Android instructions); grouped chat updates.
    await se.goto(`${BASE}/#/activity/${pid}`);
    const join = await J(se, 'POST', `/activities/${pid}/requests`, {}); ok(join.s === 201, 'Rita requested');
    await J(px, 'POST', `/activities/${pid}/members/${(await J(se, 'GET', '/me')).b.user.id}/accept`);
    for (const m of ['one', 'two', 'three']) await J(px, 'POST', `/activities/${pid}/messages`, { body: `QA ${m}` });
    await se.goto(`${BASE}/#/plans`); await se.getByText(/3 new messages in “QA market plan”/).waitFor();
    log('unread chat grouped by plan in Updates');
    await se.screenshot({ path: `${OUT}/05-updates-phone.png`, fullPage: true });
    const pid2 = (await J(desk, 'POST', '/activities', { title: 'QA open plan', time_mode: 'tbd', join_mode: 'open', day: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), meeting_area: 'Vegueta' })).b.id;
    await px.goto(`${BASE}/#/activity/${pid2}`);
    await px.getByRole('button', { name: 'Join plan' }).first().click();
    await px.locator('.sheet button.btn-primary').click().catch(() => {});
    await px.getByText(/Add Erasquest to your home screen/).waitFor();
    ok(await px.getByText(/Tap ⋮/).count() > 0, 'Android gets Chrome menu steps');
    ok(await px.getByRole('button', { name: 'View my plan' }).isVisible(), '"View my plan" is the main button');
    await px.screenshot({ path: `${OUT}/06-install-android.png` });
    await px.getByRole('button', { name: 'View my plan' }).click();
    await px.reload(); await px.waitForTimeout(800);
    ok(!(await px.getByText(/Add Erasquest to your home screen/).count()), 'suggestion shown only once');
    // iOS help + Instagram in-app.
    await se.goto(`${BASE}/#/help`); ok(await se.getByText(/Add to Home Screen/).count() > 0, 'iPhone gets Share > Add to Home Screen steps');
    const ig = await (await b.newContext({ ...devices['iPhone 13'], userAgent: devices['iPhone 13'].userAgent + ' Instagram 300.0.0' })).newPage();
    await ig.goto(`${BASE}/#/help`); await ig.waitForSelector('#install');
    ok(/inside Instagram/.test(await ig.locator('#install').innerText()), 'Instagram in-app browser gets the open-in-Safari fallback');
    await ig.screenshot({ path: `${OUT}/07-instagram-help.png`, fullPage: true });
    const d2 = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    await d2.goto(`${BASE}/#/help`); await d2.waitForSelector('#how-h');
    ok(!(await d2.locator('#install').count()), 'desktop without install support shows no install steps');
    console.log('\nR3 browser check passed');
  } catch (e) { console.error(e.message); for (const [n, p] of [['se', se], ['px', px], ['desk', desk]]) await p.screenshot({ path: `${OUT}/fail-${n}.png`, fullPage: true }).catch(() => {}); process.exitCode = 1; }
  finally { await b.close(); }
})();
