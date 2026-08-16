# SillyTavern 扩展管理器后端

为“扩展管理器”保存中文名、备注、分组和界面设置等资料。数据按酒馆账号写入服务端 JSON 文件，不使用浏览器 localStorage、IndexedDB 或其他浏览器持久化。

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
- `GET /api/plugins/extension-manager/version`：检测后端 Git 仓库更新。
- `POST /api/plugins/extension-manager/update`：在后端自身目录执行 `git pull --ff-only`；仅管理员可调用。
- `GET /api/plugins/extension-manager/data`：读取当前酒馆账号的数据。
- `PUT /api/plugins/extension-manager/data`：保存当前酒馆账号的数据。

## 数据和备份

数据默认保存在：

```text
SillyTavern/plugins/extension-manager/data/
```

账号名称会经过哈希处理后作为文件名。写入过程会先创建临时文件，再原子替换主文件；上一次内容保存在同名 `.bak` 文件中。主文件无法解析时会自动读取 `.bak`。

悬浮球大小等界面设置保存在同一账号文件的 `settings` 字段中，`floatingBallSize` 会限制在 `25-56` 像素。

可以通过环境变量修改数据目录：

```bash
export EXTENSION_MANAGER_DATA_DIR=/你的数据目录
```

## 更新

前端面板可以调用本后端的更新接口。接口固定对 `SillyTavern/plugins/extension-manager` 实际安装目录执行等价于下面的操作：

```bash
git -C SillyTavern/plugins/extension-manager pull --ff-only
```

它不会执行停止、启动或重启 Termux/SillyTavern 的命令。拉取成功后，面板只会提示用户手动重启。

也可以先停止 SillyTavern，再手动执行：

```bash
cd SillyTavern/plugins/extension-manager
git pull --ff-only
```

拉取完成后重新启动 SillyTavern。更新不会删除 `data/` 中的资料。第一次从 `v1.0.0` 升级时，需要手动拉取一次才能获得后端更新接口。
