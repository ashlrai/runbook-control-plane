"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  CircleAlert,
  Copy,
  Download,
  Fingerprint,
  LockKeyhole,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import {
  buildLabScopeSummary,
  EMPTY_LAB_QUALIFICATION,
  evaluateLabQualification,
  qualificationQuestions,
  type LabQualificationAnswers,
  type LabQualificationResult,
  type QualificationField,
} from "../lib/lab-qualification";
import styles from "./lab-qualification.module.css";

type CopyState = "idle" | "copied" | "downloaded" | "error";

const decisionClass: Record<LabQualificationResult["decision"], string> = {
  incomplete: styles.incomplete,
  "ready-for-human-review": styles.ready,
  "prepare-first": styles.prepare,
  "not-a-current-fit": styles.stopped,
};

export function LabQualification() {
  const [answers, setAnswers] = useState<LabQualificationAnswers>(EMPTY_LAB_QUALIFICATION);
  const [result, setResult] = useState<LabQualificationResult | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const answeredCount = Object.values(answers).filter(Boolean).length;

  function chooseAnswer(field: QualificationField, value: string) {
    setAnswers((current) => ({ ...current, [field]: value } as LabQualificationAnswers));
    setResult(null);
    setCopyState("idle");
  }

  function runFitCheck() {
    setResult(evaluateLabQualification(answers));
    setCopyState("idle");
  }

  function resetCheck() {
    setAnswers(EMPTY_LAB_QUALIFICATION);
    setResult(null);
    setCopyState("idle");
  }

  async function copySummary() {
    if (!result || result.decision === "incomplete") return;
    try {
      await navigator.clipboard.writeText(buildLabScopeSummary(answers, result));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  function downloadSummary() {
    if (!result || result.decision === "incomplete") return;
    try {
      const file = new Blob([buildLabScopeSummary(answers, result)], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "runbook-founding-lab-fit-summary.txt";
      link.click();
      URL.revokeObjectURL(url);
      setCopyState("downloaded");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Founding Creator Lab navigation">
        <Link className={styles.brand} href="/" aria-label="Runbook home"><BrandMark /><span>Runbook</span></Link>
        <Link className={styles.backLink} href="/proof-capsule"><ArrowLeft size={14} aria-hidden="true" /> Proof Capsule</Link>
      </nav>

      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}><BriefcaseBusiness size={16} aria-hidden="true" /> $499 Founding Creator Lab · local-answer preflight</div>
          <h1>Check the fit.<br /><span>Keep answers local.</span></h1>
          <p>Seven product-fit answers produce a deterministic readiness result in this browser. No name, email, profile, account, or brokerage data is requested or submitted.</p>
        </div>
        <div className={styles.privacyManifest} aria-label="Fit check privacy boundaries">
          <strong>LOCAL FIT-CHECK MANIFEST</strong>
          <div><span>Identity fields</span><b>none</b></div>
          <div><span>Browser storage</span><b>none</b></div>
          <div><span>Answer submission</span><b>none</b></div>
          <div><span>Payment</span><b>none</b></div>
          <div><span>Automated acceptance</span><b>never</b></div>
        </div>
      </header>

      <aside className={styles.notice}>
        <ShieldAlert size={16} aria-hidden="true" />
        <p><strong>This is a local-answer fit check, not an application submission.</strong> It does not reserve a place, accept an offer, provide investment advice, or authorize payment. A human must review any later scope.</p>
      </aside>

      <div className={styles.workspace}>
        <section className={styles.questions} aria-labelledby="questions-heading">
          <div className={styles.progressHead}>
            <div><span>Qualification gates</span><h2 id="questions-heading">Answer only what changes fit.</h2></div>
            <div className={styles.progress}><strong>{answeredCount} / {qualificationQuestions.length}</strong><span><i style={{ width: `${(answeredCount / qualificationQuestions.length) * 100}%` }} /></span></div>
          </div>

          {qualificationQuestions.map((question, questionIndex) => (
            <fieldset className={styles.question} key={question.id}>
              <legend>
                <span>{String(questionIndex + 1).padStart(2, "0")} · {question.eyebrow}</span>
                <strong>{question.question}</strong>
                <small>{question.helper}</small>
              </legend>
              <div className={styles.options}>
                {question.options.map((option) => {
                  const selected = answers[question.id] === option.value;
                  return (
                    <label className={selected ? styles.selectedOption : undefined} key={option.value}>
                      <input
                        type="radio"
                        name={question.id}
                        value={option.value}
                        checked={selected}
                        onChange={() => chooseAnswer(question.id, option.value)}
                      />
                      <span className={styles.radioMark}>{selected ? <Check size={12} aria-hidden="true" /> : null}</span>
                      <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className={styles.questionActions}>
            <button className={styles.checkButton} type="button" onClick={runFitCheck}><Fingerprint size={16} aria-hidden="true" /> Run local fit check</button>
            <button className={styles.resetButton} type="button" onClick={resetCheck}><RotateCcw size={14} aria-hidden="true" /> Clear answers</button>
            <small>Nothing is submitted. The result exists only in this open page.</small>
          </div>
        </section>

        <aside className={styles.resultRail} aria-label="Qualification result" aria-live="polite">
          <div className={styles.resultHead}>
            <span>READINESS RECEIPT</span>
            <em>deterministic · local</em>
          </div>
          {!result ? (
            <div className={styles.resultEmpty}>
              <Fingerprint size={26} aria-hidden="true" />
              <strong>No result yet</strong>
              <p>Complete the seven gates, then run the local check. Missing or unknown answers fail closed.</p>
            </div>
          ) : (
            <div className={`${styles.resultBody} ${decisionClass[result.decision]}`}>
              <div className={styles.decisionIcon}>{result.decision === "ready-for-human-review" ? <ShieldCheck size={25} aria-hidden="true" /> : <CircleAlert size={25} aria-hidden="true" />}</div>
              <span>{result.decision.replaceAll("-", " ")}</span>
              <h2>{result.title}</h2>
              <p>{result.summary}</p>

              {result.missingFields.length > 0 ? (
                <div className={styles.missingList}><strong>Still required</strong>{result.missingFields.map((field) => <span key={field}>{qualificationQuestions.find((question) => question.id === field)?.eyebrow}</span>)}</div>
              ) : (
                <div className={styles.gateList}>
                  {result.gates.map((item) => (
                    <div key={item.id} data-state={item.state}>
                      <span>{item.state}</span>
                      <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                    </div>
                  ))}
                </div>
              )}

              {result.decision !== "incomplete" ? (
                <div className={styles.summaryActions}>
                  <button type="button" onClick={copySummary}><Copy size={14} aria-hidden="true" />{copyState === "copied" ? "Summary copied" : "Copy non-PII summary"}</button>
                  <button type="button" onClick={downloadSummary}><Download size={14} aria-hidden="true" />{copyState === "downloaded" ? "Summary downloaded" : "Download .txt"}</button>
                  <small className={copyState === "error" ? styles.copyError : undefined}>{copyState === "error" ? "Local copy or download failed. Nothing was transmitted." : "The summary contains only these seven enumerated answers and the gate result."}</small>
                </div>
              ) : null}
            </div>
          )}
          <div className={styles.humanBoundary}>
            <LockKeyhole size={16} aria-hidden="true" />
            <div><strong>Human review remains mandatory</strong><p>Readiness means “worth a scope conversation,” never accepted, approved, reserved, or suitable for investing.</p></div>
          </div>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div><BrandMark /><span>Runbook</span></div>
        <p>No identity field, answer submission, analytics event, answer storage, payment, or brokerage access is implemented in this flow. Loading and navigating the site still use ordinary web requests.</p>
        <Link href="/proof-capsule">Return to Proof Capsule <ArrowLeft size={13} aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}
