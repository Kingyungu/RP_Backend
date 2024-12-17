// utils/assistantService.js
import ErrorHandler, { logError } from '../middlewares/error.js';
import openai from './openaiConfig.js';
import { validateOpenAIConfig } from './openaiServiceValidator.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const MAX_ATTEMPTS = 60;

class AssistantService {
  constructor() {
    this.initialize();
  }

  async initialize() {
    try {
      const configValidation = await validateOpenAIConfig();
      this.isConfigValid = configValidation.isValid;
      
      if (!this.isConfigValid) {
        console.warn('OpenAI configuration issues:', configValidation.issues);
        return this.useFallbackMode();
      }

      this.client = openai;
      this.assistantId = process.env.OPENAI_ASSISTANT_ID;

      if (!this.assistantId) {
        console.warn('OpenAI Assistant ID not configured');
        return this.useFallbackMode();
      }

    } catch (error) {
      console.error('Failed to initialize AssistantService:', error);
      this.useFallbackMode();
    }
  }

  useFallbackMode() {
    console.log('Using fallback mode for AI analysis');
    this.isConfigValid = false;
  }

  async retry(operation, maxRetries = MAX_RETRIES) {
    if (!this.isConfigValid) return null;

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
    if (!this.isConfigValid) {
      return {
        success: true,
        analysis: `
1. INTERNAL RECRUITER ANALYSIS:

Match Score: 50

Initial Feedback:
Application received and pending manual review by our recruitment team.

Strengths Identified:
- Pending manual review
- Will be evaluated by recruitment team

Areas for Enhancement:
- Pending detailed review
- Will provide specific feedback after evaluation

Recommendations:
Await feedback from our recruitment team

2. CANDIDATE FEEDBACK EMAIL:

Subject: Application Status Update - Position

Dear Candidate,

Thank you for your application. We have received your submission and it is currently under review by our recruitment team.

We will carefully evaluate your qualifications and experience against the position requirements and get back to you with detailed feedback.

Please allow us some time to complete our review process. We appreciate your patience.

Best regards,
Recruitment Team`,
        score: 50
      };
    }

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
    if (!this.isConfigValid) return null;

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
    if (!this.isConfigValid) {
      console.log('OpenAI services not configured, skipping connection test');
      return true;
    }

    try {
      if (!this.client) {
        console.log('OpenAI client not properly initialized');
        return false;
      }

      const thread = await this.client.beta.threads.create();
      await this.cleanupThread({ id: thread.id });
      return true;
    } catch (error) {
      console.warn('Assistant Service connection test failed:', error.message);
      return false;
    }
  }

  async cleanupThread(thread) {
    if (!this.isConfigValid || !thread?.id) return;

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

  formatAnalysisPrompt(jobDescription, cvText) {
    return `Analyze this job application as a recruitment specialist and provide two types of feedback:
  
1. INTERNAL RECRUITER ANALYSIS:
Job Description:
${jobDescription}

CV/Application Content:
${cvText}

Please provide concise, constructive feedback using exactly this format:

Match Score: [0-100]

Initial Feedback:
[2-3 sentences of personalized feedback focusing on key alignments or gaps]

Strengths Identified:
- [Top 2-3 relevant qualifications that align well with the role]
- [Include specific examples from the CV where possible]

Areas for Enhancement:
- [2-3 specific qualifications or experiences that could be strengthened]
- [Focus on constructive, actionable gaps]

Recommendations:
[One clear, practical suggestion for improving the application]

2. CANDIDATE FEEDBACK EMAIL:
Now, draft a professional email response to the candidate using this structure:

Subject: Application Status Update - [Job Title] Position

Dear [Candidate Name],

[Opening - Thank them for their application and express genuine interest]

[Body Paragraph 1 - Highlight 2-3 specific strengths from their application]

[Body Paragraph 2 - Constructively address any gaps or areas for improvement]

[Body Paragraph 3 - Next steps or recommendations]

Best regards,
[Company] Recruitment Team

Note: Keep both analyses professional, constructive, and actionable. Focus on specific qualifications and experiences rather than general statements.`;
  }

  parseAnalysisResponse(analysis) {
    try {
      // Handle undefined or null analysis
      if (!analysis) {
        console.error('Analysis is null or undefined');
        return {
          recruiterFeedback: '',
          candidateEmail: ''
        };
      }
  
      // Split on exact header match
      const parts = analysis.split(/2\.\s*CANDIDATE FEEDBACK EMAIL:/i);
      
      if (parts.length !== 2) {
        console.warn('Analysis format invalid, could not split into two parts:', analysis);
        // Return the whole analysis as recruiter feedback if we can't split it
        return {
          recruiterFeedback: analysis.replace(/1\.\s*INTERNAL RECRUITER ANALYSIS:/i, '').trim(),
          candidateEmail: ''
        };
      }
  
      const [recruiterPart, emailPart] = parts;
  
      return {
        recruiterFeedback: recruiterPart.replace(/1\.\s*INTERNAL RECRUITER ANALYSIS:/i, '').trim(),
        candidateEmail: emailPart.trim()
      };
    } catch (error) {
      console.error('Error parsing analysis response:', error);
      return {
        recruiterFeedback: analysis || '',
        candidateEmail: ''
      };
    }
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