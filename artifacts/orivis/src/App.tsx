import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, CircleUserRound, Clipboard, Clock3, FileText, House, LogOut, Map, MapPin, Menu, Plus, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
import pathpalMark from '@assets/pathpal-mark.png';
import {
  CommunityReportCategory, CommunityReportInputLocation, CommunityReportStatus, getReportPhoto,
  getGetAccountStatusQueryKey, getGetMyFamilyQueryKey, getGetReportMapDataQueryKey, getGetReportQueryKey,
  getListNotificationsQueryKey, getListReportsQueryKey, useAcceptStaffInvitation, useApproveFamilyJoinRequest,
  useBootstrapInitialManager, useCreateChildAccount, useCreateParentAccount, useCreateReport,
  useCreateStaffInvitation, useGetAccountStatus, useGetMyFamily, useGetReport, useGetReportMapData,
  useListNotifications, useListReports, useMarkNotificationRead, useRejectFamilyJoinRequest, useUpdateReport,
  type AccountStatus, type CommunityReport, type CommunityReportInput, type CommunityReportStatus as ReportStatus,
  type FamilyView, type PathPalNotification, type ReportMapData, type StaffInvitation,
} from '@workspace/api-client-react';
import './app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } });
const categories = Object.values(CommunityReportCategory);
const neighborhoods = Object.values(CommunityReportInputLocation);
const statuses = Object.values(CommunityReportStatus);
const mapBounds = { north: 37.41, south: 37.26, west: -121.99, east: -121.76 };
const neighborhoodCoords: Record<string, [number, number]> = {
  'Downtown San Jose': [37.3352, -121.8906], Japantown: [37.3495, -121.8941],
  'Willow Glen': [37.299, -121.899], 'East San Jose': [37.337, -121.828],
  'Alum Rock': [37.367, -121.824], 'Santa Clara': [37.3541, -121.9552],
};
const clerkPublishableKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const countyMapPath = `${basePath}/map`;

function errorText(error: unknown) {
  if (error && typeof error === 'object') {
    const value = error as { message?: string; data?: { error?: string }; body?: { error?: string } };
    return value.data?.error || value.body?.error || value.message || 'Please try again in a moment.';
  }
  return 'Please try again in a moment.';
}
function dateText(value: string | null | undefined) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function Header({ marker, title, description, action }: { marker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span />{marker}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-panel" role="alert"><strong>We couldn’t load this view.</strong><span>{message}</span>{onRetry && <button className="text-button" onClick={onRetry}>Try again <ArrowRight size={15} /></button>}</div>;
}
function LoadingPanel({ label = 'Loading your workspace' }: { label?: string }) {
  return <div className="loading-panel" aria-label={label}><div className="skeleton skeleton-title" /><div className="skeleton" /><div className="skeleton short" /></div>;
}
function EmptyPanel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-panel"><span className="empty-icon"><MapPin size={22} /></span><h3>{title}</h3><p>{children}</p></div>;
}
function StatusTag({ status }: { status: string }) {
  return <span className={`status-tag status-${status.toLowerCase().replaceAll(' ', '-')}`}><i />{status}</span>;
}
function ReportCard({ report }: { report: CommunityReport }) {
  return <Link className="report-card" href={`/reports/${report.id}`} data-testid={`link-report-${report.id}`}>
    <div className="report-card-mark"><FileText size={18} /></div>
    <div className="report-card-body"><div className="report-card-meta"><span>CASE {report.id}</span><span>{shortDate(report.submittedAt)}</span></div>
      <strong>{report.summary}</strong><p>{report.description}</p>
      <div className="report-card-facts"><span>{report.location}</span><span>{report.category}</span>{report.assignedTeam && <span>{report.assignedTeam}</span>}</div>
    </div><div className="report-card-side"><StatusTag status={report.status} /><ArrowUpRight size={17} /></div>
  </Link>;
}
function HeadingAction({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="button button-primary" href={href}>{children}<ArrowUpRight size={16} /></Link>;
}

function PublicAuth() {
  const [location] = useLocation();
  const signingUp = location.startsWith('/sign-up');
  return <div className="auth-screen">
    <section className="auth-story">
      <Link href="/" className="brand auth-brand"><img src={pathpalMark} alt="" />PathPal</Link>
      <div className="story-content"><span className="micro-label">SANTA CLARA COUNTY · NEIGHBORHOOD CARE</span>
        <h1>Safer streets<br />start with <em>noticing.</em></h1>
        <p>One trusted place for families to share concerns and city teams to follow through.</p>
      </div>
      <div className="auth-foot"><span className="foot-rule" />PRIVATE BY DEFAULT <span className="auth-foot-right">PATHPAL / 01</span></div>
      <div className="story-orbit"><i /><i /><i /></div>
    </section>
    <section className="auth-panel">
      <div className="auth-context"><span className="eyebrow"><span />A SAFER WAY TO GET THERE</span><h2>{signingUp ? 'Make room for a little more care.' : 'Welcome back to your neighborhood.'}</h2><p>Sign in securely to see the information your account is allowed to access.</p></div>
      <div className="clerk-frame">
        {signingUp
          ? <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
          : <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />}
      </div>
      <div className="auth-privacy"><ShieldCheck size={18} /><span><strong>Who can see what is always clear.</strong><br />Your account access is assigned by PathPal, never selected at sign-in.</span></div>
    </section>
  </div>;
}

function ClerkCacheBoundary() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== userId) client.clear();
    previous.current = userId;
  }), [addListener, client]);
  return null;
}

