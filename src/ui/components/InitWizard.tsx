import React, { useState, useEffect } from 'react';
import { Box, Text, Spacer } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

interface InitWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

interface ProjectTemplate {
  name: string;
  label: string;
  description: string;
  patterns: string[];
}

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    name: 'node',
    label: '📦 Node.js Project',
    description: 'Express, Nest.js, or other Node.js applications',
    patterns: [
      '.env',
      '.env.*',
      '!.env.example',
      'config/*.json',
      'config/*.yaml',
      '**/*.key',
      '**/*.pem',
      '**/secrets.json'
    ]
  },
  {
    name: 'docker',
    label: '🐳 Docker Project',
    description: 'Projects with Docker containers and orchestration',
    patterns: [
      '.env',
      '.env.*',
      '!.env.example',
      'docker-compose.yml',
      'docker-compose.*.yml',
      'Dockerfile.prod',
      'k8s/**/*.yaml',
      'config/*.yaml'
    ]
  },
  {
    name: 'web',
    label: '🌐 Web Application',
    description: 'React, Vue, Angular, or other web applications',
    patterns: [
      '.env',
      '.env.*',
      '!.env.example',
      '**/*.key',
      'public/config.json',
      'src/config/*.json',
      'firebase.json',
      'vercel.json'
    ]
  },
  {
    name: 'python',
    label: '🐍 Python Project',
    description: 'Django, Flask, FastAPI, or other Python applications',
    patterns: [
      '.env',
      '*.env',
      'settings/*.py',
      'config/*.yaml',
      'secrets.json',
      '**/*.key',
      '**/*.pem'
    ]
  },
  {
    name: 'custom',
    label: '⚙️  Custom Configuration',
    description: 'Define your own protection patterns',
    patterns: []
  }
];

type WizardStep = 'welcome' | 'template' | 'custom-patterns' | 'review' | 'complete';

