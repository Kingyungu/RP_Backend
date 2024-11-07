import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const validateOpenAIConfig = async () => {
  try {
    // First check environment variables
    let apiKey = process.env.OPENAI_API_KEY;
    let orgId = process.env.OPENAI_ORGANIZATION_ID;
    
    // If not found in env vars, try reading from config file
    if (!apiKey || !orgId) {
      try {
        const configPath = path.join(__dirname, '../config/config.env');
        const configContent = await fs.readFile(configPath, 'utf-8');
        
        // Extract API key from config if not in env
        if (!apiKey) {
          const apiKeyMatch = configContent.match(/OPENAI_API_KEY=(.+)/);
          apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : null;
        }
        
        // Extract organization ID from config if not in env
        if (!orgId) {
          const orgMatch = configContent.match(/OPENAI_ORGANIZATION_ID=(.+)/);
          orgId = orgMatch ? orgMatch[1].trim() : null;
        }
      } catch (fileError) {
        console.warn('Config file not found, using environment variables only');
      }
    }

    const issues = [];
    
    if (!apiKey) {
      issues.push('OPENAI_API_KEY is missing from both environment and config.env');
    } else {
      // Remove any quotes
      apiKey = apiKey.replace(/["']/g, '');
      
      // Check if it has either prefix
      if (!apiKey.startsWith('sk-') && !apiKey.startsWith('proj-')) {
        issues.push('API key should start with either "sk-" or "proj-"');
      }
      
      if (apiKey.includes(' ')) {
        issues.push('API key contains spaces - please remove them');
      }
    }
    
    if (!orgId) {
      issues.push('OPENAI_ORGANIZATION_ID is missing from both environment and config.env');
    } else {
      // Remove any quotes
      orgId = orgId.replace(/["']/g, '');
      
      if (!orgId.startsWith('org-')) {
        issues.push('Organization ID should start with "org-"');
      }
      if (orgId.includes(' ')) {
        issues.push('Organization ID contains spaces - please remove them');
      }
    }
    
    // Mask sensitive data for logging
    const maskedConfig = {
      apiKey: apiKey ? `${apiKey.slice(0, 5)}***${apiKey.slice(-4)}` : null,
      orgId: orgId ? `org-***${orgId.slice(-4)}` : null,
      source: apiKey ? (process.env.OPENAI_API_KEY ? 'environment' : 'config.env') : null
    };
    
    return {
      isValid: issues.length === 0,
      issues,
      config: maskedConfig
    };
  } catch (error) {
    console.error('Error validating OpenAI config:', error);
    return {
      isValid: false,
      issues: ['Error validating configuration'],
      error: error.message
    };
  }
};

// Helper function to load environment variables from config.env
export const loadEnvConfig = async () => {
  try {
    const configPath = path.join(__dirname, '../config/config.env');
    const configContent = await fs.readFile(configPath, 'utf-8');
    
    const envVars = configContent
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .reduce((vars, line) => {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim().replace(/["']/g, '');
        if (key && value) {
          vars[key.trim()] = value;
        }
        return vars;
      }, {});
      
    // Set environment variables
    Object.entries(envVars).forEach(([key, value]) => {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
    
    return true;
  } catch (error) {
    console.warn('Could not load config.env file:', error.message);
    return false;
  }
};