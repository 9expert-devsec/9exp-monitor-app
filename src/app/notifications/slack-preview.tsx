import { Logo } from '@/components/logo'
import { SENDER_NAME, TONE_COLOR, type SlackMessageModel } from '@/lib/notify/slack-message'

/**
 * A static, Slack-looking rendering of real message models — the same objects
 * `toSlackPayload()` turns into the webhook body.
 */
export function SlackPreview({ messages }: { messages: SlackMessageModel[] }) {
  return (
    <div className="flex flex-col gap-4 rounded-md bg-[#1A1D21] p-4 font-sans text-[#D1D2D3]">
      {messages.map((message, index) => (
        <div key={index} className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white">
            <Logo size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-bold text-white">{SENDER_NAME}</span>
              <span className="ml-1.5 rounded-sm bg-[#3C3F44] px-1 text-[10px] font-semibold text-[#ABABAD]">APP</span>
            </p>
            <div className="mt-1 flex gap-2">
              <span aria-hidden="true" className="w-1 shrink-0 rounded-full" style={{ background: TONE_COLOR[message.tone] }} />
              <div className="min-w-0 text-sm leading-relaxed">
                <p className="font-bold text-white">{message.title}</p>
                {message.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {message.link && <p className="text-[#1D9BD1]">{message.link.label}</p>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
