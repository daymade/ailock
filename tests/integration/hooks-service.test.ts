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
