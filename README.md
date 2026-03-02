# MeshChat — Meshtastic Web Client

MeshChat — это PWA-клиент для Meshtastic-сети с поддержкой:
- подключения по WiFi и Bluetooth из браузера;
- чата по каналам и личных сообщений (DM);
- карты узлов и телеметрии;
- дополнительного прикладного шифрования (shared-key E2E и Noise DM);
- групповых профилей и QR-приглашений.

Проект ориентирован на запуск на телефоне как веб-приложение (PWA) и не требует внешнего интернета для обмена сообщениями в LoRa-сети.

## Как это работает

```text
Телефон/браузер ── WiFi/BLE ──> Meshtastic устройство ── LoRa ──> Другие узлы
```

- В браузере работает React-клиент.
- Для WiFi используется WebSocket к Meshtastic.
- Для Bluetooth используется `@meshtastic/core` + `@meshtastic/transport-web-bluetooth`.
- UI получает пакеты (`text`, `nodeinfo`, `position`, `telemetry`) и обновляет Zustand-store.

## Ключевые возможности

- Современный UI на базе shadcn/ui компонентов (Radix + Tailwind).
- Режимы подключения:
  - `WiFi`: по IP/порту/пути;
  - `Bluetooth`: через Web Bluetooth API.
- Каналы и DM.
- Статусы исходящих сообщений: `queued` / `sent` / `ack` / `delivered` / `read` / `failed`.
- Длинные сообщения автоматически фрагментируются и собираются на приёме.
- Статусы узлов (online/offline), RSSI/SNR/hops, батарея, GPS.
- Карта узлов (MapLibre GL) + автофит по координатам.
- PWA-режим с кэшированием ассетов и тайлов OSM.
- Дополнительные уровни шифрования:
  - shared-key E2E (`mc1:*`, AES-GCM + PBKDF2);
  - Noise DM (`nx1:*`, handshake XX для личных сообщений).
- QR-верификация fingerprint/ключей (офлайн-генерация QR в canvas).
- Group Wizard: создание/применение/дублирование профилей групп.

## Технологический стек

| Слой | Технологии |
|------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS, shadcn/ui, Radix UI |
| State | Zustand + Immer |
| Meshtastic | `@meshtastic/core`, `@meshtastic/transport-web-bluetooth` |
| Карта | MapLibre GL (CDN runtime) |
| PWA | vite-plugin-pwa + Workbox |
| API/Edge | Hono (Cloudflare Pages Functions) |
| Deploy | Cloudflare Pages + Wrangler |

## Требования

- Node.js 18+ (рекомендуется LTS).
- npm 9+.
- Для Bluetooth: браузер с поддержкой Web Bluetooth (чаще всего Chrome/Edge на Android/desktop).
- Для iOS: запуск через Safari (Bluetooth-ограничения зависят от версии iOS/WebKit).

## Быстрый старт

```bash
# 1) Установка зависимостей
npm install

# 2) Запуск фронтенда в dev-режиме
npm run dev
# http://localhost:3000

# 3) Сборка production
npm run build

# 4) Локальный просмотр production-сборки
npm run preview
```

## Скрипты

| Команда | Назначение |
|---------|------------|
| `npm run dev` | Локальная разработка Vite |
| `npm run build` | TypeScript build + Vite build |
| `npm run preview` | Локальный preview собранного приложения |
| `npm run deploy` | Сборка и деплой в Cloudflare Pages |
| `npm run wrangler:dev` | Локальный запуск Pages окружения для `dist` |

## Подключение к устройству

### WiFi

1. На устройстве Meshtastic включите WiFi и web server.
2. Убедитесь, что телефон подключен к той же сети.
3. В MeshChat выберите `WiFi`, укажите host/port/path (`/ws` по умолчанию).
4. Нажмите «Подключиться».

### Bluetooth

