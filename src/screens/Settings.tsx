import { useEffect, useRef, useState } from 'react'
import { config } from '../app/config.ts'
import { db } from '../app/core.ts'
import { SCHEMA_VERSION, type Store } from '../app/model.ts'
import { CHANGES } from '../changes.ts'
import { today } from '../shared/core/dates.ts'
import { ChangeList } from '../shared/screens/WhatsNew.tsx'
import { backupNote, backupSummary } from '../shared/ui/backup.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { InstallNote } from '../shared/ui/Install.tsx'
import { ReportBug } from '../shared/ui/Report.tsx'
import { SyncSettings } from '../shared/ui/SyncSettings.tsx'
import { useSyncStatus } from '../shared/ui/useSync.ts'
import type { App } from '../app/model.ts'
import { botList, LIST_FILE, listText } from '../bot/list.ts'
import { checkAccess, type Access } from '../reading/read.ts'
import { DEFAULT_TITLE, MAX_TITLE } from '../ui/title.ts'
import { useApps } from '../ui/useApps.ts'
import { useBase, type BaseCounts } from '../ui/useBase.ts'
import { saveTitle, useTitle } from '../ui/useTitle.ts'
import { useToken } from '../ui/useToken.ts'
import { FAMILY_TAB } from './tabs.ts'

/** Когда в последний раз сохраняли копию файлом. В `settings`: у каждого устройства своё. */
const LAST_EXPORT = 'lastExportAt'

