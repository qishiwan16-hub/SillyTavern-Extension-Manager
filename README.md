# SillyTavern 扩展管理器

通过魔法棒菜单集中查看、分组和更新 SillyTavern 扩展。扩展检测和更新继续使用酒馆原生接口；中文名、备注、分组和界面设置由独立后端保存，不使用浏览器持久化。

## 功能

- 使用 `/api/extensions/discover` 读取酒馆扩展。
- 显示清单名称、中文名、备注、版本、分支、提交号和 Git 仓库。
- 后端管理页显示服务端插件连接状态和版本，并支持检查更新。
- 前端扩展列表上方集中提供本体检测、扩展检测和更新操作。
- 使用酒馆原生版本与更新接口检查更新。
- 扩展管理器本体支持自动检测、手动检查和更新后热加载。
- 后端支持面板检测和安全的 `git pull --ff-only` 更新，完成后只提示手动重启 Termux，不会自动重启酒馆。
- 检测期间可以收纳为不遮挡正文的临时悬浮球，大小可在 `25-56px` 之间调整。
- 可勾选需要更新的扩展并按顺序快速热更新，不刷新浏览器。
- 启用或禁用扩展调用酒馆原生接口，并按酒馆要求刷新页面。
- 扩展按标签形成文件夹式分组，支持添加扩展、重命名和解散；内置扩展自动归入“内置”文件夹。
- 中文名、备注、自定义分组和悬浮球大小按酒馆账号保存到后端 JSON 文件。
- 后端使用原子写入、`.bak` 备份和损坏回退读取。

## 前端安装

在 SillyTavern 的“安装扩展”输入框中粘贴：

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

先停止 SillyTavern，然后打开 Termux。默认安装在 `~/SillyTavern` 时执行：

```bash
pkg install git -y
cd ~/SillyTavern/plugins
git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git extension-manager
cd ..
```

如果 SillyTavern 不在默认目录，把 `~/SillyTavern` 换成实际安装路径。

打开 SillyTavern 的 `config.yaml`，确保启用服务端插件：

```yaml
enableServerPlugins: true
```

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

扩展页面标题下方显示“服务端存储已连接”后，中文名、备注、分组和界面设置才可以保存。后端未连接时仍可查看和更新扩展，但不会把资料或界面设置回退到浏览器存储。

## 数据位置

数据按酒馆账号分文件保存在：

```text
SillyTavern/plugins/extension-manager/data/
```

每次保存会先写临时文件再替换主文件，并把上一次数据保留为 `.bak`。分组数据保存在扩展元数据中，悬浮球大小保存在 `settings.floatingBallSize`。也可以通过 `EXTENSION_MANAGER_DATA_DIR` 环境变量指定其他数据目录。

## 更新

前端可以在本扩展管理器中检查并更新，也可以手动执行：

```bash
cd data/<账户名>/extensions/third-party/SillyTavern-Extension-Manager
git pull
```

后端可以在扩展管理器的“后端管理”页面检测并更新。面板更新固定执行后端安装目录的 `git pull --ff-only`；更新完成后会提示手动重启 Termux 中的 SillyTavern，但不会自动停止或重启任何进程。

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

扩展管理器前端不负责安装普通 Git 扩展；“后端管理”页面用于安装指引、检测服务端插件版本和执行后端更新。
