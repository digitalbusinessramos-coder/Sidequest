const { chromium, devices } = require('playwright');
const B = process.env.BASE_URL || 'http://localhost:3000/';
const S = (process.env.SHOTS || require('os').tmpdir()) + '/';
(async () => {
  const browser = await chromium.launch();
  const mk = async () => { const c = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 }); await c.addInitScript(() => { try { localStorage.setItem('sq_wants_login', '1'); localStorage.setItem('sq_tour_done', '1'); } catch {} }); const p = await c.newPage(); const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message)); return { p, errs }; };
  const A = await mk(), Bu = await mk();
  async function signup(x, email, name) {
    await x.p.goto(B); await x.p.getByLabel('Email').fill(email); await x.p.getByLabel('Password').fill('password123');
    await x.p.getByRole('button', { name: 'Create account' }).last().click();
    await x.p.getByLabel('First name').fill(name); await x.p.getByRole('button', { name: 'Continue' }).click();
    await x.p.getByLabel(/Approximate area/).selectOption('canteras'); await x.p.getByRole('button', { name: 'Continue' }).click();
    await x.p.getByRole('button', { name: 'English' }).click(); await x.p.getByRole('button', { name: 'Museums' }).click();
    await x.p.getByRole('button', { name: 'Start exploring' }).click();
    await x.p.getByText('What could you do').waitFor();
  }
  await A.p.goto(B); await A.p.screenshot({ path: S + '01-welcome.png', fullPage: true });
  await signup(A, 'alex@test.example', 'Alex');
  await A.p.screenshot({ path: S + '02-explore.png', fullPage: true });
  // create
  await A.p.getByRole('link', { name: 'Create' }).click();
  await A.p.screenshot({ path: S + '03-templates.png' });
  await A.p.getByRole('button', { name: 'Museum visit' }).click();
  await A.p.getByLabel('Title').fill('Museum and coffee, test plan');
  await A.p.getByLabel('Group size, including you').fill('2');
  await A.p.getByLabel(/Exact meeting point/).fill('By the cathedral steps');
  await A.p.getByRole('checkbox', { name: /Everyone comes solo/ }).check();
  await A.p.screenshot({ path: S + '04-form.png', fullPage: true });
  await A.p.getByRole('button', { name: 'Publish plan' }).click();
  await A.p.getByRole('heading', { name: 'Museum and coffee, test plan' }).waitFor();
  const url = A.p.url();
  await A.p.screenshot({ path: S + '05-org-detail.png', fullPage: true });
  // B
  await signup(Bu, 'bea@test.example', 'Bea');
  await Bu.p.getByLabel('Search activities').fill('test plan');
  await Bu.p.getByRole('link', { name: /Museum and coffee, test plan/ }).click();
  await Bu.p.getByRole('button', { name: 'Ask to join' }).click();
  await Bu.p.getByLabel(/Short message/).fill('Hi, first time here!');
  await Bu.p.getByRole('button', { name: 'Send request' }).click();
  await Bu.p.getByText('Your request is waiting').waitFor();
  await Bu.p.screenshot({ path: S + '06-pending.png', fullPage: true });
  // A accepts
  await A.p.reload(); await A.p.getByRole('button', { name: 'Accept' }).click();
  await A.p.getByText('Bea is confirmed').waitFor();
  // B sees confirmed (poll)
  await Bu.p.getByText('You’re confirmed').waitFor({ timeout: 15000 });
  await Bu.p.screenshot({ path: S + '07-confirmed.png', fullPage: true });
  await Bu.p.getByRole('link', { name: 'Open chat' }).first().click();
  await Bu.p.getByLabel('Message', { exact: true }).fill('See you at the steps!'); await Bu.p.getByRole('button', { name: 'Send' }).click();
  await A.p.goto(url + '/chat');
  await A.p.getByText('See you at the steps!').waitFor({ timeout: 8000 });
  await A.p.getByRole('button', { name: 'Running about 5 minutes late' }).click();
  await Bu.p.getByText('Running about 5 minutes late').last().waitFor({ timeout: 8000 });
  await Bu.p.screenshot({ path: S + '08-chat.png' });
  // full state for a third user
  const C = await mk(); await signup(C, 'cy@test.example', 'Cy');
  await C.p.goto(url); await C.p.getByRole('button', { name: 'Full' }).waitFor();
  // plans
  await Bu.p.goto(B + '#/plans'); await Bu.p.screenshot({ path: S + '09-plans.png', fullPage: true });
  // leave
  Bu.p.once('dialog', d => d.accept());
  await Bu.p.goto(url); await Bu.p.getByRole('button', { name: 'Leave' }).click(); await Bu.p.getByText('You left').first().waitFor();
  await C.p.reload(); await C.p.getByRole('button', { name: 'Ask to join' }).waitFor();
  // cancel
  await A.p.goto(url); await A.p.getByRole('button', { name: 'Cancel activity' }).click(); await A.p.getByLabel(/Reason/).fill('Museum closed');
  await A.p.getByRole('button', { name: 'Cancel activity' }).last().click(); await A.p.getByText(/cancelled by the organiser/).waitFor();
  await A.p.screenshot({ path: S + '10-cancelled.png', fullPage: true });
  // other screens
  await A.p.goto(B + '#/event/1'); await A.p.getByRole('button', { name: 'Find someone to go with' }).click(); await A.p.getByRole('button', { name: 'Show me who else is going' }).click();
  await A.p.getByText('People also looking for company').waitFor(); await A.p.waitForTimeout(500); await A.p.screenshot({ path: S + '11-event.png', fullPage: true });
  await A.p.goto(B + '#/buddies'); await A.p.getByRole('button', { name: 'Add a wish' }).click(); await A.p.getByRole('dialog').getByRole('button', { name: 'Museums' }).click();
  await A.p.getByRole('button', { name: 'Thursday afternoon' }).click(); await A.p.getByRole('button', { name: 'Save wish' }).click(); await A.p.waitForTimeout(800);
  await A.p.screenshot({ path: S + '12-buddies.png', fullPage: true });
  await A.p.goto(B + '#/guide'); await A.p.waitForTimeout(500); await A.p.screenshot({ path: S + '13-guide.png', fullPage: true });
  await A.p.goto(B + '#/profile'); await A.p.waitForTimeout(500); await A.p.screenshot({ path: S + '14-profile.png', fullPage: true });
  await C.p.goto(B + '#/explore'); await C.p.getByLabel('Search activities').fill('zzzz nothing'); await C.p.getByText('Nothing matches').waitFor(); await C.p.screenshot({ path: S + '15-empty.png' });
  // unauthorised chat via URL
  await C.p.goto(url + '/chat'); await C.p.getByText(/Only confirmed participants/).waitFor();
  console.log('ERRORS A', A.errs, 'B', Bu.errs, 'C', C.errs);
  await browser.close();
  console.log('E2E OK');
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