const LABELS: Record<Store, string> = {
  apps: 'Приложения семьи',
  seen: 'Увиденные срезы',
  bundles: 'Связки',
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/**
 * «Настройки» — шестерёнкой в шапке. Разделы свёрнуты, пока их не открыли:
 * сюда заходят за чем-то одним. Токена нет — это видно у свёрнутого
 * «Доступа к приложениям» и подсказкой на «Сводке».
 */
export function Settings() {
  const base = useBase()

  return (
    <>
      <header className="screen-head">
        <h1>Настройки</h1>
      </header>

      <SyncSection />
      <AccessSection />
      <TitleSection />
      <DataCopy base={base} />
      <BotSection />
      <About base={base} />
    </>
  )
}

/**
 * Своя синхронизация (Р-33, Я-36): `SyncSettings` ядра — свой репозиторий
 * данных и токен «семья». Ниже — как она устроена у «Тотального Учёта»:
 * что едет и с какого устройства включать первым.
 */
function SyncSection() {
  return (
    <>
      <SyncSettings onChanged={async () => {}} />
      <Fold id="settings:sync:help" title="Как переезжает список" folded>
        <p className="muted">
          Токен «семья» — один для всех приложений семьи на этом устройстве: вписанный здесь или в любом из них, он
          читает срезы и синхронизирует. В свой репозиторий данных уезжают приложения из «{FAMILY_TAB.name}», связки
          и увиденные срезы; на другом устройстве они приезжают сами, правка и удаление — тоже.
        </p>
        <p className="muted">
          Включай синхронизацию первым на устройстве, где список правильный. Если на втором устройстве список уже
          вносили руками отдельно — после первого обмена приложения задвоятся: лишнее убери в «{FAMILY_TAB.name}»,
          удаление разойдётся само.
        </p>
      </Fold>
    </>
  )
}

/**
 * Доступ к репозиториям данных приложений (Р-05, Р-33): видит ли токен
 * «семья» каждый. Тем же `checkAccess`, что до него у токена чтения; полное
 * имя — чтобы сверить с вписанным (Я-25). Сам токен на экран не выводится.
 */
function AccessSection() {
  const token = useToken()
  const apps = useApps()
  const [checks, setChecks] = useState<{ app: App; access: Access }[] | null>(null)
  const [checking, setChecking] = useState(false)

  async function check() {
    if (!token || !apps) return
    setChecking(true)
    setChecks(null)
    const results = await Promise.all(apps.map(async (app) => ({ app, access: await checkAccess({ dataRepo: app.dataRepo, token }) })))
    setChecks(results)
    setChecking(false)
  }

  return (
    <Fold
      id="settings:access"
      title="Доступ к приложениям"
      summary={token === undefined ? undefined : token === null ? <span className="error">нет токена</span> : undefined}
      folded
    >
      <p className="muted">
        Видит ли токен «семья» репозиторий данных каждого приложения из «{FAMILY_TAB.name}» — без этого его срез не
        читается.
      </p>

      {token === null && <p className="muted">Токена нет: впиши его в «Синхронизации» выше или в любом приложении семьи.</p>}

      {token && apps?.length === 0 && (
        <p className="muted">Проверять пока нечего: приложения добавляются во вкладке «{FAMILY_TAB.name}».</p>
      )}

      {token && (
        <div className="row row--wrap">
          <button type="button" className="btn" onClick={() => void check()} disabled={checking || !apps || apps.length === 0}>
            {checking ? 'Проверяю…' : 'Проверить доступ к приложениям'}
          </button>
        </div>
      )}

      {checks && (
        <ul className="plain access">
          {checks.map(({ app, access }) => (
            <li key={app.id}>
              <strong>{app.name}</strong>
              {access.ok ? (
                <span className="muted"> — видит {access.fullName}</span>
              ) : (
                <span className="error"> — {access.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Fold>
  )
}

/** Своё название приложения на этом устройстве (Р-03). */
function TitleSection() {
  const title = useTitle()
  const [draft, setDraft] = useState(title)
  const [note, setNote] = useState('')

  async function save() {
    try {
      await saveTitle(draft)
      setNote('Сохранено')
    } catch (error) {
      setNote(`Не сохранилось: ${describe(error)}`)
    }
  }

  return (
    <Fold id="settings:title" title="Название" summary={title} folded>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="field">
          <span>Как называть приложение на этом устройстве</span>
          <input
            name="title"
            value={draft}
            maxLength={MAX_TITLE}
            onChange={(event) => {
              setDraft(event.target.value)
              setNote('')
            }}
          />
        </label>
        <div className="row row--wrap">
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(DEFAULT_TITLE)
              setNote('')
            }}
          >
            Как было
          </button>
        </div>
      </form>
      <p className="muted">
        Меняется шапка и заголовок вкладки. Подпись под иконкой остаётся «{DEFAULT_TITLE}»: её телефон
        запоминает при установке. Название живёт только на этом устройстве.
      </p>
      {note && <p className="muted">{note}</p>}
    </Fold>
  )
}

/**
 * Копия данных файлом — запасной путь: список приложений, связки и архив
 * срезов переезжают синхронизацией (Р-33). Тревога о копии — по настоящему
 * состоянию синхронизации. Токен в копию не входит.
 */
function DataCopy({ base }: { base: BaseCounts }) {
  const sync = useSyncStatus()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [lastSaved, setLastSaved] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    void db.settings.get<string>(LAST_EXPORT).then((value) => setLastSaved(value ?? null))
  }, [])

  async function save() {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const snapshot = await db.exportAll()
      download(`${config.dbName}-${today()}.json`, JSON.stringify(snapshot, null, 2))
      // Браузер не сообщает, дошёл ли файл до диска: отметка означает
      // «выгрузку запускали», а не «копия точно есть».
      const at = new Date().toISOString()
      await db.settings.set(LAST_EXPORT, at)
      setLastSaved(at)
      setNote('Файл сохранён')
    } catch (failure) {
      setError(describe(failure))
    } finally {
      setBusy(false)
    }
  }

  async function open(file: File) {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const applied = await db.importAll(db.parseSnapshot(await file.text()))
      setNote(applied === 0 ? 'Ничего не изменилось: в файле нет записей новее здешних' : `Загружено записей: ${applied}`)
    } catch (failure) {
      setError(describe(failure))
    } finally {
      setBusy(false)
      // Тот же файл должен открываться повторно — без сброса второй выбор не даёт события.
      if (input.current) input.current.value = ''
    }
  }

  // Пустой базе копировать нечего — и тревожить незачем.
  const empty = !base.counted || base.empty
  const summary = lastSaved === undefined || empty ? undefined : backupSummary(lastSaved, sync, today())
  const facts = lastSaved === undefined || empty ? null : backupNote(lastSaved, sync, today())

  return (
    <Fold
      id="settings:copy"
      title="Копия данных"
      summary={summary && (summary.tone === 'error' ? <span className="error">{summary.text}</span> : summary.text)}
      folded
    >
      <p className="muted">
        Список приложений, связки и увиденные срезы — одним файлом. Запасной путь: с синхронизацией они
        переезжают на другое устройство сами. Токен в копию не входит.
      </p>
      <div className="row row--wrap">
        <button type="button" className="btn" onClick={() => void save()} disabled={busy}>
          Сохранить в файл
        </button>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
          Восстановить из копии
        </button>
      </div>
      {empty ? (
        <p className="muted">Записей пока нет — копировать нечего.</p>
      ) : (
        facts && <p className={facts.tone === 'error' ? 'error' : 'muted'}>{facts.text}</p>
      )}
      <p className="muted">
        Восстановление не стирает то, что уже есть: записи сливаются по времени правки, побеждает более
        поздняя.
      </p>

      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void open(file)
        }}
      />

      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}
    </Fold>
  )
}

