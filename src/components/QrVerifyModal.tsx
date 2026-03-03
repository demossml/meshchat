import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { drawOfflineQrToCanvas } from '@/lib/qrOffline'
import jsQR from 'jsqr'

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
}

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const anyWindow = window as Window & { BarcodeDetector?: BarcodeDetectorCtor }
  return anyWindow.BarcodeDetector ?? null
}

export function QrVerifyModal({
  open,
  mode,
  title,
  payload,
  helper,
  onClose,
  onScan,
}: {
  open: boolean
  mode: 'show' | 'scan'
  title: string
  payload?: string
  helper?: string
  onClose: () => void
  onScan?: (raw: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const [manual, setManual] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [showError, setShowError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [decodingImage, setDecodingImage] = useState(false)

  const hasPayload = useMemo(() => Boolean(payload && payload.trim()), [payload])

  useEffect(() => {
    if (!open || mode !== 'show') return
    if (!payload || !qrCanvasRef.current) return
    try {
      drawOfflineQrToCanvas(qrCanvasRef.current, payload, 320)
      setShowError(null)
    } catch {
      setShowError('QR слишком длинный для офлайн-генерации. Укоротите название/ключ или используйте COPY.')
    }
  }, [mode, open, payload])

  useEffect(() => {
    if (!open || mode !== 'scan') return
    const detectorCtor = getBarcodeDetectorCtor()
    const detector = detectorCtor ? new detectorCtor({ formats: ['qr_code'] }) : null
    detectorRef.current = detector
    let cancelled = false

    const stop = () => {
      if (loopRef.current !== null) {
        cancelAnimationFrame(loopRef.current)
        loopRef.current = null
      }
      const stream = streamRef.current
      streamRef.current = null
      if (stream) stream.getTracks().forEach(track => track.stop())
    }

    const tick = async () => {
      if (cancelled) return
      const detectorCurrent = detectorRef.current
      const video = videoRef.current
      if (!video) return
      if (video.readyState < 2) {
        loopRef.current = requestAnimationFrame(tick)
        return
      }
      const width = video.videoWidth
      const height = video.videoHeight
      if (!width || !height) {
        loopRef.current = requestAnimationFrame(tick)
        return
      }
      try {
        if (detectorCurrent) {
          const results = await detectorCurrent.detect(video)
          const first = results.find(item => typeof item.rawValue === 'string' && item.rawValue.trim())
          if (first?.rawValue) {
            onScan?.(first.rawValue)
            return
          }
        }

        // Fallback decoder for browsers without/with unstable BarcodeDetector.
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height)
          const img = ctx.getImageData(0, 0, width, height)
          const decoded = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
          if (decoded?.data?.trim()) {
            onScan?.(decoded.data.trim())
            return
          }
        }
      } catch {
        // ignore frame-level decode errors
      }
      loopRef.current = requestAnimationFrame(tick)
    }

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setScanError(null)
        loopRef.current = requestAnimationFrame(tick)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error'
        const detectorMissingNote = detectorCtor
          ? ''
          : ' В этом браузере нет BarcodeDetector, используется jsQR fallback.'
        setScanError(`Не удалось открыть камеру: ${message}.${detectorMissingNote}`)
      }
    })()

    return () => {
      cancelled = true
      stop()
      detectorRef.current = null
    }
  }, [mode, onScan, open])

  if (!open) return null

  const decodeImageFile = async (file: File) => {
    if (!file) return
    setDecodingImage(true)
    setScanError(null)
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('canvas context unavailable')
      ctx.drawImage(bitmap, 0, 0)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const decoded = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
      if (decoded?.data?.trim()) {
        onScan?.(decoded.data.trim())
        return
      }
      if (detectorRef.current) {
        const results = await detectorRef.current.detect(canvas)
        const first = results.find(item => typeof item.rawValue === 'string' && item.rawValue.trim())
        if (first?.rawValue) {
          onScan?.(first.rawValue)
          return
        }
      }
      setScanError('QR не найден в изображении. Попробуйте другой ракурс/контраст.')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      setScanError(`Не удалось распознать изображение: ${message}`)
    } finally {
      setDecodingImage(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/75 p-3 backdrop-blur-[1px] sm:items-center">
      <div className="w-full max-w-[420px] rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs tracking-[0.08em] text-zinc-300">{title}</div>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-400" onClick={onClose}>✕</Button>
        </div>

        {mode === 'show' && payload && (
          <>
            <div className="mb-2 grid place-items-center rounded-md border border-zinc-800 bg-zinc-900 p-2">
              {hasPayload && (
                <canvas
                  ref={qrCanvasRef}
                  className="h-[220px] w-[220px] rounded-sm border border-zinc-800 bg-white p-1"
                />
              )}
            </div>
            <div className="mb-2 text-[10px] text-zinc-500">
              {helper ?? 'Попросите собеседника отсканировать этот QR и подтвердить совпадение.'}
            </div>
            {showError && (
              <div className="mb-2 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200">
                {showError}
              </div>
            )}
            <Textarea
              readOnly
              value={payload}
              className="min-h-[70px] font-mono text-[10px] leading-relaxed"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(payload)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1200)
                  } catch {
                    // ignore
                  }
                }}
              >
                {copied ? 'COPIED' : 'COPY'}
              </Button>
            </div>
          </>
        )}

        {mode === 'scan' && (
          <>
            <div className="mb-2 overflow-hidden rounded-md border border-zinc-800 bg-black">
              <video ref={videoRef} className="h-[220px] w-full object-cover" playsInline muted />
            </div>
            {scanError && <div className="mb-2 text-[10px] text-zinc-400">{scanError}</div>}
            <div className="mb-2 flex items-center gap-2">
              <label className="inline-flex h-7 cursor-pointer items-center rounded border border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300">
                {decodingImage ? 'DECODING…' : 'SCAN FROM IMAGE'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void decodeImageFile(file)
                    e.currentTarget.value = ''
                  }}
                />
              </label>
              <span className="text-[9px] text-zinc-500">Оффлайн fallback для iPhone/Android</span>
            </div>
            <div className="mb-1 text-[10px] tracking-[0.06em] text-zinc-500">ИЛИ ВСТАВЬТЕ QR СТРОКУ</div>
            <Textarea
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="meshchat-verify-v1|..."
              className="min-h-[72px] font-mono text-[10px]"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-300"
                onClick={() => {
                  const trimmed = manual.trim()
                  if (!trimmed) return
                  onScan?.(trimmed)
                }}
              >
                VERIFY
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
