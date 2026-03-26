import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, getFirestore, persistentLocalCache } from 'firebase/firestore'

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

// 오프라인 캐시 내장 (오프라인 팀 지원)
export const db = shouldInit
  ? (() => {
      try {
        return initializeFirestore(app, { localCache: persistentLocalCache() })
      } catch {
        return getFirestore(app)
      }
    })()
  : ({} as ReturnType<typeof getFirestore>)

export default app
