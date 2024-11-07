// utils/openaiServiceValidator.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const validateOpenAIConfig = async () => {
  try {
    const configPath = path.join(__dirname, '../config/config.env');
    const configContent = await fs.readFile(configPath, 'utf-8');
    
    // Extract API key from config
    const apiKeyMatch = configContent.match(/OPENAI_API_KEY=(.+)/);
    let apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : null;
    
    // Extract organization ID from config
    const orgMatch = configContent.match(/OPENAI_ORGANIZATION_ID=(.+)/);
    const orgId = orgMatch ? orgMatch[1].trim() : null;
    
    const issues = [];
    
    if (!apiKey) {
      issues.push('OPENAI_API_KEY is missing');
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
      issues.push('OPENAI_ORGANIZATION_ID is missing');
    } else {
      if (!orgId.startsWith('org-')) {
        issues.push('Organization ID should start with "org-"');
      }
      if (orgId.includes('"') || orgId.includes("'")) {
        issues.push('Organization ID contains quotes - please remove them');
      }
      if (orgId.includes(' ')) {
        issues.push('Organization ID contains spaces - please remove them');
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      config: {
        apiKey: apiKey ? `${apiKey.slice(0, 5)}***${apiKey.slice(-4)}` : null,
        orgId: orgId ? `***${orgId.slice(-4)}` : null
      }
    };
  } catch (error) {
    console.error('Error validating OpenAI config:', error);
    return {
      isValid: false,
      issues: ['Could not read config file'],
      error: error.message
    };
  }
};