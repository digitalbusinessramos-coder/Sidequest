import { getAppName, tx } from '../i18n.js';
import { Icon, TopBar, useApp, DetailPhoto, SampleBadge } from '../components.jsx';
import { photo } from '../../shared/photos.js';
import { InstallSteps, canSuggestInstall, installContext } from './Install.jsx';

/**
 * One read-only example plan, reachable from Create and Help. It is not stored in the database, so it never appears in
 * discovery, search, My Plans or any count, and nobody can join it.
 */
export function ExamplePlan() {
  return (
    <>
      <TopBar title={tx('Example plan')} />
      <div className="page">
        <div className="notice blue"><Icon name="info" />{tx('This is an example to show how a plan looks. It is not a real plan: there is no host and nobody can join it.')}</div>
        <DetailPhoto ph={photo('promenade')} />
        <div className="stack-sm">
          <div className="row wrap" style={{ gap: 6 }}><SampleBadge /><span className="badge badge-open"><Icon name="bolt" size={12} />{tx('Join directly')}</span></div>
          <h1 style={{ fontSize: '1.45rem' }}>{tx('Sunset walk on the Las Canteras promenade')}</h1>
          <p className="small muted">{tx('Posted by a student (their first name appears here)')}</p>
        </div>
        <div className="card card-pad facts-list">
          <Icon name="clock" /><div><strong>{tx('Saturday, evening')}</strong><div className="tiny muted">{tx('Canary Islands time')}</div></div>
          <Icon name="pin" /><div><strong>Las Canteras</strong><div className="tiny muted">{tx('Public meeting area. Confirmed participants see the exact meeting point.')}</div></div>
          <Icon name="euro" /><div><strong>{tx('Free')}</strong></div>
          <Icon name="group" /><div><strong>{tx('No group limit')}</strong></div>
        </div>
        <p>{tx('A slow walk from La Puntilla towards the Auditorio, then we watch the sunset. Bring something to drink.')}</p>
        <p className="small reassure"><Icon name="heart" size={16} />{tx('You’re welcome to come on your own.')}</p>
        <section className="card card-pad stack-sm">
          <h3>{tx('What happens when you join a real plan')}</h3>
          <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>{tx('Tap “Join plan” (or “Ask to join” when the host accepts people).')}</li>
            <li>{tx('The plan is saved in My Plans, so you can close the website and find it again.')}</li>
            <li>{tx('Once you are in, a private chat opens and you see the exact meeting point.')}</li>
          </ol>
        </section>
        <button className="btn btn-secondary btn-block" disabled>{tx('Joining is not possible on an example')}</button>
        <a className="btn btn-primary btn-block" href="#/create">{tx('Create a real plan')}</a>
      </div>
    </>
  );
}

/** Help: how it works in one screen, the example plan, emergencies, and feedback. */
export default function Help() {
  const { openFeedback } = useApp();
  return (
    <>
      <TopBar title={tx('Help')} />
      <div className="page">
        <section className="stack-sm" aria-labelledby="how-h">
          <h1 id="how-h">{tx('How {app} works', { app: getAppName() })}</h1>
          <ol className="how-steps">
            <li><Icon name="search" /><span><strong>{tx('Find a plan')}</strong><br /><span className="small muted">{tx('Browse plans by students in Las Palmas, or post what you feel like doing.')}</span></span></li>
            <li><Icon name="group" /><span><strong>{tx('Join it')}</strong><br /><span className="small muted">{tx('Tap “Join plan” or “Ask to join”. The plan stays in My Plans, with every update.')}</span></span></li>
            <li><Icon name="chat" /><span><strong>{tx('Arrange the meeting')}</strong><br /><span className="small muted">{tx('Once you are in, agree on the details in the private plan chat and meet in a public place.')}</span></span></li>
          </ol>
          <div className="row wrap">
            <a className="btn btn-primary btn-sm" href="#/explore">{tx('See plans')}</a>
            <a className="btn btn-secondary btn-sm" href="#/example">{tx('See an example plan')}</a>
          </div>
        </section>

        {(canSuggestInstall() || installContext().standalone) && (
          <section className="stack-sm" aria-labelledby="inst-h" id="install">
            <h2 id="inst-h" className="row"><Icon name="plus" />{tx('Add {app} to your home screen', { app: getAppName() })}</h2>
            <p className="small muted">{tx('Open your plans with one tap, like an app. Nothing to download from a store.')}</p>
            <InstallSteps />
          </section>
        )}

        <section className="stack-sm" aria-labelledby="em-h" id="emergencies">
          <h2 id="em-h" className="row"><Icon name="shield" />{tx('Help and emergencies')}</h2>
          <p className="small">{tx('In an emergency in Spain, call 112. It is free and works from any phone.')} <a href="https://europa.eu/youreurope/citizens/travel/security-and-emergencies/emergency/index_en.htm" target="_blank" rel="noopener noreferrer">{tx('Source: Your Europe (EU)')}</a></p>
          <p className="small muted">{tx('Meet in public places, tell a friend where you are going, and leave whenever you want. You can block or report anyone from their profile or a plan.')}</p>
        </section>

        <section className="stack-sm" aria-labelledby="fb-help-h">
          <h2 id="fb-help-h" className="row"><Icon name="chat" />{tx('Feedback')}</h2>
          <p className="small muted">{tx('Something unclear or not working? Tell the project team.')}</p>
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={openFeedback}>{tx('Send feedback')}</button>
        </section>

        <p className="tiny muted">{tx('To know how many people use it, the project team sees how many people open the app each day. There are no outside trackers or advertising cookies.')}</p>
        <p className="tiny muted">{tx('{app} is an independent student project developed for the Digital Business course at ULPGC.', { app: getAppName() })}</p>
      </div>
    </>
  );
}
