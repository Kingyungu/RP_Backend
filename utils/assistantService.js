import ErrorHandler, { logError } from "../middlewares/error.js";
import openai from "./openaiConfig.js";
import { validateOpenAIConfig } from "./openaiServiceValidator.js";

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
        console.warn("OpenAI configuration issues:", configValidation.issues);
        return this.useFallbackMode();
      }

      this.client = openai;
      this.assistantId = process.env.OPENAI_ASSISTANT_ID;

      if (!this.assistantId) {
        console.warn("OpenAI Assistant ID not configured");
        return this.useFallbackMode();
      }
    } catch (error) {
      console.error("Failed to initialize AssistantService:", error);
      this.useFallbackMode();
    }
  }

  useFallbackMode() {
    console.log("Using fallback mode for AI analysis");
    this.isConfigValid = false;
  }

  async testConnection() {
    try {
      if (!this.isConfigValid) {
        console.log("OpenAI services not configured, skipping connection test");
        return true;
      }

      if (!this.client) {
        console.warn("OpenAI client not properly initialized");
        return false;
      }

      console.log("Testing thread creation...");
      const thread = await this.retry(async () => {
        return await this.client.beta.threads.create();
      });

      if (!thread?.id) {
        console.warn("Failed to create test thread");
        return false;
      }

      await this.cleanupThread({ id: thread.id });
      console.log("Connection test successful");
      return true;
    } catch (error) {
      console.error("Connection test failed:", {
        message: error.message,
        name: error.name,
        status: error.status,
      });
      return false;
    }
  }

  async analyzeApplication(cvText, jobDescription) {
    if (!this.isConfigValid) {
      const fallback = this.generateFallbackAnalysis();
      return fallback;
    }

    let thread = null;

    try {
      console.log("Starting application analysis...");
      thread = await this.retry(() => this.client.beta.threads.create());

      const analysis = await this.generateFullAnalysis(
        thread.id,
        cvText,
        jobDescription
      );
      const { recruiterFeedback, candidateEmail } =
        this.parseAnalysisResponse(analysis);
      const matchScore = this.calculateMatchScore(analysis);

      const validationResult = this.validateAnalysis(analysis);
      if (!validationResult.isValid) {
        console.warn("Analysis validation issues:", validationResult);
      }

      return {
        success: true,
        analysis: analysis,
        recruiterAnalysis: recruiterFeedback,
        candidateEmail: candidateEmail,
        score: matchScore,
        validation: validationResult,
      };
    } catch (error) {
      logError(error, {
        context: "AI Analysis",
        threadId: thread?.id,
      });

      return {
        success: false,
        error: error.message,
        analysis: "Application received. Manual review required.",
        recruiterAnalysis: "Error during analysis. Please review manually.",
        candidateEmail:
          "Thank you for your application. Our team will review it shortly.",
        score: 0,
      };
    } finally {
      await this.cleanupThread(thread);
    }
  }

  async generateFullAnalysis(threadId, cvText, jobDescription) {
    const prompt = this.formatAnalysisPrompt(jobDescription, cvText);

    await this.retry(() =>
      this.client.beta.threads.messages.create(threadId, {
        role: "user",
        content: prompt,
      })
    );

    const run = await this.retry(() =>
      this.client.beta.threads.runs.create(threadId, {
        assistant_id: this.assistantId,
      })
    );

    await this.waitForCompletion(threadId, run.id);

    const messages = await this.retry(() =>
      this.client.beta.threads.messages.list(threadId)
    );

    return messages.data[0].content[0].text.value;
  }

  formatAnalysisPrompt(jobDescription, cvText) {
    return `Analyze this job application and provide two distinct sections of feedback:
  
1. INTERNAL RECRUITER ANALYSIS:
Job Description:
${jobDescription}

Application Content:
${cvText}

Provide analysis using this exact format without markdown or special formatting:

Match Score: [0-100]

Initial Feedback:
[2-3 sentences on key alignments/gaps]

Strengths Identified:
- [List 2-3 key qualifying strengths]
- [With specific examples]

Areas for Enhancement:
- [List 2-3 improvement areas]
- [Be specific and actionable]

Recommendations:
[One clear improvement suggestion]

---

2. CANDIDATE FEEDBACK EMAIL:

Subject: Application Status Update

Dear [Candidate Name],

[Thank you and acknowledgment]

[Highlight 2-3 strengths]

[Constructive feedback on areas for improvement]

[Clear next steps]

Best regards,
Recruitment Team

Note: Please provide the response without any markdown formatting or special characters.`;
}

