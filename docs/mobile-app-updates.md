# 手机 App 手动更新接口

当前项目只有网页端，没有 Android/iOS 原生工程。网页不会要求服务器构建 App；未来原生外壳提供一个小型 JS bridge 后，网页启动时读取 `mobile-app-update.json`，发现高于当前 App 版本的安装包时显示“稍后 / 下载更新”弹窗。

原生外壳应在载入页面前注入：

```js
window.ChuheAppUpdater = {
  platform: 'android', // 或 'ios'
  version: '1.0.0'
};
```

更新清单示例：

```json
{
  "schema": "chuhe-mobile-app/v1",
  "apps": {
    "android": {
      "version": "1.1.0",
      "downloadUrl": "https://example.com/chuhe-1.1.0.apk",
      "sha256": "64位十六进制摘要",
      "releaseNotes": "更新内容"
    },
    "ios": null
  }
}
```

清单当前由 `mobile-app-update.json` 提供，未填写的平台不会显示更新提示。Android 安装包必须保持相同 application ID 并使用原有签名密钥；用户下载后仍需确认系统安装提示。iOS 需要可用的签名与分发方式，Ad Hoc 分发要求先登记设备；普通 IPA 下载链接不能保证用户直接完成安装。原生工程创建后应在真机验证下载和签名，再填写对应发行信息。
