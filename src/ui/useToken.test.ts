import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config } from '../app/config.ts'
import { db, sync } from '../app/core.ts'
import { family } from '../shared/core/db.ts'
import { createLayout } from '../shared/core/layout.ts'
import { currentToken, dropReadToken, OLD_TOKEN_KEY, reloadToken } from './useToken.ts'

/**
 * Токен «семья» и своя синхронизация (Р-33, Я-36). Токены — выдуманные (Р-01).
 */

const FAMILY_TOKEN = 'fake-family-token'
const READ_TOKEN = 'fake-read-token'

beforeEach(async () => {
  await db.close().catch(() => {})
  globalThis.indexedDB = new IDBFactory()
})

afterEach(async () => {
  await db.close().catch(() => {})
})

describe('чтение срезов — токеном «семья» (Р-33)', () => {
  it('токен из общей базы; нет его — «нет токена»', async () => {
    await reloadToken()
    expect(currentToken()).toBeNull()

    await family.setToken(FAMILY_TOKEN)
    await reloadToken()
    expect(currentToken()).toBe(FAMILY_TOKEN)
  })

  it('замена и «Забыть» в любом приложении видны при перечитывании — без перезапуска', async () => {
    await family.setToken(FAMILY_TOKEN)
    await reloadToken()
    await family.setToken('fake-family-token-2')
    await reloadToken()
    expect(currentToken()).toBe('fake-family-token-2')

    await family.forgetToken()
    await reloadToken()
    expect(currentToken()).toBeNull()
  })

  it('читать можно и без своей синхронизации: имя своего репозитория не нужно', async () => {
    await family.setToken(FAMILY_TOKEN)
    await reloadToken()
    expect(currentToken()).toBe(FAMILY_TOKEN)
    expect((await sync.readConfig()).enabled).toBe(false)
  })
})

describe('прежний токен чтения (Р-33)', () => {
  it('чтение его не берёт', async () => {
    await db.settings.set(OLD_TOKEN_KEY, READ_TOKEN)
    await reloadToken()
    expect(currentToken()).toBeNull()
  })

  it('удаляется с устройства и в общую базу не переезжает никогда', async () => {
    await db.settings.set(OLD_TOKEN_KEY, READ_TOKEN)
    // Переезд давних полей ядра (Я-41) идёт при первом чтении настроек синхронизации.
    await sync.readConfig()
    expect((await family.read()).token).toBeNull()

    await dropReadToken()
    expect(await db.settings.get(OLD_TOKEN_KEY)).toBeUndefined()
    expect((await family.read()).token).toBeNull()
  })

  it('на устройстве с токеном «семья» он остаётся прежним', async () => {
    await family.setToken(FAMILY_TOKEN)
    await db.settings.set(OLD_TOKEN_KEY, READ_TOKEN)
    await sync.readConfig()
    await dropReadToken()
    expect((await family.read()).token).toBe(FAMILY_TOKEN)
  })
})

describe('своя синхронизация (Р-33)', () => {
  it('включается сама, когда есть токен «семья» и своё имя репозитория (Я-37)', async () => {
    await family.setToken(FAMILY_TOKEN)
    await sync.saveConfig({ repo: 'someone/meta-data' })
    const own = await sync.readConfig()
    expect(own.enabled).toBe(true)
    expect(own.repo).toBe('someone/meta-data')
    expect((await family.read()).repos[config.dbName]).toBe('someone/meta-data')
  })

  it('едут все три хранилища: apps.json, seen/ГГГГ-ММ.json, bundles.json; чужие файлы — нет', () => {
    const plan = sync.planDownload(
      { 'apps.json': 'a', 'seen/2026-09.json': 'b', 'bundles.json': 'c', 'summary.json': 'd', 'README.md': 'e' },
      {},
    )
    expect(plan.merged).toEqual(['apps.json', 'bundles.json', 'seen/2026-09.json'])
  })

  it('meta.json — с app totaluchet: в чужой репозиторий проход не пишет (Я-24)', () => {
    expect(JSON.parse(createLayout(config).metaFile().content)).toMatchObject({ app: 'totaluchet' })
  })
})
