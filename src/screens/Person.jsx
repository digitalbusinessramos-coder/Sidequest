import { useState } from 'react';
import { t, tx } from '../i18n.js';
import { Avatar, EmailBadge, ErrorState, Icon, Loading, ReportSheet, SampleBadge, TopBar, useApp } from '../components.jsx';
import { areaName, fmtMonth, useApi } from '../util.js';
import { categoryLabel } from '../../shared/catalog.js';

export const ROLE_LABEL = { exchange: 'Erasmus / exchange student', international: 'International student', intern: 'Intern / trainee', local: 'Local student' };

export default function Person({ id }) {
  const { me, api, toast, city, meta } = useApp();
  const { data, error, loading, reload } = useApi(`/users/${id}`);
  const [report, setReport] = useState(null);
  if (Number(id) === me.id) { location.replace('#/profile'); return null; }
  if (loading) return <><TopBar title="" /><div className="page"><Loading rows={1} /></div></>;
  if (error) return <><TopBar title="" /><div className="page"><ErrorState error={error} onRetry={reload} /></div></>;
  const p = data.profile;
  const block = async () => {
    if (!confirm(t('person.blockConfirm', { name: p.first_name }))) return;
    try { await api.post(`/users/${p.id}/block`); toast(`${p.first_name} is blocked.`); location.hash = '#/explore'; } catch (x) { toast(x.message, true); }
  };
  const roleLabel = { exchange: tx("Erasmus / exchange student"), international: tx("International student"), intern: tx("Intern / trainee"), local: tx("Local student") }[p.role];
  return (
    <>
      <TopBar title={p.first_name} />
      <div className="page">
        <div className="row" style={{ gap: 16 }}>
          <Avatar person={p} size="xl" />
          <div className="stack-sm">
            <h1>{p.first_name}</h1>
            <div className="row wrap" style={{ gap: 6 }}>{p.is_demo && <SampleBadge />}{p.email_verified && <EmailBadge />}<span className="small muted">{roleLabel}</span></div>
          </div>
        </div>
        {p.intro && <p>{p.intro}</p>}
        <div className="card card-pad facts-list">
          <Icon name="globe" /><div>{p.languages.map((l) => tx(l)).join(', ') || tx("No languages listed")}</div>
          {p.interests.length > 0 && <><Icon name="heart" /><div>{p.interests.map((c) => tx(categoryLabel(c))).join(', ')}</div></>}
          {p.area && <><Icon name="pin" /><div>{tx('Around {area}', { area: areaName(city.areas, p.area) })}</div></>}
          {p.university && <><Icon name="school" /><div>{p.university} <span className="tiny muted">{tx('(self-reported, not verified)')}</span></div></>}
          {(p.exchange_start || p.exchange_end) && <><Icon name="plans" /><div>{tx('Here {from} – {to}', { from: fmtMonth(p.exchange_start), to: fmtMonth(p.exchange_end) })}</div></>}
        </div>
        <div className="notice"><Icon name="shield" />{tx("Meet in public places, share plans with a friend, and leave whenever you want.")}</div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={block}>{t('person.block')}</button>
          <button className="btn btn-danger btn-sm" onClick={() => setReport({ type: 'user', id: p.id, label: p.first_name })}><Icon name="flag" size={16} />{t('person.report')}</button>
        </div>
      </div>
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </>
  );
}
