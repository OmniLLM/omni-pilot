import struct, zlib

def make_png(size, bg=(26,26,46), fg=(120,120,255)):
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        crc = zlib.crc32(c[4:]) & 0xffffffff
        return c + struct.pack('>I', crc)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    cx, cy = size//2, size//2
    r = size * 0.42
    rows = []
    for y in range(size):
        row = b'\x00'
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy)**0.5
            if dist <= r and dist >= r * 0.85:
                row += bytes([fg[0], fg[1], fg[2]])
            elif dist <= r * 0.25:
                row += bytes([fg[0], fg[1], fg[2]])
            else:
                row += bytes([bg[0], bg[1], bg[2]])
        rows.append(row)
    raw = b''.join(rows)
    compressed = zlib.compress(raw)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

import os
os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    with open(f'icons/icon{size}.png', 'wb') as f:
        f.write(make_png(size))
    print(f"icons/icon{size}.png ok")
