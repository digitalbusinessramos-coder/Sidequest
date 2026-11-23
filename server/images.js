// Removes hidden details from uploaded pictures before they are stored: camera model, date and above all the GPS
// position that phones write into photos (EXIF), plus XMP/IPTC blocks and comments. The picture itself is unchanged.
// Returns null when the file is not a well-formed JPEG, PNG or WebP, so it can be rejected.

const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]); // APP1 (EXIF, XMP), APP13 (IPTC/Photoshop), COM (comments)

function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff) { i++; marker = buf[i + 1]; } // fill bytes
    if (marker === undefined) return null;
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); return Buffer.concat(out); }
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // image data runs to the end
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (!JPEG_DROP.has(marker)) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = [PNG_SIG];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) return null;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return null;
}

function stripWebp(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunks = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) return null;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const c = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (type === 'VP8X' && c.length > 8) c[8] &= ~0x0c; // the "has EXIF" and "has XMP" flags
      chunks.push(c);
    }
    i = end;
  }
  if (!chunks.length) return null;
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

export function stripImageMetadata(buf, mime) {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buf);
    if (mime === 'image/png') return stripPng(buf);
    if (mime === 'image/webp') return stripWebp(buf);
  } catch { /* malformed */ }
  return null;
}