export const InitWizard: React.FC<InitWizardProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [customPatterns, setCustomPatterns] = useState<string[]>([]);
  const [currentPattern, setCurrentPattern] = useState('');
  const [editingCustom, setEditingCustom] = useState(false);

  const [existingConfig, setExistingConfig] = useState<string | null>(null);

  useEffect(() => {
    // Check if .ailock already exists
    const ailockPath = '.ailock';
    if (existsSync(ailockPath)) {
      readFile(ailockPath, 'utf-8').then(content => {
        setExistingConfig(content);
      }).catch(() => {
        setExistingConfig(null);
      });
    }
  }, []);

  const handleWelcomeNext = () => {
    setStep('template');
  };

  const handleTemplateSelect = (template: ProjectTemplate) => {
    setSelectedTemplate(template);
    
    if (template.name === 'custom') {
      setStep('custom-patterns');
    } else {
      setStep('review');
    }
  };

  const handleAddCustomPattern = () => {
    if (currentPattern.trim()) {
      setCustomPatterns([...customPatterns, currentPattern.trim()]);
      setCurrentPattern('');
    }
  };

  const handleFinishCustom = () => {
    if (selectedTemplate) {
      selectedTemplate.patterns = customPatterns;
    }
    setStep('review');
  };

  const handleConfirmSetup = async () => {
    if (!selectedTemplate) return;

    try {
      // Generate .ailock content
      let content = `# AI-Proof File Guard Configuration\n`;
      content += `# Generated on ${new Date().toISOString()}\n`;
      content += `# Template: ${selectedTemplate.label}\n#\n`;
      content += `# This file uses gitignore-style syntax:\n`;
      content += `# - One pattern per line\n`;
      content += `# - # for comments\n`;
      content += `# - Supports glob patterns (**/*.ext, *.json, etc.)\n`;
      content += `# - ! for negation\n\n`;

      const patterns = selectedTemplate.patterns.length > 0 
        ? selectedTemplate.patterns 
        : customPatterns;

      for (const pattern of patterns) {
        if (pattern.startsWith('!')) {
          content += `${pattern}  # Negation pattern\n`;
        } else if (pattern.includes('*')) {
          content += `${pattern}  # Glob pattern\n`;
        } else {
          content += `${pattern}\n`;
        }
      }

      // Write .ailock file
      await writeFile('.ailock', content);
      
      setStep('complete');
      
      // Auto-complete after 2 seconds
      setTimeout(() => {
        onComplete();
      }, 2000);
      
    } catch (error) {
      console.error('Failed to create .ailock file:', error);
    }
  };

  if (step === 'welcome') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="blue">🚀 Welcome to AI-Proof File Guard Setup</Text>
        <Text></Text>
        
        <Text>This wizard will help you set up file protection for your project.</Text>
        <Text></Text>
        
        {existingConfig && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="yellow">⚠️  .ailock file already exists</Text>
            <Text color="gray">This wizard will overwrite your existing configuration.</Text>
            <Text></Text>
          </Box>
        )}
        
        <Text bold>What ailock does:</Text>
        <Text>• 🔒 Protects sensitive files from accidental AI modifications</Text>
        <Text>• 📖 Keeps files readable for AI analysis and context</Text>
        <Text>• 🛡️  Provides multi-layer protection (OS + Git hooks)</Text>
        <Text></Text>
        
        <Box>
          <Text color="green">Press Enter to continue, or Ctrl+C to cancel</Text>
        </Box>
        
        <TextInput
          value=""
          onChange={() => {}}
          onSubmit={handleWelcomeNext}
          placeholder=""
        />
      </Box>
    );
  }

  if (step === 'template') {
    const items = PROJECT_TEMPLATES.map(template => ({
      label: `${template.label} - ${template.description}`,
      value: template
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="blue">📋 Choose Project Template</Text>
        <Text></Text>
        <Text>Select the template that best matches your project:</Text>
        <Text></Text>
        
        <SelectInput
          items={items}
          onSelect={(item) => handleTemplateSelect(item.value)}
        />
        
        <Text></Text>
        <Text color="gray">Use arrow keys to navigate, Enter to select</Text>
      </Box>
    );
  }

  if (step === 'custom-patterns') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="blue">⚙️  Custom Protection Patterns</Text>
        <Text></Text>
        
        <Text>Enter file patterns to protect (gitignore-style syntax):</Text>
        <Text color="gray">Examples: .env, **/*.key, config/*.json, !*.example</Text>
        <Text></Text>
        
        {customPatterns.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Current patterns:</Text>
            {customPatterns.map((pattern, index) => (
              <Box key={index} marginLeft={2}>
                <Text color="green">✓ {pattern}</Text>
              </Box>
            ))}
            <Text></Text>
          </Box>
        )}
        
        {!editingCustom ? (
          <Box flexDirection="column">
            <Text>Add pattern (Enter to add, 'done' to finish):</Text>
            <TextInput
              value={currentPattern}
              onChange={setCurrentPattern}
              onSubmit={(value) => {
                if (value.toLowerCase() === 'done') {
                  handleFinishCustom();
                } else {
                  handleAddCustomPattern();
                }
              }}
              placeholder=".env, **/*.key, etc."
            />
          </Box>
        ) : null}
        
        <Text></Text>
        <Text color="gray">Type 'done' and press Enter when finished</Text>
      </Box>
    );
  }

  if (step === 'review') {
    const patterns = selectedTemplate?.patterns || customPatterns;
    
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="blue">📝 Review Configuration</Text>
        <Text></Text>
        
        <Text bold>Template: </Text>
        <Text color="green">{selectedTemplate?.label}</Text>
        <Text color="gray">{selectedTemplate?.description}</Text>
        <Text></Text>
        
        <Text bold>Protection patterns:</Text>
        {patterns.length > 0 ? (
          patterns.map((pattern, index) => (
            <Box key={index} marginLeft={2}>
              <Text color={pattern.startsWith('!') ? 'yellow' : 'blue'}>
                {pattern.startsWith('!') ? '🚫' : '🔒'} {pattern}
              </Text>
            </Box>
          ))
        ) : (
          <Text color="gray">No patterns defined</Text>
        )}
        
        <Text></Text>
        <Text>This will create a .ailock file in your project root.</Text>
        <Text></Text>
        
        <Box>
          <Text color="green">Press Enter to create, or Ctrl+C to cancel</Text>
        </Box>
        
        <TextInput
          value=""
          onChange={() => {}}
          onSubmit={handleConfirmSetup}
          placeholder=""
        />
      </Box>
    );
  }

  if (step === 'complete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">✅ Setup Complete!</Text>
        <Text></Text>
        
        <Text>🎉 Your .ailock configuration has been created successfully.</Text>
        <Text></Text>
        
        <Text bold color="blue">Next steps:</Text>
        <Text>1. 🔒 Lock your sensitive files: </Text>
        <Text color="gray">   ailock lock</Text>
        <Text></Text>
        
        <Text>2. 🪝 Install Git protection: </Text>
        <Text color="gray">   ailock install-hooks</Text>
        <Text></Text>
        
        <Text>3. 📊 Check status anytime: </Text>
        <Text color="gray">   ailock status</Text>
        <Text></Text>
        
        <Text color="gray">Exiting in 2 seconds...</Text>
      </Box>
    );
  }

  return null;
};