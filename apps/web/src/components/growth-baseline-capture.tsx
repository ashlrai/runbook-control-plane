"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  CircleAlert,
  Clock3,
  Download,
  Eye,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { AppShell } from "./app-shell";
import {
  buildSocialBaselineExport,
  buildSocialBaselineRecord,
  socialBaselineSchema,
  summarizeSocialBaselines,
  type BioVariant,
  type CounterAvailability,
  type CounterAvailabilityKey,
  type SocialBaseline,
} from "../lib/social-baseline";
import { listSocialBaselines, saveSocialBaseline } from "../lib/local-store";
import styles from "./growth-baseline-capture.module.css";

const emptyAvailability: Record<CounterAvailabilityKey, CounterAvailability> = {
  following: "unclear",
  postsWithEngagement: "unclear",
  reactions: "unclear",
  comments: "unclear",
  impressions: "unclear",
  profileViews: "unclear",
};

const counterRows = [
  { id: "following", label: "Following", countName: "followingCount", countLabel: "Following count" },
  { id: "postsWithEngagement", label: "Posts with engagement", countName: "postsWithEngagementCount", countLabel: "Existing posts with visible engagement" },
  { id: "reactions", label: "Reactions / engagement", countName: "totalVisibleReactions", countLabel: "Total visible reactions across existing posts" },
  { id: "comments", label: "Comment counter", countName: "totalVisibleComments", countLabel: "Total visible comment count across existing posts" },
  { id: "impressions", label: "Impressions / reach", countName: "totalVisibleImpressions", countLabel: "Total visible impressions across existing posts" },
  { id: "profileViews", label: "Profile views", countName: "profileViewsCount", countLabel: "Visible profile-view count" },
] as const satisfies ReadonlyArray<{ id: CounterAvailabilityKey; label: string; countName: string; countLabel: string }>;

const bioOptions: ReadonlyArray<{ value: BioVariant; label: string; note: string }> = [
  { value: "unchanged", label: "Unchanged / pre-test", note: "No launch-packet bio variant is currently active." },
  { value: "A", label: "Variant A", note: "Small-account operator positioning." },
  { value: "B", label: "Variant B", note: "Human-plus-agent governance positioning." },
  { value: "C", label: "Variant C", note: "Rules-before-results positioning." },
];

const countFormatter = new Intl.NumberFormat("en-US");

function readRequiredCount(data: FormData, name: string): number {
  const value = data.get(name);
  return typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
}

function readAvailableCount(data: FormData, name: string, availability: CounterAvailability): number | null {
  return availability === "available" ? readRequiredCount(data, name) : null;
}

function formatCount(value: number | null) {
  return value === null ? "N/A" : countFormatter.format(value);
}

function formatDelta(value: number | null) {
  if (value === null) return "N/A";
  return `${value > 0 ? "+" : ""}${countFormatter.format(value)}`;
}

