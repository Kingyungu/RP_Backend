// migration.js
import mongoose from "mongoose";
import { Application } from "./models/applicationSchema.js";
import { Job } from "./models/jobSchema.js";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({
  path: path.join(__dirname, `config/${process.env.NODE_ENV || 'development'}.env`)
});

const migrateMissingJobIds = async () => {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "MERN_JOB_SEEKING_WEBAPP"
    });
    console.log('Connected to MongoDB successfully');

    // Find all applications without jobId
    const applications = await Application.find({ jobId: { $exists: false } });
    
    console.log(`Found ${applications.length} applications without jobId`);

    for (const app of applications) {
      // Find the job posted by the employer
      const job = await Job.findOne({ 
        postedBy: app.employerID.user,
        createdAt: { $lt: app.createdAt }  // Job must have been created before the application
      }).sort({ createdAt: -1 });  // Get the most recent job if multiple exist

      if (job) {
        app.jobId = job._id;
        await app.save();
        console.log(`Updated application ${app._id} with jobId ${job._id}`);
      } else {
        console.log(`Could not find matching job for application ${app._id}`);
      }
    }

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Run the migration
console.log('Starting migration...');
migrateMissingJobIds();