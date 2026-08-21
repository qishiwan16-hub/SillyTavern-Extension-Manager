# SillyTavern 扩展管理器

通过魔法棒菜单集中查看、分组和更新 SillyTavern 扩展。扩展检测和更新继续使用酒馆原生接口；前端扩展的中文名、备注和分组在管理后端可用时保存到后端，未安装或未连接后端时自动保存到当前浏览器。

## 功能

- 使用 `/api/extensions/discover` 读取酒馆扩展。
- 显示清单名称、中文名、备注、GitHub 作者、版本、分支、提交号和 Git 仓库，方便核对实际安装来源与代码版本。
- 后端管理页与前端管理保持一致，支持搜索、文件夹分组、默认折叠、多选、逐项检测和顺序更新。
- 后端管理页顶部单独提供扩展管理器后端检测与更新；普通批量检测和更新只处理其他后端插件，更新后提示手动重启 SillyTavern。
- 前端扩展列表上方集中提供本体检测、扩展检测和更新操作，检测失败项可以一键重试。
- 弱网检测优化默认开启：前端检测限制为 2 个并发并对临时网络错误退避重试；关闭优化时仍限制为 6 个并发，便于随时取消尚未开始的任务；可选 Git 代理临时用于后端插件检测与更新，不修改全局 Git 配置或仓库地址。
- 检测期间顶部显示“取消检测”，点击后当前任务会跑完，尚未开始的前后端插件会停止检测，并保留真实完成进度。
- 前后端插件检测失败时可展开完整报错，并一键复制不含插件 ID 与仓库地址的脱敏诊断报告。
- 请求遇到 `ForbiddenError: Invalid CSRF token` 时会自动刷新 CSRF token 并仅重试一次。
- 设置页内置可持续维护的“常见问题”页面，支持重点、下划线、删除线、引用、代码和高亮笔记样式。
- 设置页内置“更新日志”，入口位于“常见问题”下方；从 v1.20.0 起按版本记录每次更新，并用易懂的文字和标记说明变化。
- 设置页内置两级“新手教程”：先选择功能类别，再展开类别内的具体问题和操作方法；操作说明支持重点和提示标记，完整覆盖前端、检测更新、结果页、多选分组、后端、白名单、安装、设置与数据保存。
- 使用酒馆原生版本与更新接口检查更新。
- 扩展管理器本体支持自动检测、手动检查和更新后热加载。
- 启用或禁用前端扩展使用热更新：保存状态后只重新加载或移除目标脚本，不刷新整个酒馆页面。
- 后端只对检测到更新的独立 Git 仓库执行安全的 `git pull --ff-only`，完成后只提示手动重启 SillyTavern。
- 检测期间可以收纳为不遮挡正文的临时悬浮球，大小可在 `25-56px` 之间调整。
- 安装页支持通过 Git 地址安装并动态加载前端扩展，也可选择 Termux 或 Windows，一键复制对应的单行后端安装命令。
- 可多选前端扩展进行分组、检测、顺序热更新以及批量启用或禁用，不刷新浏览器。
- 可多选后端插件进行分组、分批检测和顺序更新；未检测的选中项不能盲目更新。
- 安装页提供独立白名单管理，只显示已经加入白名单的前后端插件；支持搜索、默认折叠的文件夹分组、添加、重命名、解散、多选、失败重试、检测和顺序更新，前端还可批量启用或禁用。
- 主列表可将前端或后端整个分组一键加入白名单；白名单管理页可将整个分组一键移出，未安装记录也能随组清理。
- 白名单项会被主列表的自动、全部和多选检测更新跳过，但可以在白名单页中显式检测并更新。
- 启用或禁用扩展调用酒馆原生接口，并使用热更新，不刷新酒馆页面。
- 扩展按标签形成文件夹式分组，支持添加扩展、重命名和解散；内置扩展自动归入“内置”文件夹。
- 内置扩展保留资料、仓库等基础卡片功能，但不参与单个、分组、多选、全部检测或更新。
- 前端中文名、备注和自定义分组优先按酒馆账号保存到后端 JSON；后端不可用时自动回退到浏览器本地存储。后端插件资料、白名单和跨设备设置仍由管理后端保存。
- 后端使用原子写入、`.bak` 备份和损坏回退读取。

## 新手教程

打开“安装扩展”页，在设置区域点击“新手教程”。教程首页按功能划分类别；点击类别进入操作列表，再点击“如何更新”“如何卸载”“如何分组”等具体问题即可展开保姆级操作方法。

类别详情页左上角返回类别列表，类别首页左上角返回安装设置页。“常见问题”入口位于新手教程下方，专门收录报错原因和解决方案。

## 前端安装

