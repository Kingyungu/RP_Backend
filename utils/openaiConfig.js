// utils/openaiConfig.js
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ 
  path: path.join(__dirname, '../config/config.env')
});

function formatApiKey(key) {
  if (!key) {
    throw new Error('OpenAI API key is not configured');
  }

  // Remove any whitespace and quotes
  key = key.trim().replace(/["']/g, '');

  // If key already starts with prefix, return as is
  if (key.startsWith('sk-')) {
    return key;
  }

  // If key starts with proj-, remove it before adding sk-
  if (key.startsWith('proj-')) {
    key = key.substring(5);
  }

  // Add sk- prefix
  return `sk-${key}`;
}

const openai = new OpenAI({
  apiKey: formatApiKey(process.env.OPENAI_API_KEY),
  organization: process.env.OPENAI_ORGANIZATION_ID?.trim(),
  defaultHeaders: {
    'OpenAI-Beta': 'assistants=v1'
  }
});

export const testOpenAIConnection = async () => {
  try {
    const apiKey = openai.apiKey;
    // Only show first 5 and last 4 characters of the API key
    const maskedKey = `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`;
    console.log('Testing with API key format:', maskedKey);
    console.log('Organization ID:', openai.organization);
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Test connection" }],
      max_tokens: 5
    });
    
    console.log('OpenAI connection test successful');
    return true;
  } catch (error) {
    console.error('OpenAI connection test failed. Detailed error:', {
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code,
      details: error.response?.data
    });
    return false;
  }
};

export default openai;