parseAnalysisResponse(analysis) {
  try {
      if (!analysis) {
          console.error('Analysis is null or undefined');
          return {
              recruiterAnalysis: 'Analysis pending manual review.',
              candidateEmail: 'Thank you for your application. It is under review.'
          };
      }

      // Find the separation point between recruiter analysis and candidate email
      const separators = [
          '2. CANDIDATE FEEDBACK EMAIL:',
          'Subject:', 
          '---'
      ];

      let splitIndex = -1;
      let usedSeparator = '';
      
      for (const separator of separators) {
          splitIndex = analysis.indexOf(separator);
          if (splitIndex !== -1) {
              usedSeparator = separator;
              break;
          }
      }

      if (splitIndex === -1) {
          console.warn('Could not find email section separator');
          return {
              recruiterAnalysis: analysis,
              candidateEmail: 'Thank you for your application. It is under review.'
          };
      }

      // Extract the two sections
      const recruiterPart = analysis.substring(0, splitIndex).trim();
      const emailPart = analysis.substring(splitIndex + usedSeparator.length).trim();

      // Clean up recruiter analysis
      const cleanRecruiterAnalysis = recruiterPart
          .replace(/1\.\s*INTERNAL RECRUITER ANALYSIS:?/i, '')
          .trim();

      // Clean up candidate email
      const cleanCandidateEmail = emailPart
          .replace(/^[\r\n]+/, '') // Remove leading newlines
          .trim();

      return {
          recruiterAnalysis: cleanRecruiterAnalysis,
          candidateEmail: cleanCandidateEmail
      };

  } catch (error) {
      console.error('Error parsing analysis response:', error);
      return {
          recruiterAnalysis: 'Error during analysis. Manual review required.',
          candidateEmail: 'Thank you for your application. Our team will review it shortly.'
      };
  }
}

  calculateMatchScore(analysis) {
    try {
      const scoreMatch = analysis.match(/Match Score:\s*(\d+)/i);
      return scoreMatch
        ? Math.min(100, Math.max(0, parseInt(scoreMatch[1])))
        : 0;
    } catch (error) {
      console.error("Error calculating match score:", error);
      return 0;
    }
  }

  validateAnalysis(analysis) {
    const requiredSections = [
      { name: "Match Score", pattern: /Match Score:\s*\d+/ },
      {
        name: "Initial Feedback",
        pattern: /Initial Feedback:[\s\S]+?(?=Strengths Identified|$)/,
      },
      {
        name: "Strengths Identified",
        pattern: /Strengths Identified:[\s\S]+?(?=Areas for Enhancement|$)/,
      },
      {
        name: "Areas for Enhancement",
        pattern: /Areas for Enhancement:[\s\S]+?(?=Recommendations|$)/,
      },
      { name: "Recommendations", pattern: /Recommendations:[\s\S]+?(?=---|$)/ },
    ];

    const issues = [];
    const missing = [];

    // Validate section presence
    for (const section of requiredSections) {
      if (!section.pattern.test(analysis)) {
        missing.push(section.name);
      }
    }

    // Check for inappropriate language
    const inappropriateTerms = [
      "our company",
      "our team",
      "we are",
      "join us",
      "welcome aboard",
      "pleased to offer",
    ];

    inappropriateTerms.forEach((term) => {
      if (analysis.toLowerCase().includes(term)) {
        issues.push(`Contains inappropriate term: "${term}"`);
      }
    });

    // Validate length
    const words = analysis.split(/\s+/).length;
    if (words > 500) {
      issues.push("Analysis exceeds maximum length");
    }

    return {
      isValid: missing.length === 0 && issues.length === 0,
      missing,
      issues,
      wordCount: words,
    };
  }

  async retry(operation, maxRetries = MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * (i + 1))
        );
        console.log(`Retry attempt ${i + 1}/${maxRetries}`);
      }
    }
  }

  async waitForCompletion(threadId, runId, maxAttempts = MAX_ATTEMPTS) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const run = await this.retry(() =>
          this.client.beta.threads.runs.retrieve(threadId, runId)
        );

        console.log(`Run status check ${i + 1}/${maxAttempts}:`, run.status);

        switch (run.status) {
          case "completed":
            return run;
          case "failed":
          case "cancelled":
          case "expired":
            throw new ErrorHandler(
              `Assistant run ${run.status}: ${run.last_error?.message || "Unknown error"}`,
              500
            );
          case "queued":
          case "in_progress":
            await new Promise((resolve) => setTimeout(resolve, 1000));
            break;
          default:
            throw new ErrorHandler(`Unknown run status: ${run.status}`, 500);
        }
      } catch (error) {
        logError(error, {
          context: "Wait For Completion",
          threadId,
          runId,
          attempt: i + 1,
        });
        throw error;
      }
    }

    throw new ErrorHandler("Assistant analysis timed out", 500);
  }

  generateFallbackAnalysis() {
    const recruiterFeedback = `
Match Score: 50

Initial Feedback:
Application pending manual review.

Strengths Identified:
- To be evaluated
- Pending review

Areas for Enhancement:
- To be determined during review
- Awaiting detailed assessment

Recommendations:
Await manual review completion`;

    const candidateEmail = `
Subject: Application Status Update

Dear Candidate,

Thank you for submitting your application. We have received your documentation and it is currently under review.

Our team will carefully evaluate your qualifications against the position requirements and will be in touch with next steps.

Best regards,
Recruitment Team`;

    return {
      success: true,
      analysis: this.combineAnalysis(recruiterFeedback, candidateEmail),
      recruiterAnalysis: recruiterFeedback,
      candidateEmail: candidateEmail,
      score: 50,
      validation: {
        isValid: true,
        missing: [],
        issues: [],
        wordCount: 89,
      },
    };
  }

  combineAnalysis(recruiterAnalysis, candidateEmail) {
    return `
1. INTERNAL RECRUITER ANALYSIS:
${recruiterAnalysis}

---

2. CANDIDATE FEEDBACK EMAIL:
${candidateEmail}`;
  }

  async cleanupThread(thread) {
    if (!thread?.id) return;

    try {
      await this.client.beta.threads.del(thread.id);
      console.log("Thread cleanup completed:", thread.id);
    } catch (error) {
      logError(error, {
        context: "Thread Cleanup",
        threadId: thread.id,
      });
    }
  }
}

const assistantService = new AssistantService();
export default assistantService;
