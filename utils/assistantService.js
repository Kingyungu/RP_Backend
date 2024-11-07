// utils/assistantService.js
import OpenAI from 'openai';
import ErrorHandler, { logError } from '../middlewares/error.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const MAX_ATTEMPTS = 60;

class AssistantService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORGANIZATION_ID
    });
    
    if (!process.env.OPENAI_ASSISTANT_ID) {
      throw new ErrorHandler('OpenAI Assistant ID is not configured in environment', 500);
    }
    
    this.assistantId = process.env.OPENAI_ASSISTANT_ID;
  }

  async retry(operation, maxRetries = MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        console.log(`Retry attempt ${i + 1}/${maxRetries}`);
      }
    }
  }

  async analyzeApplication(cvText, jobDescription) {
    let thread = null;
    
    try {
      console.log('Starting application analysis...');
      
      thread = await this.retry(async () => 
        await this.client.beta.threads.create()
      );
      
      await this.retry(async () => 
        await this.client.beta.threads.messages.create(thread.id, {
          role: "user",
          content: this.formatAnalysisPrompt(jobDescription, cvText)
        })
      );

      const run = await this.retry(async () => 
        await this.client.beta.threads.runs.create(thread.id, {
          assistant_id: this.assistantId,
        })
      );

      await this.waitForCompletion(thread.id, run.id);
      
      const messages = await this.retry(async () => 
        await this.client.beta.threads.messages.list(thread.id)
      );
      
      const analysis = messages.data[0].content[0].text.value;
      const matchScore = this.parseMatchScore(analysis);

      const validationResult = this.validateAnalysisResponse(analysis);
      if (!validationResult.isValid) {
        console.warn('Analysis format validation:', validationResult);
      }

      console.log('Analysis completed successfully:', {
        threadId: thread.id,
        score: matchScore,
        analysisLength: analysis.length,
        validationResult
      });

      return {
        success: true,
        analysis: analysis,
        score: matchScore,
        validation: validationResult
      };
    } catch (error) {
      logError(error, { 
        context: 'AI Analysis',
        threadId: thread?.id
      });
      
      return {
        success: false,
        error: error.message,
        analysis: "We apologize, but we couldn't complete the analysis at this moment. Your application has been submitted and will be reviewed by the hiring team.",
        score: 0
      };
    } finally {
      await this.cleanupThread(thread);
    }
  }

  async waitForCompletion(threadId, runId, maxAttempts = MAX_ATTEMPTS) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const run = await this.retry(async () => 
          await this.client.beta.threads.runs.retrieve(threadId, runId)
        );
        
        console.log(`Run status check ${i + 1}/${maxAttempts}:`, run.status);

        switch (run.status) {
          case 'completed':
            return run;
          case 'failed':
          case 'cancelled':
          case 'expired':
            throw new ErrorHandler(
              `Assistant run ${run.status}: ${run.last_error?.message || 'Unknown error'}`,
              500
            );
          case 'queued':
          case 'in_progress':
          case 'requires_action':
            await new Promise(resolve => setTimeout(resolve, 1000));
            break;
          default:
            throw new ErrorHandler(`Unknown run status: ${run.status}`, 500);
        }
      } catch (error) {
        logError(error, {
          context: 'Wait For Completion',
          threadId,
          runId,
          attempt: i + 1
        });
        throw error;
      }
    }
    
    throw new ErrorHandler('Assistant analysis timed out', 500);
  }

  async testConnection() {
    try {
      const thread = await this.client.beta.threads.create();
      await this.cleanupThread({ id: thread.id });
      return true;
    } catch (error) {
      throw new ErrorHandler(
        `Assistant Service connection test failed: ${error.message}`,
        500
      );
    }
  }

  async cleanupThread(thread) {
    if (thread?.id) {
      try {
        await this.client.beta.threads.del(thread.id);
        console.log('Thread cleanup completed:', thread.id);
      } catch (cleanupError) {
        logError(cleanupError, {
          context: 'Thread Cleanup',
          threadId: thread.id
        });
      }
    }
  }

  validateConfig() {
    const config = {
      apiKey: !!process.env.OPENAI_API_KEY,
      orgId: !!process.env.OPENAI_ORGANIZATION_ID,
      assistantId: !!process.env.OPENAI_ASSISTANT_ID
    };

    console.log('Assistant Service Configuration:', {
      apiKey: config.apiKey ? 'Present' : 'Missing',
      orgId: config.orgId ? 'Present' : 'Missing',
      assistantId: config.assistantId ? 'Present' : 'Missing'
    });

    if (!process.env.OPENAI_API_KEY) {
      throw new ErrorHandler('OpenAI API key is not configured', 500);
    }

    if (!process.env.OPENAI_ORGANIZATION_ID) {
      throw new ErrorHandler('OpenAI Organization ID is not configured', 500);
    }

    if (!process.env.OPENAI_ASSISTANT_ID) {
      throw new ErrorHandler('OpenAI Assistant ID is not configured', 500);
    }

    return true;
  }

  formatAnalysisPrompt(jobDescription, cvText) {
    return `Review this application as a third-party recruitment specialist and provide professional feedback.

Job Description:
${jobDescription}

CV/Application Content:
${cvText}

Please provide concise, constructive feedback using exactly this format:

Match Score: [0-100]

Initial Feedback:
[Friendly greeting and 2-3 sentences of personalized feedback focusing on key alignments or gaps]

Strengths Identified:
- [Top 2-3 relevant qualifications that align well with the role]
- [Include specific examples from the CV where possible]

Areas for Enhancement:
- [2-3 specific qualifications or experiences that could be strengthened]
- [Focus on constructive, actionable gaps]

Recommendations:
[One clear, practical suggestion for improving the application]

Note: Keep feedback brief, professional, and constructive. Focus on specific qualifications and experiences rather than general statements.`;
  }

  validateAnalysisResponse(analysis) {
    const requiredSections = [
      { name: 'Match Score', pattern: /Match Score:\s*\d+/ },
      { name: 'Initial Feedback', pattern: /Initial Feedback:[\s\S]+?(?=\n\n|$)/ },
      { name: 'Strengths Identified', pattern: /Strengths Identified:[\s\S]+?(?=\n\n|$)/ },
      { name: 'Areas for Enhancement', pattern: /Areas for Enhancement:[\s\S]+?(?=\n\n|$)/ },
      { name: 'Recommendations', pattern: /Recommendations:[\s\S]+?(?=\n\n|$)/ }
    ];

    const issues = [];
    const missing = [];

    for (const section of requiredSections) {
      if (!section.pattern.test(analysis)) {
        missing.push(section.name);
      }
    }

    const wordCount = analysis.split(/\s+/).length;
    if (wordCount > 150) {
      issues.push(`Response too long (${wordCount} words)`);
    }

    const inappropriatePhrases = [
      'our team',
      'join us',
      'we are looking',
      'our company',
      'welcome aboard',
      'welcome to the team'
    ];

    for (const phrase of inappropriatePhrases) {
      if (analysis.toLowerCase().includes(phrase)) {
        issues.push(`Contains inappropriate phrase: "${phrase}"`);
      }
    }

    return {
      isValid: missing.length === 0 && issues.length === 0,
      missing,
      issues,
      wordCount
    };
  }

  parseMatchScore(analysis) {
    const scoreMatch = analysis.match(/Match Score:\s*(\d+)/i);
    return scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1]))) : 0;
  }

  async cleanup() {
    console.log('Assistant Service cleanup completed');
  }
}

const assistantService = new AssistantService();
export default assistantService;