# AI-Proof File Guard 技术方案

## 一、为什么需要多层"只读护栏"

自动改写模式（Copilot/Claude Code apply、Cursor Agent 等）让 AI 直接写盘。它们**并不会区分敏感文件**，一旦脚本 .env、部署 YAML、秘钥或运行时 Service 文件被覆盖，损失往往在运行阶段才显现。现有做法（.gitignore、人工 review）只能降低概率，不能从机制上阻止写入。因此，在安全-成本平衡线上引入"AI 可读但不可写"护栏是值得的。

## 二、分层防御矩阵

| 层级 | 核心机制 | 读 | 写 | 典型命令/配置 | 适用平台 |
|------|----------|----|----|---------------|----------|
| **文件系统** | 只读位/不可变位 | ✅ | ❌ | chmod -w；Linux chattr +i；macOS chflags uchg；Windows attrib +R + icacls | Linux, macOS, Windows, WSL*¹ |
| **VCS 钩子** | pre-commit/prepare-commit-msg | ✅ | ❌（防进库） | pre-commit 框架 + Shell 过滤受保护路径 | 全平台 |
| **Git 属性** | merge=ours、skip-worktree、LFS lock | ✅ | ⚠️局限*² | .gitattributes、git lfs lock | 全平台 |
| **IDE/AI 插件** | VS Code File Lock（计划中） | ✅ | ❌ | VS Code 扩展 API onWillSaveTextDocument | VS Code |
| **Dev-container** | 只读挂载 | ✅ | ❌ | devcontainer.json → mounts: readonly | Docker/Podman |
| **CI/合并策略** | LFS 锁、阻断强制 push | ✅ | ❌ | LFS 服务器强锁/保护分支 | 云端 |

*¹ WSL 在 NTFS 上不支持 chattr +i，须退回 icacls*  
*² merge=ours 仅在发生冲突时生效，日常推送仍可能覆盖*

## 三、跨平台锁、解锁脚本示例

### Makefile 实现（最小可行封装）

```makefile
# Makefile — 最小可行封装
LOCK_PATTERNS := .env services/**/*.yaml scripts/deploy/**

lock:
    @$(foreach p,$(LOCK_PATTERNS), \
        ( test -e $(p) && chmod -R a-w $(p) || true ); \
    )
    @if [ "$$(uname)" = "Linux" ]; then \
        $(foreach p,$(LOCK_PATTERNS), sudo chattr -R +i $(p);) \
    fi
    @if [ "$$(OS)" = "Windows_NT" ]; then \
        powershell -Command "& {$(foreach p,$(LOCK_PATTERNS), icacls $(p) /inheritance:r /grant:r *S-1-1-0:R;)}" \
    fi

unlock:
    @$(foreach p,$(LOCK_PATTERNS), \
        ( test -e $(p) && chmod -R u+w $(p) || true ); \
    )
    @if [ "$$(uname)" = "Linux" ]; then \
        $(foreach p,$(LOCK_PATTERNS), sudo chattr -R -i $(p);) \
    fi
    @if [ "$$(OS)" = "Windows_NT" ]; then \
        powershell -Command "& {$(foreach p,$(LOCK_PATTERNS), icacls $(p) /grant *S-1-1-0:RW;)}" \
    fi
```

- 单条命令即可切换
- S-1-1-0 代表 Everyone，保证脚本无需域账户

## 四、Git 钩子防线（语言无关）

### .pre-commit-config.yaml 配置

```yaml
repos:
- repo: local
  hooks:
  - id: protect-locked-files
    name: Protect locked files
    entry: bash hooks/check_locked.sh
    language: system
    stages: [commit]
```

### hooks/check_locked.sh（核心逻辑）

```bash
#!/usr/bin/env bash
protected_regex='\.env$|^services/.*\.ya?ml$|^scripts/deploy/'
if git diff --cached --name-only | grep -E "$protected_regex" >/dev/null; then
  echo "⛔ Attempt to commit a locked file. Use make unlock first."
  exit 1
fi
```

## 五、容器/远程开发场景

### devcontainer.json 配置

```json
{
  "mounts": [
    "source=${localEnv:HOME}/project/services,target=/workspaces/project/services,readonly,type=bind"
  ],
  "postCreateCommand": "make lock"
}
```

只读挂载让容器内 AI 仍能解析 YAML，但写入会直接抛错。同理，Kubernetes emptyDir + subPath 也支持 readOnly: true。

## 六、IDE/Agent 级封锁

### VS Code Copilot File Lock
官方 Issue #7786 描述了即将发布的读-写分离能力，可等待正式版。

### 自研扩展思路
1. 在 extension.activate 读取 .ailock（gitignore-style glob）
2. workspace.onWillSaveTextDocument 拦截写操作，若命中则 event.waitUntil(Promise.reject())
3. 显示状态栏 "🔒 Locked"
4. 提供命令 Unlock File → 临时放开并写 .ailock.session

该方案仅影响 VS Code，但胜在跨 Windows/Mac/Linux 一致；其他编辑器可社区适配。

## 七、组合落地蓝图

```
repo/
├─ .ailock                    # 与 .gitignore 同语法
├─ .pre-commit-config.yaml
├─ Makefile                   # lock / unlock
├─ hooks/
│  └─ check_locked.sh
├─ .devcontainer/
│  └─ devcontainer.json
└─ .vscode/
   └─ extensions.json         # 推荐安装自研 File-Lock 扩展
```

### 工作流程
1. 开发者克隆仓库 → git hooks & pre-commit 自动安装
2. 首次 `make lock` → OS 级别加只读位；CI 仍可读取变量
3. AI Agent 读取：受保护文件可被解析；任何写尝试即时失败（OS/IDE 双保险）
4. 需修改时 → `make unlock`（或右键 Unlock）→ 改 → `make lock` → commit
5. CI/合并：LFS lock + 受保护分支，防止绕过本地钩子强推

## 八、维护与陷阱

| 场景 | 风险 | 化解 |
|------|------|------|
| NTFS(Win) + WSL | chattr 无效 | 走 icacls |
| 非 ext/APFS File System | 无 immutable 位 | 退回 ACL/只读位 |
| merge=ours 不触发 | 无冲突覆盖 | 再加 pre-commit 钩子 |
| LFS 锁未同步 | Push 临时失效 | LFS server 侧开启"严格锁" |
| IDE 缓存 | 插件保存绕过 FS | IDE 扩展拦截 |

## 九、推荐决策

1. **单人或小团队**：chmod -w/chattr +i + pre-commit 钩子即可，20 min 落地
2. **跨平台**：用 Makefile/PowerShell 包装同一套命令；Windows 走 icacls
3. **容器化开发**：在 dev-container 挂载层实现只读，进一步隔离
4. **多人协作**：引入 Git LFS lock 或服务器端保护分支
5. **深度 AI Agent 工作流**：监控 VS Code File Lock 正式版，或自研轻量扩展

## 十、技术优势

- **零守护进程**：充分复用操作系统权限、Git hook 与 IDE API
- **跨平台一致**：统一的 make lock/unlock 接口
- **渐进增强**：从基础 OS 锁开始，按需添加高级防护
- **生态友好**：兼容 pre-commit、VS Code、容器等主流工具链

这样做达到了"AI 可读/不可写"的目标，并兼顾多平台、一键锁解、容器一致性与未来扩展。