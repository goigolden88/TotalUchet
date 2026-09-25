import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { App } from '../app/model.ts'
import { CHANGES } from '../changes.ts'
import { isCalm, stateLine, type AppState } from '../reading/refresh.ts'
import { formatDateLong, formatPeriod } from '../shared/core/dates.ts'
import type { Summary as Slice, SummaryPeriod } from '../shared/core/summary.ts'
import { WhatsNew } from '../shared/screens/WhatsNew.tsx'
import { Fold } from '../shared/ui/Fold.tsx'
import { useWhatsNew } from '../shared/screens/useWhatsNew.ts'
import { useToday } from '../shared/ui/useToday.ts'
import { useBase } from '../ui/useBase.ts'
import { useArchiveLabels, useBundles } from '../ui/useBundles.ts'
import { foldSummary, useReadOnOpen } from '../ui/reading.tsx'
import { useTitle } from '../ui/useTitle.ts'
import { calls } from '../view/attention.ts'
import { appBlock } from '../view/block.ts'
import { CHOICES, DEFAULT_CHOICE, screenPeriod, type Choice } from '../view/periods.ts'
import { BundleBlock } from './Bundles.tsx'
import { Head } from './Head.tsx'
import { NoToken } from './NoToken.tsx'
import { FAMILY_TAB } from './tabs.ts'

/**
 * «Сводка» — главный экран (Р-04, Р-06). Сверху «Зовут», ниже — отрезок
 * переключателем, связки (Р-19) и блок каждого приложения. Показывает, а не досчитывает
 * (Я-15): строки — в порядке хозяина, значение — одно за раз.
 *
 * «Зовут» и блоки приложений сворачиваются; у свёрнутого — итог рядом
 * с заголовком.
 *
 * Чтение — общее с «Семьёй» (Р-13): сразу — последние увиденные срезы
 * из архива; затем каждое приложение читается само по себе, ошибка одного
 * не трогает остальных (Р-05). Читается при открытии и кнопкой «Обновить»,
 * в фоне — нет.
 */
export function Summary() {
  const title = useTitle()
  const day = useToday()
  const base = useBase()
  const whatsNew = useWhatsNew(base, CHANGES)
  const { apps, token, states, reading, refresh } = useReadOnOpen()
  const bundles = useBundles()
  const archive = useArchiveLabels(bundles)

  const [choice, setChoice] = useState<Choice>(DEFAULT_CHOICE)

  const screen = screenPeriod(choice, day)
  const latest = useMemo(() => {
    const map = new Map<string, Slice>()
    for (const [app, state] of states) if (state.seen) map.set(app, state.seen.summary)
    return map
  }, [states])
  const calling = apps ? calls(apps, latest) : null

  return (
    <>
      <Head title={title}>
        <p className="muted">{formatDateLong(day)}</p>
      </Head>

      {whatsNew.show.length > 0 && <WhatsNew changes={whatsNew.show} onDone={whatsNew.dismiss} />}

      {token === null && <NoToken />}

      {apps?.length === 0 && (
        <section className="block">
          <p className="stub">
            Приложений пока нет. Добавь их во вкладке <Link to={FAMILY_TAB.to}>«{FAMILY_TAB.name}»</Link> — здесь
            появятся их неделя и месяц, как их посчитали сами приложения, и кто из них зовёт.
          </p>
        </section>
      )}


      {token && apps && apps.length > 0 && (
        <div className="row refresh">
          <button type="button" className="btn" onClick={refresh} disabled={reading > 0}>
            {reading > 0 ? 'Читаю…' : 'Обновить'}
          </button>
        </div>
      )}

      {calling?.anySeen && (
        <Fold id="summary:calls" title="Зовут" summary={calling.groups.length === 0 ? 'не зовут' : calling.groups.map((group) => group.app.name).join(', ')}>
          {calling.groups.length === 0 ? (
            <p className="muted">Приложения сейчас не зовут.</p>
          ) : (
            calling.groups.map((group) => (
              <div key={group.app.id} className="calls__app">
                <h3 className="unit__name">{group.app.name}</h3>
                <ul className="plain">
                  {group.items.map((item) => (
                    <li key={item.key} className="call">
                      <div className="call__head">
                        <span>
                          {item.label}
                          {item.count && <strong> · {item.count}</strong>}
                          <span className="muted"> · {item.day}</span>
                        </span>
                        <a href={item.href} target="_blank" rel="noopener">
                          открыть
                        </a>
                      </div>
                      <div className="basis">{item.basis}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Fold>
      )}

      {apps && apps.length > 0 && (
        <>
          <div className="switch" role="group" aria-label="Отрезок">
            {CHOICES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === choice ? 'switch__btn switch__btn--on' : 'switch__btn'}
                aria-pressed={item.id === choice}
                onClick={() => setChoice(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="muted period">{formatPeriod(screen)}</p>

          {bundles?.map((bundle) => (
            <BundleBlock key={bundle.id} bundle={bundle} screen={screen} apps={apps} states={states} archive={archive} />
          ))}

          {apps.map((app) => (
            <AppBlock key={app.id} app={app} state={states.get(app.id)} screen={screen} />
          ))}
        </>
      )}
    </>
  )
}

/** Блок приложения: свежесть, состояние чтения, отрезок и строки хозяина. */
function AppBlock({ app, state, screen }: { app: App; state: AppState | undefined; screen: SummaryPeriod }) {
  const summary = state?.seen?.summary
  const line = state ? stateLine(state) : ''
  const block = summary ? appBlock(summary, screen) : null
  const body = block?.body
  return (
    <Fold id={`summary:app:${app.id}`} title={app.name} summary={foldSummary(state)}>
      {block && <p className="muted">{block.freshness}</p>}
      {line && <p className={state && isCalm(state) ? 'muted' : 'error'}>{line}</p>}
      {!state && <p className="muted">…</p>}

      {body?.kind === 'missing' && <p className="muted">{body.text}</p>}
      {body && body.kind !== 'missing' && (
        <>
          {body.going && <p className="muted">{body.going}</p>}
          {body.kind === 'unknown' ? (
            <p className="muted">{body.text}</p>
          ) : (
            <ul className="plain metrics">
              {body.rows.map((row) => (
                <li key={row.key} className="metric">
                  <div className="metric__row">
                    <span>{row.label}</span>
                    <span className={row.value.muted ? 'metric__value muted' : 'metric__value'}>{row.value.text}</span>
                  </div>
                  <div className="basis">{row.basis}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Fold>
  )
}
