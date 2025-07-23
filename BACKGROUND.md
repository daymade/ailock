# AI-Proof File Guard 项目背景

## 一、VS Code File Lock 机制的兴衰

### 结论先行

- **File Lock / chatReadonlyPromptReference 机制已被正式移除**：2025-03-04 合并的 PR #242610 (f9e0715) 把整个 API 提案及相关实现删掉。维护者 @connor4312 在提交说明里直言："We haven't found a use case that resonates here, and this got a bit broken with recent working set refactors."

- 在随后对社区反馈的解释中，VS Code 团队补充："We had this in Insiders for a couple months but never saw much community interest in it, so we removed it." —— 摘自同一讨论串（已被 GitHub 折叠，但仍可在完整 diff/patch 中查看）。

- **结果**：最新版 VS Code（≥ 1.99）和 Copilot Chat 预览版都会在控制台抛出 "chatReadonlyPromptReference proposal does not exist" 的警告，见 Issue #245932。

### 时间线

| 日期 | 事件 | 说明 |
|------|------|------|
| 2024-Q4 | VS Code Insiders 内测 File Lock UI + API chatReadonlyPromptReference | 允许扩展声明"只读"附件、阻止编辑器/Agent 写入 |
| 2025-03-04 | PR #242610 合并，彻底删除提案代码 | 13 个文件 73 行被移除 |
| 2025-04-08 | 社区陆续报错：扩展请求不存在的 API | VS Code 在启动日志中发出 WARN |
| 2025-04-13 | 开发者提交 Copilot 侧功能需求 Issue #7786 | 要求恢复/支持"Lock file"来防 AI 误改 |

### 维护者给出的撤回原因

| 源自 | 关键表述 | 含义 |
|------|----------|------|
| 提交消息 | "We haven't found a use case that resonates here." | 缺乏足够多的真实场景驱动 |
| 评论补充 | "We had this in Insiders for a couple months but never saw much community interest..." | 内测阶段社区互动少，价值不足 |
| 技术层面 | "...got a bit broken with recent working-set refactors." | VS Code Chat/Agent 架构 refactor 后兼容成本增大 |

**可推论**：团队在功能-投入比、架构演进以及与企业版 Copilot 权限沙箱策略之间权衡后，暂时放弃这一浅层 IDE 锁方案，转而建议使用文件系统 ACL + Git 钩子等通用机制。

### 对用户和扩展作者意味着什么

1. **警告可安全忽略**
   - 日志中的 chatReadonlyPromptReference WARN 并不影响普通功能；若想消除，需等待各扩展（主要是 Copilot Chat 预览版）升级 manifest。

2. **IDE 级"只读锁"短期不会回归**
   - 需求仍在 Copilot Release 仓库排队（标记 Backlog），但官方目前倾向观望社区呼声。

3. **现阶段替代方案**
   - OS 只读/immutable 位（chmod -w / chattr +i / attrib +R 等）
   - Git pre-commit 或 LFS lock 防推送
   - 容器 / dev-container 只读挂载
   - 自研 VS Code 扩展：利用 onWillSaveTextDocument 拦截写入（与已废弃 API 无关，纯走 Extension API）

### 下一步关注

- 继续在 Issue #7786 跟踪需求优先级变化；如果点赞/订阅人数显著增加，官方可能重新评估。
- 一旦 VS Code Chat Agent 模块稳定，可能会重新设计更通用的"文件访问策略"API（与多租户、远程容器、云端 Workspace 统一兼容）。

## 二、需求分析：是否值得做？

### 风险场景评估

| 风险场景 | 发生频率 | 现有缓解手段 | 是否必须新增机制 |
|----------|----------|--------------|------------------|
| AI 在 Agent/Rewrite 模式下无提示地重写敏感文件（.env、脚本、Service 模板等） | 中等──只在使用 Copilot Agent/Claude Code "apply" 这类自动写盘功能时会触发 | ① 将文件设为只读/immutable<br>② 在 Git 层禁止提交<br>③ 编辑器弹窗二次确认 | ⚠️ "高价值、低成本"的防护仍然缺位，可考虑补上 |
| 普通手误（人或 AI）改动后误提交 | 高 | Pre-commit/CI 保护 | 不需要再造轮子 |

**结论**：
- 有必要加一道"AI 可读但只读"保护，尤其当频繁让 Agent 自动批量改代码时。
- 但并不一定要实现一个全新的 .ailock + 守护进程体系；生态里已有 3 层成熟方案可以按需组合。

