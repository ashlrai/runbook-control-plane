import "./styles.css";
import { finalizeProofCapsule } from "@runbook/capsule-author";
import { serializeProofVerificationReceipt, verifyProofCapsule } from "@runbook/capsule-browser";
import {
  CREATOR_SEED_CAPSULE_ID,
  prepareCreatorFork,
  serializeCreatorForkReceipt,
  verifyPreparedCreatorFork,
  type CreatorForkChoice,
  type PreparedCreatorFork,
  type VerifiedCreatorSeed,
} from "@runbook/creator-proof";
import {
  activateStagedDeviceAuthorKey,
  inspectDeviceAuthorKey,
  provisionDeviceAuthorKey,
  signWithDeviceAuthorKey,
  type DeviceAuthorKeyDescriptor,
} from "@runbook/signer-browser";
import { requestDownload } from "./download.js";
import { inspectSignerEnvironment } from "./security.js";
import { CREATOR_SEED_ARCHIVE, openEmbeddedCreatorSeed } from "./seed.js";

type ReadyArtifact = {
  archive: Uint8Array;
  archiveSha256: string;
  capsuleId: string;
  coreReceipt: Uint8Array;
  domainReceipt: Uint8Array;
};

const CHOICES: { choice: CreatorForkChoice; label: string; delta: string; note: string }[] = [
  { choice: "concentration", label: "Reduce concentration", delta: "25% → 15% maximum position", note: "The boundary proposal becomes too concentrated." },
  { choice: "drawdown", label: "Tighten loss stop", delta: "8% → 4% drawdown stop", note: "The same synthetic drawdown now breaches policy." },
  { choice: "frequency", label: "Reduce action frequency", delta: "2 → 1 daily proposals", note: "The second proposal now exceeds the daily limit." },
  { choice: "evidence", label: "Raise evidence bar", delta: "2 → 3 minimum sources", note: "The same two-source proposal is no longer sufficient." },
];

const appElement = document.querySelector<HTMLDivElement>("#app");
if (appElement === null) throw new Error("signer.mount-missing");
const app = appElement;

let seed: VerifiedCreatorSeed | null = null;
let deviceKey: DeviceAuthorKeyDescriptor | null = null;
let prepared: PreparedCreatorFork | null = null;
let artifact: ReadyArtifact | null = null;
let selected: CreatorForkChoice = "concentration";
let busy = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paragraph(text: string, className?: string) {
  return element("p", className, text);
}

function definitionList(rows: readonly (readonly [string, string])[]) {
  const list = element("dl");
  for (const [term, description] of rows) {
    const row = element("div");
    row.append(element("dt", undefined, term), element("dd", undefined, description));
    list.append(row);
  }
  return list;
}

function replaceScreen(...content: Node[]) {
  const header = element("header", "mast");
  const wordmark = element("a", "wordmark", "RUNBOOK / SIGNING BENCH");
  wordmark.href = "#main";
  header.append(wordmark, element("span", undefined, "DEVICE-LOCAL AUTHORING PREVIEW"));

  const main = element("main");
  main.id = "main";
  main.append(...content);

  const footer = element("footer");
  footer.append(
    element("strong", undefined, "No network after readiness."),
    element("span", undefined, "No account · no broker · no recovery · no automated publication"),
  );
  app.replaceChildren(header, main, footer);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] as number) ^ (right[index] as number);
  return difference === 0;
}

function block(message: string) {
  const section = element("section", "blocked");
  section.setAttribute("role", "alert");
  section.tabIndex = -1;
  section.append(
    paragraph("SIGNING BLOCKED", "kicker"),
    element("h1", undefined, "This origin cannot use the device key."),
    paragraph(message),
    paragraph("Verification remains available on the main Runbook verifier. Do not work around this boundary."),
  );
  replaceScreen(section);
  section.focus();
}

function renderKeySetup() {
  const intro = element("section", "intro");
  const heading = element("h1");
  heading.append("Change one rule.", element("br"), element("em", undefined, "Sign exactly what changed."));
  intro.append(
    paragraph("ONE LOCAL KEY · ONE FIXED SYNTHETIC PARENT", "kicker"),
    heading,
    paragraph("This preview creates a self-asserted device key in this browser profile. Clearing site data or losing this device may permanently end access to it.", "lede"),
  );

  const gate = element("section", "key-gate");
  gate.setAttribute("aria-labelledby", "key-title");
  const body = element("div");
  const acknowledgement = element("label", "ack");
  const checkbox = element("input");
  checkbox.id = "key-ack";
  checkbox.type = "checkbox";
  acknowledgement.append(checkbox, " I understand there is no backup, recovery, rotation, or revocation in this preview.");
  const button = element("button", "primary", "Create unrelated device-local key");
  button.id = "create-key";
  button.disabled = true;
  body.append(
    paragraph("IRRECOVERABLE DEVICE KEY", "kicker"),
    element("h2", undefined, "No key record exists here."),
    paragraph("Runbook cannot tell whether this is first use or whether an earlier key was cleared. Any new fingerprint is unrelated to any earlier key and will not prove identity or continuity."),
    acknowledgement,
    button,
  );
  body.querySelector("h2")!.id = "key-title";
  gate.append(element("div", "gate-mark", "K0"), body);
  checkbox.addEventListener("change", () => { button.disabled = !checkbox.checked; });
  button.addEventListener("click", () => void createKey(button));
  replaceScreen(intro, gate);
}

