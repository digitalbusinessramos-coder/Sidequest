const { chromium, devices } = require('playwright');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''); const OUT = process.env.OUT || '/tmp/erasquest-r2'; require('fs').mkdirSync(OUT, { recursive: true });
// Local check of profiles, Buddies invites and the City Guide. Uses test accounts (@example.com).
const stamp = Date.now().toString(36);
const PN = 'Petra' + stamp.slice(-4).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const log = (...a) => console.log('•', ...a);
const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); log('ok', m); };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function account(page, name) {
  await page.goto(BASE + '/#/explore'); await page.waitForSelector('.guest-bar');
  await page.evaluate(async ({ name, stamp }) => {
    await fetch('/api/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first_name: name, email: `qa-${name.toLowerCase()}-${stamp}@example.com`, password: 'qa-password-123' }) });
  }, { name, stamp });
  await page.reload(); await page.waitForSelector('.tabbar');
}
(async () => {
  const b = await chromium.launch();
  const phone = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  const desk = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  try {
    await account(phone, PN); await account(desk, 'Dario');
    // Profile edit on the phone: languages, custom language, flag, stay, area.
    await phone.goto(BASE + '/#/profile/edit'); await phone.waitForSelector('input[type=search]');
    await phone.fill('input[placeholder="Search languages"]', 'ukr');
    await phone.getByRole('button', { name: 'Ukrainian', exact: true }).click();
    await phone.fill('input[placeholder="Search languages"]', 'Kriol');
    await phone.getByRole('button', { name: /Add another language/ }).click();
    const langs = await phone.locator('[aria-label="Chosen languages"]').innerText();
    ok(/Ukrainian/.test(langs) && /Kriol/.test(langs), 'listed and custom language chosen');
    await phone.getByRole('button', { name: 'Add a flag' }).click();
    await phone.fill('input[placeholder="Search by country or territory"]', 'canary');
    await phone.getByRole('button', { name: /Canary Islands/ }).click();
    await phone.getByRole('button', { name: 'Done' }).click();
    await phone.getByRole('radio', { name: 'Full year' }).click();
    await phone.fill('#meet-area', 'Santa Catalina');
    ok(await overflow(phone) <= 0, 'no sideways scroll on profile edit (phone)');
    await phone.screenshot({ path: `${OUT}/01-profile-edit-phone.png`, fullPage: true });
    await phone.getByRole('button', { name: 'Save' }).click();
    await phone.waitForURL(/#\/profile$/);
    const facts = await phone.locator('.facts-list').innerText();
    ok(/Ukrainian/.test(facts) && /Canary Islands/.test(facts) && /Santa Catalina/.test(facts) && /full year/i.test(facts), 'profile shows languages, flag with text label, area, stay');
    ok(!(await phone.getByText('Nearby discovery').count()), 'no location toggle');
    await phone.screenshot({ path: `${OUT}/02-profile-phone.png`, fullPage: true });
    // Desktop: Dario has a plan and invites Petra from Buddies.
    const planId = await desk.evaluate(async () => {
      const r = await fetch('/api/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'QA tapas', time_mode: 'tbd', day: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), meeting_area: 'Triana' }) });
      return (await r.json()).id;
    });
    ok(planId, 'desktop user has a plan');
    await desk.goto(BASE + '/#/buddies'); await desk.waitForSelector('.person-card');
    ok(!(await desk.getByText('What do you feel like doing?').count()) && !(await desk.getByText(/wish/i).count()), 'no status or wishes in Buddies');
    if (await desk.locator('input[aria-label="Search students"]').count()) await desk.fill('input[aria-label="Search students"]', PN);
    const card = desk.locator('.person-card', { hasText: PN }).first();
    ok(/Canary Islands/.test(await card.innerText()), 'flag label shown on buddy card');
    await card.getByRole('button', { name: 'Invite to a plan' }).click();
    await desk.getByRole('button', { name: 'Invite', exact: true }).click();
    await desk.getByText('Invited', { exact: true }).waitFor();
    await desk.screenshot({ path: `${OUT}/03-invite-desktop.png` });
    await phone.goto(BASE + '/#/plans'); await phone.getByText('QA tapas').first().waitFor();
    log('invitation arrived in My Plans');
    // Spanish: language names and flags in Spanish, alphabetical.
    await phone.evaluate(() => { localStorage.setItem('sq_lang', 'es'); });
    await phone.goto(BASE + '/#/profile/edit'); await phone.reload(); await phone.waitForSelector('input[type=search]');
    const esChips = await phone.locator('[aria-label="Idiomas elegidos"]').innerText().catch(() => '');
    log('ES chosen:', esChips.replace(/\n/g, ' '));
    await phone.screenshot({ path: `${OUT}/04-profile-edit-es-phone.png`, fullPage: true });
    // Guide.
    await desk.goto(BASE + '/#/guide'); await desk.waitForSelector('#g-communities');
    const g = await desk.locator('main').innerText();
    ok(!/\b112\b/.test(g) && !/EHIC|insurance card/i.test(g), 'no 112 block or health cards in the guide');
    ok(/Organised by ESN Las Palmas/.test(g) && /Erasmus Life Las Palmas/.test(g), 'two community entries with organisers');
    ok(!/from the organisation itself/.test(g), 'no source legend');
    await desk.screenshot({ path: `${OUT}/05-guide-desktop.png`, fullPage: true });
    await phone.goto(BASE + '/#/guide'); await phone.waitForSelector('#g-communities');
    ok(await overflow(phone) <= 0, 'no sideways scroll on guide (phone)');
    console.log('\nR2 browser check passed');
  } catch (e) { console.error(e.message); await phone.screenshot({ path: `${OUT}/fail-phone.png`, fullPage: true }); await desk.screenshot({ path: `${OUT}/fail-desk.png` }); process.exitCode = 1; }
  finally { await b.close(); }
})();
