import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { getLanguage, setAppName, setLanguage, t, tx } from './i18n.js';
import { AppCtx, ErrorState, Icon, Loading, useToast } from './components.jsx';
import Welcome from './screens/Welcome.jsx';
import Onboarding from './screens/Onboarding.jsx';
import Explore from './screens/Explore.jsx';
import ActivityDetail from './screens/ActivityDetail.jsx';
import ActivityForm from './screens/ActivityForm.jsx';
import EventDetail from './screens/EventDetail.jsx';
import Chat from './screens/Chat.jsx';
import EventChat from './screens/EventChat.jsx';
import Plans from './screens/Plans.jsx';
import Buddies from './screens/Buddies.jsx';
import Guide from './screens/Guide.jsx';
import Profile from './screens/Profile.jsx';
import Person from './screens/Person.jsx';

function useHashRoute() {
  const parse = () => {
    const raw = location.hash.replace(/^#/, '') || '/explore';
    const [path, qs] = raw.split('?');
    return { path, parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const TABS = [
  ['explore', 'explore', 'nav.explore'],
  ['buddies', 'buddies', 'nav.buddies'],
  ['plans', 'plans', 'nav.plans'],
  ['guide', 'guide', 'nav.guide'],
  ['profile', 'profile', 'nav.profile'],
];
const TAB_OF = { activity: 'explore', event: 'explore', create: 'explore', person: 'buddies' };

export default function App() {
  const route = useHashRoute();
  const [meta, setMeta] = useState(null);
  const [me, setMe] = useState(undefined);
  const [counts, setCounts] = useState({ toReview: 0, invites: 0, notifications: 0, chats: 0 });
  const [bootError, setBootError] = useState(null);
  const [lang, setLang] = useState(getLanguage());
  const changeLanguage = useCallback((l) => {
    setLanguage(l);
    setLang(l);
    api.put('/me/privacy', { lang: l }).catch(() => {}); // remembered on the account when logged in
  }, []);
  const [toastNode, toast] = useToast();

  const reloadMe = useCallback(async () => {
    const r = await api.get('/me');
    setMe(r.user);
    if (r.counts) setCounts(r.counts);
    return r.user;
  }, []);

  const boot = useCallback(async () => {
    setBootError(null);
    try {
      const m = await api.get('/meta');
      setAppName(m.appName);
      document.title = m.appName;
      setMeta(m);
      await reloadMe();
    } catch (e) { setBootError(e); }
  }, [reloadMe]);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => {
    if (!me) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') reloadMe().catch(() => {}); }, 20000);
    return () => clearInterval(id);
  }, [me?.id, reloadMe]); // eslint-disable-line react-hooks/exhaustive-deps

  if (bootError) return <div className="page"><ErrorState error={bootError} onRetry={boot} /></div>;
  if (!meta || me === undefined) return <div className="page"><Loading /></div>;

  const city = meta.cities.find((c) => c.slug === me?.city?.slug) || meta.cities[0];
  const ctx = { meta, me, city, reloadMe, toast, api, counts, lang, changeLanguage };

  if (!me) return <AppCtx.Provider value={ctx}><Welcome key={lang} />{toastNode}</AppCtx.Provider>;
  if (!me.onboarded) return <AppCtx.Provider value={ctx}><Onboarding key={lang} />{toastNode}</AppCtx.Provider>;

  const [p0, p1, p2] = route.parts;
  let screen;
  if (p0 === 'activity' && p2 === 'chat') screen = <Chat id={p1} />;
  else if (p0 === 'activity' && p2 === 'edit') screen = <ActivityForm editId={p1} />;
  else if (p0 === 'activity') screen = <ActivityDetail id={p1} />;
  else if (p0 === 'event' && p2 === 'chat') screen = <EventChat id={p1} />;
  else if (p0 === 'event') screen = <EventDetail id={p1} />;
  else if (p0 === 'create') screen = <ActivityForm query={route.query} />;
  else if (p0 === 'person') screen = <Person id={p1} />;
  else if (p0 === 'plans') screen = <Plans />;
  else if (p0 === 'buddies') screen = <Buddies />;
  else if (p0 === 'guide') screen = <Guide />;
  else if (p0 === 'profile') screen = <Profile sub={p1} />;
  else screen = <Explore />;

  const activeTab = TAB_OF[p0] || p0 || 'explore';
  const badge = { plans: (counts.notifications || 0) + (counts.chats || 0), buddies: counts.invites };

  return (
    <AppCtx.Provider value={ctx}>
      {me.is_demo && <div className="demo-banner">{tx('You are using a fictional sample persona ({name}). Changes are visible to other testers.', { name: me.first_name })}</div>}
      <div className="app">
        <main id="main" key={lang}>{screen}</main>
      </div>
      <nav className="tabbar" aria-label="Main">
        <ul>
          {TABS.map(([key, icon, label]) => (
            <li key={key}>
              <a href={`#/${key}`} aria-current={activeTab === key ? 'page' : undefined}>
                <Icon name={icon} size={22} />
                {t(label)}
                {badge[key] > 0 && <span className="tab-badge" aria-label={tx('{n} need your attention', { n: badge[key] })}>{badge[key]}</span>}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {toastNode}
    </AppCtx.Provider>
  );
}