## 三、现有解决方案分析

### 三层防护方案对比

| 层级 | 做法 | 能否满足"AI 可读但不可写" | 代价/盲区 |
|------|------|---------------------------|-----------|
| **操作系统** | chmod -w; Linux chattr +i; Windows attrib +R | ✅ 进程级别阻止写入；AI 读取不受限 | 需要手动或脚本切换；chattr +i 完全锁死，编辑前得先 -i |
| **版本控制** | Git hook/pre-commit 框架在提交前拒绝 diff 命中受保护路径 | ✅ 防止污染仓库；IDE 里仍可预览文件 | 只能"事后拦截"，本地文件仍可能被覆盖 |
| **Git 索引位** | git update-index --skip-worktree <path> | ⚠️ 部分有效：Git 忽视变更，但文件仍可被 AI 写坏；某些操作会清掉标志 |
| **协作锁** | Git LFS lock, .gitattributes merge=ours | ✅ 多人协作时避免冲突 | 需要 LFS 服务器或自定义驱动，门槛高 |
| **IDE/AI 插件层** | VS Code 即将内置 Copilot File Lock（Issue #7786），Cursor 仅支持 .cursorignore"完全忽略" | 未来可选；目前尚未发布 | 尚无正式发布版本 |

## 四、推荐实现路径

### 4.1 最小可行组合（单机开发）

1. **定义受保护文件模式**
```bash
# 在仓库根新增 ailock.patterns
PROTECTED_PATTERNS=(
  ".env"
  "services/**/*.yaml"
  "scripts/deploy/**"
)
```

2. **一次性为受保护文件加 OS 只读位**
```bash
# macOS / Linux
for p in "${PROTECTED_PATTERNS[@]}"; do
  chmod -R a-w "$p"        # 最轻量
  # 或 sudo chattr +i "$p"  # 完全不可改
done
```

3. **安装 pre-commit 钩子防提交**
`.pre-commit-config.yaml`:
```yaml
repos:
  - repo: local
    hooks:
      - id: forbid-ailock-change
        name: forbid-ailock-change
        entry: bash check-ailock.sh
        language: system
```

`check-ailock.sh` 对 `git diff --cached --name-only` 做匹配，命中即 `exit 1` 阻断提交。

4. **临时编辑流程**
   - `chmod +w filename` ➜ 修改 ➜ `chmod -w filename`
   - 或写一个 `make unlock` / `make lock` 快捷命令

### 4.2 多人协作/CI 场景

| 场景 | 补充措施 |
|------|----------|
| 团队多人并行 | 使用 Git LFS lockable 属性 + git lfs lock 提前占锁 |
| 复杂合并流 | 在 .gitattributes 针对受保护文件添加 merge=ours，强制保留本支修改 |
| 容器化 dev-container | 将受保护目录挂载为 :ro（只读卷） |
| AI Agent 仍有覆盖风险 | 等待 VS Code Copilot "File Lock" 功能正式落地，或自行写 VS Code 扩展 |

## 五、为什么需要 AI-Proof File Guard？

### 核心价值主张

1. **填补空白**：VS Code 官方撤回了 File Lock 功能，但需求仍然存在
2. **轻量实用**：不重复造轮子，基于现有工具链组合实现
3. **跨平台一致**：提供统一的 CLI 接口，屏蔽平台差异
4. **渐进增强**：从基础 OS 锁开始，逐步支持 Git hook、IDE 插件等高级特性

### 设计理念

- **最小化原则**：20 分钟内可落地的 MVP
- **组合优于创造**：调用现有工具链，避免新守护进程带来的跨平台和资源成本
- **开放扩展**：支持与 pre-commit、detect-secrets 等工具集成
- **面向未来**：为 VS Code 官方 File Lock 功能预留升级路径

## 六、综合结论

1. **立即行动**：先用 OS 只读属性 + Git hook，20 分钟内即可落地；满足"AI 可读但不可写"
2. **标准化流程**：借助 pre-commit 框架集中管理钩子，可扩展扫描 secrets 的 Hook
3. **轻量实现**：.ailock 作为团队约定，实现上调用现有工具链
4. **持续关注**：跟踪 Copilot Agent 的官方 File Lock 进展，发布后可直接升级享受 IDE 层保护

**AI-Proof File Guard 项目正是在这样的背景下诞生，旨在为开发者提供一个简单、可靠、跨平台的文件保护方案。**