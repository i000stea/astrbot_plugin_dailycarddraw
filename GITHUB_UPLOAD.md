# GitHub 上传说明

当前项目已经完成本地 Git 仓库初始化，默认分支为 `main`。

## 推荐上传流程

### 1. 在 GitHub 创建新仓库

建议仓库名：

```text
astrbot_plugin_dailycarddraw
```

创建时建议：

- 不勾选 `Add a README file`
- 不勾选 `.gitignore`
- 不勾选 `license`

因为这些文件当前项目里已经存在。

### 2. 绑定远程仓库

将下面命令中的仓库地址替换成你的 GitHub 仓库地址：

```bash
git remote add origin https://github.com/<你的用户名>/astrbot_plugin_dailycarddraw.git
```

如果后续需要修改远程地址：

```bash
git remote set-url origin https://github.com/<你的用户名>/astrbot_plugin_dailycarddraw.git
```

### 3. 推送到 GitHub

```bash
git push -u origin main
```

## 常用检查命令

查看仓库状态：

```bash
git status
```

查看远程配置：

```bash
git remote -v
```

查看提交记录：

```bash
git log --oneline --decorate --graph -n 10
```

## 后续同步流程

开发后常用流程：

```bash
git add .
git commit -m "feat: 更新每日抽卡插件功能"
git push
```

## 当前状态说明

- 本地仓库已初始化
- 默认分支为 `main`
- 当前项目尚未绑定 `origin`
- 你只需要创建 GitHub 仓库并补上远程地址即可上传
