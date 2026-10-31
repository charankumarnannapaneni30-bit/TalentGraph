import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Activity, AlertTriangle, ArrowRight, Bell, BriefcaseBusiness, Building, Check, ChevronDown, ChevronRight, CircleHelp,
  FileText, Fingerprint, Gauge, Github, GraduationCap, LayoutDashboard, LogOut, Mail, MessageSquareText,
  Menu, Mic, MicOff, Search, Send, Settings, ShieldCheck, Sparkles, Target, Trash2, UploadCloud, UserRound, Users, Video, Volume2, X,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { api, apiJson } from "./lib/api";
import { loginSchema, registerSchema } from "./lib/schemas";

const menu = [
  ["Overview", "/app/dashboard", LayoutDashboard],
  ["Documents", "/app/documents", FileText],
  ["My profile", "/app/profile", UserRound],
  ["Evidence review", "/app/evidence", Fingerprint],
  ["Career paths", "/app/careers", GraduationCap],
  ["Job matches", "/app/jobs", BriefcaseBusiness],
  ["Mock interview", "/app/interview", MessageSquareText],
  ["Skill roadmap", "/app/skill-gaps", Target],
];
const disclaimer = "AI-generated insights are advisory and based only on the information you provided. They are not hiring decisions. Verify details with the employer.";

function messageTone(message) {
  const text = String(message || "").toLowerCase();
  if (/\b(could not|couldn't|failed|failure|error|unavailable|blocked|denied|too large|no audio|no microphone|not supported|not found|not configured|timed out|cannot|can't|required|invalid|exceeded|busy|already finished)\b/.test(text)) return "negative";
  if (/\b(received|ready|saved|updated|created|completed|enabled|withdrawn|deleted|marked as read|successfully|queued|generated)\b/.test(text)) return "positive";
  return "neutral";
}

function Brand({ light = false }) {
  return <Link to="/" className={`brand ${light ? "brand-light" : ""}`}><span className="brand-mark"><Activity size={19} /></span><span>Talent<span className="brand-emphasis">Graph</span></span></Link>;
}

function Button({ children, variant = "primary", ...props }) {
  return <button className={`button button-${variant}`} {...props}>{children}</button>;
}

const Field = forwardRef(function Field({ label, error, ...props }, ref) {
  return <label className="field"><span>{label}</span><input {...props} ref={ref} />{error && <small className="form-error">{error}</small>}</label>;
});

function PublicLayout() {
  return <><header className="public-nav"><Brand /><nav><a href="#how-it-works">How it works</a><a href="#principles">Our principles</a><Link to="/login" className="nav-login">Log in</Link><Link to="/register" className="button button-primary nav-cta">Get started <ArrowRight size={16} /></Link></nav></header><Outlet /><footer className="public-footer"><Brand /><span>Evidence-led career intelligence. Human decisions, always.</span><span>© {new Date().getFullYear()} TalentGraph</span></footer></>;
}

function Landing() {
  return <main className="landing">
    <section className="hero">
      <div className="hero-copy page-enter">
        <div className="eyebrow"><Sparkles size={15} /> CAREER INTELLIGENCE, GROUNDED IN EVIDENCE</div>
        <h1>Your skills.<br /><span>Your next opportunity.</span></h1>
        <p>Turn your experience into a clearer picture of what you do well, where you could grow, and which opportunities are worth exploring.</p>
        <div className="hero-actions"><Link to="/register" className="button button-primary button-large">Build my profile <ArrowRight size={18} /></Link><a className="text-link" href="#how-it-works">See how it works <ChevronRight size={16} /></a></div>
        <div className="trust-line"><ShieldCheck size={17} /> Your data stays yours <span>·</span> No automated hiring decisions</div>
      </div>
      <div className="hero-visual">
        <div className="orbit orbit-one"></div><div className="orbit orbit-two"></div>
        <div className="profile-preview">
          <div className="preview-top"><span className="preview-icon"><UserRound size={20} /></span><div><b>Candidate profile</b><small>Evidence-backed insights</small></div><span className="live-dot" /></div>
          <div className="preview-score"><div><span>PROFILE STRENGTH</span><strong>In progress</strong></div><div className="progress-ring"><span>—</span></div></div>
          <div className="preview-divider" />
          <div className="preview-label">SKILL EVIDENCE</div>
          <div className="skill-placeholder"><span className="placeholder-icon"><Github size={16} /></span><div><b>Add your experience</b><small>Projects, documents, and more</small></div><span className="status-pill">YOUR DATA</span></div>
          <div className="preview-footer"><Sparkles size={15} /><span>Insights appear when you add evidence.</span></div>
        </div>
        <div className="float-chip chip-a"><span className="chip-check"><Check size={13} /></span>Evidence before claims</div>
        <div className="float-chip chip-b"><Target size={16} />Your next step, made clearer</div>
      </div>
    </section>
    <section className="feature-strip" id="how-it-works"><div><span className="feature-number">01</span><FileText /><h3>Bring your evidence</h3><p>Share resumes, project work, certificates, or a public GitHub profile.</p></div><div><span className="feature-number">02</span><Fingerprint /><h3>See the full picture</h3><p>Connect your skills to evidence and spot what still needs assessment.</p></div><div><span className="feature-number">03</span><BriefcaseBusiness /><h3>Explore your options</h3><p>Compare career paths and open roles with transparent fit explanations.</p></div></section>
    <section className="principle-section" id="principles"><div className="principle-icon"><ShieldCheck size={25} /></div><div><div className="eyebrow">BUILT FOR PEOPLE, NOT AUTOMATED DECISIONS</div><h2>Insight should empower you.<br />The decision is always yours.</h2><p>TalentGraph offers guidance based on information you choose to share. It never makes hiring decisions, ranks people against one another, or applies to jobs on your behalf.</p></div><Link to="/register" className="text-link">Start exploring <ArrowRight size={16} /></Link></section>
  </main>;
}

function AuthPage({ mode }) {
  const register = mode === "register";
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const schema = mode === "forgot" ? z.object({ email: z.string().email() }) : mode === "reset" ? z.object({ password: z.string().min(8) }) : register ? registerSchema : loginSchema;
  const { register: field, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", full_name: "", consent_ai_processing: false },
  });
  const onSubmit = async (values) => {
    setMessage("");
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(values.email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setMessage("If an account exists for that email, a password reset link has been sent.");
        return;
      }
      if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password: values.password });
        if (error) throw error;
        setMessage("Your password has been updated. You can now sign in.");
        navigate("/login");
        return;
      }
      const result = register
        ? await supabase.auth.signUp({ email: values.email, password: values.password, options: { data: { full_name: values.full_name, consent_ai_processing: true } } })
        : await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
      if (result.error) throw result.error;
      if (register && !result.data.session) { setMessage("Check your email to confirm your account, then log in."); return; }
      if (register) await apiJson("/me", "PATCH", { full_name: values.full_name, consent_ai_processing: true });
      navigate("/app/dashboard");
    } catch (error) {
      setMessage(error.message || "Authentication failed. Please try again.");
    }
  };
  const heading = register ? "Create your account" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Welcome back";
  const subheading = register ? "Start building a clearer picture of your skills." : mode === "forgot" ? "We’ll send you a secure password reset link." : mode === "reset" ? "Choose a new password for your account." : "Sign in to continue exploring your career.";
  return <main className="auth-page"><section className="auth-card page-enter"><Link to="/" className="back-link">← Back to home</Link><div className="auth-heading"><span className="auth-icon"><Sparkles size={20} /></span><h1>{heading}</h1><p>{subheading}</p></div>
    {message && <div className="form-message" role="alert">{message}</div>}
    <form onSubmit={handleSubmit(onSubmit)} className="auth-form">
      {register && <Field label="Full name" placeholder="Your name" autoComplete="name" error={errors.full_name?.message} {...field("full_name")} />}
      {mode !== "reset" && <Field label="Email address" type="email" placeholder="you@example.com" autoComplete="email" error={errors.email?.message} {...field("email")} />}
      {mode !== "forgot" && <Field label="Password" type="password" placeholder={mode === "reset" ? "New password" : "At least 8 characters"} autoComplete={register || mode === "reset" ? "new-password" : "current-password"} error={errors.password?.message} {...field("password")} />}
      {register && <label className="consent"><input type="checkbox" {...field("consent_ai_processing")} /><span>I consent to AI processing of the information I submit to generate career insights. I can withdraw this consent later.</span></label>}
      {errors.consent_ai_processing && <small className="form-error">{errors.consent_ai_processing.message}</small>}
      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Please wait…" : register ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : "Sign in"} <ArrowRight size={16} /></Button>
    </form>
    {mode !== "forgot" && mode !== "reset" && <p className="auth-switch">{register ? "Already have an account?" : "New to TalentGraph?"} <Link to={register ? "/login" : "/register"}>{register ? "Log in" : "Create account"}</Link></p>}
    {mode === "forgot" && <p className="auth-switch">Remembered your password? <Link to="/login">Sign in</Link></p>}
    {!register && mode === "login" && <Link className="forgot-link" to="/forgot-password">Forgot your password?</Link>}
  </section></main>;
}

function Protected({ session }) {
  return session ? <Outlet /> : <Navigate to="/login" replace />;
}

function AdminRoute({ session, children }) {
  return session?.user?.app_metadata?.role === "admin" ? children : <Navigate to="/app/dashboard" replace />;
}

