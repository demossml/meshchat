import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import type { MeshNode } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type LngLatLike = [number, number]

type MapLibreMarker = {
  remove: () => void
  setLngLat: (lngLat: LngLatLike) => MapLibreMarker
  setPopup: (popup: MapLibrePopup) => MapLibreMarker
  addTo: (map: MapLibreMap) => MapLibreMarker
}

type MapLibrePopup = {
  setDOMContent: (el: HTMLElement) => MapLibrePopup
}

type MapLibreMap = {
  on: (event: 'load', cb: () => void) => void
  remove: () => void
  resize: () => void
  setCenter: (center: LngLatLike) => void
  setZoom: (zoom: number) => void
  fitBounds: (bounds: [LngLatLike, LngLatLike], opts?: { padding?: number; maxZoom?: number }) => void
  addSource: (id: string, src: unknown) => void
  getSource: (id: string) => { setData?: (data: unknown) => void } | undefined
  addLayer: (layer: unknown) => void
  removeLayer: (id: string) => void
  removeSource: (id: string) => void
  getLayer: (id: string) => unknown
  getCanvas: () => HTMLCanvasElement
}

type MapLibreCtor = {
  Map: new (opts: {
    container: HTMLElement
    style: string
    center: LngLatLike
    zoom: number
    attributionControl?: boolean
  }) => MapLibreMap
  Marker: new (opts?: { element?: HTMLElement }) => MapLibreMarker
  Popup: new (opts?: { closeButton?: boolean; offset?: number }) => MapLibrePopup
}

const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'
const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'
const MAP_STYLE = 'https://demotiles.maplibre.org/style.json'
const LINE_SOURCE = 'mesh-lines-src'
const LINE_LAYER = 'mesh-lines-layer'

let maplibreLoader: Promise<MapLibreCtor> | null = null

function loadMapLibre(): Promise<MapLibreCtor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window unavailable'))
  if ((window as Window & { maplibregl?: MapLibreCtor }).maplibregl) {
    return Promise.resolve((window as Window & { maplibregl?: MapLibreCtor }).maplibregl!)
  }
  if (maplibreLoader) return maplibreLoader

  maplibreLoader = new Promise<MapLibreCtor>((resolve, reject) => {
    const existingCss = document.querySelector(`link[data-maplibre-css="true"]`)
    if (!existingCss) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = MAPLIBRE_CSS
      link.dataset.maplibreCss = 'true'
      document.head.appendChild(link)
    }

    const existingScript = document.querySelector(`script[data-maplibre-js="true"]`) as HTMLScriptElement | null
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        const lib = (window as Window & { maplibregl?: MapLibreCtor }).maplibregl
        if (lib) resolve(lib)
        else reject(new Error('maplibre global missing'))
      }, { once: true })
      existingScript.addEventListener('error', () => reject(new Error('failed to load maplibre script')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = MAPLIBRE_JS
    script.async = true
    script.dataset.maplibreJs = 'true'
    script.onload = () => {
      const lib = (window as Window & { maplibregl?: MapLibreCtor }).maplibregl
      if (lib) resolve(lib)
      else reject(new Error('maplibre global missing'))
    }
    script.onerror = () => reject(new Error('failed to load maplibre script'))
    document.head.appendChild(script)
  })

  return maplibreLoader
}

function markerElement(color: string, ring = false): HTMLElement {
  const el = document.createElement('div')
  el.className = ring ? 'map-marker map-marker--ring' : 'map-marker'
  el.style.setProperty('--marker-color', color)
  return el
}

function popupContent(node: MeshNode, isMe: boolean, ageLabel: string, onDm?: () => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'map-popup'
  const status = node.isOnline ? 'online' : 'offline'
  wrap.innerHTML = `
    <div class="map-popup__title">${node.longName || node.id}</div>
    <div class="map-popup__meta">${node.id} · ${node.hwModel || '?'}</div>
    <div class="map-popup__grid">
      ${node.rssi !== undefined ? `<div class="map-popup__cell"><span>RSSI</span><b>${node.rssi} dBm</b></div>` : ''}
      ${node.snr !== undefined ? `<div class="map-popup__cell"><span>SNR</span><b>${node.snr} dB</b></div>` : ''}
      ${node.hopsAway !== undefined ? `<div class="map-popup__cell"><span>HOPS</span><b>${node.hopsAway}</b></div>` : ''}
      ${node.batteryLevel !== undefined ? `<div class="map-popup__cell"><span>BAT</span><b>${node.batteryLevel}%</b></div>` : ''}
      <div class="map-popup__cell"><span>SEEN</span><b>${ageLabel}</b></div>
      <div class="map-popup__cell"><span>STATUS</span><b>${status}</b></div>
    </div>
  `

  if (!isMe && onDm) {
    const btn = document.createElement('button')
    btn.className = 'map-popup__btn'
    btn.type = 'button'
    btn.textContent = 'Написать личное сообщение'
    btn.addEventListener('click', onDm)
    wrap.appendChild(btn)
  }
  return wrap
}

