/**
 * Camada de nuvem (Firebase — Fase 1). Ver docs/firebase-setup.md no repo do
 * jogo e firebase/*.rules neste repo.
 *
 * Sem NEXT_PUBLIC_FIREBASE_* no .env.local, o Studio roda em modo local
 * (Fase 0): exporta manifest.json e mostra aviso de nuvem não configurada.
 */
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  getIdToken,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
}

export function firebaseConfig(): FirebaseConfig | null {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  return config.apiKey && config.projectId ? config : null;
}

export function ensureFirebase(): FirebaseApp | null {
  const config = firebaseConfig();
  if (!config) return null;
  if (getApps().length === 0) {
    return initializeApp(config);
  }
  return getApps()[0];
}

export function watchAuth(
  onChange: (user: User | null) => void,
): () => void {
  if (!ensureFirebase()) return () => {};
  return onAuthStateChanged(getAuth(), onChange);
}

export async function signInGoogle(): Promise<User | null> {
  if (!ensureFirebase()) return null;
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(getAuth(), provider);
  return result.user;
}

export async function signOutCloud(): Promise<void> {
  if (!ensureFirebase()) return;
  await signOut(getAuth());
}

export interface CloudSong {
  songId: string;
  title: string;
  type: string;
  laneCount: number;
  updatedAt: string;
  authorName: string;
  published: boolean;
  shareCode: string;
  status: string;
}

export async function listCloudSongs(): Promise<CloudSong[]> {
  if (!ensureFirebase()) return [];
  const snapshot = await getDocs(collection(getFirestore(), "songs"));
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      songId: document.id,
      title: String(data.title ?? document.id),
      type: String(data.type ?? "chart_only"),
      laneCount: Number(data.lane_count ?? 5),
      updatedAt: String(data.updated_at ?? ""),
      authorName: String(data.author_name ?? ""),
      published: Boolean(data.published),
      shareCode: String(data.share_code ?? ""),
      status: String(data.status ?? "active"),
    };
  });
}

export interface UploadMeta {
  title: string;
  type: string;
  laneCount: number;
}

/** Faz upload do zip e grava o doc de índice. Retorna o storage_path. */
export async function uploadPackageZip(
  songId: string,
  zip: Blob,
  meta: UploadMeta,
): Promise<string> {
  if (!ensureFirebase()) throw new Error("Firebase não configurado");
  const user = getAuth().currentUser;
  if (!user) throw new Error("Faça login antes de enviar para a nuvem");
  const storagePath = `custom_songs/${user.uid}/${songId}.zip`;
  await uploadBytes(ref(getStorage(), storagePath), zip);
  await setDoc(doc(getFirestore(), "songs", songId), {
    song_id: songId,
    title: meta.title,
    type: meta.type,
    author_uid: user.uid,
    author_name: user.displayName ?? user.email ?? "Autor",
    lane_count: meta.laneCount,
    storage_path: storagePath,
    updated_at: serverTimestamp(),
  });
  return storagePath;
}

export async function deleteCloudSong(songId: string): Promise<void> {
  if (!ensureFirebase()) return;
  await deleteDoc(doc(getFirestore(), "songs", songId));
  const user = getAuth().currentUser;
  if (user) {
    try {
      await deleteObject(
        ref(getStorage(), `custom_songs/${user.uid}/${songId}.zip`),
      );
    } catch {
      // o arquivo pode não existir; o índice já foi removido
    }
  }
}

// --- Entitlements premium (Fase 2) ------------------------------------------

/** idToken do usuário logado (para as rotas /api premium). */
export async function getFirebaseIdToken(): Promise<string | null> {
  if (!ensureFirebase()) return null;
  const user = getAuth().currentUser;
  if (!user) return null;
  return getIdToken(user, true);
}

export interface EntitlementInfo {
  premium: boolean;
  status: string;
  validUntil: number | null;
}