function renderStagedActivation(staged: DeviceAuthorKeyDescriptor) {
  const gate = element("section", "key-gate");
  gate.setAttribute("aria-labelledby", "staged-title");
  const body = element("div");
  const heading = element("h1", undefined, "Finish validating the existing key.");
  heading.id = "staged-title";
  const button = element("button", "primary", "Retry exact-key validation");
  button.id = "activate-key";
  body.append(
    paragraph("STAGED KEY · SIGNING BLOCKED", "kicker"),
    heading,
    paragraph("A key record was saved, but its close/reopen sign-and-verify test did not finish. Retrying validates only this exact fingerprint; it does not create or replace a key."),
    definitionList([
      ["Staged fingerprint", staged.keyId],
      ["Browser storage response at creation", `${staged.storageModeAtCreation} · not a backup`],
    ]),
    button,
    paragraph("No backup, recovery, replacement, rotation, revocation, identity, or continuity is added."),
  );
  gate.append(element("div", "gate-mark", "K½"), body);
  button.addEventListener("click", () => void activateStagedKey(button, staged));
  replaceScreen(gate);
}

async function activateStagedKey(button: HTMLButtonElement, staged: DeviceAuthorKeyDescriptor) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  button.textContent = "Reload-testing exact key…";
  try {
    const active = await activateStagedDeviceAuthorKey();
    if (active.keyId !== staged.keyId || !equalBytes(active.publicSpkiDer, staged.publicSpkiDer)) {
      throw new Error("signer.staged-key-mismatch");
    }
    deviceKey = active;
    renderWorkbench();
  } catch {
    block("The existing staged key could not pass its reload validation. Signing remains blocked; no key was created or replaced.");
  } finally {
    busy = false;
  }
}

async function createKey(button: HTMLButtonElement) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  button.textContent = "Creating and reload-testing…";
  try {
    let persistent = false;
    try {
      persistent = await navigator.storage?.persist?.() ?? false;
    } catch {
      // A failed persistence request means best-effort storage, not permission to weaken the key checks.
    }
    const status = await provisionDeviceAuthorKey({
      createdAtDevice: new Date().toISOString(),
      createdByRelease: __SIGNER_RELEASE_ID__,
      storageModeAtCreation: persistent ? "persistent" : "best-effort",
    });
    deviceKey = status;
    renderWorkbench();
  } catch {
    block("Device key creation or its IndexedDB reload test failed. No replacement was generated.");
  } finally {
    busy = false;
  }
}

function renderWorkbench() {
  if (seed === null || deviceKey === null) return;
  prepared = null;
  artifact = null;
  selected = "concentration";

  const benchHead = element("section", "bench-head");
  const introduction = element("div");
  const explanation = element("p");
  explanation.append(
    "Pick one stricter rule. The same fixed synthetic proposal changes from ",
    element("strong", undefined, "human review"),
    " to ",
    element("strong", undefined, "rejected"),
    ". No trade occurs.",
  );
  introduction.append(
    paragraph("VERIFIED SYNTHETIC SEED", "kicker"),
    element("h1", undefined, "Make restraint visible."),
    explanation,
  );
  benchHead.append(
    introduction,
    definitionList([
      ["Parent capsule", CREATOR_SEED_CAPSULE_ID],
      ["Your self-asserted key", deviceKey.keyId],
      ["Browser storage response at creation", `${deviceKey.storageModeAtCreation} · not a backup`],
    ]),
  );

  const form = element("form");
  form.id = "choice-form";
  const fieldset = element("fieldset");
  fieldset.append(element("legend", undefined, "Choose exactly one policy change"));
  const cards = element("div", "choices");
  CHOICES.forEach((item, index) => {
    const choice = element("label", "choice");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "fork";
    radio.value = item.choice;
    radio.checked = index === 0;
    const copy = element("span");
    copy.append(
      element("strong", undefined, item.label),
      element("b", undefined, item.delta),
      element("small", undefined, item.note),
    );
    choice.append(radio, element("span", "choice-index", `0${index + 1}`), copy);
    radio.addEventListener("change", () => { selected = radio.value as CreatorForkChoice; });
    cards.append(choice);
  });
  fieldset.append(cards);
  const prepareButton = element("button", "primary prepare", "Prepare exact bytes for review");
  prepareButton.type = "submit";
  form.append(fieldset, prepareButton);
  form.addEventListener("submit", (event) => { event.preventDefault(); void prepareReview(); });

  const limitations = element("aside", "limits");
  limitations.append(
    element("strong", undefined, "This signature will not prove"),
    ...["identity", "independent time", "broker activity", "completeness", "performance or skill", "suitability or compliance"].map((value) => element("span", undefined, value)),
  );
  replaceScreen(benchHead, form, limitations);
}

