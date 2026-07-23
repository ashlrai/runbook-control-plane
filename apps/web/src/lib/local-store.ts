const DATABASE_NAME = "runbook-local-v1";
const DATABASE_VERSION = 4;
const EXPERIMENT_DRAFTS_STORE = "experiment-drafts";
const CONTENT_OBSERVATIONS_STORE = "content-observations";
const SOCIAL_BASELINES_STORE = "social-baselines";
export const PROOF_LOOP_EVENTS_STORE = "proof-loop-events";

export function openRunbookLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EXPERIMENT_DRAFTS_STORE)) {
        request.result.createObjectStore(EXPERIMENT_DRAFTS_STORE);
      }
      if (!request.result.objectStoreNames.contains(CONTENT_OBSERVATIONS_STORE)) {
        request.result.createObjectStore(CONTENT_OBSERVATIONS_STORE);
      }
      if (!request.result.objectStoreNames.contains(SOCIAL_BASELINES_STORE)) {
        request.result.createObjectStore(SOCIAL_BASELINES_STORE);
      }
      if (!request.result.objectStoreNames.contains(PROOF_LOOP_EVENTS_STORE)) {
        request.result.createObjectStore(PROOF_LOOP_EVENTS_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Could not open the local Runbook database."));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("The local Runbook database upgrade is blocked by another open page. Close it and retry."));
    };
  });
}

export async function saveExperimentDraft(key: string, value: unknown) {
  return saveLocalRecord(EXPERIMENT_DRAFTS_STORE, key, value);
}

export async function getExperimentDraft(key: string): Promise<unknown | undefined> {
  const database = await openRunbookLocalDatabase();
  try {
    return await new Promise<unknown | undefined>((resolve, reject) => {
      const transaction = database.transaction(EXPERIMENT_DRAFTS_STORE, "readonly");
      const request = transaction.objectStore(EXPERIMENT_DRAFTS_STORE).get(key);
      request.onsuccess = () => resolve(request.result as unknown | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read the local experiment draft."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("The local experiment draft read was aborted."));
    });
  } finally {
    database.close();
  }
}

async function saveLocalRecord(storeName: string, key: string, value: unknown) {
  const database = await openRunbookLocalDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite", { durability: "strict" });
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the local record."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The local record save was aborted."));
    });
  } finally {
    database.close();
  }
}

export async function saveContentObservation(key: string, value: unknown) {
  return saveLocalRecord(CONTENT_OBSERVATIONS_STORE, key, value);
}

export async function listContentObservations(): Promise<unknown[]> {
  const database = await openRunbookLocalDatabase();
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(CONTENT_OBSERVATIONS_STORE, "readonly");
      const request = transaction.objectStore(CONTENT_OBSERVATIONS_STORE).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read local content observations."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The local observation read was aborted."));
    });
  } finally {
    database.close();
  }
}

export async function saveSocialBaseline(key: string, value: unknown) {
  return saveLocalRecord(SOCIAL_BASELINES_STORE, key, value);
}

export async function listSocialBaselines(): Promise<unknown[]> {
  const database = await openRunbookLocalDatabase();
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(SOCIAL_BASELINES_STORE, "readonly");
      const request = transaction.objectStore(SOCIAL_BASELINES_STORE).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read local Social baselines."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The local Social baseline read was aborted."));
    });
  } finally {
    database.close();
  }
}