1. Включите BLE на телефоне и Meshtastic-узле.
2. В MeshChat выберите `Bluetooth`.
3. Нажмите «Подключиться» и выберите устройство в системном диалоге.

## Безопасность и шифрование

Meshtastic уже имеет собственное шифрование каналов. В MeshChat поверх него добавлены опциональные режимы.

### 1) Shared-key E2E (для каналов и DM)

- Формат: `mc1:*`
- Алгоритм: AES-GCM (Web Crypto API)
- KDF: PBKDF2-SHA256
- Сценарий: у всех участников один общий пароль.

Особенности:
- просто включается в UI;
- подходит для групповых каналов;
- ограничение длины полезного текста из-за оверхеда.

### 2) Noise DM (только для личных сообщений)

- Формат кадров: `nx1:m1/m2/m3`, `nx1:d`
- Handshake: Noise XX
- После handshake: AES-GCM с раздельными ключами направления.

Особенности:
- только DM (не broadcast/каналы);
- лучше использовать короткие сообщения;
- в UI режим Noise DM взаимоисключается с shared-key E2E.

#### Как работает Noise DM по шагам

1. Пользователь открывает DM и включает `NOISE DM` в чате.
2. При первой отправке сообщения инициатор отправляет handshake-кадр `nx1:m1`.
3. Получатель отвечает `nx1:m2`, инициатор завершает `nx1:m3`.
4. После этого обе стороны получают сессионные ключи и начинают обмен `nx1:d`.
5. `nx1:*` кадры не отображаются в чате как текст, в UI показывается уже расшифрованное сообщение.

Технически:
- handshake и сессии управляются в `src/lib/noiseDm.ts`;
- интеграция в транспорт сделана в `src/hooks/useWebSocket.ts`;
- если сессия еще не готова, первое сообщение ставится в очередь и отправляется после завершения handshake.

#### Как настроить Noise DM

1. Обновите MeshChat на обеих сторонах до одной версии.
2. Подключитесь к Meshtastic (WiFi или Bluetooth).
3. Откройте личный диалог (DM) с нужным узлом.
4. Включите переключатель `NOISE DM`.
5. Отправьте короткое тестовое сообщение.
6. Убедитесь, что у собеседника сообщение отображается без `NOISE ERR`.

Важно:
- `NOISE DM` работает только в DM, не в каналах;
- при включенном `NOISE DM` shared-key E2E выключается автоматически;
- слишком длинные сообщения могут не пройти из-за лимита payload, лучше держать текст коротким.

## Архитектура сообщений

- Исходящие:
  - ввод в `ChatView`;
  - опционально: шифрование (`mc1`) или Noise DM frame (`nx1`);
  - для длинных payload: фрагментация в `mcf1:*` кадры;
  - отправка через `sendText`.
- Входящие:
  - прием в `useWebSocket`;
  - если `mcr1:*` -> апдейт delivery/read статуса;
  - если `mcf1:*` -> сборка фрагментов в исходный текст;
  - если `nx1:*` -> обработка Noise manager;
  - если `mc1:*` -> попытка shared-key decrypt;
  - адаптация к `onPacket` и запись в store.

### Статусы доставки сообщений

Для исходящих сообщений в UI используются статусы:
- `queued`: сообщение создано в optimistic UI и ожидает отправку;
- `sent`: транспорт принял сообщение на отправку;
- `ack`: клиент получил эхо собственного сообщения от Meshtastic и связал его с исходящим;
- `delivered`: получатель подтвердил доставку (`mcr1:delivered`);
- `read`: получатель открыл DM и отправил `mcr1:read`;
- `failed`: отправка не удалась (например, закрыт сокет или ошибка транспорта).

## Группы и QR

### Group Wizard

1. В чате откройте блок `E2E`.
2. Нажмите `GROUP WIZARD`.
3. Заполните:
   - название группы;
   - канал;
   - общий E2EE ключ.
4. Нажмите `APPLY`.