export function MapView() {
  const { nodes, myNodeId, mapCenter, setDmTarget, setTab } = useStore()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const libRef = useRef<MapLibreCtor | null>(null)
  const markersRef = useRef<MapLibreMarker[]>([])
  const loadedRef = useRef(false)
  const initialFitDoneRef = useRef(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const nodeList = useMemo(() => Object.values(nodes), [nodes])
  const located = useMemo(() => nodeList.filter(n => n.lat !== 0 || n.lon !== 0), [nodeList])
  const online = located.filter(n => n.isOnline)

  const lines = useMemo(() => {
    if (online.length < 2) return [] as number[][][]
    return online.slice(0, -1).map((n, i) => [[n.lon, n.lat], [online[i + 1].lon, online[i + 1].lat]])
  }, [online])

  useEffect(() => {
    let dead = false
    const el = containerRef.current
    if (!el) return

    void loadMapLibre().then((lib) => {
      if (dead || !containerRef.current) return
      setLoadFailed(false)
      libRef.current = lib
      const center: LngLatLike = mapCenter ? [mapCenter[1], mapCenter[0]] : [37.6173, 55.7558]

      const map = new lib.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center,
        zoom: 13,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('load', () => {
        loadedRef.current = true
        if (!map.getSource(LINE_SOURCE)) {
          map.addSource(LINE_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          })
        }
        if (!map.getLayer(LINE_LAYER)) {
          map.addLayer({
            id: LINE_LAYER,
            type: 'line',
            source: LINE_SOURCE,
            paint: {
              'line-color': '#fafafa',
              'line-opacity': 0.35,
              'line-width': 1.2,
              'line-dasharray': [3, 5],
            },
          })
        }
      })

      setTimeout(() => map.resize(), 0)
    }).catch(() => {
      if (!dead) setLoadFailed(true)
    })

    return () => {
      dead = true
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
      loadedRef.current = false
    }
  }, [mapCenter])

  useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!map || !lib || !loadedRef.current) return

    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    located.forEach(node => {
      const isMe = node.id === myNodeId
      const color = isMe ? '#ffffff' : node.isOnline ? '#f4f4f5' : '#52525b'
      const el = markerElement(color, isMe)
      const age = Math.round((Date.now() - node.lastHeard) / 60000)
      const ageLabel = age < 1 ? 'только что' : `${age} мин назад`
      const popupEl = popupContent(node, isMe, ageLabel, !isMe
        ? () => {
            setDmTarget(node)
            setTab('chat')
          }
        : undefined)
      const popup = new lib.Popup({ closeButton: false, offset: 14 }).setDOMContent(popupEl)
      const marker = new lib.Marker({ element: el })
        .setLngLat([node.lon, node.lat])
        .setPopup(popup)
        .addTo(map)
      markersRef.current.push(marker)
    })

    const source = map.getSource(LINE_SOURCE)
    if (source?.setData) {
      source.setData({
        type: 'FeatureCollection',
        features: lines.map(coords => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        })),
      })
    }

    if (located.length === 1) {
      map.setCenter([located[0].lon, located[0].lat])
      map.setZoom(14)
      initialFitDoneRef.current = true
      return
    }

    if (located.length > 1 && !initialFitDoneRef.current) {
      const lons = located.map(n => n.lon)
      const lats = located.map(n => n.lat)
      const bounds: [LngLatLike, LngLatLike] = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ]
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 })
      initialFitDoneRef.current = true
    }
  }, [lines, located, myNodeId, setDmTarget, setTab])

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute left-2 right-2 top-2 z-[1000] flex items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-900/90 px-2.5 py-1.5 backdrop-blur-md sm:left-auto sm:right-3 sm:top-3 sm:gap-3 sm:px-3.5 sm:py-2">
        <Stat v={online.length} l="ONLINE" />
        <div className="h-5 w-px bg-zinc-700 sm:h-6" />
        <Stat v={located.length} l="С GPS" />
        <div className="h-5 w-px bg-zinc-700 sm:h-6" />
        <Stat v={nodeList.length} l="ВСЕГО" />
      </div>

      {located.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[900] flex flex-col items-center justify-center gap-2 bg-black/45 text-center text-xs text-zinc-400">
          <div className="mb-2 text-[40px] text-zinc-700">◎</div>
          <p>Нет узлов с GPS координатами</p>
          <p className="max-w-[260px] text-[10px] text-zinc-600">Координаты придут из POSITION пакетов Meshtastic</p>
        </div>
      )}

      {loadFailed ? <MapUnavailableFallback /> : <div ref={containerRef} className="h-full w-full" />}
    </div>
  )
}

function Stat({ v, l }: { v: number; l: string }) {
  return (
    <div className="flex flex-col items-center gap-px">
      <span className="font-[var(--display)] text-base font-bold leading-none text-zinc-100 sm:text-lg">{v}</span>
      <span className="text-[7px] tracking-[0.15em] text-zinc-500 sm:text-[8px]">{l}</span>
    </div>
  )
}

export function MapUnavailableFallback() {
  return (
    <div className="grid h-full place-items-center text-xs text-zinc-500">
      <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2">
        Карта недоступна: не удалось загрузить MapLibre CDN
      </div>
    </div>
  )
}
