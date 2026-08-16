# SillyTavern 扩展管理器后端

为“扩展管理器”保存中文名、备注、分组、更新白名单和界面设置等资料。数据按酒馆账号写入服务端 JSON 文件，不使用浏览器 localStorage、IndexedDB 或其他浏览器持久化。

## 安装

先停止 SillyTavern，然后打开 Termux。默认安装在 `~/SillyTavern` 时执行：

```bash
pkg install git -y
cd ~/SillyTavern/plugins
git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git extension-manager
cd ..
```

如果 SillyTavern 不在默认目录，把 `~/SillyTavern` 换成实际安装路径。

编辑 SillyTavern 根目录的 `config.yaml`：

```yaml
enableServerPlugins: true
```

重新启动 SillyTavern。

## 检查连接

浏览器访问：

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

接口地址：

- `GET /api/plugins/extension-manager/status`：检查后端状态。
- `GET /api/plugins/extension-manager/version`：检测管理后端自身的 Git 仓库更新。
- `POST /api/plugins/extension-manager/update`：更新管理后端自身；仅管理员可调用。
- `GET /api/plugins/extension-manager/plugins?checkUpdates=true`：列出并检测 `SillyTavern/plugins` 下全部后端插件。
- `POST /api/plugins/extension-manager/plugins/check`：按 `pluginIds` 检测指定后端插件。
- `POST /api/plugins/extension-manager/plugins/update`：按 `pluginId` 更新单个后端插件；仅管理员可调用，白名单项会被拒绝。
- `GET /api/plugins/extension-manager/data`：读取当前酒馆账号的数据。
- `PUT /api/plugins/extension-manager/data`：保存当前酒馆账号的数据。

## 数据和备份

数据默认保存在：

```text
SillyTavern/plugins/extension-manager/data/
```

账号名称会经过哈希处理后作为文件名。写入过程会先创建临时文件，再原子替换主文件；上一次内容保存在同名 `.bak` 文件中。主文件无法解析时会自动读取 `.bak`。

前端扩展资料保存在 `extensions`，后端插件的中文名、备注和分组保存在 `backendPlugins`。不参与检测和更新的前后端插件保存在 `whitelist.frontend` 与 `whitelist.backend`。悬浮球大小保存在同一账号文件的 `settings` 字段中，并限制在 `25-56` 像素。

可以通过环境变量修改数据目录：

```bash
export EXTENSION_MANAGER_DATA_DIR=/你的数据目录
```

## 更新

前端面板可以调用本后端的更新接口，检测 `SillyTavern/plugins` 下包含 `index.js`、`package.json` 或 `manifest.json` 的直接子目录。只有目录自身是独立 Git 仓库并配置了上游分支时才支持自动更新。

更新单个插件等价于：

```bash
git -C SillyTavern/plugins/<插件目录> pull --ff-only
```

插件标识只允许安全的直接目录名，更新前还会确认 Git 仓库根目录就是插件目录，避免命令误作用于 SillyTavern 主仓库。接口不会执行停止、启动或重启 Termux/SillyTavern 的命令；拉取成功后只提示用户手动重启。

也可以先停止 SillyTavern，再手动执行：

```bash
cd SillyTavern/plugins/extension-manager
git pull --ff-only
```

拉取完成后重新启动 SillyTavern。更新不会删除 `data/` 中的资料。第一次从 `v1.0.0` 升级时，需要手动拉取一次才能获得后端更新接口。
