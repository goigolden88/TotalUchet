/**
 * Приложения семьи из базы — в порядке человека. Правка в «Семье» видна
 * сразу: список перечитывается по событию базы.
 */

import { useEffect, useState } from 'react'
import { db } from '../app/core.ts'
import { ordered } from '../app/apps.ts'
import type { App } from '../app/model.ts'

/** `null` — ещё читается. */
export function useApps(): App[] | null {
  const [apps, setApps] = useState<App[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      void db.getAll('apps').then((all) => {
        if (alive) setApps(ordered(all))
      })
    load()
    const stop = db.onChange((event) => {
      if (event.store === 'apps') load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [])

  return apps
}
