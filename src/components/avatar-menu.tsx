'use client'

import { KeyRound, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { Avatar } from '@/components/avatar'

const ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm text-(--text-primary) ' +
  'hover:bg-(--surface-raised) focus-visible:bg-(--surface-raised)'

/**
 * Avatar button + account menu. Keyboard: Enter / Space / ↓ open it on the
 * first item, ↑ / ↓ / Home / End move, Escape closes and returns focus to the
 * button, Tab moves on and closes. A click outside closes it too.
 */
export function AvatarMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function close({ refocus }: { refocus: boolean }) {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close({ refocus: true })
        break
      case 'ArrowDown':
        event.preventDefault()
        list[(index + 1) % list.length]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        list[(index - 1 + list.length) % list.length]?.focus()
        break
      case 'Home':
        event.preventDefault()
        list[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        list[list.length - 1]?.focus()
        break
      case 'Tab':
        close({ refocus: false })
        break
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="flex rounded-full"
      >
        <Avatar name={name} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 flex w-64 flex-col gap-1 rounded-md border border-(--border-strong) bg-(--surface-card) p-1.5 shadow-lg shadow-black/40"
        >
          <div className="border-b border-(--border-subtle) px-3 pt-1.5 pb-2.5">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate font-mono text-xs text-(--text-muted)">{email}</p>
          </div>
          <Link
            href="/account/password"
            role="menuitem"
            tabIndex={-1}
            onClick={() => close({ refocus: false })}
            className={ITEM_CLASS}
          >
            <KeyRound size={16} aria-hidden="true" className="text-(--text-muted)" />
            Change password
          </Link>
          <form action="/auth/sign-out" method="post">
            <button type="submit" role="menuitem" tabIndex={-1} className={ITEM_CLASS}>
              <LogOut size={16} aria-hidden="true" className="text-(--text-muted)" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
