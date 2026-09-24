import { useState } from 'react'
import { checkApp, nextOrder, type AppInput } from '../app/apps.ts'
import { db } from '../app/core.ts'
import type { App } from '../app/model.ts'
import { isCalm, stateLine, type AppState } from '../reading/refresh.ts'
import { nowIso } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { foldSummary, useReadOnOpen } from '../ui/reading.tsx'
import { freshness } from '../view/periods.ts'
import { Head } from './Head.tsx'
import { NoToken } from './NoToken.tsx'
import { FAMILY_TAB, SUMMARY_TAB } from './tabs.ts'

/**
 * «Семья» — приложения семьи (Р-07). Список — записи человека, не код
 * (Я-16, Я-22): добавить, поправить, убрать; порядок — числом в той же
 * форме (Р-10).
 *
 * У каждого приложения — состояние среза теми же словами, что на «Сводке»;
 * чтение с ней общее и идёт при открытии экрана (Р-13). Приложение — блоком,
 * который сворачивается; у свёрнутого — итог. «Как установить» — один блок
 * со ссылкой на сайт каждого: поставить соседа отсюда браузер не даёт,
 * отметки «установлено» нет (Р-07).
 */
export function Family() {
  const { apps, token, states } = useReadOnOpen()
  // null — формы нет; 'new' — новое приложение; иначе — правка этого.
  const [editing, setEditing] = useState<App | 'new' | null>(null)
  const [note, setNote] = useState('')

  async function drop(app: App) {
    if (!window.confirm(`Убрать «${app.name}» из семьи? Увиденные срезы останутся в архиве.`)) return
    await db.remove('apps', app.id)
    setNote(`«${app.name}» убрано`)
  }

  return (
    <>
      <Head title={FAMILY_TAB.name} />

      {token === null && apps && apps.length > 0 && <NoToken />}

      {apps?.map((app) => {
        // Правка — на месте, в блоке приложения: форма внизу списка уехала бы с экрана.
        const open = editing !== null && editing !== 'new' && editing.id === app.id
        return (
          <Fold
            key={app.id}
            id={`family:app:${app.id}`}
            title={app.name}
            summary={foldSummary(states.get(app.id))}
            reveal={open}
          >
            {open ? (
              <AppForm app={app} order={app.order} onDone={done} />
            ) : (
              <div className="family__app">
                <AppLine state={states.get(app.id)} />
                <div className="muted">{app.dataRepo}</div>
                <a href={app.site} target="_blank" rel="noopener">
                  {app.site}
                </a>
                <div className="row row--wrap">
                  <button type="button" className="btn" onClick={() => start(app)}>
                    Поправить
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => void drop(app)}>
                    Убрать
                  </button>
                </div>
              </div>
            )}
          </Fold>
        )
      })}

      <section className="block">
        {apps && apps.length === 0 && editing === null && (
          <p className="muted">
            Приложений пока нет. Добавь те, чьи итоги хочешь видеть во вкладке «{SUMMARY_TAB.name}»: имя,
            репозиторий данных, из которого читать срез, и адрес сайта.
          </p>
        )}

        {editing === 'new' ? (
          <AppForm key="new" app={null} order={nextOrder(apps ?? [])} onDone={done} />
        ) : (
          apps && (
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => start('new')}>
                Добавить приложение
              </button>
            </div>
          )
        )}

        {note && <p className="muted">{note}</p>}
      </section>

      {apps && apps.length > 0 && <Install apps={apps} />}
    </>
  )

  function start(target: App | 'new') {
    setEditing(target)
    setNote('')
  }

  function done(text: string) {
    setEditing(null)
    setNote(text)
  }
}

/**
 * Состояние среза приложения — теми же словами, что на «Сводке» (Р-13):
 * прочитан — свежесть; нет — строка состояния чтения.
 */
function AppLine({ state }: { state: AppState | undefined }) {
  if (!state) return null
  const line = stateLine(state)
  return (
    <>
      {state.seen && <div className="muted">{freshness(state.seen.summary)}</div>}
      {line && <div className={isCalm(state) ? 'muted' : 'error'}>{line}</div>}
    </>
  )
}

/**
 * «Как установить» (Р-07, Р-13). Поставить соседа отсюда браузер не даёт:
 * каждое приложение ставится со своего сайта, своей кнопкой. Поэтому —
 * объяснение и ссылка на сайт каждого: какое ставить, человек выбирает сам.
 */
function Install({ apps }: { apps: readonly App[] }) {
  return (
    <Fold id="family:install" title="Как установить" summary="каждое — со своего сайта" folded>
      <p className="muted">
        Отсюда приложение не поставить — браузер разрешает установку только с сайта самого приложения. Открой
        нужное и нажми в нём «Установить» или в меню браузера — «Установить приложение» или «Добавить на главный
        экран». Что уже стоит, отсюда не видно.
      </p>
      <ul className="plain install">
        {apps.map((app) => (
          <li key={app.id} className="install__app">
            <span>{app.name}</span>
            <a href={app.site} target="_blank" rel="noopener">
              открыть сайт
            </a>
          </li>
        ))}
      </ul>
    </Fold>
  )
}

function AppForm({ app, order, onDone }: { app: App | null; order: number; onDone: (note: string) => void }) {
  const [input, setInput] = useState<AppInput>(
    app
      ? { name: app.name, dataRepo: app.dataRepo, site: app.site, order: String(app.order) }
      : { name: '', dataRepo: '', site: '', order: String(order) },
  )
  const [problems, setProblems] = useState<string[]>([])

  function field(key: keyof AppInput) {
    return {
      name: key,
      value: input[key],
      onChange: (event: { target: { value: string } }) => {
        setInput({ ...input, [key]: event.target.value })
        setProblems([])
      },
    }
  }

  async function save() {
    const checked = checkApp(input)
    if (!checked.ok) {
      setProblems(checked.problems)
      return
    }
    await db.put('apps', app ? { ...app, ...checked.fields } : { id: ulid(), updatedAt: nowIso(), ...checked.fields })
    onDone(app ? `«${checked.fields.name}» поправлено` : `«${checked.fields.name}» добавлено`)
  }

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="field">
        <span>Имя — как подписывать на экранах</span>
        <input {...field('name')} autoComplete="off" />
      </label>
      <label className="field">
        <span>Репозиторий данных — «владелец/имя» или ссылка на него</span>
        <input {...field('dataRepo')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        <span>Сайт приложения — адрес любого его экрана</span>
        <input {...field('site')} inputMode="url"autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        <span>Порядок — меньше стоит выше</span>
        <input {...field('order')} inputMode="decimal" autoComplete="off" />
      </label>
      {problems.length > 0 && (
        <ul className="error">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="form__actions">
        <button type="button" className="btn" onClick={() => onDone('')}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary">
          Сохранить
        </button>
      </div>
    </form>
  )
}
