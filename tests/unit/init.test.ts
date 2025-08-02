import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const TEST_DIR = path.join(__dirname, '../../test-projects');
const NODE_PROJECT_DIR = path.join(TEST_DIR, 'node-project');
const DOCKER_PROJECT_DIR = path.join(TEST_DIR, 'docker-project');
const GENERIC_PROJECT_DIR = path.join(TEST_DIR, 'generic-project');

describe('init command', () => {
  beforeEach(() => {
    // Clean up any existing test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('project detection', () => {
    it('should detect Node.js project', () => {
      // Create Node.js project structure
      mkdirSync(NODE_PROJECT_DIR, { recursive: true });
      writeFileSync(path.join(NODE_PROJECT_DIR, 'package.json'), JSON.stringify({
        name: 'test-project',
        version: '1.0.0'
      }));
      writeFileSync(path.join(NODE_PROJECT_DIR, '.env'), 'API_KEY=test-key');

      // Run init --config-only
      const result = execSync(
        `cd "${NODE_PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Node.js project');
      expect(existsSync(path.join(NODE_PROJECT_DIR, '.ailock'))).toBe(true);
      
      const ailockContent = require('fs').readFileSync(
        path.join(NODE_PROJECT_DIR, '.ailock'),
        'utf-8'
      );
      expect(ailockContent).toContain('Generated for: Node.js project');
      expect(ailockContent).toContain('.env');
      expect(ailockContent).toContain('config/*.json');
    });

    it('should detect Docker project', () => {
      // Create Docker project structure
      mkdirSync(DOCKER_PROJECT_DIR, { recursive: true });
      writeFileSync(path.join(DOCKER_PROJECT_DIR, 'docker-compose.yml'), 'version: "3.8"');
      writeFileSync(path.join(DOCKER_PROJECT_DIR, '.env'), 'DATABASE_URL=test-url');

      // Run init --config-only
      const result = execSync(
        `cd "${DOCKER_PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Docker project');
      expect(existsSync(path.join(DOCKER_PROJECT_DIR, '.ailock'))).toBe(true);
      
      const ailockContent = require('fs').readFileSync(
        path.join(DOCKER_PROJECT_DIR, '.ailock'),
        'utf-8'
      );
      expect(ailockContent).toContain('Generated for: Docker project');
      expect(ailockContent).toContain('docker-compose.yml');
      expect(ailockContent).toContain('k8s/**/*.yaml');
    });

    it('should default to Generic project when no specific files found', () => {
      // Create generic project structure
      mkdirSync(GENERIC_PROJECT_DIR, { recursive: true });
      writeFileSync(path.join(GENERIC_PROJECT_DIR, '.env'), 'SECRET=test-secret');

      // Run init --config-only
      const result = execSync(
        `cd "${GENERIC_PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Generic project');
      expect(existsSync(path.join(GENERIC_PROJECT_DIR, '.ailock'))).toBe(true);
      
      const ailockContent = require('fs').readFileSync(
        path.join(GENERIC_PROJECT_DIR, '.ailock'),
        'utf-8'
      );
      expect(ailockContent).toContain('Generated for: Generic project');
      expect(ailockContent).toContain('.env');
      expect(ailockContent).toContain('**/*.key');
    });
  });

  describe('configuration generation', () => {
    it('should create .ailock with correct patterns for detected project type', () => {
      mkdirSync(NODE_PROJECT_DIR, { recursive: true });
      writeFileSync(path.join(NODE_PROJECT_DIR, 'package.json'), '{}');

      execSync(
        `cd "${NODE_PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const ailockContent = require('fs').readFileSync(
        path.join(NODE_PROJECT_DIR, '.ailock'),
        'utf-8'
      );

      // Check for expected patterns
      expect(ailockContent).toContain('.env');
      expect(ailockContent).toContain('.env.*');
      expect(ailockContent).toContain('!.env.example');
      expect(ailockContent).toContain('**/*.key');
      expect(ailockContent).toContain('**/*.pem');
      expect(ailockContent).toContain('**/secrets.json');
      expect(ailockContent).toContain('config/*.json');
      expect(ailockContent).toContain('config/*.yaml');
    });
  });

  describe('error handling', () => {
    it('should not overwrite existing .ailock without --force', () => {
      mkdirSync(NODE_PROJECT_DIR, { recursive: true });
      writeFileSync(path.join(NODE_PROJECT_DIR, 'package.json'), '{}');
      writeFileSync(path.join(NODE_PROJECT_DIR, '.ailock'), 'existing content');

      const result = execSync(
        `cd "${NODE_PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('.ailock file already exists');
      
      const ailockContent = require('fs').readFileSync(
        path.join(NODE_PROJECT_DIR, '.ailock'),
        'utf-8'
      );
      expect(ailockContent).toBe('existing content');
    });

    it('should overwrite existing .ailock with --force', () => {
      mkdirSync(NODE_PROJECT_DIR, { recursive: true });
      writeFileSync(path.join(NODE_PROJECT_DIR, 'package.json'), '{}');
      writeFileSync(path.join(NODE_PROJECT_DIR, '.ailock'), 'existing content');

      const result = execSync(
        `cd "${NODE_PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only --force`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Node.js project');
      
      const ailockContent = require('fs').readFileSync(
        path.join(NODE_PROJECT_DIR, '.ailock'),
        'utf-8'
      );
      expect(ailockContent).toContain('Generated for: Node.js project');
      expect(ailockContent).not.toBe('existing content');
    });
  });
});