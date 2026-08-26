from pathlib import Path
from collections import deque
import argparse

import numpy as np
from PIL import Image, ImageDraw


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "design-assets" / "kpetro-corporate-symbol-original.jpg"
OUTPUT = PROJECT_ROOT / "mock-site" / "assets" / "kpetro-ci.png"
ICON_OUTPUT = PROJECT_ROOT / "mock-site" / "assets" / "kpetro-app-icon.png"
FAVICON_OUTPUT = PROJECT_ROOT / "mock-site" / "favicon.ico"


def create_app_icon(logo: Image.Image, icon_output: Path, favicon_output: Path) -> None:
    alpha = np.asarray(logo.getchannel("A")) > 8
    populated_columns = alpha.any(axis=0)
    runs = []
    column = 0
    while column < len(populated_columns):
        if not populated_columns[column]:
            column += 1
            continue
        start = column
        while column < len(populated_columns) and populated_columns[column]:
            column += 1
        runs.append((start, column))
    if len(runs) < 2:
        raise RuntimeError("Could not isolate the KPetro symbol")

    symbol = logo.crop((runs[0][0], 0, runs[0][1], logo.height))
    symbol = symbol.crop(symbol.getbbox())
    symbol.thumbnail((408, 365), Image.Resampling.LANCZOS)

    icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    draw.rounded_rectangle((8, 8, 504, 504), radius=104, fill=(10, 13, 16, 255), outline=(35, 41, 46, 255), width=4)
    position = ((512 - symbol.width) // 2, (512 - symbol.height) // 2)
    icon.alpha_composite(symbol, position)

    icon_output.parent.mkdir(parents=True, exist_ok=True)
    icon.save(icon_output, format="PNG", optimize=True)
    icon.save(favicon_output, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"icon={icon_output}")
    print(f"favicon={favicon_output}")


def extract_logo(source: Path, output: Path, icon_output: Path, favicon_output: Path) -> None:
    source_image = Image.open(source).convert("RGB")
    rgb = np.asarray(source_image, dtype=np.float32)

    # The supplied CI is a JPEG flattened on white. Pixels sufficiently far from
    # white are retained exactly; only the 1-2 px antialiased edge is reconstructed.
    distance_from_white = np.max(255.0 - rgb, axis=2)
    core = distance_from_white >= 36.0
    edge = (distance_from_white > 2.0) & ~core

    alpha = np.zeros(distance_from_white.shape, dtype=np.float32)
    alpha[core] = 1.0
    clean_rgb = rgb.copy()

    edge_y, edge_x = np.nonzero(edge)
    height, width = distance_from_white.shape
    for y, x in zip(edge_y, edge_x):
        best = None
        best_distance = None
        for radius in range(1, 7):
            y0, y1 = max(0, y - radius), min(height, y + radius + 1)
            x0, x1 = max(0, x - radius), min(width, x + radius + 1)
            candidates = np.argwhere(core[y0:y1, x0:x1])
            if not candidates.size:
                continue
            candidates[:, 0] += y0
            candidates[:, 1] += x0
            squared = (candidates[:, 0] - y) ** 2 + (candidates[:, 1] - x) ** 2
            nearest = int(np.argmin(squared))
            best = candidates[nearest]
            best_distance = squared[nearest]
            if best_distance <= radius * radius:
                break

        if best is None:
            continue

        foreground = rgb[best[0], best[1]]
        observed_delta = 255.0 - rgb[y, x]
        foreground_delta = 255.0 - foreground
        denominator = float(np.dot(foreground_delta, foreground_delta))
        if denominator <= 0.0:
            continue
        coverage = float(np.clip(np.dot(observed_delta, foreground_delta) / denominator, 0.0, 1.0))
        if coverage < 0.015:
            continue
        alpha[y, x] = coverage
        clean_rgb[y, x] = foreground

    visible = alpha > 0.01
    # JPEG ringing can leave a handful of colored dust pixels around the mark.
    # Drop only tiny disconnected islands; every real CI element is much larger.
    visited = np.zeros(visible.shape, dtype=bool)
    for start_y, start_x in zip(*np.nonzero(visible)):
        if visited[start_y, start_x]:
            continue
        queue = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        component = []
        while queue:
            current_y, current_x = queue.popleft()
            component.append((current_y, current_x))
            for neighbor_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                for neighbor_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                    if visible[neighbor_y, neighbor_x] and not visited[neighbor_y, neighbor_x]:
                        visited[neighbor_y, neighbor_x] = True
                        queue.append((neighbor_y, neighbor_x))
        if len(component) < 120:
            component_y, component_x = zip(*component)
            alpha[np.asarray(component_y), np.asarray(component_x)] = 0.0

    visible = alpha > 0.01
    ys, xs = np.nonzero(visible)
    if not len(xs):
        raise RuntimeError("No logo pixels were detected")

    padding = 28
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    render_rgb = np.clip(clean_rgb, 0, 255).astype(np.uint8)
    channel_range = render_rgb.max(axis=2).astype(np.int16) - render_rgb.min(axis=2).astype(np.int16)
    gray_ci = visible & (channel_range <= 24)
    render_rgb[gray_ci] = np.array([194, 196, 198], dtype=np.uint8)
    rgba = np.dstack((render_rgb, np.round(alpha * 255).astype(np.uint8)))
    cropped = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")

    canvas = Image.new("RGBA", (cropped.width + padding * 2, cropped.height + padding * 2), (0, 0, 0, 0))
    canvas.alpha_composite(cropped, (padding, padding))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="PNG", optimize=True)
    create_app_icon(canvas, icon_output, favicon_output)
    print(f"saved={output}")
    print(f"source={source_image.width}x{source_image.height}")
    print(f"output={canvas.width}x{canvas.height}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KPetro CI 웹 자산 생성")
    parser.add_argument("--source", type=Path, default=SOURCE, help="원본 CI JPG 경로")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="가로형 투명 PNG 출력 경로")
    parser.add_argument("--icon-output", type=Path, default=ICON_OUTPUT, help="앱 아이콘 PNG 출력 경로")
    parser.add_argument("--favicon-output", type=Path, default=FAVICON_OUTPUT, help="favicon.ico 출력 경로")
    args = parser.parse_args()
    extract_logo(args.source, args.output, args.icon_output, args.favicon_output)
