import app from "./app.js";
import { testOpenAIConnection } from "./utils/openaiConfig.js";
import assistantService from "./utils/assistantService.js";
import ErrorHandler from "./middlewares/error.js";
import { config } from "dotenv";
import path from 'path';
import { fileURLToPath } from 'url';
import emailService from './utils/emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment-specific configuration
const environment = process.env.NODE_ENV || 'development';
config({
  path: path.join(__dirname, `config/${environment}.env`)
});

// Enhanced error logging for development
const isDevelopment = environment === 'development';

const validateConfig = () => {
  const requiredEnvVars = [
    'MONGO_URI',
    'JWT_SECRET_KEY',
    'FRONTEND_URL'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Only validate OpenAI config if it's required
  if (process.env.OPENAI_API_KEY) {
    if (!process.env.OPENAI_API_KEY.startsWith('sk-') && !process.env.OPENAI_API_KEY.startsWith('proj-')) {
      throw new Error('Invalid API key format - should start with sk- or proj-');
    }
    
    if (!process.env.OPENAI_ORGANIZATION_ID?.startsWith('org-')) {
      throw new Error('Invalid organization ID format - should start with org-');
    }
  }
  
  return true;
};

const validateAssistantService = async () => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('OpenAI services not configured, skipping validation');
      return true;
    }

    console.log('Validating Assistant Service configuration...');
    assistantService.validateConfig();
    console.log('Assistant Service configuration is valid');
    return true;
  } catch (error) {
    console.error('Assistant Service validation failed:', error.message);
    // Don't fail startup if assistant service fails - just log the error
    return true;
  }
};

const startServer = async () => {
  try {
    // Validate configuration
    console.log(`Starting server in ${environment} mode...`);
    validateConfig();
    console.log('Configuration is valid');

    // Only test OpenAI if it's configured
    if (process.env.OPENAI_API_KEY) {
      // Validate Assistant Service
      await validateAssistantService();

      // Test OpenAI connection
      console.log('Testing OpenAI connection...');
      const connectionTest = await testOpenAIConnection();
      if (!connectionTest) {
        console.warn('OpenAI connection test failed, but continuing startup');
      } else {
        console.log('OpenAI connection test successful');
      }

      // Test Assistant Service connection
      console.log('Testing Assistant Service connection...');
      await assistantService.testConnection();
      console.log('Assistant Service connection test successful');
    } else {
      console.log('OpenAI services not configured, skipping connection tests');
    }

    // Start server
    const PORT = process.env.PORT || 4000;
    const server = app.listen(PORT, () => {
      console.log(`Server running in ${environment} mode on port ${PORT}`);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      console.log('UNHANDLED REJECTION! 💥 Shutting down...');
      console.log(err.name, err.message);
      server.close(() => {
        process.exit(1);
      });
    });

  } catch (error) {
    console.error('Error starting server:', {
      message: error.message,
      stack: isDevelopment ? error.stack : undefined
    });
    process.exit(1);
  }
};

// Test email configuration
if (process.env.SMTP_USER) {
  try {
    await emailService.initialize();
    await emailService.sendEmail({
      email: process.env.SMTP_USER,  // Send test email to yourself
      subject: "RecruitPilot Email System Test",
      message: "Email system is working!"
    });
    console.log('Email system initialized successfully');
  } catch (error) {
    console.error('Email setup test failed:', error);
  }
}

const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  try {
    if (process.env.OPENAI_API_KEY) {
      await assistantService.cleanup();
    }
    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle graceful shutdowns
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));




// Start the server
startServer();