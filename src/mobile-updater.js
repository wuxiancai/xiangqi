const APP_UPDATE_MANIFEST = 'https://raw.githubusercontent.com/wuxiancai/xiangqi/main/mobile-app-update.json';

export async function checkMobileAppUpdate() {
  const app = globalThis.ChuheAppUpdater;
  if (!app || !['android', 'ios'].includes(app.platform) || typeof app.version !== 'string') return;
  try {
    const response = await fetch(APP_UPDATE_MANIFEST, { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    if (manifest.schema !== 'chuhe-mobile-app/v1') return;
    const release = manifest.apps?.[app.platform];
    if (!release?.version || compareVersions(release.version, app.version) <= 0) return;
    const url = new URL(release.downloadUrl);
    if (url.protocol !== 'https:' || !/^[a-f0-9]{64}$/i.test(release.sha256)) return;
    showUpdateDialog(app.platform, release, url.href);
  } catch {
    // App update checks are optional; keep startup and offline use unaffected.
  }
}

function compareVersions(left, right) {
  const parts = (value) => value.split('.').map((part) => Number(part));
  const a = parts(left); const b = parts(right);
  if (![...a, ...b].every(Number.isSafeInteger)) return 0;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function showUpdateDialog(platform, release, downloadUrl) {
  if (document.querySelector('#mobile-app-update')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'mobile-app-update';
  dialog.className = 'mobile-update-dialog';
  const title = document.createElement('h2');
  title.textContent = `发现新版本 ${release.version}`;
  const note = document.createElement('p');
  note.textContent = release.releaseNotes || '下载最新安装包，按系统提示完成更新。';
  const actions = document.createElement('div');
  actions.className = 'mobile-update-actions';
  const later = document.createElement('button');
  later.type = 'button'; later.className = 'secondary-button'; later.textContent = '稍后';
  later.addEventListener('click', () => dialog.close());
  const download = document.createElement('a');
  download.className = 'primary-button'; download.href = downloadUrl;
  download.rel = 'noopener'; download.textContent = platform === 'android' ? '下载 APK' : '下载 iOS 安装包';
  download.addEventListener('click', () => dialog.close());
  actions.append(later, download);
  dialog.append(title, note, actions);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
