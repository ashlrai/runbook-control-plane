import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeSessionMarkerPath,
  appendSessionNote,
  readActiveSessionId,
  resolveDataDir,
  resolveSessionId,
  resolveSessionStore,
  withSession,
  writeActiveSession,
} from "./session-context.js";

describe("session-context", () => {
  let dataDir: string;
  let prevSessionEnv: string | undefined;
  let prevDataEnv: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "runbook-session-ctx-"));
    prevSessionEnv = process.env.RUNBOOK_SESSION_ID;
    prevDataEnv = process.env.RUNBOOK_DATA_DIR;
    delete process.env.RUNBOOK_SESSION_ID;
    delete process.env.RUNBOOK_DATA_DIR;
  });

  afterEach(async () => {
    if (prevSessionEnv === undefined) delete process.env.RUNBOOK_SESSION_ID;
    else process.env.RUNBOOK_SESSION_ID = prevSessionEnv;
    if (prevDataEnv === undefined) delete process.env.RUNBOOK_DATA_DIR;
    else process.env.RUNBOOK_DATA_DIR = prevDataEnv;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("resolves dataDir from options and store under sessions/", () => {
    expect(resolveDataDir({ dataDir })).toBe(dataDir);
    const store = resolveSessionStore({ dataDir });
    expect(store.rootDir).toBe(join(dataDir, "sessions"));
  });

  it("writes and reads active-session.json marker", async () => {
    const marker = await writeActiveSession(dataDir, "CPS-ACTIVE-001");
    expect(marker).toMatchObject({
      schemaVersion: "runbook.active-session.v1",
      sessionId: "CPS-ACTIVE-001",
      brokerEffect: false,
    });
    const path = activeSessionMarkerPath(dataDir);
    const raw = JSON.parse(await readFile(path, "utf8")) as { sessionId: string };
    expect(raw.sessionId).toBe("CPS-ACTIVE-001");
    expect(await readActiveSessionId(dataDir)).toBe("CPS-ACTIVE-001");
  });

  it("resolveSessionId priority: explicit > env > marker", async () => {
    await writeActiveSession(dataDir, "CPS-MARKER");
    process.env.RUNBOOK_SESSION_ID = "CPS-ENV";

    expect(await resolveSessionId("CPS-EXPLICIT", { dataDir })).toBe("CPS-EXPLICIT");
    expect(await resolveSessionId(undefined, { dataDir })).toBe("CPS-ENV");

    delete process.env.RUNBOOK_SESSION_ID;
    expect(await resolveSessionId(undefined, { dataDir })).toBe("CPS-MARKER");

    await rm(activeSessionMarkerPath(dataDir), { force: true });
    expect(await resolveSessionId(undefined, { dataDir })).toBeUndefined();
  });

  it("withSession no-ops when sessionId is undefined", async () => {
    const store = resolveSessionStore({ dataDir });
    let called = false;
    const result = await withSession(undefined, store, async () => {
      called = true;
      return 42;
    });
    expect(called).toBe(false);
    expect(result).toBeUndefined();
  });

  it("withSession and appendSessionNote update the store", async () => {
    const store = resolveSessionStore({ dataDir });
    await store.create({ sessionId: "CPS-NOTE-1", label: "note test" });
    await withSession("CPS-NOTE-1", store, async (id, s) => {
      await appendSessionNote(s, id, "shadow-curriculum: HFA=3 HFD=1");
    });
    const session = await store.read("CPS-NOTE-1");
    expect(session.notes.some((n) => n.includes("HFA=3"))).toBe(true);
  });
});
