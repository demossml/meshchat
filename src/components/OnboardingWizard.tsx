import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Step = 0 | 1 | 2

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>(0)
  const { config, groupProfiles, messages, setTab, completeOnboarding } = useStore()

  const hasConnection = Boolean(config)
  const hasGroup = groupProfiles.length > 0
  const hasTestMessage = useMemo(
    () => Object.values(messages).some(list => list.some(msg => msg.isOwn && Boolean(msg.clientMsgId))),
    [messages],
  )

  const canContinue = step === 0
    ? hasConnection
    : step === 1
      ? hasGroup
      : hasTestMessage

  const goBack = () => {
    if (step === 2) setStep(1)
    else if (step === 1) setStep(0)
  }

  const goNext = () => {
    if (step === 0) setStep(1)
    else if (step === 1) setStep(2)
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/75 p-3 backdrop-blur-[1px] sm:items-center">
      <div className="w-full max-w-[460px] rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs tracking-[0.08em] text-zinc-300">QUICK START</div>
          <Badge variant="outline" className="h-5 border-zinc-700 bg-zinc-900 px-2 text-[9px] text-zinc-400">
            Шаг {step + 1}/3
          </Badge>
        </div>

        {step === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-1 text-[11px] font-medium text-zinc-100">1. Connect</div>
            <div className="text-[10px] text-zinc-400">
              Подключение выполнено. Теперь настроим группу и проверим отправку.
            </div>
            <div className="mt-2 text-[10px] text-zinc-500">
              Статус: {hasConnection ? 'OK' : 'ожидание подключения'}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-1 text-[11px] font-medium text-zinc-100">2. Groups</div>
            <div className="text-[10px] text-zinc-400">
              Создайте группу или вступите по QR в разделе `Groups`.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300"
                onClick={() => setTab('groups')}
              >
                OPEN GROUPS
              </Button>
              <span className="text-[10px] text-zinc-500">Профилей: {groupProfiles.length}</span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-1 text-[11px] font-medium text-zinc-100">3. Test Message</div>
            <div className="text-[10px] text-zinc-400">
              Откройте чат и отправьте тестовое сообщение, чтобы проверить канал.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300"
                onClick={() => setTab('chat')}
              >
                OPEN CHAT
              </Button>
              <span className="text-[10px] text-zinc-500">{hasTestMessage ? 'Сообщение отправлено' : 'Ожидание отправки'}</span>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          {step > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-zinc-400"
              onClick={goBack}
            >
              BACK
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {step < 2 ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300"
                onClick={goNext}
                disabled={!canContinue}
              >
                NEXT
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300"
                onClick={completeOnboarding}
                disabled={!canContinue}
              >
                FINISH
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-zinc-500 hover:text-zinc-200"
              onClick={completeOnboarding}
            >
              SKIP
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
