# SillyTavern 扩展管理器

通过魔法棒菜单集中查看、安装和更新 SillyTavern 扩展。扩展检测、安装和更新继续使用酒馆原生接口；中文名和备注由独立后端保存，不使用浏览器持久化。

## 功能

- 使用 `/api/extensions/discover` 读取酒馆扩展。
- 显示清单名称、中文名、备注、版本、分支、提交号和 Git 仓库。
- 支持当前用户或全局范围的 Git 仓库安装。
- 使用酒馆原生版本与更新接口检查更新。
- 扩展管理器本体支持自动检测、手动检查和更新后热加载。
- 更新后尝试带缓存参数热加载；无法热加载时提示刷新页面。
- 中文名和备注按酒馆账号保存到后端 JSON 文件。
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

先停止 SillyTavern，然后在 SillyTavern 根目录执行：

```bash
cd plugins
git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git extension-manager
cd ..
```

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

扩展页面标题下方显示“服务端存储已连接”后，中文名和备注才可以保存。后端未连接时仍可查看、安装和更新扩展，但不会把资料回退到浏览器存储。

## 数据位置

数据按酒馆账号分文件保存在：

```text
SillyTavern/plugins/extension-manager/data/
```

每次保存会先写临时文件再替换主文件，并把上一次数据保留为 `.bak`。也可以通过 `EXTENSION_MANAGER_DATA_DIR` 环境变量指定其他数据目录。

## 更新

前端可以在本扩展管理器中检查并更新，也可以手动执行：

```bash
cd data/<账户名>/extensions/third-party/SillyTavern-Extension-Manager
git pull
```

后端更新需要先停止酒馆：

```bash
cd plugins/extension-manager
git pull
```

拉取完成后重新启动 SillyTavern。后端更新不会删除 `data/` 中的资料。

## 仓库结构

- `index.js`：前端扩展。
- `manifest.json`：酒馆扩展清单。
- `backend/`：后端源码镜像；实际安装建议使用独立后端仓库。