async function prepareReview() {
  if (busy || seed === null || deviceKey === null) return;
  busy = true;
  try {
    const createdAt = new Date().toISOString();
    const experimentId = `CREATOR-FORK-${createdAt.replace(/[^0-9]/g, "")}`;
    prepared = await prepareCreatorFork({ checkpointSequence: 1, choice: selected, createdAt, experimentId, parent: seed, publicKeySpkiDer: deviceKey.publicSpkiDer });
    renderReview(prepared);
  } catch {
    block("Exact capsule preparation failed. The device key was not used.");
  } finally {
    busy = false;
  }
}

function renderReview(value: PreparedCreatorFork) {
  const change = value.charter.fork.changedRule;
  if (change === null || deviceKey === null) return;

  const reviewHead = element("section", "review-head");
  reviewHead.tabIndex = -1;
  const delta = element("div", "delta");
  delta.append(
    element("span", undefined, String(change.from)),
    element("i", undefined, "→"),
    element("strong", undefined, String(change.to)),
  );
  const explanation = element("p");
  explanation.append(
    "The fixed boundary proposal changes from ",
    element("b", undefined, "human-review"),
    " to ",
    element("b", undefined, "rejected"),
    ". No execution, security, return, or broker record exists.",
  );
  reviewHead.append(
    paragraph("EXACT REVIEW · CAPSULE NOT SIGNED YET", "kicker"),
    element("h1", undefined, change.path),
    delta,
    explanation,
  );

  const receipt = element("section", "receipt");
  receipt.append(definitionList([
    ["Capsule ID", value.prepared.capsuleId],
    ["Author key", value.prepared.authorKeyId],
    ["Parent", CREATOR_SEED_CAPSULE_ID],
    ["Device-declared time", value.prepared.review.createdAt],
  ]));
  const tableWrap = element("div", "table-wrap");
  const table = element("table");
  const head = element("thead");
  const headingRow = element("tr");
  headingRow.append(
    element("th", undefined, "Signed payload member"),
    element("th", undefined, "Bytes"),
    element("th", undefined, "SHA-256"),
  );
  head.append(headingRow);
  const body = element("tbody");
  for (const member of value.prepared.review.members) {
    const row = element("tr");
    row.append(
      element("td", undefined, member.path),
      element("td", undefined, String(member.bytes)),
      element("td", undefined, member.sha256),
    );
    body.append(row);
  }
  table.append(head, body);
  tableWrap.append(table);
  receipt.append(tableWrap);

  const signGate = element("section", "sign-gate");
  const reviewLabel = element("label", "ack");
  const reviewAck = element("input");
  reviewAck.id = "review-ack";
  reviewAck.type = "checkbox";
  reviewLabel.append(reviewAck, " I reviewed the exact parent, changed rule, capsule ID, key, and member digests.");
  const limitLabel = element("label", "ack");
  const limitAck = element("input");
  limitAck.id = "limit-ack";
  limitAck.type = "checkbox";
  limitLabel.append(limitAck, " I understand this proves none of identity, time, broker activity, completeness, performance, skill, suitability, or compliance.");
  const sign = element("button", "primary", `Sign ${value.prepared.capsuleId.slice(0, 12)}… and self-verify`);
  sign.id = "sign";
  sign.disabled = true;
  const changeButton = element("button", "text-button", "Change rule");
  changeButton.id = "change";
  changeButton.type = "button";
  const update = () => { sign.disabled = !(reviewAck.checked && limitAck.checked); };
  reviewAck.addEventListener("change", update);
  limitAck.addEventListener("change", update);
  sign.addEventListener("click", () => void signAndVerify(sign));
  changeButton.addEventListener("click", renderWorkbench);
  signGate.append(reviewLabel, limitLabel, sign, changeButton);

  replaceScreen(reviewHead, receipt, signGate);
  reviewHead.focus();
}

