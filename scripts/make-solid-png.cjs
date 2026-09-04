// One-off utility: writes a solid-color PNG with no dependencies, used as the
// source image for @capacitor/assets to generate a plain-navy native splash
// screen (no photo -- see GAME_DESIGN.md's splash vs. title-screen split).
// Usage: node scripts/make-solid-png.cjs <outFile> <width> <height> <hexColor>
const fs = require('fs');
const zlib = require('zlib');

const [, , outFile, widthArg, heightArg, hexColor] = process.argv;
const width = parseInt(widthArg, 10);
const height = parseInt(heightArg, 10);
const hex = hexColor.replace('#', '');
const r = parseInt(hex.slice(0, 2), 16);
const g = parseInt(hex.slice(2, 4), 16);
const b = parseInt(hex.slice(4, 6), 16);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(width, 0);
ihdrData.writeUInt32BE(height, 4);
ihdrData[8] = 8; // bit depth
ihdrData[9] = 2; // color type: RGB
ihdrData[10] = 0; // compression
ihdrData[11] = 0; // filter
ihdrData[12] = 0; // interlace
const ihdr = chunk('IHDR', ihdrData);

const rowBytes = 1 + width * 3; // filter-type byte + RGB per pixel
const raw = Buffer.alloc(rowBytes * height);
for (let y = 0; y < height; y++) {
  const rowStart = y * rowBytes;
  raw[rowStart] = 0; // filter type: None
  for (let x = 0; x < width; x++) {
    const px = rowStart + 1 + x * 3;
    raw[px] = r;
    raw[px + 1] = g;
    raw[px + 2] = b;
  }
}
const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
const iend = chunk('IEND', Buffer.alloc(0));

fs.writeFileSync(outFile, Buffer.concat([signature, ihdr, idat, iend]));
console.log(`Wrote ${outFile} (${width}x${height}, #${hex})`);