function SetupScreen({ onDone }: { onDone: () => void }) {
  const { user } = useUser();
  const client = useQueryClient();
  const parent = useCreateParentAccount();
  const child = useCreateChildAccount();
  const staff = useAcceptStaffInvitation();
  const manager = useBootstrapInitialManager();
  const [mode, setMode] = useState<'parent' | 'child' | 'staff' | 'manager'>('parent');
  const [displayName, setDisplayName] = useState(user?.fullName || '');
  const [familyName, setFamilyName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [staffResult, setStaffResult] = useState<StaffInvitation | null>(null);
  const busy = parent.isPending || child.isPending || staff.isPending || manager.isPending;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (mode === 'parent') await parent.mutateAsync({ data: { displayName: displayName.trim(), familyName: familyName.trim() } });
      if (mode === 'child') await child.mutateAsync({ data: { displayName: displayName.trim(), invitationCode: code.trim() } });
      if (mode === 'staff') await staff.mutateAsync({ data: { displayName: displayName.trim(), invitationCode: code.trim() } });
      if (mode === 'manager') await manager.mutateAsync();
      await client.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() });
      await client.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() });
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return <div className="setup-screen"><div className="setup-brand"><Link href="/" className="brand"><img src={pathpalMark} alt="" />PathPal</Link><span>ACCOUNT SETUP</span></div>
    <div className="setup-wrap"><div className="setup-intro"><span className="eyebrow"><span />YOUR ACCOUNT, YOUR ACCESS</span><h1>Let’s set up<br />your <em>PathPal.</em></h1><p>Choose how you’ll use PathPal. Your role is confirmed by the server after setup.</p></div>
      <div className="setup-card"><div className="setup-tabs" role="tablist" aria-label="Account type">
        {(['parent', 'child', 'staff', 'manager'] as const).map((item) => <button key={item} className={mode === item ? 'selected' : ''} role="tab" aria-selected={mode === item} onClick={() => { setMode(item); setError(''); }} data-testid={`tab-setup-${item}`}>{item === 'parent' ? 'Parent' : item === 'child' ? 'Join family' : item === 'staff' ? 'Staff invite' : 'Initial manager'}</button>)}
      </div>
      <form className="stack-form" onSubmit={submit}>
        {mode !== 'manager' && <label className="field"><span>YOUR DISPLAY NAME</span><input value={displayName} onChange={e => setDisplayName(e.target.value)} minLength={1} maxLength={80} required autoComplete="name" data-testid="input-display-name" /></label>}
        {mode === 'parent' && <label className="field"><span>FAMILY NAME</span><input value={familyName} onChange={e => setFamilyName(e.target.value)} maxLength={100} required placeholder="For example, the Garcia family" data-testid="input-family-name" /></label>}
        {mode === 'child' && <label className="field"><span>FAMILY CODE</span><input value={code} onChange={e => setCode(e.target.value)} minLength={6} maxLength={24} required autoCapitalize="characters" placeholder="Enter the code from your parent" data-testid="input-family-code" /></label>}
        {mode === 'staff' && <label className="field"><span>STAFF INVITATION CODE</span><input value={code} onChange={e => setCode(e.target.value)} minLength={12} maxLength={80} required data-testid="input-staff-code" /></label>}
        {mode === 'manager' && <div className="maintainer-note"><ShieldCheck size={18} /><p>This action is available only to the maintainer-configured Clerk account. The server confirms eligibility before creating a manager account.</p></div>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <button className="button button-primary full-button" disabled={busy} type="submit" data-testid="button-complete-setup">{busy ? 'Setting up…' : mode === 'parent' ? 'Create family account' : mode === 'child' ? 'Request to join family' : mode === 'staff' ? 'Accept staff invitation' : 'Check manager eligibility'}<ArrowRight size={16} /></button>
      </form>
      <div className="setup-privacy"><ShieldCheck size={16} />Access is assigned by PathPal and confirmed by the server.</div></div>
    </div>
  </div>;
}

function AccessPending({ rejected = false }: { rejected?: boolean }) {
  const { signOut } = useClerk();
  const client = useQueryClient();
  async function logout() { client.clear(); await signOut({ redirectUrl: `${basePath}/` || '/' }); }
  return <div className="privacy-state"><Link href="/" className="brand setup-inline-brand"><img src={pathpalMark} alt="" />PathPal</Link><div className="privacy-seal"><Clock3 size={27} /></div><span className="eyebrow"><span />FAMILY ACCESS</span>
    <h1>{rejected ? 'This request wasn’t approved.' : 'Your request is being reviewed.'}</h1>
    <p>{rejected ? 'A parent or guardian did not approve this request. If you believe this is a mistake, ask them to invite you again.' : 'A parent or guardian needs to approve your request before you can access the family workspace.'}</p>
    {!rejected && <div className="review-note">Until approval, family names, members, reports, maps, and photos stay hidden.</div>}
    <button className="button button-subtle privacy-signout" onClick={() => void logout()} data-testid="button-sign-out-pending">Sign out <LogOut size={15} /></button>
  </div>;
}