async function signAndVerify(button: HTMLButtonElement) {
  if (busy || prepared === null || deviceKey === null) return;
  busy = true;
  button.disabled = true;
  button.textContent = "Signing and self-verifying…";
  try {
    const signed = await signWithDeviceAuthorKey(prepared.prepared.signingBytes);
    if (signed.keyId !== prepared.prepared.authorKeyId || !equalBytes(signed.publicSpkiDer, deviceKey.publicSpkiDer)) throw new Error("signer.key-mismatch");
    const authored = await finalizeProofCapsule(prepared.prepared, signed.signature);
    const core = await verifyProofCapsule(authored.archiveBytes);
    if (!core.valid || core.capsuleId !== authored.capsuleId || core.authorKeyId !== authored.authorKeyId) throw new Error("signer.core-self-verification-failed");
    const domain = await verifyPreparedCreatorFork({ parentArchive: CREATOR_SEED_ARCHIVE, childArchive: authored.archiveBytes, fork: prepared });
    if (!domain.valid || domain.childCapsuleId !== authored.capsuleId) throw new Error("signer.domain-self-verification-failed");
    artifact = { archive: authored.archiveBytes, archiveSha256: authored.archiveSha256, capsuleId: authored.capsuleId, coreReceipt: serializeProofVerificationReceipt(core), domainReceipt: serializeCreatorForkReceipt(domain) };
    renderDownloads(artifact);
  } catch {
    block("Signing, capsule construction, or same-project self-verification failed. No download was enabled.");
  } finally {
    busy = false;
  }
}

function renderDownloads(value: ReadyArtifact) {
  const success = element("section", "success");
  success.tabIndex = -1;
  success.append(
    paragraph("SIGNED · SAME-PROJECT SELF-VERIFIED", "kicker"),
    element("h1", undefined, "Your synthetic child is ready."),
    paragraph("Both the core capsule checks and the separate one-rule Creator Proof checks passed locally. This is same-project evidence, not independent verification."),
    definitionList([
      ["Capsule ID", value.capsuleId],
      ["Archive SHA-256", value.archiveSha256],
    ]),
  );

  const downloads = element("section", "downloads");
  downloads.append(element("h2", undefined, "Download one artifact at a time"));
  const downloadDefinitions = [
    ["capsule", "primary", "Download .runbook capsule"],
    ["core", "", "Download exact core receipt"],
    ["domain", "", "Download Creator Proof receipt"],
  ] as const;
  for (const [kind, className, label] of downloadDefinitions) {
    const button = element("button", className || undefined, label);
    button.dataset.download = kind;
    button.addEventListener("click", () => {
      const prefix = value.capsuleId.slice(0, 12);
      if (kind === "capsule") requestDownload(`creator-proof-${prefix}.runbook`, value.archive, "application/vnd.runbook.proof+zip;version=1");
      if (kind === "core") requestDownload(`creator-proof-${prefix}.receipt.json`, value.coreReceipt, "application/json");
      if (kind === "domain") requestDownload(`creator-proof-${prefix}.creator-receipt.json`, value.domainReceipt, "application/json");
      status.textContent = "Download requested. Your browser controls the final save.";
    });
    downloads.append(button);
  }
  const status = paragraph("");
  status.id = "download-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  downloads.append(status);

  const manual = element("aside", "manual");
  manual.append(
    element("strong", undefined, "Manual boundary"),
    paragraph("No post, link, QR code, referral, or Robinhood action was generated. Review anything you publish yourself."),
  );
  replaceScreen(success, downloads, manual);
  success.focus();
}

async function boot() {
  try {
    await inspectSignerEnvironment(__SIGNER_CANONICAL_ORIGIN__);
    const opened = await openEmbeddedCreatorSeed();
    seed = opened.verified;
    const status = await inspectDeviceAuthorKey();
    document.documentElement.dataset.ready = "true";
    if (status.state === "active") {
      deviceKey = status;
      renderWorkbench();
    } else if (status.state === "empty") {
      renderKeySetup();
    } else if (status.state === "staged") {
      renderStagedActivation(status);
    } else if (status.state === "unavailable") {
      block(`DEVICE KEY UNAVAILABLE (${status.reason}). Runbook cannot determine whether this is temporary storage failure, an incompatible or corrupt record, or permanent key loss. Do not clear site data; no replacement will be created.`);
    } else {
      block("This browser cannot complete the required Web Crypto and IndexedDB key lifecycle.");
    }
  } catch {
    block("Origin, service-worker, seed-integrity, cryptographic, or storage readiness checks failed.");
  }
}

const bootScreen = element("section", "boot");
bootScreen.setAttribute("role", "status");
bootScreen.setAttribute("aria-live", "polite");
bootScreen.append(
  paragraph("LOCAL READINESS CHECK", "kicker"),
  element("h1", undefined, "Inspecting the signing boundary…"),
  paragraph("Checking origin isolation, service workers, frozen seed bytes, Ed25519, and the device key slot."),
);
replaceScreen(bootScreen);
void boot();
