import { resolve, basename, dirname } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { getRepoRoot } from './git.js';
import { gitRepoCache } from './git-cache.js';
import { ProjectUnit, ProjectType } from './user-config.js';

/**
 * Project detection and management utilities for the new quota system
 */

/**
 * Detect if a path belongs to a Git repository and return the repo root
 */
export async function detectGitRepository(filePath: string): Promise<{
  isGitRepo: boolean;
  repoRoot: string | null;
}> {
  try {
    const repoRoot = await getRepoRoot(filePath);
    return {
      isGitRepo: repoRoot !== null,
      repoRoot
    };
  } catch {
    return {
      isGitRepo: false,
      repoRoot: null
    };
  }
}

/**
 * Generate a display name for a project
 */
export function generateProjectName(rootPath: string, type: ProjectType): string {
  const baseName = basename(rootPath);
  
  // Special cases
  if (rootPath === '/') {
    return 'root';
  }
  
  // Home directory detection
  const homedir = require('os').homedir();
  if (homedir && rootPath === homedir) {
    return 'home';
  }
  
  // Sanitize special characters in project names
  const sanitized = baseName ? baseName.replace(/[^a-zA-Z0-9\-_\.]/g, '-').replace(/-+/g, '-') : 'Directory';
  
  // For Git repositories, use the directory name
  if (type === 'git') {
    return sanitized || 'Repository';
  }
  
  // For standalone directories, use a more descriptive name
  if (baseName && baseName.startsWith('.')) {
    // For hidden directories like ~/.config, show the parent context
    const parentName = basename(dirname(rootPath));
    return `${parentName}/${sanitized}`.replace(/^\//, '');
  }
  
  return sanitized;
}

/**
 * Create a new ProjectUnit from a file path
 */
export async function createProjectFromPath(
  filePath: string,
  existingProject?: ProjectUnit
): Promise<ProjectUnit> {
  const normalizedPath = resolve(filePath);
  
  // Check if this is a file or directory
  const isDirectory = existsSync(normalizedPath) && 
    require('fs').statSync(normalizedPath).isDirectory();
  
  // Try to detect if this is part of a Git repository
  const gitInfo = await detectGitRepository(normalizedPath);
  
  let rootPath: string;
  let type: ProjectType;
  let relativePath: string;
  
  if (gitInfo.isGitRepo && gitInfo.repoRoot) {
    rootPath = gitInfo.repoRoot;
    type = 'git';
    // Calculate relative path from repo root
    relativePath = isDirectory ? '.' : 
      require('path').relative(gitInfo.repoRoot, normalizedPath);
  } else {
    // For non-git paths
    if (isDirectory) {
      rootPath = normalizedPath;
      relativePath = '.';
    } else {
      rootPath = dirname(normalizedPath);
      relativePath = basename(normalizedPath);
    }
    type = 'directory';
  }
  
  const projectName = generateProjectName(rootPath, type);
  
  // If we have an existing project, merge with it
  if (existingProject) {
    const protectedPaths = [...existingProject.protectedPaths];
    if (!protectedPaths.includes(relativePath)) {
      protectedPaths.push(relativePath);
    }
    
    return {
      ...existingProject,
      protectedPaths,
      lastAccessedAt: new Date()
    };
  }
  
  return {
    id: randomUUID(),
    rootPath,
    type,
    name: projectName,
    protectedPaths: [relativePath],
    createdAt: new Date(),
    lastAccessedAt: new Date()
  };
}

/**
 * Find the project root for a given file path
 * Returns the Git repository root if in a repo, otherwise the file's directory
 */
export async function findProjectRoot(filePath: string): Promise<string> {
  const normalizedPath = resolve(filePath);
  
  // Check if this is a directory
  const isDirectory = existsSync(normalizedPath) && 
    require('fs').statSync(normalizedPath).isDirectory();
  
  // Try to detect Git repository
  const gitInfo = await detectGitRepository(normalizedPath);
  
  if (gitInfo.isGitRepo && gitInfo.repoRoot) {
    return gitInfo.repoRoot;
  }
  
  // For non-git paths, return the directory itself or parent directory
  return isDirectory ? normalizedPath : dirname(normalizedPath);
}

/**
 * Check if a file path belongs to an existing project
 */
export async function findMatchingProject(filePath: string, projects: ProjectUnit[]): Promise<ProjectUnit | null> {
  const normalizedPath = resolve(filePath);
  
  // First, find the project root for this path
  const projectRoot = await findProjectRoot(filePath);
  
  // Look for a project with matching root
  return projects.find(project => project.rootPath === projectRoot) || null;
}

/**
 * Check if two paths belong to the same project
 */
export async function belongsToSameProject(path1: string, path2: string): Promise<boolean> {
  const [root1, root2] = await Promise.all([
    findProjectRoot(path1),
    findProjectRoot(path2)
  ]);
  
  return root1 === root2;
}

/**
 * Filter out temp/test directories from a list of paths
 * This helps clean up quota counting by ignoring temporary directories
 */
export function filterTempDirectories(paths: string[]): string[] {
  const tempPatterns = [
    /^\/tmp\//,
    /^\/var\/tmp\//,
    /\/AppData\/Local\/Temp\//,
    /\/Temp\//,
    /\\Temp\\/,
    /node_modules\//,
    /\.git\//,
    /\.cache\//,
    /dist\//,
    /build\//,
    /coverage\//
  ];
  
  return paths.filter(path => {
    // Skip null/undefined paths
    if (!path) {
      return false;
    }
    
    // Skip obvious system temp directories
    if (path === '/tmp' || path === '/var/tmp' || path.startsWith('/tmp/') || path.startsWith('/var/tmp/')) {
      return false;
    }
    
    // Skip MacOS temp directories but allow our test directories
    if (path.includes('/var/folders/') && !path.includes('ailock-test')) {
      return false;
    }
    
    return !tempPatterns.some(pattern => pattern.test(path));
  });
}

/**
 * Validate that a project root path is legitimate (not temp/test)
 */
export function isValidProjectRoot(rootPath: string): boolean {
  // Check system directories
  const systemPaths = [
    '/',
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/var',
    '/tmp',
    '/System',
    'C:\\',
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ];
  
  if (systemPaths.includes(rootPath)) {
    return false;
  }
  
  // Check if it's filtered out by temp directory filter
  const filtered = filterTempDirectories([rootPath]);
  if (filtered.length === 0) {
    return false;
  }
  
  // Check if path exists
  return existsSync(rootPath);
}

/**
 * Clean up and consolidate project paths
 * Removes duplicates and merges projects with the same root
 */
export function consolidateProjects(projects: ProjectUnit[]): ProjectUnit[] {
  const consolidated = new Map<string, ProjectUnit>();
  
  for (const project of projects) {
    const existing = consolidated.get(project.rootPath);
    
    if (existing) {
      // Merge protected paths, avoiding duplicates
      const allPaths = [...existing.protectedPaths, ...project.protectedPaths];
      existing.protectedPaths = [...new Set(allPaths)];
      
      // Keep the earlier creation date
      if (project.createdAt < existing.createdAt) {
        existing.createdAt = project.createdAt;
      }
      
      // Update last accessed time to the latest
      if (project.lastAccessedAt && (!existing.lastAccessedAt || project.lastAccessedAt > existing.lastAccessedAt)) {
        existing.lastAccessedAt = project.lastAccessedAt;
      }
    } else {
      consolidated.set(project.rootPath, { ...project });
    }
  }
  
  return Array.from(consolidated.values())
    .filter(project => isValidProjectRoot(project.rootPath))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Generate a user-friendly project display path
 */
export function getProjectDisplayPath(projectPath: string): string {
  const homedir = require('os').homedir();
  
  if (homedir && projectPath.startsWith(homedir)) {
    return projectPath.replace(homedir, '~');
  }
  
  return projectPath;
}

/**
 * Get project statistics for display
 */
export function getProjectStats(projects: ProjectUnit[]): {
  total: number;
  gitProjects: number;
  directoryProjects: number;
  totalProtectedPaths: number;
} {
  return {
    total: projects.length,
    gitProjects: projects.filter(p => p.type === 'git').length,
    directoryProjects: projects.filter(p => p.type === 'directory').length,
    totalProtectedPaths: projects.reduce((sum, p) => sum + p.protectedPaths.length, 0)
  };
}