function Shell({ account, children }: { account: AccountStatus; children: React.ReactNode }) {
  const { signOut } = useClerk();
  const client = useQueryClient();
  const [location] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const isStaff = account.status === 'manager' || account.status === 'worker';
  const nav = [
    { href: '/', label: isStaff ? 'Case workspace' : 'Family home', Icon: House },
    { href: '/reports', label: isStaff ? 'Case queue' : 'Report history', Icon: FileText },
    { href: countyMapPath, label: isStaff ? 'Case map' : 'Neighborhood map', Icon: Map },
    ...(!isStaff ? [{ href: '/report/new', label: 'New report', Icon: MapPin }] : []),
    ...(!isStaff ? [{ href: '/family', label: 'Family', Icon: Users }] : []),
    { href: '/notifications', label: 'Notifications', Icon: Bell },
    { href: '/profile', label: 'Account', Icon: CircleUserRound },
  ];
  async function logout() { client.clear(); await signOut({ redirectUrl: `${basePath}/` || '/' }); }
  useEffect(() => setMobileNav(false), [location]);
  return <div className="app-layout"><aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
    <Link href="/" className="brand sidebar-brand"><img src={pathpalMark} alt="" />PathPal</Link>
    <div className="sidebar-heading">YOUR WORKSPACE</div><nav className="sidebar-nav">{nav.map(({ href, label, Icon }) => <Link key={href} href={href} className={`nav-item ${location === href || (href === '/reports' && location.startsWith('/reports/')) ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={18} />{label}</Link>)}</nav>
    <div className="sidebar-spacer" /><div className="sidebar-safety"><ShieldCheck size={18} /><span><strong>Not for emergencies</strong><small>Call 911 if someone is in immediate danger.</small></span></div>
    <div className="account-chip"><span className="avatar">{account.displayName.slice(0, 1).toUpperCase()}</span><span className="account-chip-copy"><strong>{account.displayName}</strong><small>{account.status === 'parent' ? 'Parent' : account.status === 'child_approved' ? 'Family member' : account.status === 'manager' ? 'City manager' : 'Field team'}{account.teamName ? ` · ${account.teamName}` : ''}</small></span><button className="icon-button" onClick={() => void logout()} aria-label="Sign out" title="Sign out" data-testid="button-sign-out"><LogOut size={17} /></button></div>
  </aside>{mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
  <div className="main-column"><header className="topbar"><button className="mobile-toggle" aria-label="Open menu" onClick={() => setMobileNav(true)} data-testid="button-open-menu"><Menu size={21} /></button><div className="county-label"><span className="live-dot" />SANTA CLARA COUNTY <b>/</b> {isStaff ? 'CITY SERVICES' : 'FAMILY SAFETY'}</div><div className="topbar-right"><span className="topbar-date">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span><Link href="/notifications" className="topbar-bell" aria-label="Notifications" data-testid="link-notifications-top"><Bell size={17} /></Link></div></header>
    <main className="main-content">{children}</main><footer className="app-footer"><span>PATHPAL / COMMUNITY WORKSPACE</span><span>Clear access. Neighborly follow-through.</span></footer>
  </div></div>;
}

function FamilyWorkspace({ account }: { account: AccountStatus }) {
  const client = useQueryClient();
  const { data: family, isLoading, error, refetch } = useGetMyFamily({ query: { queryKey: getGetMyFamilyQueryKey() } });
  const approve = useApproveFamilyJoinRequest();
  const reject = useRejectFamilyJoinRequest();
  const [actionError, setActionError] = useState('');
  const isParent = account.status === 'parent';
  async function decide(id: number, action: 'approve' | 'reject') {
    setActionError('');
    try {
      if (action === 'approve') await approve.mutateAsync({ id }); else await reject.mutateAsync({ id });
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() }),
        client.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() }),
        client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
      ]);
    } catch (err) { setActionError(errorText(err)); }
  }
  return <>
    <Header marker="FAMILY / PRIVATE SPACE" title={isParent ? 'Your family, together.' : 'A closer circle of care.'} description={isParent ? 'Manage who is connected to your family and review requests to join.' : 'Your family’s approved members and neighborhood reports are in one place.'} />
    {isLoading ? <LoadingPanel /> : error ? <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /> : family ? <FamilyContent account={account} family={family} isParent={isParent} onDecision={decide} pending={approve.isPending || reject.isPending} actionError={actionError} /> : <ErrorNotice message="Family information is not available right now." />}
  </>;
}
function FamilyContent({ account, family, isParent, onDecision, pending, actionError }: { account: AccountStatus; family: FamilyView; isParent: boolean; onDecision: (id: number, action: 'approve' | 'reject') => void; pending: boolean; actionError: string }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    if (!family.invitationCode) return;
    try { await navigator.clipboard.writeText(family.invitationCode); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  }
  return <div className="family-layout">
    <section className="family-hero"><div><span className="micro-label">YOUR FAMILY SPACE</span><h2>{family.familyName}</h2><p>Visible only to this family’s approved members.</p></div><div className="family-count"><strong>{family.members.length.toString().padStart(2, '0')}</strong><span>APPROVED<br />MEMBERS</span></div></section>
    {isParent && family.invitationCode && <section className="invite-code-card"><div><span className="eyebrow"><span />FAMILY INVITATION</span><h3>Invite a child to join</h3><p>Share this private code with your child. Their reports remain private until approved.</p></div><button className="code-copy" onClick={() => void copyCode()} data-testid="button-copy-family-code"><code>{family.invitationCode}</code><span>{copied ? <><Check size={15} /> COPIED</> : <><Clipboard size={15} /> COPY CODE</>}</span></button></section>}
    <section className="content-section"><div className="section-heading"><div><span className="eyebrow"><span />FAMILY ROSTER</span><h2>People in this space</h2></div></div>
      <div className="member-list">{family.members.filter(member => member.status === 'approved').map(member => <div className="member-row" key={member.membershipId}><span className="avatar member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{member.displayName}{member.displayName === account.displayName ? ' · You' : ''}</strong><small>{member.role === 'parent' ? 'Parent / guardian' : 'Child'} · Joined {shortDate(member.approvedAt || member.requestedAt)}</small></div><span className="member-access">APPROVED</span></div>)}
        {!family.members.some(member => member.status === 'approved') && <EmptyPanel title="No approved members yet">Once a family member is approved, they’ll appear here.</EmptyPanel>}</div>
    </section>
    {isParent && <section className="content-section"><div className="section-heading"><div><span className="eyebrow"><span />NEEDS YOUR REVIEW</span><h2>Join requests <span className="count-pill">{family.pendingRequests.length}</span></h2></div></div>
      {actionError && <div className="inline-error">{actionError}</div>}
      <div className="member-list">{family.pendingRequests.map(request => <div className="request-row" key={request.membershipId}><span className="avatar member-avatar">{request.displayName.slice(0, 1).toUpperCase()}</span><div className="request-copy"><strong>{request.displayName}</strong><small>Requested to join · {dateText(request.requestedAt)}</small></div><div className="request-actions"><button className="button button-subtle" disabled={pending} onClick={() => onDecision(request.membershipId, 'reject')} data-testid={`button-reject-${request.membershipId}`}>Decline</button><button className="button button-primary" disabled={pending} onClick={() => onDecision(request.membershipId, 'approve')} data-testid={`button-approve-${request.membershipId}`}><Check size={15} /> Approve</button></div></div>)}
        {!family.pendingRequests.length && <EmptyPanel title="No requests to review">New family join requests will appear here.</EmptyPanel>}</div>
    </section>}
  </div>;
}

function FamilyHome({ account }: { account: AccountStatus }) {
  const { data: reports, isLoading, error, refetch } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const { data: family } = useGetMyFamily({ query: { queryKey: getGetMyFamilyQueryKey() } });
  const owned = reports ?? [];
  return <>
    <Header marker="FAMILY / HOME" title={`Looking out for ${family?.familyName || 'your family'}.`} description="A private view of the concerns and updates shared within your family." action={<HeadingAction href="/report/new">Share a concern</HeadingAction>} />
    <div className="welcome-strip"><div><span className="micro-label">YOUR FAMILY WORKSPACE</span><h2>Notice something along the way?</h2><p>Share a neighborhood concern and see each update in context.</p><Link className="light-link" href="/report/new">Create a report <ArrowRight size={16} /></Link></div><div className="strip-mark"><MapPin size={43} strokeWidth={1.25} /></div></div>
    <div className="stat-row"><div className="stat-block"><span>REPORTS IN YOUR FAMILY</span><strong>{isLoading ? '—' : owned.length.toString().padStart(2, '0')}</strong></div><div className="stat-block"><span>BEING WORKED ON</span><strong>{isLoading ? '—' : owned.filter(item => item.status !== 'Resolved').length.toString().padStart(2, '0')}</strong></div><div className="stat-block stat-context"><span>ACCESS</span><strong>{account.status === 'parent' ? 'Parent + children' : 'Approved family member'}</strong></div></div>
    <section className="content-section"><div className="section-heading"><div><span className="eyebrow"><span />LATEST FROM YOUR FAMILY</span><h2>Report trail</h2></div><Link href="/reports" className="text-button">All reports <ArrowUpRight size={15} /></Link></div>
      <div className="report-list">{isLoading ? <LoadingPanel /> : error ? <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /> : owned.length ? owned.slice(0, 4).map(report => <ReportCard key={report.id} report={report} />) : <EmptyPanel title="No reports yet">When your family shares a concern, its progress will appear here.</EmptyPanel>}</div>
    </section>
  </>;
}

function StaffHome({ account }: { account: AccountStatus }) {
  const { data: reports, isLoading, error, refetch } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const [inviteRole, setInviteRole] = useState<'worker' | 'manager'>('worker');
  const [teamName, setTeamName] = useState('');
  const [invitation, setInvitation] = useState<StaffInvitation | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);
  const createInvite = useCreateStaffInvitation();
  const list = reports ?? [];
  const isManager = account.status === 'manager';
  async function invite(event: FormEvent) {
    event.preventDefault(); setInviteError('');
    try {
      const result = await createInvite.mutateAsync({ data: { role: inviteRole, ...(inviteRole === 'worker' && teamName.trim() ? { teamName: teamName.trim() } : {}) } });
      setInvitation(result); setCopied(false);
    } catch (err) { setInviteError(errorText(err)); }
  }
  async function copyInvite() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.invitationCode); setCopied(true); } catch { setInviteError('Clipboard access is unavailable. Select and copy the code instead.'); }
  }
  return <>
    <Header marker={`${isManager ? 'CITY DESK' : 'FIELD TEAM'} / CASES`} title={isManager ? 'The city, in clearer focus.' : 'Your team’s work, in one view.'} description={isManager ? 'Triage neighborhood reports and coordinate the next step across Santa Clara County.' : `${account.teamName || 'Assigned team'} · View assigned cases and update their status from the field.`} action={isManager ? <HeadingAction href="/reports">Open case queue</HeadingAction> : undefined} />
    <div className="staff-overview"><div className="staff-lead"><span className="micro-label">CASE COORDINATION</span><h2>{isManager ? 'Every report deserves a clear next step.' : 'Small updates keep the whole response moving.'}</h2><p>{isManager ? 'Review incoming concerns, assign teams, and keep a complete record of follow-through.' : 'Your workspace shows only cases assigned to your team. Status is the only field you can change.'}</p></div><div className="staff-metrics"><span>VISIBLE CASES</span><strong>{isLoading ? '—' : list.length.toString().padStart(2, '0')}</strong><small>{isManager ? 'City-wide case queue' : 'Assigned to your team'}</small><div className="metric-divider" /><span>IN PROGRESS</span><b>{isLoading ? '—' : list.filter(item => item.status !== 'Resolved').length}</b></div></div>
    {isManager && <section className="invite-staff-card"><div><span className="eyebrow"><span />ACCESS CONTROL</span><h2>Invite a staff member</h2><p>Each invitation is single-use and tied to its assigned PathPal role.</p>{invitation && <div className="issued-invite"><span>{invitation.role === 'worker' ? 'FIELD WORKER' : 'CITY MANAGER'}{invitation.teamName ? ` · ${invitation.teamName}` : ''}</span><code>{invitation.invitationCode}</code><small>Expires {dateText(invitation.expiresAt)}</small></div>}</div>
      <form className="invite-form" onSubmit={invite}><label className="field"><span>INVITATION ROLE</span><span className="select-wrap"><select value={inviteRole} onChange={e => { setInviteRole(e.target.value as 'worker' | 'manager'); setInvitation(null); }}><option value="worker">Field worker</option><option value="manager">City manager</option></select><ChevronDown size={16} /></span></label>
        {inviteRole === 'worker' && <label className="field"><span>TEAM NAME</span><input value={teamName} maxLength={120} onChange={e => setTeamName(e.target.value)} placeholder="Street response team" /></label>}
        {inviteError && <div className="inline-error">{inviteError}</div>}
        <button className="button button-primary" disabled={createInvite.isPending} type="submit">{createInvite.isPending ? 'Creating…' : invitation ? 'Create another invitation' : 'Create invitation'}<Plus size={16} /></button>
        {invitation && <button className="button button-subtle" type="button" onClick={() => void copyInvite()}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? 'Copied code' : 'Copy invitation code'}</button>}
      </form>
    </section>}
    <section className="content-section"><div className="section-heading"><div><span className="eyebrow"><span />{isManager ? 'CITY CASES' : `TEAM QUEUE · ${account.teamName || 'ASSIGNED'}`}</span><h2>{isManager ? 'Latest reports' : 'Assigned cases'}</h2></div><Link href="/reports" className="text-button">Full queue <ArrowUpRight size={15} /></Link></div>
      <div className="report-list">{isLoading ? <LoadingPanel /> : error ? <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /> : list.length ? list.slice(0, 5).map(report => <ReportCard key={report.id} report={report} />) : <EmptyPanel title="No cases in this view">New cases will appear here when they are assigned to your access scope.</EmptyPanel>}</div>
    </section>
  </>;
}

function ReportsPage({ account }: { account: AccountStatus }) {
  const { data, isLoading, error, refetch, isFetching } = useListReports({ query: { queryKey: getListReportsQueryKey(), refetchOnMount: 'always' } });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const isStaff = account.status === 'manager' || account.status === 'worker';
  const filtered = (data ?? []).filter(report => (filter === 'All statuses' || report.status === filter) && `${report.id} ${report.summary} ${report.description} ${report.location} ${report.category}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <Header marker={isStaff ? 'CITY SERVICES / CASE QUEUE' : 'FAMILY / REPORTS'} title={isStaff ? 'Cases needing follow-through.' : 'Your family’s report history.'} description={isStaff ? 'Review only the cases your role is authorized to access.' : 'Updates from concerns shared by approved members of your family.'} action={!isStaff ? <HeadingAction href="/report/new">New report</HeadingAction> : undefined} />
    <div className="list-toolbar"><label className="search-box"><MapPin size={17} /><input placeholder="Search case, concern, or area" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-reports" /></label><label className="filter-box"><span className="sr-only">Filter by status</span><select value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-report-status"><option>All statuses</option>{statuses.map(status => <option key={status}>{status}</option>)}</select><ChevronDown size={15} /></label><button className="icon-button toolbar-refresh" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh reports" data-testid="button-refresh-reports"><RefreshCw size={17} /></button></div>
    <div className="list-summary"><span>{isLoading ? 'Loading cases' : `${filtered.length} ${filtered.length === 1 ? 'case' : 'cases'}`}</span><span>{isStaff ? 'AUTHORIZED CASES ONLY' : 'APPROVED FAMILY REPORTS ONLY'}</span></div>
    <div className="report-list">{isLoading ? <LoadingPanel /> : error ? <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /> : filtered.length ? filtered.map(report => <ReportCard key={report.id} report={report} />) : <EmptyPanel title={data?.length ? 'No matching reports' : 'No reports in this view'}>{data?.length ? 'Try a different search or status.' : 'When an eligible report is submitted, it will appear here.'}</EmptyPanel>}</div>
  </>;
}

function MapPage({ account }: { account: AccountStatus }) {
  const { data, isLoading, error, refetch } = useGetReportMapData({ query: { queryKey: getGetReportMapDataQueryKey() } });
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all');
  const markers = (data?.markers ?? []).filter(marker => filter === 'all' || (filter === 'resolved' ? marker.status === 'Resolved' : marker.status !== 'Resolved'));
  const isStaff = account.status === 'manager' || account.status === 'worker';
  return <>
    <Header marker={isStaff ? 'CITY SERVICES / MAP' : 'FAMILY / MAP'} title={isStaff ? 'Cases across your service area.' : 'Your family’s neighborhood view.'} description="Individual markers are shown only when your account is authorized to view the report. Public heat is aggregated and anonymous." />
    <section className="map-card"><div className="map-toolbar"><div><span className="eyebrow"><span />AUTHORIZED CASE MAP</span><strong>{isLoading ? 'Loading map data' : `${markers.length} authorized ${markers.length === 1 ? 'marker' : 'markers'}`}</strong></div><div className="map-filters" role="group" aria-label="Map marker filters">{(['all', 'active', 'resolved'] as const).map(item => <button className={filter === item ? 'selected' : ''} key={item} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item === 'active' ? 'In progress' : 'Resolved'}</button>)}</div></div>
      {isLoading ? <LoadingPanel label="Loading authorized map data" /> : error ? <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /> : <NeighborhoodMap data={data} markers={markers} />}
      <div className="map-legend"><span><i className="legend-case" />Authorized case</span><span><i className="legend-heat" />Anonymous public density</span><span>Approximate area map · not for navigation</span></div>
    </section>
    {!isStaff && <p className="privacy-caption"><ShieldCheck size={15} />Family access is kept separate from city-wide public density. No other family’s case markers are shown.</p>}
  </>;
}
function NeighborhoodMap({ data, markers }: { data: ReportMapData | undefined; markers: ReportMapData['markers'] }) {
  const heat = data?.publicHeat ?? [];
  return <div className="neighborhood-map" aria-label="Schematic Santa Clara County report map">
    <svg className="street-drawing" viewBox="0 0 900 480" preserveAspectRatio="none" aria-hidden="true">
      <path className="water-shape" d="M0 0h138l25 50-29 49 14 50-42 26L0 148z" />
      <path className="park-shape" d="M580 0h320v105l-80 37-61-20-56 41-92-39-55-79zM645 344l91-36 164 55v117H652l-58-75z" />
      <path className="major-road" d="M15 332c172-50 269-11 421-79s293-90 464-164M230 0c10 98 54 129 89 214s37 164 96 266M0 176c165 44 285 26 425-20s300-30 475 13" />
      <path className="minor-road" d="M0 418c134-46 266-36 385-71s326-17 515 27M74 0c70 91 32 197 82 480M422 0c-23 94 28 183 44 480M720 0c-46 133-62 251-76 480M0 267c141-30 255 1 385-42s301-29 515-2" />
    </svg>
    <span className="place-label place-santa">SANTA CLARA</span><span className="place-label place-japan">JAPANTOWN</span><span className="place-label place-downtown">DOWNTOWN SAN JOSE</span><span className="place-label place-willow">WILLOW GLEN</span><span className="place-label place-east">EAST SAN JOSE</span><span className="place-label place-alum">ALUM ROCK</span>
    {heat.map((cell, index) => <span key={`heat-${index}`} className="heat-cell" style={{ left: `${((cell.longitude - mapBounds.west) / (mapBounds.east - mapBounds.west)) * 100}%`, top: `${((mapBounds.north - cell.latitude) / (mapBounds.north - mapBounds.south)) * 100}%`, opacity: 0.15 + cell.intensity * 0.48, transform: `translate(-50%,-50%) scale(${0.75 + cell.intensity})` }} />)}
    {markers.map(marker => <Link key={marker.id} className={`case-pin pin-${marker.status.toLowerCase().replaceAll(' ', '-')}`} href={`/reports/${marker.id}`} title={`${marker.status} report`} style={{ left: `${((marker.longitude - mapBounds.west) / (mapBounds.east - mapBounds.west)) * 100}%`, top: `${((mapBounds.north - marker.latitude) / (mapBounds.north - mapBounds.south)) * 100}%` }}><MapPin size={22} fill="currentColor" /></Link>)}
    <div className="map-scale-note">SANTA CLARA COUNTY · APPROXIMATE VIEW</div>
  </div>;
}

function NewReport() {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const create = useCreateReport();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<CommunityReportInput['location']>('Santa Clara');
  const [category, setCategory] = useState('');
  const [latitude, setLatitude] = useState('37.3541');
  const [longitude, setLongitude] = useState('-121.9552');
  const [photo, setPhoto] = useState<{ name: string; data: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; preview: string } | null>(null);
  const [error, setError] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const pinLat = Number(latitude), pinLng = Number(longitude);
  const pinVisible = Number.isFinite(pinLat) && pinLat >= mapBounds.south && pinLat <= mapBounds.north && Number.isFinite(pinLng) && pinLng >= mapBounds.west && pinLng <= mapBounds.east;
  const pinStyle = pinVisible ? { left: `${((pinLng - mapBounds.west) / (mapBounds.east - mapBounds.west)) * 100}%`, top: `${((mapBounds.north - pinLat) / (mapBounds.north - mapBounds.south)) * 100}%` } : undefined;
  function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const lat = Number(latitude), lng = Number(longitude);
    if (description.trim().length < 12) { setError('Please add at least 12 characters so the city team can understand the concern.'); return; }
    if (!Number.isFinite(lat) || lat < 37 || lat > 37.6 || !Number.isFinite(lng) || lng < -122.2 || lng > -121.6) { setError('Use coordinates within Santa Clara County.'); return; }
    create.mutate({ data: { description: description.trim(), location, latitude: lat, longitude: lng, ...(category ? { category: category as CommunityReportInput['category'] } : {}), ...(photo ? { photoBase64: photo.data, contentType: photo.type } : {}) } }, {
      onSuccess: async report => {
        await Promise.all([
          client.invalidateQueries({ queryKey: getListReportsQueryKey() }),
          client.invalidateQueries({ queryKey: getGetReportMapDataQueryKey() }),
        ]);
        navigate(`/reports/${report.id}`);
      },
      onError: err => setError(errorText(err)),
    });
  }
  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPEG, PNG, or WebP image.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('Choose an image smaller than 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { const result = String(reader.result); setPhoto({ name: file.name, data: result.split(',')[1], type: file.type as 'image/jpeg' | 'image/png' | 'image/webp', preview: result }); setError(''); };
    reader.onerror = () => setError('This image could not be read. Choose another file.');
    reader.readAsDataURL(file);
  }
  function updatePlace(next: CommunityReportInput['location']) {
    setLocation(next);
    const point = neighborhoodCoords[next || 'Santa Clara']; setLatitude(point[0].toFixed(6)); setLongitude(point[1].toFixed(6));
  }
  function placePin(lat: number, lng: number) {
    setLatitude(lat.toFixed(6)); setLongitude(lng.toFixed(6));
    const nearest = neighborhoods.reduce((best, item) => {
      const point = neighborhoodCoords[item];
      const current = neighborhoodCoords[best];
      return (point[0] - lat) ** 2 + (point[1] - lng) ** 2 < (current[0] - lat) ** 2 + (current[1] - lng) ** 2 ? item : best;
    }, neighborhoods[0]);
    setLocation(nearest);
  }
  function clickPinMap(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    placePin(mapBounds.north - y * (mapBounds.north - mapBounds.south), mapBounds.west + x * (mapBounds.east - mapBounds.west));
  }
  function keyPinMap(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      placePin(pinVisible ? pinLat : 37.3352, pinVisible ? pinLng : -121.8906);
    }
  }
  function useMyLocation() {
    if (!navigator.geolocation) { setError('Location access is not available in this browser. Enter coordinates instead.'); return; }
    setGeoBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(position => {
      placePin(position.coords.latitude, position.coords.longitude); setGeoBusy(false);
    }, () => {
      setError('Location access was unavailable. You can place the pin on the map or enter coordinates.'); setGeoBusy(false);
    }, { timeout: 10000 });
  }
  return <>
    <Link className="back-link" href="/reports"><ArrowLeft size={16} /> Report history</Link>
    <Header marker="REPORTS / NEW CONCERN" title="Tell us what you noticed." description="A few specific details help your neighbors and city teams decide where to begin." />
    <div className="form-layout"><form className="form-card" onSubmit={submit}>
      <div className="form-section-heading"><span>01</span><div><h2>The concern</h2><p>Describe what happened in your own words.</p></div></div>
      <label className="field"><span>WHAT IS HAPPENING?</span><textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} maxLength={4000} required placeholder="For example: The sidewalk is lifted near the bus stop, making it difficult to pass with a stroller…" data-testid="input-report-description" /><small>{description.length} / 4,000 characters</small></label>
      <div className="form-rule" /><div className="form-section-heading"><span>02</span><div><h2>Where it is</h2><p>Choose a neighborhood and enter the closest location pin.</p></div></div>
      <div className="field-pair"><label className="field"><span>NEIGHBORHOOD</span><span className="select-wrap"><select value={location} onChange={e => updatePlace(e.target.value as CommunityReportInput['location'])}>{neighborhoods.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></span></label><label className="field"><span>ISSUE TYPE <em>OPTIONAL</em></span><span className="select-wrap"><select value={category} onChange={e => setCategory(e.target.value)}><option value="">Let PathPal suggest</option>{categories.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></span></label></div>
      <div className="picker-map-heading"><strong><MapPin size={15} /> Place the report pin</strong><button type="button" className="text-button" onClick={useMyLocation} disabled={geoBusy}>{geoBusy ? 'Locating…' : 'Use my location'}</button></div>
      <div className="form-map" role="button" tabIndex={0} onClick={clickPinMap} onKeyDown={keyPinMap} aria-label={`Approximate Santa Clara County map. ${pinVisible ? `Pin at ${pinLat.toFixed(6)}, ${pinLng.toFixed(6)}.` : 'Pin outside the displayed view.'} Click to place a pin.`} data-testid="map-place-report-pin">
        <svg viewBox="0 0 900 300" preserveAspectRatio="none" aria-hidden="true"><path className="water-shape" d="M0 0h138l25 50-29 49 14 50-42 26L0 148z" /><path className="park-shape" d="M580 0h320v105l-80 37-61-20-56 41-92-39-55-79zM645 220l91-36 164 55v61H652l-58-45z" /><path className="major-road" d="M15 232c172-50 269-11 421-79s293-70 464-124M230 0c10 75 54 99 89 154s37 95 96 146M0 126c165 44 285 26 425-20s300-30 475 13" /><path className="minor-road" d="M0 264c134-46 266-26 385-61s326-7 515 27M422 0c-23 74 28 123 44 300M720 0c-46 93-62 171-76 300" /></svg>
        <span className="form-map-label" style={{ left: '9%', top: '20%' }}>SANTA CLARA</span><span className="form-map-label" style={{ left: '39%', top: '30%' }}>JAPANTOWN</span><span className="form-map-label" style={{ left: '31%', top: '62%' }}>DOWNTOWN</span><span className="form-map-label" style={{ left: '70%', top: '70%' }}>EAST SAN JOSE</span>
        {pinStyle && <span className="form-map-pin" style={pinStyle}><MapPin size={26} fill="currentColor" /></span>}<span className="form-map-caption">APPROXIMATE MAP · NOT TO SCALE</span>
      </div>
      <div className="coordinates-readout"><span />{pinVisible ? `${pinLat.toFixed(6)}, ${pinLng.toFixed(6)}` : 'Pin outside county map — enter valid coordinates below.'}</div>
      <div className="field-pair coordinates"><label className="field"><span>LATITUDE</span><input type="number" step="any" value={latitude} onChange={e => setLatitude(e.target.value)} required /></label><label className="field"><span>LONGITUDE</span><input type="number" step="any" value={longitude} onChange={e => setLongitude(e.target.value)} required /></label></div>
      <div className="form-rule" /><div className="form-section-heading"><span>03</span><div><h2>Add a photo</h2><p>Optional. Avoid including faces or identifying details.</p></div></div>
      <label className="photo-picker">{photo ? <><img src={photo.preview} alt="Selected report preview" /><strong>{photo.name}</strong></> : <><MapPin size={23} /><strong>Choose a photo</strong><span>JPEG, PNG, or WebP · up to 2 MB</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} /></label>
      {photo && <button type="button" className="text-button remove-photo" onClick={() => setPhoto(null)}><X size={14} /> Remove photo</button>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="form-actions"><span>Your report is shared with your permitted PathPal audience.</span><button className="button button-primary" disabled={create.isPending}>{create.isPending ? 'Sending report…' : 'Submit report'}<ArrowRight size={16} /></button></div>
    </form><aside className="aside-card"><span className="eyebrow"><span />WHAT HAPPENS NEXT</span><h2>Clear steps, kept together.</h2><div className="steps-list"><div><i>1</i><p><strong>Your report is recorded</strong><small>Its location and details stay connected to your account.</small></p></div><div><i>2</i><p><strong>A team reviews it</strong><small>City staff can categorize and assign a next step.</small></p></div><div><i>3</i><p><strong>You can follow progress</strong><small>Authorized members see updates in report history.</small></p></div></div><div className="emergency-note"><ShieldCheck size={18} /><span>This service is not an emergency channel. Call 911 for immediate danger.</span></div></aside></div>
  </>;
}

function ReportPhoto({ reportId, alt }: { reportId: string; alt: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    getReportPhoto(reportId).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [reportId]);
  if (failed) return <div className="photo-unavailable">The attached photo is no longer available.</div>;
  if (!url) return <div className="photo-loading"><div className="skeleton" /></div>;
  return <img src={url} alt={alt} />;
}

function ReportDetail({ account }: { account: AccountStatus }) {
  const params = useParams<{ id: string }>();
  const id = params.id || '';
  const client = useQueryClient();
  const { data: report, isLoading, error, refetch } = useGetReport(id, { query: { enabled: !!id, queryKey: getGetReportQueryKey(id) } });
  const update = useUpdateReport();
  const isManager = account.status === 'manager';
  const isWorker = account.status === 'worker';
  const [status, setStatus] = useState<ReportStatus | ''>('');
  const [team, setTeam] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => { if (report) { setStatus(report.status); setTeam(report.assignedTeam || ''); setNotes(report.managerNotes || ''); } }, [report?.id]);
  async function save(data: Parameters<typeof update.mutateAsync>[0]['data']) {
    setActionError(''); setMessage('');
    try {
      await update.mutateAsync({ id, data });
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetReportQueryKey(id) }),
        client.invalidateQueries({ queryKey: getListReportsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetReportMapDataQueryKey() }),
      ]);
      setMessage('Case update saved.');
    } catch (err) { setActionError(errorText(err)); }
  }
  if (isLoading) return <LoadingPanel label="Loading case details" />;
  if (error) return <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} />;
  if (!report) return <EmptyPanel title="This report is unavailable">It may have moved out of your access scope.</EmptyPanel>;
  return <>
    <Link href="/reports" className="back-link"><ArrowLeft size={16} /> Back to reports</Link>
    <div className="detail-heading"><div><span className="eyebrow"><span />CASE {report.id} · {report.location.toUpperCase()}</span><h1>{report.summary}</h1><div className="detail-meta"><StatusTag status={report.status} /><span>Submitted {dateText(report.submittedAt)}</span><span>{report.category}</span></div></div></div>
    <div className="detail-layout"><div className="detail-main">
      <section className="detail-card"><span className="eyebrow"><span />REPORT DETAILS</span><h2>What was noticed</h2><p className="detail-description">{report.description}</p><div className="detail-facts"><div><span>SELECTED CATEGORY</span><strong>{report.selectedCategory || 'Not selected'}</strong></div><div><span>PRIORITY</span><strong>{report.priority}</strong></div><div><span>SEVERITY</span><strong>{report.severity} / 10</strong></div><div><span>RECOMMENDED DEPARTMENT</span><strong>{report.recommendedDepartment}</strong></div><div><span>LOCATION</span><strong>{report.location}</strong></div><div><span>COORDINATES</span><strong>{report.latitude?.toFixed(6) ?? 'Not available'}{report.longitude != null ? `, ${report.longitude.toFixed(6)}` : ''}</strong></div></div>
        {report.photoUri && <div className="detail-photo"><ReportPhoto reportId={id} alt="Photo attached to this report" /></div>}
      </section>
      <section className="detail-card"><span className="eyebrow"><span />STATUS HISTORY</span><h2>Case timeline</h2><div className="timeline">{report.statusHistory?.length ? report.statusHistory.map((event, index) => <div className="timeline-entry" key={`${event.changedAt}-${index}`}><i /><div><strong>{event.toStatus}</strong><span>{dateText(event.changedAt)}</span><small>Updated by {event.changedBy}</small></div></div>) : <p className="quiet-copy">No status updates have been recorded yet.</p>}</div></section>
    </div><aside className="detail-aside">
      <section className="detail-card case-assignment"><span className="eyebrow"><span />FOLLOW-THROUGH</span><h2>Current response</h2><div className="assignment-fact"><span>ASSIGNED TEAM</span><strong>{report.assignedTeam || 'Not assigned yet'}</strong></div><div className="assignment-fact"><span>ROUTE / SERVICE AREA</span><strong>{report.routeAssignment || 'Not specified'}</strong></div><div className="assignment-fact"><span>LAST UPDATED</span><strong>{dateText(report.updatedAt)}</strong></div>{report.managerNotes && <div className="manager-note"><span>STAFF UPDATE</span><p>{report.managerNotes}</p></div>}</section>
      {(isManager || isWorker) && <section className="detail-card case-edit"><span className="eyebrow"><span />{isManager ? 'MANAGER CONTROLS' : 'TEAM UPDATE'}</span><h2>{isManager ? 'Update case' : 'Update status'}</h2>
        {isManager ? <><label className="field"><span>STATUS</span><span className="select-wrap"><select value={status} onChange={e => setStatus(e.target.value as ReportStatus)}>{statuses.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></span></label><label className="field"><span>ASSIGNED TEAM</span><input value={team} maxLength={120} onChange={e => setTeam(e.target.value)} placeholder="Assign a response team" /></label><label className="field"><span>CASE UPDATE</span><textarea rows={3} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add a clear, helpful update" /></label><button className="button button-primary full-button" disabled={update.isPending} onClick={() => void save({ status: status || report.status, assignedTeam: team.trim() || null, managerNotes: notes.trim() || null })}>{update.isPending ? 'Saving…' : 'Save case update'}<Check size={15} /></button></> :
          <><p className="quiet-copy">Your team can change case status only. Report details and assignments are managed by a city manager.</p><label className="field"><span>CASE STATUS</span><span className="select-wrap"><select value={status} onChange={e => setStatus(e.target.value as ReportStatus)}>{statuses.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></span></label><button className="button button-primary full-button" disabled={update.isPending || status === report.status} onClick={() => void save({ status: status || report.status })}>{update.isPending ? 'Saving…' : 'Save status'}<Check size={15} /></button></>}
        {message && <div className="inline-success">{message}</div>}{actionError && <div className="inline-error">{actionError}</div>}
      </section>}
    </aside></div>
  </>;
}

function NotificationsPage() {
  const client = useQueryClient();
  const { data, isLoading, error, refetch } = useListNotifications({ query: { queryKey: getListNotificationsQueryKey(), refetchOnMount: 'always' } });
  const mark = useMarkNotificationRead();
  const [actionError, setActionError] = useState('');
  const notifications: PathPalNotification[] = data ?? [];
  async function markRead(id: number) {
    setActionError('');
    try { await mark.mutateAsync({ id }); await client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); }
    catch (err) { setActionError(errorText(err)); }
  }
  return <>
    <Header marker="ACCOUNT / NOTIFICATIONS" title="Updates worth knowing." description="Messages related to your family access and PathPal activity." />
    {actionError && <div className="inline-error">{actionError}</div>}
    <div className="notification-list">{isLoading ? <LoadingPanel /> : error ? <ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /> : notifications.length ? notifications.map(item => <article className={`notification-card ${item.readAt ? '' : 'unread'}`} key={item.id}><div className="notification-symbol"><Bell size={18} /></div><div className="notification-content"><div className="notification-meta"><span>{item.type.replaceAll('_', ' ').toUpperCase()}</span><time>{dateText(item.createdAt)}</time></div><h2>{item.title}</h2><p>{item.body}</p></div>{item.readAt ? <span className="read-label">READ</span> : <button className="button button-subtle" onClick={() => void markRead(item.id)} disabled={mark.isPending} data-testid={`button-mark-read-${item.id}`}>Mark read</button>}</article>) : <EmptyPanel title="You’re all caught up">When there’s an account or family update, it will appear here.</EmptyPanel>}</div>
  </>;
}

