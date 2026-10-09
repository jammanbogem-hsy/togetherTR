'use client'

import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { extractTopicFromChat } from './autofillContext'

const TOPIC_ACTIVITY = 'A-1-2'
const RECENT_LIMIT = 40

/**
 * Reads the latest A-1-2 messages once and returns the topic line the team confirmed there.
 * Used only when no saved artifact names a topic, so teams that moved on without saving A-1-2
 * still give AI autofill their topic. Returns '' on any failure.
 */
export async function loadTopicFromA12Chat(projectId: string): Promise<string> {
  try {
    const snap = await getDocs(query(
      collection(db, `projects/${projectId}/conversations/${TOPIC_ACTIVITY}/messages`),
      orderBy('createdAt', 'desc'),
      limit(RECENT_LIMIT),
    ))
    const messages = snap.docs
      .map(item => item.data() as { role?: string; content?: string })
      .filter(item => typeof item.content === 'string')
      .map(item => ({ role: item.role ?? '', content: item.content as string }))
      .reverse()
    return extractTopicFromChat(messages)
  } catch (cause) {
    console.warn('[autofill topic from A-1-2 chat]', cause)
    return ''
  }
}
