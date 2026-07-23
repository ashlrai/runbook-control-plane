"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  ClipboardList,
  FilePlus2,
  Fingerprint,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  Link2,
  LockKeyhole,
  RadioTower,
  Repeat2,
  ShieldCheck,
  ShieldEllipsis,
  ScanSearch,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { BrandMark } from "./brand-mark";

type NavItem = {
  href: string;
  label: string;
  icon: typeof ShieldCheck;
  historical?: boolean;
};

const productNav: NavItem[] = [
  { href: "/session", label: "Session", icon: Link2 },
  { href: "/safety-card", label: "Safety Bench", icon: ShieldCheck },
  { href: "/registry", label: "Registry", icon: Layers3 },
  { href: "/control-room", label: "Control Room", icon: Gauge },
  { href: "/shadow-lab", label: "Shadow Lab", icon: Repeat2 },
  { href: "/dossier", label: "Dossier status", icon: ClipboardList },
  { href: "/mcp", label: "MCP cockpit", icon: Terminal },
  { href: "/gateway", label: "Gateway theater", icon: LockKeyhole },
  { href: "/experiments/new", label: "New experiment", icon: FilePlus2 },
  { href: "/verify", label: "Capsule verifier", icon: ScanSearch },
  { href: "/lineage", label: "Lineage atlas", icon: GitBranch },
  { href: "/trust", label: "Trust center", icon: ShieldEllipsis },
  { href: "/proof-capsule", label: "Proof capsule", icon: Fingerprint },
];
const researchNav: NavItem[] = [
  { href: "/content", label: "Publish desk", icon: RadioTower, historical: true },
  { href: "/growth", label: "Growth cockpit", icon: TrendingUp, historical: true },
  { href: "/public/mason-agentic-arena", label: "Public lab", icon: FlaskConical, historical: true },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      className={`nav-link ${active ? "is-active" : ""} ${item.historical ? "nav-link-historical" : ""}`}
      href={item.href}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span className="nav-link-label">
        {item.label}
        {item.historical ? <em>history</em> : null}
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>alpha</em>
        </Link>

        <div className="sidebar-kicker">Product</div>
        <nav aria-label="Main navigation">
          {productNav.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>

        <div className="sidebar-kicker">Research history</div>
        <nav aria-label="Research history">
          {researchNav.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>

        <div className="sidebar-rule" />
        <div className="safety-card">
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <strong>Observer mode</strong>
            <span>No credentials. No execution.</span>
          </div>
        </div>

        <div className="sidebar-foot">
          <BookOpenCheck size={15} aria-hidden="true" />
          <span>Mandate v1.0 · versioned</span>
        </div>
      </aside>
      <main className="main-canvas">{children}</main>
    </div>
  );
}