function ProfilePage({ account }: { account: AccountStatus }) {
  const { signOut } = useClerk();
  const client = useQueryClient();
  async function logout() { client.clear(); await signOut({ redirectUrl: `${basePath}/` || '/' }); }
  return <><Header marker="ACCOUNT / PROFILE" title="Account and access." description="Your identity comes from your secure sign-in. PathPal access is assigned by the account service." />
    <section className="profile-card"><span className="avatar profile-avatar">{account.displayName.slice(0, 1).toUpperCase()}</span><div><span className="eyebrow"><span />PATHPAL ACCOUNT</span><h2>{account.displayName}</h2><p>{account.status === 'parent' ? 'Parent / guardian' : account.status === 'child_approved' ? 'Approved family member' : account.status === 'manager' ? 'City manager' : `Field team${account.teamName ? ` · ${account.teamName}` : ''}`}</p><div className="profile-access"><ShieldCheck size={17} />Role access is confirmed by the server and cannot be changed here.</div><button className="button button-subtle" onClick={() => void logout()} data-testid="button-profile-sign-out">Sign out <LogOut size={15} /></button></div></section>
  </>;
}
function NotFound() { return <div className="not-found"><span className="eyebrow"><span />404 / NOT FOUND</span><h1>This path ends here.</h1><p>Return to your authorized PathPal workspace.</p><Link className="button button-primary" href="/">Go to workspace <ArrowRight size={16} /></Link></div>; }

