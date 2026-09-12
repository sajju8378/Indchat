import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// CRC32 implementation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

function createPng(width, height, isMaskable = false) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const scanlineWidth = width * 4;
  const rawData = Buffer.alloc((scanlineWidth + 1) * height);

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = (width / 2) * (isMaskable ? 0.95 : 0.85);
  const rInner = rOuter * 0.55;

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Indigo brand background (#4F46E5 -> 79, 70, 229)
      let r = 79;
      let g = 70;
      let b = 229;
      let a = 255;

      if (!isMaskable && dist > rOuter) {
        r = 0;
        g = 0;
        b = 0;
        a = 0;
      } else {
        const insideShield =
          Math.abs(dx) < rInner * 0.7 &&
          dy > -rInner * 0.8 &&
          dy < rInner * 0.8 - Math.abs(dx) * 0.5;

        const insideLock =
          Math.abs(dx) < rInner * 0.35 &&
          Math.abs(dy) < rInner * 0.35;

        if (insideShield && !insideLock) {
          r = 255;
          g = 255;
          b = 255;
        } else if (insideLock) {
          r = 16;
          g = 185;
          b = 129;
        }
      }

      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate UI Screenshot PNG
function createScreenshotPng(width, height, isMobile = false) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const scanlineWidth = width * 4;
  const rawData = Buffer.alloc((scanlineWidth + 1) * height);

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0;
    for (let x = 0; x < width; x++) {
      // Default slate-900 canvas (#0F172A -> 15, 23, 42)
      let r = 15;
      let g = 23;
      let b = 42;
      let a = 255;

      // Header bar (#1E293B -> 30, 41, 59)
      const headerHeight = isMobile ? 120 : 64;
      if (y < headerHeight) {
        r = 30;
        g = 41;
        b = 59;

        // Accent brand badge on left
        if (x > 20 && x < (isMobile ? 100 : 60) && y > (isMobile ? 30 : 15) && y < headerHeight - (isMobile ? 30 : 15)) {
          r = 79;
          g = 70;
          b = 229;
        }
      } else if (!isMobile && x < 360) {
        // Desktop left sidebar (#1E293B -> 30, 41, 59)
        r = 24;
        g = 32;
        b = 47;
      } else {
        // Chat bubbles
        // Bubble 1: Incoming message (white/gray)
        const b1X = isMobile ? 40 : 420;
        const b1Y = isMobile ? 240 : 180;
        const b1W = isMobile ? 500 : 380;
        const b1H = isMobile ? 160 : 80;
        if (x >= b1X && x <= b1X + b1W && y >= b1Y && y <= b1Y + b1H) {
          r = 51;
          g = 65;
          b = 85;
        }

        // Bubble 2: Outgoing message (indigo #4F46E5)
        const b2W = isMobile ? 480 : 340;
        const b2X = width - b2W - (isMobile ? 40 : 60);
        const b2Y = isMobile ? 480 : 300;
        const b2H = isMobile ? 180 : 90;
        if (x >= b2X && x <= b2X + b2W && y >= b2Y && y <= b2Y + b2H) {
          r = 79;
          g = 70;
          b = 229;
        }
      }

      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const dirs = [
  path.resolve('public'),
  path.resolve('public', 'assets'),
  path.resolve('.'),
  path.resolve('dist'),
  path.resolve('dist', 'assets')
];

dirs.forEach((d) => {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
});

// Generate icon buffers
const icon192 = createPng(192, 192, false);
const icon512 = createPng(512, 512, false);
const iconMaskable = createPng(512, 512, true);
const appleIcon = createPng(180, 180, true);

// Generate screenshots
const screenshotDesktop = createScreenshotPng(1280, 720, false);
const screenshotMobile = createScreenshotPng(750, 1334, true);

// Write to all target folders
dirs.forEach((d) => {
  try {
    fs.writeFileSync(path.join(d, 'pwa-192x192.png'), icon192);
    fs.writeFileSync(path.join(d, 'pwa-512x512.png'), icon512);
    fs.writeFileSync(path.join(d, 'pwa-maskable-512x512.png'), iconMaskable);
    fs.writeFileSync(path.join(d, 'apple-touch-icon.png'), appleIcon);
    fs.writeFileSync(path.join(d, 'screenshot-desktop.png'), screenshotDesktop);
    fs.writeFileSync(path.join(d, 'screenshot-mobile.png'), screenshotMobile);
  } catch (e) {
    // directory might be transient
  }
});

console.log('Successfully generated PWA icons and screenshots across all public and assets directories.');
