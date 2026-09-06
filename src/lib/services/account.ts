/**
 * Local-first account store: profile, logbook and a lightweight "session", all
 * persisted to localStorage, so the account surfaces are fully functional with no
 * backend at all. When the API *is* configured (`VITE_API_BASE_URL`), the same
 * component API write-throughs to it via `sync.ts` — local stays the source of
 * truth and the server is a backup.
 *
 * Exposed via useSyncExternalStore so components re-render on any change.
 */
import { useSyncExternalStore } from 'react';
import { effectivePlan, type Entitlement } from '@/lib/services/entitlements';
import { isAuthAvailable, onAuthChange } from '@/lib/services/auth';
import { claimStaffAccessIfEligible } from '@/lib/services/staff';
import { claimSchoolSeatIfEligible } from '@/lib/services/school';
import { claimFoundingAccessIfEligible } from '@/lib/services/founding';
import {
  loadAccount,
  saveProfileDoc,
  addFlightDoc,
  updateFlightDoc,
  deleteFlightDoc,
  addRecordDoc,
  updateRecordDoc,
  deleteRecordDoc,
} from '@/lib/services/sync';

/** Operational role driving dashboard personalization. */
export type UserRole = 'pilot' | 'student' | 'instructor';

export const USER_ROLES: UserRole[] = ['pilot', 'student', 'instructor'];

/** Narrow an arbitrary profile string to a known role; '' or legacy values fail. */
export function isUserRole(v: string): v is UserRole {
  return (USER_ROLES as string[]).includes(v);
}

export interface Profile {
  email: string;
  displayName: string;
  homeBase: string;
  licenceType: string;
  /** ISO date (YYYY-MM-DD) or ''. */
  medicalExpiry: string;
  lastFlightReview: string;
  /** One of USER_ROLES, or '' until chosen. */
  role: string;
  avatarUrl?: string;
}

export interface Flight {
  id: string;
  date: string;
  type: string;
  reg: string;
  from: string;
  to: string;
  total: string;
  pic: string;
  night: string;
  ifr: string;
  ldg: string;
  /** Night landings — optional; older records predate this field. */
  nightLdg?: string;
  /** Instrument approaches flown — optional; older records predate this field. */
  appr?: string;
  remarks: string;
}

/** Categories of pilot record tracked alongside the logbook. */
export type RecordCategory = 'rating' | 'aircraft' | 'document' | 'endorsement';

export interface PilotRecord {
  id: string;
  category: RecordCategory;
  /** Human title — e.g. "Instrument Rating", "HZ-ABC", "Passport". */
  title: string;
  /** Reference — licence/registration/document number. */
  ref: string;
  /** ISO date (YYYY-MM-DD) or ''. */
  issued: string;
  /** ISO expiry (YYYY-MM-DD) or '' when it doesn't expire. */
  expires: string;
  remarks: string;
}

interface State {
  session: string | null;
  /** Server user id when signed in through the API; null for a local session. */
  uid: string | null;
  /** Whether the server has verified the account's email (false for local sessions). */
  emailVerified: boolean;
  profile: Profile;
  flights: Flight[];
  records: PilotRecord[];
  /** Server-written; read-only, used only to gate UI. */
  entitlement: Entitlement | null;
  /** Purchased Captain Adel credits (server-written, owner-readable); 0 when none. */
  chatCredits: number;
  /** Purchased exam-prep pack ids (server-written, owner-readable); [] when none. */
  ownedPacks: string[];
  /** True when the last write-through to the API failed — local is ahead of server. */
  syncError: boolean;
}

const K = {
  session: 'flygaca:session',
  profile: 'flygaca:profile',
  logbook: 'flygaca:logbook',
  records: 'flygaca:records',
} as const;

