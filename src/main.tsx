import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app.tsx'
import { db } from './app/core.ts'
import { listenInstall } from './shared/ui/install.ts'
import { listenErrors } from './shared/ui/report.ts'
import { loadTitle } from './ui/useTitle.ts'
// Каркас стилей ядра — первым, свои экраны и акцент — после.
import './shared/styles.css'
import './styles.css'

/**
 * Сколько ждать своего названия до первого экрана (Р-03). Без ожидания шапка
 * мигает именем по умолчанию; база медлит — экран открывается всё равно,
 * и название подъедет следом.
 */
const TITLE_WAIT_MS = 500

// До первого экрана: Chrome присылает событие установки рано и один раз.
listenInstall()

// Тоже до первого экрана: ошибка при отрисовке должна попасть в журнал.
listenErrors(db.settings)

const root = document.getElementById('root')
if (!root) throw new Error('Не найден #root')
const mount = root

void Promise.race([loadTitle().catch(() => {}), new Promise((done) => setTimeout(done, TITLE_WAIT_MS))]).finally(
  () => {
    createRoot(mount).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  },
)

// Постоянное хранилище: без него браузер вправе стереть базу при
// нехватке места. Отказ — не ошибка, работать можно и так.
void db.persist()

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // Установленное приложение может неделями не запускаться с нуля. Без
    // периодической проверки оно не узнает о новой сборке: запрос на
    // обновление уходит только при холодном старте.
    if (!registration) return
    setInterval(
      () => {
        void registration.update()
      },
      60 * 60 * 1000,
    )
  },
})
