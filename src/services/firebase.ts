import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type {
  UserProfileRecord,
  ViewingHistoryRecord,
  WatchProgressRecord,
  WatchlistRecord,
} from '../types/kinova';

// Load Firebase config safely if firebase-applet-config.json exists
const configModules = import.meta.glob('/firebase-applet-config.json', { eager: true });
const loadedConfig = Object.values(configModules)[0] as
  | {
      default?: Record<string, string>;
      apiKey?: string;
      authDomain?: string;
      projectId?: string;
      firestoreDatabaseId?: string;
    }
  | undefined;

const firebaseConfig = (loadedConfig?.default || loadedConfig || null) as
  | {
      apiKey: string;
      authDomain: string;
      projectId: string;
      storageBucket?: string;
      messagingSenderId?: string;
      appId?: string;
      firestoreDatabaseId?: string;
    }
  | null;

export const isFirebaseConfigured = Boolean(
  firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.projectId !== 'remixed-project-id'
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured && firebaseConfig) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = firebaseConfig.firestoreDatabaseId
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
}

export const auth = authInstance;
export const db = dbInstance;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{ providerId?: string | null; email?: string | null }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = authInstance?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  if (!dbInstance) return false;
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: client is offline.');
    }
    return false;
  }
}

export function safeFirestoreDocId(raw: string): string {
  const cleaned = String(raw || 'item').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned || 'item';
}

export function subscribeAuthState(cb: (user: User | null) => void): () => void {
  if (!authInstance) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, cb);
}

