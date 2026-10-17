#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE="$ROOT/engine/pikafish"
WORK="$ROOT/.build/pikafish"
OUT="$ENGINE/dist"
REV=6a59ee2f7b105bff64d9efc2692591107787e2b1
IMAGE=emscripten/emsdk:3.1.74

command -v git >/dev/null || { echo '需要 Git' >&2; exit 1; }
command -v docker >/dev/null || { echo '需要 Docker' >&2; exit 1; }
mkdir -p "$WORK" "$OUT"
if [ ! -d "$WORK/src/.git" ]; then
  git clone --filter=blob:none https://github.com/official-pikafish/Pikafish.git "$WORK/src"
fi
git -C "$WORK/src" fetch --depth 1 origin "$REV"
git -C "$WORK/src" reset --hard "$REV"
git -C "$WORK/src" apply "$ENGINE/source.patch"

# Build inside a pinned Emscripten image; mount the project at /project.
docker run --rm -v "$ROOT:/project" -w /project/.build/pikafish/src "$IMAGE" bash -lc '
  set -euo pipefail
  mapfile -t sources < <(find src -name "*.cpp" -not -path "*/universal/*" | sort)
  em++ "${sources[@]}" -Isrc -std=c++17 -O3 -funroll-loops -DNDEBUG -DIS_64BIT -DNO_PREFETCH \
    -DUSE_POPCNT -DUSE_SSE2 -msse2 -DUSE_SSSE3 -mssse3 -DUSE_SSE41 -msse4.1 \
    -DUSE_SLOPPY_ATOMICS -msimd128 -pthread -fno-exceptions \
    -sWASM=1 -sMODULARIZE=1 -sEXPORT_NAME=Pikafish -sENVIRONMENT=web,worker \
    -sEXPORTED_FUNCTIONS=_pikafish_initialize,_pikafish_command,_main,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=cwrap,FS -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=1GB -sSTACK_SIZE=3MB -sPTHREAD_POOL_SIZE=8 \
    -sPTHREAD_POOL_SIZE_STRICT=0 -sNO_EXIT_RUNTIME=1 -sINVOKE_RUN=0 \
    -o /project/engine/pikafish/dist/pikafish.js
  cp Copying.txt /project/engine/pikafish/dist/COPYING.txt
'

NET="$OUT/pikafish.nnue"
if [ ! -s "$NET" ]; then
  curl -fL --retry 3 'https://github.com/brianhliou/pikafish-wasm/releases/download/v0.1.0/pikafish.nnue' -o "$NET"
fi
python3 - "$NET" <<'PY'
import hashlib, pathlib, sys
path = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(path.read_bytes()).hexdigest()
expected = '7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e'
if digest != expected:
    path.unlink(missing_ok=True)
    raise SystemExit(f'NNUE SHA-256 不匹配：{digest}')
PY
cp "$ENGINE/worker.js" "$OUT/worker.js"
cp "$ENGINE/NNUE-License.md" "$OUT/NNUE-License.md"
printf '构建完成：%s\n' "$OUT"