После этого профиль группы сохраняется в `МОИ ГРУППЫ`, где доступны:
- `APPLY` — быстро применить профиль;
- `EDIT` — изменить имя/канал/ключ;
- `DUP` — создать копию;
- `QR` — показать QR-приглашение;
- `DEL` — удалить профиль.

### QR-приглашения группы

- `SHOW INVITE QR` — показать QR для передачи участнику.
- `SCAN INVITE QR` — сканировать QR и автоматически вступить в группу (канал + ключ применяются сразу).

### QR-верификация

- `NOISE`:
  - `SHOW QR`/`SCAN QR` в блоке `NOISE FINGERPRINT` для подтверждения DM fingerprint.
- `E2EE`:
  - `SHOW QR`/`SCAN QR` в блоке E2E для сверки fingerprint ключа.

QR-коды генерируются локально (офлайн), без внешнего QR-сервиса.

## UI и дизайн

Проект использует shadcn/ui-компоненты:
- `Button`, `Input`, `Textarea`, `Card`, `Badge`, `Tabs`, `Switch`, `Separator`.

Это обеспечивает:
- единый современный стиль;
- предсказуемое поведение компонентов;
- удобное расширение через variants.

## Структура проекта

```text
meshchat/
├── src/
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── textarea.tsx
│   │   ├── ConnectScreen.tsx
│   │   ├── Layout.tsx
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ChatView.tsx
│   │   ├── MapView.tsx
│   │   ├── NodesView.tsx
│   │   └── QrVerifyModal.tsx
│   ├── hooks/
│   │   └── useWebSocket.ts
│   ├── store/
│   │   └── index.ts
│   ├── lib/
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   ├── crypto.ts           # shared-key E2E
│   │   ├── noiseDm.ts          # Noise XX для DM
│   │   ├── verifyQr.ts         # QR payload fingerprint/key
│   │   ├── groupInvite.ts      # QR payload group invite
│   │   ├── qrOffline.ts        # офлайн генерация QR в canvas
│   │   └── demo.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── functions/
│   └── api/[[route]].ts
├── public/
│   ├── _headers
│   └── _redirects
├── .github/workflows/
│   └── deploy.yml
├── vite.config.ts
├── wrangler.toml
├── tailwind.config.cjs
├── postcss.config.cjs
└── package.json
```

## PWA и офлайн

Service Worker кэширует:
- JS/CSS/HTML и иконки;
- OSM/Map style assets;
- web-шрифты.

Приложение остается открываемым офлайн, но без подключения к Meshtastic устройству отправка/получение сообщений недоступны.

## Деплой в Cloudflare Pages

### Вручную

```bash
npm install -g wrangler
wrangler login
wrangler pages project create meshchat
npm run deploy
```

### GitHub Actions

В `Settings -> Secrets` добавьте:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Workflow: `.github/workflows/deploy.yml`.

## Troubleshooting

### `npm ERR! ETARGET @meshtastic/transport-web-bluetooth`

Используйте существующую версию пакета (`^0.1.5`), а не `2.x`.

### Bluetooth не работает в браузере

- Проверьте, что браузер поддерживает Web Bluetooth.
- Проверьте, что сайт открыт по `https` (или `localhost` в dev).
- На iOS возможности BLE в браузере ограничены версией системы/браузера.

### В чате «Зашифровано (ключ не подходит)»

- На обеих сторонах должен быть одинаковый shared-key E2E пароль.
- Убедитесь, что не включен взаимоисключающий режим Noise DM.

### Noise DM ошибки (`NOISE ERR`)

- Используйте DM, не канал.
- Отправляйте короткие сообщения (около 120 символов и меньше).
- Повторите handshake (выключить/включить Noise DM, отправить снова).

### QR скан не открывает камеру

- В некоторых браузерах нет `BarcodeDetector`.
- В этом случае используйте fallback: вставьте QR-строку вручную в модалке `SCAN`.

## Лицензия

MIT
