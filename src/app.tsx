import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { config } from './app/config.ts'
import { db, sync } from './app/core.ts'
import type { Sync } from './shared/core/sync.ts'
import { CoreProvider } from './shared/ui/core.tsx'
import { Layout } from './shared/ui/Layout.tsx'
import { Family } from './screens/Family.tsx'
import { Settings } from './screens/Settings.tsx'
import { Summary } from './screens/Summary.tsx'
import { TABS } from './screens/tabs.ts'
import { ReadingProvider } from './ui/reading.tsx'
import { reloadToken } from './ui/useToken.ts'

/**
 * Синхронизация для «Настроек»: токен «семья», вписанный или забытый здесь,
 * чтение срезов видит сразу — без возврата на вкладку (Р-33).
 */
const shared: Sync = {
  ...sync,
  async saveConfig(patch) {
    await sync.saveConfig(patch)
    if (patch.token !== undefined) await reloadToken()
  },
  async forgetToken() {
    await sync.forgetToken()
    await reloadToken()
  },
}

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Общий интерфейс ядра — нижняя панель, «Что нового», отчёт об ошибке —
 * берёт базу и синхронизацию из `CoreProvider` (Р-33).
 * Чтение срезов — одно на «Сводку» и «Семью»: `ReadingProvider` (Р-13).
 */
export function App() {
  return (
    <CoreProvider value={{ config, db, sync: shared }}>
      <ReadingProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Layout tabs={TABS} />}>
              <Route index element={<Summary />} />
              <Route path="family" element={<Family />} />
              <Route path="settings" element={<Settings />} />
              {/* Незнакомый адрес — на главный, а не в пустоту. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </ReadingProvider>
    </CoreProvider>
  )
}
