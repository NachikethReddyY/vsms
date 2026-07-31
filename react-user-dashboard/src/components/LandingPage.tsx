import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from './MagicEffects';
import styles from './LandingPage.module.css';

const workflowSteps = [
  {
    title: 'Registration',
    description: 'Confirm identity and consent, then create the event registration.',
    icon: <path d="M7 9h18v16H7zM11 6h10v6H11zM11 17h10M11 21h7" />,
  },
  {
    title: 'Visual acuity',
    description: 'Record the smallest chart line read by each eye.',
    icon: <path d="M7 6h18v20H7zM11 11h10M12 16h8M14 21h4" />,
  },
  {
    title: 'Refraction',
    description: 'Capture the configured refraction reading.',
    icon: (
      <>
        <path d="M5 16c2.8-4.5 6.5-6.8 11-6.8S24.2 11.5 27 16c-2.8 4.5-6.5 6.8-11 6.8S7.8 20.5 5 16Z" />
        <circle cx="16" cy="16" r="3.5" />
      </>
    ),
  },
  {
    title: 'Colour vision',
    description: 'Record the configured colour-vision result.',
    icon: (
      <>
        <circle cx="12" cy="14" r="5" />
        <circle cx="20" cy="14" r="5" />
        <circle cx="16" cy="21" r="5" />
      </>
    ),
  },
  {
    title: 'Eye health',
    description: 'Record observations from the eye-health station.',
    icon: (
      <>
        <path d="M5 16c2.8-4.5 6.5-6.8 11-6.8S24.2 11.5 27 16c-2.8 4.5-6.5 6.8-11 6.8S7.8 20.5 5 16Z" />
        <path d="M16 11.5v9M11.5 16h9" />
      </>
    ),
  },
  {
    title: 'Clinical review',
    description: 'Reviewer records the final decision and next step.',
    icon: (
      <>
        <path d="M8 6h16v20H8zM12 11h8M12 15h8M12 19h4" />
        <path d="m18 22 2 2 4-5" />
      </>
    ),
  },
];

const featureZooms = [
  {
    label: 'Queue and station load',
    icon: <path d="M5 25h22M8 21v-6M16 21V8M24 21v-9" />,
  },
  {
    label: 'Offline save and sync',
    icon: (
      <>
        <path d="M9 23a7 7 0 0 1 1.2-13.9A9 9 0 0 1 27 13.5 5.5 5.5 0 0 1 25 24H9" />
        <path d="m12 19 3 3 6-7" />
      </>
    ),
  },
  {
    label: 'Clinical review',
    icon: (
      <>
        <path d="M8 6h16v20H8zM12 11h8M12 15h8" />
        <path d="m15 21 2 2 4-5" />
      </>
    ),
  },
];

const trustItems = [
  {
    title: 'Offline-ready',
    description: 'Save locally. Sync when connected.',
    icon: (
      <>
        <path d="M9 23a7 7 0 0 1 1.2-13.9A9 9 0 0 1 27 13.5 5.5 5.5 0 0 1 25 24H9" />
        <path d="m12 19 3 3 6-7" />
      </>
    ),
  },
  {
    title: 'Secure QR handoff',
    description: 'Identify records without clinical data.',
    icon: <path d="M6 6h7v7H6zM19 6h7v7h-7zM6 19h7v7H6zM19 19h3v3h-3zM23 23h3v3h-3zM23 17h3" />,
  },
  {
    title: 'Role clarity',
    description: 'Each person sees assigned work.',
    icon: (
      <>
        <circle cx="11" cy="11" r="4" />
        <circle cx="23" cy="12" r="3" />
        <path d="M4 26c.7-5 3-7 7-7s6.3 2 7 7M19 20c4.8-1.1 7.7.9 8.5 5" />
      </>
    ),
  },
  {
    title: 'Reviewer decisions',
    description: 'Rules flag. Reviewers decide.',
    icon: (
      <>
        <path d="M8 5h16v22H8zM12 10h8M12 15h8" />
        <path d="m13 22 2 2 5-6" />
      </>
    ),
  },
];

function OutlineIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export default function LandingPage() {
  const workflowRef = useRef<HTMLElement>(null);
  const [motionReady] = useState(
    () => typeof window !== 'undefined'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && 'IntersectionObserver' in window,
  );
  const [workflowVisible, setWorkflowVisible] = useState(!motionReady);

  useEffect(() => {
    const workflow = workflowRef.current;
    if (!workflow || !motionReady) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setWorkflowVisible(true);
      observer.disconnect();
    }, { threshold: 0.24 });

    observer.observe(workflow);
    return () => observer.disconnect();
  }, [motionReady]);

  useEffect(() => {
    const root = document.documentElement;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeMeta) return;

    const syncThemeColor = () => {
      themeMeta.content = root.dataset.theme === 'light' ? '#f7f7f4' : '#0b0b0d';
    };
    const observer = new MutationObserver(syncThemeColor);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    syncThemeColor();
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`${styles['landing-page']} ${motionReady ? styles['motion-ready'] : ''}`}>
      <a className={styles['skip-link']} href="#main-content">Skip to content</a>

      <header className={styles['site-nav']}>
        <Link className={styles.brand} to="/" aria-label="VSMS home">
          <span className={styles['brand-mark']} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="9" cy="21" r="2" fill="currentColor" />
              <circle cx="16.3" cy="11" r="2" fill="currentColor" />
              <circle cx="23" cy="16.3" r="2" fill="currentColor" />
            </svg>
          </span>
          <span className={styles['brand-copy']}>
            <strong>VSMS</strong>
            <small>Vision Screening Management System</small>
          </span>
        </Link>
        <div className={styles['nav-actions']}>
          <ThemeToggle className={styles['theme-toggle']} />
          <Link className={styles['nav-sign-in']} to="/login">Sign in</Link>
        </div>
      </header>

      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <img
            src="/landing/vsms-screening-hero.webp"
            alt="Staff member using a tablet at a community vision-screening station"
            width="1800"
            height="1013"
            decoding="async"
            fetchPriority="high"
          />
          <div className={`${styles['page-shell']} ${styles['hero-inner']}`}>
            <div className={styles['hero-copy']}>
              <h1 id="hero-title">Keep the day moving.</h1>
              <p>One workspace for the participant records, screening stations, and review decisions behind a community vision-screening event.</p>
              <Link className={styles['hero-action']} to="/login">
                Sign in to VSMS <span aria-hidden="true">→</span>
              </Link>
              <small className={styles['authorised-note']}>For authorised screening personnel</small>
            </div>
          </div>
        </section>

        <section className={`${styles['page-shell']} ${styles['service-intro']}`} aria-labelledby="purpose-title">
          <h2 id="purpose-title">A service for event-day screening.</h2>
          <p>VSMS helps staff register participants, scan secure event passes, record results at each station, and send flagged records to a reviewer without losing track of the next action.</p>
        </section>

        <section
          ref={workflowRef}
          className={`${styles['page-shell']} ${styles.workflow} ${workflowVisible ? styles['is-visible'] : ''}`}
          aria-labelledby="workflow-title"
        >
          <h2 id="workflow-title">One record, from registration to review.</h2>
          <p>Each completed step updates the same participant record. The QR pass supports the handoff between stations without carrying personal or clinical information in the code.</p>
          <ol className={styles['workflow-list']}>
            {workflowSteps.map((step) => (
              <li key={step.title}>
                <span className={styles['workflow-icon']} aria-hidden="true">
                  <OutlineIcon>{step.icon}</OutlineIcon>
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.interfaces} aria-labelledby="interfaces-title">
          <div className={styles['page-shell']}>
            <header className={styles['interfaces-heading']}>
              <h2 id="interfaces-title">What staff see during an event.</h2>
            </header>

            <figure className={styles['dashboard-showcase']}>
              <div className={styles['dashboard-frame']}>
                <img
                  src="/landing/placeholder-image.png"
                  alt="Dashboard screenshot placeholder"
                  width="1200"
                  height="800"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <figcaption className={styles['dashboard-note']}>Dashboard image placeholder. Replace with an approved product screenshot.</figcaption>
            </figure>

            <div className={styles['feature-zooms']} role="group" aria-label="Highlighted dashboard features">
              {featureZooms.map((feature) => (
                <figure className={styles['feature-zoom']} key={feature.label}>
                  <div className={styles['zoom-window']} aria-hidden="true">
                    <img src="/landing/placeholder-image.png" alt="" width="1200" height="800" loading="lazy" decoding="async" />
                  </div>
                  <figcaption>
                    <span aria-hidden="true"><OutlineIcon>{feature.icon}</OutlineIcon></span>
                    {feature.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles['page-shell']} ${styles.trust}`} aria-labelledby="trust-title">
          <h2 id="trust-title">Ready for responsible field work.</h2>
          <div className={styles['trust-grid']}>
            {trustItems.map((item) => (
              <article className={styles['trust-item']} key={item.title}>
                <span className={styles['trust-icon']} aria-hidden="true"><OutlineIcon>{item.icon}</OutlineIcon></span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={`${styles['page-shell']} ${styles['access-wrap']}`} aria-labelledby="access-title">
          <div className={styles['access-panel']}>
            <h2 id="access-title">Ready for today’s event.</h2>
            <div className={styles['access-actions']}>
              <Link className={styles['access-action']} to="/login">Open VSMS</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={`${styles['page-shell']} ${styles['site-footer']}`}>
        <span>&copy; 2026 Team Cryptics</span>
        <span>Screening support, not diagnosis.</span>
      </footer>
    </div>
  );
}
