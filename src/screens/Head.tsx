import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Шапка экрана со «Справкой» и шестерёнкой «Настроек» справа: в нижней
 * панели их нет, заходят туда редко.
 */
export function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="screen-head">
      <div className="screen-head__row">
        <h1>{title}</h1>
        <div className="screen-head__tools">
          <Link className="gear" to="/help" aria-label="Справка">
            <span aria-hidden="true">?</span>
          </Link>
          <Link className="gear" to="/settings" aria-label="Настройки">
            <span aria-hidden="true">⚙</span>
          </Link>
        </div>
      </div>
      {children}
    </header>
  )
}
