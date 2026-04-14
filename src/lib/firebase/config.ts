import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY

const firebaseConfig = {
  apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// API 키가 없으면 초기화 스킵 (빌드 타임/SSR에서 오류 방지)
const shouldInit = Boolean(apiKey)

const app: FirebaseApp = shouldInit
  ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0])
  : ({} as FirebaseApp)

export const auth = shouldInit ? getAuth(app) : ({} as ReturnType<typeof getAuth>)
export const storage = shouldInit ? getStorage(app) : ({} as ReturnType<typeof getStorage>)

// 메모리 캐시 사용 (멀티탭 persistent 캐시 잠금 문제 회피)
export const db = shouldInit
  ? initializeFirestore(app, { localCache: memoryLocalCache() })
  : ({} as ReturnType<typeof initializeFirestore>)

export default app
