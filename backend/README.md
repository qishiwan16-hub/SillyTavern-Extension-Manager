# SillyTavern 扩展管理器后端

为“扩展管理器”保存中文名和备注等资料。数据按酒馆账号写入服务端 JSON 文件，不使用浏览器 localStorage、IndexedDB 或其他浏览器持久化。

## 安装

先停止 SillyTavern，然后在 SillyTavern 根目录执行：

```bash
cd plugins
git clone https://github.com/qishiwan16-hub/SillyTavern-Extension-Manager-Backend.git extension-manager
cd ..
```

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
- `GET /api/plugins/extension-manager/data`：读取当前酒馆账号的数据。
- `PUT /api/plugins/extension-manager/data`：保存当前酒馆账号的数据。

## 数据和备份

数据默认保存在：

```text
SillyTavern/plugins/extension-manager/data/
```

账号名称会经过哈希处理后作为文件名。写入过程会先创建临时文件，再原子替换主文件；上一次内容保存在同名 `.bak` 文件中。主文件无法解析时会自动读取 `.bak`。

可以通过环境变量修改数据目录：

```bash
export EXTENSION_MANAGER_DATA_DIR=/你的数据目录
```

## 更新

先停止 SillyTavern，然后执行：

```bash
cd SillyTavern/plugins/extension-manager
git pull
```

拉取完成后重新启动 SillyTavern。更新不会删除 `data/` 中的资料。
