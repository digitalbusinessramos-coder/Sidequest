// Launch journey in real browsers (Chromium with phone and desktop emulation). Usage:
//   BASE=http://localhost:3000 node test/journey.browser.cjs      (or BASE=https://erasquest.up.railway.app)
// Test accounts use @example.com addresses, so they are marked as test accounts and kept out of campaign numbers.
// The plan it creates is cancelled at the end.
const { chromium, devices } = require('playwright');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const OUT = process.env.OUT || '/tmp/erasquest-journey';
require('fs').mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const log = (...a) => console.log('•', ...a);
const assert = (ok, msg) => { if (!ok) throw new Error(`FAILED: ${msg}`); log('ok', msg); };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signUpInSheet(page, name) {
  await page.waitForSelector('.sheet input[type=email]');
  await page.fill('.sheet input[autocomplete=given-name]', name);
  await page.fill('.sheet input[type=email]', `qa-${name.toLowerCase()}-${stamp}@example.com`);
  await page.fill('.sheet input[type=password]', 'qa-password-123');
  await page.locator('.sheet button.btn-primary').click();
}

(async () => {
  const browser = await chromium.launch();
  const host = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const guest = await phoneCtx.newPage();
  const third = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  let planId;
  try {
    // 1. Host creates a custom plan on desktop: no template, capped at 2, people ask to join.
    await host.goto(`${BASE}/#/create`);
    await host.fill('#plan-title', `QA test plan ${stamp}`);
    await host.getByRole('button', { name: 'Tomorrow' }).first().click();
    await host.getByRole('radio', { name: 'Part of the day' }).click();
    await host.getByRole('button', { name: 'evening' }).click();
    await host.fill('#plan-area', 'Las Canteras');
    await host.getByRole('button', { name: /More details/ }).click();
    await host.getByRole('button', { name: 'Set a limit' }).click();
    await host.getByLabel('Maximum number of people, including you').fill('2');
    await host.fill('input[placeholder^="e.g. In front of the café"]', 'QA: by the lifeguard tower');
    await host.getByRole('button', { name: 'Publish plan' }).click();
    await signUpInSheet(host, 'Hosta');
    await host.waitForURL(/#\/activity\/\d+\?created=1/);
    planId = Number(/activity\/(\d+)/.exec(host.url())[1]);
    const facts = await host.locator('.facts-list').innerText();
    assert(/Tomorrow, evening/.test(facts), 'host sees "Tomorrow, evening", no invented exact time');
    assert(!/€|Free|min\b| h\b/.test(facts), 'no invented price or duration');
    assert(/Up to 2 people/.test(facts), 'limit shown because the host set one');
    await host.screenshot({ path: `${OUT}/01-host-plan-desktop.png`, fullPage: true });

    // 2. A guest on a phone opens the shared link, asks to join, and signs up in between.
    await guest.goto(`${BASE}/p/${planId}`);
    await guest.waitForURL(new RegExp(`#/activity/${planId}`));
    await guest.getByRole('button', { name: 'Ask to join' }).click();
    await guest.getByLabel(/Short message/).fill('Hi! First time, is that OK?');
    await guest.getByRole('button', { name: 'Send request' }).click();
    await signUpInSheet(guest, 'Gina');
    await guest.getByText('Request sent').first().waitFor();
    assert(guest.url().includes(`#/activity/${planId}`), 'guest is back on the same plan after sign-up, request sent');
    const repeat = await guest.evaluate((id) => fetch(`/api/activities/${id}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()), planId);
    assert(repeat.repeated === true && repeat.status === 'pending', 'duplicate tap does not create a second request');
    assert(await overflow(guest) <= 0, 'no sideways scrolling on the phone plan page');
    await guest.screenshot({ path: `${OUT}/02-guest-request-phone.png`, fullPage: true });

    // 3. Host accepts.
    await host.goto(`${BASE}/#/activity/${planId}`);
    await host.getByRole('button', { name: 'Accept' }).click();
    await host.getByText('Gina is confirmed.').waitFor();
    log('host accepted');

    // 4. The guest closes the site, reopens the original link later, and finds the confirmation and the chat.
    await guest.close();
    const again = await phoneCtx.newPage();
    await again.goto(`${BASE}/p/${planId}`);
    await again.waitForURL(new RegExp(`#/activity/${planId}`));
    await again.getByText('You’re confirmed').first().waitFor();
    const meet = await again.locator('.meetup').innerText();
    assert(meet.includes('QA: by the lifeguard tower'), 'confirmed participant now sees the exact meeting point');
    await again.goto(`${BASE}/#/plans`);
    await again.getByText(`QA test plan ${stamp}`).first().waitFor();
    assert((await again.locator('section[aria-labelledby=pl-confirmed]').innerText()).includes(`QA test plan ${stamp}`), 'plan listed under Confirmed in My Plans');
    await again.screenshot({ path: `${OUT}/03-my-plans-phone.png`, fullPage: true });
    await again.goto(`${BASE}/#/activity/${planId}/chat`);
    await again.getByLabel('Message', { exact: true }).fill('See you there!');
    await again.getByRole('button', { name: 'Send' }).click();
    await again.getByText('See you there!').waitFor();
    log('chat works');

    // 5. A third student sees the plan as full (limit 2 reached).
    await third.goto(`${BASE}/p/${planId}`);
    await third.getByRole('button', { name: 'Full' }).waitFor();
    log('third person sees "Full"');

    // 6. Host cancels; the participant sees it on the same link and in their updates.
    await host.goto(`${BASE}/#/activity/${planId}`);
    await host.getByRole('button', { name: 'Cancel activity' }).click();
    await host.getByLabel(/Reason/).fill('QA test finished');
    await host.getByRole('button', { name: 'Cancel activity' }).last().click();
    await host.getByText(/cancelled by the organiser/).waitFor();
    await again.goto(`${BASE}/p/${planId}`);
    await again.getByText(/cancelled by the organiser/).waitFor();
    await again.goto(`${BASE}/#/plans`);
    await again.getByText(/was cancelled/).first().waitFor();
    log('cancellation visible on the link and in My Plans updates');
    await again.screenshot({ path: `${OUT}/04-cancelled-updates-phone.png`, fullPage: true });
    console.log(`\nJourney passed on ${BASE} (plan ${planId}, cancelled).`);
  } catch (e) {
    console.error(e.message);
    for (const [n, p] of [['host', host], ['third', third]]) await p.screenshot({ path: `${OUT}/fail-${n}.png`, fullPage: true }).catch(() => {});
    if (planId) await host.evaluate((id) => fetch(`/api/activities/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"reason":"QA test"}' }), planId).catch(() => {});
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
