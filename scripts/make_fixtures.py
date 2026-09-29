#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成端到端测试用的示例图片（scripts/fixtures/*.png）。

这些图只用于自动化测试：验证「自定义协议 + CSP + 照片墙」这条链路，
所以刻意做得很小（纯色 + 简单斜纹），几百字节级别，不污染仓库体积。
与 make_icon.py 一样只用标准库，不引入 Pillow。
"""

import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')

# (文件名, 宽, 高, 主色 RGB)
FIXTURES = [
    ('photo-1.png', 240, 180, (70, 130, 220)),
    ('photo-2.png', 180, 240, (90, 190, 120)),
    ('photo-3.png', 200, 200, (230, 160, 70)),
]


def chunk(tag, data):
    body = tag + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)


def make_png(width, height, base):
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0
        for x in range(width):
            # 斜纹：让图片有可见结构，方便肉眼确认加载的确实是这张图
            stripe = 26 if ((x + y) // 16) % 2 == 0 else 0
            r = min(255, base[0] + stripe)
            g = min(255, base[1] + stripe)
            b = min(255, base[2] + stripe)
            raw += bytes((r, g, b))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    return png


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, w, h, color in FIXTURES:
        path = os.path.join(OUT_DIR, name)
        with open(path, 'wb') as f:
            f.write(make_png(w, h, color))
        print(f'已生成 {path}（{os.path.getsize(path)} 字节）')


if __name__ == '__main__':
    main()
