import Link from 'next/link'

import { buttonClassName } from '@/components/button'

/** Root 404 — covers unknown URLs and `notFound()` from /sites/[slug]. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-140 flex-1 flex-col items-center justify-center gap-5 px-4 py-20 text-center">
      <p className="font-mono text-7xl leading-none font-bold text-(--brand-nine-blue)">404</p>
      <h1 className="text-[28px] leading-tight font-bold">Site not found</h1>
      <p className="text-(--text-secondary)">
        อาจถูกลบหรือเปลี่ยนชื่อไปแล้ว ตรวจรายชื่อเว็บทั้งหมดได้ที่หน้าภาพรวม
      </p>
      <Link href="/" className={buttonClassName('primary')}>
        Back to overview
      </Link>
    </main>
  )
}
