// models/applicationSchema.js
import mongoose from "mongoose";
import validator from "validator";

const applicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please enter your Name!"],
    minLength: [3, "Name must contain at least 3 Characters!"],
    maxLength: [30, "Name cannot exceed 30 Characters!"],
  },
  email: {
    type: String,
    required: [true, "Please enter your Email!"],
    validate: [validator.isEmail, "Please provide a valid Email!"],
  },
  coverLetter: {
    type: String,
    required: [true, "Please provide a cover letter!"],
  },
  phone: {
    type: Number,
    required: [true, "Please enter your Phone Number!"],
  },
  address: {
    type: String,
    required: [true, "Please enter your Address!"],
  },
  resume: {
    public_id: {
      type: String, 
      required: true,
    },
    url: {
      type: String, 
      required: true,
    },originalName: {
      type: String,
      required: true,
    },
    contentType: {
      type: String,
      required: true,
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  applicantID: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["Job Seeker"],
      required: true,
    },
  },
  employerID: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["Employer"],
      required: true,
    },
  },
  analysis: {
    type: String,
    required: false
  },
  matchScore: {
    type: Number,
    required: true,
    default: 0,
  },
  textAnalysis: {
    coverLetterAnalysis: {
      sentiment: {
        type: String,
        enum: ['Positive', 'Neutral', 'Negative'],
        default: 'Neutral'
      },
      keyPoints: [{
        type: String
      }],
      professionalTone: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    },
    resumeAnalysis: {
      experience: [{
        role: String,
        duration: String,
        skills: [String]
      }],
      skills: [{
        type: String
      }],
      education: [{
        degree: String,
        institution: String,
        year: String
      }]
    },
    overallAnalysis: {
      strengths: [{
        type: String
      }],
      improvements: [{
        type: String
      }],
      recommendations: [{
        type: String
      }]
    }
  }
});

export const Application = mongoose.model("Application", applicationSchema);