/** Как завести бота по шагам — раздел документов проекта (Р-23). */
const BOT_GUIDE = 'https://github.com/goigolden88/TotalUchet/blob/main/docs/06-Процесс.md#телеграм-бот-как-завести'

/**
 * Список для Телеграм-бота файлом (Р-28): бот живёт в приватном репозитории
 * человека и этого устройства не видит. В файле — приложения, своё название
 * и адрес «Сводки»; ни токена, ни срезов, ни связок.
 */
function BotSection() {
  const apps = useApps()
  const title = useTitle()
  const [note, setNote] = useState('')

  return (
    <Fold id="settings:bot" title="Телеграм-бот" summary="список — файлом" folded>
      <p>
        Бот раз в неделю присылает в твой личный чат в Телеграме то же, что показывает «Сводка»: кто зовёт и строки
        приложений с основаниями. Живёт он в твоём приватном репозитории на GitHub и этого устройства не видит —
        список приложений ему нужен файлом.
      </p>
      {apps?.length === 0 ? (
        <p className="muted">
          Приложений пока нет — сначала добавь их во вкладке «{FAMILY_TAB.name}».
        </p>
      ) : (
        <div className="row row--wrap">
          <button
            type="button"
            className="btn"
            disabled={!apps}
            onClick={() => {
              if (!apps) return
              download(LIST_FILE, listText(botList(apps, title, window.location.href)))
              setNote('Файл сохранён — положи его в репозиторий бота')
            }}
          >
            Скачать список для бота
          </button>
        </div>
      )}
      <p className="muted">
        В файле — имена приложений, их репозитории данных и сайты; токена и срезов в нём нет. Поменял приложения
        в «{FAMILY_TAB.name}» — скачай и положи файл заново. В Телеграм уходит всё, что видно на «Сводке», и остаётся
        в истории чата.
      </p>
      <p className="muted">
        <a href={BOT_GUIDE} target="_blank" rel="noopener">
          Как завести бота — по шагам
        </a>
      </p>
      {note && <p className="muted">{note}</p>}
    </Fold>
  )
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Сразу отозвать нельзя: часть браузеров начинает скачивание после click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Версия, сборка и что лежит в базе. Сюда смотрят, когда проверяют,
 * доехало ли обновление, — дата сборки видна и у свёрнутого раздела.
 */
function About({ base }: { base: BaseCounts }) {
  const [persistent, setPersistent] = useState<boolean | null | undefined>(undefined)

  useEffect(() => {
    void db.persisted().then(setPersistent)
  }, [])

  const built = new Date(__BUILD_TIME__)
  const short = built.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <Fold id="settings:about" title="О приложении" summary={`сборка ${short}`} folded>
      <dl className="facts">
        <dt>Версия схемы</dt>
        <dd>{SCHEMA_VERSION}</dd>
        <dt>Сборка</dt>
        <dd>{built.toLocaleString('ru-RU')}</dd>
        {persistent !== undefined && (
          <>
            <dt>Очистка браузером</dt>
            <dd>
              {persistent === true
                ? 'не грозит — стереть данные можно только самому'
                : persistent === false
                  ? 'возможна при нехватке места'
                  : 'браузер не сообщает'}
            </dd>
          </>
        )}
      </dl>

      <h3 className="unit__name">Установка</h3>
      <InstallNote empty={!base.counted || base.empty} />

      <Fold id="settings:about:changes" title="Что нового" sub folded>
        <ChangeList changes={CHANGES} />
      </Fold>

      <Fold id="settings:about:report" title="Сообщить об ошибке" sub folded>
        <ReportBug />
      </Fold>

      {base.error && <p className="error">База не открылась: {base.error}</p>}

      {base.counted && (
        <table className="stats">
          <tbody>
            {(Object.keys(LABELS) as Store[]).map((store) => (
              <tr key={store}>
                <td>{LABELS[store]}</td>
                <td className="num">{base.counts[store]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Fold>
  )
}
