// 개인정보 동의 — 문구·표(consentContent)와 동의 기록 저장.
// 화면은 이 파일에서 import 한다(계약). 저장 경로: users/{uid}.privacyConsent
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { PRIVACY_CONSENT_VERSION, REQUIRED_CONSENT_ITEMS, type PrivacyConsentRecord } from './consentContent'

export * from './consentContent'

/** 동의 기록 — users/{uid}.privacyConsent = { version, agreedAt: serverTimestamp, items } (다른 필드는 그대로) */
export async function recordConsent(uid: string): Promise<PrivacyConsentRecord> {
  const record: PrivacyConsentRecord = { version: PRIVACY_CONSENT_VERSION, agreedAt: serverTimestamp(), items: [...REQUIRED_CONSENT_ITEMS] }
  await setDoc(doc(db, 'users', uid), { privacyConsent: record }, { merge: true })
  return record
}
