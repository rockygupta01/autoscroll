#!/usr/bin/env python3
"""
Generate simple PNG icons for the Contact Extractor Chrome Extension.
Creates 16x16, 48x48, and 128x128 pixel icons with a gradient contact icon.
Uses only the Python standard library (no PIL needed) — generates valid PNG from scratch.
"""

import struct
import zlib
import os

def create_png(width, height, pixels):
    """
    Creates a PNG file from raw RGBA pixel data.
    pixels: list of rows, each row is list of (R, G, B, A) tuples
    """
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + c + crc

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT
    raw_data = b''
    for row in pixels:
        raw_data += b'\x00'  # filter: None
        for r, g, b, a in row:
            raw_data += struct.pack('BBBB', r, g, b, a)

    compressed = zlib.compress(raw_data)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    return signature + ihdr + idat + iend


def lerp(a, b, t):
    """Linear interpolation"""
    return int(a + (b - a) * t)


def generate_icon(size):
    """
    Generates a contact-extractor themed icon at the given size.
    Features a rounded square with a gradient background and a contact/person silhouette.
    """
    pixels = []
    center = size / 2
    radius = size * 0.42  # rounded square radius
    corner_r = size * 0.2  # corner roundness

    # Gradient colors: cyan (#00d4ff) to purple (#7c3aed)
    cyan = (0, 212, 255)
    purple = (124, 58, 237)

    for y in range(size):
        row = []
        for x in range(size):
            # Check if inside rounded square
            dx = abs(x - center + 0.5)
            dy = abs(y - center + 0.5)

            inside = False
            # Inside the main body
            if dx <= radius and dy <= radius:
                # Check corners
                if dx > radius - corner_r and dy > radius - corner_r:
                    # Corner region — check circle
                    cx = dx - (radius - corner_r)
                    cy = dy - (radius - corner_r)
                    if cx * cx + cy * cy <= corner_r * corner_r:
                        inside = True
                else:
                    inside = True

            if inside:
                # Gradient based on diagonal position
                t = ((x + y) / (2 * size))
                r = lerp(cyan[0], purple[0], t)
                g = lerp(cyan[1], purple[1], t)
                b = lerp(cyan[2], purple[2], t)

                # Draw a simple person icon (head circle + body arc)
                # Head
                head_cx = center
                head_cy = center - size * 0.12
                head_r = size * 0.12

                hx = x - head_cx + 0.5
                hy = y - head_cy + 0.5
                in_head = (hx * hx + hy * hy) <= head_r * head_r

                # Body (arc)
                body_cx = center
                body_cy = center + size * 0.22
                body_rx = size * 0.22
                body_ry = size * 0.18

                bx = x - body_cx + 0.5
                by = y - body_cy + 0.5
                in_body = ((bx * bx) / (body_rx * body_rx) + (by * by) / (body_ry * body_ry)) <= 1.0 and y > center + size * 0.05

                # @ symbol indicator — small dot at bottom right
                at_cx = center + size * 0.2
                at_cy = center + size * 0.2
                at_r = size * 0.06
                ax = x - at_cx + 0.5
                ay = y - at_cy + 0.5
                in_at = (ax * ax + ay * ay) <= at_r * at_r

                if in_head or in_body:
                    # White silhouette
                    row.append((255, 255, 255, 230))
                elif in_at:
                    row.append((255, 255, 255, 200))
                else:
                    row.append((r, g, b, 255))
            else:
                row.append((0, 0, 0, 0))  # transparent

        pixels.append(row)

    return create_png(size, size, pixels)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        png_data = generate_icon(size)
        filepath = os.path.join(icons_dir, f'icon-{size}.png')
        with open(filepath, 'wb') as f:
            f.write(png_data)
        print(f'Created {filepath} ({len(png_data)} bytes)')


if __name__ == '__main__':
    main()