/** Observa o entitlement do usuário (doc próprio — rules permitem a leitura). */
export function watchEntitlement(
  uid: string,
  onChange: (entitlement: EntitlementInfo | null) => void,
): () => void {
  if (!ensureFirebase()) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    doc(getFirestore(), "entitlements", uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      const data = snapshot.data();
      onChange({
        premium: Boolean(data.premium),
        status: String(data.status ?? ""),
        validUntil: data.valid_until ? Number(data.valid_until) : null,
      });
    },
    () => onChange(null),
  );
}

// --- Fase 3: comunidade (publicar, share codes, placares, denúncias) --------

const SHARE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomShareCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += SHARE_ALPHABET[Math.floor(Math.random() * SHARE_ALPHABET.length)];
  }
  return code;
}

/** Publica/despublica. Retorna o share code (vazio ao despublicar). */
export async function publishSong(
  songId: string,
  publish: boolean,
): Promise<string> {
  if (!ensureFirebase()) throw new Error("Firebase não configurado");
  const ref = doc(getFirestore(), "songs", songId);
  if (publish) {
    const snapshot = await getDoc(ref);
    const existing = snapshot.exists() ? String(snapshot.data().share_code ?? "") : "";
    const code = existing || randomShareCode();
    await updateDoc(ref, { published: true, status: "active", share_code: code });
    return code;
  }
  await updateDoc(ref, { published: false });
  return "";
}

export async function removeCommunitySong(songId: string): Promise<void> {
  if (!ensureFirebase()) return;
  await updateDoc(doc(getFirestore(), "songs", songId), {
    status: "removed",
    published: false,
  });
}

export async function listCommunitySongs(): Promise<CloudSong[]> {
  if (!ensureFirebase()) return [];
  const q = query(
    collection(getFirestore(), "songs"),
    where("published", "==", true),
    where("status", "==", "active"),
    orderBy("updated_at", "desc"),
    limit(50),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      songId: document.id,
      title: String(data.title ?? document.id),
      type: String(data.type ?? "chart_only"),
      laneCount: Number(data.lane_count ?? 5),
      updatedAt: String(data.updated_at ?? ""),
      authorName: String(data.author_name ?? ""),
      published: true,
      shareCode: String(data.share_code ?? ""),
      status: "active",
    };
  });
}

export async function findSongByShareCode(code: string): Promise<CloudSong | null> {
  if (!ensureFirebase()) return null;
  const q = query(
    collection(getFirestore(), "songs"),
    where("share_code", "==", code.trim().toUpperCase()),
    where("status", "==", "active"),
    limit(1),
  );
  const snapshot = await getDocs(q);
  const document = snapshot.docs[0];
  if (!document) return null;
  const data = document.data();
  return {
    songId: document.id,
    title: String(data.title ?? document.id),
    type: String(data.type ?? "chart_only"),
    laneCount: Number(data.lane_count ?? 5),
    updatedAt: String(data.updated_at ?? ""),
    authorName: String(data.author_name ?? ""),
    published: true,
    shareCode: String(data.share_code ?? ""),
    status: "active",
  };
}

export async function reportSong(songId: string, reason: string): Promise<void> {
  if (!ensureFirebase()) throw new Error("Firebase não configurado");
  const user = getAuth().currentUser;
  if (!user) throw new Error("entre com Google para denunciar");
  await addDoc(collection(getFirestore(), "reports"), {
    song_id: songId,
    reason,
    by_uid: user.uid,
    created_at: serverTimestamp(),
  });
}

export interface ScoreEntry {
  name: string;
  score: number;
  rank: string;
  accuracy: number;
  maxCombo: number;
}

export async function listScores(songId: string): Promise<ScoreEntry[]> {
  if (!ensureFirebase()) return [];
  const q = query(
    collection(getFirestore(), "scores", songId, "entries"),
    orderBy("score", "desc"),
    limit(10),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      name: String(data.name ?? "?"),
      score: Number(data.score ?? 0),
      rank: String(data.rank ?? "D"),
      accuracy: Number(data.accuracy ?? 0),
      maxCombo: Number(data.max_combo ?? 0),
    };
  });
}