const DEFAULT_PROFILE: Profile = {
  email: '',
  displayName: '',
  homeBase: '',
  licenceType: '',
  medicalExpiry: '',
  lastFlightReview: '',
  role: '',
  avatarUrl: '',
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

let state: State = {
  session: localStorage.getItem(K.session),
  uid: null,
  emailVerified: false,
  // Merge over defaults so profiles stored before a field existed (e.g. role)
  // hydrate with '' rather than undefined.
  profile: { ...DEFAULT_PROFILE, ...readJson(K.profile, {} as Partial<Profile>) },
  flights: readJson(K.logbook, [] as Flight[]),
  records: readJson(K.records, [] as PilotRecord[]),
  entitlement: null,
  chatCredits: 0,
  ownedPacks: [],
  syncError: false,
};

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function persist() {
  if (state.session) localStorage.setItem(K.session, state.session);
  else localStorage.removeItem(K.session);
  localStorage.setItem(K.profile, JSON.stringify(state.profile));
  localStorage.setItem(K.logbook, JSON.stringify(state.flights));
  localStorage.setItem(K.records, JSON.stringify(state.records));
}

function commit(next: State) {
  state = next;
  persist();
  emit();
}

export function signIn(email: string, name: string): void {
  const displayName = name.trim() || state.profile.displayName || email;
  commit({ ...state, session: email, profile: { ...state.profile, email, displayName } });
}

export function signOut(): void {
  void import('@/lib/services/auth').then(({ signOutUser }) => signOutUser());
  commit({
    ...state,
    session: null,
    uid: null,
    emailVerified: false,
    entitlement: null,
    chatCredits: 0,
    ownedPacks: [],
    syncError: false,
  });
}

/**
 * Outcome handlers for the best-effort write-through to the API: clear/raise the
 * `syncError` flag so the UI can warn that local data is ahead of the server,
 * instead of silently swallowing the failure.
 */
function onSyncOk(): void {
  if (state.syncError) commit({ ...state, syncError: false });
}
function onSyncFail(): void {
  if (!state.syncError) commit({ ...state, syncError: true });
}

export function saveProfile(patch: Partial<Profile>): void {
  const profile = { ...state.profile, ...patch };
  commit({ ...state, profile });
  if (state.uid) void saveProfileDoc(profile).then(onSyncOk, onSyncFail);
}

export function addFlight(f: Omit<Flight, 'id'>): void {
  const flight: Flight = { ...f, id: crypto.randomUUID() };
  commit({ ...state, flights: [flight, ...state.flights] });
  if (state.uid) void addFlightDoc(flight).then(onSyncOk, onSyncFail);
}

export function updateFlight(id: string, patch: Partial<Omit<Flight, 'id'>>): void {
  const current = state.flights.find((f) => f.id === id);
  if (!current) return;
  const updated: Flight = { ...current, ...patch, id };
  commit({ ...state, flights: state.flights.map((f) => (f.id === id ? updated : f)) });
  if (state.uid) void updateFlightDoc(id, updated).then(onSyncOk, onSyncFail);
}

export function deleteFlight(id: string): void {
  commit({ ...state, flights: state.flights.filter((x) => x.id !== id) });
  if (state.uid) void deleteFlightDoc(id).then(onSyncOk, onSyncFail);
}

export function addRecord(r: Omit<PilotRecord, 'id'>): void {
  const record: PilotRecord = { ...r, id: crypto.randomUUID() };
  commit({ ...state, records: [record, ...state.records] });
  if (state.uid) void addRecordDoc(record).then(onSyncOk, onSyncFail);
}

export function updateRecord(id: string, patch: Partial<Omit<PilotRecord, 'id'>>): void {
  const current = state.records.find((r) => r.id === id);
  if (!current) return;
  const updated: PilotRecord = { ...current, ...patch, id };
  commit({ ...state, records: state.records.map((r) => (r.id === id ? updated : r)) });
  if (state.uid) void updateRecordDoc(id, updated).then(onSyncOk, onSyncFail);
}

export function deleteRecord(id: string): void {
  commit({ ...state, records: state.records.filter((x) => x.id !== id) });
  if (state.uid) void deleteRecordDoc(id).then(onSyncOk, onSyncFail);
}

export function exportAll(): string {
  return JSON.stringify(
    { profile: state.profile, flights: state.flights, records: state.records },
    null,
    2,
  );
}

export function deleteAllData(): void {
  // Keeps identity-like fields (email, displayName, role); wipes flight data.
  commit({
    ...state,
    profile: {
      ...DEFAULT_PROFILE,
      email: state.profile.email,
      displayName: state.profile.displayName,
      role: state.profile.role,
    },
    flights: [],
    records: [],
  });
}

/** Subscribe to the whole account state. */
export function useAccount(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Sum a numeric logbook column across all flights. */
export function sumHours(flights: Flight[], key: keyof Flight): number {
  return flights.reduce((s, f) => s + (parseFloat(String(f[key])) || 0), 0);
}

/**
 * Bind the store to server auth — only when the API is configured. A signed-in
 * user adopts their uid, then hydrates profile/logbook/entitlement from the API
 * (server data wins, falling back to the local cache); sign-out clears the
 * session cookie. With no API configured this never runs, so the store stays
 * purely local-first.
 */
let stopProgressSync: (() => void) | null = null;

function connectAuth(): void {
  void onAuthChange(async (user) => {
    if (user) {
      commit({
        ...state,
        session: user.email ?? user.uid,
        uid: user.uid,
        emailVerified: user.emailVerified,
        profile: {
          ...state.profile,
          email: user.email ?? state.profile.email,
          displayName: user.displayName ?? state.profile.displayName,
          avatarUrl: user.avatarUrl ?? state.profile.avatarUrl ?? '',
        },
      });
      // Start syncing this user's study-progress projection (best-effort; a no-op
      // while the SYNC_STUDY_PROGRESS flag is off). Lazy-loaded so it stays out of
      // the initial bundle; guarded so a late import can't start a stale session.
      stopProgressSync?.();
      stopProgressSync = null;
      void import('@/lib/services/studyProgressSync').then(({ startStudyProgressSync }) => {
        if (state.uid === user.uid) stopProgressSync = startStudyProgressSync(user.uid);
      });
      try {
        // Staff auto-grant: a verified allowlisted email (e.g. @flygaca.com) gets
        // the complimentary entitlement written server-side before we hydrate, so
        // the fresh plan is included in loadAccount below. No-ops for everyone else.
        await claimStaffAccessIfEligible(user.email, user.emailVerified);
        let loaded = await loadAccount();
        // School-seat auto-grant: only for a verified user with no active paid plan
        // (skips paying/staff/already-school users). The invite path can't be
        // pre-checked client-side, so we gate on the loaded plan being free, then
        // re-hydrate once when a seat is actually granted.
        if (loaded && effectivePlan(loaded.entitlement) === 'free' && user.emailVerified) {
          const granted = await claimSchoolSeatIfEligible(user.email, user.emailVerified);
          if (granted && state.uid === user.uid) loaded = await loadAccount();
        }
        // Founding grant: grandfather pre-launch accounts with a complimentary Pro
        // window when monetization is on. Still-free verified users only; the server
        // re-checks the account age and grants once, then we re-hydrate.
        if (loaded && effectivePlan(loaded.entitlement) === 'free' && user.emailVerified) {
          const granted = await claimFoundingAccessIfEligible(user.emailVerified);
          if (granted && state.uid === user.uid) loaded = await loadAccount();
        }
        // The account round-trip can outlive the session: if the user signed
        // out or switched accounts while it was in flight, do NOT re-apply this
        // user's profile/entitlement onto the now-different session.
        if (loaded && state.uid === user.uid) {
          commit({
            ...state,
            profile: { ...state.profile, ...loaded.profile },
            flights: loaded.flights.length ? loaded.flights : state.flights,
            records: loaded.records && loaded.records.length ? loaded.records : state.records,
            entitlement: loaded.entitlement,
            chatCredits: loaded.chatCredits,
            ownedPacks: loaded.ownedPacks,
            syncError: false,
          });
        }
      } catch {
        /* offline / rules — keep the local cache */
      }
    } else if (state.uid) {
      stopProgressSync?.();
      stopProgressSync = null;
      commit({
        ...state,
        session: null,
        uid: null,
        emailVerified: false,
        entitlement: null,
        chatCredits: 0,
        ownedPacks: [],
        syncError: false,
      });
    }
  });
}

if (isAuthAvailable()) connectAuth();

/**
 * Re-hydrate the signed-in user's profile/logbook/records/entitlement from the
 * API. Used after a checkout returns so a freshly-granted plan shows without a
 * reload (the entitlement is written by the billing routes).
 * No-ops for local-only sessions.
 */
export async function refreshAccount(): Promise<void> {
  if (!state.uid) return;
  try {
    const loaded = await loadAccount();
    if (loaded && state.uid) {
      commit({
        ...state,
        profile: { ...state.profile, ...loaded.profile },
        flights: loaded.flights.length ? loaded.flights : state.flights,
        records: loaded.records?.length ? loaded.records : state.records,
        entitlement: loaded.entitlement,
        chatCredits: loaded.chatCredits,
        ownedPacks: loaded.ownedPacks,
        syncError: false,
      });
    }
  } catch {
    /* offline / rules — keep current state */
  }
}
