# npm 与 GitHub Release 发布

## 一次性准备

1. 首次 npm 发布使用已经核验的 `artifacts/dsh-replay-reset-0.1.3.tgz`，不要重新移动已有 `v0.1.3` 标签。
2. 在本机使用 `npm login --auth-type=web --registry=https://registry.npmjs.org/` 完成官方网页登录和 2FA。密码、验证码、恢复码都不应写入仓库或聊天。
3. 首次发布：

   ```sh
   npm publish ./artifacts/dsh-replay-reset-0.1.3.tgz --ignore-scripts --access public --registry=https://registry.npmjs.org/
   ```

4. 在 npm 包存在后配置 Trusted Publisher。npm CLI 11.15.0+ 支持命令行配置，可能再次要求在浏览器完成 2FA：

   ```sh
   npm trust list dsh-replay-reset --registry=https://registry.npmjs.org/
   npm trust github dsh-replay-reset --repo PopCorey/dsh-replay-reset --file release.yml --allow-publish --yes --registry=https://registry.npmjs.org/
   ```

   如果已有配置，先核对，不要自动删除或覆盖它。网站上的对应字段为：

   | 字段 | 值 |
   | --- | --- |
   | Provider | GitHub Actions |
   | Organization or user | `PopCorey` |
   | Repository | `dsh-replay-reset` |
   | Workflow filename | `release.yml`（不填目录） |
   | Environment | 留空 |
   | Allowed actions | 允许 `npm publish` |

5. 将 `.github/workflows/release.yml` 推送到 GitHub 后，下一次新版本标签才能运行新流程。已有标签的旧工作流不会自动更新。无需创建 `NPM_TOKEN` secret，也不需要关闭 2FA。

**注意：** npm 当前的多 Trusted Publisher 配置需在创建后 2 天内完成首次成功发布才能验证并绑定仓库；否则应在准备下一次发布时重新创建。配置成功或发布预演不等于已经验证 OIDC，实际的新版本发布成功才算端到端验证。首次手工发布不会补上 GitHub OIDC provenance；后续自动发布会生成。

## 后续更新

1. 修改功能与测试；运行 `npm run test:unit`。涉及宿主接口时按 `CONTRIBUTING.md` 运行完整测试。
2. 更新 `CHANGELOG.md`，并用 `npm version patch --no-git-tag-version` 更新版本；较大的更新可以选择 `minor` 或 `major`。
3. 执行 `npm run check:package`，检查包清单、工作区差异及提交作者邮箱，提交本次变更。
4. 确保 Trusted Publisher 已配置且未失效；创建与包版本完全一致的新标签后推送：

   ```sh
   git tag -a v0.1.4 -m "Release v0.1.4"
   git push origin main
   git push origin v0.1.4
   ```

   `0.1.4` 只是下一版本示例，必须与当次 `package.json` 一致。不要重打或强推已有标签。

5. 查看 GitHub Actions 的 Release 工作流：验证标签 → 单元测试 → 打包 → 检查 npm 内容 → OIDC 发布 npm → 创建 GitHub Release。稳定版使用 `latest`，带 `-` 的预发布版使用 `next` 并标为 GitHub prerelease。
6. 核对 npm 官方仓库版本和下载文件：

   ```sh
   npm view dsh-replay-reset version dist.integrity --registry=https://registry.npmjs.org/
   ```

## 失败与重跑

- 浏览器认证需本人完成，不在 CI 存储人工 OTP 或恢复码。
- 只有 npm 官方版本接口明确返回 404 才视为未发布；网络错误、401/403/5xx 都会中止。
- 同版本且 SHA-512 integrity 相同会跳过重复上传，再继续创建缺失的 GitHub Release。
- 同版本但内容不同会拒绝发布：更新版本号，不覆盖已经公开的包。
- npm 发布失败后不会创建新的 GitHub Release；修复授权后在 Actions 中重跑同一个工作流即可。
- GitHub Release 已存在时不会改写正文或覆盖附件。若此前手工创建了不完整的 Release，需单独核验、处理附件。
- 配置权限不会替代 npm 端的可信发布授权。核对仓库名、文件名、Allowed actions 和有效期；不要以放宽 token 或停用 2FA 来绕过失败。

## 官方文档

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm trust 命令](https://docs.npmjs.com/cli/v11/commands/npm-trust)