function Shell({ session, onSignOut }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestNotifications, setLatestNotifications] = useState([]);
  const location = useLocation();
  const visibleMenu = session?.user?.app_metadata?.role === "admin" ? [...menu, ["Job administration", "/app/admin/jobs", BriefcaseBusiness]] : menu;
  const current = visibleMenu.find((item) => location.pathname.startsWith(item[1]))?.[0] || "Workspace";
  const accountName = session?.user?.user_metadata?.full_name || "Your workspace";
  const accountEmail = session?.user?.email || "";
  const accountInitial = (session?.user?.user_metadata?.full_name?.[0] || accountEmail[0] || "U").toUpperCase();
  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);
  useEffect(() => {
    let active = true;
    const refreshCount = () => api("/notifications").then((items) => {
      if (active) {
        setLatestNotifications((items || []).slice(0, 5));
        setUnreadCount((items || []).filter((item) => !item.is_read).length);
      }
    }).catch((error) => {
      if (active) console.error("Could not load notifications", error.message);
    });
    refreshCount();
    window.addEventListener("talentgraph-notifications-updated", refreshCount);
    if (!session?.user?.id) return () => { active = false; };
    const channel = supabase.channel(`notifications-${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` }, () => {
        if (active) setUnreadCount((count) => count + 1);
      }).subscribe();
    return () => { active = false; window.removeEventListener("talentgraph-notifications-updated", refreshCount); supabase.removeChannel(channel); };
  }, [session?.user?.id]);
  const markLatestRead = async (item) => {
    try {
      await api(`/notifications/${item.id}/read`, { method: "PATCH" });
      setLatestNotifications((rows) => rows.map((row) => row.id === item.id ? { ...row, is_read: true } : row));
      window.dispatchEvent(new Event("talentgraph-notifications-updated"));
    } catch (error) {
      console.error("Could not update notification", error.message);
    }
  };
  return <div className="app-shell">
    {sidebarOpen && <button className="mobile-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}><div className="sidebar-brand"><Brand /></div><div className="workspace-label">WORKSPACE</div><nav className="side-nav">{visibleMenu.map(([label, path, Icon]) => <Link key={path} to={path} onClick={() => setSidebarOpen(false)} className={location.pathname.startsWith(path) ? "active" : ""}><Icon size={18} /><span>{label}</span>{label === "Job matches" && <span className="nav-dot" />}</Link>)}</nav><div className="sidebar-bottom"><Link to="/app/preferences"><Settings size={18} />Preferences</Link><Link to="/app/settings"><ShieldCheck size={18} />Settings & privacy</Link><button onClick={onSignOut}><LogOut size={18} />Sign out</button><div className="sidebar-user"><span>{accountInitial}</span><div><b>{accountName}</b><small><span className={`role-badge role-badge-${userRole}`}>{isRecruiter ? "Recruiter" : "Candidate"}</span></small></div></div></div></aside>
    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
        <div className="breadcrumb">Workspace <ChevronRight size={14} /> <b>{current}</b></div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Search"><Search size={18} /></button>
          <div className="notification-menu">
            <button className="icon-button notification-button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}><Bell size={18} />{unreadCount > 0 && <i />}</button>
            {notificationsOpen && <div className="notification-popover"><div className="notification-popover-head"><b>Notifications</b><Link to="/app/notifications" onClick={() => setNotificationsOpen(false)}>View all</Link></div>{latestNotifications.length ? latestNotifications.map((item) => <button className={`notification-item ${item.is_read ? "" : "unread"}`} key={item.id} onClick={() => markLatestRead(item)}><b>{item.title}</b><small>{item.body || item.type}</small></button>) : <p>No notifications yet.</p>}</div>}
          </div>
          <div className="account-menu" ref={accountMenuRef}>
            <button className="account-trigger" type="button" aria-label="Open account menu" aria-controls="account-menu" aria-haspopup="true" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}><span className="avatar">{accountInitial}</span><ChevronDown size={15} /></button>
            {accountOpen && <div className="account-popover" id="account-menu">
              <div className="account-popover-user"><span className="account-popover-avatar">{accountInitial}</span><div><b>{accountName}</b><small>{accountEmail || (isRecruiter ? "Recruiter account" : "Candidate account")}</small></div></div>
              <button
                type="button"
                className="role-toggle-btn"
                onClick={async () => {
                  const nextRole = isRecruiter ? "candidate" : "recruiter";
                  try {
                    await apiJson("/me", "PATCH", { role: nextRole });
                    setUserRole(nextRole);
                    setAccountOpen(false);
                    window.dispatchEvent(new Event("talentgraph-role-updated"));
                    navigate(nextRole === "recruiter" ? "/app/recruiter/candidates" : "/app/dashboard");
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                <Users size={16} />
                <span>Switch to {isRecruiter ? "Candidate" : "Recruiter"} mode</span>
              </button>
              <Link to="/app/profile" onClick={() => setAccountOpen(false)}><UserRound size={17} />My profile</Link>
              <Link to="/app/preferences" onClick={() => setAccountOpen(false)}><Settings size={17} />Preferences</Link>
              <Link to="/app/settings" onClick={() => setAccountOpen(false)}><ShieldCheck size={17} />Settings &amp; privacy</Link>
              <div className="account-popover-divider" />
              <button type="button" onClick={onSignOut}><LogOut size={17} />Sign out</button>
            </div>}
          </div>
        </div>
      </header>
      <main className="app-content"><Outlet /></main>
    </div>
  </div>;
}

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Disclaimer() {
  return <div className="disclaimer"><ShieldCheck size={16} /><span>{disclaimer}</span></div>;
}

function LoadingError({ error, onRetry }) {
  return <div className="state-card"><CircleHelp size={20} /><b>{error ? "We couldn’t load this yet" : "Nothing here yet"}</b><p>{error?.message || "Add your information to start generating evidence-based insights."}</p>{error && <Button variant="secondary" onClick={onRetry}>Try again</Button>}</div>;
}

function LoadingState({ label }) {
  return <div className="page-loading" role="status" aria-live="polite">
    <span className="loading-spinner" aria-hidden="true" />
    <span>{label}</span>
    <span className="loading-skeleton" aria-hidden="true"><i /><i /><i /></span>
  </div>;
}

function Dashboard({ session }) {
  const { data, isLoading, error, refetch } = useQueryWrap("/me", false, session?.user?.id);
  const { data: docs } = useQueryWrap("/documents", false, session?.user?.id);
  const { data: profile } = useQueryWrap("/profile", false, session?.user?.id);
  const { data: careers } = useQueryWrap("/careers", false, session?.user?.id);
  const { data: matches } = useQueryWrap("/jobs/matches?limit=3", false, session?.user?.id);
  if (isLoading) return <LoadingState label="Loading your workspace…" />;
  const documentCount = docs?.length || 0;
  const processingDocumentCount = docs?.filter((doc) => ["uploaded", "processing"].includes(doc.status)).length || 0;
  const processedDocumentCount = docs?.filter((doc) => doc.status === "processed").length || 0;
  const failedDocumentCount = docs?.filter((doc) => doc.status === "failed").length || 0;
  const profileStatus = profile?.id
    ? ["Ready", "Review your profile"]
    : processingDocumentCount
      ? ["Processing evidence", "Your evidence is being analyzed"]
      : processedDocumentCount
        ? ["Ready to build", "Build your evidence-backed profile"]
        : failedDocumentCount
          ? ["Retry evidence", "Review failed document processing"]
          : ["Getting started", "Add evidence to begin"];
  const name = data?.full_name || data?.user?.user_metadata?.full_name || "there";
  return <div className="page-enter"><PageTitle eyebrow="YOUR WORKSPACE" title={`Good to see you, ${name.split(" ")[0]}`} description="Build your profile from real evidence and explore your next career move." action={<Link className="button button-primary" to="/app/documents"><UploadCloud size={17} /> Add evidence</Link>} />
    <Disclaimer />
    {error ? <LoadingError error={error} onRetry={refetch} /> : <><div className="welcome-panel"><div className="welcome-copy"><span className="welcome-spark"><Sparkles size={18} /></span><div><h2>Your career picture starts with evidence.</h2><p>Add a resume, project, certificate, or GitHub link. TalentGraph will help connect your skills to the work behind them.</p><Link to="/app/documents" className="text-link">Add your first evidence <ArrowRight size={16} /></Link></div></div><div className="welcome-art"><div className="art-ring"><div className="art-core"><Activity size={26} /></div></div><span className="art-orb orb-one"></span><span className="art-orb orb-two"></span><span className="art-orb orb-three"></span></div></div>
      <div className="metric-grid"><Metric icon={FileText} label="Documents" value={documentCount} note="Evidence items" tone="blue" href="/app/documents" /><Metric icon={GraduationCap} label="Career paths" value={careers?.length || "—"} note={careers?.length ? "Recommendations ready" : "Build your profile first"} tone="purple" href="/app/careers" /><Metric icon={BriefcaseBusiness} label="Job matches" value={matches?.items?.length || "—"} note="Open opportunities" tone="green" href="/app/jobs" /><Metric icon={Gauge} label="Profile status" value={profileStatus[0]} note={profileStatus[1]} tone="orange" href="/app/profile" /></div>
      <DashboardJobSearch profile={profile} initialMatches={matches?.items || []} />
      <div className="dashboard-grid"><section className="content-card"><div className="card-heading"><div><h3>Get started</h3><p>A few steps to make your profile useful</p></div><span className="step-count">01 / 03</span></div><div className="checklist"><Checklist done={documentCount > 0} title="Add career evidence" subtitle="Resume, projects, certificates, or GitHub" href="/app/documents" /><Checklist done={Boolean(data?.consent_ai_processing)} title="Review your AI consent" subtitle="You control whether your data is processed" href="/app/settings" /><Checklist done={Boolean(profile?.id)} title="Build your career profile" subtitle="Synthesize evidence and explore career paths" href="/app/profile" /></div></section><section className="content-card"><div className="card-heading"><div><h3>Recent activity</h3><p>Your workspace at a glance</p></div><Activity size={19} className="muted-icon" /></div>{docs?.length ? <div className="resource-list">{docs.slice(0, 3).map((doc) => <article className="resource-row" key={doc.id}><span className="resource-icon"><FileText size={18} /></span><div><b>{doc.title || doc.original_filename || doc.doc_type}</b><small>{doc.doc_type} · {new Date(doc.created_at).toLocaleDateString()}</small></div><span className={`status-tag status-${doc.status}`}>{doc.status}</span></article>)}</div> : <div className="activity-empty"><span><Activity size={20} /></span><b>Your activity will show up here</b><p>Upload an item to begin building your career profile.</p></div>}</section></div></>}
  </div>;
}

function Metric({ icon: Icon, label, value, note, tone, href }) {
  return <div className="metric-card"><span className={`metric-icon metric-${tone}`}><Icon size={18} /></span><div className="metric-label">{label}</div><strong>{value}</strong><small>{note}</small><Link className="metric-link" to={href} aria-label={`Go to ${label}`} title={`Go to ${label}`}><ArrowRight size={15} /></Link></div>;
}
function Checklist({ done, title, subtitle, href }) {
  return <Link className="checklist-item" to={href}><span className={`check-circle ${done ? "checked" : ""}`}>{done && <Check size={13} />}</span><span><b>{title}</b><small>{subtitle}</small></span><ChevronRight size={16} /></Link>;
}

function DashboardJobSearch({ profile, initialMatches }) {
  const [role, setRole] = useState("");
  const [matches, setMatches] = useState(initialMatches);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async (event) => {
    event.preventDefault();
    const query = role.trim();
    if (query.length < 2) {
      setError("Enter at least 2 characters to search job titles.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api(`/jobs/matches?${new URLSearchParams({ role: query, min_score: "0", limit: "5" })}`);
      setMatches(result.items || []);
      setSearched(true);
    } catch (requestError) {
      setError(requestError.message || "Could not search jobs. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const featuredMatch = searched ? matches[0] : initialMatches[0];
  const score = featuredMatch?.compatibility_score;
  const roleTitle = featuredMatch?.jobs?.title || role || "a recommended role";
  const applicationUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  };
  const roleResults = matches.map((match) => ({
    match,
    applyUrl: applicationUrl(match.jobs?.official_apply_url),
  }));

  return <section className="content-card dashboard-job-search">
    <div className="dashboard-job-heading">
      <div><span className="eyebrow">YOUR NEXT STEP</span><h2>Check your job readiness</h2><p>See how your evidence lines up with a role, then go directly to the employer’s application page.</p></div>
      {profile?.id && Number.isFinite(score) ? <div className="readiness-score" style={{ "--readiness": `${score}%` }} aria-label={`${score}% match for ${roleTitle}`}><strong>{score}%</strong><small>job match</small></div> : <div className="readiness-score readiness-unavailable"><BriefcaseBusiness size={22} /><small>{profile?.id ? "Search a role" : "Build your profile"}</small></div>}
    </div>
    {!profile?.id && <p className="readiness-hint">Build your profile from processed evidence to calculate a role-specific match. <Link to="/app/profile">Build your profile <ArrowRight size={14} /></Link></p>}
    <form className="dashboard-role-form" onSubmit={search}>
      <label className="sr-only" htmlFor="dashboard-role-search">Search job role</label>
      <Search size={18} aria-hidden="true" />
      <input id="dashboard-role-search" value={role} onChange={(event) => setRole(event.target.value)} placeholder="Search a job role, e.g. Frontend Developer" maxLength={120} />
      <Button type="submit" disabled={busy}>{busy ? "Searching…" : "Search roles"}</Button>
    </form>
    {error && <p className="dashboard-search-error" role="alert">{error}</p>}
    {searched && roleResults.length > 0 && <div className="dashboard-role-results" aria-live="polite">
      {roleResults.map(({ match, applyUrl }) => <article className="dashboard-role-result" key={match.id}>
        <div><b>{match.jobs?.title || "Open role"}</b><small>{match.jobs?.company_name || "Company"} · {match.jobs?.location || (match.jobs?.is_remote ? "Remote" : "Location not specified")}</small></div>
        <span className="score-pill">{match.compatibility_score}% match</span>
        {applyUrl
          ? <a className="button button-primary" href={applyUrl} target="_blank" rel="noopener noreferrer">Apply <ArrowRight size={15} /></a>
          : <span className="apply-unavailable">Application link unavailable</span>}
      </article>)}
    </div>}
    {searched && roleResults.length === 0 && <p className="dashboard-search-empty" role="status">{profile?.id ? "No open matched roles found for that title. Try a broader role name or check Job matches." : "Build your profile first to see job matches for this role."}</p>}
    {!searched && featuredMatch && <p className="readiness-hint">Top match: <b>{roleTitle}</b> at {featuredMatch.jobs?.company_name || "an employer"}. Search a specific role to explore more.</p>}
  </section>;
}

function useQueryWrap(path, pollProcessing = false, userId, enabled = true) {
  const query = useQuery({
    queryKey: ["api", userId, path],
    enabled,
    queryFn: async () => {
      const result = await api(path);
      if (path === "/documents" && !Array.isArray(result)) {
        throw new Error("The document list returned an unexpected response. Please retry.");
      }
      return result;
    },
    staleTime: 15_000,
    refetchInterval: (current) => {
      const rows = current.state.data;
      return pollProcessing && Array.isArray(rows) && rows.some((item) => ["uploaded", "processing"].includes(item.status))
        ? 2500
        : false;
    },
    refetchIntervalInBackground: false,
  });
  return {
    ...query,
    data: query.data ?? null,
    hasData: query.data !== undefined,
  };
}

const routeMeta = {
  documents: ["YOUR EVIDENCE", "Documents", "Bring together the work and experience that shows what you can do."],
  profile: ["YOUR STORY", "Candidate profile", "A unified view of your experience and evidence-backed skills."],
  evidence: ["CLAIMS & PROOF", "Evidence review", "See which skills are supported, which need context, and what may be missing."],
  careers: ["EXPLORE DIRECTIONS", "Career paths", "Explore career directions that may fit your skills and experience."],
  jobs: ["OPEN OPPORTUNITIES", "Job matches", "Compare your evidence with active roles from configured job sources."],
  "skill-gaps": ["PLAN YOUR GROWTH", "Skill roadmap", "Turn a career direction into practical learning and project milestones."],
  "admin/jobs": ["JOB SOURCE MANAGEMENT", "Job administration", "Manage permitted job sources and add verified manual vacancies."],
  notifications: ["YOUR UPDATES", "Notifications", "Updates about your profile and matching opportunities."],
  preferences: ["MAKE IT YOURS", "Preferences", "Set the locations, roles, and work styles that matter to you."],
  settings: ["ACCOUNT & PRIVACY", "Settings", "Manage your consent, data export, and account."],
};

function ResourcePage({ resource, session }) {
  const [eyebrow, title, description] = routeMeta[resource];
  const [jobFilters, setJobFilters] = useState({});
  const paths = { documents: "/documents", profile: "/profile", evidence: "/evidence", careers: "/careers", jobs: `/jobs/matches?${new URLSearchParams(jobFilters).toString()}`, "skill-gaps": "/skill-gaps", notifications: "/notifications", preferences: "/preferences", settings: "/me" };
  const { data, hasData, isLoading, error, refetch } = useQueryWrap(paths[resource], resource === "documents", session?.user?.id);
  const { data: candidateProfile, isLoading: isProfileLoading } = useQueryWrap(
    "/profile",
    false,
    session?.user?.id,
    resource === "jobs",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [profilePolling, setProfilePolling] = useState(false);
  const [profilePollCount, setProfilePollCount] = useState(0);
  const [profileBuildStartedAt, setProfileBuildStartedAt] = useState(null);
  const [profileBuildBaseline, setProfileBuildBaseline] = useState(null);
  useEffect(() => {
    if (!profilePolling) return undefined;
    if (profilePollCount >= 120) {
      setProfilePolling(false);
      setNotice(data?.id && data.version !== profileBuildBaseline
        ? "Your profile was generated, but recommendations are taking longer than expected. You can review your profile and check Career paths again shortly."
        : "Profile building is taking longer than expected. Check notifications before retrying.");
      return undefined;
    }
    const timer = setTimeout(async () => {
      refetch();
      setProfilePollCount((count) => count + 1);
      try {
        const notifications = await api("/notifications");
        const buildNotice = notifications.find((item) =>
          Date.parse(item.created_at) >= Date.parse(profileBuildStartedAt)
          && (item.type === "profile_ready" || item.title === "Profile build failed"));
        if (buildNotice?.type === "profile_ready") {
          setProfilePolling(false);
          setNotice("Your profile and career recommendations are ready.");
        } else if (buildNotice?.title === "Profile build failed") {
          setProfilePolling(false);
          setNotice(`${buildNotice.body || "Profile building failed."} Check your processed documents and try again.`);
        }
      } catch {
        setNotice("Profile building continues, but its status could not be refreshed. Check notifications shortly.");
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [data, profileBuildBaseline, profileBuildStartedAt, profilePollCount, profilePolling, refetch]);
  const action = resource === "documents" ? <a href="#add-evidence" className="button button-primary"><UploadCloud size={17} /> Add evidence</a> : resource === "profile" ? <Button disabled={busy || profilePolling} onClick={async () => { try { setBusy(true); setNotice(""); const startedAt = new Date().toISOString(); await apiJson("/profile/build", "POST", {}); setProfileBuildBaseline(data?.version ?? null); setProfileBuildStartedAt(startedAt); setProfilePollCount(0); setProfilePolling(true); setNotice("Profile build started. We’ll keep you updated as the profile and recommendations are prepared."); refetch(); } catch (e) { setNotice(e.message); } finally { setBusy(false); } }}><Sparkles size={16} /> {profilePolling ? "Building profile…" : "Build my profile"}</Button> : resource === "careers" ? <Button disabled={busy} onClick={async () => { try { setBusy(true); await apiJson("/careers/refresh", "POST", {}); setNotice("Career refresh queued. Refresh this page in a few moments."); refetch(); } catch (e) { setNotice(e.message); } finally { setBusy(false); } }}><Sparkles size={16} /> Refresh recommendations</Button> : null;
  const empty = (Array.isArray(data) && data.length === 0) || (resource === "profile" && !data?.id) || (resource === "evidence" && !data?.supported_skills) || (resource === "jobs" && !data?.items?.length);
  return <div className="page-enter"><PageTitle eyebrow={eyebrow} title={title} description={description} action={action} />{["profile", "evidence", "careers", "jobs", "skill-gaps"].includes(resource) && <Disclaimer />}{notice && <div className={`form-message form-message-${messageTone(notice)}`} role="status">{notice}</div>}
    {resource === "documents" && <DocumentIntake onDone={() => { setNotice("Evidence received. Processing status will appear in the list."); refetch(); }} onError={(message) => setNotice(message)} />}
    {resource === "jobs" && <JobFilters onApply={setJobFilters} />}
    {resource === "skill-gaps" && hasData && <SkillGapForm onMessage={setNotice} onCreated={refetch} />}
    {isLoading && !hasData ? <LoadingState label={`Loading ${title.toLowerCase()}…`} /> : error && !hasData ? <LoadingError error={error} onRetry={refetch} /> : <>{error && hasData && <div className="form-message" role="status">Couldn’t refresh this information. Showing the last loaded data. <Button variant="secondary" onClick={refetch}>Retry</Button></div>}{empty ? <EmptyResource resource={resource} profileReady={candidateProfile?.id ? true : isProfileLoading ? undefined : false} /> : <ResourceContent resource={resource} data={data} busy={busy} onMessage={setNotice} onRefresh={refetch} />}</>}
  </div>;
}

function EmptyResource({ resource, action, profileReady }) {
  const labels = { documents: "No evidence added yet", profile: "Your profile has not been built yet", evidence: "Evidence mapping appears after your profile is built", careers: "Build a profile to explore career paths", jobs: "There are no matching open roles yet", "skill-gaps": "Choose a career or job to create a roadmap", notifications: "You’re all caught up", preferences: "No preferences saved yet" };
  const needsProfile = resource === "jobs" && profileReady === false;
  const title = needsProfile ? "Build your profile to see job matches" : labels[resource] || "Nothing to show yet";
  const description = needsProfile
    ? "Job matches are calculated from your processed evidence and current profile. Build your profile first, then return to explore roles."
    : "As you add information, this space will show verified and explainable insights.";
  const nextAction = action || (needsProfile
    ? <Link className="button button-primary" to="/app/profile"><Sparkles size={16} /> Build my profile</Link>
    : null);
  return <div className="empty-panel"><span className="empty-icon"><FileText size={22} /></span><h2>{title}</h2><p>{description}</p>{nextAction}</div>;
}

function InterviewPage() {
  const [targetRole, setTargetRole] = useState("");
  const [interviewType, setInterviewType] = useState("general");
  const [difficultyLevel, setDifficultyLevel] = useState("medium");
  const [interviews, setInterviews] = useState([]);
  const [current, setCurrent] = useState(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [mediaStream, setMediaStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [faceAway, setFaceAway] = useState(false);
  const videoRef = useRef(null);
  const speechRequestRef = useRef(0);
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const microphoneStreamRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream;
  }, [mediaStream]);
  useEffect(() => {
    if (!mediaStream || current?.status !== "in_progress") {
      setFaceAway(false);
      return undefined;
    }

    let cancelled = false;
    let animationFrame = 0;
    let detector;
    let lastDetection = 0;
    let faceMissingSince = null;
    let facePresentSince = null;

    const startDetection = async () => {
      try {
        const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm",
        );
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          },
          minDetectionConfidence: 0.6,
          runningMode: "VIDEO",
        });
        if (cancelled) {
          detector.close();
          return;
        }

        const checkFrame = (timestamp) => {
          if (cancelled) return;
          animationFrame = window.requestAnimationFrame(checkFrame);
          const video = videoRef.current;
          if (timestamp - lastDetection < 500 || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          lastDetection = timestamp;

          try {
            const faceFound = detector.detectForVideo(video, timestamp).detections.length > 0;
            if (faceFound) {
              faceMissingSince = null;
              if (facePresentSince === null) facePresentSince = timestamp;
              if (timestamp - facePresentSince >= 750) setFaceAway(false);
            } else {
              facePresentSince = null;
              if (faceMissingSince === null) faceMissingSince = timestamp;
              if (timestamp - faceMissingSince >= 2000) setFaceAway(true);
            }
          } catch {
            cancelled = true;
            setNotice("The camera reminder stopped working. You can continue the interview; camera video is not uploaded.");
          }
        };
        animationFrame = window.requestAnimationFrame(checkFrame);
      } catch {
        if (!cancelled) setNotice("The camera reminder could not start. You can continue the interview; camera video is not uploaded.");
      }
    };

    void startDetection();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      detector?.close();
      setFaceAway(false);
    };
  }, [mediaStream, current?.status]);
  useEffect(() => () => {
    window.clearTimeout(recordingTimerRef.current);
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
    }
    mediaStream?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, [mediaStream]);
  useEffect(() => () => {
    speechRequestRef.current += 1;
    window.speechSynthesis?.cancel();
  }, []);
  useEffect(() => {
    if (current?.status !== "completed") return;
    window.clearTimeout(recordingTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setIsRecording(false);
    setMediaStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, [current?.status]);

  const requestMedia = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera and microphone access is unavailable. Use a current browser on localhost or HTTPS.");
    }
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  };
  const stopMedia = () => {
    window.clearTimeout(recordingTimerRef.current);
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
      recorderRef.current = null;
    }
    audioChunksRef.current = [];
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    setIsRecording(false);
    setMediaStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
  };

  const loadInterviews = useCallback(async () => {
    try { setInterviews(await api("/interviews")); } catch (error) { setNotice(error.message); }
  }, []);
  useEffect(() => { loadInterviews(); }, [loadInterviews]);

  const deleteInterview = async (interview) => {
    if (!window.confirm(`Permanently delete the mock interview for ${interview.target_role}? Its transcript and feedback will also be deleted.`)) return;
    try {
      setBusy(true);
      await api(`/interviews/${interview.id}`, { method: "DELETE" });
      setInterviews((rows) => rows.filter((row) => row.id !== interview.id));
      setNotice("Mock interview deleted.");
    } catch (error) { setNotice(error.message); } finally { setBusy(false); }
  };

  const start = async (event) => {
    event.preventDefault();
    let stream;
    try {
      setBusy(true); setNotice("");
      stream = await requestMedia();
      const interview = await apiJson("/interviews", "POST", { target_role: targetRole, interview_type: interviewType, difficulty_level: difficultyLevel });
      setMediaStream(stream); setCurrent(interview); setAnswer("");
      await loadInterviews();
    } catch (error) { stream?.getTracks().forEach((track) => track.stop()); setNotice(error.message); } finally { setBusy(false); }
  };
  const openInterview = async (id) => {
    let stream;
    try {
      setBusy(true); setNotice("");
      const interview = await api(`/interviews/${id}`);
      if (interview.status === "in_progress") stream = await requestMedia();
      setMediaStream(stream || null); setCurrent(interview); setTargetRole(interview.target_role); setInterviewType(interview.interview_type); setDifficultyLevel(interview.difficulty_level || "medium"); setAnswer("");
    } catch (error) { stream?.getTracks().forEach((track) => track.stop()); setNotice(error.message); } finally { setBusy(false); }
  };
  const submitAnswer = async (event) => {
    event.preventDefault();
    if (!current || !answer.trim()) return;
    const submittedAnswer = answer.trim();
    stopQuestionPlayback();
    window.clearTimeout(recordingTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    setIsRecording(false);
    try {
      setBusy(true); setNotice("");
      const interview = await apiJson(`/interviews/${current.id}/answers`, "POST", { answer: submittedAnswer });
      setCurrent(interview); setAnswer("");
      await loadInterviews();
    } catch (error) {
      let failureMessage = error.message;
      try {
        const latest = await api(`/interviews/${current.id}`);
        const acceptedAnswer = latest.transcript?.[current.transcript.length];
        if (acceptedAnswer?.role === "candidate" && acceptedAnswer.content === submittedAnswer) {
          setCurrent(latest);
          setAnswer("");
          setNotice("Your answer was received. The interview has been updated.");
          await loadInterviews();
          return;
        }
      } catch (reconcileError) {
        failureMessage = `${failureMessage} The interview status could not be verified, so your answer was kept.`;
      }
      setNotice(`Could not get the next question. Your answer is still here; please try submitting it again. ${failureMessage}`);
    } finally { setBusy(false); }
  };
  const finishInterview = async () => {
    if (!current || !window.confirm("Finish this interview now and generate feedback from submitted answers? Your unsent draft will not be included.")) return;
    stopQuestionPlayback();
    stopMedia();
    try {
      setBusy(true); setNotice("");
      const interview = await apiJson(`/interviews/${current.id}/finish`, "POST", {});
      setCurrent(interview); setAnswer("");
      await loadInterviews();
    } catch (error) { setNotice(error.message); } finally { setBusy(false); }
  };
  const transcript = current?.transcript || [];
  const nextIsCandidate = transcript.at(-1)?.role === "interviewer" && current?.status === "in_progress";
  const stopRecording = () => {
    window.clearTimeout(recordingTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  };
  const startSpeechInput = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setNotice("Audio recording is not supported in this browser. You can type your answer instead.");
      return;
    }
    setNotice("");
    try {
      microphoneStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const requestedType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((type) => window.MediaRecorder.isTypeSupported(type));
      const recorder = new window.MediaRecorder(microphoneStreamRef.current, {
        ...(requestedType ? { mimeType: requestedType } : {}),
        audioBitsPerSecond: 64_000,
      });
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        window.clearTimeout(recordingTimerRef.current);
        recorder.onstop = null;
        setNotice("Microphone recording failed. Check browser and Windows microphone permissions, or type your answer.");
        microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
      };
      recorder.onstop = async () => {
        window.clearTimeout(recordingTimerRef.current);
        const recording = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
        if (!recording.size) { setNotice("No audio was captured. Check the selected microphone and try again."); return; }
        if (recording.size > 15 * 1024 * 1024) { setNotice("That recording is too large. Try a shorter answer."); return; }
        const formData = new FormData();
        formData.append("audio", recording, "answer");
        try {
          setBusy(true); setNotice("Transcribing your answer…");
          const result = await api(`/interviews/${current.id}/transcribe`, { method: "POST", body: formData });
          if (!result.transcript) {
            setNotice("We couldn’t make out speech in that recording. Try again in a quieter place or type your answer.");
            return;
          }
          setAnswer((previous) => [previous.trim(), result.transcript].filter(Boolean).join(" "));
          setNotice("Transcription ready. Review or edit it before submitting.");
        } catch (error) {
          setNotice(error.message);
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start(500);
      setIsRecording(true);
      setNotice("Recording your answer. Stop when you’re done; recordings are sent for transcription and then discarded. Maximum length: 5 minutes.");
      recordingTimerRef.current = window.setTimeout(stopRecording, 5 * 60_000);
    } catch (error) {
      if (recorderRef.current) {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
        recorderRef.current = null;
      }
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError" || error.name === "SecurityError") {
        setNotice("Microphone permission is blocked. Click the site controls icon beside the address bar, set Microphone to Allow for 127.0.0.1, reload, and try again.");
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        setNotice("No microphone was detected. Connect or enable a microphone, then try again.");
      } else {
        setNotice(error.message || "Could not start the microphone. Check browser and Windows microphone permissions, or type your answer.");
      }
    }
  };
  const stopQuestionPlayback = () => {
    speechRequestRef.current += 1;
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  };
  const readQuestionAloud = () => {
    const question = transcript.at(-1)?.content;
    if (!question) { setNotice("There is no interview question to read aloud right now."); return; }
    if (isSpeaking) { stopQuestionPlayback(); return; }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setNotice("Question read-aloud is not supported in this browser.");
      return;
    }
    const requestId = speechRequestRef.current + 1;
    speechRequestRef.current = requestId;
    const utterance = new window.SpeechSynthesisUtterance(question);
    utterance.lang = navigator.language;
    utterance.onend = () => {
      if (requestId === speechRequestRef.current) setIsSpeaking(false);
    };
    utterance.onerror = () => {
      if (requestId === speechRequestRef.current) {
        setNotice("The browser could not read the question aloud. Try again or check your system speech settings.");
        setIsSpeaking(false);
      }
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setNotice("");
    setIsSpeaking(true);
  };
  const leaveInterview = () => {
    window.speechSynthesis?.cancel();
    stopQuestionPlayback();
    stopMedia();
    setCurrent(null);
  };

  return <div className="page-enter">
    <PageTitle eyebrow="PRACTICE & PREPARE" title="Video mock interview" description="Practice with your camera on. Questions use your saved profile skills and credentials when available; this is practice, not an assessment." />
    <Disclaimer />
    {notice && <div className={`form-message form-message-${messageTone(notice)}`} role="status">{notice}</div>}
    {!current ? <section className="content-card">
      <h3>Start a practice interview</h3>
      <p>Allow camera access to begin. Choose a difficulty and the interview will keep all 10 questions at that level. When you choose to speak, a recording of up to five minutes is sent to Gemini for transcription and then discarded by TalentGraph; video is never recorded or uploaded. Only the text transcript is saved with the session. AI-processing consent is required.</p>
      <form className="admin-form" onSubmit={start}>
        <label className="field"><span>Target role</span><input required minLength="2" maxLength="120" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="e.g. Junior frontend developer" /></label>
        <label className="field"><span>Interview style</span><select value={interviewType} onChange={(event) => setInterviewType(event.target.value)}><option value="general">General</option><option value="behavioral">Behavioral</option><option value="technical">Technical</option></select></label>
        <label className="field"><span>Difficulty level</span><select value={difficultyLevel} onChange={(event) => setDifficultyLevel(event.target.value)}><option value="easy">Easy — foundational questions</option><option value="medium">Medium — practical, intermediate questions</option><option value="hard">Hard — advanced reasoning and trade-offs</option></select></label>
        <Button type="submit" disabled={busy}>{busy ? "Requesting camera and starting…" : "Start 10-question video interview"} <Video size={16} /></Button>
      </form>
    </section> : <section className="content-card">
      <div className="card-heading"><div><h3>{current.target_role}</h3><p>{current.interview_type} · {current.difficulty_level || "medium"} difficulty · {current.questions_asked} of {current.question_limit} questions</p></div><div className="interview-controls">{current.status === "in_progress" && <Button variant="danger" disabled={busy} onClick={finishInterview}><LogOut size={15} />Quit &amp; get feedback</Button>}<Button variant="secondary" disabled={busy} onClick={leaveInterview}>Back to sessions</Button></div></div>
      {current.status === "in_progress" && <div className="interview-video-layout"><div className="interview-video-frame">{mediaStream ? <video ref={videoRef} autoPlay playsInline muted aria-label="Your live camera preview" /> : <div className="interview-video-placeholder"><Video size={28} /><span>Camera preview unavailable</span></div>}{faceAway && <div className="camera-presence-warning" role="alert"><AlertTriangle size={20} /><div><b>Please stay in front of the camera</b><span>We can’t see you. Move back into the camera frame to continue.</span></div></div>}{mediaStream && <span className="camera-live"><span /> Camera on</span>}</div><div className="interview-video-note"><b>Private practice</b><p>Your camera stays in this browser and is never recorded or uploaded. Face presence is checked locally in your browser; no video frames are sent or saved. Question read-aloud uses only your browser’s speech voice. When you choose voice input, a short audio recording is sent to Gemini for transcription; TalentGraph does not persist the audio. Your text answer is saved with the session.</p></div></div>}
      <div className="interview-transcript" aria-live="polite">
        {transcript.map((turn, index) => <article className={`interview-turn interview-${turn.role}`} key={`${current.id}-${index}`}><b>{turn.role === "interviewer" ? "Interviewer" : "You"}</b><p>{turn.content}</p></article>)}
      </div>
      {nextIsCandidate && <><div className="interview-controls"><Button variant="secondary" onClick={readQuestionAloud}><Volume2 size={16} />{isSpeaking ? "Stop reading" : "Read question aloud"}</Button><Button variant={isRecording ? "danger" : "secondary"} disabled={busy} onClick={() => isRecording ? stopRecording() : startSpeechInput()}>{isRecording ? <MicOff size={16} /> : <Mic size={16} />}{isRecording ? "Stop recording" : "Record answer (max 5 min)"}</Button></div><form className="admin-form" onSubmit={submitAnswer}><label className="field"><span>Your transcribed or typed answer</span><textarea rows="5" maxLength="6000" required value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={busy ? "Transcribing…" : "Record your answer or type it here…"} /></label><Button type="submit" disabled={busy || isRecording || !answer.trim()}>{busy ? "Thinking…" : current.questions_asked >= current.question_limit ? "Finish and get feedback" : "Submit answer"} <ArrowRight size={16} /></Button></form></>}
      {current.status === "completed" && current.final_feedback && <section className="content-card interview-feedback"><h3>Interview debrief</h3>{current.final_feedback.session_summary && <><h4>Session summary</h4><p>{current.final_feedback.session_summary}</p></>}<h4>Overall feedback</h4><p>{current.final_feedback.overall_feedback}</p>{current.final_feedback.strengths?.length > 0 && <><h4>What went well</h4><ul className="card-list">{current.final_feedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul></>}{current.final_feedback.areas_to_improve?.length > 0 && <><h4>Growth areas</h4><ul className="card-list">{current.final_feedback.areas_to_improve.map((item) => <li key={item}>{item}</li>)}</ul></>}{current.final_feedback.development_suggestions?.length > 0 && <><h4>Development plan</h4><ul className="card-list">{current.final_feedback.development_suggestions.map((item) => <li key={item.focus}><b>{item.focus}:</b> {item.action}</li>)}</ul></>}<p><b>Practice tip:</b> {current.final_feedback.example_tip}</p></section>}
    </section>}
    {!current && interviews.length > 0 && <section className="content-card"><h3>Previous practice sessions</h3><div className="resource-list">{interviews.map((interview) => <article className="resource-row" key={interview.id}><div><b>{interview.target_role}</b><small>{interview.interview_type} · {interview.difficulty_level || "medium"} · {new Date(interview.created_at).toLocaleDateString()}</small></div><span className={`status-tag status-${interview.status}`}>{interview.status.replace("_", " ")}</span><div className="interview-session-actions"><Button variant="secondary" disabled={busy || interview.status === "failed"} onClick={() => openInterview(interview.id)}>{interview.status === "in_progress" ? "Continue" : "Review feedback"}</Button><Button variant="danger" aria-label={`Delete ${interview.target_role} mock interview`} disabled={busy} onClick={() => deleteInterview(interview)}><Trash2 size={15} /><span>Delete</span></Button></div></article>)}</div></section>}
  </div>;
}

function ResourceContent({ resource, data, busy, onMessage, onRefresh }) {
  if (resource === "settings") return <SettingsContent data={data} onMessage={onMessage} />;
  if (resource === "preferences") return <PreferencesContent data={data} onMessage={onMessage} />;
  if (resource === "profile") return <ProfileContent data={data} onMessage={onMessage} />;
  if (resource === "evidence") return <EvidenceContent data={data} />;
  if (resource === "notifications") return <NotificationContent data={data} onMessage={onMessage} />;
  if (resource === "documents") {
    if (!Array.isArray(data)) return <LoadingError error={new Error("The document list returned an unexpected response. Please retry.")} onRetry={onRefresh} />;
    return <div className="resource-list">{data.map((doc) => <article className="resource-row" key={doc.id}><span className="resource-icon"><FileText size={18} /></span><div><b>{doc.title || doc.original_filename || doc.doc_type}</b><small>{doc.doc_type} · {new Date(doc.created_at).toLocaleDateString()}</small>{doc.error_message && <small className="form-error">{doc.error_message}</small>}</div><span className={`status-tag status-${doc.status}`}>{doc.status}</span>{doc.status === "failed" && <button className="text-action" disabled={busy} onClick={async () => { try { await api(`/documents/${doc.id}/retry`, { method: "POST" }); onMessage("Retry started."); onRefresh(); } catch (error) { onMessage(error.message); } }}>Retry</button>}{doc.original_filename && <button className="text-action" onClick={async () => { try { const result = await api(`/documents/${doc.id}/download`); window.open(result.url, "_blank", "noopener,noreferrer"); } catch (error) { onMessage(error.message); } }}>Download</button>}<button className="text-action" disabled={busy} onClick={async () => { if (!window.confirm("Delete this document?")) return; try { await api(`/documents/${doc.id}`, { method: "DELETE" }); onRefresh(); onMessage("Document deleted."); } catch (e) { onMessage(e.message); } }}>Delete</button></article>)}</div>;
  }
  const items = Array.isArray(data) ? data : data?.items || [];
  if (resource === "careers") return <div className="resource-grid">{items.map((item) => <CareerCard key={item.id} item={item} onMessage={onMessage} />)}</div>;
  if (resource === "jobs") return <div className="resource-grid">{items.map((item) => <MatchCard key={item.id} item={item} onMessage={onMessage} />)}</div>;
  if (resource === "skill-gaps") return <div className="resource-grid">{items.map((item) => <SkillGapCard key={item.id} item={item} onDelete={async (roadmap) => {
    if (!window.confirm("Permanently delete this skill roadmap? This cannot be undone.")) return;
    try { await api(`/skill-gaps/${roadmap.id}`, { method: "DELETE" }); onMessage("Skill roadmap deleted."); onRefresh(); } catch (error) { onMessage(error.message); }
  }} />)}</div>;
  return <div className="resource-grid">{items.map((item) => <article className="content-card resource-card" key={item.id || item.career_title || item.title}><div className="resource-card-top"><span className="resource-icon"><BriefcaseBusiness size={18} /></span>{item.compatibility_score !== undefined && <span className="score-pill">{item.compatibility_score}% fit</span>}{item.suitability_score !== undefined && <span className="score-pill">{item.suitability_score}% fit</span>}</div><h3>{item.career_title || item.jobs?.title || item.title || item.name || item.type || "Insight"}</h3><p>{item.reasoning || item.explanation?.why_recommended || item.description || item.summary || item.body || item.status || "Evidence-based insights will appear when available."}</p>{item.company_name && <small className="company-line">{item.company_name} · {item.location || (item.is_remote ? "Remote" : "Location not specified")}</small>}{item.jobs && <small className="company-line">{item.jobs.company_name} · {item.jobs.location || (item.jobs.is_remote ? "Remote" : "Location not specified")}</small>}{Array.isArray(item.missing_skills) && <small>{item.missing_skills.length} skill gaps to explore</small>}{item.jobs?.official_apply_url && <a className="text-link" href={item.jobs.official_apply_url} target="_blank" rel="noopener noreferrer">View official posting <ArrowRight size={15} /></a>}{item.official_apply_url && <a className="text-link" href={item.official_apply_url} target="_blank" rel="noopener noreferrer">View official posting <ArrowRight size={15} /></a>}</article>)}</div>;
}

function CareerCard({ item, onMessage }) {
  const [busy, setBusy] = useState(false);
  const missing = (item.missing_skills || []).map((skill) => typeof skill === "string" ? skill : skill.skill);
  const createRoadmap = async () => {
    try { setBusy(true); await apiJson("/skill-gaps", "POST", { target_type: "career", career_id: item.id }); onMessage(`Roadmap created for ${item.career_title}.`); } catch (error) { onMessage(error.message); } finally { setBusy(false); }
  };
  return <article className="content-card resource-card"><div className="resource-card-top"><span className="resource-icon"><GraduationCap size={18} /></span><span className="score-pill">{item.suitability_score}% fit</span></div><h3><Link to={`/app/careers/${item.id}`}>{item.career_title}</Link></h3><small className="company-line">{item.domain}{item.is_stretch ? " · Stretch path" : ""}</small><p>{item.reasoning}</p>{item.supporting_strengths?.length > 0 && <p><b>Strengths:</b> {item.supporting_strengths.join(", ")}</p>}{missing.length > 0 && <p><b>Skills to grow:</b> {missing.join(", ")}</p>}{item.recommended_improvements?.length > 0 && <ul className="card-list">{item.recommended_improvements.slice(0, 3).map((text) => <li key={text}>{text}</li>)}</ul>}<Button variant="secondary" disabled={busy} onClick={createRoadmap}>{busy ? "Creating…" : "Create skill roadmap"} <ArrowRight size={14} /></Button></article>;
}

function JobFilters({ onApply }) {
  const [values, setValues] = useState({ location: "", company: "", min_score: "", remote: "", sort: "score" });
  const submit = (event) => {
    event.preventDefault();
    onApply(Object.fromEntries(Object.entries(values).filter(([, value]) => value)));
  };
  return <form className="content-card job-filters" onSubmit={submit}><label className="field"><span>Location</span><input value={values.location} onChange={(event) => setValues({ ...values, location: event.target.value })} placeholder="Any location" /></label><label className="field"><span>Company</span><input value={values.company} onChange={(event) => setValues({ ...values, company: event.target.value })} placeholder="Any company" /></label><label className="field"><span>Minimum score</span><select value={values.min_score} onChange={(event) => setValues({ ...values, min_score: event.target.value })}><option value="">Any</option><option value="40">40%</option><option value="60">60%</option><option value="75">75%</option><option value="90">90%</option></select></label><label className="field"><span>Workplace</span><select value={values.remote} onChange={(event) => setValues({ ...values, remote: event.target.value })}><option value="">Any</option><option value="true">Remote</option><option value="false">On-site</option></select></label><label className="field"><span>Sort by</span><select value={values.sort} onChange={(event) => setValues({ ...values, sort: event.target.value })}><option value="score">Best match</option><option value="recent">Most recent</option></select></label><Button type="submit"><Search size={15} /> Apply filters</Button></form>;
}

function MatchCard({ item, onMessage }) {
  const [saved, setSaved] = useState(item.is_saved);
  const [dismissed, setDismissed] = useState(item.is_dismissed);
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState(item.explanation);
  const job = item.jobs;
  const updateMatch = async (update) => {
    try { setBusy(true); await apiJson(`/jobs/matches/${item.id}`, "PATCH", update); if ("is_saved" in update) setSaved(update.is_saved); if ("is_dismissed" in update) setDismissed(update.is_dismissed); } catch (error) { onMessage(error.message); } finally { setBusy(false); }
  };
  const explain = async () => {
    try { setBusy(true); setExplanation(await apiJson(`/jobs/${item.job_id}/explain`, "POST", {})); } catch (error) { onMessage(error.message); } finally { setBusy(false); }
  };
  return <article className={`content-card resource-card ${dismissed ? "dismissed-card" : ""}`}><div className="resource-card-top"><span className="resource-icon"><BriefcaseBusiness size={18} /></span><span className="score-pill">{item.compatibility_score}% fit</span></div><h3><Link to={`/app/jobs/${item.job_id}`}>{job?.title || "Open role"}</Link></h3><small className="company-line">{job?.company_name} · {job?.location || (job?.is_remote ? "Remote" : "Location not specified")}</small>{job?.job_type && <small className="company-line">{job.job_type.replace("_", " ")}</small>}<div className="score-breakdown">{Object.entries(item.score_breakdown || {}).map(([label, score]) => <span key={label}>{label} <b>{score}%</b></span>)}</div>{explanation && <p>{explanation.why_recommended}</p>}{item.missing_skills?.length > 0 && <small className="company-line">Gaps: {item.missing_skills.join(", ")}</small>}{item.eligibility_flags?.length > 0 && <small className="company-line">Check eligibility: {item.eligibility_flags.map((flag) => flag.constraint).join(", ")}</small>}<div className="card-actions">{job?.official_apply_url && <a className="button button-primary" href={job.official_apply_url} target="_blank" rel="noopener noreferrer">Official apply link <ArrowRight size={14} /></a>}<Button variant="secondary" disabled={busy} onClick={() => updateMatch({ is_saved: !saved })}>{saved ? "Saved" : "Save"}</Button><Button variant="secondary" disabled={busy} onClick={explain}>Why this match?</Button><Button variant="secondary" disabled={busy} onClick={() => updateMatch({ is_dismissed: true })}>Dismiss</Button></div></article>;
}

function SkillGapCard({ item, onDelete }) {
  const report = item.report || {};
  return <article className="content-card resource-card"><div className="resource-card-top"><span className="resource-icon"><Target size={18} /></span><span className="status-tag">{item.target_type} roadmap</span></div><h3>{report.roadmap?.[0]?.goals?.[0] || "Your learning roadmap"}</h3><small className="company-line">Created {new Date(item.created_at).toLocaleDateString()}</small>{report.missing_skills?.length > 0 && <p><b>Priority gaps:</b> {report.missing_skills.slice(0, 5).map((gap) => gap.skill).join(", ")}</p>}{report.recommended_projects?.map((project) => <small className="company-line" key={project.title}>Project: {project.title}</small>)}<div className="roadmap-preview">{(report.roadmap || []).map((phase) => <div key={phase.phase}><b>{phase.timeframe}</b><small>{phase.milestones?.[0] || phase.phase}</small></div>)}</div><div className="card-actions"><Button variant="danger" aria-label="Delete this skill roadmap" onClick={() => onDelete(item)}><Trash2 size={15} /><span>Delete roadmap</span></Button></div></article>;
}

function ResourceDetailPage({ resource, session }) {
  const { id } = useParams();
  const isCareer = resource === "career";
  const { data, isLoading, error, refetch } = useQueryWrap(isCareer ? `/careers/${id}` : `/jobs/${id}`, false, session?.user?.id);
  const [notice, setNotice] = useState("");
  if (isLoading) return <LoadingState label="Loading details…" />;
  if (error) return <LoadingError error={error} onRetry={refetch} />;
  return <div className="page-enter"><PageTitle eyebrow={isCareer ? "CAREER PATH" : "OPEN OPPORTUNITY"} title={isCareer ? data.career_title : data.title} description={isCareer ? data.domain : `${data.company_name} · ${data.location || "Location not specified"}`} action={!isCareer && data.official_apply_url ? <a className="button button-primary" href={data.official_apply_url} target="_blank" rel="noopener noreferrer">Official apply link <ArrowRight size={16} /></a> : null} />{notice && <div className="form-message" role="status">{notice}</div>}{isCareer && <Disclaimer />}<div className="detail-grid"><section className="content-card"><h3>{isCareer ? "Why this career may fit" : "Role overview"}</h3><p>{data.reasoning || data.description || "No additional description is available."}</p>{isCareer && <><h3 className="detail-subhead">Supporting strengths</h3><ul className="card-list">{(data.supporting_strengths || []).map((item) => <li key={item}>{item}</li>)}</ul><h3 className="detail-subhead">Recommended improvements</h3><ul className="card-list">{(data.recommended_improvements || []).map((item) => <li key={item}>{item}</li>)}</ul><Button variant="secondary" onClick={async () => { try { await apiJson("/skill-gaps", "POST", { target_type: "career", career_id: data.id }); setNotice("Skill roadmap created."); } catch (e) { setNotice(e.message); } }}>Create roadmap <Target size={15} /></Button></>}</section><section className="content-card"><h3>{isCareer ? "Suitability" : "Job requirements"}</h3>{isCareer ? <><div className="detail-score">{data.suitability_score}<small>/100</small></div>{Object.entries(data.score_breakdown || {}).map(([label, score]) => <div className="detail-bar" key={label}><span>{label.replace("_", " ")}</span><b>{score}%</b></div>)}</> : <><p>{data.is_remote ? "Remote" : data.location || "Location not specified"} · {data.job_type || "Type not specified"}</p><p>Experience: {data.min_experience_months || 0} months minimum</p><p>Required skills: {(data.required_skills || []).join(", ") || "Not specified"}</p><p>Preferred skills: {(data.preferred_skills || []).join(", ") || "Not specified"}</p><p>{data.description}</p></>}</section></div></div>;
}

function DocumentIntake({ onDone, onError }) {
  const [docType, setDocType] = useState("resume");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const textTypes = docType === "text_note";
  const linkType = docType === "github_profile" || docType === "portfolio_link";
  const submit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData();
    body.append("doc_type", docType);
    if (title.trim()) body.append("title", title.trim());
    if (textTypes) body.append("text", text);
    if (linkType) body.append("url", url.trim());
    if (!textTypes && !linkType) {
      const file = form.elements.namedItem("file").files?.[0];
      if (!file) { onError("Choose a PDF or image to upload."); return; }
      body.append("file", file);
    }
    try {
      setBusy(true);
      await api("/documents", { method: "POST", body });
      setTitle(""); setText(""); setUrl("");
      form.reset();
      onDone();
    } catch (error) {
      onError(error.message);
    } finally { setBusy(false); }
  };
  return <form id="add-evidence" className="content-card document-intake" onSubmit={submit}>
    <div><h3>Add career evidence</h3><p>Upload a document, add a text note, or link a public GitHub profile.</p></div>
    <label className="field"><span>Evidence type</span><select value={docType} onChange={(event) => setDocType(event.target.value)}>{[["resume", "Resume"], ["certificate", "Certificate"], ["education_record", "Education record"], ["project_report", "Project report"], ["project_screenshot", "Project screenshot"], ["text_note", "Text note"], ["github_profile", "GitHub profile or repository"], ["portfolio_link", "Portfolio link"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="field"><span>Title (optional)</span><input value={title} maxLength="200" onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Backend project report" /></label>
    {textTypes ? <label className="field"><span>Text (up to 20,000 characters)</span><textarea rows="5" maxLength="20000" required value={text} onChange={(event) => setText(event.target.value)} placeholder="Add relevant experience, project context, or notes…" /></label> : linkType ? <label className="field"><span>{docType === "github_profile" ? "Public GitHub URL" : "Portfolio URL"}</span><input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder={docType === "github_profile" ? "https://github.com/username" : "https://example.com/portfolio"} /></label> : <label className="field"><span>File (PDF or image)</span><input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" /></label>}
    <Button type="submit" disabled={busy}>{busy ? <><span className="button-spinner" aria-hidden="true" /> Uploading securely…</> : <>Add evidence <ArrowRight size={15} /></>}</Button>
  </form>;
}

function ProfileContent({ data, onMessage }) {
  const skills = data.skills || [];
  return <div className="profile-content"><section className="content-card"><h3>Profile summary</h3><p>{data.summary}</p>{data.highest_education && <small className="company-line">Education: {data.highest_education}</small>}<small className="company-line">Experience: {data.total_experience_months || 0} months</small>{data.specializations?.length > 0 && <p><b>Specializations:</b> {data.specializations.join(", ")}</p>}{data.strengths?.length > 0 && <ul className="card-list">{data.strengths.map((strength) => <li key={strength.title}><b>{strength.title}:</b> {strength.reason}</li>)}</ul>}</section><section className="content-card"><h3>Evidence-backed skills</h3>{skills.length ? <div className="skill-list">{skills.map((skill) => <article key={skill.normalized_name || skill.name}><div><b>{skill.name}</b><small>{skill.level_reasoning}</small><small>Evidence: {skill.evidence_strength} · {skill.claimed ? "Claimed" : "Evidence-derived"}</small>{skill.evidence?.length > 0 && <details className="evidence-details"><summary>View evidence ({skill.evidence.length})</summary><ul>{skill.evidence.map((evidence, index) => <li key={`${skill.name}-${index}`}>{evidence.description} <small>({evidence.strength})</small></li>)}</ul></details>}</div><select aria-label={`Set ${skill.name} skill level`} defaultValue={skill.level} onChange={async (event) => { try { await apiJson(`/profile/skills/${encodeURIComponent(skill.normalized_name || skill.name)}`, "PATCH", { level: event.target.value, user_confirmed: true }); onMessage(`${skill.name} level updated.`); } catch (error) { onMessage(error.message); } }}><option value="strong">Strong</option><option value="intermediate">Intermediate</option><option value="basic">Basic</option><option value="needs_assessment">Needs assessment</option></select></article>)}</div> : <p>No skills have been assessed yet.</p>}</section>{[["Education", data.education], ["Work experience", data.work_experience], ["Projects", data.projects], ["Certifications", data.certifications]].map(([label, rows]) => <section className="content-card profile-records" key={label}><h3>{label}</h3>{rows?.length ? rows.map((row, index) => <article key={`${label}-${index}`}><b>{row.name || row.degree || row.role || row.title || row.company || label}</b><p>{row.description || row.field || row.institution || row.issuer || row.summary || ""}</p><small>{[row.start, row.end, row.start_year, row.end_year].filter(Boolean).join(" – ")}</small></article>) : <p>No {label.toLowerCase()} added.</p>}</section>)}</div>;
}

function EvidenceContent({ data }) {
  return <div className="evidence-grid">{[["Supported skills", data.supported_skills], ["Unsupported claims", data.unsupported_skills], ["Inconsistencies", data.inconsistencies], ["Missing information", data.missing_information], ["Needs assessment", data.needs_assessment]].map(([title, entries]) => <section className="content-card" key={title}><h3>{title}</h3>{entries?.length ? <ul>{entries.map((entry, index) => <li key={`${title}-${index}`}>{typeof entry === "string" ? entry : entry.skill ? `${entry.skill}: ${entry.note || entry.suggested_assessment || ""}` : entry.description}</li>)}</ul> : <p>No items to display.</p>}</section>)}</div>;
}

function notificationTone(type) {
  if (["new_match", "profile_unlock", "job_reopened", "profile_ready"].includes(type)) return "positive";
  if (type === "system") return "negative";
  return "neutral";
}

function NotificationContent({ data, onMessage }) {
  const [notifications, setNotifications] = useState(data);
  const markAllRead = async () => {
    try {
      await apiJson("/notifications/read-all", "POST", {});
      setNotifications((rows) => rows.map((row) => ({ ...row, is_read: true })));
      window.dispatchEvent(new Event("talentgraph-notifications-updated"));
      onMessage("All notifications marked as read.");
    } catch (error) { onMessage(error.message); }
  };
  const deleteNotification = async (item) => {
    try {
      await api(`/notifications/${item.id}`, { method: "DELETE" });
      setNotifications((rows) => rows.filter((row) => row.id !== item.id));
      window.dispatchEvent(new Event("talentgraph-notifications-updated"));
      onMessage("Notification deleted.");
    } catch (error) { onMessage(error.message); }
  };
  return <><div className="notification-tools"><Button variant="secondary" onClick={markAllRead}>Mark all as read</Button></div><div className="resource-list">{notifications.map((item) => <article className={`resource-row notification-row notification-${notificationTone(item.type)}`} key={item.id}><span className="resource-icon"><Bell size={18} /></span><div><b>{item.title}</b><small>{item.body || item.type} · {new Date(item.created_at).toLocaleString()}</small></div><div className="notification-actions">{!item.is_read && <Button variant="secondary" onClick={async () => { try { await api(`/notifications/${item.id}/read`, { method: "PATCH" }); setNotifications((rows) => rows.map((row) => row.id === item.id ? { ...row, is_read: true } : row)); window.dispatchEvent(new Event("talentgraph-notifications-updated")); onMessage("Notification marked as read."); } catch (error) { onMessage(error.message); } }}>Mark read</Button>}<Button variant="danger" aria-label={`Delete ${item.title} notification`} onClick={() => deleteNotification(item)}><Trash2 size={15} /><span>Delete</span></Button></div></article>)}</div></>;
}

function SkillGapForm({ onMessage, onCreated }) {
  const [careers, setCareers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [targetType, setTargetType] = useState("career");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([api("/careers"), api("/jobs/matches?limit=100")]).then(([careerRows, jobRows]) => {
      setCareers(careerRows || []);
      setMatches(jobRows?.items || []);
    }).catch((error) => onMessage(error.message));
  }, [onMessage]);
  const options = targetType === "career" ? careers.map((career) => [career.id, career.career_title]) : matches.map((match) => [match.job_id, `${match.jobs?.title || "Role"} — ${match.jobs?.company_name || "Company"}`]);
  const create = async () => {
    if (!targetId) { onMessage("Choose a career or open job first."); return; }
    const body = targetType === "career" ? { target_type: targetType, career_id: targetId } : { target_type: targetType, job_id: targetId };
    try { setBusy(true); await apiJson("/skill-gaps", "POST", body); onMessage("Skill roadmap created."); onCreated(); } catch (error) { onMessage(error.message); } finally { setBusy(false); }
  };
  return <section className="content-card gap-builder"><div><h3>Create a skill roadmap</h3><p>Choose a recommended career path or open matched job for a personalized plan.</p></div><div className="gap-builder-controls"><label className="field"><span>Target type</span><select value={targetType} onChange={(event) => { setTargetType(event.target.value); setTargetId(""); }}><option value="career">Career path</option><option value="job">Matched job</option></select></label><label className="field"><span>Target</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Select a target</option>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><Button disabled={busy || !options.length} onClick={create}>{busy ? "Creating…" : "Build roadmap"} <ArrowRight size={15} /></Button></div></section>;
}

function PreferencesContent({ data, onMessage }) {
  const [locations, setLocations] = useState((data?.preferred_locations || []).join(", "));
  const [roles, setRoles] = useState((data?.target_roles || []).join(", "));
  const [excludedCompanies, setExcludedCompanies] = useState((data?.excluded_companies || []).join(", "));
  const save = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
      const prefs = { preferred_locations: locations.split(",").map((x) => x.trim()).filter(Boolean), target_roles: roles.split(",").map((x) => x.trim()).filter(Boolean), excluded_companies: excludedCompanies.split(",").map((x) => x.trim()).filter(Boolean), experience_level: form.get("experience_level"), open_to_remote: form.get("open_to_remote") === "on", notify_new_matches: form.get("notify_new_matches") === "on", notify_min_score: Number(form.get("notify_min_score") || 65), min_salary: form.get("min_salary") ? Number(form.get("min_salary")) : null, job_types: form.getAll("job_types") };
    try { await apiJson("/preferences", "PUT", prefs); onMessage("Preferences saved."); } catch (e) { onMessage(e.message); }
  };
    return <form className="content-card preferences-form" onSubmit={save}><label className="field"><span>Preferred locations (comma-separated)</span><input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="e.g. Bengaluru, Remote" /></label><label className="field"><span>Target roles (comma-separated)</span><input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="e.g. Backend Engineer" /></label><label className="field"><span>Excluded companies (comma-separated)</span><input value={excludedCompanies} onChange={(e) => setExcludedCompanies(e.target.value)} placeholder="Companies to exclude" /></label><label className="field"><span>Experience level</span><select name="experience_level" defaultValue={data?.experience_level || "fresher"}>{["student", "fresher", "junior", "mid", "senior"].map((x) => <option key={x}>{x}</option>)}</select></label><fieldset className="preference-types"><legend>Job types</legend>{[["full_time", "Full-time"], ["part_time", "Part-time"], ["internship", "Internship"], ["contract", "Contract"]].map(([value, label]) => <label className="toggle-row" key={value}><input type="checkbox" name="job_types" value={value} defaultChecked={(data?.job_types || []).includes(value)} /> {label}</label>)}</fieldset><label className="field"><span>Minimum salary</span><input type="number" name="min_salary" min="0" defaultValue={data?.min_salary ?? ""} /></label><label className="toggle-row"><input type="checkbox" name="open_to_remote" defaultChecked={data?.open_to_remote ?? true} /> Open to remote roles</label><label className="toggle-row"><input type="checkbox" name="notify_new_matches" defaultChecked={data?.notify_new_matches ?? true} /> Notify me about new matches (in-app and by email when configured)</label><label className="field"><span>Minimum match score for notifications</span><input type="number" name="notify_min_score" min="0" max="100" defaultValue={data?.notify_min_score ?? 65} /></label><Button type="submit">Save preferences <Check size={16} /></Button></form>;
}

function SettingsContent({ data, onMessage }) {
  const [hasConsent, setHasConsent] = useState(data?.consent_ai_processing || false);
  const setConsent = async (value) => {
    try { await apiJson("/me", "PATCH", { consent_ai_processing: value }); setHasConsent(value); onMessage(value ? "AI processing consent enabled." : "AI processing consent withdrawn."); } catch (error) { onMessage(error.message); }
  };
  return <div className="settings-grid"><section className="content-card"><h3>AI processing consent</h3><p>Consent is required before TalentGraph sends your submitted evidence for AI analysis.</p><Button variant="secondary" onClick={() => setConsent(!hasConsent)}>{hasConsent ? "Withdraw consent" : "Allow AI processing"}</Button></section><section className="content-card"><h3>Your data</h3><p>Download a copy of your TalentGraph account data.</p><Button variant="secondary" onClick={async () => { try { const exported = await api("/account/export"); const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "talentgraph-export.json"; link.click(); URL.revokeObjectURL(link.href); } catch (e) { onMessage(e.message); } }}>Export data <ArrowRight size={16} /></Button></section><section className="content-card danger-card"><h3>Delete account</h3><p>This permanently deletes your account and associated TalentGraph data.</p><Button variant="danger" onClick={async () => { if (!window.confirm("Permanently delete your account and all associated data?")) return; try { await api("/account", { method: "DELETE" }); await supabase.auth.signOut(); window.location.assign("/"); } catch (e) { onMessage(e.message); } }}>Delete account</Button></section></div>;
}

function AdminJobsPage({ isRecruiter = false }) {
  const [sources, setSources] = useState([]);
  const [adapter, setAdapter] = useState("greenhouse");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const emptyManualJob = { company_name: "", title: "", description: "", required_skills: "", preferred_skills: "", education_requirement: "", min_experience_months: "0", max_experience_months: "", job_type: "", location: "", is_remote: false, salary_min: "", salary_max: "", salary_currency: "", eligibility_constraints: "", application_deadline: "", official_apply_url: "" };
  const [manual, setManual] = useState(emptyManualJob);
  const loadSources = async () => {
    try { setSources(await api("/admin/job-sources")); } catch (error) { setNotice(error.message); }
  };
  useEffect(() => {
    let active = true;
    api("/admin/job-sources").then((items) => { if (active) setSources(items); }).catch((error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);
  const addSource = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { adapter, company_name: form.get("company_name"), ...(adapter === "manual" ? {} : { board_token: form.get("board_token") }) };
    try { setBusy(true); await apiJson("/admin/job-sources", "POST", body); setNotice("Job source added."); event.currentTarget.reset(); await loadSources(); } catch (error) { setNotice(error.message); } finally { setBusy(false); }
  };
  const sync = async () => {
    try { setBusy(true); const result = await apiJson("/admin/jobs/sync", "POST", {}); setNotice(`Sync finished. ${result.reduce((sum, item) => sum + (item.synced || 0), 0)} vacancies updated.`); await loadSources(); } catch (error) { setNotice(error.message); } finally { setBusy(false); }
  };
  const addManualJob = async (event) => {
    event.preventDefault();
    const splitList = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
    const body = {
      ...manual,
      required_skills: splitList(manual.required_skills),
      preferred_skills: splitList(manual.preferred_skills),
      eligibility_constraints: splitList(manual.eligibility_constraints),
      education_requirement: manual.education_requirement || null,
      min_experience_months: Number(manual.min_experience_months || 0),
      max_experience_months: manual.max_experience_months ? Number(manual.max_experience_months) : null,
      job_type: manual.job_type || null,
      location: manual.location || null,
      salary_min: manual.salary_min ? Number(manual.salary_min) : null,
      salary_max: manual.salary_max ? Number(manual.salary_max) : null,
      salary_currency: manual.salary_currency ? manual.salary_currency.toUpperCase() : null,
      application_deadline: manual.application_deadline || null,
    };
    try { setBusy(true); await apiJson("/admin/jobs", "POST", body); setNotice("Manual vacancy added."); setManual(emptyManualJob); } catch (error) { setNotice(error.message); } finally { setBusy(false); }
  };
  return (
    <div className="page-enter">
      <PageTitle
        eyebrow={isRecruiter ? "RECRUITER VACANCIES" : routeMeta["admin/jobs"][0]}
        title={isRecruiter ? "Post an Opening" : routeMeta["admin/jobs"][1]}
        description={isRecruiter ? "Publish a new role for your company. TalentGraph will match your opening with evidence-backed candidates." : routeMeta["admin/jobs"][2]}
        action={!isRecruiter && <Button disabled={busy} onClick={sync}><Activity size={16} /> Sync sources</Button>}
      />
      {notice && <div className="form-message" role="status">{notice}</div>}
      <div className="admin-grid">
        <section className="content-card">
          <h3>Add permitted source</h3>
          <form className="admin-form" onSubmit={addSource}>
            <label className="field"><span>Source type</span><select value={adapter} onChange={(event) => setAdapter(event.target.value)}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="manual">Manual</option></select></label>
            <label className="field"><span>Company name</span><input name="company_name" required maxLength="200" /></label>
            {adapter !== "manual" && <label className="field"><span>{adapter === "greenhouse" ? "Board token" : "Lever company slug"}</span><input name="board_token" required pattern="[A-Za-z0-9_-]+" /></label>}
            <Button type="submit" disabled={busy}>Add source</Button>
          </form>
          <div className="admin-source-list">{sources.map((source) => <article key={source.id}><div><b>{source.company_name}</b><small>{source.adapter} · {source.last_synced_at ? `Synced ${new Date(source.last_synced_at).toLocaleString()}` : "Not synced yet"}</small>{source.last_error && <small className="form-error">{source.last_error}</small>}</div><Button variant="secondary" disabled={busy} onClick={async () => { try { await apiJson(`/admin/job-sources/${source.id}`, "PATCH", { is_active: !source.is_active }); await loadSources(); } catch (error) { setNotice(error.message); } }}>{source.is_active ? "Pause" : "Enable"}</Button></article>)}</div>
        </section>
        <section className="content-card">
          <h3>Add manual vacancy</h3>
          <form className="admin-form" onSubmit={addManualJob}>
            <label className="field"><span>Company</span><input required maxLength="200" value={manual.company_name} onChange={(event) => setManual({ ...manual, company_name: event.target.value })} /></label>
            <label className="field"><span>Job title</span><input required maxLength="200" value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} /></label>
            <label className="field"><span>Official apply URL (HTTPS)</span><input type="url" required value={manual.official_apply_url} onChange={(event) => setManual({ ...manual, official_apply_url: event.target.value })} /></label>
            <label className="field"><span>Location</span><input maxLength="200" value={manual.location} onChange={(event) => setManual({ ...manual, location: event.target.value })} /></label>
            <label className="field"><span>Job type</span><select value={manual.job_type} onChange={(event) => setManual({ ...manual, job_type: event.target.value })}><option value="">Not specified</option><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="internship">Internship</option><option value="contract">Contract</option></select></label>
            <label className="field"><span>Required skills, comma-separated</span><input value={manual.required_skills} onChange={(event) => setManual({ ...manual, required_skills: event.target.value })} /></label>
            <label className="field"><span>Preferred skills, comma-separated</span><input value={manual.preferred_skills} onChange={(event) => setManual({ ...manual, preferred_skills: event.target.value })} /></label>
            <label className="field"><span>Education requirement</span><input maxLength="200" value={manual.education_requirement} onChange={(event) => setManual({ ...manual, education_requirement: event.target.value })} /></label>
            <div className="field-pair"><label className="field"><span>Minimum experience (months)</span><input type="number" min="0" value={manual.min_experience_months} onChange={(event) => setManual({ ...manual, min_experience_months: event.target.value })} /></label><label className="field"><span>Maximum experience (months)</span><input type="number" min="0" value={manual.max_experience_months} onChange={(event) => setManual({ ...manual, max_experience_months: event.target.value })} /></label></div>
            <div className="field-pair"><label className="field"><span>Minimum salary</span><input type="number" min="0" value={manual.salary_min} onChange={(event) => setManual({ ...manual, salary_min: event.target.value })} /></label><label className="field"><span>Maximum salary</span><input type="number" min="0" value={manual.salary_max} onChange={(event) => setManual({ ...manual, salary_max: event.target.value })} /></label></div>
            <label className="field"><span>Salary currency (3-letter code)</span><input maxLength="3" value={manual.salary_currency} onChange={(event) => setManual({ ...manual, salary_currency: event.target.value })} placeholder="USD" /></label>
            <label className="field"><span>Application deadline</span><input type="date" value={manual.application_deadline} onChange={(event) => setManual({ ...manual, application_deadline: event.target.value })} /></label>
            <label className="field"><span>Eligibility constraints, comma-separated</span><input value={manual.eligibility_constraints} onChange={(event) => setManual({ ...manual, eligibility_constraints: event.target.value })} /></label>
            <label className="field"><span>Job description</span><textarea rows="4" maxLength="8000" value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} /></label>
            <label className="toggle-row"><input type="checkbox" checked={manual.is_remote} onChange={(event) => setManual({ ...manual, is_remote: event.target.checked })} /> Remote role</label>
            <Button type="submit" disabled={busy}>Add vacancy <ArrowRight size={15} /></Button>
          </form>
        </section>
      </div>
    </div>
  );
}


function InquiryModal({ candidate, onClose, onSent }) {
  const [roleTitle, setRoleTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!roleTitle.trim() || !companyName.trim() || !message.trim()) {
      setError("Please fill out all required fields.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      await apiJson("/recruiter/inquiries", "POST", {
        candidate_id: candidate.id,
        role_title: roleTitle.trim(),
        company_name: companyName.trim(),
        message: message.trim(),
        recruiter_contact: {
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        },
      });
      onSent(`Inquiry sent to ${candidate.full_name}! They have been notified.`);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to send inquiry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inquiry-modal-backdrop" onClick={onClose}>
      <div className="inquiry-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Contact {candidate.full_name}</h3>
          <button className="text-action" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>
        <p>Send an opportunity inquiry directly to this candidate. They will receive an in-app alert and can accept to connect.</p>
        {error && <div className="form-message form-message-negative">{error}</div>}
        <form onSubmit={submit} className="inquiry-form">
          <label className="field">
            <span>Opportunity / Role Title *</span>
            <input required placeholder="e.g. Senior Frontend Engineer" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Company Name *</span>
            <input required placeholder="e.g. Acme Tech" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
          <label className="field">
            <span>Direct Message / Pitch *</span>
            <textarea required rows={4} placeholder="Explain why their verified skills and projects caught your attention, and what makes this opening a great fit..." value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="field-pair">
            <label className="field">
              <span>Your Work Email</span>
              <input type="email" placeholder="recruiter@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Your Phone / LinkedIn</span>
              <input placeholder="+1 (555) 012-3456" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "12px", justifyContent: "flex-end" }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send inquiry"} <Send size={15} /></Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RecruiterCandidatesPage() {
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [minExperience, setMinExperience] = useState("");
  const [education, setEducation] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const loadCandidates = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (skill) params.set("skill", skill);
      if (minExperience) params.set("min_experience", minExperience);
      if (education) params.set("education", education);
      const data = await api(`/recruiter/candidates?${params.toString()}`);
      setCandidates(data || []);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, skill, minExperience, education]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const quickSkills = ["React", "Python", "Node.js", "TypeScript", "SQL", "Machine Learning", "AWS"];

  return (
    <div className="page-enter">
      <PageTitle
        eyebrow="TALENT GRAPH &amp; DISCOVERY"
        title="Candidate Search"
        description="Search evidence-backed candidate profiles, explore verified skill capabilities, and contact talent directly."
      />
      {notice && <div className={`form-message form-message-${messageTone(notice)}`}>{notice}</div>}

      <div className="content-card recruiter-filters">
        <label className="field">
          <span>Search keyword or name</span>
          <input placeholder="e.g. React developer, John..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="field">
          <span>Filter by skill</span>
          <input placeholder="e.g. Python" value={skill} onChange={(e) => setSkill(e.target.value)} />
        </label>
        <label className="field">
          <span>Min. Experience</span>
          <select value={minExperience} onChange={(e) => setMinExperience(e.target.value)}>
            <option value="">Any experience</option>
            <option value="12">1+ year</option>
            <option value="24">2+ years</option>
            <option value="36">3+ years</option>
            <option value="60">5+ years</option>
          </select>
        </label>
        <label className="field">
          <span>Education</span>
          <select value={education} onChange={(e) => setEducation(e.target.value)}>
            <option value="">Any education</option>
            <option value="Bachelor">Bachelor's</option>
            <option value="Master">Master's</option>
            <option value="PhD">PhD / Doctorate</option>
          </select>
        </label>
      </div>

      <div className="skills-pills" style={{ marginBottom: "16px" }}>
        <span style={{ fontSize: "12px", color: "var(--muted)", alignSelf: "center", marginRight: "6px" }}>Quick filters:</span>
        {quickSkills.map((s) => (
          <button
            key={s}
            type="button"
            className={`skill-pill ${skill === s ? "skill-pill-strong" : ""}`}
            style={{ cursor: "pointer", border: "1px solid #dcdfe5", background: skill === s ? "#e0f2fe" : "#fff" }}
            onClick={() => setSkill(skill === s ? "" : s)}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Discovering talent profiles…" />
      ) : candidates.length === 0 ? (
        <div className="state-card">
          <Users size={28} />
          <b>No candidate profiles found</b>
          <p>No candidates match your current search filters. Try adjusting the skill keyword or clearing filters.</p>
          <Button variant="secondary" onClick={() => { setSearch(""); setSkill(""); setMinExperience(""); setEducation(""); }}>Clear filters</Button>
        </div>
      ) : (
        <div className="resource-grid">
          {candidates.map((cand) => (
            <article key={cand.id} className="content-card resource-card">
              <div className="resource-card-top">
                <span className="resource-icon"><UserRound size={18} /></span>
                <span className="score-pill">{Math.round((cand.total_experience_months || 0) / 12)} yrs experience</span>
              </div>
              <h3>{cand.full_name}</h3>
              <small className="company-line">{cand.highest_education} · {cand.total_experience_months || 0} months total exp</small>
              <p>{cand.summary}</p>
              
              <div className="skills-pills">
                {(cand.skills || []).slice(0, 6).map((sk) => (
                  <span key={sk.name} className={`skill-pill ${sk.level === "strong" ? "skill-pill-strong" : ""}`}>
                    {sk.name} <small style={{ opacity: 0.75 }}>({sk.level || "verified"})</small>
                  </span>
                ))}
              </div>

              {cand.projects?.length > 0 && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--muted)" }}>
                  <b>Recent project:</b> {cand.projects[0].title}
                </div>
              )}

              <div className="card-actions" style={{ marginTop: "16px" }}>
                <Button variant="primary" onClick={() => setSelectedCandidate(cand)}>
                  <Send size={14} /> Contact Candidate
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedCandidate && (
        <InquiryModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onSent={(msg) => setNotice(msg)}
        />
      )}
    </div>
  );
}

function RecruiterInquiriesPage() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api("/recruiter/inquiries");
      setInquiries(data || []);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-enter">
      <PageTitle
        eyebrow="RECRUITER OUTREACH"
        title="Sent Inquiries &amp; Requests"
        description="Track contact requests sent to candidates, view acceptances, and follow up directly."
      />
      {notice && <div className={`form-message form-message-${messageTone(notice)}`}>{notice}</div>}

      {loading ? (
        <LoadingState label="Loading sent inquiries…" />
      ) : inquiries.length === 0 ? (
        <div className="state-card">
          <Send size={28} />
          <b>No inquiries sent yet</b>
          <p>Find candidates on the Talent Graph and reach out with tailored job opportunities.</p>
          <Link to="/app/recruiter/candidates" className="button button-primary">Browse Candidates <ArrowRight size={15} /></Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {inquiries.map((inq) => (
            <article key={inq.id} className="inquiry-card">
              <div className="inquiry-header">
                <div>
                  <h4>Role: {inq.role_title}</h4>
                  <small className="company-line">Candidate: <b>{inq.candidate_name || "Candidate"}</b> · {inq.company_name} · Sent {new Date(inq.created_at).toLocaleDateString()}</small>
                </div>
                <span className={`status-tag status-${inq.status}`}>
                  {inq.status === "accepted" ? "Accepted" : inq.status === "declined" ? "Declined" : "Pending Review"}
                </span>
              </div>
              <div className="inquiry-body-text">
                <b>Your pitch:</b> {inq.message}
              </div>
              {inq.candidate_response && (
                <div className="inquiry-contact-box">
                  <b>Candidate Response:</b> {inq.candidate_response}
                </div>
              )}
              {inq.status === "accepted" && (
                <div style={{ marginTop: "10px", fontSize: "13px", color: "#15803d", fontWeight: "600" }}>
                  Candidate accepted! You can reach out directly via their account.
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateInquiriesPage() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [replyText, setReplyText] = useState({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api("/inquiries");
      setInquiries(data || []);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respond = async (id, status) => {
    try {
      const response = replyText[id] || "";
      await apiJson(`/inquiries/${id}`, "PATCH", { status, candidate_response: response });
      setNotice(status === "accepted" ? "Inquiry accepted! Your contact info was shared with the recruiter." : "Inquiry declined.");
      await load();
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <div className="page-enter">
      <PageTitle
        eyebrow="OPPORTUNITY INQUIRIES"
        title="Recruiter Messages &amp; Outreach"
        description="Recruiters who were impressed by your verified skills and want to discuss opportunities."
      />
      {notice && <div className={`form-message form-message-${messageTone(notice)}`}>{notice}</div>}

      {loading ? (
        <LoadingState label="Loading recruiter inquiries…" />
      ) : inquiries.length === 0 ? (
        <div className="state-card">
          <Mail size={28} />
          <b>No inquiries yet</b>
          <p>As you add more verified evidence and build your profile, recruiters exploring the Talent Graph can reach out to you directly.</p>
          <Link to="/app/profile" className="button button-primary">Enhance My Profile <ArrowRight size={15} /></Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {inquiries.map((inq) => (
            <article key={inq.id} className="inquiry-card">
              <div className="inquiry-header">
                <div>
                  <h4>{inq.company_name} — {inq.role_title}</h4>
                  <small className="company-line">Received {new Date(inq.created_at).toLocaleDateString()}</small>
                </div>
                <span className={`status-tag status-${inq.status}`}>
                  {inq.status === "accepted" ? "Connected" : inq.status === "declined" ? "Declined" : "Pending"}
                </span>
              </div>
              <div className="inquiry-body-text">
                {inq.message}
              </div>
              
              {inq.recruiter_contact && (inq.recruiter_contact.email || inq.recruiter_contact.phone || inq.recruiter_contact.linkedin) && (
                <div className="inquiry-contact-box" style={{ background: "#f8fafc", borderColor: "#cbd5e1", color: "#334155" }}>
                  <b>Recruiter Contact Info:</b>
                  {inq.recruiter_contact.email && <div>Email: <a href={`mailto:${inq.recruiter_contact.email}`}>{inq.recruiter_contact.email}</a></div>}
                  {inq.recruiter_contact.phone && <div>Phone: {inq.recruiter_contact.phone}</div>}
                  {inq.recruiter_contact.linkedin && <div>LinkedIn: <a href={inq.recruiter_contact.linkedin} target="_blank" rel="noreferrer">{inq.recruiter_contact.linkedin}</a></div>}
                </div>
              )}

              {inq.status === "pending" && (
                <div style={{ marginTop: "14px" }}>
                  <label className="field" style={{ marginBottom: "10px" }}>
                    <span>Optional reply message to the recruiter</span>
                    <input
                      placeholder="e.g. Thanks for reaching out! I would love to discuss this role."
                      value={replyText[inq.id] || ""}
                      onChange={(e) => setReplyText({ ...replyText, [inq.id]: e.target.value })}
                    />
                  </label>
                  <div className="inquiry-actions">
                    <Button variant="primary" onClick={() => respond(inq.id, "accepted")}>
                      <Check size={15} /> Accept &amp; Connect
                    </Button>
                    <Button variant="secondary" onClick={() => respond(inq.id, "declined")}>
                      Decline
                    </Button>
                  </div>
                </div>
              )}

              {inq.status === "accepted" && inq.candidate_response && (
                <div className="inquiry-contact-box">
                  <b>Your reply:</b> {inq.candidate_response}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function NotFound() {
  return <main className="not-found"><span>404</span><h1>We can’t find that page</h1><p>The link may be incorrect, or the page may have moved.</p><Link to="/" className="button button-primary">Go home</Link></main>;
}

function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);
  const signOut = async () => { await supabase.auth.signOut(); navigate("/"); };
  if (!authReady) return <div className="boot-screen"><Brand /><span>Preparing your workspace…</span></div>;
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Landing />} />
        <Route path="/login" element={session ? <Navigate to="/app/dashboard" replace /> : <AuthPage mode="login" />} />
        <Route path="/register" element={session ? <Navigate to="/app/dashboard" replace /> : <AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
      </Route>
      <Route element={<Protected session={session} />}>
        <Route path="/app" element={<Shell session={session} onSignOut={signOut} />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard session={session} />} />
          {Object.keys(routeMeta).filter((resource) => resource !== "admin/jobs").map((resource) => (
            <Route key={resource} path={resource} element={<ResourcePage resource={resource} session={session} />} />
          ))}
          <Route path="careers/:id" element={<ResourceDetailPage resource="career" session={session} />} />
          <Route path="jobs/:id" element={<ResourceDetailPage resource="job" session={session} />} />
          <Route path="interview" element={<InterviewPage />} />
          <Route path="admin/jobs" element={<AdminRoute session={session}><AdminJobsPage /></AdminRoute>} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
