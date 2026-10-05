import { useEffect, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Clock3, Crosshair, FileText, ImagePlus, LayoutDashboard, LogOut, MapPin, Menu, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import pathpalMark from '@assets/pathpal-mark.png';
import {
  CommunityReportCategory, CommunityReportInputLocation, CommunityReportStatus,
  createReportSession, getGetReportQueryKey, getListReportsQueryKey, getReportPhoto,
  retryReportAnalysis, reviewReportAnalysis, setAuthTokenGetter, useCreateReport, useGetReport, useListReports, useResetDemoReports, useUpdateReport,
  type CommunityReport, type CommunityReportAiReviewInput, type CommunityReportDetail, type CommunityReportInput, type CommunityReportUpdate, type ReportSession, type ReportSessionInputRole,
} from '@workspace/api-client-react';
import './app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 0, retry: 1, refetchOnWindowFocus: true } } });
const STORAGE = 'orivis-demo-session';
const roles: ReportSessionInputRole[] = ['parent', 'child', 'manager', 'worker'];
const categories = Object.values(CommunityReportCategory);
const locations = Object.values(CommunityReportInputLocation);
const statuses = Object.values(CommunityReportStatus);
const roleCopy: Record<ReportSessionInputRole, { title: string; description: string; tag: string }> = {
  parent: { title: 'Family view', description: 'Keep an eye on the places your family moves through.', tag: 'FAMILY' },
  child: { title: 'Young neighbor', description: 'Speak up when something on your route does not feel right.', tag: 'FAMILY' },
  manager: { title: 'City desk', description: 'Triage reports, coordinate teams, and close the loop.', tag: 'CITY STAFF' },
  worker: { title: 'Field view', description: 'See assigned work and update its progress on the ground.', tag: 'FIELD TEAM' },
};
const areaPins: Record<string, [number, number]> = {
  'Downtown San Jose': [37.3352, -121.8906], Japantown: [37.3495, -121.8941],
  'Willow Glen': [37.299, -121.899], 'East San Jose': [37.337, -121.828],
  'Alum Rock': [37.367, -121.824], 'Santa Clara': [37.3541, -121.9552],
};
const mapBounds = { north: 37.41, south: 37.26, west: -121.99, east: -121.76 };

function getInitialSession(): ReportSession | null {
  try {
    const item = localStorage.getItem(STORAGE);
    if (!item) return null;
    const session = JSON.parse(item) as ReportSession;
    if (!session.accessToken || Date.parse(session.expiresAt) <= Date.now() || !roles.includes(session.role)) {
      localStorage.removeItem(STORAGE);
      return null;
    }
    return session;
  } catch { localStorage.removeItem(STORAGE); return null; }
}
let activeSession = getInitialSession();
setAuthTokenGetter(() => activeSession?.accessToken ?? null);
function errorText(error: unknown) {
  if (error && typeof error === 'object') {
    const item = error as { message?: string; data?: { error?: string }; body?: { error?: string } };
    return item.data?.error || item.body?.error || item.message || 'That did not work. Please try again.';
  }
  return 'That did not work. Please try again.';
}
function dateText(value: string | null | undefined) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function Status({ value }: { value: string }) {
  return <span data-testid="status-report" className={`status status-${value.toLowerCase().replaceAll(' ', '-')}`}><span className="status-dot" />{value}</span>;
}
function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton-wrap" aria-label="Loading reports">{Array.from({ length: lines }, (_, i) => <div className="skeleton" key={i} style={{ width: `${94 - i * 12}%` }} />)}</div>;
}
function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="notice notice-error"><strong>We could not load this right now.</strong><span>{errorText(error)}</span><button className="text-action" onClick={retry} data-testid="button-retry">Try again <ArrowRight size={15} /></button></div>;
}
function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-art"><MapPin size={28} strokeWidth={1.4} /><span className="empty-orbit" /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
function ReportRow({ report }: { report: CommunityReport }) {
  return <Link href={`/reports/${report.id}`} className="report-row" data-testid={`link-report-${report.id}`}>
    <ProtectedPhoto id={report.id} hasPhoto={!!report.photoUri} compact />
    <div className="row-body">
      <div className="row-topline"><span className="eyebrow">CASE <span data-testid={`text-report-id-${report.id}`}>{report.id}</span></span><span className="row-date" data-testid={`text-submitted-${report.id}`}>{dateText(report.submittedAt)}</span></div>
      <strong className="row-title">{report.summary}</strong>
      <p className="row-description" data-testid={`text-description-${report.id}`}>{report.description}</p>
      <div className="row-details">
        <span data-testid={`text-selected-category-${report.id}`}><b>SELECTED ISSUE</b>{report.selectedCategory ?? 'Not selected'}</span>
        <span data-testid={`text-ai-category-${report.id}`}><b>AI CATEGORY</b>{report.category}</span>
        <span data-testid={`text-severity-${report.id}`}><b>SEVERITY</b>{report.severity} / 10</span>
        <span data-testid={`text-assigned-team-${report.id}`}><b>ASSIGNED TEAM</b>{report.assignedTeam || 'Unassigned'}</span>
        <span className="row-location" data-testid={`text-location-${report.id}`}><b>LOCATION / PIN</b>{report.location} · {report.latitude != null && report.longitude != null ? `${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}` : 'Pin unavailable'}</span>
      </div>
    </div>
    <div className="row-side"><Status value={report.status} /><span className="row-side-date">{dateText(report.submittedAt)}</span><ArrowUpRight size={19} className="row-arrow" /></div>
  </Link>;
}
function Header({ title, description, marker, action }: { title: string; description: string; marker: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="section-kicker"><span className="kicker-line" />{marker}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function SignIn({ onSignIn }: { onSignIn: (session: ReportSession) => void }) {
  const [role, setRole] = useState<ReportSessionInputRole>('parent');
  const [username, setUsername] = useState('AI4SG');
  const [password, setPassword] = useState('1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { const session = await createReportSession({ username: username.trim(), password, role }); onSignIn(session); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <div className="signin-shell">
    <div className="signin-left">
      <div className="signin-brand"><img className="brand-icon" src={pathpalMark} alt="" /><span>PathPal</span></div>
      <div className="signin-story"><span className="light-kicker">A BETTER WAY TO LOOK OUT FOR EACH OTHER</span><h1>A safer street<br />starts with <em>someone noticing.</em></h1><p>One place for neighbors to flag a concern and see what the city did next.</p></div>
      <div className="signin-bottom"><span className="sign-line" /><span>SANTA CLARA COUNTY, CALIFORNIA</span><span>01 / 05</span></div>
      <div className="signin-rings"><span /><span /><span /><i /></div>
    </div>
    <div className="signin-right">
      <div className="signin-form-wrap"><div className="mini-label"><span className="mini-dot" /> PROTOTYPE WORKSPACE</div><h2>Step into your<br /><em>community.</em></h2><p className="signin-intro">Choose a demo perspective to explore how a report moves from the neighborhood to the city.</p>
        <form onSubmit={submit}>
          <label className="field-label">EXPLORE AS</label><div className="role-grid">{roles.map(item => <button type="button" key={item} data-testid={`button-role-${item}`} onClick={() => setRole(item)} className={`role-option ${role === item ? 'selected' : ''}`}><span className="role-check">{role === item && <Check size={13} />}</span><span><strong>{item === 'manager' ? 'City manager' : item === 'worker' ? 'Field worker' : item === 'child' ? 'Young neighbor' : 'Parent'}</strong><small>{roleCopy[item].tag}</small></span></button>)}</div>
          <div className="signin-fields"><label className="field"><span>DEMO USERNAME</span><input data-testid="input-username" value={username} onChange={e => setUsername(e.target.value)} required /></label><label className="field"><span>DEMO PASSWORD</span><input data-testid="input-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label></div>
          {error && <div className="inline-error" role="alert" data-testid="text-login-error">{error}</div>}
          <button className="primary-btn signin-submit" type="submit" disabled={busy} data-testid="button-sign-in">{busy ? 'Opening workspace…' : `Enter as ${role === 'manager' ? 'manager' : role === 'worker' ? 'worker' : role}`}<ArrowRight size={17} /></button>
        </form>
        <div className="demo-disclaimer"><ShieldCheck size={18} /><p><strong>Demo only.</strong> These shared credentials and roles are for prototyping, not secure accounts. Do not submit private or emergency information. For an immediate danger, call 911.</p></div>
      </div>
    </div>
  </div>;
}

function Shell({ session, signOut, children }: { session: ReportSession; signOut: () => void; children: ReactNode }) {
  const [location] = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [location]);
  const nav = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/report/new', label: 'New report', icon: MapPin },
    { href: '/reports', label: 'Report history', icon: FileText },
    { href: '/settings', label: 'Settings', icon: Settings2 },
  ];
  return <div className="app-layout">
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <Link href="/" className="sidebar-brand" data-testid="link-logo"><img className="brand-icon" src={pathpalMark} alt="" /><span>PathPal</span></Link>
      <div className="sidebar-overline">YOUR WORKSPACE</div>
      <nav className="sidebar-nav">{nav.map(({ href, label, icon: Icon }) => <Link href={href} key={href} data-testid={`link-nav-${href === '/' ? 'overview' : href.replaceAll('/', '-')}`} className={`nav-item ${location === href || (href === '/reports' && location.startsWith('/reports/')) ? 'active' : ''}`}><Icon size={19} strokeWidth={1.7} />{label}{href === '/report/new' && <span className="nav-plus">+</span>}</Link>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note"><span className="sidebar-note-icon"><ShieldCheck size={19} /></span><span><strong>Neighbors first.</strong><small>Not for emergencies.<br />Call 911 for immediate danger.</small></span></div>
      <div className="sidebar-person"><span className="person-avatar">{session.role.slice(0, 1).toUpperCase()}</span><div><strong>{session.role === 'manager' ? 'City manager' : session.role === 'worker' ? 'Field worker' : session.role === 'child' ? 'Young neighbor' : 'Parent'}</strong><small>Demo account</small></div><button onClick={signOut} title="Sign out" aria-label="Sign out" data-testid="button-sidebar-signout"><LogOut size={17} /></button></div>
    </aside>
    {menu && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMenu(false)} />}
    <div className="main-column"><header className="topbar"><button className="mobile-menu" aria-label="Open menu" onClick={() => setMenu(true)} data-testid="button-open-menu"><Menu size={22} /></button><span className="topbar-location"><span className="topbar-pulse" /> SANTA CLARA COUNTY <span className="topbar-separator">/</span> COMMUNITY SAFETY</span><div className="topbar-right"><span className="demo-pill">LIVE DEMO</span><span className="topbar-date">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span></div></header><main className="main-content">{children}</main><footer className="app-footer"><span>PATHPAL / COMMUNITY WORKSPACE</span><span>Prototype experience · Not an emergency service</span></footer></div>
  </div>;
}

function Overview({ session }: { session: ReportSession }) {
  const { data, isLoading, error, refetch } = useListReports();
  const reports = data ?? [];
  const open = reports.filter(r => r.status !== 'Resolved').length;
  const resolved = reports.filter(r => r.status === 'Resolved').length;
  const isStaff = session.role === 'manager' || session.role === 'worker';
  const intro = roleCopy[session.role];
  return <>
    <Header marker={`${intro.tag} / OVERVIEW`} title={session.role === 'manager' ? 'A clearer view of the city.' : session.role === 'worker' ? 'Work that moves things forward.' : 'A little more peace of mind.'} description={intro.description} action={<Link className="primary-btn" href="/report/new" data-testid="link-new-report">Share a concern <ArrowUpRight size={17} /></Link>} />
    <div className="overview-grid">
      <div className="welcome-panel"><div className="welcome-top"><span className="light-kicker">YOUR CORNER OF THE COMMUNITY</span><span className="welcome-decoration">O/</span></div><div><h2>{isStaff ? 'Every update makes the next step clearer.' : 'Noticed something? It matters.'}</h2><p>{isStaff ? 'Review the reports in your view, and keep the people behind them informed.' : 'A broken light, an unsafe crossing, something that feels off. Share it here and follow its path.'}</p><Link href={isStaff ? '/reports' : '/report/new'} className="welcome-link" data-testid="link-welcome-action">{isStaff ? 'View the report queue' : 'Make a report'} <ArrowRight size={16} /></Link></div><div className="welcome-rings"><i /><i /><i /></div></div>
      <div className="stats-stack"><div className="stat-card"><span className="stat-label">REPORTS IN YOUR VIEW <ArrowUpRight size={17} /></span><div className="stat-value">{isLoading ? '—' : reports.length.toString().padStart(2, '0')}</div><span className="stat-foot">{isStaff ? 'Visible to your team' : 'Visible to this account'}</span></div><div className="stat-twins"><div className="stat-small"><span className="stat-label">IN PROGRESS</span><strong>{isLoading ? '—' : open.toString().padStart(2, '0')}</strong><span>Still being worked on</span></div><div className="stat-small"><span className="stat-label">RESOLVED</span><strong>{isLoading ? '—' : resolved.toString().padStart(2, '0')}</strong><span>Closed with an update</span></div></div></div>
    </div>
    <section className="content-section"><div className="section-title-row"><div><span className="section-kicker"><span className="kicker-line" />THE LATEST</span><h2>{isStaff ? 'Recent cases' : 'Your report trail'}</h2></div><Link href="/reports" className="text-action" data-testid="link-all-reports">View all reports <ArrowUpRight size={17} /></Link></div>
      <div className="list-card">{isLoading ? <Skeleton lines={4} /> : error ? <Failure error={error} retry={() => void refetch()} /> : reports.length ? reports.slice(0, 4).map(report => <ReportRow report={report} key={report.id} />) : <Empty title="Nothing in your report trail yet" description="When a concern is shared, its progress will appear here." action={<Link href="/report/new" className="secondary-btn" data-testid="link-empty-create">Share a concern <ArrowRight size={16} /></Link>} />}</div>
    </section>
    <div className="bottom-note"><span className="note-mark">01</span><p><strong>From first notice to follow-through.</strong> The description you send and the analysis returned by the system stay together, so you can understand each step in context.</p><ArrowDownRight size={22} /></div>
  </>;
}

function Reports() {
  const { data, isLoading, error, refetch, isFetching } = useListReports({ query: { queryKey: getListReportsQueryKey(), refetchOnMount: 'always' } });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All reports');
  const reports = (data ?? []).filter(report => (filter === 'All reports' || report.status === filter) && `${report.summary} ${report.description} ${report.location} ${report.category} ${report.id}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <Header marker="REPORTS / HISTORY" title="The whole story, in one place." description="Your saved reports and their latest city updates, newest first." action={<Link className="primary-btn" href="/report/new" data-testid="link-history-new">New report <ArrowUpRight size={17} /></Link>} />
    <div className="history-toolbar"><div className="search-field"><Search size={18} /><input data-testid="input-search-reports" placeholder="Search by concern, place, or case ID" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="filter-field"><SlidersHorizontal size={16} /><select data-testid="select-status-filter" value={filter} onChange={e => setFilter(e.target.value)}><option>All reports</option>{statuses.map(s => <option key={s}>{s}</option>)}</select><ChevronDown size={15} /></div><button className="refresh-btn" title="Refresh reports" aria-label="Refresh reports" onClick={() => void refetch()} disabled={isFetching} data-testid="button-refresh-reports"><RefreshCw size={18} className={isFetching ? 'spinning' : ''} /></button></div>
    <div className="history-meta"><span>{isLoading ? 'LOADING' : `${reports.length} ${reports.length === 1 ? 'REPORT' : 'REPORTS'} FOUND`}</span><span>NEWEST FIRST <ArrowDownRight size={14} /></span></div>
    <div className="list-card history-list">{isLoading ? <Skeleton lines={6} /> : error ? <Failure error={error} retry={() => void refetch()} /> : reports.length ? reports.map(report => <ReportRow key={report.id} report={report} />) : <Empty title={data?.length ? 'No matching reports' : 'No reports here yet'} description={data?.length ? 'Try another search or status to find what you need.' : 'A report will live here as soon as it is submitted.'} action={data?.length ? <button className="secondary-btn" onClick={() => { setQuery(''); setFilter('All reports'); }} data-testid="button-clear-filters">Clear filters</button> : <Link href="/report/new" className="secondary-btn" data-testid="link-history-empty">Start a report <ArrowRight size={16} /></Link>} />}</div>
    <div className="history-hint"><ShieldCheck size={18} /> Reports are scoped by the demo account on the server. Family and neighbor views only show their own eligible reports.</div>
  </>;
}

function NewReport() {
  const [, navigate] = useLocation();
  const query = useQueryClient();
  const create = useCreateReport();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<CommunityReportInput['location']>('Santa Clara');
  const [category, setCategory] = useState<string>('');
  const [lat, setLat] = useState('37.3541');
  const [lng, setLng] = useState('-121.9552');
  const [photo, setPhoto] = useState<{ name: string; data: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; preview: string } | null>(null);
  const [error, setError] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const pinLatitude = Number(lat), pinLongitude = Number(lng);
  const pinInMap = Number.isFinite(pinLatitude) && Number.isFinite(pinLongitude)
    && pinLatitude >= mapBounds.south && pinLatitude <= mapBounds.north
    && pinLongitude >= mapBounds.west && pinLongitude <= mapBounds.east;
  const pinPosition = pinInMap ? {
    left: `${((pinLongitude - mapBounds.west) / (mapBounds.east - mapBounds.west)) * 100}%`,
    top: `${((mapBounds.north - pinLatitude) / (mapBounds.north - mapBounds.south)) * 100}%`,
  } : undefined;
  function changeLocation(value: CommunityReportInput['location']) { setLocation(value); const point = areaPins[value ?? 'Santa Clara']; setLat(String(point[0])); setLng(String(point[1])); }
  function placeMapPin(latitude: number, longitude: number) {
    setLat(latitude.toFixed(6)); setLng(longitude.toFixed(6));
    const closest = locations.reduce((best, candidate) => {
      const [bestLat, bestLng] = areaPins[best], [candidateLat, candidateLng] = areaPins[candidate];
      const bestDistance = (bestLat - latitude) ** 2 + (bestLng - longitude) ** 2;
      const candidateDistance = (candidateLat - latitude) ** 2 + (candidateLng - longitude) ** 2;
      return candidateDistance < bestDistance ? candidate : best;
    }, locations[0]);
    setLocation(closest);
    setError('');
  }
  function clickMap(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    placeMapPin(mapBounds.north - y * (mapBounds.north - mapBounds.south), mapBounds.west + x * (mapBounds.east - mapBounds.west));
  }
  function keyMap(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? .01 : .002;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      placeMapPin(pinInMap ? pinLatitude : 37.3352, pinInMap ? pinLongitude : -121.8906);
      return;
    }
    const directions: Record<string, [number, number]> = {
      ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    placeMapPin(
      Math.max(mapBounds.south, Math.min(mapBounds.north, (pinInMap ? pinLatitude : 37.3352) + direction[0])),
      Math.max(mapBounds.west, Math.min(mapBounds.east, (pinInMap ? pinLongitude : -121.8906) + direction[1])),
    );
  }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPEG, PNG, or WebP image.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('Choose an image smaller than 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { const result = String(reader.result); setPhoto({ name: file.name, data: result.split(',')[1], type: file.type as 'image/jpeg' | 'image/png' | 'image/webp', preview: result }); setError(''); };
    reader.onerror = () => setError('The image could not be read. Please try another.');
    reader.readAsDataURL(file);
  }
  function useMyLocation() {
    if (!navigator.geolocation) { setError('Your browser does not support location access. Enter the coordinates instead.'); return; }
    setGeoBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(position => { setLat(position.coords.latitude.toFixed(6)); setLng(position.coords.longitude.toFixed(6)); setGeoBusy(false); }, () => { setError('Location access was unavailable. Enter the pin coordinates manually.'); setGeoBusy(false); }, { timeout: 10000 });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const latitude = Number(lat), longitude = Number(lng);
    if (description.trim().length < 12) { setError('Please tell us a little more about the concern (at least 12 characters).'); return; }
    if (!Number.isFinite(latitude) || latitude < 37 || latitude > 37.6 || !Number.isFinite(longitude) || longitude < -122.2 || longitude > -121.6) { setError('Place the pin within Santa Clara County: latitude 37–37.6 and longitude −122.2–−121.6.'); return; }
    try {
      const report = await create.mutateAsync({ data: { description: description.trim(), location, ...(category ? { category: category as CommunityReportInput['category'] } : {}), latitude, longitude, ...(photo ? { photoBase64: photo.data, contentType: photo.type } : {}) } });
      await query.invalidateQueries({ queryKey: getListReportsQueryKey() });
      navigate(`/reports/${report.id}`);
    } catch (err) { setError(errorText(err)); }
  }
  return <>
    <Link href="/reports" className="back-link" data-testid="link-back-history"><ArrowLeft size={16} /> Report history</Link>
    <Header marker="REPORTS / NEW" title="Tell us what you noticed." description="A few details help your neighbors and city teams understand where to start." />
    <div className="form-layout"><form className="form-card" onSubmit={submit}><div className="form-section-head"><span className="form-number">01</span><div><h2>The concern</h2><p>Describe what you saw in your own words.</p></div></div>
      <label className="field"><span>WHAT IS HAPPENING? <b>*</b></span><textarea data-testid="input-description" placeholder="For example: The sidewalk is lifted near the bus stop, and it's difficult to pass with a stroller…" value={description} onChange={e => setDescription(e.target.value)} minLength={12} maxLength={4000} required rows={6} /><small>{description.length} / 4,000 characters</small></label>
      <div className="form-divider" /><div className="form-section-head"><span className="form-number">02</span><div><h2>Where it is</h2><p>Select an area and confirm the exact pin.</p></div></div>
      <div className="field-pair"><label className="field"><span>NEIGHBORHOOD</span><span className="select-wrap"><select data-testid="select-location" value={location} onChange={e => changeLocation(e.target.value as CommunityReportInput['location'])}>{locations.map(l => <option key={l}>{l}</option>)}</select><ChevronDown size={16} /></span></label><label className="field"><span>CATEGORY <em>OPTIONAL</em></span><span className="select-wrap"><select data-testid="select-category" value={category} onChange={e => setCategory(e.target.value)}><option value="">Let PathPal suggest</option>{categories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={16} /></span></label></div>
      <div className="pin-box"><div className="pin-box-head"><div><MapPin size={18} /><strong>Drop a pin on the map</strong></div><button type="button" onClick={useMyLocation} disabled={geoBusy} className="text-action" data-testid="button-use-location"><Crosshair size={15} />{geoBusy ? 'Locating…' : 'Use my location'}</button></div>
        <p className="map-instructions">Tap or click to place a pin. This is a schematic, approximate view of San Jose, not a street-accurate map.</p>
        <div className="pin-map" role="button" tabIndex={0} onClick={clickMap} onKeyDown={keyMap} aria-label={`Approximate San Jose location map. ${pinInMap ? `Pin at latitude ${lat}, longitude ${lng}.` : 'Pin outside the displayed area.'} Click or tap to place a pin; use arrow keys to move it, Shift and arrow keys for larger steps.`} data-testid="map-drop-pin">
          <svg className="pin-map-lines" viewBox="0 0 600 290" preserveAspectRatio="none" aria-hidden="true">
            <path className="map-water" d="M0 0H114L132 25 112 52 124 73 87 106 25 122 0 113Z" />
            <path className="map-park" d="M392 0H600V58L567 74 535 67 510 94 452 80 426 42Z M485 192L530 178 600 214V290H521L480 251Z" />
            <path className="map-road-major" d="M25 190C160 169 261 177 380 156S525 137 600 108 M177 0C184 68 235 99 258 146S282 231 319 290 M0 74C149 103 240 102 340 76S514 92 600 109" />
            <path className="map-road-minor" d="M0 244C120 218 262 224 345 203S490 192 600 219 M58 0C106 64 93 144 133 290 M347 0C339 61 361 149 402 290 M490 0C465 91 448 173 447 290 M0 150C120 132 190 144 287 119S450 115 600 143" />
          </svg>
          <span className="map-place map-place-santa">SANTA CLARA</span><span className="map-place map-place-japantown">JAPANTOWN</span><span className="map-place map-place-downtown">DOWNTOWN</span><span className="map-place map-place-willow">WILLOW GLEN</span><span className="map-place map-place-alum">ALUM ROCK</span><span className="map-place map-place-east">EAST SAN JOSE</span>
          {pinPosition && <span className="map-selected-pin" style={pinPosition} aria-hidden="true"><MapPin size={29} fill="#087f83" stroke="#f5fbf9" strokeWidth={1.8} /></span>}
          <span className="map-scale" aria-hidden="true">APPROXIMATE MAP / NOT TO SCALE</span>
        </div>
        <div className="map-readout" aria-live="polite"><span className="map-readout-dot" />{pinInMap ? `Selected pin · ${pinLatitude.toFixed(6)}, ${pinLongitude.toFixed(6)}` : 'Pin is outside this schematic view; manual coordinates still apply.'}</div>
        <div className="pin-manual-label">OR ENTER COORDINATES MANUALLY</div>
        <div className="field-pair"><label className="field"><span>LATITUDE <b>*</b></span><input type="number" step="any" min="37" max="37.6" required data-testid="input-latitude" value={lat} onChange={e => setLat(e.target.value)} /></label><label className="field"><span>LONGITUDE <b>*</b></span><input type="number" step="any" min="-122.2" max="-121.6" required data-testid="input-longitude" value={lng} onChange={e => setLng(e.target.value)} /></label></div><small>The coordinates shown here are the pin submitted and saved with your report.</small></div>
      <div className="form-divider" /><div className="form-section-head"><span className="form-number">03</span><div><h2>Add a photo</h2><p>Optional, but it can make the situation easier to see.</p></div></div>
      <label className="upload-box" htmlFor="photo-upload" data-testid="label-upload-photo">{photo ? <><img src={photo.preview} alt="Selected report preview" /><span>{photo.name}</span><span className="upload-change">Choose another image</span></> : <><ImagePlus size={25} strokeWidth={1.5} /><strong>Choose an image</strong><span>JPEG, PNG, or WebP · up to 2 MB</span></>}<input id="photo-upload" data-testid="input-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} /></label>{photo && <button type="button" className="remove-photo" onClick={() => setPhoto(null)} data-testid="button-remove-photo"><X size={14} /> Remove photo</button>}
      {error && <div className="inline-error" role="alert" data-testid="text-create-error">{error}</div>}
      <div className="form-actions"><span>You can follow the full history after submitting.</span><button type="submit" disabled={create.isPending} className="primary-btn" data-testid="button-submit-report">{create.isPending ? 'Submitting report…' : 'Submit report'} <ArrowRight size={17} /></button></div>
    </form><aside className="form-aside"><div className="aside-card"><span className="section-kicker"><span className="kicker-line" />WHAT HAPPENS NEXT</span><div className="steps"><div><span>01</span><p><strong>You share the concern</strong><small>Your description, pin, and photo are saved together.</small></p></div><div><span>02</span><p><strong>PathPal adds context</strong><small>You'll see the suggested category, summary, and priority alongside your original words.</small></p></div><div><span>03</span><p><strong>Follow the response</strong><small>City updates appear in the report's timeline.</small></p></div></div></div><div className="aside-warning"><ShieldCheck size={20} /><p>This is a prototype, not an emergency channel. Call 911 if someone is in immediate danger.</p></div></aside></div>
  </>;
}

function ProtectedPhoto({ id, hasPhoto, compact = false }: { id: string; hasPhoto: boolean; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!hasPhoto) return;
    let current = true; let objectUrl: string | null = null;
    setUrl(null); setFailed(false);
    getReportPhoto(id).then(blob => { if (current) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, hasPhoto]);
  return <div className={`report-photo ${compact ? 'report-thumb' : ''}`}>{url ? <img src={url} alt="Photo submitted with report" data-testid={compact ? `img-report-thumbnail-${id}` : 'img-report-photo'} /> : <div className="photo-placeholder"><ImagePlus size={compact ? 20 : 27} strokeWidth={1.3} /><span>{hasPhoto ? failed ? 'Photo unavailable' : 'Loading photo…' : 'No photo attached'}</span></div>}</div>;
}

function Detail({ session }: { session: ReportSession }) {
  const { id = '' } = useParams<{ id: string }>();
  const { data: report, isLoading, error, refetch } = useGetReport(id, { query: { queryKey: getGetReportQueryKey(id), enabled: !!id, refetchOnMount: 'always' } });
  const update = useUpdateReport();
  const query = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CommunityReportUpdate>({});
  const [saveError, setSaveError] = useState('');
  function startEdit() {
    if (!report) return;
    setForm(session.role === 'worker' ? { status: report.status } : { description: report.description, category: report.category, severity: report.severity, location: report.location, status: report.status, assignedTeam: report.assignedTeam, managerNotes: report.managerNotes, routeAssignment: report.routeAssignment, latitude: report.latitude ?? undefined, longitude: report.longitude ?? undefined });
    setSaveError(''); setEditing(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!report) return; setSaveError('');
    if (session.role === 'manager' && ((form.latitude !== undefined || form.longitude !== undefined) && (form.latitude === undefined || form.longitude === undefined || form.latitude < 37 || form.latitude > 37.6 || form.longitude < -122.2 || form.longitude > -121.6))) { setSaveError('Enter both pin coordinates within Santa Clara County, or leave both blank.'); return; }
    try {
      await update.mutateAsync({ id, data: session.role === 'worker' ? { status: form.status } : form });
      await Promise.all([query.invalidateQueries({ queryKey: getGetReportQueryKey(id) }), query.invalidateQueries({ queryKey: getListReportsQueryKey() })]);
      setEditing(false);
    } catch (err) { setSaveError(errorText(err)); }
  }
  return <>
    <Link href="/reports" className="back-link" data-testid="link-detail-back"><ArrowLeft size={16} /> Report history</Link>
    {isLoading ? <div className="detail-loading"><Skeleton lines={8} /></div> : error || !report ? <Failure error={error ?? new Error('Report not found or not visible to this account.')} retry={() => void refetch()} /> : <>
      <div className="detail-hero"><div><div className="section-kicker"><span className="kicker-line" />CASE FILE / {report.id.slice(0, 12).toUpperCase()}</div><h1>{report.summary}</h1><div className="detail-hero-meta"><Status value={report.status} /><span><MapPin size={15} />{report.location}</span><span><Clock3 size={15} />Submitted {shortDate(report.submittedAt)}</span></div></div><div className="detail-hero-actions">{(session.role === 'manager' || session.role === 'worker') && <button className="primary-btn" onClick={startEdit} data-testid="button-edit-report">{session.role === 'worker' ? 'Update status' : 'Manage report'} <ArrowUpRight size={16} /></button>}</div></div>
      <div className="detail-grid"><div className="detail-main">
         <div className="detail-card input-output"><div className="card-heading"><span className="section-kicker"><span className="kicker-line" />THE FULL CONTEXT</span><h2>What was shared <em>&</em> what we found</h2></div><div className="context-pair"><div className="context-box original"><div className="context-tag"><span>01</span> NEIGHBOR'S WORDS</div><p data-testid="text-report-description">{report.description}</p><span className="context-caption">Original submitted description</span></div><div className="context-box analysis"><div className="context-tag"><Sparkles size={15} /> AI REPORT ANALYSIS</div><div className="analysis-summary"><span>SUMMARY</span><strong data-testid="text-report-summary">{report.summary}</strong></div><div className="analysis-fields"><div><span>SUGGESTED CATEGORY</span><strong>{report.category}</strong></div><div><span>RECOMMENDED TEAM</span><strong>{report.recommendedDepartment}</strong></div><div><span>PRIORITY</span><strong>{report.priority}</strong></div><div><span>SEVERITY</span><strong>{report.severity} / 10</strong></div></div></div></div><div className="context-foot">Selected category: {report.selectedCategory ?? 'Let PathPal suggest'} <span>·</span> AI output is triage guidance, not a confirmed finding.</div></div>
         <AiAssessmentPanel report={report} session={session} />
        <div className="detail-card"><div className="card-heading"><span className="section-kicker"><span className="kicker-line" />LOCATION & EVIDENCE</span><h2>At the scene</h2></div><div className="scene-grid"><ProtectedPhoto id={id} hasPhoto={!!report.photoUri} /><div className="pin-detail"><span className="detail-label">REPORTED LOCATION</span><h3>{report.location}</h3><div className="pin-coordinates"><MapPin size={19} /><div><strong>Submitted pin</strong><span data-testid="text-report-coordinates">{report.latitude != null && report.longitude != null ? `${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}` : 'No coordinates recorded'}</span></div></div>{report.latitude != null && report.longitude != null && <a href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=17/${report.latitude}/${report.longitude}`} target="_blank" rel="noreferrer" className="text-action" data-testid="link-open-map">Open pin in map <ArrowUpRight size={16} /></a>}</div></div></div>
        <div className="detail-card"><div className="card-heading"><span className="section-kicker"><span className="kicker-line" />CASE ACTIVITY</span><h2>How it is moving</h2></div>{report.statusHistory.length ? <div className="timeline">{report.statusHistory.map((event, i) => <div className="timeline-event" key={`${event.changedAt}-${i}`}><span className="timeline-node" /><div><div className="timeline-top"><strong>{event.toStatus}</strong><time>{dateText(event.changedAt)}</time></div><p>{event.fromStatus ? `Moved from ${event.fromStatus}` : 'Report received'} <span>·</span> {event.changedBy}</p></div></div>)}</div> : <p className="quiet-text">No status changes have been recorded yet.</p>}</div>
      </div><aside className="detail-aside"><div className="detail-card case-card"><div className="card-heading"><span className="section-kicker"><span className="kicker-line" />CASE DETAILS</span><h2>At a glance</h2></div><div className="case-facts"><div><span>CASE ID</span><strong className="mono">{report.id}</strong></div><div><span>STATUS</span><Status value={report.status} /></div><div><span>ASSIGNED TEAM</span><strong>{report.assignedTeam || 'Not assigned yet'}</strong></div><div><span>ROUTE ASSIGNMENT</span><strong>{report.routeAssignment || 'Not assigned yet'}</strong></div><div><span>MANAGER NOTES</span><strong className="normal-weight">{report.managerNotes || 'No notes added yet'}</strong></div></div></div><div className="detail-card timestamp-card"><span className="section-kicker"><span className="kicker-line" />TIMESTAMPS</span><div><span>Submitted</span><strong>{dateText(report.submittedAt)}</strong></div><div><span>Last updated</span><strong>{dateText(report.updatedAt)}</strong></div><div><span>Assigned</span><strong>{dateText(report.assignedAt)}</strong></div><div><span>Resolved</span><strong>{dateText(report.resolvedAt)}</strong></div></div><div className="aside-warning"><ShieldCheck size={20} /><p>This case is visible according to your demo role. For immediate danger, call 911.</p></div></aside></div>
      {editing && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setEditing(false); }}><div className="edit-modal" role="dialog" aria-modal="true" aria-label="Edit report"><div className="modal-header"><div><span className="section-kicker"><span className="kicker-line" />CASE / {report.id.slice(0, 8).toUpperCase()}</span><h2>{session.role === 'worker' ? 'Update progress' : 'Manage report'}</h2></div><button onClick={() => setEditing(false)} aria-label="Close editor" data-testid="button-close-editor"><X size={20} /></button></div><form onSubmit={save} className="edit-form">
        {session.role === 'manager' && <><label className="field"><span>DESCRIPTION</span><textarea required minLength={12} maxLength={4000} rows={4} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="input-edit-description" /></label><div className="field-pair"><label className="field"><span>CATEGORY</span><span className="select-wrap"><select value={form.category ?? ''} onChange={e => setForm({ ...form, category: e.target.value as CommunityReportUpdate['category'] })} data-testid="select-edit-category">{categories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={16} /></span></label><label className="field"><span>SEVERITY / 10</span><input type="number" min="1" max="10" required value={form.severity ?? 1} onChange={e => setForm({ ...form, severity: Number(e.target.value) })} data-testid="input-edit-severity" /></label></div><label className="field"><span>LOCATION</span><span className="select-wrap"><select value={form.location ?? ''} onChange={e => setForm({ ...form, location: e.target.value as CommunityReportUpdate['location'] })} data-testid="select-edit-location">{locations.map(l => <option key={l}>{l}</option>)}</select><ChevronDown size={16} /></span></label><div className="field-pair"><label className="field"><span>PIN LATITUDE</span><input type="number" step="any" min="37" max="37.6" value={form.latitude ?? ''} onChange={e => setForm({ ...form, latitude: e.target.value ? Number(e.target.value) : undefined })} data-testid="input-edit-latitude" /></label><label className="field"><span>PIN LONGITUDE</span><input type="number" step="any" min="-122.2" max="-121.6" value={form.longitude ?? ''} onChange={e => setForm({ ...form, longitude: e.target.value ? Number(e.target.value) : undefined })} data-testid="input-edit-longitude" /></label></div></>}
        <label className="field"><span>STATUS</span><span className="select-wrap"><select value={form.status ?? report.status} onChange={e => setForm({ ...form, status: e.target.value as CommunityReportUpdate['status'] })} data-testid="select-edit-status">{statuses.map(s => <option key={s}>{s}</option>)}</select><ChevronDown size={16} /></span></label>
        {session.role === 'manager' && <><label className="field"><span>ASSIGNED TEAM</span><input maxLength={120} value={form.assignedTeam ?? ''} onChange={e => setForm({ ...form, assignedTeam: e.target.value || null })} placeholder="Team or department" data-testid="input-edit-team" /></label><label className="field"><span>ROUTE ASSIGNMENT</span><input maxLength={160} value={form.routeAssignment ?? ''} onChange={e => setForm({ ...form, routeAssignment: e.target.value || null })} placeholder="Route or work order" data-testid="input-edit-route" /></label><label className="field"><span>MANAGER NOTES</span><textarea maxLength={4000} rows={3} value={form.managerNotes ?? ''} onChange={e => setForm({ ...form, managerNotes: e.target.value || null })} placeholder="Internal case notes" data-testid="input-edit-notes" /></label></>}
        {saveError && <div className="inline-error" role="alert" data-testid="text-update-error">{saveError}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setEditing(false)} data-testid="button-cancel-edit">Cancel</button><button className="primary-btn" disabled={update.isPending} type="submit" data-testid="button-save-report">{update.isPending ? 'Saving…' : 'Save changes'} <ArrowRight size={16} /></button></div></form></div></div>}
    </>}
  </>;
}