export function GrowthBaselineCapture() {
  const [records, setRecords] = useState<SocialBaseline[]>([]);
  const [availability, setAvailability] = useState(emptyAvailability);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    listSocialBaselines()
      .then((stored) => {
        if (!active) return;
        const parsed = stored.flatMap((item) => {
          const result = socialBaselineSchema.safeParse(item);
          return result.success ? [result.data] : [];
        }).toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt));
        setRecords(parsed);
        setLoadState(parsed.length === stored.length ? "ready" : "error");
        if (parsed.length !== stored.length) setMessage("Malformed local baseline records were excluded. No remote fallback was used.");
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
        setMessage("The local baseline database could not be read. No remote fallback was used.");
      });
    return () => { active = false; };
  }, []);

  const summary = useMemo(() => summarizeSocialBaselines(records), [records]);

  async function saveBaseline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const now = new Date();
    setSaveState("saving");
    setMessage("");
    try {
      const baseline = buildSocialBaselineRecord({
        capturedAtLocal: String(data.get("capturedAt") ?? ""),
        bioVariant: String(data.get("bioVariant") ?? "") as BioVariant,
        counterAvailability: availability,
        counts: {
          followerCount: readRequiredCount(data, "followerCount"),
          followingCount: readAvailableCount(data, "followingCount", availability.following),
          existingPostCount: readRequiredCount(data, "existingPostCount"),
          postsWithEngagementCount: readAvailableCount(data, "postsWithEngagementCount", availability.postsWithEngagement),
          totalVisibleReactions: readAvailableCount(data, "totalVisibleReactions", availability.reactions),
          totalVisibleComments: readAvailableCount(data, "totalVisibleComments", availability.comments),
          totalVisibleImpressions: readAvailableCount(data, "totalVisibleImpressions", availability.impressions),
          profileViewsCount: readAvailableCount(data, "profileViewsCount", availability.profileViews),
        },
      }, {
        baselineId: crypto.randomUUID(),
        recordedAt: now.toISOString(),
        nowMs: now.valueOf(),
      });
      await saveSocialBaseline(baseline.baselineId, baseline);
      setRecords((current) => [baseline, ...current].toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt)));
      setSaveState("saved");
      setMessage("Manual aggregate baseline saved only in this browser's IndexedDB.");
      form.reset();
      setAvailability(emptyAvailability);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message.slice(0, 240) : "The baseline could not be saved locally.");
    }
  }

  function exportJson() {
    if (records.length === 0) return;
    try {
      const contents = buildSocialBaselineExport(records, new Date().toISOString());
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "runbook-social-baselines.json";
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Non-identifying aggregate JSON exported locally.");
    } catch {
      setMessage("The local export failed. No data was transmitted.");
    }
  }

  return (
    <AppShell>
      <header className="topbar builder-topbar">
        <div>
          <Link className="back-link" href="/growth"><ArrowLeft size={13} aria-hidden="true" /> Growth cockpit</Link>
          <div className="breadcrumb">Robinhood Social <span>/</span> Manual baseline <span>/</span> Aggregate counts only</div>
          <h1>Social baseline capture</h1>
          <p>Record what is visibly present—without scraping, reconstructing, or collecting other people.</p>
        </div>
        <div className={styles.localMode}><LockKeyhole size={16} aria-hidden="true" /><span>Storage boundary</span><strong>Local IndexedDB only</strong></div>
      </header>

      <section className={styles.boundaryStrip} aria-label="Baseline collection boundaries">
        <div><ShieldCheck size={16} aria-hidden="true" /><span>Manual source</span><strong>No Robinhood access</strong></div>
        <div><UserRoundCheck size={16} aria-hidden="true" /><span>Data class</span><strong>Aggregate counts only</strong></div>
        <div><Eye size={16} aria-hidden="true" /><span>Excluded</span><strong>No posts, people, links, or symbols</strong></div>
        <div><BarChart3 size={16} aria-hidden="true" /><span>Inference</span><strong>Observational—not causal</strong></div>
      </section>

      <section className={styles.metricStrip} aria-label="Locally recorded baseline summary">
        <Metric label="Local snapshots" value={`${summary.recordCount}`} note={loadState === "error" ? "Some local data excluded" : "Strictly validated records"} />
        <Metric label="Latest followers" value={formatCount(summary.latestFollowerCount)} note="Manual point-in-time count" />
        <Metric label="Observed follower Δ" value={formatDelta(summary.observedFollowerDelta)} note="First → latest · not causal" />
        <Metric label="Existing posts" value={formatCount(summary.latestExistingPostCount)} note="Latest manual aggregate" />
      </section>

      <div className={styles.workspace}>
        <form className={styles.captureForm} onSubmit={saveBaseline}>
          <div className={styles.formHead}><div><span className="eyebrow">Starting profile snapshot</span><h2>Make one bounded observation.</h2></div><Clock3 size={21} aria-hidden="true" /></div>

          <section className={styles.identityFreeSection}>
            <div className={styles.sectionNumber}>01</div>
            <div>
              <span className="eyebrow">Time + profile state</span>
              <h3>When did you read the visible counters?</h3>
              <div className={styles.primaryFields}>
                <label>Manual capture date and time<input type="datetime-local" name="capturedAt" required /></label>
                <label>Follower count<input type="number" name="followerCount" required min="0" max="100000000" step="1" inputMode="numeric" /></label>
                <label>Existing Mason post count<input type="number" name="existingPostCount" required min="0" max="100000000" step="1" inputMode="numeric" /></label>
              </div>
              <fieldset className={styles.bioFieldset}>
                <legend>Current bio variant</legend>
                <div>{bioOptions.map((option) => <label key={option.value}><input type="radio" name="bioVariant" value={option.value} defaultChecked={option.value === "unchanged"} /><span><strong>{option.label}</strong><small>{option.note}</small></span></label>)}</div>
              </fieldset>
              <p className={styles.fieldNote}>The live bio text is never entered or stored. “Unchanged” means no A/B/C launch-packet variant is active.</p>
            </div>
          </section>

          <section className={styles.counterSection}>
            <div className={styles.sectionNumber}>02</div>
            <div>
              <span className="eyebrow">Visibility audit</span>
              <h3>Which counters are actually visible?</h3>
              <p>Choose one availability state per counter. A count is required only when marked available; unclear and unavailable stay null, never zero.</p>
              <div className={styles.counterTable}>
                <div className={styles.counterHeader}><span>Counter</span><span>Availability</span><span>Aggregate count</span></div>
                {counterRows.map((row) => (
                  <CounterRow
                    key={row.id}
                    id={row.id}
                    label={row.label}
                    countName={row.countName}
                    countLabel={row.countLabel}
                    availability={availability[row.id]}
                    onAvailabilityChange={(value) => setAvailability((current) => ({ ...current, [row.id]: value }))}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className={styles.attestationSection}>
            <div className={styles.sectionNumber}>03</div>
            <div>
              <span className="eyebrow">Manual-source attestation</span>
              <h3>Save a count, not a story.</h3>
              <label className={styles.attestation}><input type="checkbox" required /><span><strong>I read these counts manually in the Robinhood client.</strong><small>I did not scrape, upload, paste post content, or reconstruct a missing historical window.</small></span></label>
              <label className={styles.attestation}><input type="checkbox" required /><span><strong>This record contains Mason-only aggregate counts.</strong><small>No username, other-user data, comment text, screenshot, profile link, trade symbol, or post text is included.</small></span></label>
            </div>
          </section>

          <div className={styles.formActions}>
            <button className="button primary" type="submit" disabled={saveState === "saving"}>{saveState === "saving" ? "Saving locally…" : "Save manual baseline"}</button>
            <p className={saveState === "error" ? styles.errorMessage : undefined} aria-live="polite">{message || "No account connection, upload, analytics event, or network write is implemented."}</p>
          </div>
        </form>

        <aside className={styles.sideRail}>
          <section className={styles.limitsCard}>
            <div className={styles.sideHead}><div><span className="eyebrow">Interpretation contract</span><h2>What this can support</h2></div><CircleAlert size={20} aria-hidden="true" /></div>
            <div className={styles.limitRows}>
              <div data-state="yes"><Check size={14} aria-hidden="true" /><p><strong>Point-in-time description</strong><span>A manual count visible at the recorded time.</span></p></div>
              <div data-state="yes"><Check size={14} aria-hidden="true" /><p><strong>Raw observed change</strong><span>A difference between two schema-valid, manually entered snapshots.</span></p></div>
              <div data-state="no"><CircleAlert size={14} aria-hidden="true" /><p><strong>No causal attribution</strong><span>A post or bio cannot be credited for a follower change.</span></p></div>
              <div data-state="no"><CircleAlert size={14} aria-hidden="true" /><p><strong>No ranking inference</strong><span>Visible counters do not reveal Robinhood distribution logic.</span></p></div>
              <div data-state="no"><CircleAlert size={14} aria-hidden="true" /><p><strong>No historical reconstruction</strong><span>If a contemporaneous count was missed, preserve N/A.</span></p></div>
            </div>
          </section>

          <section className={styles.historyCard}>
            <div className={styles.sideHead}><div><span className="eyebrow">Local observation ledger</span><h2>Saved snapshots</h2></div><button type="button" onClick={exportJson} disabled={records.length === 0}><Download size={14} aria-hidden="true" /> Export JSON</button></div>
            {loadState === "loading" ? <div className={styles.emptyHistory}>Loading local snapshots…</div> : records.length === 0 ? <div className={styles.emptyHistory}><Clock3 size={20} aria-hidden="true" /><strong>No baseline saved yet</strong><span>Record the current counters before testing a profile change.</span></div> : (
              <div className={styles.historyList}>{records.slice(0, 8).map((record) => <article key={record.baselineId}><time>{new Date(record.capturedAt).toLocaleString()}</time><div><strong>{formatCount(record.counts.followerCount)} followers</strong><span>Bio {record.bioVariant} · {record.counts.existingPostCount} posts</span></div><em>{Object.values(record.counterAvailability).filter((value) => value === "available").length} / 6 counters</em></article>)}</div>
            )}
            <p className={styles.exportNote}>Export contains only validated local records, aggregate counts, fixed enum values, and explicit limitations.</p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function CounterRow({ id, label, countName, countLabel, availability, onAvailabilityChange }: {
  id: CounterAvailabilityKey;
  label: string;
  countName: string;
  countLabel: string;
  availability: CounterAvailability;
  onAvailabilityChange: (value: CounterAvailability) => void;
}) {
  return <div className={styles.counterRow}><strong>{label}</strong><fieldset aria-label={`${label} availability`}><label><input type="radio" name={`${id}Availability`} value="available" checked={availability === "available"} onChange={() => onAvailabilityChange("available")} /><span>Available</span></label><label><input type="radio" name={`${id}Availability`} value="not-available" checked={availability === "not-available"} onChange={() => onAvailabilityChange("not-available")} /><span>N/A</span></label><label><input type="radio" name={`${id}Availability`} value="unclear" checked={availability === "unclear"} onChange={() => onAvailabilityChange("unclear")} /><span>Unclear</span></label></fieldset><label><span className={styles.visuallyHidden}>{countLabel}</span><input type="number" name={countName} aria-label={countLabel} required={availability === "available"} disabled={availability !== "available"} min="0" max="100000000" step="1" inputMode="numeric" placeholder={availability === "available" ? "Required" : "N/A"} /></label></div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div><span>{label}</span><strong>{value}</strong><em>{note}</em></div>;
}