export async function signInWithGoogle(): Promise<User> {
  if (!authInstance) {
    throw new Error('Firebase Web Auth is not provisioned yet. Continuing in local Guest Mode.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(authInstance, provider);
  return cred.user;
}

export async function signOutAccount(): Promise<void> {
  if (!authInstance) return;
  await signOut(authInstance);
}

export async function upsertCloudUserProfile(profile: UserProfileRecord): Promise<void> {
  if (!dbInstance || !authInstance?.currentUser) return;
  const uid = authInstance.currentUser.uid;
  const docPath = `users/${uid}`;
  const ref = doc(dbInstance, 'users', uid);
  try {
    const existing = await getDoc(ref);
    const payload = {
      userId: uid,
      displayName: (profile.displayName || 'KINOVA Viewer').slice(0, 80),
      email: (profile.email || authInstance.currentUser.email || '').slice(0, 150) || null,
      avatarUrl: (profile.avatarUrl || authInstance.currentUser.photoURL || '').slice(0, 500) || null,
      market: (profile.market || 'Kenya').slice(0, 40),
      preferredLanguage: (profile.preferredLanguage || 'English').slice(0, 40),
      preferredQuality: profile.preferredQuality || 'Auto',
      wifiOnlyStreaming: Boolean(profile.wifiOnlyStreaming),
      wifiOnlyDownloads: Boolean(profile.wifiOnlyDownloads),
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload, { merge: false });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docPath);
  }
}

export async function syncWatchlistItemToCloud(item: WatchlistRecord): Promise<void> {
  if (!dbInstance || !authInstance?.currentUser) return;
  const uid = authInstance.currentUser.uid;
  const itemId = safeFirestoreDocId(item.contentId);
  const path = `users/${uid}/watchlist/${itemId}`;
  const ref = doc(dbInstance, 'users', uid, 'watchlist', itemId);
  try {
    const existing = await getDoc(ref);
    await setDoc(ref, {
      userId: uid,
      contentId: item.contentId.slice(0, 128),
      contentType: item.contentType,
      title: (item.title || 'Untitled').slice(0, 200),
      posterUrl: item.posterUrl ? item.posterUrl.slice(0, 1000) : null,
      releaseYear: Math.max(0, Math.min(2100, Math.floor(item.releaseYear || 0))),
      genre: (item.genre || 'Cinema').slice(0, 120),
      runtimeSeconds: Math.max(0, Math.floor(item.runtimeSeconds || 0)),
      isPlayable: Boolean(item.isPlayable),
      addedAt: existing.exists() ? existing.data().addedAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function removeWatchlistItemFromCloud(contentId: string): Promise<void> {
  if (!dbInstance || !authInstance?.currentUser) return;
  const uid = authInstance.currentUser.uid;
  const itemId = safeFirestoreDocId(contentId);
  const path = `users/${uid}/watchlist/${itemId}`;
  try {
    await deleteDoc(doc(dbInstance, 'users', uid, 'watchlist', itemId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncWatchProgressToCloud(progress: WatchProgressRecord): Promise<void> {
  if (!dbInstance || !authInstance?.currentUser) return;
  const uid = authInstance.currentUser.uid;
  const docId = safeFirestoreDocId(progress.progressKey);
  const path = `users/${uid}/watch_progress/${docId}`;
  try {
    await setDoc(doc(dbInstance, 'users', uid, 'watch_progress', docId), {
      userId: uid,
      contentId: progress.contentId.slice(0, 128),
      episodeId: (progress.episodeId || '').slice(0, 128),
      contentType: progress.contentType,
      title: (progress.title || 'Untitled').slice(0, 200),
      subtitle: progress.subtitle ? progress.subtitle.slice(0, 200) : null,
      posterUrl: progress.posterUrl ? progress.posterUrl.slice(0, 1000) : null,
      positionMs: Math.max(0, Math.floor(progress.positionMs)),
      durationMs: Math.max(0, Math.floor(progress.durationMs)),
      completed: Boolean(progress.completed),
      lastWatchedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncViewingHistoryToCloud(entry: ViewingHistoryRecord): Promise<void> {
  if (!dbInstance || !authInstance?.currentUser) return;
  const uid = authInstance.currentUser.uid;
  const docId = safeFirestoreDocId(entry.id);
  const path = `users/${uid}/viewing_history/${docId}`;
  try {
    await setDoc(doc(dbInstance, 'users', uid, 'viewing_history', docId), {
      userId: uid,
      contentId: entry.contentId.slice(0, 128),
      episodeId: (entry.episodeId || '').slice(0, 128),
      contentType: entry.contentType,
      title: (entry.title || 'Untitled').slice(0, 200),
      posterUrl: entry.posterUrl ? entry.posterUrl.slice(0, 1000) : null,
      watchedSeconds: Math.max(0, Math.floor(entry.watchedSeconds)),
      completed: Boolean(entry.completed),
      watchedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchCloudUserBundle(): Promise<{
  profile?: Partial<UserProfileRecord>;
  watchlist: WatchlistRecord[];
  progress: WatchProgressRecord[];
  history: ViewingHistoryRecord[];
}> {
  if (!dbInstance || !authInstance?.currentUser) {
    return { watchlist: [], progress: [], history: [] };
  }
  const uid = authInstance.currentUser.uid;
  const [profSnap, wlSnap, progSnap, histSnap] = await Promise.all([
    getDoc(doc(dbInstance, 'users', uid)).catch((e) => handleFirestoreError(e, OperationType.GET, `users/${uid}`)),
    getDocs(query(collection(dbInstance, 'users', uid, 'watchlist'), orderBy('updatedAt', 'desc'))).catch((e) =>
      handleFirestoreError(e, OperationType.LIST, `users/${uid}/watchlist`)
    ),
    getDocs(query(collection(dbInstance, 'users', uid, 'watch_progress'), orderBy('updatedAt', 'desc'))).catch((e) =>
      handleFirestoreError(e, OperationType.LIST, `users/${uid}/watch_progress`)
    ),
    getDocs(query(collection(dbInstance, 'users', uid, 'viewing_history'), orderBy('watchedAt', 'desc'))).catch((e) =>
      handleFirestoreError(e, OperationType.LIST, `users/${uid}/viewing_history`)
    ),
  ]);

  const profileData = profSnap.exists() ? (profSnap.data() as Partial<UserProfileRecord>) : undefined;
  const watchlist: WatchlistRecord[] = wlSnap.docs.map((d) => {
    const v = d.data();
    return {
      contentId: String(v.contentId),
      contentType: v.contentType === 'SERIES' ? 'SERIES' : 'MOVIE',
      title: String(v.title || ''),
      posterUrl: String(v.posterUrl || ''),
      releaseYear: Number(v.releaseYear || 0),
      genre: String(v.genre || ''),
      runtimeSeconds: Number(v.runtimeSeconds || 0),
      isPlayable: Boolean(v.isPlayable),
      addedAtMillis: Date.now(),
    };
  });
  const progress: WatchProgressRecord[] = progSnap.docs.map((d) => {
    const v = d.data();
    return {
      progressKey: d.id,
      contentId: String(v.contentId),
      episodeId: String(v.episodeId || ''),
      contentType: v.contentType === 'EPISODE' ? 'EPISODE' : 'MOVIE',
      title: String(v.title || ''),
      subtitle: String(v.subtitle || ''),
      posterUrl: String(v.posterUrl || ''),
      positionMs: Number(v.positionMs || 0),
      durationMs: Number(v.durationMs || 0),
      completed: Boolean(v.completed),
      lastWatchedAtMillis: Date.now(),
    };
  });
  const history: ViewingHistoryRecord[] = histSnap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      contentId: String(v.contentId),
      episodeId: String(v.episodeId || ''),
      contentType: v.contentType === 'EPISODE' ? 'EPISODE' : 'MOVIE',
      title: String(v.title || ''),
      posterUrl: String(v.posterUrl || ''),
      watchedSeconds: Number(v.watchedSeconds || 0),
      completed: Boolean(v.completed),
      watchedAtMillis: Date.now(),
    };
  });

  return { profile: profileData, watchlist, progress, history };
}
