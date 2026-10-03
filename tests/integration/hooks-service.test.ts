import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HooksService,
  createShellCommand,
} from "../../src/services/HooksService.js";
import { existsSync } from "fs";
import { chmod, cp, readFile, rm, mkdir, writeFile } from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

describe("HooksService Integration", () => {
  let service: HooksService;
  const testDir = path.resolve("./tinkle_test-hooks-tmp");
  const claudeDir = path.join(testDir, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  beforeEach(async () => {
    service = new HooksService();
    // Create test directory
    await mkdir(testDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("detectClaudeCode", () => {
    it("treats CLAUDE_PROJECT_DIR as project scope before settings exist", () => {
      const originalProjectDir = process.env.CLAUDE_PROJECT_DIR;
      try {
        process.env.CLAUDE_PROJECT_DIR = testDir;
        const result = service.detectClaudeCode();

        expect(result.detected).toBe(true);
        expect(result.projectDir).toBe(testDir);
        expect(result.settingsPath).toBe(settingsPath);
        expect(result.isProjectLevel).toBe(true);
      } finally {
        if (originalProjectDir === undefined) {
          delete process.env.CLAUDE_PROJECT_DIR;
        } else {
          process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
        }
      }
    });
  });

  describe("findAilockInstallation", () => {
    it("should find the development installation deterministically", async () => {
      const originalProjectDir = process.env.CLAUDE_PROJECT_DIR;
      try {
        await mkdir(path.join(testDir, "dist"), { recursive: true });
        await writeFile(path.join(testDir, "dist/index.js"), "");
        process.env.CLAUDE_PROJECT_DIR = testDir;

        const result = await service.findAilockInstallation();

        expect(result).toBe(`node ${path.join(testDir, "dist/index.js")}`);
      } finally {
        if (originalProjectDir === undefined) {
          delete process.env.CLAUDE_PROJECT_DIR;
        } else {
          process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
        }
      }
    });

    it("should fail when no local or global installation exists", async () => {
      const originalProjectDir = process.env.CLAUDE_PROJECT_DIR;
      const originalPath = process.env.PATH;
      try {
        const emptyProjectDir = path.join(testDir, "empty-project");
        await mkdir(emptyProjectDir, { recursive: true });
        process.env.CLAUDE_PROJECT_DIR = emptyProjectDir;
        process.env.PATH = "";

        await expect(service.findAilockInstallation()).rejects.toThrow(
          "Ailock executable not found",
        );
      } finally {
        if (originalProjectDir === undefined) {
          delete process.env.CLAUDE_PROJECT_DIR;
        } else {
          process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
        }
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
      }
    });
  });

  describe("getHookStatus", () => {
    it("should return status for claude", async () => {
      const status = await service.getHookStatus("claude");

      expect(status).toBeDefined();
      expect(typeof status.installed).toBe("boolean");
    });

    it("should handle unsupported tools", async () => {
      const status = await service.getHookStatus("unsupported-tool");

      expect(status.installed).toBe(false);
      expect(status.error).toContain("not supported");
    });
  });

  describe("getSupportedTools", () => {
    it("should return list of supported tools", () => {
      const tools = service.getSupportedTools();

      expect(tools).toContain("claude");
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe("installClaudeHooks and uninstallClaudeHooks", () => {
    it("executes a hook command when the script path contains spaces", async () => {
      const hookPath = path.join(
        testDir,
        "package prefix with spaces",
        "hook.js",
      );
      await mkdir(path.dirname(hookPath), { recursive: true });
      await writeFile(hookPath, 'console.log("hook-ran");\n');

      const result = spawnSync(
        createShellCommand(process.execPath, [hookPath]),
        {
          shell: true,
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("hook-ran");
    });

    it("keeps the packaged legacy installer shell-safe for paths with spaces", async () => {
      if (process.platform === "win32") return;

      const packageRoot = path.join(
        testDir,
        "legacy package prefix with spaces",
      );
      const projectRoot = path.join(testDir, "legacy project");
      const fakeBin = path.join(testDir, "bin");
      const fakeAilock = path.join(fakeBin, "ailock");
      await cp(path.resolve("hooks"), path.join(packageRoot, "hooks"), {
        recursive: true,
      });
      await mkdir(projectRoot, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(fakeAilock, "#!/bin/sh\nexit 0\n");
      await chmod(fakeAilock, 0o755);
      await writeFile(path.join(projectRoot, "locked.txt"), "locked");
      await chmod(path.join(projectRoot, "locked.txt"), 0o444);

      const install = spawnSync(
        "bash",
        [path.join(packageRoot, "hooks", "install.sh")],
        {
          cwd: projectRoot,
          input: "1\n",
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
          },
        },
      );
      expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);

      const settings = JSON.parse(
        await readFile(
          path.join(projectRoot, ".claude", "settings.json"),
          "utf8",
        ),
      );
      const command = settings.hooks.PreToolUse[0].hooks[0].command;
      const locked = spawnSync(command, {
        cwd: projectRoot,
        shell: true,
        input: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: path.join(projectRoot, "locked.txt") },
          cwd: projectRoot,
        }),
        encoding: "utf8",
      });
      const malformed = spawnSync(command, {
        cwd: projectRoot,
        shell: true,
        input: "{ invalid json }",
        encoding: "utf8",
      });

      expect(locked.status).toBe(0);
      expect(
        JSON.parse(locked.stdout).hookSpecificOutput.permissionDecision,
      ).toBe("deny");
      expect(malformed.status).toBe(2);
      expect(malformed.stdout).toBe("");
    });

    it("should install and uninstall hooks", async () => {
      // Create mock settings
      await writeFile(settingsPath, JSON.stringify({ model: "opus" }));

      const mockInfo = {
        detected: true,
        settingsPath,
        isProjectLevel: true,
      };

      // Skip if hook script doesn't exist (in test environment)
      const hookScriptPath = path.resolve("hooks/claude-ailock-hook.js");
      if (!existsSync(hookScriptPath)) {
        console.log("Skipping install test - hook script not found");
        return;
      }

      // Test installation
      await service.installClaudeHooks(mockInfo);

      // Settings should be updated
      expect(existsSync(settingsPath)).toBe(true);

      // Test uninstallation
      await service.uninstallClaudeHooks(mockInfo);

      // Settings file should still exist but without ailock hooks
      expect(existsSync(settingsPath)).toBe(true);
    });
  });
});


describe("AILock registration ownership and budgets", () => {
  const root = path.resolve("./tinkle_ailock-registration-ownership");
  const file = path.join(root, "settings.json");
  const exact = createShellCommand(process.execPath, [path.resolve("hooks/claude-ailock-hook.js")]);
  const owned = { type: "command", command: exact, timeout: 5000 };
  const unrelated = { type: "command", command: "echo unrelated", timeout: 8, env: { FIXTURE: "synthetic" }, if: "Bash(pwd)" };
  beforeEach(async () => { await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function install(doc: unknown) {
    await writeFile(file, JSON.stringify(doc));
    const service = new HooksService();
    await service.installClaudeHooks({ detected: true, settingsPath: file });
    return JSON.parse(await readFile(file, "utf8"));
  }
  it("repairs only the exact handler budget in a mixed group and keeps all metadata", async () => {
    const group = { matcher: "Write|Edit|MultiEdit|NotebookEdit", name: "fixture group", if: "Write(*)", hooks: [owned, unrelated] };
    const initial = { env: { FIXTURE_VALUE: "fake" }, custom: { keep: true }, hooks: { PreToolUse: [group], Stop: [{ hooks: [unrelated] }] } };
    const actual = await install(initial);
    expect(actual).toEqual({ ...initial, hooks: { ...initial.hooks, PreToolUse: [{ ...group, hooks: [{ ...owned, timeout: 5 }, unrelated] }] } });
    const first = await readFile(file, "utf8");
    await new HooksService().installClaudeHooks({ detected: true, settingsPath: file });
    expect(await readFile(file, "utf8")).toBe(first);
  });
  it("finds an exact AILock handler after an unrelated first handler", async () => {
    const group = { matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [unrelated, { ...owned, env: { FIXTURE: "retain" }, statusMessage: "fixture" }] };
    const actual = await install({ hooks: { PreToolUse: [group] } });
    expect(actual.hooks.PreToolUse).toEqual([{ ...group, hooks: [unrelated, { ...group.hooks[1], timeout: 5 }] }]);
  });
  it("does not deduplicate unrelated groups or basename/text mentions", async () => {
    const groups = [
      { matcher: "Write", hooks: [unrelated] },
      { matcher: "Edit", name: "other", hooks: [unrelated] },
      { matcher: "Write", hooks: [{ type: "command", command: "echo claude-ailock-hook.js" }] },
      { matcher: "Write", hooks: [{ type: "command", command: "node /other-package/hooks/claude-ailock-hook.js", timeout: 7 }] },
    ];
    const actual = await install({ hooks: { PreToolUse: groups } });
    expect(actual.hooks.PreToolUse.slice(0, groups.length)).toEqual(groups);
    expect(actual.hooks.PreToolUse).toHaveLength(groups.length + 1);
    expect(actual.hooks.PreToolUse.at(-1).hooks[0].timeout).toBe(5);
  });
  it.each([null, [], { hooks: null }, { hooks: [] }, { hooks: { PreToolUse: null } }, { hooks: { PreToolUse: {} } }, { hooks: { PreToolUse: [{ hooks: null }] } }])("rejects unknown settings shape without overwriting: %j", async (doc) => {
    const raw = JSON.stringify(doc); await writeFile(file, raw);
    await expect(new HooksService().installClaudeHooks({ detected: true, settingsPath: file })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(raw);
  });
  it("rejects malformed settings JSON without overwriting", async () => {
    const raw = '{"env":{"FIXTURE":"fake"}, malformed}'; await writeFile(file, raw);
    await expect(new HooksService().installClaudeHooks({ detected: true, settingsPath: file })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(raw);
  });
  it("uses seconds consistently in the static template and service", async () => {
    const actual = await install({ hooks: {} });
    const template = JSON.parse(await readFile(path.resolve("hooks/claude-settings.json"), "utf8"));
    expect(actual.hooks.PreToolUse[0].hooks[0].timeout).toBe(5);
    expect(template.hooks.PreToolUse[0].hooks[0].timeout).toBe(5);
  });
});

describe('exact AILock registration consumers', () => {
  const root = path.resolve('./tinkle_ailock-exact-consumers');
  const file = path.join(root,'.claude/settings.json');
  const exact = createShellCommand(process.execPath,[path.resolve('hooks/claude-ailock-hook.js')]);
  beforeEach(async()=>{await mkdir(path.dirname(file),{recursive:true});});
  afterEach(async()=>{await rm(root,{recursive:true,force:true});});
  it('reads status anywhere in mixed groups and uninstalls only the owned handler',async()=>{
    const other={type:'command',command:'echo claude-ailock-hook.js',timeout:17};
    const original={env:{FIXTURE:'fake'},hooks:{PreToolUse:[{matcher:'Write',name:'keep',hooks:[other,{type:'command',command:exact,timeout:5000}]},{matcher:'Edit',hooks:[{type:'command',command:'node /other/claude-ailock-hook.js'}]},{matcher:'*',hooks:[]}]}};
    await writeFile(file,JSON.stringify(original));
    const service=new HooksService();
    const previous=process.env.CLAUDE_PROJECT_DIR;
    try{
      process.env.CLAUDE_PROJECT_DIR=root;
      await service.installClaudeHooks({detected:true,settingsPath:file});
      expect(await service.getHookStatus('claude')).toMatchObject({installed:true,hookCount:1});
      await service.uninstallClaudeHooks({detected:true,settingsPath:file});
      const actual=JSON.parse(await readFile(file,'utf8'));
      expect(actual).toEqual({...original,hooks:{PreToolUse:[{...original.hooks.PreToolUse[0],hooks:[other]},...original.hooks.PreToolUse.slice(1)]}});
      expect(await service.getHookStatus('claude')).toMatchObject({installed:false,hookCount:0});
      const bytes=await readFile(file,'utf8');await service.uninstallClaudeHooks({detected:true,settingsPath:file});expect(await readFile(file,'utf8')).toBe(bytes);
    }finally{if(previous===undefined)delete process.env.CLAUDE_PROJECT_DIR;else process.env.CLAUDE_PROJECT_DIR=previous;}
  });
  it('keeps custom group metadata even when its last owned handler is removed',async()=>{
    const group={matcher:'Write',name:'retain-empty-group',if:'Write(*)',hooks:[{type:'command',command:exact}]};
    await writeFile(file,JSON.stringify({hooks:{PreToolUse:[group]}}));
    await new HooksService().uninstallClaudeHooks({detected:true,settingsPath:file});
    expect(JSON.parse(await readFile(file,'utf8'))).toEqual({hooks:{PreToolUse:[{...group,hooks:[]}]}});
  });
  it.each(['not json','null','{"hooks":null}','{"hooks":{"PreToolUse":null}}'])('uninstall rejects unknown JSON without overwrite: %s',async raw=>{
    await writeFile(file,raw);await expect(new HooksService().uninstallClaudeHooks({detected:true,settingsPath:file})).rejects.toThrow();expect(await readFile(file,'utf8')).toBe(raw);
  });
});

describe('legacy installer exact budget repair',()=>{
  const root=path.resolve('./tinkle_ailock-legacy-budget');
  beforeEach(async()=>{await mkdir(root,{recursive:true});});
  afterEach(async()=>{await rm(root,{recursive:true,force:true});});
  it('repairs a mixed exact handler, preserves variants, and refuses unknown JSON',async()=>{
    if(process.platform==='win32')return;
    const home=path.join(root,'home'),pkg=path.join(root,'package with spaces'),project=path.join(root,'project'),bin=path.join(root,'bin');
    await cp(path.resolve('hooks'),path.join(pkg,'hooks'),{recursive:true});await mkdir(home);await mkdir(project);await mkdir(bin);
    await writeFile(path.join(bin,'ailock'),'#!/bin/sh\nexit 0\n');await chmod(path.join(bin,'ailock'),0o755);
    const file=path.join(project,'.claude/settings.json');await mkdir(path.dirname(file));
    const exact=createShellCommand(process.execPath,[path.join(pkg,'hooks/claude-ailock-hook.js')]);
    const other={type:'command',command:'echo claude-ailock-hook.js',timeout:19};
    const group={matcher:'Write',name:'preserve',hooks:[other,{type:'command',command:exact,timeout:5000,env:{FIXTURE:'fake'}}]};
    const initial={env:{FIXTURE_VALUE:'fake'},hooks:{PreToolUse:[group,{matcher:'Edit',hooks:[other]}],Stop:[{hooks:[other]}]}};
    await writeFile(file,JSON.stringify(initial));
    const run=()=>spawnSync('bash',[path.join(pkg,'hooks/install.sh')],{cwd:project,input:'1\n',encoding:'utf8',timeout:5000,env:{...process.env,HOME:home,PATH:`${bin}:${process.env.PATH}`}});
    const first=run();expect(first.status,first.stdout+first.stderr).toBe(0);
    expect(JSON.parse(await readFile(file,'utf8'))).toEqual({...initial,hooks:{...initial.hooks,PreToolUse:[{...group,hooks:[other,{...group.hooks[1],timeout:5}]},initial.hooks.PreToolUse[1]]}});
    const bytes=await readFile(file,'utf8');expect(run().status).toBe(0);expect(await readFile(file,'utf8')).toBe(bytes);
    for(const invalid of ['not json','null','{"hooks":null}','{"hooks":{"PreToolUse":null}}']){
      await writeFile(file,invalid);expect(run().status).not.toBe(0);expect(await readFile(file,'utf8')).toBe(invalid);
    }
  });
});
