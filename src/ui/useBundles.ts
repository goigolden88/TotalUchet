/**
 * Связки из базы — в порядке человека (Р-17, Р-18) — и подписи строк по
 * архиву для тех, которых в последнем срезе нет (Р-20). Правка в «Семье»
 * и новый срез видны сразу: перечитывается по событию базы.
 */

import { useEffect, useState } from 'react'
import { ordered } from '../app/apps.ts'
import { db } from '../app/core.ts'
import type { Bundle } from '../app/model.ts'
import { archiveLabels } from '../reading/seen.ts'
import type { ArchiveLabels } from '../view/bundles.ts'

/** `null` — ещё читается. */
export function useBundles(): Bundle[] | null {
  const [bundles, setBundles] = useState<Bundle[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      void db.getAll('bundles').then((all) => {
        if (alive) setBundles(ordered(all))
      })
    load()
    const stop = db.onChange((event) => {
      if (event.store === 'bundles') load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [])

  return bundles
}

/** Подписи по архиву для приложений, чьи строки лежат в связках. */
export function useArchiveLabels(bundles: readonly Bundle[] | null): ArchiveLabels {
  const [labels, setLabels] = useState<ArchiveLabels>(new Map())
  const apps = [...new Set((bundles ?? []).flatMap((bundle) => bundle.rows.map((row) => row.app)))].sort()
  const key = apps.join('|')

  useEffect(() => {
    let alive = true
    const ids = key === '' ? [] : key.split('|')
    const load = () =>
      void archiveLabels(ids).then((found) => {
        if (alive) setLabels(found)
      })
    load()
    const stop = db.onChange((event) => {
      if (event.store === 'seen') load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [key])

  return labels
}