可以在扩展管理器的“安装扩展”页输入 Git 仓库地址，安装完成后会动态加载，无需刷新网页。也可以在 SillyTavern 原生“安装扩展”输入框中粘贴：

```text
https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager
```

也可以在 SillyTavern 目录手动安装：

```bash
cd data/<账户名>/extensions/third-party
git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager.git
```

安装完成后刷新酒馆，从魔法棒菜单打开“扩展管理器”。

## 后端安装

后端仓库：

```text
https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend
```

安装页会根据所选运行环境生成单行命令。浏览器不能在管理后端尚未安装时安全地执行系统命令，因此需要复制到对应终端执行。

Termux 默认安装在 `~/SillyTavern` 时执行：

```bash
pkg install git -y && cd ~/SillyTavern && mkdir -p plugins && ( [ -d plugins/extension-manager/.git ] || git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git plugins/extension-manager ) && sed -i 's/^[[:space:]]*enableServerPlugins:.*/enableServerPlugins: true/' config.yaml
```

如果 SillyTavern 不在默认目录，把 `~/SillyTavern` 换成实际安装路径。

Windows 默认安装在 `%USERPROFILE%\SillyTavern` 时，在 PowerShell 中执行：

```powershell
$ErrorActionPreference='Stop'; $git=(Get-Command git -ErrorAction SilentlyContinue).Source; if (-not $git) { winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements; $git="$env:ProgramFiles\Git\cmd\git.exe" }; if (-not (Test-Path $git)) { throw 'Git 安装失败，请先安装 Git for Windows' }; Set-Location "$HOME\SillyTavern"; New-Item -ItemType Directory -Force "plugins" | Out-Null; if (-not (Test-Path "plugins\extension-manager\.git")) { & $git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git "plugins\extension-manager" }; (Get-Content "config.yaml" -Raw) -replace '(?m)^\s*enableServerPlugins:.*$', 'enableServerPlugins: true' | Set-Content "config.yaml" -Encoding UTF8
```

如果 SillyTavern 不在默认目录，把 `$HOME\SillyTavern` 换成实际安装路径。两套命令都会安装或复用管理后端，并把 `enableServerPlugins` 设为 `true`；都不会停止或重启 SillyTavern，执行完后需要用户自行重启。

重新启动 SillyTavern。浏览器访问下面的地址进行验证：

```text
http://你的酒馆地址/api/plugins/extension-manager/status
```

正常响应会包含：

```json
{
  "ok": true,
  "pluginId": "extension-manager",
  "storage": "server"
}
```

扩展页面标题下方显示“服务端存储已连接”后，前端标注会按账号保存到后端。后端未连接时，前端扩展的中文名、备注和分组仍可保存到当前浏览器；后端插件资料、白名单和其他服务端设置需要管理后端连接。

## 数据位置

数据按酒馆账号分文件保存在：

```text
SillyTavern/plugins/extension-manager/data/
```

每次保存会先写临时文件再替换主文件，并把上一次数据保留为 `.bak`。前端扩展资料保存在 `extensions`，后端插件资料保存在 `backendPlugins`，前后端白名单保存在 `whitelist`，悬浮球大小、弱网开关和可选 Git 代理保存在 `settings`。后端不可用时，前端标注保存在浏览器本地键 `st-extension-manager-frontend-meta-v1`；日间/夜间偏好也保存在浏览器本地。也可以通过 `EXTENSION_MANAGER_DATA_DIR` 环境变量指定其他数据目录。

## 更新

前端可以在本扩展管理器中检查并更新，也可以手动执行：

```bash
cd data/<账户名>/extensions/third-party/SillyTavern-Extension-Manager
git pull
```

“后端管理”页面会列出 `SillyTavern/plugins` 下全部已安装后端插件。可以按账号保存中文名、备注和文件夹分组，并对全部或多选项逐项检测；只有已经检测到更新的插件才会进入顺序更新。更新只会在对应插件的独立 Git 仓库中执行 `git pull --ff-only`；完成后提示手动重启 SillyTavern，不会自动停止或重启任何进程。

也可以先停止酒馆再手动更新：

```bash
cd plugins/extension-manager
git pull --ff-only
```

拉取完成后重新启动 SillyTavern。后端更新不会删除 `data/` 中的资料。第一次从旧版后端升级到带自动更新接口的版本时，需要手动执行一次上述命令。

## 仓库结构

- `index.js`：前端扩展。
- `manifest.json`：酒馆扩展清单。
- `backend/`：后端源码镜像；实际安装建议使用独立后端仓库。

“安装扩展”页面集中提供前端 Git 扩展安装，以及 Termux 和 Windows 对应的扩展管理器后端单行安装命令；“后端管理”页面负责检测、展示和更新所有已安装的服务端插件。
