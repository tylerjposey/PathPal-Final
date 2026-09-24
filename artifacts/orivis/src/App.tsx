import { useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  Flag,
  HeartHandshake,
  LockKeyhole,
  MapPin,
  Menu,
  Navigation,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

type RoleKey = 'parent' | 'child' | 'case-manager' | 'worker';

const roles: Array<{
  key: RoleKey;
  number: string;
  label: string;
  description: string;
  detail: string;
  icon: typeof Users;
}> = [
  {
    key: 'parent',
    number: '01',
    label: 'Parent',
    description: 'Plan a child’s bus journey with a little more confidence.',
    detail: 'See planned route details and voluntary check-ins in one calm view.',
    icon: Users,
  },
  {
    key: 'child',
    number: '02',
    label: 'Child',
    description: 'A simple place to follow the plan and check in by choice.',
    detail: 'Check-ins are voluntary moments of reassurance, never live tracking.',
    icon: Navigation,
  },
  {
    key: 'case-manager',
    number: '03',
    label: 'City Case Manager',
    description: 'Review reports, spot patterns, and coordinate a response.',
    detail: 'Move from a community report to a clearer next step for the city.',
    icon: HeartHandshake,
  },
  {
    key: 'worker',
    number: '04',
    label: 'City Worker',
    description: 'Turn neighborhood observations into visible action.',
    detail: 'Review assigned cleanup tasks and update their status.',
    icon: Flag,
  },
];

function App() {
  const [selectedRole, setSelectedRole] = useState<RoleKey>('parent');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeRole = roles.find((role) => role.key === selectedRole) ?? roles[0];

  const chooseRole = (role: RoleKey) => {
    setSelectedRole(role);
    window.setTimeout(() => document.getElementById('role-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };

  return (
    <main className="orivis-page grain">
      <a className="sr-only focus:not-sr-only" href="#main-content">Skip to content</a>

      <header className="container-wide site-nav" data-testid="site-header">
        <a className="brand-mark" href="#top" aria-label="Orivis home" data-testid="brand-link">
          <span className="brand-symbol" aria-hidden="true">o</span>
          <span className="brand-word">orivis</span>
        </a>

        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#how-it-works" data-testid="nav-how-it-works">How it works</a>
          <a href="#roles" data-testid="nav-roles">Four perspectives</a>
          <a href="#community" data-testid="nav-community">Community reports</a>
        </nav>

        <a className="nav-action" href="/orivis-mobile/" data-testid="nav-open-prototype">
          Open prototype <ExternalLink aria-hidden="true" />
        </a>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
          data-testid="mobile-menu-toggle"
        >
          {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </header>

      {mobileMenuOpen && (
        <nav className="mobile-menu" aria-label="Mobile navigation">
          <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-nav-how-it-works">How it works</a>
          <a href="#roles" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-nav-roles">Four perspectives</a>
          <a href="#community" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-nav-community">Community reports</a>
        </nav>
      )}

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="container-wide hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">A clearer way forward, together</div>
            <h1 id="hero-title" className="display">The city is safer when we <em>look out</em> for one another.</h1>
            <p className="hero-lede">
              Orivis brings families and city teams into the same conversation — from a planned bus journey to the neighborhood issue that deserves attention.
            </p>
            <div className="hero-actions">
              <a className="button-primary" href="/orivis-mobile/" data-testid="hero-open-prototype">
                Explore the mobile prototype <ArrowRight aria-hidden="true" />
              </a>
              <a className="button-light" href="#how-it-works" data-testid="hero-learn-more">
                See how it works <ArrowDownRight aria-hidden="true" />
              </a>
            </div>
            <p className="microcopy">
              <LockKeyhole aria-hidden="true" /> This showcase uses demonstration data only.
            </p>
          </div>

          <div className="hero-art" aria-label="Illustration of a planned bus journey from Willow St and Bird Ave to River Glen Elementary">
            <span className="art-label mono">Sample journey / not live</span>
            <div className="map-grid" aria-hidden="true" />
            <svg className="route-line" viewBox="0 0 500 360" aria-hidden="true">
              <path d="M72 71 C 155 40, 171 165, 238 143 S 286 206, 324 202 S 405 265, 442 303" />
            </svg>
            <div className="art-pin start" aria-hidden="true"><MapPin /></div>
            <div className="art-pin end" aria-hidden="true"><MapPin /></div>
            <div className="journey-card">
              <div className="journey-card-top">
                <div>
                  <div className="mono">Planned journey</div>
                  <div className="journey-title">VTA Route 22</div>
                </div>
                <span className="demo-pill mono">Demo</span>
              </div>
              <div className="journey-route">
                <span className="route-dot" aria-hidden="true" />
                <span>Willow St &amp; Bird Ave</span>
                <span className="route-stem" aria-hidden="true" />
                <span className="route-dot" aria-hidden="true" />
                <span>River Glen Elementary</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="trust-strip">
        <div className="container-wide trust-inner">
          <span className="trust-note">Built around clear expectations, not constant surveillance.</span>
          <div className="trust-items">
            <span className="trust-item"><ShieldCheck aria-hidden="true" /> Voluntary check-ins</span>
            <span className="trust-item"><Users aria-hidden="true" /> Four roles</span>
            <span className="trust-item"><HeartHandshake aria-hidden="true" /> Shared responsibility</span>
          </div>
        </div>
      </div>

      <section className="section-pad" id="how-it-works" aria-labelledby="how-title">
        <div className="container-wide intro-section">
          <div>
            <div className="eyebrow">The Orivis approach</div>
            <h2 id="how-title" className="display">Useful in the moments that matter.</h2>
          </div>
          <div className="intro-copy">
            <p>
              A school-day journey and a safer block are connected by one thing: people having enough context to make a good next decision. Orivis keeps that context legible for the people who need it.
            </p>
            <p>
              Families can coordinate a <strong>planned</strong> route. Neighbors can flag what they see. City Case Managers review and assign reports; City Workers handle assigned tasks.
            </p>
            <div className="line-note">Practical by design. Human by default.</div>
          </div>
        </div>
      </section>

      <section className="roles-section" id="roles" aria-labelledby="roles-title">
        <div className="container-wide">
          <div className="roles-head">
            <div>
              <div className="eyebrow" style={{ color: 'hsl(var(--secondary))' }}>Choose a perspective</div>
              <h2 id="roles-title" className="display">One shared city. Four ways in.</h2>
            </div>
            <p>Switch perspectives to see how the same information becomes a different kind of support.</p>
          </div>

          <div className="role-grid" role="group" aria-label="Choose an Orivis role">
            {roles.map((role) => {
              const Icon = role.icon;
              const isSelected = role.key === selectedRole;
              return (
                <button
                  className={`role-card${isSelected ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={isSelected}
                  aria-controls="role-detail"
                  onClick={() => chooseRole(role.key)}
                  key={role.key}
                  data-testid={`role-card-${role.key}`}
                >
                  <div>
                    <span className="role-number">{role.number}</span>
                    <Icon className="role-icon" aria-hidden="true" />
                    <h3>{role.label}</h3>
                    <p>{role.description}</p>
                  </div>
                  <ArrowRight className="role-arrow" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="role-detail" id="role-detail" aria-live="polite">
            <span className="mono">Selected perspective / {activeRole.label}</span>
            <br />
              <strong>{activeRole.detail}</strong>
          </div>
        </div>
      </section>

      <section className="journey-section" aria-labelledby="journey-title">
        <div className="container-wide journey-layout">
          <div className="journey-copy">
            <div className="eyebrow">A journey, with boundaries</div>
            <h2 id="journey-title" className="display">Know the plan. Keep the trust.</h2>
            <p>
              The sample journey in Orivis is a planned route, not a live child tracker. A child can choose to check in at meaningful moments; the family sees the plan and those check-ins, not a moving dot.
            </p>
            <ul className="check-list">
              <li><Check className="check-icon" aria-hidden="true" /><span>Planned route: VTA Route 22 from Willow St &amp; Bird Ave to River Glen Elementary.</span></li>
              <li><Check className="check-icon" aria-hidden="true" /><span>Voluntary check-ins create reassurance without turning a child into a data stream.</span></li>
              <li><Check className="check-icon" aria-hidden="true" /><span>When available, the mobile prototype labels route information from Google Maps and 511 SF Bay and map imagery from Google Maps; fallback routes and maps are labeled as demo.</span></li>
            </ul>
          </div>
          <div className="journey-panel" aria-label="Demonstration journey map">
            <div className="panel-top">
              <span className="mono">Family view / demonstration</span>
              <span className="source-tag mono">Demo route</span>
            </div>
            <svg className="journey-map-line" viewBox="0 0 470 300" aria-hidden="true">
              <path className="secondary" d="M40 75 L420 250" />
              <path d="M36 71 C 115 13, 126 175, 215 133 S 286 208, 430 250" />
            </svg>
            <div className="map-stop start"><span>Willow St &amp; Bird Ave</span></div>
            <div className="map-stop end"><span>River Glen Elementary</span></div>
            <div className="panel-card">
              <span className="mono">Scheduled departure</span>
              <strong>Route 22 · 7:42 AM</strong>
              <p>Illustrative demo map · not live position tracking. Time shown is a sample departure.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="reports-section" id="community" aria-labelledby="community-title">
        <div className="container-wide reports-layout">
          <div className="reports-copy">
            <div className="eyebrow">From noticing to doing</div>
            <h2 id="community-title" className="display">Small signals can shape a better block.</h2>
            <p>
              A broken crossing, a dark corner, or a blocked sidewalk should not disappear into a feed. Orivis gives community reports a place to land with the City Case Managers and City Workers who can act on them.
            </p>
            <div className="report-tags" aria-label="Illustrative report categories">
              <span className="report-tag">Unsafe bus stops</span>
              <span className="report-tag">Poor lighting</span>
              <span className="report-tag">Damaged sidewalks</span>
            </div>
          </div>
          <div className="illustrative-map" aria-label="Illustrative city issue map">
            <div className="map-heading">
              <strong>Community reports</strong>
              <span className="mono">Illustrative map</span>
            </div>
            <div className="issue-pin one" aria-hidden="true"><CircleAlert /></div>
            <div className="issue-pin two" aria-hidden="true"><Flag /></div>
            <div className="issue-pin three" aria-hidden="true"><CircleAlert /></div>
            <div className="map-legend">
              <span><i className="legend-dot" aria-hidden="true" /> Needs review</span>
              <span>Sample locations only</span>
            </div>
          </div>
        </div>
      </section>

      <section className="safety-note" aria-labelledby="safety-title">
        <div className="container-wide safety-inner">
          <p className="safety-quote" id="safety-title">Safety is not a feature you turn on. It is a <span>relationship</span> you keep.</p>
          <div className="safety-details">
            <span className="mono">A note on the prototype</span>
            <p>
              Authentication, AI analysis, notifications and texts, partner rewards, police contact, and SOS are simulated in the mobile prototype. SOS is a simulated safety session, not an emergency service.
            </p>
            <p>
              This web showcase does not show live feed data. The issue map is illustrative, and all dashboard and journey information here is demonstration data.
            </p>
          </div>
        </div>
      </section>

      <section className="closing" aria-labelledby="closing-title">
        <div className="container-wide closing-inner">
          <div>
            <div className="eyebrow">See the working prototype</div>
            <h2 id="closing-title" className="display">Start with the role that feels like home.</h2>
          </div>
          <div>
            <p>Choose Parent, Child, City Case Manager, or City Worker in the interactive Expo experience.</p>
            <a className="button-light" href="/orivis-mobile/" data-testid="closing-open-prototype">
              Open Orivis mobile <ExternalLink aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container-wide footer-inner">
          <span>Orivis · a demonstration showcase</span>
          <span>Sample data only · <a href="/orivis-mobile/" data-testid="footer-open-prototype">Explore the Expo prototype</a></span>
        </div>
      </footer>
    </main>
  );
}

export default App;