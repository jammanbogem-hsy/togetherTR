'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/config'
import { isAdminObserver } from '@/lib/admin/observer'
import { useProjectStore } from '@/store/project'

/** Whether the current viewer is the super admin observing a room they are not a member of. */
export function useAdminObserver(): boolean {
  const project = useProjectStore(s => s.project)
  const [user, setUser] = useState(() => auth.currentUser)
  useEffect(() => onAuthStateChanged(auth, setUser), [])
  return isAdminObserver(project, user)
}
