import type { MeshNode, ChatMessage } from './types'

export const DEMO_NODES: MeshNode[] = [
  { num: 0xabcd1234, id: '!abcd1234', longName: 'Base-Station',  shortName: 'BS',  hwModel: 'HELTEC_V3', role: 'ROUTER',        lat: 55.7558, lon: 37.6173, alt: 145, lastHeard: Date.now(),            isOnline: true,  rssi: -60,  snr: 11.0, hopsAway: 0, batteryLevel: 100 },
  { num: 0x11223344, id: '!11223344', longName: 'Field-Alpha',    shortName: 'FA',  hwModel: 'HELTEC_V3', role: 'CLIENT',        lat: 55.7620, lon: 37.6280, alt: 152, lastHeard: Date.now(),            isOnline: true,  rssi: -82,  snr: 7.5,  hopsAway: 1, batteryLevel: 54  },
  { num: 0x55667788, id: '!55667788', longName: 'Field-Bravo',    shortName: 'FB',  hwModel: 'TBEAM',     role: 'CLIENT',        lat: 55.7490, lon: 37.6050, alt: 138, lastHeard: Date.now(),            isOnline: true,  rssi: -91,  snr: 5.0,  hopsAway: 2, batteryLevel: 23  },
  { num: 0x99aabbcc, id: '!99aabbcc', longName: 'Relay-Roof',     shortName: 'RR',  hwModel: 'HELTEC_V3', role: 'REPEATER',      lat: 55.7535, lon: 37.6140, alt: 187, lastHeard: Date.now() - 3600000, isOnline: false, rssi: -104, snr: 3.2,  hopsAway: 3, batteryLevel: 67  },
  { num: 0xdeadbeef, id: '!deadbeef', longName: 'Mobile-Unit-1',  shortName: 'M1',  hwModel: 'RAK4631',   role: 'CLIENT_MUTE',   lat: 55.7600, lon: 37.6100, alt: 140, lastHeard: Date.now() - 180000,  isOnline: true,  rssi: -88,  snr: 6.0,  hopsAway: 1 },
]

export const DEMO_MESSAGES: ChatMessage[] = [
  { id: 'dm1', from: 0x11223344, fromId: '!11223344', fromName: 'Field-Alpha',  to: 0xffffffff, channel: 'LongFast',   text: 'Вышел на позицию, сигнал хороший. rssi -82',          ts: Date.now() - 900000, rssi: -82, snr: 7.5, hops: 1 },
  { id: 'dm2', from: 0x55667788, fromId: '!55667788', fromName: 'Field-Bravo',  to: 0xffffffff, channel: 'LongFast',   text: 'Принял. Двигаюсь к точке B, батарея 23%',             ts: Date.now() - 720000, rssi: -91, snr: 5.0, hops: 2 },
  { id: 'dm3', from: 0xabcd1234, fromId: '!abcd1234', fromName: 'Base-Station', to: 0xffffffff, channel: 'LongFast',   text: 'Понял всех. Доклад через 30 минут',                   ts: Date.now() - 600000, isOwn: true },
  { id: 'dm4', from: 0xdeadbeef, fromId: '!deadbeef', fromName: 'Mobile-Unit-1',to: 0xffffffff, channel: 'LongFast',   text: 'Здесь Mobile-1, вижу периметр',                       ts: Date.now() - 300000, rssi: -88, snr: 6.0, hops: 1 },
  { id: 'dm5', from: 0x11223344, fromId: '!11223344', fromName: 'Field-Alpha',  to: 0xffffffff, channel: 'LongFast',   text: 'Задача на секторе A выполнена',                        ts: Date.now() - 120000, rssi: -82, snr: 7.5, hops: 1 },
  { id: 'dm6', from: 0x55667788, fromId: '!55667788', fromName: 'Field-Bravo',  to: 0xffffffff, channel: 'MediumSlow', text: 'Телеметрия: температура +21°C, влажность 67%',         ts: Date.now() -  60000, rssi: -91, snr: 5.0, hops: 2 },
  { id: 'dm7', from: 0x11223344, fromId: '!11223344', fromName: 'Field-Alpha',  to: 0xffffffff, channel: 'ShortFast',  text: '⚡ ВНИМАНИЕ! Требуется поддержка на севере!',           ts: Date.now() -  15000, rssi: -82, snr: 7.5, hops: 1 },
]