function AiAssessmentPanel({ report, session }: { report: CommunityReportDetail; session: ReportSession }) {
  const query = useQueryClient();
  const assessment = report.aiAssessment;
  const [reason, setReason] = useState('');
  const [finalCategory, setFinalCategory] = useState<CommunityReportCategory>(report.category);
  const [finalSeverity, setFinalSeverity] = useState(String(report.severity));
  const [finalUrgency, setFinalUrgency] = useState<'urgent_review' | 'same_day' | 'routine' | 'undetermined'>('undetermined');
  const [finalDepartment, setFinalDepartment] = useState(report.recommendedDepartment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!assessment) return;
    setFinalCategory(assessment.suggestedCategory);
    setFinalSeverity(String(assessment.suggestedSeverity));
    setFinalUrgency(assessment.urgency);
    setFinalDepartment(assessment.recommendedDepartment);
    setReason('');
  }, [assessment?.id]);

  async function refreshCase() {
    await Promise.all([
      query.invalidateQueries({ queryKey: getGetReportQueryKey(report.id) }),
      query.invalidateQueries({ queryKey: getListReportsQueryKey() }),
    ]);
  }

  async function retry() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await retryReportAnalysis(report.id);
      await refreshCase();
      setMessage('A new AI assessment is ready to review.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function review(decision: 'approved' | 'overridden') {
    setError('');
    setMessage('');
    if (reason.trim().length < 8) {
      setError('Add a reason with at least 8 characters.');
      return;
    }
    const severity = Number(finalSeverity);
    if (decision === 'overridden' && (!Number.isInteger(severity) || severity < 1 || severity > 10 || !finalDepartment.trim())) {
      setError('Choose a severity from 1 to 10 and enter a department.');
      return;
    }
    const data: CommunityReportAiReviewInput = decision === 'approved'
      ? { decision, reason: reason.trim() }
      : {
          decision,
          reason: reason.trim(),
          finalCategory,
          finalSeverity: severity,
          finalPriority: severity >= 8 ? 'High' : severity >= 5 ? 'Medium' : 'Low',
          finalUrgency,
          finalDepartment: finalDepartment.trim(),
        };
    setBusy(true);
    try {
      await reviewReportAnalysis(report.id, data);
      await refreshCase();
      setMessage(decision === 'approved' ? 'AI suggestion approved with your reason recorded.' : 'Override saved; the original AI assessment remains in the history.');
      setReason('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return <div className="detail-card">
    <div className="card-heading">
      <span className="section-kicker"><span className="kicker-line" />AI TRIAGE</span>
      <h2>Assessment & human review</h2>
    </div>
    <p className="quiet-text" data-testid="text-ai-analysis-status">
      {report.aiAnalysisStatus === 'complete' && assessment &&
        report.aiReviewHistory.some(review => review.assessmentId === assessment.id)
        ? 'Manager review recorded · advisory only; this does not dispatch help.' :
        report.aiAnalysisStatus === 'complete' && assessment
          ? 'AI-assisted assessment — awaiting review. Guidance only; not a verified finding or dispatch.' :
        report.aiAnalysisStatus === 'pending' ? 'AI assessment is still processing.' : 'AI analysis is unavailable. The report remains saved with its original details.'}
    </p>
    {assessment ? <>
      <div className="analysis-fields">
        <div><span>MODEL SUGGESTION</span><strong>{assessment.suggestedCategory}</strong></div>
        <div><span>POTENTIAL SEVERITY · LEGACY PRIORITY</span><strong>{assessment.suggestedSeverity} / 10 · {assessment.suggestedPriority}</strong></div>
        <div><span>URGENCY</span><strong>{assessment.urgency.replaceAll('_', ' ')}</strong></div>
        <div><span>EVIDENCE QUALITY</span><strong>{assessment.evidenceQuality}</strong></div>
        <div><span>PHOTO INPUT</span><strong>{assessment.imageAssessmentStatus === 'analyzed' ? 'Image bytes analyzed' : 'No photo provided'}</strong></div>
        <div><span>RECOMMENDED DEPARTMENT</span><strong>{assessment.recommendedDepartment}</strong></div>
        <div><span>ANALYZED</span><strong>{dateText(assessment.analyzedAt)}</strong></div>
      </div>
      {assessment.urgentHumanReview ? <div className="quiet-banner" role="status">Human review recommended: the evidence may be ambiguous or need follow-up.</div> : null}
      {assessment.uncertainty ? <p className="quiet-text"><strong>Uncertainty:</strong> {assessment.uncertainty}</p> : null}
      {assessment.conflicts.length ? <p className="quiet-text"><strong>Conflicting details:</strong> {assessment.conflicts.join(' · ')}</p> : null}
      {assessment.missingFacts.length ? <div className="quiet-text"><strong>Facts to verify:</strong><ul>{assessment.missingFacts.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div> : null}
      {assessment.evidence.length ? <div className="timeline">{assessment.evidence.map((item, index) => (
        <div className="timeline-event" key={`${item.source}-${index}`}><span className="timeline-node" /><div>
          <div className="timeline-top"><strong>{item.source === 'image' ? 'Photo evidence' : 'Report text'}</strong></div>
          <p>{item.detail}</p>
        </div></div>
      ))}</div> : null}
      {assessment.ruleAdjustments.length ? <div className="quiet-banner" role="status">
        <strong>Safety rule adjustments</strong>
        {assessment.ruleAdjustments.map((adjustment, index) => (
          <p key={`${adjustment.source}-${index}`}>{adjustment.source}: {adjustment.reason} ({String(adjustment.beforeValue)} → {String(adjustment.afterValue)})</p>
        ))}
      </div> : null}
      {assessment.originalAssessment ? <details className="quiet-text">
        <summary>Original model assessment</summary>
        <p>Potential severity {assessment.originalAssessment.suggestedSeverity}/10 · urgency {assessment.originalAssessment.urgency.replaceAll('_', ' ')} · evidence quality {assessment.originalAssessment.evidenceQuality}</p>
        <p>{assessment.originalAssessment.summary}</p>
      </details> : null}
      <p className="context-foot">Original model assessment, rubric {assessment.rubricVersion}, and model {assessment.model} are retained.</p>
    </> : null}
    {session.role === 'manager' && report.aiAnalysisStatus !== 'complete' ? (
      <button className="secondary-btn" type="button" disabled={busy} onClick={() => void retry()} data-testid="button-retry-ai-analysis">
        {busy ? 'Retrying…' : 'Retry AI analysis'} <RefreshCw size={15} />
      </button>
    ) : null}
    {session.role === 'manager' && assessment ? <div className="ai-review-form">
      <h3>Record your decision</h3>
      <label className="field"><span>REVIEW REASON</span><textarea value={reason} onChange={event => setReason(event.target.value)} minLength={8} maxLength={1500} rows={3} placeholder="Explain why you approve or change the suggestion." data-testid="input-ai-review-reason" /></label>
      <div className="field-pair">
        <label className="field"><span>OVERRIDE CATEGORY</span><span className="select-wrap"><select value={finalCategory} onChange={event => setFinalCategory(event.target.value as CommunityReportCategory)} data-testid="select-ai-review-category">{categories.map(category => <option key={category}>{category}</option>)}</select><ChevronDown size={16} /></span></label>
        <label className="field"><span>OVERRIDE SEVERITY / 10</span><input type="number" min="1" max="10" step="1" value={finalSeverity} onChange={event => setFinalSeverity(event.target.value)} data-testid="input-ai-review-severity" /></label>
      </div>
      <label className="field"><span>OVERRIDE DEPARTMENT</span><input maxLength={100} value={finalDepartment} onChange={event => setFinalDepartment(event.target.value)} data-testid="input-ai-review-department" /></label>
        <label className="field"><span>OVERRIDE URGENCY</span><span className="select-wrap"><select value={finalUrgency} onChange={event => setFinalUrgency(event.target.value as typeof finalUrgency)} data-testid="select-ai-review-urgency">
          <option value="urgent_review">Urgent human review</option>
          <option value="same_day">Same day</option>
          <option value="routine">Routine</option>
          <option value="undetermined">Undetermined</option>
        </select><ChevronDown size={16} /></span></label>
      <div className="detail-hero-actions">
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => void review('approved')} data-testid="button-approve-ai">Approve suggestion</button>
        <button type="button" className="primary-btn" disabled={busy} onClick={() => void review('overridden')} data-testid="button-override-ai">Save override</button>
      </div>
    </div> : null}
    {message ? <div className="inline-success" role="status">{message}</div> : null}
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    {report.aiReviewHistory.length ? <div className="timeline" data-testid="list-ai-review-history">
      <h3>Human review history</h3>
      {report.aiReviewHistory.map(review => <div className="timeline-event" key={review.id}><span className="timeline-node" /><div>
        <div className="timeline-top"><strong>{review.decision === 'approved' ? 'Approved suggestion' : 'Overrode suggestion'}</strong><time>{dateText(review.reviewedAt)}</time></div>
        <p>{review.reason} · {review.reviewedBy} · Final potential severity {review.finalSeverity}/10 · urgency {review.finalUrgency?.replaceAll('_', ' ') ?? 'not recorded'}</p>
      </div></div>)}
    </div> : null}
  </div>;
}

function Settings({ session, signOut }: { session: ReportSession; signOut: () => void }) {
  const reset = useResetDemoReports();
  const query = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function resetDemo() {
    if (!window.confirm('Restore the six demonstration reports? Your submitted reports will not be deleted.')) return;
    setError(''); setMessage('');
    try { const reports = await reset.mutateAsync(); await query.invalidateQueries({ queryKey: getListReportsQueryKey() }); setMessage(`Restored ${reports.length} demonstration reports. Your submitted reports were kept.`); }
    catch (err) { setError(errorText(err)); }
  }
  return <><Header marker="WORKSPACE / SETTINGS" title="A little housekeeping." description="Manage this prototype session and its demonstration data." /><div className="settings-layout"><div className="settings-card"><div className="settings-icon"><ShieldCheck size={21} /></div><div><span className="section-kicker"><span className="kicker-line" />CURRENT SESSION</span><h2>{roleCopy[session.role].title}</h2><p>{roleCopy[session.role].description}</p><div className="settings-facts"><div><span>ACCESS</span><strong>{session.role.toUpperCase()} / DEMO</strong></div><div><span>SESSION EXPIRES</span><strong>{dateText(session.expiresAt)}</strong></div></div><button className="secondary-btn" onClick={signOut} data-testid="button-sign-out">Sign out <LogOut size={16} /></button></div></div>
    <div className="settings-card"><div className="settings-icon"><RotateCcw size={21} /></div><div><span className="section-kicker"><span className="kicker-line" />DEMO DATA</span><h2>Restore the starting view</h2><p>Restore six demonstration cases without deleting reports people submitted during this demo.</p>{session.role === 'manager' ? <button className="secondary-btn" disabled={reset.isPending} onClick={() => void resetDemo()} data-testid="button-reset-demo">{reset.isPending ? 'Restoring…' : 'Restore demo cases'} <RotateCcw size={16} /></button> : <div className="quiet-banner">Only the city manager demo role can restore demo cases.</div>}{message && <div className="inline-success" data-testid="text-reset-success">{message}</div>}{error && <div className="inline-error" role="alert" data-testid="text-reset-error">{error}</div>}</div></div>
    <div className="settings-disclaimer"><span className="section-kicker"><span className="kicker-line" />A NOTE ABOUT THIS DEMO</span><h2>Built to demonstrate the process, not protect real accounts.</h2><p>All demo roles use shared credentials. This is not secure authentication, an emergency dispatch service, or a place for sensitive personal information. The reports shown depend on server-side demo role scoping.</p></div></div></>;
}

function NotFound() { return <div className="not-found"><span className="section-kicker"><span className="kicker-line" />404 / NOT FOUND</span><h1>This path ends here.</h1><p>Let's get you back to the neighborhood.</p><Link href="/" className="primary-btn" data-testid="link-not-found-home">Return to overview <ArrowRight size={16} /></Link></div>; }

function Workspace() {
  const [session, setSession] = useState<ReportSession | null>(activeSession);
  const [, navigate] = useLocation();
  const client = useQueryClient();
  function setSignedIn(next: ReportSession) {
    client.clear(); activeSession = next; setAuthTokenGetter(() => activeSession?.accessToken ?? null);
    localStorage.setItem(STORAGE, JSON.stringify(next)); setSession(next); navigate('/');
  }
  function signOut() {
    activeSession = null; setAuthTokenGetter(null); localStorage.removeItem(STORAGE); client.clear(); setSession(null); navigate('/');
  }
  useEffect(() => { if (session && Date.parse(session.expiresAt) <= Date.now()) signOut(); }, [session]);
  if (!session) return <SignIn onSignIn={setSignedIn} />;
  return <Shell session={session} signOut={signOut}><Switch><Route path="/"><Overview session={session} /></Route><Route path="/report/new"><NewReport /></Route><Route path="/reports"><Reports /></Route><Route path="/reports/:id"><Detail session={session} /></Route><Route path="/settings"><Settings session={session} signOut={signOut} /></Route><Route><NotFound /></Route></Switch></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Workspace /></WouterRouter></QueryClientProvider>;
}
export default App;