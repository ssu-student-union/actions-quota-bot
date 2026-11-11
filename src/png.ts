import { colorFor } from "./format.ts";

// 진행 막대 PNG. 임베드 이미지는 디스코드가 화면 폭에 맞춰 늘리고 줄이므로 데스크톱·모바일 모두 꽉 찬다.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type RGB = [number, number, number];
const TRACK: RGB = [0x4e, 0x50, 0x58];
const rgb = (hex: number): RGB => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
/** 임베드 띠 색(colorFor)과 같은 색 */
export const barColor = (p: number): RGB => rgb(colorFor(p));

export interface BarShape {
  width: number;
  height: number;
  /** 막대 둘레의 투명 여백(px). 모바일 디스코드가 이미지 모서리를 둥글게 잘라내서, 여백이 없으면 막대 끝이 뾰족해진다 */
  padX: number;
  padY: number;
}

export const DEFAULT_SHAPE: BarShape = { width: 1200, height: 44, padX: 20, padY: 8 };

/** 양 끝이 둥근 진행 막대. 가장자리는 안티앨리어싱 */
export async function barPng(p: number, shape: BarShape = DEFAULT_SHAPE): Promise<Uint8Array> {
  const { width, height, padX, padY } = shape;
  const fill = barColor(p);
  const barW = width - padX * 2;
  const barH = height - padY * 2;
  const fillTo = padX + (Math.max(0, Math.min(p, 100)) / 100) * barW;
  const r = barH / 2;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const cx = Math.min(Math.max(px, padX + r), width - padX - r);
      const alpha = Math.max(0, Math.min(1, r - Math.hypot(px - cx, py - (padY + r)) + 0.5));
      // 채움 경계도 1px 부드럽게
      const t = Math.max(0, Math.min(1, fillTo - x));
      const i = row + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(fill[k] * t + TRACK[k] * (1 - t));
      raw[i + 3] = Math.round(alpha * 255);
    }
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8bit RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