function SignedInApp() {
  const { isLoaded, isSignedIn } = useUser();
  const { data: account, isLoading, error, refetch } = useGetAccountStatus({ query: { enabled: isLoaded && !!isSignedIn, queryKey: getGetAccountStatusQueryKey(), refetchOnMount: 'always' } });
  const [location] = useLocation();
  if (!isLoaded) return <div className="auth-loading"><LoadingPanel label="Checking secure sign-in" /></div>;
  if (!isSignedIn) return <PublicAuth />;
  if (isLoading) return <div className="auth-loading"><LoadingPanel label="Loading PathPal account" /></div>;
  if (error) return <div className="auth-loading"><ErrorNotice message={errorText(error)} onRetry={() => void refetch()} /></div>;
  if (!account) return <div className="auth-loading"><ErrorNotice message="Your account status is unavailable." onRetry={() => void refetch()} /></div>;
  if (account.status === 'needs_setup') return <SetupScreen onDone={() => void refetch()} />;
  if (account.status === 'child_pending') return <AccessPending />;
  if (account.status === 'child_rejected') return <AccessPending rejected />;
  const isStaff = account.status === 'manager' || account.status === 'worker';
  return <Shell account={account}><Switch>
    <Route path="/"><>{isStaff ? <StaffHome account={account} /> : <FamilyHome account={account} />}</></Route>
    <Route path="/reports"><ReportsPage account={account} /></Route>
    <Route path="/reports/:id"><ReportDetail account={account} /></Route>
    <Route path="/report/new">{isStaff ? <NotFound /> : <NewReport />}</Route>
    <Route path="/map"><MapPage account={account} /></Route>
    <Route path="/family">{isStaff ? <NotFound /> : <FamilyWorkspace account={account} />}</Route>
    <Route path="/notifications"><NotificationsPage /></Route>
    <Route path="/profile"><ProfilePage account={account} /></Route>
    <Route><NotFound /></Route>
  </Switch></Shell>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
  return <ClerkProvider publishableKey={clerkPublishableKey} proxyUrl={clerkProxyUrl} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}
    appearance={{ variables: { colorPrimary: '#176e6a', colorForeground: '#17393d', colorMutedForeground: '#637c7b', colorBackground: '#fbfaf5', colorInput: '#fffefa', colorInputForeground: '#17393d', colorDanger: '#a94d49', colorNeutral: '#d6dfd7', fontFamily: 'DM Sans, sans-serif', borderRadius: '10px' }, elements: { card: 'clerk-card', headerTitle: 'clerk-title', formButtonPrimary: 'clerk-primary', formFieldInput: 'clerk-input' } }}>
    <ClerkCacheBoundary />
    <Switch><Route path="/sign-in/*?"><PublicAuth /></Route><Route path="/sign-up/*?"><PublicAuth /></Route><Route><SignedInApp /></Route></Switch>
  </ClerkProvider>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter></QueryClientProvider>;
}
export default App;