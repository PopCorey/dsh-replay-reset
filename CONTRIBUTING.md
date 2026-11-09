# 开发与验证

## 环境

- Node.js 24 或更新版本；离线测试入口已在 Node.js 24.15 验证。
- 仅运行单元测试不需要安装依赖；测试使用 Node 内置测试器和合成数据。
- 完整测试需要当前受支持的 DSH `0.2.2-rc.1`，由本机提供其真实模块。仓库不复制、发布宿主程序或上游 SDK。
- 插件运行入口为 [src/index.js](<src/index.js>)，浏览器入口为 [src/client.js](<src/client.js>)。浏览器入口已是原生 ModuleLoader 格式，不需要打包 React。

## 单元测试（可在 CI 执行）

```sh
npm run test:unit
```

涵盖纯桥安装/卸载事务、客户端控制器、策略及显示资源检查。一个依赖真实 Responses 转换器的用例会明确标为跳过，不能把这个命令当作完整宿主验证。验证命令应在源码目录执行；发布包不包含测试和开发脚本。

## 完整宿主测试

路径只通过本地环境变量指定，不要写回源码或提交到 Git。

PowerShell 示例（将示例值替换为自己的安装位置）：

```powershell
$env:DSH_TEST_ROOT = 'C:\path\to\DSH\resources\app.asar'
$env:DSH_TEST_EXECUTABLE = 'C:\path\to\DSH\DSH NEXT.exe'
npm test
```

Bash 示例：

```sh
export DSH_TEST_ROOT='/path/to/DSH/resources/app.asar'
export DSH_TEST_EXECUTABLE='/path/to/DSH/electron-executable'
npm test
```

测试启动器会以 `ELECTRON_RUN_AS_NODE=1` 启动指定的 Electron，以支持读取归档中的宿主模块。若使用已经解包、可以由普通 Node 读取的安装根，可不设置 `DSH_TEST_EXECUTABLE`。该运行根必须包含宿主清单和 `node_modules/@deepseek-ai`。

完整测试使用真实 `LlmRuntime` 和 Responses 转换器，但不向上游发请求、不写真实会话。不要在 CI 中放入真实 API key、聊天记录或 profile 目录。

## 接口指纹复核

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_TEST_EXECUTABLE scripts/probe-host.mjs
```

不要仅为消除版本报错而替换 [host-bridge.js](<src/host-bridge.js>) 中的指纹。必须同时审查 prepared 绑定、方法签名、取消、卸载、调用次数并跑完整测试。

## 打包

```sh
npm run check:package
npm pack --ignore-scripts
```

发布包包含运行源码、插件清单、英/中文 locale 元数据、原创图标、README、开发说明、许可证和更新记录；不含测试宿主、个人配置或调试数据。生成的 `.tgz` 已由 Git 忽略。检查实际 packed 文件列表，不能仅根据清单假定资源已分发。

部署后的验收应检查两种语言的插件标题/描述、图标、按钮、明暗主题及会话切换；源代码单测或槽位注册不等于已看到实际界面。未经用户要求，不自动替换 profile 安装或触发真实重置。

## 接口维护约束

- 存储仍为 V1，已有标记和可识别未知字段保留；不得为修复字典查找而删除用户策略。
- HTTP API 为 2：`resetCount` 仅表示当前根会话累计，`addedCount` 是本次全树增量。旧/错版本、身份和计数拒绝应只做 GET 恢复，不能自动重放 POST。
- 此版本是用户明确触发的空闲态维护动作；不得以新增 Agent 工具为由绕过维护锁、唤醒子代理或递归调用模型。
- operation 回执只保留 profile 全局最近 100 次；超过窗口的 ID 不能作为自动重放凭据。
- 覆盖路由注册失败、不可扩展原型、部分桥安装、late open、初始化写入/已提交写入期间卸载、清理错误聚合，以及语言切换无 I/O 的边界测试。

## 兼容性与数据说明

- 只支持已核验的 DSH **core `0.2.2-rc.1`**、`agentrouter` provider 的 Responses 历史；Desktop 版本号不等于 core 版本号。不处理 Claude、独立 Codex/Claude Code。
- 一次点击只捕获当前会话及其既有、可安全读取的本地子代理。原始记录未闭合、工具结果不完整、子代理运行中或分支为 diagnostic/external/unknown 时整批拒绝；关联子代理上限为 64。以后新建的子代理和独立 fork 不自动继承这次快照。
- 原始会话文件、聊天与思考展示、工具调用/结果、模型选择、任务板及成员关系不被改写。独立策略在 storage domain `replay_reset` 的 `state/policy` 记录中保存，只含会话身份、消息 ID、provider/model 和回放元数据的 SHA-256 指纹，不保存聊天正文、推理密文或凭据。
- 请求投影只为匹配的旧消息创建新的 envelope，去除 `source.replayState`，复用原生协议转换，不修改 item IDs 或工具结果；新回放、无策略会话及不相关 fork 保持不变。旧标记持续被识别，不是每轮清空推理状态。
- 内部兼容桥装载时核验 `LlmRuntime.adapterStream` 方法指纹和原型可安装性，保留原 `prepared`、取消信号、请求标记与 middleware 次序，不递归调用 `llm.stream`。这是内部接口，不是公开请求转换 API；方法 hash 不能覆盖所有相关依赖的语义，升级宿主须重新审查整个调用链。
- 只适用于单个 DSH 宿主和同一 profile；不要用多个宿主同时修改同一策略目录。本地提交成功不等于上游 API 已恢复，下一条正常消息才会发出实际请求。
- 最近 100 次提交的 operation ID 可按原回执幂等返回并核验根会话绑定。更早的 ID 不再保留回执，重放可能被当成新捕获操作；界面每次点击生成新 UUID，从不自动重放 POST。切换会话或取消网络等待也不等于撤销已经送达的提交。
- 路由/桥安装失败会回滚本次资源；策略加载失败停用按钮并撤销桥/域。损坏策略拒绝加载，未知持久化状态按原生 quarantine 隔离，不能连续重试写入。卸载立即停止投影，所有资源都尝试清理；late open 返回后立即关闭，已进入不可取消持久化的写入先排空再关闭域，不重新发布就绪。
- **停用、卸载或加载失败后，旧资源绑定状态可能再次发送，同类 API 错误可能复发。** 原始历史无需恢复。若其他插件再装饰同一内部方法，本桥只变为透传、不覆盖他人；残余装饰链或被锁定原型需要完全重启 DSH。底层存储长期不完成时应检查宿主，而非绕过限制。

## 提交前

1. 跑单元测试；涉及运行入口、请求桥或 DSH 接口变更时，再跑完整测试。
2. 查看 `git diff`、`git status` 和 `npm run check:package`。
3. 确认没有密钥、会话 ID、截图、真实聊天、个人绝对路径或 API 请求密文。
4. 提交自己的改动前核对 Git 作者邮箱，避免公开不希望展示的个人邮箱；不要把凭据写入 remote URL。
5. 未经用户明确操作，不用测试脚本发送消息、重跑任务或自动点击真实重置按钮。
