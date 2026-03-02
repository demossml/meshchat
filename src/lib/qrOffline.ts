const QR_VERSION = 5
const QR_SIZE = 21 + (QR_VERSION - 1) * 4 // 37
const DATA_CODEWORDS = 108
const ECC_CODEWORDS = 26
const MAX_PAYLOAD_BYTES = 106

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

function initGalois() {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < GF_EXP.length; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
}

initGalois()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function polyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] ^= gfMul(a[i], b[j])
    }
  }
  return out
}

function rsGeneratorPoly(degree: number): number[] {
  let poly: number[] = [1]
  for (let i = 0; i < degree; i += 1) {
    poly = polyMul(poly, [1, GF_EXP[i]])
  }
  return poly
}

function rsRemainder(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGeneratorPoly(eccLen)
  const msg = new Uint8Array(data.length + eccLen)
  msg.set(data)

  for (let i = 0; i < data.length; i += 1) {
    const factor = msg[i]
    if (factor === 0) continue
    for (let j = 0; j < gen.length; j += 1) {
      msg[i + j] ^= gfMul(gen[j], factor)
    }
  }
  return msg.slice(data.length)
}

class BitBuffer {
  private bytes: number[] = []
  private bitLen = 0

  get lengthBits(): number {
    return this.bitLen
  }

  append(val: number, len: number): void {
    for (let i = len - 1; i >= 0; i -= 1) {
      this.appendBit(((val >>> i) & 1) === 1)
    }
  }

  appendByte(val: number): void {
    this.append(val, 8)
  }

  appendBit(bit: boolean): void {
    const idx = this.bitLen >>> 3
    if (this.bytes.length <= idx) this.bytes.push(0)
    if (bit) this.bytes[idx] |= 0x80 >>> (this.bitLen & 7)
    this.bitLen += 1
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

function makeDataCodewords(payload: string): Uint8Array {
  const data = new TextEncoder().encode(payload)
  if (data.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error('QR payload too long')
  }

  const buf = new BitBuffer()
  buf.append(0b0100, 4) // byte mode
  buf.append(data.byteLength, 8) // version 1..9 char count
  data.forEach(byte => buf.appendByte(byte))

  const dataCapacityBits = DATA_CODEWORDS * 8
  const terminatorLen = Math.min(4, dataCapacityBits - buf.lengthBits)
  buf.append(0, terminatorLen)
  while (buf.lengthBits % 8 !== 0) buf.appendBit(false)

  let padToggle = true
  while (buf.lengthBits < dataCapacityBits) {
    buf.appendByte(padToggle ? 0xec : 0x11)
    padToggle = !padToggle
  }

  const out = buf.toUint8Array()
  if (out.length !== DATA_CODEWORDS) throw new Error('Invalid data codeword length')
  return out
}

function createMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false))
}

function createFunctionMask(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false))
}

function setFunction(modules: boolean[][], fn: boolean[][], x: number, y: number, dark: boolean) {
  if (x < 0 || y < 0 || y >= modules.length || x >= modules.length) return
  modules[y][x] = dark
  fn[y][x] = true
}

function drawFinder(modules: boolean[][], fn: boolean[][], cx: number, cy: number) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      const dark = dist !== 2 && dist !== 4
      setFunction(modules, fn, cx + dx, cy + dy, dark)
    }
  }
}

function drawAlignment(modules: boolean[][], fn: boolean[][], cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      setFunction(modules, fn, cx + dx, cy + dy, dist !== 1)
    }
  }
}

function drawFormatBits(modules: boolean[][], fn: boolean[][], mask: number) {
  const eclBits = 1 // L
  const data = (eclBits << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537)
  }
  const bits = ((data << 10) | rem) ^ 0x5412
  const size = modules.length
  const bit = (i: number) => ((bits >>> i) & 1) === 1

  for (let i = 0; i <= 5; i += 1) setFunction(modules, fn, 8, i, bit(i))
  setFunction(modules, fn, 8, 7, bit(6))
  setFunction(modules, fn, 8, 8, bit(7))
  setFunction(modules, fn, 7, 8, bit(8))
  for (let i = 9; i < 15; i += 1) setFunction(modules, fn, 14 - i, 8, bit(i))

  for (let i = 0; i < 8; i += 1) setFunction(modules, fn, size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i += 1) setFunction(modules, fn, 8, size - 15 + i, bit(i))
  setFunction(modules, fn, 8, size - 8, true)
}

function drawFunctionPatterns(modules: boolean[][], fn: boolean[][]) {
  const size = modules.length
  drawFinder(modules, fn, 3, 3)
  drawFinder(modules, fn, size - 4, 3)
  drawFinder(modules, fn, 3, size - 4)

  for (let i = 8; i < size - 8; i += 1) {
    setFunction(modules, fn, i, 6, i % 2 === 0)
    setFunction(modules, fn, 6, i, i % 2 === 0)
  }

  // Version 5 alignment centers: [6, 30], only (30,30) is valid (others overlap finder)
  drawAlignment(modules, fn, 30, 30)
  setFunction(modules, fn, 8, 4 * QR_VERSION + 9, true) // dark module
  drawFormatBits(modules, fn, 0) // reserve format area
}

function placeData(modules: boolean[][], fn: boolean[][], codewords: Uint8Array) {
  const size = modules.length
  const totalBits = codewords.length * 8
  let bitIndex = 0

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert += 1) {
      const upward = ((right + 1) & 2) === 0
      const y = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        if (fn[y][x]) continue
        let dark = false
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >>> 3]
          dark = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1
        }
        modules[y][x] = dark
        bitIndex += 1
      }
    }
  }
}

function applyMask0(modules: boolean[][], fn: boolean[][]) {
  const size = modules.length
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (fn[y][x]) continue
      if ((x + y) % 2 === 0) modules[y][x] = !modules[y][x]
    }
  }
}

function encodeToMatrix(payload: string): boolean[][] {
  const data = makeDataCodewords(payload)
  const ecc = rsRemainder(data, ECC_CODEWORDS)
  const codewords = new Uint8Array(data.length + ecc.length)
  codewords.set(data, 0)
  codewords.set(ecc, data.length)

  const modules = createMatrix(QR_SIZE)
  const fn = createFunctionMask(QR_SIZE)
  drawFunctionPatterns(modules, fn)
  placeData(modules, fn, codewords)
  applyMask0(modules, fn)
  drawFormatBits(modules, fn, 0)
  return modules
}

export function drawOfflineQrToCanvas(canvas: HTMLCanvasElement, payload: string, size = 320): void {
  const matrix = encodeToMatrix(payload)
  const quiet = 4
  const moduleCount = matrix.length + quiet * 2
  const scale = Math.max(1, Math.floor(size / moduleCount))
  const px = moduleCount * scale

  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#000000'

  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix.length; x += 1) {
      if (!matrix[y][x]) continue
      ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale)
    }
  }
}
