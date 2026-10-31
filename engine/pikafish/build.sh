#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE="$ROOT/engine/pikafish"
WORK="$ROOT/.build/pikafish"
OUT="${PIKAFISH_OUT:-$ENGINE/dist}"
REV="${PIKAFISH_REV:-6a59ee2f7b105bff64d9efc2692591107787e2b1}"
NET_URL="${PIKAFISH_NET_URL:-https://github.com/brianhliou/pikafish-wasm/releases/download/v0.1.0/pikafish.nnue}"
NET_SHA256="${PIKAFISH_NET_SHA256:-7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e}"
PIKAFISH_VERSION="${PIKAFISH_VERSION:-$REV}"
export PIKAFISH_NET_SHA256="$NET_SHA256"

command -v git >/dev/null || { echo '需要 Git' >&2; exit 1; }
command -v em++ >/dev/null || { echo '需要 Emscripten SDK（em++）' >&2; exit 1; }
mkdir -p "$WORK" "$OUT"
if [ ! -d "$WORK/src/.git" ]; then
  git clone --filter=blob:none https://github.com/official-pikafish/Pikafish.git "$WORK/src"
fi
git -C "$WORK/src" fetch --depth 1 origin "$REV"
git -C "$WORK/src" reset --hard "$REV"
if git -C "$WORK/src" apply --check "$ENGINE/source.patch" 2>/dev/null; then
  git -C "$WORK/src" apply "$ENGINE/source.patch"
elif grep -q 'EMSCRIPTEN_KEEPALIVE' "$WORK/src/src/main.cpp" \
  && grep -q 'bool UCIEngine::execute(const std::string& cmd)' "$WORK/src/src/uci.cpp" \
  && grep -q 'bool execute(const std::string& cmd);' "$WORK/src/src/uci.h"; then
  echo '上游源码已包含所需的 WebAssembly UCI 包装，跳过补丁。'
else
  echo '当前 Pikafish 源码无法应用或识别浏览器包装补丁。' >&2
  exit 1
fi

(
  cd "$WORK/src"
  mapfile -t sources < <(find src -name '*.cpp' -not -path '*/universal/*' | sort)
  em++ "${sources[@]}" -Isrc -std=c++17 -O3 -funroll-loops -DNDEBUG -DIS_64BIT -DNO_PREFETCH \
    -DUSE_POPCNT -DUSE_SSE2 -msse2 -DUSE_SSSE3 -mssse3 -DUSE_SSE41 -msse4.1 \
    -DUSE_SLOPPY_ATOMICS -msimd128 -pthread -fno-exceptions \
    -sWASM=1 -sMODULARIZE=1 -sEXPORT_NAME=Pikafish -sENVIRONMENT=web,worker \
    -sEXPORTED_FUNCTIONS=_pikafish_initialize,_pikafish_command,_main,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=cwrap,FS -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=2GB -sSTACK_SIZE=3MB -sPTHREAD_POOL_SIZE='Math.min(31, Math.max(0, (navigator.hardwareConcurrency || 1) - 1))' \
    -sPTHREAD_POOL_SIZE_STRICT=0 -sNO_EXIT_RUNTIME=1 -sINVOKE_RUN=0 \
    -o "$OUT/pikafish.js"
  cp Copying.txt "$OUT/COPYING.txt"
)

NET="$OUT/pikafish.nnue"
if [ ! -s "$NET" ]; then
  curl -fL --retry 3 "$NET_URL" -o "$NET"
fi
python3 - "$NET" <<'PY'
import hashlib, pathlib, sys
path = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(path.read_bytes()).hexdigest()
expected = __import__('os').environ.get('PIKAFISH_NET_SHA256', '7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e')
if digest != expected:
    path.unlink(missing_ok=True)
    raise SystemExit(f'NNUE SHA-256 不匹配：{digest}')
PY
cp "$ENGINE/worker.js" "$OUT/worker.js"
cp "$ENGINE/NNUE-License.md" "$OUT/NNUE-License.md"
python3 - "$OUT/version.json" "$PIKAFISH_VERSION" "$REV" "$NET_SHA256" <<'PY'
import json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'version': sys.argv[2], 'commit': sys.argv[3], 'net_sha256': sys.argv[4]
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY
printf '构建完成：%s\n' "$OUT"
