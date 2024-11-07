import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const validateOpenAIConfig = async () => {
  // Get configuration from environment variables
  let apiKey = process.env.OPENAI_API_KEY;
  let orgId = process.env.OPENAI_ORGANIZATION_ID;
  
  // No need to check config file if we have environment variables
  if (apiKey && orgId) {
    const issues = [];
    
    // Validate API key
    if (!apiKey.startsWith('sk-') && !apiKey.startsWith('proj-')) {
      issues.push('API key should start with either "sk-" or "proj-"');
    }
    
    // Validate Organization ID
    if (!orgId.startsWith('org-')) {
      issues.push('Organization ID should start with "org-"');
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      config: {
        apiKey: apiKey ? `${apiKey.slice(0, 5)}***${apiKey.slice(-4)}` : null,
        orgId: orgId ? `org-***${orgId.slice(-4)}` : null,
        source: 'environment'
      }
    };
  }
  
  // Only try config file if environment variables are missing
  try {
    const configPath = path.join(__dirname, '../config/config.env');
    const configContent = await fs.readFile(configPath, 'utf-8');
    
    if (!apiKey) {
      const apiKeyMatch = configContent.match(/OPENAI_API_KEY=(.+)/);
      apiKey = apiKeyMatch ? apiKeyMatch[1].trim().replace(/["']/g, '') : null;
    }
    
    if (!orgId) {
      const orgMatch = configContent.match(/OPENAI_ORGANIZATION_ID=(.+)/);
      orgId = orgMatch ? orgMatch[1].trim().replace(/["']/g, '') : null;
    }
  } catch (error) {
    // If we can't read config file and have no env vars, return appropriate message
    if (!apiKey || !orgId) {
      return {
        isValid: false,
        issues: ['No configuration found in environment variables'],
        config: null
      };
    }
  }
  
  const issues = [];
  
  if (!apiKey) {
    issues.push('OPENAI_API_KEY is missing');
  } else if (!apiKey.startsWith('sk-') && !apiKey.startsWith('proj-')) {
    issues.push('API key should start with either "sk-" or "proj-"');
  }
  
  if (!orgId) {
    issues.push('OPENAI_ORGANIZATION_ID is missing');
  } else if (!orgId.startsWith('org-')) {
    issues.push('Organization ID should start with "org-"');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    config: {
      apiKey: apiKey ? `${apiKey.slice(0, 5)}***${apiKey.slice(-4)}` : null,
      orgId: orgId ? `org-***${orgId.slice(-4)}` : null,
      source: 'config.env'
    }
  };
};

// Simplified loadEnvConfig that won't throw errors
export const loadEnvConfig = async () => {
  try {
    const configPath = path.join(__dirname, '../config/config.env');
    const configContent = await fs.readFile(configPath, 'utf-8');
    
    configContent
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .forEach(line => {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim().replace(/["']/g, '');
        if (key && value && !process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      });
      
    return true;
  } catch (error) {
    return false;
  }
};