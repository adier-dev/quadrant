# 象限 · 待办四象限

本地优先的个人任务软件：电脑使用 Python 本地服务器与浏览器，安卓安装版独立离线运行。手机与电脑各自保存数据，只有同一局域网内两端手动操作时才同步，无需云端账号或云数据库。

本仓库公开独立编写的完整应用源码，采用 [MIT License](LICENSE)。来源与许可范围见 [NOTICE](NOTICE.md)。

## 功能

- 重要／紧急四象限、全部待办与今日待办、搜索和排序。
- 任务正文、日期、置顶、完成、回收站恢复与确认后永久删除。
- 日历、附件、专注计时、统计、ZIP／JSON 备份与合并恢复。
- 自定义专注／休息时间，1 分钟至 24 小时；可上传最大 20 MB 的本地到时音频。
- 安卓本机 IndexedDB 存储、系统闹钟与音频服务；禁用系统云备份。
- 局域网手动配对、三方比较与冲突选择；同步附件、提示音和删除标记，保留任务版本冲突检测。

## 电脑运行

安装 Python 3.10 或更高版本，无需安装第三方 Python 依赖：

```sh
git clone https://github.com/adier-dev/quadrant.git
cd quadrant
python server.py
```

浏览器会打开 `http://127.0.0.1:8765`，首次设置空间名称与至少 8 位访问密码。Windows 也可双击 `Start-Quadrant.cmd`；如果目录内有已打包的 EXE，启动脚本优先运行 EXE。

```sh
python server.py --host 127.0.0.1 --no-browser
python server.py --port 8766
python server.py --data-dir ./my-data
```

macOS／Linux 可直接运行 Python 源码。默认提供局域网访问；其他浏览器使用设置页显示的电脑局域网地址。手机浏览器访问电脑时，电脑必须保持运行。

数据默认保存在程序旁的 `data/`。通过设置页导出 ZIP 可同时备份任务、附件和提示音；JSON 不含附件或音频字节。发布或分享文件时不要携带自己的数据目录。

## 安卓构建

需要 Windows、Python 3.10+、JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。构建脚本直接调用 SDK 工具，不需要 Gradle 或第三方应用依赖。

```powershell
$env:JAVA_HOME = 'C:\Tools\jdk-17'
$env:ANDROID_HOME = 'C:\Tools\android-sdk'
python tools/build_android.py
```

生成 `releases/Quadrant-Android.apk`，支持 Android 8.0+，并需要较新的 Android System WebView。首次构建自动生成本机 `android-signing/`，后续更新必须保留同一签名密钥；签名目录和 APK 均被 Git 忽略。更新已有安装时请覆盖安装，卸载会删除手机数据。

仓库仅提供源码；上述 EXE 和 APK 需要自行构建。

## 手机与电脑同步

1. 手机和电脑连接同一可信 Wi-Fi，各自打开软件。
2. 两端分别按右上角“同步”，两次操作间隔不超过 2 分钟，并保持软件打开。
3. 首次在手机输入电脑显示的 8 位配对码，以后直接按按钮。
4. 双方都修改过的任务在手机选择电脑版本、手机版本或保留两份。

默认电脑 HTTP 端口为 TCP 8765，发现端口为 UDP 8767。Windows 防火墙需允许专用网络访问；访客 Wi-Fi 或客户端隔离可能阻止互访。

配对使用临时配对码与设备密钥校验，局域网 HTTP 没有传输加密，请使用可信网络。密码、外观和正在进行的计时各端独立；不提供外网发现、中继或自动云同步。

安卓首次计时需要按系统提示允许闹钟和通知权限。电脑浏览器需保持页面打开，休眠和浏览器限制可能影响提醒。实体安卓设备的 Wi-Fi 广播、锁屏播放与厂商权限行为尚需实机验证。

## 修改与打包

| 路径 | 职责 |
| --- | --- |
| `server.py` | 标准库 HTTP 后端、SQLite、鉴权、任务和备份 |
| `lan_sync.py` | 同步窗口、配对、冲突比较、附件校验 |
| `web/` | 无构建步骤的 HTML／CSS／JavaScript 界面 |
| `web/phone-store.js` | 安卓 IndexedDB 数据层 |
| `web/lan-sync.js` | 手动同步界面与手机同步流程 |
| `web/timer-audio.js` | 提示音与安卓原生闹钟桥接 |
| `android/` | Java WebView 壳、局域网发现、文件选择、闹钟和播放服务 |
| `tools/build_android.py` | 安卓编译与本机签名 |

修改前端后刷新页面即可；安卓内置网页需要重新构建 APK。修改 Python 后端后重启源码服务器，EXE 模式需重新打包。

Windows 打包：

```powershell
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --clean --onedir --name QuadrantServerV2 --contents-directory _runtime-v2 server.py
```

将 `web/`、`Start-Quadrant.cmd`、`LICENSE`、`NOTICE.md` 和 `THIRD_PARTY/` 一并放入生成的 `dist/QuadrantServerV2/`。运行目录内的 EXE，保持 `web/` 与 EXE 同级。发布包不应包含 `data/`、本机签名密钥、测试数据或原应用资料。
